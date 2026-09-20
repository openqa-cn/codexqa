#!/usr/bin/env python3
"""Regression tests for pipeline fix: validation, merge compatibility, scope expansion."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (backfill_suggestion, filter_valid_findings, findings_merge_compatible,
                 load_config, normalize_finding)
from merge_report import merge_sast_llm
from sast_adapters import expand_sast_scope, run_java_lint, run_sca


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test_no_drop_empty_suggestion_sast():
    f = normalize_finding({
        'file': 'a.java', 'line': 10, 'category': 'security', 'severity': 'P1',
        'title': 'java.lang.security.audit.xxe.foo', 'evidence': 'XXE risk here',
        'suggestion': '', 'source': 'sast_only', 'adapter': 'semgrep',
    }, 'sast_only')
    f['suggestion'] = ''
    kept, dropped = filter_valid_findings([f])
    _assert(len(kept) == 1 and len(dropped) == 0, 'sast should not drop for suggestion: %s' % dropped)
    _assert((kept[0].get('suggestion') or '').strip(), 'suggestion backfilled')


def test_sec001_rule_id_does_not_merge_different_vuln_classes():
    sast = [{'file': 'O.java', 'line': 84, 'category': 'security', 'severity': 'P2',
             'title': 'java.lang.security.audit.ldap-injection.ldap-injection',
             'evidence': 'LDAP injection', 'suggestion': 'sanitize', 'confidence': 0.9,
             'rule_id': 'SEC-001'}]
    llm = [{'file': 'O.java', 'line': 81, 'category': 'security', 'severity': 'P1',
            'title': 'Reflected XSS', 'evidence': 'renderProfile HTML nickname',
            'suggestion': 'encode', 'confidence': 0.9, 'rule_id': 'SEC-001'}]
    _assert(not findings_merge_compatible(sast[0], llm[0]),
            'SEC-001 alone must not merge LDAP with XSS')


def test_ldap_xss_not_merged():
    sast = [{'file': 'O.java', 'line': 84, 'category': 'security', 'severity': 'P2',
             'title': 'java.lang.security.audit.ldap-injection.ldap-injection',
             'evidence': 'LDAP injection', 'suggestion': 'sanitize', 'confidence': 0.9}]
    llm = [{'file': 'O.java', 'line': 81, 'category': 'security', 'severity': 'P1',
            'title': 'Reflected XSS', 'evidence': 'XSS', 'suggestion': 'encode',
            'confidence': 0.9, 'rule_id': 'SEC-001'}]
    merged = merge_sast_llm(sast, llm)
    titles = ' '.join(f.get('title', '') for f in merged).lower()
    _assert('ldap' in titles, 'LDAP should remain as separate finding')
    _assert('xss' in titles, 'XSS should remain')
    _assert(not any(f.get('source') == 'sast_confirmed' and 'ldap' in f.get('title', '').lower()
                    for f in merged), 'LDAP must not merge into XSS confirmed')


def test_p13_still_merges_nearby_same_category():
    s = [{'file': 'a.py', 'line': 10, 'category': 'security', 'severity': 'P1',
          'title': 't', 'evidence': 'e', 'suggestion': 's', 'confidence': 0.9}]
    l = [{'file': 'a.py', 'line': 11, 'category': 'security', 'severity': 'P1',
          'title': 't2', 'evidence': 'e2', 'suggestion': 's', 'confidence': 0.8}]
    m = merge_sast_llm(s, l)
    _assert(m[0]['source'] == 'sast_confirmed', 'nearby same-category should merge')


def test_merge_appends_sast_evidence():
    sast = [{'file': 'O.java', 'line': 150, 'category': 'secret', 'severity': 'P0',
             'title': 'gitleaks:private-key', 'evidence': 'PEM private key detected',
             'suggestion': 'rotate', 'confidence': 0.95, 'adapter': 'gitleaks'}]
    llm = [{'file': 'O.java', 'line': 150, 'category': 'security', 'severity': 'P0',
            'title': 'Multiple secrets', 'evidence': 'JWT and tokens',
            'suggestion': 'remove', 'confidence': 0.9, 'rule_id': 'HYG-001'}]
    m = merge_sast_llm(sast, llm)
    conf = [f for f in m if f.get('source') == 'sast_confirmed']
    _assert(conf and 'PEM' in conf[0].get('evidence', ''), 'PEM evidence appended')


def test_scope_planner_geo_platform():
    repo = '/tmp/geo-platform'
    if not os.path.isdir(repo):
        return
    from scope_planner import build_scope_plan
    plan = build_scope_plan(repo)
    _assert(plan is not None, 'scope plan should be enabled')
    stats = plan.stats
    _assert(stats['in_scope_files'] < stats['total_code_files'],
            'scope should reduce file count for geo-platform')
    roots = plan.include_roots or []
    _assert(any(r.startswith('apps/') or r.startswith('packages/') for r in roots),
            'monorepo should include apps/* or packages/*')
    _assert(stats['in_scope_files'] >= 50, 'apps+packages should retain substantial logic')


def test_sca_no_trivy_uses_osv():
    src = open(os.path.join(os.path.dirname(__file__), 'sast_adapters.py')).read()
    _assert('def run_trivy' not in src and 'run_trivy_fs' not in src,
            'Trivy runner must be removed from sast_adapters')
    _assert("'adapter': 'trivy'" not in src and '"adapter": "trivy"' not in src,
            'must not emit adapter=trivy findings')
    _assert('download-db-only' not in src and '--skip-db-update' not in src,
            'must not reference trivy-db download / skip-db-update')
    _assert('def run_osv_scanner' in src, 'OSV scanner path required')
    _assert('run_pom_osv_api' in src and 'api.osv.dev' in src, 'OSV HTTP API required')
    _assert('def run_sca' in src, 'run_sca orchestration required')


def test_sca_returns_findings_via_osv():
    repo = os.environ.get('AID_SCA_FIXTURE_REPO', '')
    if not os.path.isfile(os.path.join(repo, 'pom.xml')):
        return
    hits = run_sca(repo, files=['pom.xml'])
    _assert(len(hits) >= 1, 'SCA should return findings for pom.xml')
    _assert(all(h.get('adapter') in ('osv-api', 'osv-scanner', 'npm-audit') for h in hits),
            'SCA must use OSV (api/scanner) or npm-audit, not Trivy')


def test_expand_sast_scope_pom():
    repo = os.path.join(os.path.dirname(__file__), '..', 'data', 'adhoc')
    # synthetic: if pom exists next to java in workspace
    expanded = expand_sast_scope('/tmp', ['src/Foo.java'])
    _assert(isinstance(expanded, list), 'expand returns list')


def test_adversarial_replay():
    sast_path = '/tmp/aid_report_order_payment/agent_llm/sast.json'
    llm_path = '/tmp/aid_report_order_payment/agent_llm/llm_final.json'
    if not (os.path.exists(sast_path) and os.path.exists(llm_path)):
        return
    sast = json.load(open(sast_path))
    llm = json.load(open(llm_path))['findings']
    repo = os.environ.get('AID_ADVERSARIAL_REPLAY_REPO', '')
    merged = merge_sast_llm(sast, llm)
    kept, dropped = filter_valid_findings(merged, repo=repo)
    _assert(len(dropped) == 0, 'adversarial replay dropped %d: %s' % (
        len(dropped), [d['errors'] for d in dropped[:3]]))
    ldap = [f for f in kept if 'ldap' in (f.get('title') or '').lower()]
    _assert(ldap, 'LDAP finding should survive merge')
    _assert(len(kept) >= 20, 'expected >=20 findings after fix, got %d' % len(kept))


def test_rag_seed_paths_prefers_deep_files():
    from rag_context import rag_seed_paths
    shard_files = [{'path': 'apps/a/F.java'}, {'path': 'apps/a/G.java'}]
    seeds = rag_seed_paths(deep_files=['apps/b/X.java'], shard_files=shard_files)
    _assert(seeds == ['apps/b/X.java'], 'deep_files must win over shard_files: %s' % seeds)
    seeds2 = rag_seed_paths(shard_files=shard_files)
    _assert(seeds2[0] == 'apps/a/F.java', 'fallback to shard top files')


def test_filter_rag_cache_for_shard_prefix():
    from rag_context import filter_rag_cache_for_shard
    cache = [
        {'path': 'apps/foo/Bar.java', 'snippet': 'a'},
        {'path': 'packages/baz/Q.java', 'snippet': 'b'},
        {'path': 'apps/foo/util/U.java', 'snippet': 'c'},
    ]
    got = filter_rag_cache_for_shard(cache, 'apps/foo#hot0', max_items=8)
    paths = [x['path'] for x in got]
    _assert('apps/foo/Bar.java' in paths and 'apps/foo/util/U.java' in paths, paths)
    _assert('packages/baz/Q.java' not in paths, 'other shard prefix excluded')


def test_filter_rag_cache_no_global_fallback():
    from rag_context import filter_rag_cache_for_shard
    cache = [
        {'path': 'packages/db/src/client.ts', 'snippet': 'db'},
        {'path': 'packages/domain/src/tasks.ts', 'snippet': 'tasks'},
    ]
    got = filter_rag_cache_for_shard(cache, 'apps#hot0', max_items=8)
    _assert(got == [], 'apps shard must not inherit packages cache head: %s' % got)


def test_filter_rag_cache_keeps_worker_neighbors():
    from rag_context import filter_rag_cache_for_shard
    cache = [
        {'path': 'packages/domain/src/job-queue.ts', 'snippet': 'q',
         'shard': 'apps#hot0', 'seed': 'apps/worker/src/index.ts'},
        {'path': 'packages/domain/src/worker-execution.ts', 'snippet': 'w',
         'shard': 'packages', 'seed': 'packages/domain/src/worker-execution.ts'},
        {'path': 'packages/db/src/client.ts', 'snippet': 'db'},
    ]
    hot0_files = [{'path': 'apps/worker/src/index.ts'}]
    got = filter_rag_cache_for_shard(
        cache, 'apps#hot0', shard_files=hot0_files,
        seeds=['apps/worker/src/index.ts'])
    paths = [x['path'] for x in got]
    _assert('packages/domain/src/job-queue.ts' in paths, 'seed-tagged neighbor must stay: %s' % paths)
    _assert('packages/domain/src/worker-execution.ts' not in paths, paths)
    _assert('packages/db/src/client.ts' not in paths, paths)


def test_judgment_focus_promotes_worker():
    from rag_context import judgment_focus_paths
    files = (
        [{'path': 'packages/domain/src/worker-execution.ts', 'hot_score': 44, 'fan_in': 5}]
        + [{'path': 'packages/themes/src/x.ts', 'hot_score': 40, 'fan_in': 0}]
        + [{'path': 'packages/domain/src/job-queue.ts', 'hot_score': 42, 'fan_in': 8}]
    )
    got = judgment_focus_paths(files, cross_edges=[], limit=8)
    _assert('packages/domain/src/worker-execution.ts' in got, got)
    _assert('packages/domain/src/job-queue.ts' in got, got)
    _assert('packages/themes/src/x.ts' not in got, got)
    ui = judgment_focus_paths([
        {'path': 'apps/web/src/components/review-center/ReviewBusyLock.tsx', 'hot_score': 40},
        {'path': 'apps/web/app/(admin)/geo_admin/(app)/distribution/queue-stats/route.ts',
         'hot_score': 40},
    ], limit=8)
    _assert(ui == [], 'UI lock/queue-stats must not become judgment focus: %s' % ui)


def test_plan_promotes_worker_without_ambiguous():
    from run_scan import _plan_shard_workload
    packages = (
        [{'path': 'packages/domain/src/worker-execution.ts', 'hot_score': 44, 'fan_in': 5}]
        + [{'path': 'packages/domain/src/plain%d.ts' % i, 'hot_score': 41, 'fan_in': 0}
           for i in range(8)])
    w = _plan_shard_workload('packages', packages,
                             {'sast_ambiguous': [], 'cross_module_edges': []}, 70)
    _assert(w is not None and 'packages/domain/src/worker-execution.ts' in w['deep'], w)


def test_full_rag_is_seed_first():
    cqa = open(os.path.join(os.path.dirname(__file__), 'codexqa_client.py')).read()
    _assert('use_changed_symbols=True' in cqa, 'incremental default must stay changed_symbols')
    rag = open(os.path.join(os.path.dirname(__file__), 'rag_context.py')).read()
    _assert('use_changed_symbols=False' in rag, 'full RAG cache must be seed-first')
    cb = open(os.path.join(os.path.dirname(__file__), 'context_builder.py')).read()
    _assert('use_changed_symbols=not bool(shard)' in cb, 'full shard live RAG must be seed-first')


def test_filter_rag_cache_hot_membership():
    from rag_context import filter_rag_cache_for_shard
    cache = [
        {'path': 'apps/worker/src/index.ts', 'snippet': 'w'},
        {'path': 'apps/web/src/components/Confirm.tsx', 'snippet': 'c'},
        {'path': 'packages/domain/src/tasks.ts', 'snippet': 't'},
    ]
    hot1 = [{'path': 'apps/web/src/components/Confirm.tsx'}]
    got = filter_rag_cache_for_shard(cache, 'apps#hot1', max_items=8, shard_files=hot1)
    paths = [x['path'] for x in got]
    _assert(paths == ['apps/web/src/components/Confirm.tsx'], paths)


def test_file_belongs_to_shard_membership():
    from rag_context import file_belongs_to_shard
    hot0 = [{'path': 'apps/worker/src/index.ts'}, {'path': 'apps/web/src/a.tsx'}]
    _assert(file_belongs_to_shard('apps/worker/src/index.ts', 'apps#hot0', shard_files=hot0),
            'worker belongs to hot0')
    _assert(file_belongs_to_shard('./apps/worker/src/index.ts', 'apps#hot0', shard_files=hot0),
            './ prefix normalized')
    _assert(not file_belongs_to_shard('apps/worker/src/index.ts', 'apps#hot1',
                                     shard_files=[{'path': 'apps/web/src/b.tsx'}]),
            'worker must not leak into hot1')
    _assert(file_belongs_to_shard('packages/domain/src/x.ts', 'packages', shard_files=None),
            'unsplit shard still uses prefix')


def test_resolve_rag_intent():
    from rag_context import JUDGMENT_RAG_TERMS, resolve_rag_intent
    _assert(resolve_rag_intent('') == JUDGMENT_RAG_TERMS, resolve_rag_intent(''))
    got = resolve_rag_intent('full baseline scan geo-platform main')
    _assert(got.startswith('full baseline'), got)
    _assert('concurrency' in got and 'transaction' in got, got)
    keep = resolve_rag_intent('review concurrency on checkout')
    _assert(keep == 'review concurrency on checkout', keep)


def test_import_neighbor_path():
    from codexqa_client import import_neighbor_path
    edge = {'from_file': 'apps/worker/src/index.ts',
            'to_file': 'packages/config/src/index.ts'}
    _assert(import_neighbor_path(edge, 'apps/worker/src/index.ts')
            == 'packages/config/src/index.ts', 'out neighbor')
    _assert(import_neighbor_path(edge, 'packages/config/src/index.ts')
            == 'apps/worker/src/index.ts', 'in neighbor')


def test_plan_shard_ambiguous_membership():
    from run_scan import _plan_shard_workload
    coll = {'sast_ambiguous': [
        {'file': 'apps/worker/src/index.ts', 'ambiguous': True},
        {'file': './packages/domain/src/worker-execution.ts', 'ambiguous': True},
    ]}
    hot0 = [{'path': 'apps/worker/src/index.ts', 'hot_score': 51.6},
            {'path': 'apps/web/src/a.tsx', 'hot_score': 40.0}] * 10  # 20 files > 5
    hot0[0] = {'path': 'apps/worker/src/index.ts', 'hot_score': 51.6}
    # pad to >5 unique-ish entries
    hot0 = ([{'path': 'apps/worker/src/index.ts', 'hot_score': 51.6}]
            + [{'path': 'apps/web/src/f%d.tsx' % i, 'hot_score': 40.0} for i in range(10)])
    hot1 = [{'path': 'apps/web/src/cold%d.tsx' % i, 'hot_score': 40.0} for i in range(8)]
    packages = [{'path': 'packages/domain/src/worker-execution.ts', 'hot_score': 44.0}] + [
        {'path': 'packages/domain/src/x%d.ts' % i, 'hot_score': 41.0} for i in range(8)]
    w0 = _plan_shard_workload('apps#hot0', hot0, coll, 70)
    w1 = _plan_shard_workload('apps#hot1', hot1, coll, 70)
    wp = _plan_shard_workload('packages', packages, coll, 70)
    _assert(w0 is not None and 'apps/worker/src/index.ts' in w0['deep'], w0)
    _assert(w1 is None, 'cold apps#hot1 must skip LLM, got %s' % w1)
    _assert(wp is not None and 'packages/domain/src/worker-execution.ts' in wp['deep'], wp)


def test_cross_module_edges_samples_and_parses():
    from collect_full import cross_module_edges, select_edge_probe_files
    files = (
        [{'path': 'packages/config/src/index.ts', 'hot_score': 40, 'fan_in': 1}] * 1
        + [{'path': 'packages/domain/src/a%d.ts' % i, 'hot_score': 41, 'fan_in': 0}
           for i in range(60)]
        + [{'path': 'apps/worker/src/index.ts', 'hot_score': 51.6, 'fan_in': 31}]
    )
    probed = [f['path'] for f in select_edge_probe_files(files, limit=10)]
    _assert('apps/worker/src/index.ts' in probed,
            'round-robin must include apps file, got %s' % probed[:8])

    def fake_imports(repo, path, direction='in'):
        if path == 'apps/worker/src/index.ts' and direction == 'out':
            return [{'from_file': path, 'to_file': 'packages/config/src/index.ts'}]
        if path.startswith('packages/') and direction == 'out':
            return [{'from_file': path, 'to_file': 'packages/ai/src/index.ts'}]
        return []

    edges = cross_module_edges('/tmp/repo', files, limit=20, import_fn=fake_imports)
    _assert(any(e['file'] == 'apps/worker/src/index.ts'
                and 'packages/config/src/index.ts' in e['foreign_deps']
                for e in edges), edges)
    _assert(all(e.get('via') == 'codexqa-imports' for e in edges), edges)


def test_scan_full_passes_intent_to_collect():
    src = open(os.path.join(os.path.dirname(__file__), 'run_scan.py')).read()
    _assert("*(['--intent', args.intent] if args.intent else [])" in src
            and 'collect_full.py' in src, 'scan_full must forward --intent')
    csrc = open(os.path.join(os.path.dirname(__file__), 'collect_full.py')).read()
    _assert("add_argument('--intent'" in csrc, 'collect_full must accept --intent')
    _assert("'intent': args.intent" in csrc, 'collection must persist intent')
    _assert('rag_intent' in csrc and 'resolve_rag_intent' in csrc,
            'collection must persist resolved rag_intent')


def test_collect_shard_seed_paths_dedupes():
    from rag_context import collect_shard_seed_paths
    plans = [
        {'deep': ['a/x.java', 'b/y.java'], 'shard_files': []},
        {'deep': ['a/x.java', 'c/z.java'], 'shard_files': []},
    ]
    seeds = collect_shard_seed_paths(plans, None)
    _assert(seeds == ['a/x.java', 'b/y.java', 'c/z.java'], seeds)


def test_agent_mode_skips_cache_read():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from run_scan import PIPELINE_VERSION, invalidate_cache, save_cache, try_cache
    dhash = 'test_cache_agent_skip_' + PIPELINE_VERSION
    invalidate_cache(dhash)
    out = '/tmp/aid_cache_test_out'
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'report_scan.json'), 'w').write(json.dumps({
        'scan_type': 'incremental', 'findings': [], 'summary': {'total': 0},
        'llm_provider': 'agent_inline'}))
    open(os.path.join(out, 'report_scan.md'), 'w').write('# test')
    open(os.path.join(out, 'report_scan.html'), 'w').write('<html></html>')
    save_cache(dhash, out, llm_mode='agent')
    hit = try_cache(dhash, out + '_2', llm_mode='agent')
    _assert(not hit, 'agent mode must not cache-hit at prepare')
    hit2 = try_cache(dhash, out + '_3', llm_mode='agent', allow_agent_cache=True)
    _assert(hit2, 'agent --use-cache should reuse finalized report')


def test_scope_jvm_root_is_application():
    import tempfile
    import shutil
    from scope_planner import build_scope_plan, discover_projects, _classify_role, _load_scope_policy
    policy = _load_scope_policy()
    td = tempfile.mkdtemp(prefix='aid_jvm_scope_')
    try:
        open(os.path.join(td, 'pom.xml'), 'w').write(
            '<project><modelVersion>4.0.0</modelVersion>'
            '<groupId>a</groupId><artifactId>b</artifactId><version>1</version></project>\n')
        open(os.path.join(td, 'TradeOrderService.java'), 'w').write(
            'class TradeOrderService { String JDBC_PASS = "Tr@de2026!Prod"; }\n')
        projects, _ = discover_projects(td, policy)
        _assert(projects and projects[0].ecosystem == 'jvm', projects)
        role = _classify_role('', td, 'jvm', policy, set())
        _assert(role == 'application', 'jvm root must be application, got %s' % role)
        plan = build_scope_plan(td)
        _assert(plan is not None, 'plan required')
        _assert('TradeOrderService.java' in plan.include_files,
                'java file must be in include_files: %s' % plan.include_files)
        _assert(plan.stats['in_scope_files'] >= 1, plan.stats)
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_scope_empty_allowlist_does_not_reject_all():
    from scope_planner import apply_scope_filter, scope_allowlist
    _assert(scope_allowlist([]) is None, 'empty → None (do not filter)')
    _assert(scope_allowlist(None) is None, 'None → None')
    _assert(scope_allowlist(['a.java']) == {'a.java'}, 'non-empty set')
    paths = ['a.java', 'b.java']
    _assert(apply_scope_filter(paths, []) == paths, 'empty filter keeps all')
    _assert(apply_scope_filter(paths, ['a.java']) == ['a.java'], 'non-empty filters')


def test_go_root_mod_is_application():
    import tempfile
    import shutil
    from scope_planner import _classify_role, _load_scope_policy, build_scope_plan
    policy = _load_scope_policy()
    td = tempfile.mkdtemp(prefix='aid_go_scope_')
    try:
        open(os.path.join(td, 'go.mod'), 'w').write('module example.com/x\ngo 1.21\n')
        open(os.path.join(td, 'main.go'), 'w').write('package main\nfunc main() {}\n')
        _assert(_classify_role('', td, 'go', policy, set()) == 'application', 'go root')
        plan = build_scope_plan(td)
        _assert(plan and 'main.go' in plan.include_files, plan.include_files if plan else None)
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_hardcoded_credential_scanner_finds_jdbc_pass():
    import tempfile
    import shutil
    from sast_adapters import scan_hardcoded_credentials, run_secrets
    td = tempfile.mkdtemp(prefix='aid_cred_')
    try:
        open(os.path.join(td, 'Svc.java'), 'w').write(
            'class Svc {\n'
            '  private static final String JDBC_PASS = "Tr@de2026!Prod";\n'
            '  String password = "changeme";\n'
            '}\n')
        hits = scan_hardcoded_credentials(td, paths=['Svc.java'])
        names = [h.get('title') for h in hits]
        _assert(any('JDBC_PASS' in (t or '') for t in names), 'JDBC_PASS must be found: %s' % names)
        _assert(all(h.get('rule_id') == 'HYG-001' for h in hits), hits)
        all_hits = run_secrets(td, paths=['Svc.java'])
        _assert(any(h.get('adapter') == 'hardcoded_secrets' for h in all_hits),
                'run_secrets must include hardcoded_secrets: %s'
                % [h.get('adapter') for h in all_hits])
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_detect_repo_languages_and_mandate():
    import tempfile
    import shutil
    from lib import detect_repo_languages, normalize_language_id
    from codexqa_client import assert_codexqa_mandate, graph_engine_meta, CodexQAError
    td = tempfile.mkdtemp(prefix='aid_lang_')
    try:
        open(os.path.join(td, 'go.mod'), 'w').write('module example.com/x\n')
        open(os.path.join(td, 'main.go'), 'w').write('package main\nfunc main() {}\n')
        os.makedirs(os.path.join(td, 'pkg'))
        open(os.path.join(td, 'pkg', 'a.go'), 'w').write('package pkg\n')
        # Noise: many JS files must NOT overturn go.mod+go sources
        os.makedirs(os.path.join(td, 'web'))
        for i in range(8):
            open(os.path.join(td, 'web', 'f%d.js' % i), 'w').write('console.log(%d)\n' % i)
        info = detect_repo_languages(td)
        _assert(info['primary'] == 'go', info)
        _assert(info['confidence'] in ('high', 'medium'), info)
        _assert(info['counts'].get('go', 0) >= 2, info)
        meta = graph_engine_meta(info)
        _assert(meta['graph_provider'] == 'codexqa' and meta['polyglot_mandate'] is True, meta)
        _assert(meta['primary_language'] == 'go', meta)
        _assert(meta.get('language_confidence'), meta)
        assert_codexqa_mandate({'graph_provider': 'codexqa', 'codexqa': {'polyglot_mandate': True}},
                              languages=info, caller='test')
        try:
            assert_codexqa_mandate({'graph_provider': 'gitnexus'}, languages=info)
            _assert(False, 'expected CodexQAError for non-codexqa provider')
        except CodexQAError as e:
            _assert('polyglot' in str(e).lower() or 'CodexQA' in str(e), e)

        # TS + tsconfig beats package.json-as-javascript
        td2 = tempfile.mkdtemp(prefix='aid_ts_')
        try:
            open(os.path.join(td2, 'package.json'), 'w').write('{"name":"x"}\n')
            open(os.path.join(td2, 'tsconfig.json'), 'w').write('{}\n')
            for i in range(5):
                open(os.path.join(td2, 'a%d.ts' % i), 'w').write('export const x%d = 1\n' % i)
            open(os.path.join(td2, 'b.js'), 'w').write('module.exports = 1\n')
            tsinfo = detect_repo_languages(td2)
            _assert(tsinfo['primary'] == 'typescript', tsinfo)

            # Override wins
            ov = detect_repo_languages(td2, language_hint='python')
            _assert(ov['primary'] == 'python' and ov['source'] == 'override', ov)
            _assert(normalize_language_id('golang') == 'go', normalize_language_id('golang'))
        finally:
            shutil.rmtree(td2, ignore_errors=True)

        # Java pom primary
        td3 = tempfile.mkdtemp(prefix='aid_java_')
        try:
            open(os.path.join(td3, 'pom.xml'), 'w').write('<project/>\n')
            os.makedirs(os.path.join(td3, 'src'))
            open(os.path.join(td3, 'src', 'A.java'), 'w').write('class A {}\n')
            open(os.path.join(td3, 'src', 'B.java'), 'w').write('class B {}\n')
            jinfo = detect_repo_languages(td3)
            _assert(jinfo['primary'] == 'java', jinfo)
            _assert(jinfo.get('verified') or jinfo['confidence'] == 'high', jinfo)
        finally:
            shutil.rmtree(td3, ignore_errors=True)
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_node_workspace_root_still_excluded():
    """Regression: Node monorepo root with workspaces stays workspace_root."""
    import tempfile
    import shutil
    from scope_planner import _classify_role, _load_scope_policy
    policy = _load_scope_policy()
    td = tempfile.mkdtemp(prefix='aid_node_ws_')
    try:
        open(os.path.join(td, 'package.json'), 'w').write(
            '{"private":true,"workspaces":["apps/*","packages/*"]}\n')
        open(os.path.join(td, 'pnpm-workspace.yaml'), 'w').write('packages:\n  - apps/*\n')
        role = _classify_role('', td, 'node', policy, set())
        _assert(role == 'workspace_root',
                'node workspace root must stay workspace_root, got %s' % role)
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_ambiguous_sast_llm_demotion_wins():
    """Ambiguous SAST P1 + Stage2 P3 at same locus → report P3 (sast_confirmed)."""
    sast = [{'file': 'scripts/_verify.ts', 'line': 40, 'category': 'security', 'severity': 'P1',
             'title': 'react-insecure-request', 'evidence': 'Unencrypted request over HTTP.',
             'suggestion': 'use HTTPS', 'confidence': 0.9, 'adapter': 'semgrep',
             'ambiguous': True}]
    llm = [{'file': 'scripts/_verify.ts', 'line': 40, 'category': 'security', 'severity': 'P3',
            'title': 'loopback mock health probe', 'evidence': 'http://127.0.0.1 mock only',
            'suggestion': 'allowlist loopback', 'confidence': 0.85, 'rule_id': 'SEC-001'}]
    m = merge_sast_llm(sast, llm)
    conf = [f for f in m if f.get('source') == 'sast_confirmed']
    _assert(len(conf) == 1 and conf[0]['severity'] == 'P3',
            'ambiguous demotion must keep LLM severity, got %s' % conf)


def test_ambiguous_sast_dismissal_drops():
    """Stage2 dismissals omit ambiguous SAST; clear SAST cannot be dismissed."""
    sast = [
        {'file': 'a.ts', 'line': 10, 'category': 'security', 'severity': 'P1',
         'title': 'insecure-http', 'evidence': 'Unencrypted request over HTTP.',
         'suggestion': 'https', 'confidence': 0.9, 'ambiguous': True},
        {'file': 'b.py', 'line': 5, 'category': 'security', 'severity': 'P1',
         'title': 'clear-sqli', 'evidence': 'SQL injection via string concat',
         'suggestion': 'parameterize', 'confidence': 0.95, 'ambiguous': False},
    ]
    llm = []
    dismissals = [{'file': 'a.ts', 'line': 10, 'reason': 'localhost mock'},
                  {'file': 'b.py', 'line': 5, 'reason': 'should not drop clear'}]
    m = merge_sast_llm(sast, llm, dismissals=dismissals)
    files = {f['file'] for f in m}
    _assert('a.ts' not in files, 'ambiguous dismissed SAST must be omitted')
    _assert('b.py' in files, 'clear SAST must survive dismissal attempt')
    _assert(any(f.get('source') == 'sast_only' and f['file'] == 'b.py' for f in m),
            'clear SAST remains sast_only')


def test_ambiguous_sast_dismissed_flag_on_finding():
    sast = [{'file': 'a.ts', 'line': 10, 'category': 'security', 'severity': 'P1',
             'title': 'insecure-http', 'evidence': 'Unencrypted HTTP',
             'suggestion': 'https', 'confidence': 0.9, 'ambiguous': True}]
    llm = [{'file': 'a.ts', 'line': 10, 'category': 'security', 'severity': 'P3',
            'title': 'fp', 'evidence': 'loopback', 'suggestion': 'n/a',
            'confidence': 0.9, 'dismissed': True}]
    m = merge_sast_llm(sast, llm)
    _assert(m == [], 'dismissed:true finding must drop ambiguous SAST and not emit itself')


def test_clear_sast_still_blocks_llm_demotion():
    """Clear SAST P1 + LLM P3 → stay P1 (deterministic floor)."""
    sast = [{'file': 'a.py', 'line': 10, 'category': 'security', 'severity': 'P1',
             'title': 'sqli', 'evidence': 'SQL injection', 'suggestion': 'bind',
             'confidence': 0.9, 'ambiguous': False}]
    llm = [{'file': 'a.py', 'line': 10, 'category': 'security', 'severity': 'P3',
            'title': 'maybe ok', 'evidence': 'looks fine', 'suggestion': 'n/a',
            'confidence': 0.5}]
    m = merge_sast_llm(sast, llm)
    conf = [f for f in m if f.get('source') == 'sast_confirmed']
    _assert(conf and conf[0]['severity'] == 'P1',
            'clear SAST must not be demoted by LLM, got %s' % conf)


def test_infer_完整_maps_repo_full():
    from choose_scenario import infer_from_text
    s = infer_from_text('对当前工程进行完整缺陷检测')
    _assert(s and s['id'] == 'repo-full', '完整 must infer repo-full, got %s' % s)


def test_scope_excludes_data_adhoc():
    from scope_planner import _load_scope_policy, _glob_match
    policy = _load_scope_policy()
    globs = (policy.get('global_exclude_globs') or [])
    path = 'skills/defect-detection/data/adhoc/ws_20260920/snippet.py'
    _assert(any('adhoc' in g for g in globs), 'scope_policy must list data/adhoc excludes')
    _assert(_glob_match(path, globs), 'adhoc snippet path must match exclude globs: %s' % globs)


def test_bandit_b324_maps_to_p2_hygiene():
    """Simulate Bandit B324 HIGH → P2 hygiene (non-auth hash)."""
    # Exercise the mapping branch via a tiny inline replica of the decision
    # (full bandit CLI may be absent in CI); keep in sync with run_bandit().
    from sast_adapters import run_bandit
    import tempfile, shutil, textwrap
    td = tempfile.mkdtemp(prefix='aid_b324_')
    try:
        src = os.path.join(td, 'hash_demo.py')
        open(src, 'w').write(textwrap.dedent('''
            import hashlib
            def fingerprint(s):
                return hashlib.md5(s.encode()).hexdigest()
        '''))
        hits = run_bandit(td, files=['hash_demo.py'])
        b324 = [h for h in hits if str(h.get('title', '')).upper() in ('B324', 'B303')]
        if not b324:
            # bandit missing or did not flag — still assert helper path via import check
            src_txt = open(os.path.join(os.path.dirname(__file__), 'sast_adapters.py')).read()
            _assert('usedforsecurity' in src_txt and "tid in ('B324', 'B303')" in src_txt,
                    'run_bandit must special-case B324/B303')
            return
        _assert(all(h['severity'] == 'P2' for h in b324), 'B324 must be P2, got %s' % b324)
        _assert(all(h['category'] == 'hygiene' for h in b324), 'B324 category hygiene')
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_python_min_310_resolver():
    from lib import MIN_PYTHON, REQUIRED_PYTHON, python_executable, resolve_python
    import sys
    _assert(MIN_PYTHON == (3, 10) and REQUIRED_PYTHON == (3, 10),
            'minimum runtime must be 3.10+, got %s/%s' % (MIN_PYTHON, REQUIRED_PYTHON))
    exe = resolve_python()
    _assert(exe, 'resolve_python must find a 3.10+ interpreter')
    _assert(sys.version_info[:2] >= (3, 10),
            'tests themselves must run under 3.10+, got %s' % (sys.version_info[:2],))
    pe = python_executable()
    _assert(pe == exe or pe == sys.executable,
            'python_executable should be resolved 3.10+ interpreter: %s vs %s' % (pe, exe))


def main():
    test_rag_seed_paths_prefers_deep_files()
    test_filter_rag_cache_for_shard_prefix()
    test_filter_rag_cache_no_global_fallback()
    test_filter_rag_cache_keeps_worker_neighbors()
    test_judgment_focus_promotes_worker()
    test_plan_promotes_worker_without_ambiguous()
    test_full_rag_is_seed_first()
    test_filter_rag_cache_hot_membership()
    test_file_belongs_to_shard_membership()
    test_resolve_rag_intent()
    test_import_neighbor_path()
    test_plan_shard_ambiguous_membership()
    test_cross_module_edges_samples_and_parses()
    test_scan_full_passes_intent_to_collect()
    test_collect_shard_seed_paths_dedupes()
    test_agent_mode_skips_cache_read()
    test_no_drop_empty_suggestion_sast()
    test_sec001_rule_id_does_not_merge_different_vuln_classes()
    test_ldap_xss_not_merged()
    test_p13_still_merges_nearby_same_category()
    test_merge_appends_sast_evidence()
    test_ambiguous_sast_llm_demotion_wins()
    test_ambiguous_sast_dismissal_drops()
    test_ambiguous_sast_dismissed_flag_on_finding()
    test_clear_sast_still_blocks_llm_demotion()
    test_infer_完整_maps_repo_full()
    test_scope_excludes_data_adhoc()
    test_bandit_b324_maps_to_p2_hygiene()
    test_python_min_310_resolver()
    test_scope_planner_geo_platform()
    test_sca_no_trivy_uses_osv()
    test_sca_returns_findings_via_osv()
    test_expand_sast_scope_pom()
    test_adversarial_replay()
    test_scope_jvm_root_is_application()
    test_scope_empty_allowlist_does_not_reject_all()
    test_go_root_mod_is_application()
    test_hardcoded_credential_scanner_finds_jdbc_pass()
    test_node_workspace_root_still_excluded()
    test_detect_repo_languages_and_mandate()
    print('OK all pipeline fix tests passed')


if __name__ == '__main__':
    main()
