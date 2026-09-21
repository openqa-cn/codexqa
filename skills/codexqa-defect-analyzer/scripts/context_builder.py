#!/usr/bin/env python3
"""Assemble LLM context. L2/L3 cross-file context MUST come from CodexQA graph results."""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import count_tokens, load_config, truncate_lines
from codexqa_client import CodexQAError, rag_related_snippets
from rag_context import (JUDGMENT_RAG_TERMS, file_belongs_to_shard,
                         filter_rag_cache_for_shard, rag_seed_paths,
                         resolve_rag_intent)

def _cap(text, max_lines):
    body, _ = truncate_lines(text or '', max_lines)
    return body

def build_incremental(collect, cfg):
    max_lines = cfg.get('max_lines_per_file', 500)
    budget = cfg['incremental_token_budget']
    level = 'L1'
    blocks = []

    primary = collect.get('primary_language') or 'unknown'
    lang_hdr = ('## Repo primary language: %s (confidence=%s, source=%s, verified=%s)\n\n'
                % (primary,
                   collect.get('language_confidence') or 'unknown',
                   collect.get('language_source') or 'unknown',
                   collect.get('language_verified')))
    blocks.append(('L1', '_lang', lang_hdr))

    for c in collect['changed_files']:
        head = c.get('head_lines') or ''
        body = _cap(c.get('diff') or '', max_lines)
        b = '### FILE: %s (status=%s, funcs=%s)\n## head(20)\n%s\n## diff\n%s\n' % (
            c['path'], c['status'], ','.join(c.get('functions') or [])[:20], head, body)
        blocks.append(('L1', c['path'], b))

    # L2: CodexQA-linked caller/callee signatures (already resolved in collect)
    for l in collect.get('linked_files', []):
        if not str(l.get('via', '')).startswith('codexqa'):
            # refuse homemade linked files — graph must be CodexQA
            continue
        b = '### LINKED FILE: %s (via=%s, funcs=%s)\n%s\n' % (
            l['path'], l.get('via', 'codexqa'), ','.join(l.get('functions') or []),
            _cap(l.get('signature_view', ''), max_lines)[:4000])
        blocks.append(('L2', l['path'], b))

    intent = (collect.get('intent') or '').lower()
    blob = intent + ' ' + ' '.join(c.get('diff', '')[:2000] for c in collect['changed_files'])
    need_l3 = any(k in blob for k in (
        'concurr', 'lock', 'transaction', 'atomic', 'race', 'auth', 'permission',
        'deadlock', 'mutex', 'async', 'parallel'))
    if len(collect.get('linked_files', [])) >= 5:
        need_l3 = True

    if need_l3:
        level = 'L3'
        # L3 RAG: CodexQA related code snippets (source / snippet / search) — never local walk
        try:
            rag = rag_related_snippets(
                collect['repo'],
                [c['path'] for c in collect['changed_files']],
                intent=resolve_rag_intent(collect.get('intent') or ''),
                max_items=8)
        except CodexQAError as e:
            rag = []
            note_rag = 'CodexQA L3 RAG unavailable: %s' % e
        else:
            note_rag = ''
        for item in rag:
            snip = item.get('snippet') or item.get('summary') or ''
            b = (
                '### RAG RELATED SNIPPET: %s (via=%s, relation=%s, symbol=%s)\n'
                '```\n%s\n```\n' % (
                    item.get('path', ''),
                    item.get('via', 'codexqa'),
                    item.get('relation', ''),
                    item.get('name', ''),
                    _cap(snip, max_lines)[:3500]))
            blocks.append(('L3', item.get('path', 'rag'), b))
    else:
        note_rag = ''
        if collect.get('linked_files'):
            level = 'L2'

    order = {'L1': 0, 'L2': 1, 'L3': 2}
    blocks.sort(key=lambda x: order[x[0]])
    kept, dropped, est = [], [], 0
    for lvl, path, b in blocks:
        t = count_tokens(b)
        if est + t <= budget:
            kept.append(b); est += t
        else:
            dropped.append((lvl, path))

    note = note_rag
    if dropped:
        note = ((note + ' ') if note else '') + (
            'TOKEN BUDGET %d exceeded at level %s; dropped %d blocks %s.'
            % (budget, level, len(dropped), [d[1] for d in dropped]))

    ctx = '## Change intent\n%s\n\n' % (collect.get('intent') or '(none)')
    ctx += '## Context level: %s (graph_provider=%s)\n\n' % (
        level, collect.get('graph_provider', 'codexqa'))
    clear = collect.get('sast_clear')
    amb = collect.get('sast_ambiguous')
    if clear is None and amb is None:
        from sast_adapters import partition_sast_for_llm
        clear, amb = partition_sast_for_llm(collect.get('sast_findings', []))
    ctx += (
        '## Deterministic-first policy\n'
        'Clear SAST/lint/secrets/SCA findings are ALREADY decided — do NOT rediscover them.\n'
        'LLM focuses on judgment categories: concurrency, transaction, logic, architecture, '
        'security_design; plus ambiguous SAST residue only.\n\n'
        '### Clear deterministic findings (skip rediscovery)\n%s\n\n'
        '### Ambiguous SAST residue (LLM may interpret/grade)\n%s\n\n'
        % (json.dumps(clear[:80], ensure_ascii=False)[:4000],
           json.dumps(amb[:40], ensure_ascii=False)[:3000]))
    if collect.get('code_metrics'):
        ctx += '### Code metrics (complexity/duplication/smells)\n%s\n\n' % json.dumps(
            collect['code_metrics'], ensure_ascii=False)[:2000]
    if collect.get('changed_symbols'):
        ctx += '## CodexQA changed symbols\n%s\n\n' % json.dumps(
            collect['changed_symbols'][:40], ensure_ascii=False)[:3000]
    ctx += ''.join(kept)
    return ctx, est, note, dropped, level

def build_full(collection, cfg, shard=None, deep_files=None):
    files = collection['shards'].get(shard, []) if shard else collection['files']
    hot_set = {f['path'] for f in collection.get('hot_files', [])}
    deep = set(deep_files or [])
    thr = cfg.get('hot_score_threshold', 70)
    budget = cfg['full_token_budget']
    max_lines = cfg.get('max_lines_per_file', 500)

    targets = [f for f in files if f['path'] in deep or f['hot_score'] >= thr or f['path'] in hot_set]
    if not targets:
        targets = sorted(files, key=lambda x: -x['hot_score'])[:10]

    blocks, est = [], 0
    rag_intent = collection.get('rag_intent') or resolve_rag_intent(collection.get('intent') or '')
    meta = (
        '## Repo primary language: %s (confidence=%s, source=%s)\n'
        '## Change intent\n%s\n'
        '## Judgment / RAG focus\n%s\n'
        '## Module: %s\n## File metrics (fan_in from CodexQA)\n' % (
            collection.get('primary_language') or 'unknown',
            collection.get('language_confidence') or 'unknown',
            collection.get('language_source') or 'unknown',
            collection.get('intent') or '(none)',
            rag_intent,
            shard or '(whole repo)'))
    for f in sorted(files, key=lambda x: -x['hot_score']):
        meta += '%s\tlines=%d\tcomplexity=%d\tfreq=%d\tbugs=%d\tfan_in=%d\thot=%.1f%s\n' % (
            f['path'], f['lines'], f['complexity'], f['change_freq'],
            f['bug_density'], f['fan_in'], f['hot_score'],
            '  <-- HOT' if f['path'] in hot_set else '')
    blocks.append(meta); est += count_tokens(meta)

    for f in targets:
        path = f['path']
        # Prefer CodexQA file card already in collection; no local signature parsing for graph
        view = ''
        for edge_pack in collection.get('cross_module_edges', []):
            if edge_pack.get('file') == path:
                view += 'foreign_deps=%s\n' % edge_pack.get('foreign_deps')
        full = os.path.join(collection['repo'], path)
        if os.path.exists(full):
            raw = open(full, encoding='utf-8', errors='ignore').read()
            capped, _ = truncate_lines(raw, max_lines)
            view += capped[:6000]
        b = '### HOT/DEEP FILE: %s (hot=%.1f)\n%s\n' % (path, f['hot_score'], view)
        t = count_tokens(b)
        if est + t <= budget:
            blocks.append(b); est += t
        else:
            break

    sast = [s for s in collection.get('sast_findings', [])
            if (not shard or file_belongs_to_shard(s.get('file', ''), shard, shard_files=files))]
    amb = collection.get('sast_ambiguous')
    if amb is None:
        amb = [s for s in sast if s.get('ambiguous')]
    else:
        amb = [s for s in amb if (not shard or file_belongs_to_shard(
            s.get('file', ''), shard, shard_files=files))]
    clear = collection.get('sast_clear') or [s for s in sast if not s.get('ambiguous')]
    if shard:
        clear = [s for s in clear if file_belongs_to_shard(
            s.get('file', ''), shard, shard_files=files)]
    metrics = collection.get('code_metrics') or {}
    sast_block = (
        '## Deterministic-first (full)\n'
        'Clear SAST already decided — LLM judges hot/ambiguous/architecture only.\n'
        '### Clear deterministic (skip rediscovery)\n%s\n'
        '### Ambiguous residue\n%s\n'
        '### Code metrics (complexity/duplication/smells)\n%s\n'
        % (json.dumps(clear[:80], ensure_ascii=False)[:3000],
           json.dumps(amb[:50], ensure_ascii=False),
           json.dumps(metrics, ensure_ascii=False)))
    if est + count_tokens(sast_block) <= budget:
        blocks.append(sast_block); est += count_tokens(sast_block)

    # Cross-module edges already from CodexQA at collect time
    cross = [e for e in collection.get('cross_module_edges', [])
             if not shard or file_belongs_to_shard(e.get('file', ''), shard, shard_files=files)]
    if cross:
        cb = '## Cross-module architecture edges (CodexQA imports)\n%s\n' % json.dumps(
            cross[:40], ensure_ascii=False)
        if est + count_tokens(cb) <= budget:
            blocks.append(cb); est += count_tokens(cb)

    return ''.join(blocks), est, '', [], 'full'


def append_codexqa_rag_snippets(ctx, est, budget, collection, max_lines, note='',
                                deep_files=None, shard=None, shard_files=None):
    """Force CodexQA-related code snippets into context (--rag / full deep pass)."""
    cqa_cfg = (collection.get('codexqa_config') or {})
    shard_max = int(cqa_cfg.get('rag_shard_max_items') or 8)
    cache = collection.get('rag_cache')
    rag = []
    rag_source = 'live'
    if cache is not None and shard is not None:
        rag = filter_rag_cache_for_shard(
            cache, shard, max_items=shard_max,
            shard_files=shard_files, seeds=deep_files)
        if rag:
            rag_source = 'cache'
    if not rag:
        paths = rag_seed_paths(deep_files=deep_files, shard_files=shard_files,
                               collection=collection)
        try:
            rag = rag_related_snippets(
                collection['repo'], paths,
                intent=resolve_rag_intent(
                    collection.get('rag_intent') or collection.get('intent') or ''),
                max_items=shard_max,
                use_changed_symbols=not bool(shard))
            rag_source = 'live'
        except CodexQAError as e:
            return ctx, est, ((note + ' ') if note else '') + 'CodexQA RAG snippets unavailable: %s' % e, rag_source

    parts = []
    for item in rag:
        snip = item.get('snippet') or item.get('summary') or ''
        parts.append(
            '### RAG RELATED SNIPPET: %s (via=%s, relation=%s, symbol=%s)\n```\n%s\n```\n' % (
                item.get('path', ''), item.get('via', 'codexqa'),
                item.get('relation', ''), item.get('name', ''),
                _cap(snip, max_lines)[:3500]))
    extra = '## CodexQA related code snippets (RAG)\n' + ''.join(parts)
    t = count_tokens(extra)
    if est + t <= budget or not ctx:
        ctx = ctx + extra
        est += t
        note = ((note + ' ') if note else '') + (
            'Injected %d CodexQA RAG snippets (%s, seeds=%s).'
            % (len(rag), rag_source,
               ','.join((deep_files or rag_seed_paths(
                   shard_files=shard_files, collection=collection))[:3]) or 'n/a'))
    else:
        note = ((note + ' ') if note else '') + 'TOKEN BUDGET blocked CodexQA RAG snippets.'
    return ctx, est, note, rag_source

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-i', '--input', required=True)
    ap.add_argument('--mode', choices=['incremental', 'full'], required=True)
    ap.add_argument('--shard', default=None)
    ap.add_argument('--deep-files', default='')
    ap.add_argument('--rag', action='store_true',
                    help='full mode: force CodexQA cross-module/import RAG into context (design §4)')
    ap.add_argument('-o', '--output', default='/tmp/aid_ctx.json')
    args = ap.parse_args()
    cfg = load_config()
    collect = json.load(open(args.input))
    gp = collect.get('graph_provider')
    cqa_cfg = cfg.get('codexqa') if isinstance(cfg.get('codexqa'), dict) else {}
    require_graph = bool(cfg.get('graph_provider', 'codexqa') == 'codexqa'
                         and cqa_cfg.get('require_for_scan', True))
    if gp not in (None, 'codexqa'):
        msg = ('collect.graph_provider=%r — polyglot mandate requires codexqa '
               '(primary_language=%s)' % (gp, collect.get('primary_language', '?')))
        if require_graph:
            print('FATAL: %s' % msg, file=sys.stderr)
            sys.exit(3)
        print('WARNING: %s' % msg, file=sys.stderr)
    # Legacy collects without language fields remain valid (backward compatible).
    if collect.get('polyglot_mandate') is False and require_graph:
        print('WARNING: collect.polyglot_mandate=false but config still requires CodexQA',
              file=sys.stderr)
    deep = [x for x in args.deep_files.split(',') if x]
    shard_files = (collect.get('shards') or {}).get(args.shard, []) if args.shard else collect.get('files', [])
    max_lines = cfg.get('max_lines_per_file', 500)
    rag_source = 'none'
    if args.mode == 'incremental':
        # --rag on incremental forces L3 path via intent hint
        if args.rag and not (collect.get('intent') or ''):
            collect = dict(collect)
            collect['intent'] = ((collect.get('intent') or '') + ' ' + JUDGMENT_RAG_TERMS).strip()
        ctx, est, note, dropped, level = build_incremental(collect, cfg)
        if args.rag and 'RAG RELATED SNIPPET' not in ctx:
            ctx, est, note, rag_source = append_codexqa_rag_snippets(
                ctx, est, cfg['incremental_token_budget'], collect, max_lines, note,
                deep_files=[c['path'] for c in collect.get('changed_files', [])])
            level = 'L3'
        elif 'RAG RELATED SNIPPET' in ctx:
            rag_source = 'live'
    else:
        if args.rag and not (collect.get('intent') or '').strip():
            collect = dict(collect)
            collect['intent'] = JUDGMENT_RAG_TERMS
        ctx, est, note, dropped, level = build_full(collect, cfg, args.shard, deep)
        if args.rag:
            # Prefer live CodexQA snippets over JSON-only edge dumps
            ctx, est, note, rag_source = append_codexqa_rag_snippets(
                ctx, est, cfg['full_token_budget'], collect, max_lines, note,
                deep_files=deep or None, shard=args.shard, shard_files=shard_files)
            if 'Cross-module' not in ctx and collect.get('cross_module_edges'):
                extra = '## Cross-module architecture edges (CodexQA imports, --rag)\n%s\n' % json.dumps(
                    collect.get('cross_module_edges', [])[:40], ensure_ascii=False)
                ctx = ctx + extra
                est += count_tokens(extra)
    out = {'mode': args.mode, 'shard': args.shard, 'context': ctx, 'level': level,
           'est_tokens': est, 'budget_note': note, 'dropped': dropped,
           'graph_provider': 'codexqa', 'rag': bool(args.rag),
           'rag_source': ('codexqa-cache' if rag_source == 'cache'
                          else 'codexqa-snippets' if args.rag else 'none')}
    json.dump(out, open(args.output, 'w'), ensure_ascii=False, indent=1)
    print('context built: level=%s ~%d tokens%s -> %s'
          % (level, est, ('  WARNING: ' + note) if note else '', args.output))

if __name__ == '__main__':
    main()
