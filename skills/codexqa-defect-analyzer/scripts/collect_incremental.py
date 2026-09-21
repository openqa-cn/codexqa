#!/usr/bin/env python3
"""Incremental collect: git diff text + CodexQA graph + full deterministic stack on changed files."""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import CODE_EXT, diff_hash, git, is_excluded, load_config
from codexqa_client import (CodexQAError, changed_symbols, graph_engine_meta,
                            index_repo, linked_files_for_changes,
                            prepare_polyglot_codexqa, symbol_diff)
from ensure_tools import ensure_scan_tools
from scope_planner import build_scope_plan
from sast_adapters import (compute_code_metrics, expand_sast_scope, metrics_to_findings,
                           partition_sast_for_llm, run_all_deterministic)

def detect_base(repo):
    head = git(repo, 'rev-parse', 'HEAD').stdout.strip()
    for ref in ('origin/main', 'origin/master', 'main', 'master'):
        r = git(repo, 'merge-base', 'HEAD', ref)
        mb = r.stdout.strip()
        if r.returncode == 0 and mb and mb != head:
            return mb
    r = git(repo, 'rev-parse', '--verify', 'HEAD~1')
    return r.stdout.strip() if r.returncode == 0 else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    ap.add_argument('--base', default=None)
    ap.add_argument('--intent', default='')
    ap.add_argument('--language', default=None,
                    help='override primary language (go|java|python|typescript|…)')
    ap.add_argument('-o', '--output', default='/tmp/aid_collect.json')
    args = ap.parse_args()
    cfg = load_config()
    try:
        lang_info = prepare_polyglot_codexqa(
            args.repo, cfg=cfg, caller='collect_incremental',
            language_hint=args.language)
    except CodexQAError as e:
        print('FATAL: CodexQA polyglot mandate:\n%s' % e, file=sys.stderr)
        sys.exit(3)

    base = args.base or detect_base(args.repo)
    if not base:
        print('ERROR: cannot determine base ref; pass --base', file=sys.stderr); sys.exit(2)

    # Pre-scan: install → repair → degrade-and-continue (never abort for missing SAST tools)
    tooling_status = ensure_scan_tools(repo=args.repo, cfg=cfg, full=False)

    try:
        index_repo(os.path.abspath(args.repo), diff_base=base)
    except CodexQAError as e:
        print('FATAL: CodexQA index required for graph/call-chain analysis:\n%s' % e,
              file=sys.stderr)
        sys.exit(3)

    r = git(args.repo, 'diff', '--name-status', base + '...HEAD')
    changed, raw_diffs = [], []
    for line in r.stdout.splitlines():
        parts = line.split('\t')
        if len(parts) < 2:
            continue
        status, path = parts[0], parts[-1]
        if not path.endswith(tuple(CODE_EXT)) or is_excluded(path, cfg['exclude_paths']):
            continue
        d = git(args.repo, 'diff', '-U5', base + '...HEAD', '--', path).stdout
        raw_diffs.append(d)
        full = os.path.join(args.repo, path)
        text = open(full, encoding='utf-8', errors='ignore').read() if os.path.exists(full) else ''
        fns = [s.get('name') for s in changed_symbols(args.repo)
               if (s.get('file') or s.get('path')) == path and s.get('name')]
        changed.append({'path': path, 'status': status, 'diff': d[:20000],
                        'functions': fns[:60],
                        'head_lines': '\n'.join(text.splitlines()[:20])})

    cqa_syms = changed_symbols(args.repo)
    for s in cqa_syms[:30]:
        sid = s.get('id')
        if not sid:
            continue
        try:
            sd = symbol_diff(args.repo, sid, max_lines=cfg.get('max_lines_per_file', 500))
            s['symbol_diff'] = sd
        except CodexQAError:
            pass

    paths = [c['path'] for c in changed]
    try:
        linked = linked_files_for_changes(args.repo, paths, max_linked=15)
    except CodexQAError as e:
        print('FATAL: CodexQA linked-file analysis failed:\n%s' % e, file=sys.stderr)
        sys.exit(3)

    files_for_sast = [c['path'] for c in changed if c['status'] != 'D']
    scope_plan_obj = build_scope_plan(os.path.abspath(args.repo), cfg=cfg)
    scope_plan = scope_plan_obj.to_dict() if scope_plan_obj else None
    if scope_plan:
        include_files = scope_plan.get('include_files') or []
        # Empty allowlist = do not filter (never wipe all changed files).
        if include_files:
            allowed = set(include_files)
            files_for_sast = [p for p in files_for_sast if p in allowed]
            changed = [c for c in changed if c['path'] in allowed or c['status'] == 'D']
        else:
            print('WARN: scope include_files empty — skipping changed_files filter',
                  file=sys.stderr)
    files_for_sast = expand_sast_scope(args.repo, files_for_sast[:50])
    tooling_status = ensure_scan_tools(
        repo=args.repo, cfg=cfg, files=files_for_sast[:50], full=False)
    # Deterministic-first: available OOTB adapters only (missing ones already warned)
    sast = run_all_deterministic(args.repo, cfg, files=files_for_sast[:50], full=False,
                                 scope_plan=scope_plan)
    metrics_files = [{'path': p} for p in files_for_sast if p.endswith(tuple(CODE_EXT))]
    code_metrics = compute_code_metrics(args.repo, metrics_files) if (
        cfg.get('code_metrics_incremental', True) and metrics_files) else None
    if cfg.get('code_metrics_incremental', True) and metrics_files:
        sast += metrics_to_findings(args.repo, metrics_files, code_metrics)
    clear, ambiguous = partition_sast_for_llm(sast)

    dhash = diff_hash('\n'.join(raw_diffs))
    out = {'scan_type': 'incremental', 'repo': os.path.abspath(args.repo),
           'base': base, 'head': 'HEAD', 'intent': args.intent,
           'diff_hash': dhash,
           **graph_engine_meta(lang_info),
           'changed_files': changed,
           'changed_symbols': [{k: s.get(k) for k in
                                ('id', 'name', 'file', 'path', 'kind', 'change_status',
                                 'from_count', 'tested_count')} for s in cqa_syms[:100]],
           'linked_files': linked,
           'sast_findings': sast,
           'sast_clear': clear,
           'sast_ambiguous': ambiguous,
           'code_metrics': code_metrics,
           'tooling_status': {
               'ready': tooling_status.get('ready'),
               'missing': tooling_status.get('missing'),
               'degraded': tooling_status.get('degraded'),
               'repair_attempts': tooling_status.get('repair_attempts'),
               'diagnostics': tooling_status.get('diagnostics', [])[:10],
           },
           'scope_plan': scope_plan,
           'deterministic_first': True,
           'stage_telemetry': ['collect', 'scope_plan', 'ensure_tools', 'deterministic',
                               'lang_detect', 'codexqa_index', 'codexqa_linked']}
    os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
    json.dump(out, open(args.output, 'w'), ensure_ascii=False, indent=1)
    print('collected: %d changed, %d linked(via codexqa), %d sast (%d clear/%d ambiguous), '
          'lang=%s, hash=%s -> %s'
          % (len(changed), len(linked), len(sast), len(clear), len(ambiguous),
             out.get('primary_language'), dhash[:12], args.output))

if __name__ == '__main__':
    main()
