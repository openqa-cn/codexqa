#!/usr/bin/env python3
"""
Deterministic adapters (SAST / lint / secrets / SCA / metrics).

Industry Deterministic-First: anything these tools can decide must NOT be
primary LLM work. Orchestration only — binaries ensured via
ensure_tools.ensure_scan_tools() (install → repair → degrade-and-continue).

Out-of-the-box only (no SonarQube / CodeQL — those need servers or SARIF env):
  Semgrep (multi-lang), Bandit (Python), gosec (Go), gitleaks,
  SCA via OSV (osv-scanner CLI → OSV HTTP API → npm audit), linters.
  No Trivy / trivy-db — SCA never depends on a local vulnerability DB download.
"""
import hashlib, json, os, re, shutil, subprocess, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import skill_dir

SCA_COMPANION_FILES = (
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'go.mod', 'go.sum', 'requirements.txt', 'Pipfile', 'Pipfile.lock',
    'poetry.lock', 'Cargo.toml', 'Cargo.lock', 'composer.lock',
)

BRANCH_RE = re.compile(r'\b(if|elif|else if|for|while|case|catch|except|match|&&|\|\|)\b')

# Categories deterministic tools own; LLM should not rediscover clear hits
DETERMINISTIC_CATEGORIES = frozenset({
    'security', 'null_safety', 'resource_leak', 'secret', 'hygiene',
})
# Categories that need judgment / cross-file reasoning → LLM primary
JUDGMENT_CATEGORIES = frozenset({
    'concurrency', 'transaction', 'logic', 'architecture', 'security_design',
})


def _which(*names):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    home = os.path.expanduser('~')
    extras = [
        os.path.join(home, '.local', 'bin'),
        os.path.join(home, 'go', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
    ]
    lib_py = os.path.join(home, 'Library', 'Python')
    if os.path.isdir(lib_py):
        for ver in sorted(os.listdir(lib_py), reverse=True):
            extras.append(os.path.join(lib_py, ver, 'bin'))
    for d in extras:
        if d not in os.environ.get('PATH', ''):
            os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')
        for n in names:
            cand = os.path.join(d, n)
            if os.path.isfile(cand) and os.access(cand, os.X_OK):
                return cand
    return None


def _semgrep_supplement_config():
    path = os.path.join(skill_dir(), 'references', 'semgrep', 'aid-supplement.yaml')
    return path if os.path.isfile(path) else None


def expand_sast_scope(repo, files):
    """Include dependency/build manifests adjacent to scanned code (SCA + context)."""
    if not files:
        return files
    expanded = list(files)
    seen = set(expanded)
    roots = {''}
    for f in files:
        d = os.path.dirname(f.replace('\\', '/'))
        roots.add(d)
        if d:
            roots.add(os.path.dirname(d))
    for root in roots:
        for name in SCA_COMPANION_FILES:
            cand = os.path.join(root, name) if root else name
            cand = cand.lstrip('/')
            full = os.path.join(repo, cand)
            if os.path.isfile(full) and cand not in seen:
                seen.add(cand)
                expanded.append(cand)
    return expanded


def _semgrep_rule_id(res):
    """Map Semgrep check to policy rule_id when metadata provides it."""
    extra = res.get('extra') or {}
    meta = extra.get('metadata') or {}
    if isinstance(meta, dict) and meta.get('aid_rule_id'):
        return str(meta['aid_rule_id']).upper()
    check = (res.get('check_id') or '').lower()
    if 'path-traversal' in check or check.startswith('aid-java-path-traversal'):
        return 'SEC-001'
    if 'second-order-sql' in check or 'jdbc-sqli' in check or 'formatted-sql' in check:
        return 'SEC-001'
    if 'ldap' in check:
        return 'SEC-001'
    if 'empty-catch' in check or check.startswith('aid-java-empty-catch'):
        return 'ERR-001'
    if 'hardcoded' in check or 'password' in check or 'credential' in check:
        return 'HYG-001'
    return None


def _semgrep_suggestion(res, msg):
    """Build actionable suggestion from Semgrep result (fix metadata or message body)."""
    extra = res.get('extra') or {}
    fix = extra.get('fix')
    if isinstance(fix, str) and fix.strip():
        return fix.strip()[:500]
    if isinstance(fix, dict):
        for key in ('text', 'message', 'description'):
            val = fix.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()[:500]
    meta = extra.get('metadata') or {}
    if isinstance(meta, dict):
        for key in ('fix', 'remediation', 'recommendation'):
            val = meta.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()[:500]
    if (msg or '').strip():
        return msg.strip()[:500]
    check = res.get('check_id') or 'semgrep'
    return 'Review and fix per Semgrep rule: %s' % check


def run_semgrep(repo, files=None, include_dirs=None, timeout=1800):
    if not _which('semgrep'):
        return []
    cmd = ['semgrep', 'scan', '--json', '--timeout', '60', '--config', 'auto']
    supplement = _semgrep_supplement_config()
    if supplement:
        cmd += ['--config', supplement]
    # Semgrep monorepo guidance: --include scan roots (dirs) instead of whole repo
    if include_dirs:
        for d in include_dirs[:20]:
            cmd += ['--include', d.rstrip('/') + '/**']
    scan_files = expand_sast_scope(repo, list(files)[:80]) if files else None
    if scan_files and not include_dirs:
        cmd += scan_files[:90]
    elif not include_dirs and not scan_files:
        cmd += ['.']
    try:
        r = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=timeout)
        data = json.loads(r.stdout or '{}')
    except Exception as e:
        print('semgrep skipped:', e, file=__import__('sys').stderr)
        return []
    out, seen = [], set()
    for res in data.get('results', []):
        extra = res.get('extra') or {}
        msg = extra.get('message', '') or ''
        sev = extra.get('severity', '')
        suggestion = _semgrep_suggestion(res, msg)
        path = res.get('path', '')
        line = (res.get('start') or {}).get('line', 1)
        check = res.get('check_id', 'semgrep')
        dedupe_key = (path, line, check)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        meta = extra.get('metadata') or {}
        category = 'security'
        if isinstance(meta, dict) and meta.get('category') in (
                'hygiene', 'secret', 'security', 'null_safety', 'resource_leak'):
            category = meta.get('category')
        elif check.startswith('aid-java-empty-catch'):
            category = 'hygiene'
        rid = _semgrep_rule_id(res)
        is_supplement = check.startswith('aid-') or '.aid-' in check
        item = {
            'file': path, 'line': line,
            'title': check, 'category': category,
            'severity': {'ERROR': 'P1', 'WARNING': 'P2', 'INFO': 'P3'}.get(sev, 'P2'),
            'evidence': msg, 'suggestion': suggestion, 'confidence': 0.9,
            'source': 'sast_only', 'adapter': 'semgrep',
            'ambiguous': False if is_supplement else (
                sev not in ('ERROR', 'WARNING') or len(msg) < 40),
        }
        if rid:
            item['rule_id'] = rid
        out.append(item)
    return out


def run_bandit(repo, files=None, timeout=300):
    """Python security — OOTB via pip; no server/token."""
    if not _which('bandit'):
        return []
    py = [f for f in (files or []) if f.endswith('.py')]
    if files is not None and not py:
        return []
    try:
        cmd = ['bandit', '-f', 'json', '-q']
        if py:
            cmd += py[:80]
        else:
            cmd += ['-r', '.']
        r = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=timeout)
        data = json.loads(r.stdout or '{}')
    except Exception as e:
        print('bandit error:', e, file=__import__('sys').stderr)
        return []
    out = []
    for res in data.get('results') or []:
        sev = (res.get('issue_severity') or 'MEDIUM').upper()
        test_id = (res.get('test_id') or res.get('test_name') or 'bandit')
        evidence = res.get('issue_text') or ''
        severity = {'HIGH': 'P1', 'MEDIUM': 'P2', 'LOW': 'P3'}.get(sev, 'P2')
        category = 'security'
        # B324/B303: Bandit marks hashlib.md5/sha1 as HIGH even for non-crypto
        # fingerprinting when usedforsecurity=False is omitted. Do not inflate P1.
        tid = str(test_id).upper()
        ev_l = evidence.lower()
        if tid in ('B324', 'B303') or (
                'weak' in ev_l and 'hash' in ev_l and 'usedforsecurity' in ev_l):
            auth_ctx = any(k in ev_l for k in (
                'password', 'passwd', 'credential', 'authenticate', 'signature verify'))
            if not auth_ctx:
                severity = 'P2' if severity == 'P1' else severity
                category = 'hygiene'
        out.append({
            'file': res.get('filename') or '',
            'line': int(res.get('line_number') or 1),
            'title': test_id,
            'category': category,
            'severity': severity,
            'evidence': evidence,
            'suggestion': (res.get('more_info') or '')[:300] or (
                'Pass usedforsecurity=False for non-crypto hashing, or use hashlib.sha256.'
                if tid in ('B324', 'B303') else ''),
            'confidence': 0.9, 'source': 'sast_only', 'adapter': 'bandit',
            'ambiguous': len(evidence) < 30,
        })
    return out


def run_gosec(repo, files=None, timeout=300):
    """Go security — OOTB via brew/go install; no server/token."""
    if not _which('gosec'):
        return []
    go = [f for f in (files or []) if f.endswith('.go')]
    if files is not None and not go:
        return []
    try:
        # package scope; gosec expects packages not raw file lists
        r = subprocess.run(
            ['gosec', '-fmt=json', '-quiet', './...'],
            cwd=repo, capture_output=True, text=True, timeout=timeout)
        data = json.loads(r.stdout or '{}')
    except Exception as e:
        print('gosec error:', e, file=__import__('sys').stderr)
        return []
    out = []
    for res in data.get('Issues') or data.get('issues') or []:
        sev = (res.get('severity') or 'MEDIUM').upper()
        fpath = res.get('file') or ''
        if files and fpath:
            norm = fpath.replace('\\', '/')
            if not any(norm.endswith(p) or p in norm for p in files):
                continue
        out.append({
            'file': fpath, 'line': int(res.get('line') or 1),
            'title': res.get('rule_id') or 'gosec',
            'category': 'security',
            'severity': {'HIGH': 'P1', 'MEDIUM': 'P2', 'LOW': 'P3'}.get(sev, 'P2'),
            'evidence': res.get('details') or res.get('rule_id') or '',
            'suggestion': 'fix per gosec rule',
            'confidence': 0.9, 'source': 'sast_only', 'adapter': 'gosec',
            'ambiguous': len(res.get('details') or '') < 30,
        })
    return out


def _dedupe_secret_findings(findings):
    seen, out = set(), []
    for f in findings or []:
        key = (f.get('file'), f.get('line'), (f.get('title') or '')[:80])
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


_HARDCODED_CRED_RE = re.compile(
    r'(?i)\b([A-Za-z_][\w]*)\b\s*=\s*["\']([^"\']{6,})["\']'
)
_HARDCODED_CRED_NAME_RE = re.compile(
    r'(?i).*(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|'
    r'jdbc[_-]?pass|client[_-]?secret|auth[_-]?token|private[_-]?key)$'
)
_HARDCODED_CRED_PLACEHOLDERS = {
    'password', 'passwd', 'secret', 'changeme', 'changeit', 'todo', 'fixme',
    'your_password', 'your-password', 'xxx', 'xxxxxx', 'null', 'none', 'n/a',
    'placeholder', 'example', 'sample', 'test', 'testing', 'default',
}


def scan_hardcoded_credentials(repo, paths=None):
    """Deterministic HYG supplement for named credential literals gitleaks often misses.

    Matches assignments like JDBC_PASS = \"...\" / password = '...' across common languages.
    """
    code_ext = ('.java', '.py', '.go', '.js', '.ts', '.jsx', '.tsx', '.kt', '.cs', '.php', '.rb')
    if paths:
        rels = [p for p in paths if str(p).endswith(code_ext)]
    else:
        rels = []
        for root, dirs, names in os.walk(repo):
            dirs[:] = [d for d in dirs if d not in (
                '.git', 'node_modules', 'vendor', 'dist', 'build', 'target', '.next')]
            for n in names:
                if n.endswith(code_ext):
                    rels.append(os.path.relpath(os.path.join(root, n), repo))
                    if len(rels) >= 200:
                        break
            if len(rels) >= 200:
                break

    out = []
    for rel in rels[:120]:
        full = os.path.join(repo, rel) if not os.path.isabs(rel) else rel
        if not os.path.isfile(full):
            continue
        try:
            lines = open(full, encoding='utf-8', errors='ignore').read().splitlines()
        except OSError:
            continue
        rel_norm = rel.replace('\\', '/')
        for i, ln in enumerate(lines, 1):
            stripped = ln.strip()
            if not stripped or stripped.startswith(('#', '//', '*')):
                continue
            for m in _HARDCODED_CRED_RE.finditer(ln):
                name, value = m.group(1), m.group(2)
                if not _HARDCODED_CRED_NAME_RE.match(name):
                    continue
                low = value.strip().lower()
                if low in _HARDCODED_CRED_PLACEHOLDERS:
                    continue
                if low.startswith('${') or low.startswith('{{') or low.startswith('%('):
                    continue
                if re.fullmatch(r'[xX*\.]{4,}', value):
                    continue
                out.append({
                    'file': rel_norm,
                    'line': i,
                    'title': 'hardcoded-credential:%s' % name,
                    'category': 'secret',
                    'severity': 'P0',
                    'evidence': 'Hardcoded credential literal assigned to %s (value redacted, len=%d)'
                                % (name, len(value)),
                    'suggestion': 'Move %s to env/secret manager; rotate the exposed value.' % name,
                    'confidence': 0.92,
                    'source': 'sast_only',
                    'adapter': 'hardcoded_secrets',
                    'rule_id': 'HYG-001',
                    'ambiguous': False,
                })
                break
    return out[:100]


def run_secrets(repo, paths=None):
    """gitleaks → trufflehog → detect-secrets, always plus hardcoded-credential supplement."""
    out = []
    if _which('gitleaks'):
        try:
            cmd = ['gitleaks', 'detect', '--source', repo, '--report-format', 'json',
                   '--report-path', '/dev/stdout', '--no-git']
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            text = (r.stdout or '').strip() or '[]'
            data = json.loads(text) if text.startswith('[') else json.loads(text or '[]')
            if isinstance(data, dict):
                data = data.get('findings') or data.get('leaks') or []
            for leak in data or []:
                fpath = leak.get('File') or leak.get('file') or ''
                if paths and fpath and fpath not in paths and not any(
                        fpath.endswith(p) or p.endswith(fpath) for p in paths):
                    continue
                out.append({
                    'file': fpath,
                    'line': int(leak.get('StartLine') or leak.get('line') or 1),
                    'title': leak.get('RuleID') or leak.get('Description') or 'secret',
                    'category': 'secret', 'severity': 'P0',
                    'evidence': leak.get('Description') or leak.get('Match') or 'secret detected',
                    'suggestion': 'remove secret; rotate credential; use secret manager',
                    'confidence': 0.95, 'source': 'sast_only', 'adapter': 'gitleaks',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
            out.extend(scan_hardcoded_credentials(repo, paths=paths))
            return _dedupe_secret_findings(out)
        except Exception as e:
            print('gitleaks skipped:', e, file=__import__('sys').stderr)

    if _which('trufflehog'):
        try:
            r = subprocess.run(
                ['trufflehog', 'filesystem', repo, '--json', '--no-update'],
                capture_output=True, text=True, timeout=300)
            for line in (r.stdout or '').splitlines():
                line = line.strip()
                if not line.startswith('{'):
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                src = obj.get('SourceMetadata') or obj.get('source_metadata') or {}
                data = (src.get('Data') or src.get('data') or {})
                fs = data.get('Filesystem') or data.get('filesystem') or {}
                fpath = fs.get('file') or obj.get('file') or ''
                if paths and fpath and fpath not in paths:
                    continue
                out.append({
                    'file': fpath, 'line': int(fs.get('line') or 1),
                    'title': obj.get('DetectorName') or obj.get('detector_name') or 'trufflehog',
                    'category': 'secret', 'severity': 'P0',
                    'evidence': (obj.get('Raw') or obj.get('raw') or 'secret')[:200],
                    'suggestion': 'remove secret; rotate credential',
                    'confidence': 0.95, 'source': 'sast_only', 'adapter': 'trufflehog',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
            out.extend(scan_hardcoded_credentials(repo, paths=paths))
            return _dedupe_secret_findings(out)
        except Exception as e:
            print('trufflehog skipped:', e, file=__import__('sys').stderr)

    if _which('detect-secrets'):
        try:
            r = subprocess.run(['detect-secrets', 'scan', repo],
                               capture_output=True, text=True, timeout=300)
            data = json.loads(r.stdout or '{}')
            for fpath, items in (data.get('results') or {}).items():
                if paths and fpath not in paths:
                    continue
                for it in items:
                    out.append({
                        'file': fpath, 'line': int(it.get('line_number') or 1),
                        'title': it.get('type') or 'secret', 'category': 'secret',
                        'severity': 'P0', 'evidence': it.get('type') or 'secret',
                        'suggestion': 'remove secret; rotate credential',
                        'confidence': 0.9, 'source': 'sast_only', 'adapter': 'detect-secrets',
                        'rule_id': 'HYG-001', 'ambiguous': False,
                    })
        except Exception as e:
            print('detect-secrets skipped:', e, file=__import__('sys').stderr)

    out.extend(scan_hardcoded_credentials(repo, paths=paths))
    return _dedupe_secret_findings(out)


_SCA_WALK_SKIP_DIRS = frozenset({
    '.git', 'node_modules', 'vendor', 'dist', 'build', 'target', 'out',
    '.next', 'coverage', '__pycache__', '.venv', 'venv',
})


def _sca_scan_targets(repo, files=None):
    """Filter to dependency manifests that exist on disk."""
    if not files:
        return []
    return [f for f in files if os.path.basename(f) in SCA_COMPANION_FILES
            and os.path.isfile(os.path.join(repo, f))]


def _sca_manifest_paths(repo, files=None):
    """Dependency manifest paths for SCA (pom.xml, package-lock.json, …).

    When *files* is provided (incremental / scoped full), only those manifests.
    Otherwise walk the repo (skipping vendor trees) so OSV still sees lockfiles.
    """
    if files:
        return _sca_scan_targets(repo, files)
    found = []
    for root, dirs, filenames in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in _SCA_WALK_SKIP_DIRS and not d.startswith('.')]
        for name in filenames:
            if name in SCA_COMPANION_FILES:
                found.append(os.path.relpath(os.path.join(root, name), repo))
                if len(found) >= 80:
                    return found
    return found


def _parse_maven_pom_deps(pom_path):
    """Extract (groupId, artifactId, version) tuples from a pom.xml."""
    try:
        text = open(pom_path, encoding='utf-8', errors='ignore').read()
    except OSError:
        return []
    deps = []
    for block in re.findall(r'<dependency>(.*?)</dependency>', text, re.S):
        gid = re.search(r'<groupId>([^<]+)</groupId>', block)
        aid = re.search(r'<artifactId>([^<]+)</artifactId>', block)
        ver = re.search(r'<version>([^<]+)</version>', block)
        if gid and aid and ver:
            deps.append((gid.group(1).strip(), aid.group(1).strip(), ver.group(1).strip()))
    return deps


def run_pom_osv_api(repo, pom_paths):
    """Query OSV API (api.osv.dev) for Maven coordinates in pom.xml — no local binary/DB."""
    import urllib.error
    import urllib.request
    out = []
    for rel in pom_paths or []:
        if os.path.basename(rel) != 'pom.xml':
            continue
        full = os.path.join(repo, rel)
        if not os.path.isfile(full):
            continue
        for gid, aid, ver in _parse_maven_pom_deps(full):
            pkg_name = '%s:%s' % (gid, aid)
            payload = json.dumps({
                'package': {'name': pkg_name, 'ecosystem': 'Maven', 'version': ver},
            }).encode('utf-8')
            req = urllib.request.Request(
                'https://api.osv.dev/v1/query',
                data=payload,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                print('osv-api skipped %s@%s: %s' % (pkg_name, ver, e),
                      file=__import__('sys').stderr)
                continue
            best = None
            best_rank = 9
            sev_rank = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}
            for vuln in data.get('vulns') or []:
                aliases = vuln.get('aliases') or []
                vid = next((a for a in aliases if a.startswith('CVE-')), None)
                vid = vid or vuln.get('id') or 'OSV'
                summary = (vuln.get('summary') or vuln.get('details') or '')[:400]
                sev = 'P1'
                for aff in vuln.get('affected') or []:
                    for se in aff.get('severity') or []:
                        if se.get('type') == 'CVSS_V3' and se.get('score'):
                            try:
                                score = float(str(se['score']).split('/')[0])
                                sev = 'P0' if score >= 9.0 else 'P1' if score >= 7.0 else 'P2'
                            except ValueError:
                                pass
                rank = sev_rank.get(sev, 9)
                prefer = 0 if vid.startswith('CVE-') else 1
                if best is None or (rank, prefer) < (best_rank, best.get('_prefer', 1)):
                    best_rank = rank
                    best = {
                        'file': rel,
                        'line': 1,
                        'title': vid,
                        'category': 'security',
                        'severity': sev,
                        'evidence': '%s %s@%s: %s' % (vid, pkg_name, ver, summary),
                        'suggestion': 'Upgrade %s to a patched version' % pkg_name,
                        'confidence': 0.82, 'source': 'sast_only', 'adapter': 'osv-api',
                        'rule_id': 'SEC-001', 'ambiguous': False,
                        '_prefer': prefer,
                    }
            if best:
                best.pop('_prefer', None)
                out.append(best)
    return out[:200]


def run_osv_scanner(repo, manifests=None, scan_timeout=600):
    """Run Google osv-scanner CLI against listed manifests or the whole repo."""
    if not _which('osv-scanner'):
        return []
    cmd = ['osv-scanner', '--format', 'json']
    targets = []
    for rel in manifests or []:
        full = os.path.join(repo, rel) if not os.path.isabs(rel) else rel
        if os.path.isfile(full):
            targets.append(full)
    if targets:
        cmd.extend(targets[:40])
    else:
        cmd.extend(['-r', repo])
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=scan_timeout)
        # Exit 1 = vulns found; still parse stdout JSON.
        raw = (r.stdout or '').strip()
        if not raw:
            err = (r.stderr or '').strip()[:300]
            if err and r.returncode not in (0, 1):
                print('osv-scanner skipped: %s' % err, file=__import__('sys').stderr)
            return []
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print('osv-scanner skipped: invalid JSON — %s' % e, file=__import__('sys').stderr)
        return []
    except subprocess.TimeoutExpired:
        print('osv-scanner skipped: timeout (%ds)' % scan_timeout,
              file=__import__('sys').stderr)
        return []
    except Exception as e:
        print('osv-scanner skipped:', e, file=__import__('sys').stderr)
        return []

    out = []
    for res in data.get('results', []) or []:
        src = res.get('source') or {}
        path = src.get('path') or 'dependencies'
        if isinstance(path, str) and path.startswith(repo):
            path = os.path.relpath(path, repo)
        for pkg in res.get('packages', []) or []:
            for v in pkg.get('vulnerabilities', []) or []:
                summary = (v.get('summary') or v.get('details') or '')[:500]
                out.append({
                    'file': path,
                    'line': 1,
                    'title': v.get('id') or 'OSV',
                    'category': 'security',
                    'severity': 'P1',
                    'evidence': summary or (v.get('id') or 'osv finding'),
                    'suggestion': 'upgrade dependency to fixed version',
                    'confidence': 0.85, 'source': 'sast_only', 'adapter': 'osv-scanner',
                    'rule_id': 'SEC-001',
                    'ambiguous': len(summary) < 20,
                })
    return out[:200]


def run_npm_audit(repo):
    """npm audit fallback for Node lockfiles when osv-scanner/API yield nothing."""
    if not os.path.exists(os.path.join(repo, 'package-lock.json')) or not _which('npm'):
        return []
    out = []
    try:
        r = subprocess.run(['npm', 'audit', '--json'], cwd=repo,
                           capture_output=True, text=True, timeout=300)
        data = json.loads(r.stdout or '{}')
        for name, info in list((data.get('vulnerabilities') or {}).items())[:50]:
            out.append({
                'file': 'package-lock.json', 'line': 1, 'title': 'npm:%s' % name,
                'category': 'security',
                'severity': {'critical': 'P0', 'high': 'P1', 'moderate': 'P2'}.get(
                    info.get('severity'), 'P2'),
                'evidence': str(info.get('via', ''))[:400],
                'suggestion': 'npm audit fix / upgrade %s' % name,
                'confidence': 0.8, 'source': 'sast_only', 'adapter': 'npm-audit',
                'ambiguous': False,
            })
    except Exception as e:
        print('npm audit skipped:', e, file=__import__('sys').stderr)
    return out


def run_sca(repo, files=None):
    """OSV-first SCA: osv-scanner CLI → OSV HTTP API (pom.xml) → npm audit.

    No Trivy / local vuln DB. OSV API needs only network; osv-scanner is optional.
    """
    manifests = _sca_manifest_paths(repo, files)

    scanner_hits = run_osv_scanner(repo, manifests=manifests or None)
    if scanner_hits:
        print('SCA: osv-scanner %d finding(s)' % len(scanner_hits),
              file=__import__('sys').stderr)
        return scanner_hits[:200]

    pom_targets = [t for t in manifests if os.path.basename(t) == 'pom.xml']
    if pom_targets:
        osv_hits = run_pom_osv_api(repo, pom_targets)
        if osv_hits:
            print('SCA: OSV API %d finding(s) from %d pom.xml' % (
                len(osv_hits), len(pom_targets)), file=__import__('sys').stderr)
            return osv_hits[:200]

    npm_hits = run_npm_audit(repo)
    if npm_hits:
        print('SCA: npm audit %d finding(s)' % len(npm_hits),
              file=__import__('sys').stderr)
    return npm_hits[:200]


def run_java_lint(repo, files=None):
    """Java hygiene patterns when no SpotBugs/Checkstyle on PATH."""
    java = [f for f in (files or []) if f.endswith('.java')]
    if not java:
        return []
    out = []
    empty_catch = re.compile(r'catch\s*\([^)]+\)\s*\{\s*\}')
    import_re = re.compile(r'^\s*import\s+([\w.]+\.)?(\w+)\s*;')
    method_re = re.compile(r'^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\],.?]+\s+(\w+)\s*\(')
    for path in java[:80]:
        full = os.path.join(repo, path)
        if not os.path.isfile(full):
            continue
        try:
            text = open(full, encoding='utf-8', errors='ignore').read()
            lines = text.splitlines()
        except OSError:
            continue
        body = '\n'.join(ln for ln in lines if not ln.strip().startswith('import '))
        for i, ln in enumerate(lines, 1):
            if empty_catch.search(ln):
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-empty-catch-block',
                    'category': 'hygiene', 'severity': 'P2',
                    'evidence': 'Empty catch block swallows exceptions: %s' % ln.strip()[:200],
                    'suggestion': 'Log the exception, rethrow wrapped, or document intentional suppression.',
                    'confidence': 0.85, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'ERR-001', 'ambiguous': False,
                })
            if len(ln) > 160:
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-line-too-long',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': 'Line exceeds 160 characters (%d chars)' % len(ln),
                    'suggestion': 'Break long lines or extract constants/helpers.',
                    'confidence': 0.9, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
            if 'System.out.' in ln or 'System.err.' in ln:
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-debug-print',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': 'Debug print to stdout/stderr: %s' % ln.strip()[:200],
                    'suggestion': 'Replace with structured logging at appropriate level.',
                    'confidence': 0.85, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
            if 'TODO' in ln.upper() and '//' in ln:
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-todo-comment',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': 'TODO comment in production code: %s' % ln.strip()[:200],
                    'suggestion': 'Track in issue tracker or resolve before release.',
                    'confidence': 0.8, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
            m = method_re.match(ln)
            if m and re.search(r'[A-Z_]{2,}', m.group(1)) and not m.group(1)[0].islower():
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-naming-convention',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': 'Non-standard method name: %s' % m.group(1),
                    'suggestion': 'Use lowerCamelCase for method names per Java conventions.',
                    'confidence': 0.75, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
        for i, ln in enumerate(lines, 1):
            im = import_re.match(ln)
            if not im:
                continue
            sym = im.group(2)
            if sym in ('*',) or ln.strip().startswith('import static'):
                continue
            uses = len(re.findall(r'\b%s\b' % re.escape(sym), body))
            if uses == 0:
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-unused-import',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': 'Unused import: %s' % ln.strip(),
                    'suggestion': 'Remove unused import.',
                    'confidence': 0.9, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
        for i, ln in enumerate(lines, 1):
            if re.search(r'\b86400\b|\b3600\b|\b999999\b', ln) and not re.search(
                    r'(private|public|static|final)\s+', ln):
                out.append({
                    'file': path, 'line': i,
                    'title': 'java-magic-number',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': 'Magic number literal: %s' % ln.strip()[:200],
                    'suggestion': 'Extract named constants with domain meaning.',
                    'confidence': 0.7, 'source': 'sast_only', 'adapter': 'java_lint',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
    return out


def run_spotbugs(repo, files=None):
    """Optional SpotBugs when installed (Java static analysis)."""
    if not _which('spotbugs'):
        return []
    java = [f for f in (files or []) if f.endswith('.java')]
    if files is not None and not java:
        return []
    out = []
    try:
        cmd = ['spotbugs', '-textui', '-quiet', '-xml:withMessages', repo]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode not in (0, 1):
            return out
        import xml.etree.ElementTree as ET
        root = ET.fromstring(r.stdout or '<BugCollection/>')
        for bug in root.findall('.//BugInstance'):
            src = bug.find('SourceLine')
            if src is None:
                continue
            path = src.get('sourcepath') or src.get('pathname') or ''
            if files and path and path not in files and not any(
                    path.endswith(p) for p in files):
                continue
            out.append({
                'file': path, 'line': int(src.get('start') or 1),
                'title': 'spotbugs:%s' % (bug.get('type') or 'bug'),
                'category': 'security', 'severity': 'P2',
                'evidence': (bug.findtext('ShortMessage') or bug.get('type') or '')[:300],
                'suggestion': 'Fix per SpotBugs recommendation; see bug type documentation.',
                'confidence': 0.85, 'source': 'sast_only', 'adapter': 'spotbugs',
                'ambiguous': False,
            })
    except Exception as e:
        print('spotbugs skipped:', e, file=__import__('sys').stderr)
    return out[:100]


def run_lint(repo, files=None):
    """Language linters: ruff / eslint / golangci-lint / java_lint (ensure_tools installs first)."""
    out = []
    files = list(files or [])
    out += run_java_lint(repo, files=files)
    out += run_spotbugs(repo, files=files)
    py = [f for f in files if f.endswith('.py')] if files else []
    js = [f for f in files if f.endswith(('.js', '.ts', '.jsx', '.tsx'))] if files else []
    go = [f for f in files if f.endswith('.go')] if files else []

    if _which('ruff') and (py or not files):
        try:
            targets = py[:50] if py else ['.']
            r = subprocess.run(['ruff', 'check', '--output-format', 'json', *targets],
                               cwd=repo, capture_output=True, text=True, timeout=120)
            for it in json.loads(r.stdout or '[]'):
                out.append({
                    'file': it.get('filename') or it.get('file') or '',
                    'line': (it.get('location') or {}).get('row') or it.get('line') or 1,
                    'title': it.get('code') or 'ruff',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': it.get('message') or '',
                    'suggestion': (it.get('fix') or {}).get('message') or 'fix lint',
                    'confidence': 0.95, 'source': 'sast_only', 'adapter': 'ruff',
                    'ambiguous': False,
                })
        except Exception as e:
            print('ruff skipped:', e, file=__import__('sys').stderr)

    if _which('eslint') and (js or not files):
        try:
            targets = js[:50] if js else ['.']
            r = subprocess.run(['eslint', '-f', 'json', *targets],
                               cwd=repo, capture_output=True, text=True, timeout=180)
            for file_res in json.loads(r.stdout or '[]'):
                for msg in file_res.get('messages') or []:
                    out.append({
                        'file': file_res.get('filePath', ''),
                        'line': msg.get('line') or 1,
                        'title': msg.get('ruleId') or 'eslint',
                        'category': 'hygiene', 'severity': 'P3',
                        'evidence': msg.get('message') or '',
                        'suggestion': 'fix lint', 'confidence': 0.9,
                        'source': 'sast_only', 'adapter': 'eslint',
                        'ambiguous': False,
                    })
        except Exception as e:
            print('eslint skipped:', e, file=__import__('sys').stderr)

    if _which('golangci-lint') and (go or not files):
        try:
            r = subprocess.run(['golangci-lint', 'run', '--out-format', 'json'],
                               cwd=repo, capture_output=True, text=True, timeout=300)
            data = json.loads(r.stdout or '{}')
            for it in data.get('Issues') or data.get('issues') or []:
                pos = it.get('Pos') or it.get('pos') or {}
                out.append({
                    'file': pos.get('Filename') or it.get('file') or '',
                    'line': pos.get('Line') or it.get('line') or 1,
                    'title': it.get('FromLinter') or it.get('Text') or 'golangci',
                    'category': 'hygiene', 'severity': 'P3',
                    'evidence': it.get('Text') or '',
                    'suggestion': 'fix lint', 'confidence': 0.9,
                    'source': 'sast_only', 'adapter': 'golangci-lint',
                    'ambiguous': False,
                })
        except Exception as e:
            print('golangci-lint skipped:', e, file=__import__('sys').stderr)
    return out


def compute_code_metrics(repo, files):
    """
    Complexity + duplication + smell distribution (lightweight, no external deps).
    files: list of {path, ...} with optional precomputed complexity/lines.
    """
    import hashlib
    line_hash_count = Counter()
    file_line_hashes = {}
    smells = Counter()
    for f in files:
        path = f['path']
        full = os.path.join(repo, path)
        try:
            text = open(full, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        lines = text.splitlines()
        f['lines'] = f.get('lines') or (len(lines) + 1)
        f['complexity'] = f.get('complexity')
        if f['complexity'] is None:
            f['complexity'] = len(BRANCH_RE.findall(text))
        # duplication: normalize whitespace, hash non-trivial lines
        hashes = []
        for ln in lines:
            s = re.sub(r'\s+', ' ', ln.strip())
            if len(s) < 20 or s.startswith(('#', '//', '/*', '*', 'import ', 'from ', 'package ')):
                continue
            h = hashlib.md5(s.encode(), usedforsecurity=False).hexdigest()
            hashes.append(h)
            line_hash_count[h] += 1
        file_line_hashes[path] = hashes
        # smells
        if f['lines'] > 500:
            smells['god_file'] += 1
        if f['complexity'] > 40:
            smells['high_complexity'] += 1
        # long function heuristic
        long_fn = 0
        depth = 0
        for ln in lines:
            if re.search(r'^\s*(def |function |func |void |public |private |class )', ln):
                depth = 0
            depth += ln.count('{') - ln.count('}')
            if depth > 5:
                smells['deep_nesting'] += 1
                break
            if re.match(r'^\s*(def |function |func )', ln):
                long_fn = 0
            long_fn += 1
            if long_fn > 80:
                smells['long_function'] += 1
                long_fn = 0

    dup_lines_per_file = {}
    for path, hashes in file_line_hashes.items():
        dup = sum(1 for h in hashes if line_hash_count[h] > 1)
        total = max(1, len(hashes))
        rate = round(100.0 * dup / total, 1)
        dup_lines_per_file[path] = rate
        for f in files:
            if f['path'] == path:
                f['duplication_rate'] = rate
                if rate >= 30:
                    smells['high_duplication'] += 1
                break

    per_file = {}
    for f in files:
        path = f.get('path')
        if path:
            per_file[path] = {
                'complexity': f.get('complexity'),
                'lines': f.get('lines'),
                'duplication_rate': f.get('duplication_rate'),
                'methods': f.get('methods') or [],
            }
    return {
        'smell_distribution': dict(smells),
        'avg_duplication_rate': round(
            sum(dup_lines_per_file.values()) / max(1, len(dup_lines_per_file)), 1),
        'files_with_duplication_ge_30': sum(1 for v in dup_lines_per_file.values() if v >= 30),
        'per_file': per_file,
    }


def _java_method_metrics(lines):
    """Per-method complexity/line counts for Java sources."""
    methods = []
    sig_start = re.compile(r'^\s*(?:public|private|protected|static|\s)+[\w<>\[\],.?]+\s+(\w+)\s*\(')
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = sig_start.match(ln)
        if not m:
            i += 1
            continue
        name = m.group(1)
        if name in ('if', 'for', 'while', 'switch', 'catch', 'class'):
            i += 1
            continue
        start_line = i + 1
        sig_buf = ln
        j = i
        while j < len(lines) and '{' not in sig_buf:
            j += 1
            if j < len(lines):
                sig_buf += ' ' + lines[j]
        if j >= len(lines):
            i += 1
            continue
        depth = sig_buf.count('{') - sig_buf.count('}')
        branch = len(BRANCH_RE.findall(sig_buf))
        max_nest = max(0, depth)
        cur_nest = max(0, depth)
        k = j + 1
        while k < len(lines) and depth > 0:
            cur_nest += lines[k].count('{')
            cur_nest -= lines[k].count('}')
            max_nest = max(max_nest, cur_nest)
            depth += lines[k].count('{') - lines[k].count('}')
            branch += len(BRANCH_RE.findall(lines[k]))
            k += 1
        end = k
        body_lines = lines[i:end]
        norm_body = re.sub(r'\s+', ' ', '\n'.join(body_lines)).strip()
        methods.append({
            'name': name,
            'line': start_line,
            'lines': max(1, end - i),
            'complexity': branch,
            'max_nest': max_nest,
            'body_norm': norm_body,
            'body_hash': hashlib.md5(norm_body.encode(), usedforsecurity=False).hexdigest()[:16],
        })
        i = end if end > i else i + 1
    return methods


def _method_body_similarity(a, b):
    """Ratio of shared normalized tokens between two method bodies (0..1)."""
    ta = set(re.findall(r'\w+', (a.get('body_norm') or '').lower()))
    tb = set(re.findall(r'\w+', (b.get('body_norm') or '').lower()))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(1, len(ta | tb))


def metrics_to_findings(repo, files, code_metrics=None):
    """Turn code_metrics into deterministic P2/P3 findings (complexity, duplication)."""
    if not files:
        return []
    enriched = [{'path': f} if isinstance(f, str) else dict(f) for f in files]
    code_metrics = code_metrics or compute_code_metrics(repo, enriched)
    out = []
    hash_to_methods = defaultdict(list)
    reported_dup = set()
    for f in enriched:
        path = f.get('path')
        if not path or not path.endswith('.java'):
            continue
        full = os.path.join(repo, path)
        if not os.path.isfile(full):
            continue
        try:
            lines = open(full, encoding='utf-8', errors='ignore').read().splitlines()
        except OSError:
            continue
        methods = _java_method_metrics(lines)
        f['methods'] = methods
        for m in methods:
            complex_hit = (m['complexity'] >= 14 and m.get('max_nest', 0) >= 4)
            if complex_hit:
                out.append({
                    'file': path, 'line': m['line'],
                    'title': 'java-high-cyclomatic-complexity',
                    'category': 'hygiene', 'severity': 'P2',
                    'evidence': 'Method %s complexity=%d nesting=%d (threshold complexity≥14 & nest≥4)' % (
                        m['name'], m['complexity'], m.get('max_nest', 0)),
                    'suggestion': 'Extract branches into smaller methods; add unit tests for edge cases.',
                    'confidence': 0.8, 'source': 'sast_only', 'adapter': 'code_metrics',
                    'rule_id': 'PERF-001', 'ambiguous': False,
                })
            hash_to_methods[m['body_hash']].append((path, m))
        for i, ma in enumerate(methods):
            for mb in methods[i + 1:]:
                sim = _method_body_similarity(ma, mb)
                if sim < 0.85:
                    continue
                pair = tuple(sorted((ma['name'], mb['name'])))
                if pair in reported_dup:
                    continue
                reported_dup.add(pair)
                out.append({
                    'file': path, 'line': min(ma['line'], mb['line']),
                    'title': 'java-duplicate-code-block',
                    'category': 'hygiene', 'severity': 'P2',
                    'evidence': 'Similar method bodies: %s ↔ %s (similarity %.0f%%)' % (
                        ma['name'], mb['name'], sim * 100),
                    'suggestion': 'Extract shared logic into a single helper to reduce drift risk.',
                    'confidence': 0.75, 'source': 'sast_only', 'adapter': 'code_metrics',
                    'rule_id': 'HYG-001', 'ambiguous': False,
                })
    for body_hash, group in hash_to_methods.items():
        if len(group) < 2:
            continue
        names = sorted({m['name'] for _, m in group})
        path, m = group[0]
        pair = tuple(names[:2])
        if pair and pair in reported_dup:
            continue
        out.append({
            'file': path, 'line': m['line'],
            'title': 'java-duplicate-code-block',
            'category': 'hygiene', 'severity': 'P2',
            'evidence': 'Duplicate method bodies detected: %s (hash %s)' % (
                ', '.join(names[:4]), body_hash),
            'suggestion': 'Extract shared logic into a single helper to reduce drift risk.',
            'confidence': 0.75, 'source': 'sast_only', 'adapter': 'code_metrics',
            'rule_id': 'HYG-001', 'ambiguous': False,
        })
    pf = (code_metrics or {}).get('per_file') or {}
    for path, info in pf.items():
        rate = info.get('duplication_rate') or 0
        if rate >= 30:
            out.append({
                'file': path, 'line': 1,
                'title': 'java-high-duplication-rate',
                'category': 'hygiene', 'severity': 'P2',
                'evidence': 'File duplication rate %.1f%% exceeds 30%% threshold' % rate,
                'suggestion': 'Refactor repeated blocks into shared utilities.',
                'confidence': 0.7, 'source': 'sast_only', 'adapter': 'code_metrics',
                'rule_id': 'HYG-001', 'ambiguous': False,
            })
    return out


def partition_sast_for_llm(sast_findings):
    """
    Deterministic split:
      clear_deterministic → report as sast_only, do NOT send to Stage1 rediscovery
      ambiguous_residue   → LLM interprets / grades only
    """
    clear, ambiguous = [], []
    for f in sast_findings or []:
        if f.get('ambiguous'):
            ambiguous.append(f)
        else:
            clear.append(f)
    return clear, ambiguous


def run_all_deterministic(repo, cfg, files=None, full=False, scope_plan=None):
    """Run enabled OOTB adapters. files=changed paths for incremental scope hints."""
    adapters = cfg.get('sast_adapters') or {}
    out = []
    # Import locally to avoid circular import at module load
    from scope_planner import scope_allowlist
    allowed = None
    semgrep_dirs = None
    if scope_plan:
        # Empty include_files → None (do not filter / reject-all)
        allowed = scope_allowlist(scope_plan.get('include_files'))
        semgrep_dirs = scope_plan.get('semgrep_include_dirs') or None

    if full and allowed is not None:
        scoped = expand_sast_scope(repo, list(allowed)[:500])
    elif full:
        scoped = None
    else:
        base = list(files or [])
        if allowed is not None:
            base = [f for f in base if f in allowed]
        scoped = expand_sast_scope(repo, base[:80])

    if adapters.get('semgrep', True):
        out += run_semgrep(repo,
                           files=scoped if not full else (scoped or (list(allowed) if allowed else None)),
                           include_dirs=semgrep_dirs if full else None,
                           timeout=1800 if full else 300)
    if adapters.get('bandit', True):
        out += run_bandit(repo, files=scoped or files if not full else (list(allowed) if allowed else None))
    if adapters.get('gosec', True):
        out += run_gosec(repo, files=scoped or files if not full else (list(allowed) if allowed else None))
    if adapters.get('secrets', True):
        out += run_secrets(repo, paths=scoped or files or (list(allowed) if allowed else None))
    if adapters.get('sca', True):
        out += run_sca(repo, files=scoped or files or (list(allowed) if allowed else None))
    if adapters.get('lint', True):
        out += run_lint(repo, files=scoped or files or (list(allowed) if allowed else None))
    return out
