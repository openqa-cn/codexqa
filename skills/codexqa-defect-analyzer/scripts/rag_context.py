#!/usr/bin/env python3
"""CodexQA RAG seed selection, global cache, and per-shard distribution."""

import os
import re
import sys

sys.path.insert(0, sys.path[0] or '.')
from codexqa_client import CodexQAError, rag_related_snippets

JUDGMENT_RAG_TERMS = 'concurrency transaction auth permission'
# Directory segment apps/worker, packages/queue — not "ReviewQueue" / "queue-stats".
_FOCUS_DIR_RE = re.compile(r'(?:^|/)(?:worker|queue)(?:/|$)')
# Basename allowlist for concurrency/queue primitives.
_FOCUS_NAME_RE = re.compile(
    r'(?:worker-execution|job-queue|job-id|task-outbox|idempotenc|auth-lockout|'
    r'queue-time|heartbeat|bullmq|publishdue|scheduler)',
    re.I)
# Substring markers that are rarely accidental in UI filenames.
_FOCUS_SUBSTR = (
    'mutex', 'concurr', 'atomic', 'transaction', 'deadlock', 'redis',
    'outbox', 'idempoten', 'bullmq',
)


def norm_repo_path(path, repo=None):
    """Repo-relative POSIX path. Strips ./, leading /, and optional repo prefix."""
    p = (path or '').replace('\\', '/').strip()
    if repo:
        repo_n = str(repo).replace('\\', '/').rstrip('/')
        if p.startswith(repo_n + '/'):
            p = p[len(repo_n) + 1:]
    if p.startswith('./'):
        p = p[2:]
    return p.lstrip('/')


def shard_prefix(shard):
    """Normalize shard id to path prefix (e.g. apps#hot0 → apps)."""
    if not shard or shard == '.':
        return ''
    return shard.split('#')[0].rstrip('/')


def shard_member_paths(shard_files):
    out = set()
    for f in shard_files or []:
        out.add(norm_repo_path(f['path'] if isinstance(f, dict) else f))
    out.discard('')
    return out


def file_belongs_to_shard(path, shard, shard_files=None, repo=None):
    """True if path is a member of this shard.

    When shard_files is provided (including empty list), membership wins so
    apps#hot1 does not inherit apps#hot0 files via the shared `apps/` prefix.
    When shard_files is None, fall back to top-level prefix (unsplit shards).
    """
    rel = norm_repo_path(path, repo=repo)
    if not rel:
        return False
    if shard_files is not None:
        return rel in shard_member_paths(shard_files)
    base = shard_prefix(shard)
    if not base:
        return True
    return rel == base or rel.startswith(base + '/')


def judgment_path_boost(path):
    """How strongly a path looks like concurrency / queue / lock logic.

    Uses directory segments and an allowlist basename so ReviewBusyLock /
    queue-stats do not pull a cold apps#hotN shard into LLM.
    """
    rel = norm_repo_path(path)
    if not rel:
        return 0
    n = 0
    if _FOCUS_DIR_RE.search(rel):
        n += 2
    base = os.path.basename(rel)
    if _FOCUS_NAME_RE.search(base):
        n += 2
    low = rel.lower()
    n += sum(1 for m in _FOCUS_SUBSTR if m in low)
    return n


def judgment_focus_paths(shard_files, cross_edges=None, limit=8):
    """Deep-review extras: judgment-named files and cross-module edge endpoints in this shard."""
    members = shard_member_paths(shard_files)
    edge_hits = set()
    for e in cross_edges or []:
        src = norm_repo_path(e.get('file', ''))
        if src in members:
            edge_hits.add(src)
        for dest in e.get('foreign_deps') or []:
            d = norm_repo_path(dest)
            if d in members:
                edge_hits.add(d)
    scored = []
    for f in shard_files or []:
        p = f['path'] if isinstance(f, dict) else f
        rel = norm_repo_path(p)
        boost = judgment_path_boost(rel)
        if not boost and rel not in edge_hits:
            continue
        hot = f.get('hot_score', 0) if isinstance(f, dict) else 0
        fan = f.get('fan_in', 0) if isinstance(f, dict) else 0
        scored.append((boost + (2 if rel in edge_hits else 0), hot, fan, rel))
    scored.sort(reverse=True)
    return [p for _, _, _, p in scored[:limit]]


def resolve_rag_intent(user_intent=''):
    """RAG query string: keep user intent, append judgment terms if missing.

    Empty intent resolves to JUDGMENT_RAG_TERMS (concurrency/auth/transaction),
    not a generic architecture-only query, so full-scan retrieval stays balanced.
    """
    base = (user_intent or '').strip()
    low = base.lower()
    markers = ('concurr', 'lock', 'transaction', 'atomic', 'race',
               'auth', 'permission', 'deadlock')
    if base and any(k in low for k in markers):
        return base
    if base:
        return (base + ' ' + JUDGMENT_RAG_TERMS).strip()
    return JUDGMENT_RAG_TERMS


def rag_seed_paths(deep_files=None, shard_files=None, collection=None, max_seeds=15):
    """
    RAG query seeds: deep_files first, else top files in shard, else legacy fallbacks.
    """
    if deep_files:
        return list(dict.fromkeys(deep_files))[:max_seeds]
    if shard_files:
        out = []
        for f in shard_files[:max_seeds]:
            out.append(f['path'] if isinstance(f, dict) else f)
        return list(dict.fromkeys(out))[:max_seeds]
    collection = collection or {}
    if collection.get('changed_files'):
        return [c['path'] for c in collection['changed_files'][:max_seeds]]
    if collection.get('hot_files'):
        return [f['path'] for f in collection['hot_files'][:max_seeds]]
    if collection.get('files'):
        return [f['path'] for f in sorted(
            collection['files'], key=lambda x: -x.get('hot_score', 0))[:max_seeds]]
    return []


def filter_rag_cache_for_shard(cache, shard, max_items=8, shard_files=None, seeds=None):
    """Assign cached snippets to a shard.

    Priority:
      1. item.shard == this shard (per-workload RAG; may be a packages neighbor of worker)
      2. item.seed is one of this shard's seeds (graph neighbor of worker/index.ts)
      3. untagged legacy: membership, else prefix
    Never fall back to the global cache head.
    """
    if not cache:
        return []
    members = shard_member_paths(shard_files) if shard_files is not None else None
    seed_set = {norm_repo_path(s) for s in (seeds or [])}
    seed_set.discard('')
    base = shard_prefix(shard)
    matched = []
    for item in cache:
        path = norm_repo_path(item.get('path') or '')
        if not path or path == '(unknown)':
            continue
        item_shard = item.get('shard')
        item_seed = norm_repo_path(item.get('seed') or '')
        if item_shard:
            if item_shard == shard:
                matched.append(item)
            continue
        if seed_set and item_seed and item_seed in seed_set:
            matched.append(item)
            continue
        if members is not None:
            if path in members:
                matched.append(item)
            continue
        if not base or path == base or path.startswith(base + '/'):
            matched.append(item)
    return matched[:max_items]


def build_global_rag_cache(repo, seed_paths, intent='', max_items=32):
    """Single CodexQA RAG pass (legacy). Full scan prefers build_rag_cache_for_workloads."""
    seeds = list(dict.fromkeys(seed_paths or []))[:40]
    if not seeds:
        return []
    try:
        return rag_related_snippets(
            repo, seeds,
            intent=resolve_rag_intent(intent),
            max_items=max_items,
            use_changed_symbols=False)
    except CodexQAError:
        return []


def build_rag_cache_for_workloads(repo, workloads, intent='', max_per_shard=8, max_workers=1):
    """Per-shard CodexQA RAG so apps#hot0 gets worker neighbors, not packages leftovers.

    Each snippet is tagged with shard + seed. Parallelism matches rag_max_workers.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _one(w):
        seeds = rag_seed_paths(
            deep_files=w.get('deep'), shard_files=w.get('shard_files'), max_seeds=8)
        try:
            items = rag_related_snippets(
                repo, seeds,
                intent=resolve_rag_intent(intent),
                max_items=max_per_shard,
                use_changed_symbols=False)
        except CodexQAError:
            items = []
        tagged = []
        for it in items:
            row = dict(it)
            row['shard'] = w['shard']
            if not row.get('seed') and seeds:
                row['seed'] = seeds[0]
            tagged.append(row)
        return w['shard'], tagged, seeds

    by_shard, flat, all_seeds = {}, [], []
    jobs = [w for w in (workloads or []) if w]
    if not jobs:
        return [], {}, []
    if max_workers > 1 and len(jobs) > 1:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futs = {pool.submit(_one, w): w['shard'] for w in jobs}
            for fut in as_completed(futs):
                shard, items, seeds = fut.result()
                by_shard[shard] = items
                flat.extend(items)
                all_seeds.extend(seeds)
    else:
        for w in jobs:
            shard, items, seeds = _one(w)
            by_shard[shard] = items
            flat.extend(items)
            all_seeds.extend(seeds)
    return flat, by_shard, list(dict.fromkeys(all_seeds))


def collect_shard_seed_paths(shard_plans, coll, max_per_shard=15, max_total=40):
    """Union deep-file seeds from all shard plans for one global RAG call."""
    seeds = []
    for plan in shard_plans:
        seeds.extend(rag_seed_paths(
            deep_files=plan.get('deep'),
            shard_files=plan.get('shard_files'),
            max_seeds=max_per_shard))
    if not seeds and coll:
        seeds = rag_seed_paths(collection=coll, max_seeds=max_per_shard)
    return list(dict.fromkeys(seeds))[:max_total]
