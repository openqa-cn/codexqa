#!/usr/bin/env python3
"""Orchestrator: incremental / full / adhoc / choose / agent-stage2 / finalize.

Judgment LLM default = agent-inline (the model invoking this skill). Optional
--llm-mode api uses LLM_API_KEY; --dry-run uses heuristics (CI smoke).
"""
import argparse, datetime, json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import data_dir, load_config, python_executable, skill_dir
from llm_client import LLMClient, extract_json
from agent_llm import read_json, write_full_handoff, write_incremental_handoff, write_json
from merge_report import write_report_files

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
PY = python_executable()

# Bump when merge/validation/cache semantics change — invalidates stale cache entries.
PIPELINE_VERSION = '1.3.0'


def resolve_llm_mode(args):
    if getattr(args, 'dry_run', False):
        return 'dry-run'
    return getattr(args, 'llm_mode', None) or 'agent'


def run_script(name, *argv):
    r = subprocess.run([PY, os.path.join(SCRIPTS, name), *argv],
                       capture_output=True, text=True)
    sys.stderr.write(r.stderr)
    if r.stdout:
        sys.stderr.write(r.stdout if not r.stdout.endswith('\n') else r.stdout)
    if r.returncode != 0:
        print('FATAL: %s failed: %s' % (name, r.stderr.strip() or r.stdout.strip()),
              file=sys.stderr)
        sys.exit(r.returncode)
    return r.stdout

def run_script_json(name, *argv):
    """Run script; parse last JSON object from stdout."""
    out = run_script(name, *argv)
    text = (out or '').strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.rfind('{')
        if start >= 0:
            return json.loads(text[start:])
        raise

def render(template, **kw):
    t = open(os.path.join(skill_dir(), 'prompts', template)).read()
    base = open(os.path.join(skill_dir(), 'prompts', 'system_base.md')).read()
    cat = open(os.path.join(skill_dir(), 'references', 'category_rules.md')).read()
    sev = open(os.path.join(skill_dir(), 'references', 'severity_levels.md')).read()
    try:
        from policy_loader import pack_meta_for_report, render_policies_for_prompt
        pol = render_policies_for_prompt()
        pack = pack_meta_for_report()
        pol_hdr = '\n\n# Policy pack %s v%s\n' % (
            pack.get('pack_id') or 'default', pack.get('version') or '?')
    except Exception as e:
        pol, pol_hdr = '', '\n\n# Policy pack unavailable: %s\n' % e
    kw.setdefault(
        'SYSTEM_BASE',
        base + '\n\n# Category rules\n' + cat + '\n\n# Severity\n' + sev
        + pol_hdr + pol)
    for k, v in kw.items():
        t = t.replace('{{%s}}' % k, str(v))
    return t

def llm_findings(client, tier, prompt, token_counter):
    raw = client.chat(tier, prompt)
    token_counter[0] += max(1, len(prompt) // 4) + max(1, len(raw or '') // 4)
    data = extract_json(raw)
    if not data:
        return [], 'LLM returned unparseable output'
    if isinstance(data, dict):
        return data.get('findings', []), ''
    return data, ''

def cache_path(diff_hash):
    return data_dir('cache', '%s.json' % diff_hash)


def invalidate_cache(diff_hash=None, all_entries=False):
    """Remove cached report(s). Used by --fresh and `run_scan.py cache clear`."""
    cache_dir = data_dir('cache')
    if not os.path.isdir(cache_dir):
        return 0
    removed = 0
    if all_entries:
        for name in os.listdir(cache_dir):
            if name.endswith('.json'):
                os.remove(os.path.join(cache_dir, name))
                removed += 1
        return removed
    if diff_hash:
        cp = cache_path(diff_hash)
        if os.path.exists(cp):
            os.remove(cp)
            return 1
    return removed


def _cache_reuse_ok(cached, llm_mode, allow_agent_cache=False):
    """Return (ok, reason) — only reuse complete reports at matching pipeline version."""
    if cached.get('pipeline_version') != PIPELINE_VERSION:
        return False, 'pipeline version mismatch (cached=%s current=%s)' % (
            cached.get('pipeline_version'), PIPELINE_VERSION)
    if not cached.get('scan_complete'):
        return False, 'incomplete cached scan'
    if allow_agent_cache:
        return True, ''
    cached_mode = cached.get('llm_mode') or 'dry-run'
    if llm_mode == 'agent':
        return False, 'agent-inline requires Stage1/Stage2/finalize (use --use-cache to override)'
    if cached_mode not in (llm_mode, 'dry-run', 'api'):
        return False, 'llm_mode mismatch (cached=%s requested=%s)' % (cached_mode, llm_mode)
    return True, ''


def try_cache(diff_hash, output_dir, llm_mode='agent', use_cache=True, allow_agent_cache=False):
    cfg = load_config()
    if not use_cache or not cfg.get('cache_enabled', True) or not diff_hash:
        return False
    if llm_mode == 'agent' and not allow_agent_cache:
        print('CACHE SKIP: agent-inline mode always runs Stage1 → Stage2 → finalize '
              '(pass --use-cache to reuse a prior finalized report)', file=sys.stderr)
        return False
    cp = cache_path(diff_hash)
    if not os.path.exists(cp):
        return False
    cached = json.load(open(cp))
    ok, reason = _cache_reuse_ok(cached, llm_mode, allow_agent_cache=allow_agent_cache)
    if not ok:
        print('CACHE MISS: %s' % reason, file=sys.stderr)
        return False
    os.makedirs(output_dir, exist_ok=True)
    for name in ('report_scan.json', 'report_scan.md', 'report_scan.html'):
        if name in cached:
            open(os.path.join(output_dir, name), 'w').write(
                cached[name] if isinstance(cached[name], str)
                else json.dumps(cached[name], ensure_ascii=False, indent=1))
    print('CACHE HIT for diff_hash=%s — reused prior report (zero LLM cost)' % diff_hash[:12],
          file=sys.stderr)
    return True


def save_cache(diff_hash, output_dir, llm_mode='dry-run', write_cache=True):
    cfg = load_config()
    if not write_cache or not cfg.get('cache_enabled', True) or not diff_hash:
        return
    os.makedirs(data_dir('cache'), exist_ok=True)
    jp = os.path.join(output_dir, 'report_scan.json')
    mp = os.path.join(output_dir, 'report_scan.md')
    hp = os.path.join(output_dir, 'report_scan.html')
    if not os.path.exists(jp):
        return
    report = json.load(open(jp))
    payload = {
        'diff_hash': diff_hash,
        'pipeline_version': PIPELINE_VERSION,
        'llm_mode': llm_mode,
        'scan_complete': True,
        'llm_provider': report.get('llm_provider'),
        'report_scan.json': report,
        'report_scan.md': open(mp).read() if os.path.exists(mp) else '',
        'report_scan.html': open(hp).read() if os.path.exists(hp) else '',
        'cached_at': datetime.datetime.now().isoformat(),
    }
    json.dump(payload, open(cache_path(diff_hash), 'w'), ensure_ascii=False)


def cmd_cache(args):
    """Manage diff_hash report cache."""
    if args.cache_clear_all:
        n = invalidate_cache(all_entries=True)
        print('cache cleared: %d entries removed' % n)
        return
    if args.cache_diff_hash:
        n = invalidate_cache(args.cache_diff_hash)
        print('cache cleared: %d entry for diff_hash=%s' % (
            n, args.cache_diff_hash[:12] if n else args.cache_diff_hash[:12]))
        return
    cache_dir = data_dir('cache')
    if not os.path.isdir(cache_dir):
        print('cache empty')
        return
    entries = sorted(f for f in os.listdir(cache_dir) if f.endswith('.json'))
    if not entries:
        print('cache empty')
        return
    print('cache entries (%d):' % len(entries))
    for name in entries[:50]:
        try:
            c = json.load(open(os.path.join(cache_dir, name)))
            print('  %s  v=%s  mode=%s  complete=%s  at=%s' % (
                name[:16], c.get('pipeline_version', '?'), c.get('llm_mode', '?'),
                c.get('scan_complete'), c.get('cached_at', '?')[:19]))
        except Exception:
            print('  %s  (unreadable)' % name[:16])

def ensure_codexqa_for_scan(adhoc=False):
    """Real CodexQA whenever the CLI works; mock only when binary truly unavailable.

    Polyglot: language does not matter — every repo/adhoc path uses CodexQA for graph.
    """
    sys.path.insert(0, SCRIPTS)
    from codexqa_client import (CodexQAError, assert_codexqa_mandate, ensure_codexqa,
                                mock_enabled, reconcile_mock_env, _real_codexqa_ok)
    from lib import load_config
    try:
        assert_codexqa_mandate(load_config(), caller='ensure_codexqa_for_scan')
    except CodexQAError as e:
        print('FATAL: %s' % e, file=sys.stderr)
        sys.exit(3)
    reconcile_mock_env('ensure_codexqa_for_scan')
    if _real_codexqa_ok():
        ensure_codexqa(auto_install=True)
        return
    if mock_enabled():
        print('WARNING: CodexQA mock — CLI unavailable (graph will be synthetic)',
              file=sys.stderr)
        return
    try:
        ensure_codexqa(auto_install=True)
    except CodexQAError as e:
        if adhoc or os.environ.get('AID_ADHOC') == '1':
            print('WARNING: CodexQA unavailable for adhoc scan — enabling mock '
                  '(L1 file context only; no real call-graph).\n%s' % e, file=sys.stderr)
            os.environ['CODEXQA_FORCE_MOCK'] = '1'
            return
        print('FATAL: CodexQA required for all languages:\n%s' % e, file=sys.stderr)
        sys.exit(3)


def _maybe_filter_known(path):
    if os.path.exists(data_dir('vectors.jsonl')) or os.path.exists(data_dir('auto_rules.json')):
        run_script('feedback.py', 'filter-known', path)


def scan_incremental(args, client):
    tmp = args.workdir
    tokens = [0]
    collect_f = os.path.join(tmp, 'collect.json')
    ctx_f = os.path.join(tmp, 'ctx.json')
    run_script('collect_incremental.py', '--repo', args.repo,
               *(['--base', args.base] if args.base else []),
               *(['--intent', args.intent] if args.intent else []),
               *(['--language', args.language] if getattr(args, 'language', None) else []),
               '-o', collect_f)
    collect = json.load(open(collect_f))
    if collect.get('graph_provider') not in (None, 'codexqa'):
        print('FATAL: collect.graph_provider=%r — CodexQA required for all languages'
              % collect.get('graph_provider'), file=sys.stderr)
        sys.exit(3)
    if collect.get('primary_language'):
        print('languages: primary=%s confidence=%s source=%s engine=%s'
              % (collect.get('primary_language'),
                 collect.get('language_confidence') or '?',
                 collect.get('language_source') or '?',
                 collect.get('engine') or 'codexqa'),
              file=sys.stderr)
    dhash = collect.get('diff_hash', '')
    mode = resolve_llm_mode(args)
    use_cache = not getattr(args, 'no_cache', False)
    if getattr(args, 'fresh', False) and dhash:
        invalidate_cache(dhash)
        print('CACHE CLEARED for diff_hash=%s (--fresh)' % dhash[:12], file=sys.stderr)
    if try_cache(dhash, args.output_dir, llm_mode=mode, use_cache=use_cache,
                  allow_agent_cache=getattr(args, 'use_cache', False)):
        return

    run_script('context_builder.py', '-i', collect_f, '--mode', 'incremental', '-o', ctx_f)
    ctx = json.load(open(ctx_f))
    print(ctx.get('budget_note') or 'context level=%s within budget (~%d tokens)'
          % (ctx.get('level'), ctx['est_tokens']))

    p1 = render('agent_detect.md', CONTEXT=ctx['context'])
    mode = resolve_llm_mode(args)
    if mode == 'agent':
        write_incremental_handoff(args.output_dir, collect=collect, ctx=ctx,
                                  stage1_prompt=p1, repo=args.repo)
        return

    f1, warn = llm_findings(client, 'small', p1, tokens)
    if warn:
        print('stage1:', warn)
    s1_f = os.path.join(tmp, 'stage1.json')
    json.dump({'findings': f1}, open(s1_f, 'w'), ensure_ascii=False)
    _maybe_filter_known(s1_f)

    routed_f = os.path.join(tmp, 'routed.json')
    run_script('route_model.py', '-i', s1_f, '-o', routed_f)
    routed = json.load(open(routed_f))['findings']

    final = []
    for tier in ('small', 'large'):
        batch = [f for f in routed if f.get('model_tier', 'small') == tier]
        if not batch:
            continue
        p2 = render('review_filter.md', FINDINGS=json.dumps(batch, ensure_ascii=False, indent=1),
                    CONTEXT=ctx['context'])
        f2, warn = llm_findings(client, tier, p2, tokens)
        if warn:
            print('stage2(%s):' % tier, warn)
        final += f2

    llm_f = os.path.join(tmp, 'llm_final.json')
    json.dump({'findings': final}, open(llm_f, 'w'), ensure_ascii=False)
    _maybe_filter_known(llm_f)

    meta = dict(collect)
    meta['budget_note'] = ctx.get('budget_note', '')
    meta['context_level'] = ctx.get('level', '')
    meta['tokens_used'] = tokens[0]
    meta['files_scanned'] = len(collect.get('changed_files', []))
    meta['target'] = '%s@%s' % (os.path.basename(collect.get('repo', '')), collect.get('head', 'HEAD'))
    meta['deterministic_first'] = True
    meta['llm_provider'] = 'api' if mode == 'api' else 'dry-run'
    meta['sast_clear_count'] = len(collect.get('sast_clear') or [])
    meta['sast_ambiguous_count'] = len(collect.get('sast_ambiguous') or [])
    meta_f = os.path.join(tmp, 'meta.json')
    json.dump(meta, open(meta_f, 'w'))
    sast_f = os.path.join(tmp, 'sast.json')
    json.dump(meta.get('sast_findings', []), open(sast_f, 'w'))
    run_script('merge_report.py', '--sast', sast_f, '--llm', llm_f, '--meta', meta_f,
               '--repo', args.repo, '--tokens-used', str(tokens[0]), '-o', args.output_dir)
    save_cache(dhash, args.output_dir, llm_mode=resolve_llm_mode(args),
               write_cache=not getattr(args, 'no_cache', False))
    run_script('feedback.py', 'record-cost', '--scan-type', 'incremental',
               '--tokens', str(tokens[0]),
               '--findings', str(len(json.load(open(os.path.join(args.output_dir, 'report_scan.json'))).get('findings', []))),
               '--diff-hash', dhash)
    if ctx.get('budget_note'):
        print('NOTE:', ctx['budget_note'])

def _shard_ctx_path(tmp, shard):
    return os.path.join(tmp, 'ctx_%s.json' % shard.replace('/', '_').replace('#', '_'))


def _plan_shard_workload(shard, shard_files, coll, thr):
    from rag_context import file_belongs_to_shard, judgment_focus_paths, norm_repo_path
    hot_in = [f for f in shard_files if f['hot_score'] >= thr]
    amb_src = coll.get('sast_ambiguous')
    if amb_src is None:
        amb_src = [x for x in coll.get('sast_findings', []) if x.get('ambiguous')]
    # Membership, not top-level prefix — apps#hot1 must not inherit apps#hot0 residue.
    amb = [s for s in amb_src if file_belongs_to_shard(
        s.get('file', ''), shard, shard_files=shard_files)]
    focus = judgment_focus_paths(
        shard_files, cross_edges=coll.get('cross_module_edges'), limit=8)
    if len(shard_files) <= 5 and not hot_in:
        hot_in = list(shard_files)
    if not hot_in and not amb and not focus and len(shard_files) > 5:
        print('shard %s: skip LLM (no hot/ambiguous/judgment-focus; deterministic-only)' % shard)
        return None
    deep = [f['path'] for f in hot_in[:20]]
    deep += [norm_repo_path(s.get('file')) for s in amb if s.get('file')]
    deep += focus
    deep = [p for p in dict.fromkeys(deep) if p]
    return {
        'shard': shard,
        'shard_files': shard_files,
        'hot_in': hot_in,
        'amb': amb,
        'deep': deep,
        'focus': focus,
    }


def _ensure_global_rag_cache(coll, coll_f, workloads, cfg):
    cqa = cfg.get('codexqa') or {}
    if cqa.get('rag_cache_enabled') is False:
        return coll
    from rag_context import build_rag_cache_for_workloads, resolve_rag_intent
    rag_intent = coll.get('rag_intent') or resolve_rag_intent(coll.get('intent') or '')
    workers = max(1, int(cqa.get('rag_max_workers') or 1))
    per_shard = int(cqa.get('rag_shard_max_items') or 8)
    cache, by_shard, seeds = build_rag_cache_for_workloads(
        coll['repo'], workloads,
        intent=rag_intent,
        max_per_shard=per_shard,
        max_workers=workers)
    coll = dict(coll)
    coll['rag_intent'] = rag_intent
    coll['codexqa_config'] = dict(coll.get('codexqa_config') or {})
    coll['codexqa_config']['rag_shard_max_items'] = per_shard
    if cache:
        coll['rag_cache'] = cache
        coll['rag_cache_by_shard'] = by_shard
        coll['rag_cache_seeds'] = seeds
        print('RAG cache: %d snippets from %d seeds (%d shards, intent=%s)' % (
            len(cache), len(seeds), len(by_shard), rag_intent[:60]), file=sys.stderr)
    else:
        coll.pop('rag_cache', None)
        coll.pop('rag_cache_by_shard', None)
        print('RAG cache: empty (CodexQA unavailable); per-shard live RAG fallback', file=sys.stderr)
    json.dump(coll, open(coll_f, 'w'), ensure_ascii=False, indent=1)
    return coll


def _build_shard_context(coll_f, shard, deep, tmp):
    ctx_f = _shard_ctx_path(tmp, shard)
    run_script('context_builder.py', '-i', coll_f, '--mode', 'full', '--rag',
               '--shard', shard, '--deep-files', ','.join(deep), '-o', ctx_f)
    return shard, json.load(open(ctx_f))


def _build_shard_contexts_parallel(coll_f, workloads, tmp, max_workers=1):
    if max_workers <= 1 or len(workloads) <= 1:
        out = {}
        for w in workloads:
            shard, ctx = _build_shard_context(coll_f, w['shard'], w['deep'], tmp)
            out[shard] = ctx
        return out
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {
            pool.submit(_build_shard_context, coll_f, w['shard'], w['deep'], tmp): w['shard']
            for w in workloads
        }
        for fut in as_completed(futs):
            shard, ctx = fut.result()
            out[shard] = ctx
    return out


def scan_full(args, client):
    tmp = args.workdir
    tokens = [0]
    coll_f = os.path.join(tmp, 'collection.json')
    run_script('collect_full.py', '--repo', args.repo,
               *(['--intent', args.intent] if args.intent else []),
               *(['--language', args.language] if getattr(args, 'language', None) else []),
               '-o', coll_f)
    coll = json.load(open(coll_f))
    if coll.get('graph_provider') not in (None, 'codexqa'):
        print('FATAL: collect.graph_provider=%r — CodexQA required for all languages'
              % coll.get('graph_provider'), file=sys.stderr)
        sys.exit(3)
    if coll.get('primary_language'):
        print('languages: primary=%s confidence=%s source=%s files=%s'
              % (coll.get('primary_language'),
                 coll.get('language_confidence') or '?',
                 coll.get('language_source') or '?',
                 coll.get('file_count')), file=sys.stderr)
    from rag_context import resolve_rag_intent
    if args.intent and not (coll.get('intent') or '').strip():
        coll['intent'] = args.intent
    coll['rag_intent'] = resolve_rag_intent(coll.get('intent') or args.intent or '')
    json.dump(coll, open(coll_f, 'w'), ensure_ascii=False, indent=1)
    cfg = load_config()
    all_llm, module_summaries = [], []
    thr = cfg.get('hot_score_threshold', 70)
    mode = resolve_llm_mode(args)
    agent_jobs = []
    cqa = cfg.get('codexqa') or {}
    rag_workers = max(1, int(cqa.get('rag_max_workers') or 1))

    workloads = []
    for shard, shard_files in coll['shards'].items():
        w = _plan_shard_workload(shard, shard_files, coll, thr)
        if w:
            workloads.append(w)

    if workloads:
        coll = _ensure_global_rag_cache(coll, coll_f, workloads, cfg)

    if mode == 'agent':
        agent_wl = [w for w in workloads if w['deep'] or w['amb']]
        context_map = _build_shard_contexts_parallel(coll_f, agent_wl, tmp, rag_workers)
        for w in agent_wl:
            shard, deep, amb = w['shard'], w['deep'], w['amb']
            ctx = context_map.get(shard)
            if not ctx:
                continue
            p1 = render('agent_detect.md', CONTEXT=ctx['context'])
            agent_jobs.append({
                'id': shard, 'stage1_prompt': p1, 'ctx': ctx, 'deep_files': deep,
            })
            module_summaries.append({
                'module': shard,
                'summary': 'agent-inline: deep on %d files' % len(deep),
                'deep_review_files': deep[:20],
                'architecture_concerns': [],
            })
    else:
        context_jobs = []
        for w in workloads:
            shard, shard_files, hot_in, amb = w['shard'], w['shard_files'], w['hot_in'], w['amb']
            files_brief = [{'path': f['path'], 'lines': f['lines'], 'hot_score': f['hot_score'],
                            'duplication_rate': f.get('duplication_rate', 0)}
                           for f in sorted(shard_files, key=lambda x: -x['hot_score'])[:80]]
            sast_brief = amb[:40]
            metrics_brief = coll.get('code_metrics') or {}
            psum = render('full_scan_summary.md', MODULE=shard,
                          FILES=json.dumps(files_brief, ensure_ascii=False),
                          SAST=json.dumps(sast_brief, ensure_ascii=False),
                          METRICS=json.dumps(metrics_brief, ensure_ascii=False))
            raw = client.chat('small', psum)
            tokens[0] += max(1, len(psum) // 4) + max(1, len(raw or '') // 4)
            summary_obj = extract_json(raw) or {}
            if isinstance(summary_obj, dict):
                summary_obj['module'] = shard
                module_summaries.append(summary_obj)
            deep = list(summary_obj.get('deep_review_files', []) if isinstance(summary_obj, dict) else [])
            deep += [f['path'] for f in hot_in[:20]]
            deep += [s['file'] for s in amb if s.get('file')]
            deep = list(dict.fromkeys(deep))
            w['deep'] = deep
            if not deep and not amb:
                continue
            context_jobs.append(w)

        context_map = _build_shard_contexts_parallel(coll_f, context_jobs, tmp, rag_workers)
        for w in context_jobs:
            shard, ctx = w['shard'], context_map[w['shard']]
            p1 = render('agent_detect.md', CONTEXT=ctx['context'])
            f1, warn = llm_findings(client, 'small', p1, tokens)
            if warn:
                print('shard %s stage1:' % shard, warn)
            if not f1:
                continue
            s1 = os.path.join(tmp, 's1_%s.json' % shard.replace('/', '_').replace('#', '_'))
            json.dump({'findings': f1}, open(s1, 'w'), ensure_ascii=False)
            _maybe_filter_known(s1)
            routed = os.path.join(tmp, 'routed_%s.json' % shard.replace('/', '_').replace('#', '_'))
            run_script('route_model.py', '-i', s1, '-o', routed)
            batch = json.load(open(routed))['findings']
            use_large = any(b.get('model_tier') == 'large' or b.get('severity') in ('P0', 'P1')
                            for b in batch)
            p2 = render('review_filter.md', FINDINGS=json.dumps(batch, ensure_ascii=False, indent=1),
                        CONTEXT=ctx['context'])
            f2, warn = llm_findings(client, 'large' if use_large else 'small', p2, tokens)
            if warn:
                print('shard %s stage2:' % shard, warn)
            all_llm += f2

    if mode == 'agent':
        write_full_handoff(args.output_dir, coll=coll, shard_jobs=agent_jobs, repo=args.repo)
        write_json(os.path.join(args.output_dir, 'agent_llm', 'module_summaries.json'),
                   module_summaries)
        return

    llm_f = os.path.join(tmp, 'llm_final.json')
    json.dump({'findings': all_llm}, open(llm_f, 'w'), ensure_ascii=False)
    _maybe_filter_known(llm_f)

    ms_f = os.path.join(tmp, 'module_summaries.json')
    json.dump(module_summaries, open(ms_f, 'w'), ensure_ascii=False)
    hm_f = os.path.join(tmp, 'heat_map.json')
    json.dump(coll.get('hot_files', [])[:50], open(hm_f, 'w'), ensure_ascii=False)

    meta = {'scan_type': 'full', 'repo': coll['repo'],
            'head': coll.get('generated_at'), 'target': coll['repo'] + '@full',
            'files_scanned': coll.get('file_count', 0), 'tokens_used': tokens[0],
            'deterministic_first': True,
            'code_metrics': coll.get('code_metrics'),
            'tooling_status': coll.get('tooling_status') or {},
            'llm_provider': 'api' if mode == 'api' else 'dry-run',
            'sast_clear_count': len(coll.get('sast_clear') or []),
            'sast_ambiguous_count': len(coll.get('sast_ambiguous') or [])}
    meta_f = os.path.join(tmp, 'meta.json'); json.dump(meta, open(meta_f, 'w'))
    sast_f = os.path.join(tmp, 'sast.json')
    json.dump(coll.get('sast_findings', []), open(sast_f, 'w'))
    run_script('merge_report.py', '--sast', sast_f, '--llm', llm_f, '--meta', meta_f,
               '--repo', args.repo, '--module-summaries', ms_f, '--heat-map', hm_f,
               '--tokens-used', str(tokens[0]), '-o', args.output_dir)

    report = json.load(open(os.path.join(args.output_dir, 'report_scan.json')))
    snap = data_dir('baseline', 'snapshot_%s.json' % datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))
    os.makedirs(os.path.dirname(snap), exist_ok=True)
    json.dump({'generated_at': coll['generated_at'], 'summary': report['summary'],
               'hot_files': coll.get('hot_files', [])[:50],
               'findings': [{'title': f.get('title'), 'severity': f.get('severity'),
                             'file': f.get('file')} for f in report.get('findings', [])],
               'module_summaries': module_summaries,
               'delta': report.get('delta')}, open(snap, 'w'), ensure_ascii=False, indent=1)
    print('baseline snapshot saved -> %s' % snap)
    if report.get('delta'):
        print('baseline delta:', json.dumps(report['delta'], ensure_ascii=False))
    run_script('feedback.py', 'record-cost', '--scan-type', 'full',
               '--tokens', str(tokens[0]), '--findings', str(len(report.get('findings', []))))


def cmd_agent_stage2(args):
    """Route Stage1 findings and render Stage2 prompt(s) for the agent model."""
    b = os.path.abspath(args.agent_dir)
    man = read_json(os.path.join(b, 'MANIFEST.json'))
    if not man:
        print('FATAL: missing MANIFEST.json in %s' % b, file=sys.stderr)
        sys.exit(2)
    if man.get('scan_type') == 'incremental':
        s1_path = os.path.join(b, 'stage1.json')
        s1 = read_json(s1_path)
        if not s1 or 'findings' not in s1:
            print('FATAL: write stage1.json {"findings":[...]} first', file=sys.stderr)
            sys.exit(2)
        _maybe_filter_known(s1_path)
        routed_f = os.path.join(b, 'routed.json')
        run_script('route_model.py', '-i', s1_path, '-o', routed_f)
        routed = json.load(open(routed_f))['findings']
        ctx = read_json(os.path.join(b, 'ctx.json'), {})
        p2 = render('review_filter.md',
                    FINDINGS=json.dumps(routed, ensure_ascii=False, indent=1),
                    CONTEXT=(ctx or {}).get('context', ''))
        open(os.path.join(b, 'stage2_prompt.md'), 'w').write(p2)
        print('AGENT_LLM_STAGE2 ready: %s/stage2_prompt.md (%d suspects)'
              % (b, len(routed)), file=sys.stderr)
        return

    shards = man.get('shards') or []
    n = 0
    for sh in shards:
        sd = os.path.join(b, sh['dir'])
        s1_path = os.path.join(sd, 'stage1.json')
        s1 = read_json(s1_path)
        if not s1:
            print('WARN: skip shard %s — missing stage1.json' % sh['id'], file=sys.stderr)
            continue
        _maybe_filter_known(s1_path)
        routed_f = os.path.join(sd, 'routed.json')
        run_script('route_model.py', '-i', s1_path, '-o', routed_f)
        routed = json.load(open(routed_f))['findings']
        ctx = read_json(os.path.join(sd, 'ctx.json'), {})
        p2 = render('review_filter.md',
                    FINDINGS=json.dumps(routed, ensure_ascii=False, indent=1),
                    CONTEXT=(ctx or {}).get('context', ''))
        open(os.path.join(sd, 'stage2_prompt.md'), 'w').write(p2)
        n += 1
    print('AGENT_LLM_STAGE2 ready: %d shard stage2 prompts in %s' % (n, b), file=sys.stderr)


def cmd_finalize(args):
    """Merge SAST + agent llm_final into report_scan.*"""
    b = os.path.abspath(args.agent_dir)
    man = read_json(os.path.join(b, 'MANIFEST.json'))
    if not man:
        print('FATAL: missing MANIFEST.json', file=sys.stderr)
        sys.exit(2)
    meta = read_json(os.path.join(b, 'meta.json'), {})
    sast_f = os.path.join(b, 'sast.json')
    out = args.output_dir
    os.makedirs(out, exist_ok=True)

    if man.get('scan_type') == 'incremental':
        llm_f = os.path.join(b, 'llm_final.json')
        if not os.path.exists(llm_f):
            print('FATAL: missing llm_final.json — complete Stage2 first', file=sys.stderr)
            sys.exit(2)
        _maybe_filter_known(llm_f)
        meta['tokens_used'] = meta.get('tokens_used') or 0
        meta['llm_provider'] = 'agent_inline'
        meta_f = os.path.join(b, 'meta.json')
        write_json(meta_f, meta)
        run_script('merge_report.py', '--sast', sast_f, '--llm', llm_f, '--meta', meta_f,
                   '--repo', meta.get('repo') or args.repo or '.',
                   '--tokens-used', str(meta.get('tokens_used') or 0), '-o', out)
        dhash = meta.get('diff_hash', '')
        if dhash:
            save_cache(dhash, out, llm_mode='agent',
                       write_cache=not getattr(args, 'no_cache', False))
    else:
        all_llm = []
        all_dismissals = []
        for sh in man.get('shards') or []:
            sd = os.path.join(b, sh['dir'])
            s2 = read_json(os.path.join(sd, 'stage2.json')) or read_json(os.path.join(sd, 'llm_final.json'))
            if s2 and isinstance(s2.get('findings'), list):
                all_llm += s2['findings']
                for d in s2.get('dismissals') or []:
                    if isinstance(d, dict):
                        all_dismissals.append(d)
            elif os.path.exists(os.path.join(sd, 'stage1.json')) and not s2:
                print('WARN: shard %s has stage1 but no stage2.json' % sh['id'], file=sys.stderr)
        llm_f = os.path.join(b, 'llm_final.json')
        payload = {'findings': all_llm}
        if all_dismissals:
            payload['dismissals'] = all_dismissals
        write_json(llm_f, payload)
        _maybe_filter_known(llm_f)
        meta['llm_provider'] = 'agent_inline'
        meta_f = os.path.join(b, 'meta.json')
        write_json(meta_f, meta)
        ms = os.path.join(b, 'module_summaries.json')
        hm = os.path.join(b, 'heat_map.json')
        merge_args = ['--sast', sast_f, '--llm', llm_f, '--meta', meta_f,
                      '--repo', meta.get('repo') or args.repo or '.',
                      '--tokens-used', '0', '-o', out]
        if os.path.exists(ms):
            merge_args += ['--module-summaries', ms]
        if os.path.exists(hm):
            merge_args += ['--heat-map', hm]
        run_script('merge_report.py', *merge_args)

    adhoc = read_json(os.path.join(b, 'adhoc.json'))
    jp = os.path.join(out, 'report_scan.json')
    if os.path.exists(jp):
        report = json.load(open(jp))
        if adhoc:
            report['adhoc'] = adhoc
        report['llm_provider'] = 'agent_inline'
        ts = meta.get('tooling_status')
        if ts and not report.get('tooling_status'):
            report['tooling_status'] = ts
        write_report_files(report, out)

    print('finalize OK -> %s' % out)
    print('done. reports in %s' % out)


def scan_adhoc(args, client):
    """Upload / paste code → temp workspace → incremental or full pipeline."""
    os.environ['AID_ADHOC'] = '1'
    ensure_codexqa_for_scan(adhoc=True)

    ingest_args = []
    if args.files:
        ingest_args += ['--files', *args.files]
    if getattr(args, 'keep_tree', False):
        ingest_args += ['--keep-tree']
    if args.from_dir:
        ingest_args += ['--from-dir', args.from_dir]
    if args.paste_file:
        ingest_args += ['--paste-file', args.paste_file]
    if args.manifest:
        ingest_args += ['--manifest', args.manifest]
    if args.as_name:
        ingest_args += ['--as', args.as_name]
    if args.lang:
        ingest_args += ['--lang', args.lang]
    if args.intent:
        ingest_args += ['--intent', args.intent]
    if args.workspace:
        ingest_args += ['-o', args.workspace]

    if args.stdin_paste:
        cmd = [PY, os.path.join(SCRIPTS, 'ingest_adhoc.py'),
               *ingest_args, '--stdin']
        r = subprocess.run(cmd, capture_output=True, text=True, input=sys.stdin.read())
        sys.stderr.write(r.stderr or '')
        if r.returncode != 0:
            print('FATAL: ingest failed: %s' % (r.stderr or r.stdout), file=sys.stderr)
            sys.exit(r.returncode)
        meta = json.loads(r.stdout)
    else:
        if not ingest_args and not args.files:
            print('FATAL: adhoc requires --files / --from-dir / --paste-file / --manifest / --stdin-paste',
                  file=sys.stderr)
            sys.exit(2)
        meta = run_script_json('ingest_adhoc.py', *ingest_args)

    ws = meta['workspace']
    base = meta['base']
    print('adhoc workspace=%s files=%s scan_mode=%s' % (
        ws, meta.get('files'), args.scan_mode), file=sys.stderr)

    args.repo = ws
    args.base = base if args.scan_mode == 'incremental' else None
    args.intent = args.intent or meta.get('intent') or 'adhoc defect scan'
    if args.scan_mode == 'full':
        scan_full(args, client)
    else:
        scan_incremental(args, client)

    adhoc_info = {
        'workspace': ws,
        'files': meta.get('files'),
        'scan_mode': args.scan_mode,
        'source': 'upload_or_paste',
    }
    bundle = os.path.join(args.output_dir, 'agent_llm')
    if resolve_llm_mode(args) == 'agent' and os.path.exists(os.path.join(bundle, 'MANIFEST.json')):
        write_json(os.path.join(bundle, 'adhoc.json'), adhoc_info)
        return

    jp = os.path.join(args.output_dir, 'report_scan.json')
    if os.path.exists(jp):
        report = json.load(open(jp))
        report['adhoc'] = adhoc_info
        write_report_files(report, args.output_dir)

def scan_choose(args, client):
    """Interactive or inferred scenario → dispatch."""
    choose_argv = []
    if args.scenario:
        choose_argv += ['--scenario', args.scenario]
    elif args.infer:
        choose_argv += ['--infer', args.infer]
    elif args.ask or sys.stdin.isatty():
        choose_argv += ['--ask']

    r = subprocess.run([PY, os.path.join(SCRIPTS, 'choose_scenario.py'), *choose_argv],
                       capture_output=True, text=True)
    sys.stderr.write(r.stderr or '')
    if r.returncode == 2:
        sys.stdout.write(r.stdout or '')
        print('\n请回复场景 id（repo-incremental / repo-full / upload-incremental / '
              'upload-full / paste）后继续。', file=sys.stderr)
        sys.exit(2)
    if r.returncode != 0:
        print('FATAL: choose_scenario failed: %s' % (r.stderr or r.stdout), file=sys.stderr)
        sys.exit(r.returncode)
    choice = json.loads(r.stdout)
    print('chosen scenario: %s (%s)' % (choice['chosen'], choice['label']), file=sys.stderr)

    src = choice['source']
    mode = choice['mode']
    if src == 'repo':
        ensure_codexqa_for_scan(adhoc=False)
        if mode == 'full':
            scan_full(args, client)
        else:
            scan_incremental(args, client)
    else:
        if not (args.files or args.from_dir or args.paste_file or args.manifest or args.stdin_paste):
            print(json.dumps({
                'need_input': True,
                'chosen': choice['chosen'],
                'message': '已选择「%s」。请提供代码：上传文件(--files)、目录(--from-dir)、'
                           '粘贴文件(--paste-file)，或由 agent 将对话中的代码写入临时文件后重跑。'
                           % choice['label'],
            }, ensure_ascii=False, indent=2))
            sys.exit(2)
        if choice['chosen'] == 'upload-full':
            args.scan_mode = 'full'
        else:
            args.scan_mode = args.scan_mode or 'incremental'
        scan_adhoc(args, client)


def make_llm_client(args):
    """API / dry-run client only. Agent mode returns None."""
    mode = resolve_llm_mode(args)
    if mode == 'agent':
        print('NOTE: llm-mode=agent — judgment uses the invoking agent model '
              '(no LLM_API_KEY). Complete handoff → agent-stage2 → finalize.',
              file=sys.stderr)
        return None
    if mode == 'dry-run':
        print('NOTE: --dry-run / llm-mode=dry-run → heuristic mock reviewer', file=sys.stderr)
        return LLMClient(dry_run=True)
    has_creds = bool(os.environ.get('LLM_API_KEY', '').strip()
                     and os.environ.get('LLM_BASE_URL', '').strip())
    if not has_creds:
        print('FATAL: --llm-mode api requires LLM_API_KEY and LLM_BASE_URL. '
              'Default agent mode needs no key. See references/llm-api.md.',
              file=sys.stderr)
        sys.exit(2)
    return LLMClient(dry_run=False)


def main():
    ap = argparse.ArgumentParser(
        description='defect-detection orchestrator (repo / upload / paste / agent-llm)')
    ap.add_argument('mode', choices=['incremental', 'full', 'adhoc', 'choose',
                                     'agent-stage2', 'finalize', 'cache'])
    ap.add_argument('--repo', default='.')
    ap.add_argument('--base', default=None)
    ap.add_argument('--intent', default='')
    ap.add_argument('--llm-mode', choices=['agent', 'api', 'dry-run'], default='agent',
                    help='judgment backend: agent (default, no API key) | api | dry-run')
    ap.add_argument('--dry-run', action='store_true',
                    help='alias for --llm-mode dry-run (CI advisory)')
    ap.add_argument('--allow-mock-llm', action='store_true',
                    help='deprecated; use --llm-mode dry-run')
    ap.add_argument('--agent-dir', default=None,
                    help='agent_llm bundle dir for agent-stage2 / finalize')
    ap.add_argument('-o', '--output-dir', default='/tmp/aid_report')
    ap.add_argument('--fresh', action='store_true',
                    help='clear diff_hash cache before scan (recommended for full rescan / adhoc retest)')
    ap.add_argument('--no-cache', action='store_true',
                    help='disable cache read and write for this run')
    ap.add_argument('--use-cache', action='store_true',
                    help='allow cache hit even in agent mode (reuse prior finalized report only)')
    ap.add_argument('--cache-clear-all', action='store_true',
                    help='with mode=cache: remove all cached reports')
    ap.add_argument('--cache-diff-hash', default=None,
                    help='with mode=cache: remove one cache entry by diff_hash')

    ap.add_argument('--scan-mode', choices=['incremental', 'full'], default='incremental',
                    help='for adhoc: incremental (default) or full')
    ap.add_argument('--files', nargs='*', default=[], help='uploaded file paths')
    ap.add_argument('--keep-tree', action='store_true',
                    help='adhoc --files: preserve paths relative to cwd')
    ap.add_argument('--from-dir', default=None, help='uploaded directory')
    ap.add_argument('--paste-file', default=None, help='path to pasted source file')
    ap.add_argument('--stdin-paste', action='store_true', help='read paste from stdin')
    ap.add_argument('--manifest', default=None, help='JSON [{path,content}] or @file')
    ap.add_argument('--as', dest='as_name', default=None, help='filename for paste')
    ap.add_argument('--lang', default=None, help='language hint for paste / primary override')
    ap.add_argument('--language', default=None,
                    help='override repo primary language (same as --lang for repo scans)')
    ap.add_argument('--workspace', default=None, help='adhoc workspace output dir')

    ap.add_argument('--scenario', default=None,
                    choices=['repo-incremental', 'repo-full', 'upload-incremental',
                             'upload-full', 'paste'])
    ap.add_argument('--infer', default=None, help='infer scenario from user utterance')
    ap.add_argument('--ask', action='store_true', help='force interactive menu')

    args = ap.parse_args()
    if args.allow_mock_llm and args.llm_mode == 'agent':
        args.llm_mode = 'dry-run'
    # Coalesce primary-language override (--language preferred; --lang also works for repo)
    args.language = getattr(args, 'language', None) or getattr(args, 'lang', None) or None
    args.workdir = tempfile.mkdtemp(prefix='aid_')
    os.makedirs(data_dir(), exist_ok=True)

    if args.mode == 'cache':
        cmd_cache(args)
        return
    if args.mode == 'agent-stage2':
        if not args.agent_dir:
            args.agent_dir = os.path.join(args.output_dir, 'agent_llm')
        cmd_agent_stage2(args)
        return
    if args.mode == 'finalize':
        if not args.agent_dir:
            args.agent_dir = os.path.join(args.output_dir, 'agent_llm')
        cmd_finalize(args)
        return

    client = make_llm_client(args)

    if args.mode in ('incremental', 'full'):
        ensure_codexqa_for_scan(adhoc=False)
        {'incremental': scan_incremental, 'full': scan_full}[args.mode](args, client)
    elif args.mode == 'adhoc':
        scan_adhoc(args, client)
    else:
        scan_choose(args, client)

    if resolve_llm_mode(args) != 'agent':
        print('done. reports in %s' % args.output_dir)
    elif not os.path.exists(os.path.join(args.output_dir, 'agent_llm', 'MANIFEST.json')):
        print('done. reports in %s' % args.output_dir)

if __name__ == '__main__':
    main()
