#!/usr/bin/env python3
"""
CodexQA CLI client — the ONLY code-graph / call-chain / cross-file correlation source.

Targets CodexQA 0.1.x (@openqa-cn/codexqa) JSON shapes:
  symbols  → {"kind":"Nodes","nodes":[...]}
  edges    → {"kind":"Edges","edges":[...]}
  reach    → {"kind":"GraphReach","result":{"root", "hops", "edges", ...}}
  source   → {"kind":"Source","text":...}
  search   → {"kind":"Bm25Search","results":[...]}

Requires @openqa-cn/codexqa@latest + platform package; native queries only
(references/codexqa-cli.md): change-groups, symbol-diff, symbols, edges, reach, …
After npm upgrade run `codexqa stop` (install script does this) so daemon picks up
the new platform binary.

Design mandate (references/codexqa-cli.md): do NOT reimplement symbol graphs,
callers/callees, imports, reachability, or cross-file RAG. All MUST come from
`codexqa` subprocess calls.

Polyglot mandate: EVERY language (Java/Go/Python/TS/… ) uses CodexQA for
underlying repo code analysis. Language detection only labels the repo —
it never selects an alternate graph engine.

Install:
  bash scripts/install_codexqa.sh
  # or: npm install -g @openqa-cn/codexqa@latest --registry https://registry.npmjs.org/

Mock policy (see reconcile_mock_env / mock_enabled):
  Real `codexqa` on PATH + smoke OK → ALWAYS real graph (mock env vars ignored).
  Mock only when binary unavailable AND CODEXQA_FORCE_MOCK=1 or CODEXQA_MOCK=1.
"""
import json, os, shutil, subprocess, sys
from types import SimpleNamespace

from lib import detect_repo_languages  # re-export for callers

CODEXQA_API_VERSION = '0.1.6'
GRAPH_PROVIDER = 'codexqa'


class CodexQAError(RuntimeError):
    pass


def _env_truthy(name):
    return os.environ.get(name, '').strip() in ('1', 'true', 'TRUE', 'yes', 'YES')


def _which_codexqa():
    return shutil.which('codexqa') or shutil.which('codexqa.cmd')


def _real_codexqa_ok():
    """True when platform CLI is present and `codexqa --help` succeeds."""
    exe = _which_codexqa()
    if not exe:
        try:
            prefix = subprocess.check_output(['npm', 'prefix', '-g'], text=True).strip()
            cand = os.path.join(prefix, 'bin', 'codexqa')
            if os.path.exists(cand):
                exe = cand
        except Exception:
            exe = None
    if not exe:
        return False
    try:
        r = subprocess.run([exe, '--help'], capture_output=True, text=True, timeout=30)
        return r.returncode == 0
    except Exception:
        return False


MOCK_ENV_KEYS = ('CODEXQA_FORCE_MOCK', 'CODEXQA_MOCK', 'AID_ALLOW_CODEXQA_MOCK')


def reconcile_mock_env(caller='codexqa_client'):
    """
    When real CodexQA works, strip stale mock flags from the environment so
    inherited shell exports (e.g. from audit sessions) cannot downgrade scans.
    """
    if not _real_codexqa_ok():
        return False
    cleared = [k for k in MOCK_ENV_KEYS if _env_truthy(k)]
    for k in cleared:
        os.environ.pop(k, None)
    if cleared:
        print('%s: real CodexQA OK — ignoring %s (using live graph)'
              % (caller, ', '.join(cleared)), file=sys.stderr)
    return bool(cleared)


def mock_enabled():
    """
    Mock ONLY when the platform binary is unavailable.

    Priority:
      1. Real CLI smoke OK  → never mock (FORCE_MOCK / MOCK env ignored).
      2. Binary missing     → mock if CODEXQA_FORCE_MOCK=1 or CODEXQA_MOCK=1
                              or AID_ALLOW_CODEXQA_MOCK=1.
    """
    reconcile_mock_env('codexqa_client')
    if _real_codexqa_ok():
        return False
    if _env_truthy('CODEXQA_FORCE_MOCK'):
        return True
    if _env_truthy('CODEXQA_MOCK') or _env_truthy('AID_ALLOW_CODEXQA_MOCK'):
        return True
    return False


def assert_codexqa_mandate(cfg=None, languages=None, caller='collect'):
    """Hard gate: graph_provider must be CodexQA for all languages.

    Does not change SAST/lint/secrets adapters — only blocks alternate
    homemade / language-specific code-graph engines.
    """
    cfg = cfg or {}
    cqa = cfg.get('codexqa') if isinstance(cfg.get('codexqa'), dict) else {}
    gp = (cfg.get('graph_provider') or GRAPH_PROVIDER).strip().lower()
    langs = languages
    if isinstance(langs, dict):
        langs = langs.get('languages') or langs.get('primary')
    lang_note = langs if langs is not None else 'any'
    if gp != GRAPH_PROVIDER:
        raise CodexQAError(
            '%s: graph_provider=%r forbidden under polyglot mandate — '
            'all languages must use CodexQA for underlying code analysis '
            '(languages=%s). See references/codexqa-cli.md'
            % (caller, gp, lang_note))
    # Explicit opt-out is tests-only; still warn so production configs stay honest.
    if cqa.get('polyglot_mandate') is False:
        print('%s: WARNING polyglot_mandate=false — CodexQA still required for graph'
              % caller, file=sys.stderr)
    return True


def graph_engine_meta(lang_info=None):
    """Standard collect/report metadata: engine + languages (backward-compatible)."""
    info = lang_info if isinstance(lang_info, dict) else {}
    langs = info.get('languages') if isinstance(info.get('languages'), list) else []
    return {
        'engine': GRAPH_PROVIDER,
        'graph_provider': GRAPH_PROVIDER,
        'polyglot_mandate': True,
        'primary_language': info.get('primary') or 'unknown',
        'languages': langs,
        'language_counts': info.get('counts') if isinstance(info.get('counts'), dict) else {},
        'language_scores': info.get('scores') if isinstance(info.get('scores'), dict) else {},
        'language_confidence': info.get('confidence') or 'low',
        'language_source': info.get('source') or 'unknown',
        'language_verified': bool(info.get('verified')),
    }


def prepare_polyglot_codexqa(repo, cfg=None, files=None, caller='collect',
                             language_hint=None):
    """Detect primary language → assert mandate → ensure CLI."""
    from lib import normalize_language_id
    cfg = cfg or {}
    hint = language_hint
    if not hint:
        hint = cfg.get('primary_language')
    if not hint:
        hint = os.environ.get('AID_PRIMARY_LANGUAGE')
    hint = normalize_language_id(hint) or None
    lang_info = detect_repo_languages(
        repo, files=files, exclude_paths=(cfg.get('exclude_paths') or []),
        language_hint=hint)
    assert_codexqa_mandate(cfg, languages=lang_info, caller=caller)
    auto = True
    cqa = cfg.get('codexqa') if isinstance(cfg.get('codexqa'), dict) else {}
    if 'auto_install' in cqa:
        auto = bool(cqa.get('auto_install'))
    ensure_codexqa(auto_install=auto)
    primary = lang_info.get('primary') or 'unknown'
    conf = lang_info.get('confidence') or '?'
    top = ','.join(
        '%s:%d' % (x.get('lang'), x.get('count', 0))
        for x in (lang_info.get('languages') or [])[:5]) or primary
    print('%s: primary_language=%s confidence=%s source=%s langs=%s'
          % (caller, primary, conf, lang_info.get('source'), top), file=sys.stderr)
    if primary == 'unknown' or conf == 'low':
        print('%s: WARNING low-confidence primary language — set config '
              'primary_language / --language / AID_PRIMARY_LANGUAGE if wrong'
              % caller, file=sys.stderr)
    return lang_info


def _mock_result(stdout='', returncode=0, stderr=''):
    return SimpleNamespace(stdout=stdout, stderr=stderr, returncode=returncode)


def _normalize_symbol(node):
    """Unify 0.1.x Node fields (file_path) with legacy callers (file/path)."""
    if not isinstance(node, dict):
        return {}
    out = dict(node)
    fp = out.get('file_path') or out.get('file') or out.get('path') or ''
    if fp:
        out.setdefault('file', fp)
        out.setdefault('path', fp)
    return out


def _text_from_payload(data, max_chars=None):
    """Extract code text from Source / snippet / legacy dict shapes."""
    if not isinstance(data, dict):
        return ''
    if data.get('kind') == 'Empty':
        return ''
    text = data.get('text') or data.get('source') or data.get('snippet') or ''
    text = text or ''
    if max_chars is not None:
        return text[:max_chars]
    return text


def _as_list(data, *keys):
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for k in keys:
        v = data.get(k)
        if isinstance(v, list):
            return v
    v = data.get('data')
    return v if isinstance(v, list) else []


def _reach_nodes(data):
    """Flatten GraphReach result → list of normalized node dicts."""
    if not isinstance(data, dict):
        return []
    result = data.get('result')
    if not isinstance(result, dict):
        return [_normalize_symbol(n) for n in _as_list(data, 'nodes', 'items', 'results', 'reach')]
    nodes, seen = [], set()
    root = result.get('root')
    if isinstance(root, dict):
        nid = root.get('id') or ''
        if nid not in seen:
            seen.add(nid)
            nodes.append(_normalize_symbol(root))
    for hop in result.get('hops') or []:
        if not isinstance(hop, list):
            continue
        for n in hop:
            if not isinstance(n, dict):
                continue
            nid = n.get('id') or ''
            if nid in seen:
                continue
            seen.add(nid)
            nodes.append(_normalize_symbol(n))
    for e in result.get('edges') or []:
        if not isinstance(e, dict):
            continue
        for key, fkey in (('to_id', 'to_file'), ('from_id', 'from_file')):
            nid = e.get(key) or ''
            if not nid or nid in seen:
                continue
            seen.add(nid)
            nodes.append(_normalize_symbol({
                'id': nid,
                'file': e.get(fkey) or '',
                'name': '',
                'kind': e.get('kind') or 'edge-endpoint',
            }))
    return nodes


def _mock_repo_state(repo):
    """Derive a minimal but realistic CodexQA 0.1.x-shaped graph from the target repo tree."""
    repo = os.path.abspath(repo or '.')
    files = []
    for root, dirs, names in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'vendor', '__pycache__')]
        for n in names:
            if n.endswith(('.py', '.js', '.ts', '.go', '.java', '.rs')):
                rel = os.path.relpath(os.path.join(root, n), repo).replace(os.sep, '/')
                files.append(rel)
    files = sorted(files)[:40] or ['src/app.py']
    symbols = []
    for i, f in enumerate(files):
        base = os.path.splitext(os.path.basename(f))[0]
        symbols.append({
            'id': 'sym-%d' % i,
            'name': base if base.replace('_', '').isalnum() else ('fn_%d' % i),
            'file_path': f,
            'file': f,
            'path': f,
            'kind': 'function',
            'change_status': 'change' if i == 0 else ('add' if i == 1 else 'default'),
            'from_count': max(0, len(files) - i - 1),
            'to_count': 1 if i else 0,
            'tested_count': 0 if i < 2 else 1,
            'start_line': 0,
            'end_line': 20,
        })
    return {'repo': repo, 'files': files, 'symbols': symbols}


def _mock_query(repo, qargs):
    """Return JSON string for `codexqa query --repo <repo> <qargs…>` (0.1.x shapes)."""
    mock_dir = os.environ.get('CODEXQA_MOCK_DIR', '').strip()
    kind = qargs[0] if qargs else 'summary'
    if mock_dir:
        for name in ('__'.join(qargs).replace('/', '_') + '.json', kind + '.json'):
            path = os.path.join(mock_dir, name)
            if os.path.exists(path):
                return open(path, encoding='utf-8').read()

    st = _mock_repo_state(repo)
    syms = st['symbols']
    files = st['files']

    def by_id(sid):
        for s in syms:
            if s['id'] == sid:
                return s
        return syms[0] if syms else {
            'id': sid, 'name': 'unknown', 'file_path': files[0], 'file': files[0],
        }

    args = list(qargs)

    def flag(name, default=None):
        if name in args:
            i = args.index(name)
            return args[i + 1] if i + 1 < len(args) else default
        return default

    if kind == 'summary':
        return json.dumps({
            'kind': 'Summary',
            'repo': os.path.basename(st['repo']),
            'files_total': len(files),
            'nodes_total': len(syms),
            'edges_total': max(0, len(syms) - 1),
            'mock': True,
        })
    if kind == 'symbols':
        change = flag('--change')
        fcont = flag('--file-contains')
        out = list(syms)
        if change:
            want = set(change.split(','))
            out = [s for s in syms if s.get('change_status') in want]
        if fcont:
            out = [s for s in out if fcont in (s.get('file_path') or s.get('file') or '')]
        return json.dumps({'kind': 'Nodes', 'nodes': out, 'tags': [], 'mock': True})
    if kind == 'change-groups':
        groups = []
        for i, f in enumerate(files[:3]):
            fs = [s for s in syms if (s.get('file_path') or s.get('file')) == f]
            groups.append({
                'group_id': 'g%d' % i,
                'symbols': [s['id'] for s in fs],
                'files': [f],
                'signals': {'fan_in': max((int(s.get('from_count') or 0) for s in fs), default=0)},
            })
        return json.dumps({
            'kind': 'ChangeGroups',
            'result': {
                'groups': groups,
                'inter_group_edges': [],
                'total_symbols': len(syms),
                'total_files': len(files),
            },
            'mock': True,
        })
    if kind == 'symbol-diff':
        sid = flag('--id', 'sym-0')
        s = by_id(sid)
        diff_text = '+def %s():\n+    pass\n' % s.get('name')
        return json.dumps({
            'kind': 'SymbolDiff',
            'result': {
                'file_path': s.get('file_path') or s.get('file'),
                'node_name': s.get('name'),
                'diff': diff_text,
                'diff_lines': 2,
                'truncated': False,
            },
            'mock': True,
        })
    if kind == 'symbol':
        sid = flag('--id', 'sym-0')
        s = by_id(sid)
        return json.dumps({'kind': 'NodeDetail', 'node': s, 'tags': [], 'mock': True})
    if kind == 'edges':
        sid = flag('--id', 'sym-0')
        direction = flag('--direction', 'in')
        edges = []
        for o in syms:
            if o['id'] == sid:
                continue
            if direction == 'in':
                edges.append({
                    'from_id': o['id'], 'to_id': sid, 'kind': 'calls',
                    'from_file': o['file_path'], 'to_file': by_id(sid).get('file_path', ''),
                })
            else:
                edges.append({
                    'from_id': sid, 'to_id': o['id'], 'kind': 'calls',
                    'from_file': by_id(sid).get('file_path', ''), 'to_file': o['file_path'],
                })
            if len(edges) >= 5:
                break
        return json.dumps({'kind': 'Edges', 'edges': edges, 'mock': True})
    if kind == 'reach':
        sid = flag('--id', 'sym-0')
        nodes = [_normalize_symbol(s) for s in syms[:8]]
        root = by_id(sid)
        return json.dumps({
            'kind': 'GraphReach',
            'result': {
                'root': root,
                'hops': [nodes[1:4], nodes[4:7]],
                'edges': [],
                'actual_depth': 2,
            },
            'mock': True,
        })
    if kind == 'imports':
        f = flag('--file', files[0])
        direction = flag('--direction', 'in')
        others = [x for x in files if x != f][:5]
        imports = []
        for o in others:
            if direction == 'in':
                imports.append({'from_file': o, 'to_file': f, 'kind': 'import'})
            else:
                imports.append({'from_file': f, 'to_file': o, 'kind': 'import'})
        return json.dumps({'kind': 'Imports', 'imports': imports, 'mock': True})
    if kind == 'source':
        sid = flag('--id', 'sym-0')
        s = by_id(sid)
        body = (
            'def %s():\n'
            '    """related implementation (codexqa-mock)"""\n'
            '    return 1\n' % s.get('name'))
        return json.dumps({
            'kind': 'Source', 'text': body,
            'start_line': s.get('start_line', 0),
            'end_line': s.get('end_line', 20),
            'mock': True,
        })
    if kind == 'snippet':
        f = flag('--file', files[0])
        start = int(flag('--start', '0') or 0)
        end = int(flag('--end', '30') or 30)
        lines = ['# %s L%d' % (f, i) for i in range(start, end)]
        text = '\n'.join(lines) + '\n'
        return json.dumps({
            'kind': 'Source', 'text': text, 'start_line': start, 'end_line': end, 'mock': True,
        })
    if kind == 'file-source':
        f = flag('--file', files[0])
        text = '# file-source mock for %s\ndef entry():\n    pass\n' % f
        return json.dumps({'kind': 'Source', 'text': text, 'start_line': 0, 'end_line': 40, 'mock': True})
    if kind == 'file-base':
        f = flag('--file', files[0])
        return json.dumps({'kind': 'Source', 'text': '', 'start_line': 0, 'end_line': 0, 'mock': True})
    if kind == 'search':
        q = flag('--query', '')
        results = []
        for s in syms[:5]:
            results.append({
                'path': s['file_path'],
                'score': 0.9,
                'snippet': 'match %s for %s' % (s['name'], q),
                'start_line': 0,
                'end_line': 10,
            })
        return json.dumps({'kind': 'Bm25Search', 'results': results, 'mock': True})
    if kind == 'file':
        f = flag('--file', files[0])
        return json.dumps({
            'kind': 'FileDetail',
            'path': f, 'lang': 'python', 'symbol_count': 2,
            'from_count': 3, 'to_count': 1, 'summary': 'mock file card',
            'mock': True,
        })
    if kind == 'path':
        return json.dumps({'kind': 'ShortestPath', 'hops': 2, 'nodes': [flag('--from'), flag('--to')], 'mock': True})
    return json.dumps({'mock': True, 'kind': kind, 'args': qargs})


def _mock_run(args):
    """Handle full argv after binary name: index|query|stats|…"""
    if not args:
        return _mock_result('codexqa-mock\n', 0)
    cmd = args[0]
    if cmd in ('--help', '-h', '--version'):
        return _mock_result('codexqa mock 0.1.0\n', 0)
    if cmd == 'index':
        return _mock_result('indexed (mock)\n', 0)
    if cmd == 'stats':
        repo = args[1] if len(args) > 1 else '.'
        st = _mock_repo_state(repo)
        return _mock_result('files=%d symbols=%d mock=1\n' % (len(st['files']), len(st['symbols'])), 0)
    if cmd == 'query':
        repo = '.'
        rest = args[1:]
        if '--repo' in rest:
            i = rest.index('--repo')
            repo = rest[i + 1]
            rest = rest[:i] + rest[i + 2:]
        return _mock_result(_mock_query(repo, rest), 0)
    return _mock_result('{"mock": true}\n', 0)


def ensure_codexqa(auto_install=True):
    """Locate codexqa on PATH; optionally run the official npm install once."""
    reconcile_mock_env('ensure_codexqa')
    if mock_enabled():
        return 'codexqa-mock'
    exe = _which_codexqa()
    if not exe:
        try:
            prefix = subprocess.check_output(['npm', 'prefix', '-g'], text=True).strip()
            candidate = os.path.join(prefix, 'bin', 'codexqa')
            if os.path.exists(candidate):
                exe = candidate
        except Exception:
            pass
    if not exe:
        if not auto_install:
            raise CodexQAError(
                'codexqa CLI not found. Install via:\n'
                '  bash scripts/install_codexqa.sh\n'
                '  # or: npm install -g @openqa-cn/codexqa@latest --registry https://registry.npmjs.org/\n'
                'Or set CODEXQA_FORCE_MOCK=1 to verify upper layers with mocked graph JSON.\n'
                'Note: upstream currently ships macOS Apple Silicon (darwin-arm64) binaries.')
        print('codexqa not on PATH — installing @openqa-cn/codexqa@latest via npm …', file=sys.stderr)
        r = subprocess.run(
            ['npm', 'install', '-g', '@openqa-cn/codexqa@latest',
             '--registry', 'https://registry.npmjs.org/'],
            capture_output=True, text=True)
        if r.returncode != 0:
            raise CodexQAError('npm install @openqa-cn/codexqa failed:\n' + (r.stderr or r.stdout))
        # Stale daemon may still serve an older platform binary — stop before use.
        subprocess.run([_which_codexqa() or 'codexqa', 'stop'],
                       capture_output=True, text=True, timeout=30)
        exe = _which_codexqa()
        if not exe:
            try:
                prefix = subprocess.check_output(['npm', 'prefix', '-g'], text=True).strip()
                exe = os.path.join(prefix, 'bin', 'codexqa')
            except Exception:
                exe = None
        if not exe or not os.path.exists(exe):
            raise CodexQAError('codexqa still missing after npm install')
    smoke = subprocess.run([exe, '--help'], capture_output=True, text=True)
    if smoke.returncode != 0:
        err = (smoke.stderr or smoke.stdout or '').strip()
        raise CodexQAError(
            'codexqa present but failed to launch (platform binary missing?).\n'
            'Run: bash scripts/install_codexqa.sh\n'
            'Or set CODEXQA_FORCE_MOCK=1 to verify upper layers with mocked graph JSON.\n'
            + err)
    return exe


def run_codexqa(args, timeout=600, check=True):
    """Run `codexqa <args…>`; return CompletedProcess-like. Parses nothing."""
    if mock_enabled():
        r = _mock_run(list(args))
        if check and r.returncode != 0:
            raise CodexQAError('codexqa-mock %s failed: %s' % (args[:3], r.stderr))
        return r
    exe = ensure_codexqa(auto_install=True)
    cmd = [exe] + list(args)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise CodexQAError('codexqa %s failed (exit %d):\n%s\n%s'
                           % (' '.join(args[:4]), r.returncode, r.stderr, r.stdout[:2000]))
    return r


def query_json(repo, *qargs, timeout=300):
    """`codexqa query --repo <repo> …` → parsed JSON (object or list)."""
    r = run_codexqa(['query', '--repo', repo, *qargs], timeout=timeout)
    text = (r.stdout or '').strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        for line in reversed(text.splitlines()):
            line = line.strip()
            if line.startswith('{') or line.startswith('['):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise CodexQAError('codexqa query returned non-JSON:\n' + text[:1500])


def index_repo(repo, diff_base=None, full=False, timeout=1800):
    """Build / refresh CodexQA index. For change analysis ALWAYS pass diff_base."""
    args = ['index', repo]
    if full:
        args.append('--full')
    if diff_base:
        args += ['--diff-base', diff_base]
    return run_codexqa(args, timeout=timeout)


def stats(repo):
    r = run_codexqa(['stats', repo], check=False)
    return r.stdout


def _normalize_change_groups(data):
    """Parse ChangeGroups JSON (references/codexqa-cli.md) → internal group list."""
    if not isinstance(data, dict):
        return []
    if data.get('kind') == 'ChangeGroups':
        result = data.get('result') or {}
        groups = result.get('groups') or []
        out = []
        for i, g in enumerate(groups):
            if not isinstance(g, dict):
                continue
            files = g.get('files') or []
            signals = g.get('signals') if isinstance(g.get('signals'), dict) else {}
            out.append({
                'id': g.get('group_id') or ('g%d' % i),
                'file': files[0] if files else 'unknown',
                'files': files,
                'symbols': g.get('symbols') or [],
                'fan_in': int(signals.get('fan_in') or signals.get('max_fan_in') or 0),
                'signals': signals,
            })
        return out
    if isinstance(data, dict):
        return data.get('groups') or data.get('change_groups') or []
    return data if isinstance(data, list) else []


def _normalize_symbol_diff(data, symbol_id, max_lines=200):
    """Parse SymbolDiff JSON → dict consumed by collect_incremental."""
    if not isinstance(data, dict):
        return None
    if data.get('kind') == 'Empty':
        return {'id': symbol_id, 'file': '', 'name': '', 'diff': '', 'truncated': False}
    if data.get('kind') == 'SymbolDiff':
        result = data.get('result') or {}
        fp = result.get('file_path') or ''
        diff_text = result.get('diff') or ''
        cap = max_lines * 80
        return {
            'id': symbol_id,
            'file': fp,
            'name': result.get('node_name') or '',
            'diff': diff_text[:cap],
            'diff_lines': result.get('diff_lines'),
            'truncated': bool(result.get('truncated')),
            'current': diff_text[:cap],
        }
    # legacy flat shape
    if data.get('diff') is not None or data.get('file'):
        cap = max_lines * 80
        diff_text = data.get('diff') or data.get('current') or ''
        return {
            'id': symbol_id,
            'file': data.get('file') or data.get('file_path') or '',
            'name': data.get('name') or data.get('node_name') or '',
            'diff': diff_text[:cap],
            'current': diff_text[:cap],
            'truncated': bool(data.get('truncated')),
        }
    return None


# ---------- Graph projections used by codexqa-defect-analyzer (thin adapters over CLI) ----------

def changed_symbols(repo, kinds=('function', 'method')):
    """Symbols with change_status add/change (requires index --diff-base)."""
    data = query_json(repo, 'symbols', '--change', 'add,change',
                      '--kind', ','.join(kinds))
    return [_normalize_symbol(n) for n in _as_list(data, 'nodes', 'symbols', 'items', 'results')]


def change_groups(repo):
    """`codexqa query change-groups` (requires index --diff-base)."""
    data = query_json(repo, 'change-groups')
    return _normalize_change_groups(data)


def symbol_diff(repo, symbol_id, max_lines=200):
    """`codexqa query symbol-diff --id` (requires index --diff-base)."""
    data = query_json(repo, 'symbol-diff', '--id', symbol_id,
                      '--max-lines', str(min(max_lines, 500)))
    parsed = _normalize_symbol_diff(data, symbol_id, max_lines=max_lines)
    if parsed is None:
        raise CodexQAError('symbol-diff returned unexpected payload for %s' % symbol_id)
    return parsed


def edges(repo, symbol_id, direction='in'):
    data = query_json(repo, 'edges', '--id', symbol_id, '--direction', direction)
    return _as_list(data, 'edges', 'items', 'results')


def reach(repo, symbol_id, direction='in', depth=2, edge_kinds=None):
    args = ['reach', '--id', symbol_id, '--direction', direction, '--depth', str(depth)]
    if edge_kinds:
        args += ['--edge-kinds', edge_kinds]
    data = query_json(repo, *args)
    return _reach_nodes(data)


def imports(repo, file_path, direction='in'):
    data = query_json(repo, 'imports', '--file', file_path, '--direction', direction)
    return _as_list(data, 'imports', 'edges', 'items', 'results')


def summary(repo):
    return query_json(repo, 'summary')


def symbols_in_file(repo, file_contains):
    data = query_json(repo, 'symbols', '--file-contains', file_contains)
    return [_normalize_symbol(n) for n in _as_list(data, 'nodes', 'symbols', 'items', 'results')]


def all_symbols_fanin(repo, limit=500):
    """Best-effort: symbols list with from_count for hot-score fan-in."""
    data = query_json(repo, 'symbols', '--kind', 'function,method')
    items = [_normalize_symbol(n) for n in _as_list(data, 'nodes', 'symbols', 'items', 'results')]

    def fan(s):
        return int(s.get('from_count') or s.get('fan_in') or s.get('to_count') or 0)

    items.sort(key=fan, reverse=True)
    return items[:limit]


def linked_files_for_changes(repo, changed_paths, max_linked=15):
    """
    Cross-file correlation via CodexQA ONLY:
      changed symbols → edges/reach inward → unique caller files.
    """
    linked, seen = [], set(changed_paths)
    syms = changed_symbols(repo)
    if not syms:
        for p in changed_paths[:20]:
            syms += symbols_in_file(repo, p)
    for s in syms[:40]:
        sid = s.get('id') or s.get('symbol_id')
        if not sid:
            continue
        callers = edges(repo, sid, direction='in')
        if not callers:
            callers = reach(repo, sid, direction='in', depth=2)
        for c in callers:
            sid2, name, path = _node_fields(c)
            if not path or path in seen:
                continue
            seen.add(path)
            sig = ''
            if sid2:
                try:
                    sig = fetch_source(repo, sid2)
                except CodexQAError:
                    sig = ''
            linked.append({
                'path': path,
                'functions': [name] if name else [],
                'via': 'codexqa',
                'symbol_id': sid2 or '',
                'signature_view': sig or ('# codexqa caller: %s in %s' % (name, path)),
            })
            if len(linked) >= max_linked:
                return linked
    for p in changed_paths[:10]:
        for edge in imports(repo, p, direction='in')[:5] + imports(repo, p, direction='out')[:5]:
            path = import_neighbor_path(edge, p)
            if path and path not in seen:
                seen.add(path)
                linked.append({
                    'path': path, 'functions': [], 'via': 'codexqa-imports',
                    'symbol_id': '', 'signature_view': '# import edge from codexqa',
                })
            if len(linked) >= max_linked:
                return linked
    return linked


def fetch_source(repo, symbol_id, max_chars=4000):
    """`codexqa query source --id` → implementation text."""
    if not symbol_id:
        return ''
    data = query_json(repo, 'source', '--id', symbol_id)
    return _text_from_payload(data, max_chars=max_chars)


def fetch_snippet(repo, file_path, start=0, end=40, max_chars=4000):
    """`codexqa query snippet --file --start --end` → line-range code."""
    if not file_path:
        return ''
    try:
        data = query_json(repo, 'snippet', '--file', file_path,
                          '--start', str(start), '--end', str(end))
    except CodexQAError:
        try:
            data = query_json(repo, 'file-source', '--file', file_path)
        except CodexQAError:
            return ''
    return _text_from_payload(data, max_chars=max_chars)


def search_hits(repo, query, limit=8):
    """`codexqa query search --query` → relevance hits (paths + snippets)."""
    if not (query or '').strip():
        return []
    data = query_json(repo, 'search', '--query', query.strip(), '--limit', str(limit))
    results = _as_list(data, 'results', 'hits', 'items', 'matches')
    hits = []
    for r in results:
        if not isinstance(r, dict):
            continue
        path = r.get('path') or r.get('file') or ''
        hits.append({
            'id': r.get('id') or '',
            'name': r.get('name') or '',
            'file': path,
            'path': path,
            'score': r.get('score', 0),
            'preview': r.get('snippet') or r.get('preview') or '',
            'start_line': r.get('start_line'),
            'end_line': r.get('end_line'),
        })
    return hits[:limit]


def _node_fields(node):
    """Normalize edges/reach/search hit → (id, name, file)."""
    if not isinstance(node, dict):
        return '', '', ''
    if node.get('from_id') or node.get('to_id'):
        sid = node.get('to_id') or node.get('from_id') or ''
        path = node.get('to_file') or node.get('from_file') or ''
        return sid, '', path
    inner = node.get('node') or node.get('from') or node.get('to') or {}
    if not isinstance(inner, dict):
        inner = {}
    sid = (node.get('id') or inner.get('id') or node.get('symbol_id') or '')
    name = (node.get('name') or inner.get('name') or node.get('symbol') or '')
    path = (node.get('file') or node.get('path') or node.get('file_path') or
            inner.get('file') or inner.get('file_path') or
            node.get('from_file') or node.get('to_file') or '')
    return sid, name, path


def import_neighbor_path(edge, self_path=''):
    """CodexQA import row (from_file → to_file) → the file that is not self_path.

    `_node_fields` prefers from_file, which is the query file on direction=out and
    would skip every outbound import as a self-hit. Use this for import neighbors.
    """
    if not isinstance(edge, dict):
        return ''
    src = (edge.get('from_file') or '').replace('\\', '/').lstrip('./')
    dst = (edge.get('to_file') or '').replace('\\', '/').lstrip('./')
    self_n = (self_path or '').replace('\\', '/').lstrip('./')
    if self_n:
        if src == self_n:
            return dst
        if dst == self_n:
            return src
    if dst and dst != self_n:
        return dst
    if src and src != self_n:
        return src
    return dst or src


def rag_related_snippets(repo, changed_paths, intent='', max_items=8, max_chars=3500,
                         use_changed_symbols=True):
    """
    L3 RAG: pull *related code snippets* from CodexQA only.

    Incremental (use_changed_symbols=True, default): git changed symbols first.
    Full / shard seeds (use_changed_symbols=False): symbols_in_file(seeds) first so
    worker/index.ts neighbors are retrieved instead of an unrelated working-tree diff.

    Judgment intent reserves up to 2 slots for search so concurrency terms actually land.
    Each item is tagged with `seed` (the seed file that produced it).
    """
    out, seen_keys = [], set()
    seeds = list(changed_paths or [])
    changed = set(seeds)
    current_seed = {'path': ''}
    intent_q = (intent or '').strip()
    want_search = bool(intent_q) and any(k in intent_q.lower() for k in (
        'concurr', 'lock', 'transaction', 'atomic', 'race', 'auth', 'permission',
        'deadlock', 'queue'))
    reserve = 2 if want_search and max_items >= 4 else 0
    graph_limit = max(1, max_items - reserve)

    def add_item(path, name, relation, snippet, via, cap=None):
        limit = max_items if cap is None else cap
        if len(out) >= limit:
            return True
        if not snippet or not snippet.strip():
            return False
        key = '%s::%s' % (path, name or os.path.basename(path or ''))
        if key in seen_keys:
            return False
        if path in changed and relation.startswith('self'):
            return False
        seen_keys.add(key)
        out.append({
            'path': path or '(unknown)',
            'name': name or '',
            'relation': relation,
            'via': via,
            'seed': current_seed['path'],
            'snippet': snippet.strip()[:max_chars],
            'summary': snippet.strip()[:max_chars],
        })
        return len(out) >= limit

    def walk_related(syms, cap):
        for s in (syms or [])[:40]:
            sid = s.get('id') or s.get('symbol_id')
            if not sid:
                continue
            if s.get('file') or s.get('path'):
                current_seed['path'] = s.get('file') or s.get('path') or current_seed['path']
            related = edges(repo, sid, direction='in')[:6]
            related += edges(repo, sid, direction='out')[:4]
            if len(related) < 2:
                related += reach(repo, sid, direction='in', depth=2)[:8]
            for node in related:
                cid, cname, cpath = _node_fields(node)
                if cpath and cpath in changed:
                    continue
                code = fetch_source(repo, cid) if cid else ''
                if not code and cpath:
                    code = fetch_snippet(repo, cpath, 0, 40)
                if add_item(cpath, cname, 'caller/callee', code, 'codexqa-source', cap=cap):
                    return True
        return False

    syms = []
    if use_changed_symbols:
        try:
            syms = changed_symbols(repo)
        except CodexQAError:
            syms = []
    if not syms:
        for p in seeds[:20]:
            current_seed['path'] = p
            try:
                syms += symbols_in_file(repo, p)
            except CodexQAError:
                continue
    walk_related(syms, graph_limit)

    if len(out) < graph_limit:
        for p in seeds[:12]:
            current_seed['path'] = p
            try:
                neigh = imports(repo, p, direction='in')[:5] + imports(repo, p, direction='out')[:5]
            except CodexQAError:
                continue
            for edge in neigh:
                path = import_neighbor_path(edge, p)
                if not path or path in changed:
                    continue
                code, name = '', ''
                try:
                    for fs in symbols_in_file(repo, path)[:3]:
                        fid = fs.get('id') or fs.get('symbol_id')
                        name = fs.get('name') or name
                        code = fetch_source(repo, fid) if fid else ''
                        if code:
                            break
                except CodexQAError:
                    pass
                if not code:
                    code = fetch_snippet(repo, path, 0, 50)
                if add_item(path, name, 'import-neighbor', code, 'codexqa-snippet',
                            cap=graph_limit):
                    break
            if len(out) >= graph_limit:
                break

    q = intent_q
    if not q and seeds:
        q = ' OR '.join(os.path.splitext(os.path.basename(p))[0]
                        for p in seeds[:4] if p)
    if q and len(out) < max_items:
        current_seed['path'] = seeds[0] if seeds else ''
        try:
            for hit in search_hits(repo, q, limit=max_items):
                hid, hname, hpath = _node_fields(hit)
                if hpath and hpath in changed:
                    continue
                code = fetch_source(repo, hid) if hid else ''
                if not code and hpath:
                    code = fetch_snippet(repo, hpath, 0, 40)
                if not code:
                    code = (hit.get('preview') or hit.get('snippet') or '')[:max_chars]
                if add_item(hpath, hname, 'search:%s' % q[:40], code, 'codexqa-search'):
                    break
        except CodexQAError:
            pass

    return out


def rag_module_summaries(repo, changed_paths, max_items=8, intent=''):
    """Backward-compatible alias → rag_related_snippets (CodexQA code snippets)."""
    return rag_related_snippets(repo, changed_paths, intent=intent, max_items=max_items)


def file_fan_in_map(repo):
    """Map file path → max from_count from CodexQA symbols (dependency fan-in)."""
    m = {}
    for s in all_symbols_fanin(repo, limit=2000):
        path = s.get('file') or s.get('path') or s.get('file_path') or ''
        if not path:
            continue
        fan = int(s.get('from_count') or s.get('fan_in') or 0)
        m[path] = max(m.get(path, 0), fan)
    return m
