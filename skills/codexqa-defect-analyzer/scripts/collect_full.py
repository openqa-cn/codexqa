#!/usr/bin/env python3
"""Full-repo collect: deterministic baseline + hot-score + metrics; fan-in from CodexQA ONLY."""
import argparse, datetime, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import CODE_EXT, data_dir, git, is_excluded, load_config
from codexqa_client import (CodexQAError, file_fan_in_map, graph_engine_meta,
                            import_neighbor_path, index_repo, imports,
                            prepare_polyglot_codexqa, summary)
from ensure_tools import ensure_scan_tools
from rag_context import norm_repo_path, resolve_rag_intent
from scope_planner import build_scope_plan, scope_allowlist
from sast_adapters import (BRANCH_RE, compute_code_metrics, partition_sast_for_llm,
                           run_all_deterministic)

def norm(x, maxv):
    return min(1.0, x / maxv) if maxv else 0.0

def shard_files(files, max_per_shard):
    groups = {}
    for f in files:
        shard = f['path'].split('/')[0] if '/' in f['path'] else '.'
        groups.setdefault(shard, []).append(f)
    shards = {}
    for name, items in groups.items():
        items = sorted(items, key=lambda x: -x['hot_score'])
        if len(items) <= max_per_shard:
            shards[name] = items
            continue
        for i in range(0, len(items), max_per_shard):
            chunk = items[i:i + max_per_shard]
            shards['%s#hot%d' % (name, i // max_per_shard)] = chunk
    return shards

def _top_shard(path):
    rel = norm_repo_path(path)
    return rel.split('/')[0] if '/' in rel else '.'


def select_edge_probe_files(files, limit=80):
    """Round-robin hottest files from each top-level shard (not walk-order prefix)."""
    groups = {}
    for f in sorted(files, key=lambda x: (
            -x.get('hot_score', 0), -x.get('fan_in', 0), x.get('path', ''))):
        groups.setdefault(_top_shard(f.get('path', '')), []).append(f)
    out, i = [], 0
    while len(out) < limit:
        progressed = False
        for items in groups.values():
            if i < len(items):
                out.append(items[i])
                progressed = True
                if len(out) >= limit:
                    break
        if not progressed:
            break
        i += 1
    return out


def cross_module_edges(repo, files, limit=80, per_file=8, import_fn=None):
    """CodexQA import edges that cross the top-level shard (apps ↔ packages, …)."""
    probe = import_fn or imports
    edges, seen = [], set()
    for f in select_edge_probe_files(files, limit=limit):
        path = f.get('path') or ''
        shard = _top_shard(path)
        dests = []
        try:
            raw = probe(repo, path, direction='out')[:per_file]
        except CodexQAError:
            raw = []
        for e in raw:
            dest = norm_repo_path(import_neighbor_path(e, path) or (
                (e or {}).get('to_file') if isinstance(e, dict) else ''), repo=repo)
            if not dest or dest == norm_repo_path(path):
                continue
            if _top_shard(dest) == shard:
                continue
            if dest not in dests:
                dests.append(dest)
        if dests:
            key = (path, tuple(dests))
            if key in seen:
                continue
            seen.add(key)
            edges.append({'file': path, 'foreign_deps': dests[:8],
                          'via': 'codexqa-imports'})
        if len(edges) >= 40:
            break
    return edges[:40]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    ap.add_argument('-o', '--output', default=None)
    ap.add_argument('--intent', default='',
                    help='Scan intent forwarded into collection + CodexQA RAG')
    ap.add_argument('--language', default=None,
                    help='override primary language (go|java|python|typescript|…)')
    ap.add_argument('--full-index', action='store_true',
                    help='CodexQA index --full (baseline rebuild)')
    args = ap.parse_args()
    cfg = load_config()
    try:
        lang_info = prepare_polyglot_codexqa(
            args.repo, cfg=cfg, caller='collect_full',
            language_hint=args.language)
    except CodexQAError as e:
        print('FATAL: CodexQA polyglot mandate:\n%s' % e, file=sys.stderr)
        sys.exit(3)
    tooling_status = ensure_scan_tools(repo=args.repo, cfg=cfg, full=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    out_path = args.output or data_dir('baseline', 'collection_%s.json' % stamp)
    repo_abs = os.path.abspath(args.repo)

    try:
        # Baseline prefer full rebuild once; default incremental index refresh
        index_repo(repo_abs, full=bool(args.full_index or cfg.get('full_codexqa_index', False)))
    except CodexQAError as e:
        print('FATAL: CodexQA index required:\n%s' % e, file=sys.stderr)
        sys.exit(3)

    try:
        fan_map = file_fan_in_map(repo_abs)
        cqa_summary = summary(repo_abs)
    except CodexQAError as e:
        print('FATAL: CodexQA graph query failed:\n%s' % e, file=sys.stderr)
        sys.exit(3)

    all_code_paths = []
    for root, dirs, names in os.walk(args.repo):
        dirs[:] = [d for d in dirs if d != '.git' and not is_excluded(
            os.path.relpath(os.path.join(root, d), args.repo) + '/', cfg['exclude_paths'])]
        for n in names:
            p = os.path.join(root, n)
            rel = os.path.relpath(p, args.repo).replace(os.sep, '/')
            if n.endswith(tuple(CODE_EXT)) and not is_excluded(rel, cfg['exclude_paths']):
                all_code_paths.append(rel)

    scope_plan_obj = build_scope_plan(repo_abs, cfg=cfg, code_files=all_code_paths, fan_map=fan_map)
    scope_plan = scope_plan_obj.to_dict() if scope_plan_obj else None
    # Empty include_files → None allowlist → do not reject every file
    in_scope_set = scope_allowlist(scope_plan['include_files']) if scope_plan else None

    files = []
    for rel in all_code_paths:
        if in_scope_set is not None and rel not in in_scope_set:
            continue
        p = os.path.join(args.repo, rel)
        try:
            text = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        files.append({'path': rel, 'lines': text.count('\n') + 1,
                      'complexity': len(BRANCH_RE.findall(text)),
                      'fan_in': fan_map.get(rel, 0)})

    if scope_plan:
        print('scope plan: %d/%d files, roots=%s (%.1f%% reduction)' % (
            scope_plan['stats']['in_scope_files'],
            scope_plan['stats']['total_code_files'],
            ','.join(scope_plan.get('include_roots') or []) or '-',
            scope_plan['stats']['reduction_pct']), file=sys.stderr)

    metrics = compute_code_metrics(args.repo, files)

    since = (datetime.datetime.now() - datetime.timedelta(days=90)).strftime('%Y-%m-%d')
    freq, bugdens = {}, {}
    r = git(args.repo, 'log', '--since', since, '--numstat', '--format=COMMIT%x09%H%x09%s')
    cur_msg = ''
    for line in r.stdout.splitlines():
        if line.startswith('COMMIT'):
            cur_msg = line.split('\x09', 2)[-1].lower()
        else:
            parts = line.split('\t')
            if len(parts) == 3:
                p = parts[2]
                freq[p] = freq.get(p, 0) + 1
                if re.search(r'\b(fix|bug|hotfix|patch)\b', cur_msg):
                    bugdens[p] = bugdens.get(p, 0) + 1

    for f in files:
        f['change_freq'] = freq.get(f['path'], 0)
        f['bug_density'] = bugdens.get(f['path'], 0)

    mf = max([f['change_freq'] for f in files] or [0])
    mb = max([f['bug_density'] for f in files] or [0])
    mc = max([f['complexity'] for f in files] or [0])
    mi = max([f['fan_in'] for f in files] or [0])
    for f in files:
        f['hot_score'] = round(100 * (0.4 * norm(f['change_freq'], mf) + 0.3 * norm(f['bug_density'], mb)
                                      + 0.2 * norm(f['complexity'], mc) + 0.1 * norm(f['fan_in'], mi)), 1)

    shards = shard_files(files, cfg.get('max_files_per_shard', 200))
    xedges = cross_module_edges(repo_abs, files)

    sast = run_all_deterministic(args.repo, cfg, files=None, full=True, scope_plan=scope_plan)
    clear, ambiguous = partition_sast_for_llm(sast)

    sast_path = data_dir('baseline', 'sast_%s.json' % stamp)
    os.makedirs(os.path.dirname(sast_path), exist_ok=True)
    json.dump({'generated_at': datetime.datetime.now().isoformat(), 'findings': sast,
               'metrics': metrics},
              open(sast_path, 'w'), ensure_ascii=False, indent=1)

    out = {'scan_type': 'full', 'repo': repo_abs,
           'generated_at': datetime.datetime.now().isoformat(),
           'intent': args.intent or '',
           'rag_intent': resolve_rag_intent(args.intent or ''),
           **graph_engine_meta(lang_info),
           'codexqa_summary': cqa_summary if isinstance(cqa_summary, dict) else {'raw': str(cqa_summary)[:2000]},
           'file_count': len(files), 'files': files, 'shards': shards,
           'hot_files': sorted([f for f in files if f['hot_score'] >= cfg['hot_score_threshold']],
                               key=lambda x: -x['hot_score']),
           'cross_module_edges': xedges,
           'sast_findings': sast, 'sast_clear': clear, 'sast_ambiguous': ambiguous,
           'code_metrics': metrics,
           'tooling_status': {
               'ready': tooling_status.get('ready'),
               'missing': tooling_status.get('missing'),
               'degraded': tooling_status.get('degraded'),
               'repair_attempts': tooling_status.get('repair_attempts'),
               'diagnostics': tooling_status.get('diagnostics', [])[:10],
           },
           'deterministic_first': True,
           'sast_baseline_path': sast_path,
           'scope_plan': scope_plan,
           'stage_telemetry': ['collect_full', 'scope_plan', 'ensure_tools', 'deterministic',
                               'lang_detect', 'codexqa_index', 'codexqa_fan_in',
                               'codexqa_imports', 'metrics']}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(out, open(out_path, 'w'), ensure_ascii=False, indent=1)
    print('full collection: %d files, %d shards, %d hot, %d sast, lang=%s, smells=%s -> %s'
          % (len(files), len(shards), len(out['hot_files']), len(sast),
             out.get('primary_language'), metrics.get('smell_distribution'), out_path))

if __name__ == '__main__':
    main()
