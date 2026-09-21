#!/usr/bin/env python3
"""
Ensure out-of-the-box scan tools are installed BEFORE collect/scan.

Policy (install → repair → degrade-and-continue):
  1. Auto-install missing tools.
  2. On failure: apply scripted repairs (PATH, pip/brew fallbacks) and retry.
  3. If still missing: emit USER-VISIBLE warning with failed tools + reasons;
     DO NOT abort the scan — continue with whichever tools are ready.
  4. Agent SOP (SKILL.md): before giving up, attempt further fixes from the
     failure log, then re-run ensure_tools; only then notify the user.

No SonarQube / CodeQL (server tokens / SARIF env).
"""
import argparse, os, shutil, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load_config, python_executable, skill_dir


class ToolingError(RuntimeError):
    """Raised only when --strict and tools still missing after repairs."""
    pass


# tool → install flags / repair hints for agent
TOOL_HINTS = {
    'semgrep': [
        'brew install semgrep',
        'python3 -m pip install --user --break-system-packages "semgrep>=1.80"',
        'export PATH="$HOME/.local/bin:$HOME/Library/Python/*/bin:$PATH"',
    ],
    'gitleaks': [
        'brew install gitleaks',
        'go install github.com/gitleaks/gitleaks/v8@latest && export PATH="$HOME/go/bin:$PATH"',
    ],
    'osv-scanner': [
        'brew install osv-scanner',
        'go install github.com/google/osv-scanner/cmd/osv-scanner@latest && export PATH="$HOME/go/bin:$PATH"',
    ],
    'bandit': [
        'python3 -m pip install --user --break-system-packages bandit',
        'export PATH="$HOME/Library/Python/*/bin:$HOME/.local/bin:$PATH"',
    ],
    'gosec': [
        'brew install gosec',
        'go install github.com/securego/gosec/v2/cmd/gosec@latest',
    ],
    'ruff': [
        'brew install ruff',
        'python3 -m pip install --user --break-system-packages ruff',
    ],
    'eslint': [
        'npm install -g eslint',
        'export PATH="$(npm prefix -g)/bin:$PATH"',
    ],
    'golangci-lint': [
        'brew install golangci-lint',
        'curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b "$HOME/.local/bin"',
    ],
}

FLAG_FOR_TOOL = {
    'semgrep': '--core',
    'gitleaks': '--core',
    'osv-scanner': '--core',
    'bandit': '--bandit',
    'gosec': '--gosec',
    'ruff': '--lint-py',
    'eslint': '--lint-js',
    'golangci-lint': '--lint-go',
}


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
    try:
        prefix = subprocess.check_output(['npm', 'prefix', '-g'], text=True).strip()
        extras.append(os.path.join(prefix, 'bin'))
    except Exception:
        pass
    for d in extras:
        for n in names:
            cand = os.path.join(d, n)
            if os.path.isfile(cand) and os.access(cand, os.X_OK):
                os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')
                return cand
    return None


def refresh_path():
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
    try:
        prefix = subprocess.check_output(['npm', 'prefix', '-g'], text=True).strip()
        extras.append(os.path.join(prefix, 'bin'))
    except Exception:
        pass
    for d in extras:
        if os.path.isdir(d) and d not in os.environ.get('PATH', ''):
            os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')


def detect_lang_needs(repo, files=None):
    need = {'py': False, 'js': False, 'go': False, 'java': False}
    paths = list(files or [])
    if not paths:
        for root, dirs, names in os.walk(repo):
            dirs[:] = [d for d in dirs if d not in
                       ('.git', 'node_modules', 'vendor', 'dist', 'build', '__pycache__')]
            for n in names:
                ext = os.path.splitext(n)[1].lower()
                if ext == '.py':
                    need['py'] = True
                elif ext in ('.js', '.ts', '.jsx', '.tsx'):
                    need['js'] = True
                elif ext == '.go':
                    need['go'] = True
                elif ext == '.java':
                    need['java'] = True
            if all(need.values()):
                break
    else:
        for p in paths:
            if p.endswith('.py'):
                need['py'] = True
            elif p.endswith(('.js', '.ts', '.jsx', '.tsx')):
                need['js'] = True
            elif p.endswith('.go'):
                need['go'] = True
            elif p.endswith('.java'):
                need['java'] = True
    return need


def _install_script():
    return os.path.join(skill_dir(), 'scripts', 'install_sast_tools.sh')


def run_install(flags, timeout=1800):
    """Run install script; return (ok, log_text). Never raises for install failure."""
    script = _install_script()
    if not os.path.isfile(script):
        return False, 'missing install script: %s' % script
    if not os.access(script, os.X_OK):
        try:
            os.chmod(script, 0o755)
        except OSError as e:
            return False, 'cannot chmod install script: %s' % e
    cmd = ['bash', script] + list(flags)
    print('ensure_tools: running %s' % ' '.join(cmd), file=sys.stderr)
    try:
        r = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, 'install timed out after %ss' % timeout
    log = ((r.stdout or '') + '\n' + (r.stderr or '')).strip()
    if log:
        # keep agent/user able to read failure cause
        sys.stderr.write(log[-8000:] + ('\n' if not log.endswith('\n') else ''))
    return r.returncode == 0, log


def _diagnose(log, missing):
    """Map install log + missing tools → repair actions the agent/script can try."""
    log_l = (log or '').lower()
    actions = []
    if 'externally-managed-environment' in log_l or 'pep 668' in log_l:
        actions.append({
            'id': 'pep668',
            'reason': 'PEP 668 blocked system pip',
            'fix': 'use pip --user --break-system-packages or brew/pipx',
        })
    if 'bad interpreter' in log_l and 'pipx' in log_l:
        actions.append({
            'id': 'pipx_broken',
            'reason': 'pipx interpreter broken',
            'fix': 'skip pipx; brew reinstall pipx OR use pip --user',
        })
    if 'another `brew update` process' in log_l or 'brew update' in log_l and 'already running' in log_l:
        actions.append({
            'id': 'brew_lock',
            'reason': 'Homebrew lock contention',
            'fix': 'wait and retry; or kill stale brew process',
        })
    if 'permission denied' in log_l or 'eacces' in log_l:
        actions.append({
            'id': 'permission',
            'reason': 'permission denied during install',
            'fix': 'fix ownership on ~/.local or use brew --user prefix',
        })
    if 'network' in log_l or 'timed out' in log_l or 'could not resolve' in log_l:
        actions.append({
            'id': 'network',
            'reason': 'network failure fetching packages',
            'fix': 'retry; check proxy/mirror; use brew bottle cache',
        })
    for t in missing:
        actions.append({
            'id': 'hint:%s' % t,
            'reason': '%s still missing' % t,
            'fix': '; '.join(TOOL_HINTS.get(t, ['re-run install_sast_tools.sh'])),
        })
    return actions


def _scripted_repair(actions, missing):
    """
    Apply automated fixes we can do without user interaction.
    Returns list of applied repair ids.
    """
    applied = []
    ids = {a['id'] for a in actions}

    # Always refresh PATH (common: pip --user installed but not on PATH)
    refresh_path()
    applied.append('path_refresh')

    if 'brew_lock' in ids:
        time.sleep(8)
        applied.append('brew_lock_wait')

    # Direct per-tool fallbacks when still missing
    for tool in list(missing):
        if _which(tool):
            continue
        if tool in ('semgrep', 'bandit', 'ruff'):
            pkg = 'semgrep>=1.80' if tool == 'semgrep' else tool
            print('ensure_tools: repair — pip install %s' % pkg, file=sys.stderr)
            subprocess.run(
                [python_executable(), '-m', 'pip', 'install', '--user',
                 '--break-system-packages', pkg],
                capture_output=True, text=True, timeout=600)
            refresh_path()
            applied.append('pip:%s' % tool)
        elif tool == 'eslint':
            print('ensure_tools: repair — npm install -g eslint', file=sys.stderr)
            subprocess.run(['npm', 'install', '-g', 'eslint'],
                           capture_output=True, text=True, timeout=600)
            refresh_path()
            applied.append('npm:eslint')
        elif tool in ('gitleaks', 'osv-scanner', 'gosec', 'golangci-lint', 'ruff', 'semgrep'):
            if shutil.which('brew'):
                print('ensure_tools: repair — brew install %s' % tool, file=sys.stderr)
                subprocess.run(['brew', 'install', tool],
                               capture_output=True, text=True, timeout=900)
                refresh_path()
                applied.append('brew:%s' % tool)

    return applied


def _missing_core(adapters):
    miss = []
    if adapters.get('semgrep', True) and not _which('semgrep'):
        miss.append('semgrep')
    if adapters.get('secrets', True) and not _which('gitleaks'):
        if not (_which('trufflehog') or _which('detect-secrets')):
            miss.append('gitleaks')
    # SCA: OSV HTTP API always works without a binary; osv-scanner is optional enhancement.
    return miss


def _missing_lang(adapters, lang):
    miss = []
    if adapters.get('bandit', True) and lang.get('py') and not _which('bandit'):
        miss.append('bandit')
    if adapters.get('gosec', True) and lang.get('go') and not _which('gosec'):
        miss.append('gosec')
    if adapters.get('lint', True):
        if lang.get('py') and not _which('ruff'):
            miss.append('ruff')
        if lang.get('js') and not _which('eslint'):
            miss.append('eslint')
        if lang.get('go') and not _which('golangci-lint'):
            miss.append('golangci-lint')
    return miss


def _flags_for(adapters, lang, only_tools=None):
    flags = ['--core']
    want = set(only_tools) if only_tools else None
    if adapters.get('bandit', True) and lang['py'] and (want is None or 'bandit' in want):
        flags.append('--bandit')
    if adapters.get('gosec', True) and lang['go'] and (want is None or 'gosec' in want):
        flags.append('--gosec')
    if adapters.get('lint', True):
        if lang['py'] and (want is None or 'ruff' in want):
            flags.append('--lint-py')
        if lang['js'] and (want is None or 'eslint' in want):
            flags.append('--lint-js')
        if lang['go'] and (want is None or 'golangci-lint' in want):
            flags.append('--lint-go')
    return flags


def format_user_warning(missing, diagnostics, repair_attempts):
    lines = [
        '',
        '=' * 60,
        'WARNING: 以下扫描工具安装失败，将跳过这些适配器并继续后续扫描',
        '=' * 60,
    ]
    for t in missing:
        lines.append('  ✗ %s' % t)
        for h in TOOL_HINTS.get(t, []):
            lines.append('      建议: %s' % h)
    if diagnostics:
        lines.append('失败原因摘要:')
        seen = set()
        for d in diagnostics:
            key = d.get('reason') or d.get('id')
            if key in seen:
                continue
            seen.add(key)
            lines.append('  - %s → %s' % (d.get('reason'), d.get('fix')))
    lines.append('已自动修复尝试: %d 次' % repair_attempts)
    lines.append('Agent: 请根据上述原因再试修复；若仍失败，告知用户后继续扫描。')
    lines.append('=' * 60)
    lines.append('')
    return '\n'.join(lines)


def ensure_scan_tools(repo='.', cfg=None, files=None, full=False, auto_install=None,
                      strict=None, max_repair=None):
    """
    Install + verify OOTB tools with repair loop.

    Returns status dict:
      ready, missing, degraded, diagnostics, repair_log, lang_need, binaries…

    Default: never abort scan (degraded continue). Set tooling.require_for_scan
    or strict=True to raise ToolingError when still missing after repairs.
    """
    del full
    cfg = cfg or load_config()
    tooling = cfg.get('tooling') or {}
    adapters = cfg.get('sast_adapters') or {}
    if auto_install is None:
        auto_install = tooling.get('auto_install', True)
    if strict is None:
        # Default False: warn + continue. True only if explicitly configured.
        strict = bool(tooling.get('require_for_scan', False))
    if max_repair is None:
        max_repair = int(tooling.get('repair_max_attempts', 3))

    refresh_path()
    lang = detect_lang_needs(repo, files=files)
    flags = _flags_for(adapters, lang)

    miss = _missing_core(adapters) + _missing_lang(adapters, lang)
    install_logs = []
    diagnostics = []
    repair_log = []
    attempts = 0

    while miss and auto_install and attempts < max_repair:
        attempts += 1
        print('ensure_tools: attempt %d/%d — missing %s'
              % (attempts, max_repair, ', '.join(miss)), file=sys.stderr)
        ok, log = run_install(flags)
        install_logs.append(log)
        refresh_path()
        miss = _missing_core(adapters) + _missing_lang(adapters, lang)
        if not miss:
            break

        diags = _diagnose(log, miss)
        diagnostics.extend(diags)
        applied = _scripted_repair(diags, miss)
        repair_log.append({'attempt': attempts, 'install_ok': ok, 'applied': applied,
                           'still_missing': list(miss)})
        refresh_path()
        miss = _missing_core(adapters) + _missing_lang(adapters, lang)
        if miss and attempts < max_repair:
            # targeted re-install for remaining tools only
            flags = _flags_for(adapters, lang, only_tools=miss)

    ready = []
    for name in ('semgrep', 'gitleaks', 'osv-scanner', 'bandit', 'gosec', 'ruff',
                 'eslint', 'golangci-lint'):
        if _which(name):
            ready.append(name)
    if adapters.get('sca', True):
        ready.append('osv-api')

    status = {
        'semgrep': _which('semgrep'),
        'gitleaks': _which('gitleaks'),
        'osv_api': True if adapters.get('sca', True) else False,
        'osv_scanner': _which('osv-scanner'),
        'bandit': _which('bandit'),
        'gosec': _which('gosec'),
        'ruff': _which('ruff'),
        'eslint': _which('eslint'),
        'golangci-lint': _which('golangci-lint'),
        'lang_need': lang,
        'auto_install': auto_install,
        'ready': ready,
        'missing': list(miss),
        'degraded': bool(miss),
        'diagnostics': diagnostics[-20:],
        'repair_log': repair_log,
        'repair_attempts': attempts,
        'continue_on_failure': not strict,
    }

    if miss:
        warn = format_user_warning(miss, diagnostics, attempts)
        sys.stderr.write(warn)
        # Machine-readable marker for agents
        print('ENSURE_TOOLS_DEGRADED missing=%s' % ','.join(miss), file=sys.stderr)
        if strict:
            raise ToolingError(
                'FATAL (--strict): tools still missing after %d repair attempts: %s\n%s'
                % (attempts, ', '.join(miss), warn))
        print('ensure_tools: continuing with partial stack: %s'
              % (', '.join(ready) or '(none)'), file=sys.stderr)
    else:
        print('ensure_tools: OK — OOTB stack ready (%s)' % ', '.join(ready),
              file=sys.stderr)
    return status


def main():
    ap = argparse.ArgumentParser(
        description='Install & verify OOTB scan tools (repair then degrade-and-continue)')
    ap.add_argument('--repo', default='.')
    ap.add_argument('--full', action='store_true')
    ap.add_argument('--no-install', action='store_true')
    ap.add_argument('--strict', action='store_true',
                    help='Exit 4 if tools still missing after repairs (default: warn+continue)')
    ap.add_argument('--files', nargs='*', default=None)
    ap.add_argument('--max-repair', type=int, default=None)
    args = ap.parse_args()
    try:
        st = ensure_scan_tools(
            repo=args.repo, cfg=load_config(), files=args.files, full=args.full,
            auto_install=not args.no_install, strict=args.strict,
            max_repair=args.max_repair)
    except ToolingError as e:
        print(str(e), file=sys.stderr)
        sys.exit(4)
    if st.get('degraded'):
        print('ensure_tools: degraded — missing: %s' % ', '.join(st['missing']))
        sys.exit(0)  # continue-friendly; agents check ENSURE_TOOLS_DEGRADED
    print('ensure_tools: ready')


if __name__ == '__main__':
    main()
