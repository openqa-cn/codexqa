#!/usr/bin/env python3
"""Shared helpers for codexqa-defect-analyzer."""
import fnmatch, hashlib, json, math, os, re, subprocess, sys
from datetime import datetime

# Require CPython 3.10+. Re-exec onto python3.10+ when system `python3` is too old.
MIN_PYTHON = (3, 10)
REQUIRED_PYTHON = MIN_PYTHON  # alias: minimum supported (not an exact pin)
_AID_PY_REEXEC_ENV = 'AID_PYTHON_MIN_REEXEC'
# Prefer commonly provisioned runtimes first, then newer, then plain python3.
_PYTHON_CANDIDATE_NAMES = (
    'python3.12', 'python3.11', 'python3.10',
    'python3.13', 'python3.14',
    'python3',
)


def _interpreter_version(exe):
    """Return (major, minor) for an interpreter path, or None.

    Must stay compatible when *this* process is still on Python <3.10
    (system `python3` is often 3.6) so we can discover a newer binary and re-exec.
    """
    try:
        # Avoid text=/timeout= kwargs that break on very old Python 3.6 subprocess.
        out = subprocess.check_output(
            [exe, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'],
            stderr=subprocess.PIPE)
        if not isinstance(out, str):
            out = out.decode('utf-8', 'replace')
        parts = (out or '').strip().split('.')
        return int(parts[0]), int(parts[1])
    except Exception:
        return None


def _interpreter_has_yaml(exe):
    """True if exe can import PyYAML (optional skill dependency for scope_policy)."""
    try:
        subprocess.check_output(
            [exe, '-c', 'import yaml'],
            stderr=subprocess.PIPE)
        return True
    except Exception:
        return False


def resolve_python(min_version=None):
    """Return absolute path to a Python >= min_version (default 3.10), or None."""
    import shutil
    min_version = min_version or MIN_PYTHON
    if sys.version_info[:2] >= min_version:
        return os.path.abspath(sys.executable)
    seen = set()
    candidates = []
    for name in _PYTHON_CANDIDATE_NAMES:
        exe = shutil.which(name)
        if not exe:
            continue
        exe = os.path.abspath(exe)
        if exe in seen:
            continue
        seen.add(exe)
        ver = _interpreter_version(exe)
        if ver and ver >= min_version:
            candidates.append(exe)
    if not candidates:
        return None
    # Prefer an interpreter that already has PyYAML when several 3.10+ exist
    for exe in candidates:
        if _interpreter_has_yaml(exe):
            return exe
    return candidates[0]


# Back-compat names used by older call sites / docs snippets
def resolve_python311():
    return resolve_python()


def python_executable():
    """Interpreter for subprocesses — current if >=3.10, else first PATH hit >=3.10."""
    return resolve_python() or sys.executable


def ensure_min_python():
    """Re-exec under Python >=3.10 when the current interpreter is too old."""
    if sys.version_info[:2] >= MIN_PYTHON:
        return
    if os.environ.get(_AID_PY_REEXEC_ENV) == '1':
        sys.stderr.write(
            'FATAL: Python >=3.10 re-exec loop (still on Python %s.%s at %s).\n'
            % (sys.version_info[0], sys.version_info[1], sys.executable)
        )
        sys.exit(1)
    exe = resolve_python()
    if not exe:
        sys.stderr.write(
            'FATAL: codexqa-defect-analyzer requires Python 3.10+ on PATH '
            '(found Python %s.%s at %s).\n'
            'Install python3.10 or newer (python3.10 / python3.11 / python3.12…), then retry.\n'
            % (sys.version_info[0], sys.version_info[1], sys.executable)
        )
        sys.exit(1)
    env = os.environ.copy()
    env[_AID_PY_REEXEC_ENV] = '1'
    sys.stderr.write(
        'codexqa-defect-analyzer: re-exec under Python 3.10+ (%s → %s)\n'
        % (sys.executable, exe)
    )
    sys.stderr.flush()
    os.execve(exe, [exe] + sys.argv, env)


ensure_python311 = ensure_min_python  # back-compat alias
ensure_min_python()

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

CODE_EXT = {'.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go', '.c', '.cc',
            '.cpp', '.h', '.hpp', '.rs', '.rb', '.php', '.kt', '.kts', '.swift', '.scala'}

# Extension → language id (polyglot CodexQA mandate; used by detect_repo_languages).
CODE_LANG_BY_EXT = {
    '.py': 'python',
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.java': 'java',
    '.go': 'go',
    '.c': 'c', '.h': 'c',
    '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.kt': 'kotlin', '.kts': 'kotlin',
    '.swift': 'swift',
    '.scala': 'scala',
}

# Root manifests that strongly signal engineering primary language.
# weight: added to file-count score when choosing primary (always applied).
LANG_MANIFEST_HINTS = (
    ('go.mod', 'go', 80),
    ('Gopkg.toml', 'go', 40),
    ('pom.xml', 'java', 80),
    ('build.gradle', 'java', 70),
    ('build.gradle.kts', 'java', 70),
    ('settings.gradle', 'java', 40),
    ('settings.gradle.kts', 'java', 40),
    ('tsconfig.json', 'typescript', 55),
    ('package.json', 'javascript', 35),  # may lose to typescript when .ts dominates
    ('Cargo.toml', 'rust', 80),
    ('pyproject.toml', 'python', 70),
    ('setup.py', 'python', 50),
    ('requirements.txt', 'python', 40),
    ('Pipfile', 'python', 40),
    ('Gemfile', 'ruby', 70),
    ('composer.json', 'php', 70),
    ('Package.swift', 'swift', 70),
)

# Normalize user/config aliases → canonical language ids used in reports.
LANG_ALIASES = {
    'py': 'python', 'python3': 'python', 'python2': 'python',
    'js': 'javascript', 'node': 'javascript', 'nodejs': 'javascript',
    'ts': 'typescript',
    'golang': 'go',
    'c++': 'cpp', 'cplusplus': 'cpp', 'cxx': 'cpp',
    'kt': 'kotlin', 'kts': 'kotlin',
    'rs': 'rust',
    'rb': 'ruby',
}

_SKIP_LANG_DIRS = {
    '.git', 'node_modules', 'vendor', 'dist', 'build', '__pycache__',
    '.venv', 'venv', 'target', 'third_party', 'testdata', 'generated',
    '.idea', '.vscode', 'coverage', '.next', 'out',
}

# Soft hint file written by adhoc ingest when --lang is set.
AID_SCAN_META = '.aid_scan_meta.json'

VALID_SOURCES = {'llm_judged', 'sast_confirmed', 'sast_only'}
VALID_SEVERITIES = {'P0', 'P1', 'P2', 'P3'}
EMBED_DIM = 256


def normalize_language_id(lang):
    """Map aliases to canonical ids; empty/unknown → ''."""
    if lang is None:
        return ''
    s = str(lang).strip().lower()
    if not s or s in ('unknown', 'auto', 'none', 'null'):
        return ''
    return LANG_ALIASES.get(s, s)


def detect_repo_languages(repo, files=None, exclude_paths=None, max_sample=8000,
                          language_hint=None):
    """Detect languages and resolve engineering **primary** language.

    Scoring (efficient, no AST):
      score[lang] = file_count[lang] + Σ manifest_weights[lang]
    Primary = max(score), with JS/TS and confidence rules below.

    Returns:
      {
        'primary': 'go'|…|'unknown',
        'languages': [{'lang','count','share','score'}, …],
        'counts': {lang: n},
        'scores': {lang: score},
        'sampled_files': N,
        'confidence': 'high'|'medium'|'low',
        'source': 'override'|'manifest'|'files'|'mixed'|'unknown',
        'verified': bool,
      }

    language_hint / config override / .aid_scan_meta.json force primary when set.
    """
    counts = {}
    sampled = 0
    paths = list(files or [])
    excl = exclude_paths or []
    root = os.path.abspath(repo or '.')

    def _bump(ext):
        lang = CODE_LANG_BY_EXT.get(ext.lower())
        if not lang:
            return
        counts[lang] = counts.get(lang, 0) + 1

    if paths:
        for p in paths:
            if excl and is_excluded(p, excl):
                continue
            _bump(os.path.splitext(p)[1])
            sampled += 1
    else:
        for dirpath, dirnames, names in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_LANG_DIRS]
            rel_dir = os.path.relpath(dirpath, root).replace(os.sep, '/')
            if rel_dir == '.':
                rel_dir = ''
            if excl and rel_dir and is_excluded(rel_dir + '/', excl):
                dirnames[:] = []
                continue
            for n in names:
                ext = os.path.splitext(n)[1]
                if ext.lower() not in CODE_LANG_BY_EXT:
                    continue
                rel = (rel_dir + '/' + n) if rel_dir else n
                if excl and is_excluded(rel, excl):
                    continue
                _bump(ext)
                sampled += 1
                if sampled >= max_sample:
                    break
            if sampled >= max_sample:
                break

    # Manifest scores (always — primary signal for engineering stacks).
    scores = {k: float(v) for k, v in counts.items()}
    manifest_hits = []
    for item in LANG_MANIFEST_HINTS:
        fname, lang, weight = item[0], item[1], item[2] if len(item) > 2 else 1
        if os.path.isfile(os.path.join(root, fname)):
            scores[lang] = scores.get(lang, 0.0) + float(weight)
            manifest_hits.append(fname)
            if lang not in counts:
                counts[lang] = counts.get(lang, 0)

    # Soft meta from adhoc ingest (--lang).
    meta_hint = ''
    meta_path = os.path.join(root, AID_SCAN_META)
    if os.path.isfile(meta_path):
        try:
            meta = json.load(open(meta_path, encoding='utf-8'))
            meta_hint = normalize_language_id(
                (meta or {}).get('primary_language') or (meta or {}).get('language'))
        except Exception:
            meta_hint = ''

    override = normalize_language_id(language_hint) or meta_hint

    # JS vs TS: prefer typescript when .ts/.tsx present and competitive.
    js_n, ts_n = counts.get('javascript', 0), counts.get('typescript', 0)
    if ts_n > 0 and (ts_n >= js_n * 0.25 or os.path.isfile(os.path.join(root, 'tsconfig.json'))):
        # Boost TS so package.json alone does not crown javascript.
        scores['typescript'] = scores.get('typescript', 0.0) + 25.0 + ts_n * 0.5
        if js_n and ts_n >= js_n:
            scores['javascript'] = max(0.0, scores.get('javascript', 0.0) - 20.0)

    total_files = sum(counts.values()) or 0
    languages = []
    for lang, n in sorted(counts.items(), key=lambda kv: (-scores.get(kv[0], 0), -kv[1], kv[0])):
        languages.append({
            'lang': lang,
            'count': n,
            'share': round(n / total_files, 4) if total_files else 0.0,
            'score': round(scores.get(lang, 0.0), 2),
        })
    # Include manifest-only langs with 0 files in ranking via scores
    for lang, sc in scores.items():
        if lang not in counts:
            languages.append({'lang': lang, 'count': 0, 'share': 0.0, 'score': round(sc, 2)})
    languages.sort(key=lambda x: (-x['score'], -x['count'], x['lang']))

    primary = 'unknown'
    confidence = 'low'
    source = 'unknown'
    verified = False

    if override:
        primary = override
        confidence = 'high'
        source = 'override'
        verified = True
        # Ensure override appears in languages list
        if not any(x['lang'] == primary for x in languages):
            languages.insert(0, {'lang': primary, 'count': counts.get(primary, 0),
                                 'share': 0.0, 'score': scores.get(primary, 0.0)})
    elif languages:
        primary = languages[0]['lang']
        top_sc = languages[0]['score']
        second_sc = languages[1]['score'] if len(languages) > 1 else 0.0
        top_share = languages[0]['share']
        has_manifest = bool(manifest_hits)
        if top_sc >= second_sc * 2 and top_sc >= 3:
            confidence = 'high'
            source = 'mixed' if has_manifest and total_files else (
                'manifest' if has_manifest else 'files')
            verified = True
        elif top_share >= 0.55 and total_files >= 3:
            confidence = 'high'
            source = 'files'
            verified = True
        elif has_manifest and top_sc >= second_sc:
            confidence = 'high' if top_sc >= second_sc + 30 else 'medium'
            source = 'manifest'
            verified = confidence == 'high'
        else:
            confidence = 'medium' if total_files >= 2 else 'low'
            source = 'files' if total_files else 'unknown'
            verified = False

    return {
        'primary': primary,
        'languages': languages,
        'counts': counts,
        'scores': {k: round(v, 2) for k, v in scores.items()},
        'sampled_files': sampled,
        'confidence': confidence,
        'source': source,
        'verified': verified,
        'manifest_hits': manifest_hits,
    }


def skill_dir():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def data_dir(*parts):
    return os.path.join(skill_dir(), 'data', *parts)

def load_config():
    """Prefer scan_config.yaml (design contract); fall back to legacy JSON."""
    yml = os.path.join(skill_dir(), 'config', 'scan_config.yaml')
    jsn = os.path.join(skill_dir(), 'config', 'scan_config.json')
    if os.path.exists(yml) and yaml is not None:
        with open(yml) as f:
            return yaml.safe_load(f)
    with open(jsn) as f:
        return json.load(f)

def is_excluded(path, patterns):
    p = path.replace(os.sep, '/')
    base = os.path.basename(p)
    for pat in patterns:
        if fnmatch.fnmatch(p, pat) or fnmatch.fnmatch(base, pat):
            return True
        # directory prefix: "vendor/" excludes "vendor/x.go"
        if pat.endswith('/') and (p.startswith(pat) or p == pat.rstrip('/')):
            return True
        # also allow unscoped dir name match: "vendor" → vendor/**
        if '/' not in pat.rstrip('/') and '*' not in pat and (p == pat or p.startswith(pat.rstrip('/') + '/')):
            return True
    return False

def git(repo, *args):
    return subprocess.run(['git', '-C', repo] + list(args),
                          capture_output=True, text=True)

def truncate_lines(text, max_lines):
    """Hard-cap file content by line count (design: never feed >500 lines)."""
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text, False
    kept = lines[:max_lines]
    return '\n'.join(kept) + '\n... [truncated at %d lines; original %d]\n' % (
        max_lines, len(lines)), True

def count_tokens(text):
    return max(1, len(text) // 4)

def diff_hash(text):
    return hashlib.sha256((text or '').encode('utf-8', errors='ignore')).hexdigest()

def generate_finding_id(seq, when=None):
    when = when or datetime.now()
    return 'fr-%s-%03d' % (when.strftime('%Y%m%d'), seq)

# ---------------- Embedding (lightweight hashing vector; no external model dep) ----------------

def embed_text(text, dim=EMBED_DIM):
    """Char/word n-gram hashing embedding → unit vector."""
    vec = [0.0] * dim
    s = (text or '').lower()
    toks = re.findall(r'[a-z0-9_]+', s)
    grams = toks[:]
    for t in toks:
        if len(t) >= 3:
            for i in range(len(t) - 2):
                grams.append(t[i:i+3])
    for g in grams:
        h = int(hashlib.md5(g.encode(), usedforsecurity=False).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if (h >> 8) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]

def cosine(a, b):
    return sum(x * y for x, y in zip(a, b))

# ---------------- Schema + evidence validation ----------------

def load_output_schema():
    path = os.path.join(skill_dir(), 'references', 'output_schema.json')
    with open(path) as f:
        return json.load(f)

def _schema_enums(schema):
    props = schema.get('properties', {}).get('findings', {}).get('items', {}).get('properties', {})
    cats = set(props.get('category', {}).get('enum', []) or [])
    sevs = set(props.get('severity', {}).get('enum', []) or [])
    return cats, sevs

def validate_finding_schema(f, schema=None):
    """Return list of error strings; empty means OK."""
    schema = schema or load_output_schema()
    cats, sevs = _schema_enums(schema)
    errs = []
    required = schema.get('properties', {}).get('findings', {}).get('items', {}).get('required', [])
    for k in required:
        if k not in f or f[k] in (None, ''):
            errs.append('missing required field: %s' % k)
    if 'line' in f:
        try:
            if int(f['line']) < 1:
                errs.append('line must be >= 1')
        except (TypeError, ValueError):
            errs.append('line must be integer')
    if cats and f.get('category') not in cats:
        errs.append('invalid category: %s' % f.get('category'))
    if sevs and f.get('severity') not in sevs:
        errs.append('invalid severity: %s' % f.get('severity'))
    if f.get('source') and f['source'] not in VALID_SOURCES:
        errs.append('invalid source: %s' % f.get('source'))
    if 'confidence' in f and f['confidence'] is not None:
        try:
            c = float(f['confidence'])
            if c < 0 or c > 1:
                errs.append('confidence out of range')
        except (TypeError, ValueError):
            errs.append('confidence must be number')
    if not (f.get('evidence') or '').strip():
        errs.append('evidence required')
    return errs

def verify_file_line(repo, file_path, line):
    """Secondary check: file exists and line number is in range."""
    full = os.path.join(repo, file_path) if repo else file_path
    if not os.path.isfile(full):
        return False, 'file not found: %s' % file_path
    try:
        n = sum(1 for _ in open(full, encoding='utf-8', errors='ignore'))
    except OSError as e:
        return False, str(e)
    try:
        ln = int(line)
    except (TypeError, ValueError):
        return False, 'bad line'
    if ln < 1 or ln > n:
        return False, 'line %s out of range (1..%d) in %s' % (line, n, file_path)
    return True, ''

def finding_vuln_class(f):
    """Coarse vulnerability bucket for merge/dedup (same bucket may merge; different buckets must not)."""
    text = ' '.join([
        str(f.get('title') or ''),
        str(f.get('evidence') or ''),
        str(f.get('adapter') or ''),
    ]).lower()
    buckets = (
        ('ldap', ('ldap', 'ldap-injection')),
        ('xss', ('xss', 'cross-site', 'html', 'nickname', 'renderprofile')),
        ('sqli', ('sqli', 'sql injection', 'jdbc-sqli', 'formatted-sql', 'second-order')),
        ('path_traversal', ('path traversal', 'path-traversal', 'aid-java-path-traversal')),
        ('command_injection', ('command injection', 'runtime.exec', 'processbuilder')),
        ('xxe', ('xxe', 'documentbuilder', 'doctype')),
        ('deserial', ('deserial', 'objectinputstream')),
        ('crypto_weak', ('md5', 'ecb', 'cipher', 'padding-oracle', 'weak hash', 'aes/')),
        ('tls', ('ssl', 'tls', 'trust-manager', 'hostname-verifier', 'weak-ssl')),
        ('secret', ('secret', 'jwt', 'gitleaks', 'private-key', 'password', 'token', 'api_key')),
        ('ssrf', ('ssrf', 'webhook', 'callbackurl', 'callback')),
        ('resource_leak', ('resource leak', 'resource_leak', 'not closed', 'try-with-resources')),
        ('redirect', ('open redirect', 'redirect')),
        ('redos', ('redos', 'backtracking', '(a+)+')),
    )
    for name, keys in buckets:
        if any(k in text for k in keys):
            return name
    return 'other'


def findings_merge_compatible(s, l, line_window=3):
    """True when SAST and LLM findings describe the same locus/vuln (may merge to sast_confirmed)."""
    if (s.get('file') or '') != (l.get('file') or ''):
        return False
    try:
        sl, ll = int(s.get('line') or 0), int(l.get('line') or 0)
    except (TypeError, ValueError):
        return False
    if abs(sl - ll) > line_window:
        return False
    sc, lc = finding_vuln_class(s), finding_vuln_class(l)
    if sl == ll:
        if sc == 'other' or lc == 'other' or sc == lc:
            return True
        related = {frozenset(('crypto_weak', 'secret')), frozenset(('secret', 'hygiene'))}
        return frozenset((sc, lc)) in related
    sr, lr = (s.get('rule_id') or '').strip().upper(), (l.get('rule_id') or '').strip().upper()
    if sr and lr and sr == lr and sc != 'other' and lc != 'other':
        if sc == lc:
            return True
        related = {frozenset(('crypto_weak', 'secret')), frozenset(('secret', 'hygiene'))}
        if frozenset((sc, lc)) in related:
            return True
        return False
    if sc != 'other' and lc != 'other':
        if sc == lc:
            return True
        related = {frozenset(('crypto_weak', 'secret')), frozenset(('secret', 'hygiene'))}
        if frozenset((sc, lc)) in related:
            return True
        return False
    if abs(sl - ll) <= 1 and (s.get('category') or '') == (l.get('category') or ''):
        return True
    return False


def findings_same_bucket(a, b, line_window=3):
    """True when two findings are duplicate reports of the same issue (proximity dedup)."""
    if (a.get('file') or '') != (b.get('file') or ''):
        return False
    try:
        al, bl = int(a.get('line') or 0), int(b.get('line') or 0)
    except (TypeError, ValueError):
        return False
    if abs(al - bl) > line_window:
        return False
    if (a.get('title') or '') == (b.get('title') or '') and (a.get('title') or ''):
        return True
    ac, bc = finding_vuln_class(a), finding_vuln_class(b)
    return ac != 'other' and ac == bc


def append_sast_evidence(merged, sast):
    """Append SAST scanner evidence to a merged finding without replacing LLM narrative."""
    s_ev = (sast.get('evidence') or '').strip()
    if not s_ev:
        return merged
    l_ev = (merged.get('evidence') or '').strip()
    if s_ev in l_ev:
        return merged
    s_title = (sast.get('title') or sast.get('adapter') or 'SAST')[:100]
    snippet = s_ev if len(s_ev) <= 420 else s_ev[:420] + '…'
    merged['evidence'] = (l_ev + '; ' if l_ev else '') + 'SAST (%s): %s' % (s_title, snippet)
    return merged


def _only_suggestion_missing(errs):
    return bool(errs) and all(e == 'missing required field: suggestion' for e in errs)


def backfill_suggestion(f):
    """Ensure suggestion is non-empty for output_schema validation."""
    if (f.get('suggestion') or '').strip():
        return f
    ev = (f.get('evidence') or '').strip()
    title = (f.get('title') or '').strip()
    adapter = (f.get('adapter') or '').strip()
    if ev:
        for prefix in ('Use ', 'Disable ', 'Replace ', 'Avoid ', 'Ensure ', 'Do not ',
                        'Remove ', 'Upgrade ', 'Fix ', 'Consider '):
            idx = ev.find(prefix)
            if idx >= 0:
                f['suggestion'] = ev[idx:][:500]
                return f
        f['suggestion'] = ev[:500]
        return f
    if title and title not in ('?', 'semgrep'):
        f['suggestion'] = 'Remediate per %s%s.' % (
            title[:200], (' (' + adapter + ')' if adapter else ''))
        return f
    f['suggestion'] = 'Review and remediate per security guidelines.'
    return f


def normalize_finding(f, default_source='llm_judged'):
    f = dict(f)
    f.setdefault('category', 'logic')
    f.setdefault('severity', 'P2')
    f.setdefault('title', f.get('file', '?'))
    f.setdefault('evidence', '')
    f.setdefault('suggestion', '')
    f.setdefault('confidence', 0.5)
    f['line'] = max(1, int(f.get('line', 1) or 1))
    # preserve / normalize rule_id (LLM semantic policy)
    rid = (f.get('rule_id') or f.get('policy_id') or '').strip()
    if rid:
        f['rule_id'] = rid.upper()
    elif 'rule_id' in f and not rid:
        f.pop('rule_id', None)
    src = f.get('source', default_source)
    # collapse non-standard merged sources
    if src not in VALID_SOURCES:
        if 'sast_confirmed' in str(src) or ('sast' in str(src) and 'llm' in str(src)):
            src = 'sast_confirmed'
        elif 'sast' in str(src):
            src = 'sast_only'
        else:
            src = default_source
    f['source'] = src
    return backfill_suggestion(f)

def repair_line_number(repo, f):
    """If line is missing/OOB, search file for distinctive tokens from title/evidence."""
    full = os.path.join(repo, f.get('file', ''))
    if not os.path.isfile(full):
        return f
    try:
        lines = open(full, encoding='utf-8', errors='ignore').read().splitlines()
    except OSError:
        return f
    try:
        ln = int(f.get('line', 0) or 0)
    except (TypeError, ValueError):
        ln = 0
    if 1 <= ln <= len(lines):
        return f
    needles = []
    for src in (f.get('title', ''), f.get('evidence', '')):
        needles += re.findall(r'[A-Za-z_][A-Za-z0-9_]{2,}|["\'][^"\']{3,}["\']', src)
    needles = [n.strip('"\'') for n in needles if n.lower() not in (
        'mock', 'heuristic', 'matched', 'pattern', 'near', 'changed', 'code')]
    for i, line in enumerate(lines, 1):
        low = line.lower()
        if any(n.lower() in low for n in needles[:8]):
            f['line'] = i
            f['evidence'] = (f.get('evidence') or '') + ' [line repaired via source search]'
            return f
    # last resort: keep finding at line 1 only if file non-empty (still valid existence)
    if lines:
        f['line'] = 1
        f['evidence'] = (f.get('evidence') or '') + ' [line defaulted to 1; verify manually]'
    return f

def filter_valid_findings(findings, repo=None, schema=None):
    """Drop findings that fail schema or file:line checks; repair line when possible."""
    schema = schema or load_output_schema()
    kept, dropped = [], []
    for f in findings:
        f = normalize_finding(f)
        if repo and f.get('file'):
            f = repair_line_number(repo, f)
        errs = validate_finding_schema(f, schema)
        # Never discard deterministic hits solely for empty suggestion (adapter backfill).
        if _only_suggestion_missing(errs):
            backfill_suggestion(f)
            if not (f.get('suggestion') or '').strip():
                adapter = (f.get('adapter') or 'scanner').strip()
                title = (f.get('title') or 'finding')[:120]
                f['suggestion'] = 'Review and remediate per %s (%s).' % (title, adapter)
            errs = validate_finding_schema(f, schema)
        if repo and f.get('file'):
            ok, msg = verify_file_line(repo, f['file'], f['line'])
            if not ok:
                errs.append(msg)
        if errs:
            dropped.append({'finding': f, 'errors': errs})
        else:
            kept.append(f)
    return kept, dropped
