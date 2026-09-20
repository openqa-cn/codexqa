#!/usr/bin/env bash
# Install out-of-the-box deterministic scan tools (no server / env-token tools).
# Fail closed: non-zero exit if any requested core tool is still missing after install.
set -euo pipefail

# shellcheck source=python_resolve.sh
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SOURCE_DIR/python_resolve.sh"
PYTHON="$(aid_resolve_python)" || {
  echo "[install_sast_tools] FATAL: Python 3.10+ not found on PATH" >&2
  exit 1
}
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:$(npm prefix -g 2>/dev/null)/bin:${HOME}/go/bin:${PATH:-}"

have() { command -v "$1" >/dev/null 2>&1; }
log() { printf '[install_sast_tools] %s\n' "$*" >&2; }
brew_ok() { have brew; }

pip_user() {
  # PEP 668-safe: prefer working pipx, then pip --user --break-system-packages
  local pkg="$1"
  local bin
  bin="$(echo "$pkg" | sed 's/[>=<].*//' | tr 'A-Z' 'a-z')"
  if have pipx && pipx --version >/dev/null 2>&1; then
    pipx install "$pkg" 2>/dev/null || pipx upgrade "$pkg" 2>/dev/null || true
  fi
  if ! have "$bin"; then
    "$PYTHON" -m pip install --user --break-system-packages "$pkg"
  fi
  # macOS user site often lands in ~/Library/Python/*/bin
  for d in "${HOME}/.local/bin" "${HOME}"/Library/Python/*/bin; do
    [[ -d "$d" ]] || continue
    export PATH="${d}:${PATH}"
  done
}

install_semgrep() {
  if have semgrep; then return 0; fi
  log "installing semgrep…"
  if brew_ok; then
    brew install semgrep || true
  fi
  if ! have semgrep; then
    pip_user 'semgrep>=1.80'
  fi
  have semgrep
}

install_bandit() {
  if have bandit; then return 0; fi
  log "installing bandit…"
  pip_user bandit
  have bandit
}

install_ruff() {
  if have ruff; then return 0; fi
  log "installing ruff…"
  if brew_ok; then
    brew install ruff || true
  fi
  if ! have ruff; then
    pip_user ruff
  fi
  have ruff
}

install_gitleaks() {
  if have gitleaks; then return 0; fi
  log "installing gitleaks…"
  if brew_ok; then
    brew install gitleaks
  elif have go; then
    go install github.com/gitleaks/gitleaks/v8@latest
    export PATH="${HOME}/go/bin:${PATH}"
  else
    log "ERROR: need brew or go to install gitleaks"
    return 1
  fi
}

install_osv_scanner() {
  if have osv-scanner; then return 0; fi
  log "installing osv-scanner (optional SCA enhancer; OSV HTTP API works without it)…"
  if brew_ok; then
    brew install osv-scanner || true
  elif have go; then
    go install github.com/google/osv-scanner/cmd/osv-scanner@latest || true
    export PATH="${HOME}/go/bin:${PATH}"
  else
    log "NOTE: osv-scanner not installed (need brew or go); SCA will use OSV HTTP API / npm audit"
    return 0
  fi
  have osv-scanner || log "NOTE: osv-scanner optional — SCA still uses OSV API without it"
  return 0
}

install_gosec() {
  if have gosec; then return 0; fi
  log "installing gosec…"
  if brew_ok; then
    brew install gosec || true
  fi
  if ! have gosec && have go; then
    go install github.com/securego/gosec/v2/cmd/gosec@latest
    export PATH="${HOME}/go/bin:${PATH}"
  fi
  if ! have gosec; then
    log "ERROR: need brew or go to install gosec"
    return 1
  fi
}

install_eslint() {
  if have eslint; then return 0; fi
  log "installing eslint…"
  npm install -g eslint
  export PATH="$(npm prefix -g)/bin:${PATH}"
}

install_golangci() {
  if have golangci-lint; then return 0; fi
  log "installing golangci-lint…"
  if brew_ok; then
    brew install golangci-lint
  else
    curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
      | sh -s -- -b "${HOME}/.local/bin"
    export PATH="${HOME}/.local/bin:${PATH}"
  fi
}

WITH_LINT_PY=0
WITH_LINT_JS=0
WITH_LINT_GO=0
WITH_BANDIT=0
WITH_GOSEC=0

usage() {
  cat >&2 <<'EOF'
Usage: install_sast_tools.sh [options]
  --core       semgrep + gitleaks (+ optional osv-scanner; SCA uses OSV API without binary)
  --bandit     Python security (bandit)
  --gosec      Go security (gosec)
  --lint-py    ruff
  --lint-js    eslint
  --lint-go    golangci-lint
  --all-lint   ruff + eslint + golangci-lint
  No SonarQube / CodeQL — those need servers or SARIF env and are not supported.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core) shift ;;
    --bandit) WITH_BANDIT=1; shift ;;
    --gosec) WITH_GOSEC=1; shift ;;
    --lint-py) WITH_LINT_PY=1; shift ;;
    --lint-js) WITH_LINT_JS=1; shift ;;
    --lint-go) WITH_LINT_GO=1; shift ;;
    --all-lint) WITH_LINT_PY=1; WITH_LINT_JS=1; WITH_LINT_GO=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) log "unknown arg: $1"; usage; exit 2 ;;
  esac
done

# Tolerate per-tool failures; aggregate missing at the end
set +e
install_semgrep
install_gitleaks
install_osv_scanner
[[ $WITH_BANDIT -eq 1 ]] && install_bandit
[[ $WITH_GOSEC -eq 1 ]] && install_gosec
[[ $WITH_LINT_PY -eq 1 ]] && install_ruff
[[ $WITH_LINT_JS -eq 1 ]] && install_eslint
[[ $WITH_LINT_GO -eq 1 ]] && install_golangci
set -e

# Refresh common PATH prefixes after installs
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:${HOME}/go/bin:$(npm prefix -g 2>/dev/null)/bin:${PATH}"
for d in "${HOME}"/Library/Python/*/bin; do
  [[ -d "$d" ]] && export PATH="${d}:${PATH}"
done

missing=()
have semgrep || missing+=(semgrep)
have gitleaks || missing+=(gitleaks)
[[ $WITH_BANDIT -eq 1 ]] && { have bandit || missing+=(bandit); }
[[ $WITH_GOSEC -eq 1 ]] && { have gosec || missing+=(gosec); }
[[ $WITH_LINT_PY -eq 1 ]] && { have ruff || missing+=(ruff); }
[[ $WITH_LINT_JS -eq 1 ]] && { have eslint || missing+=(eslint); }
[[ $WITH_LINT_GO -eq 1 ]] && { have golangci-lint || missing+=(golangci-lint); }

if [[ ${#missing[@]} -gt 0 ]]; then
  log "FATAL: still missing after install: ${missing[*]}"
  log "PATH=${PATH}"
  exit 1
fi

log "OK — OOTB tools ready:"
for t in semgrep gitleaks; do
  printf '  %s -> %s\n' "$t" "$(command -v "$t")" >&2
done
have osv-scanner && printf '  osv-scanner -> %s\n' "$(command -v osv-scanner)" >&2
log "  SCA -> OSV HTTP API (always) + osv-scanner/npm-audit when available"
[[ $WITH_BANDIT -eq 1 ]] && printf '  bandit -> %s\n' "$(command -v bandit)" >&2
[[ $WITH_GOSEC -eq 1 ]] && printf '  gosec -> %s\n' "$(command -v gosec)" >&2
[[ $WITH_LINT_PY -eq 1 ]] && printf '  ruff -> %s\n' "$(command -v ruff)" >&2
[[ $WITH_LINT_JS -eq 1 ]] && printf '  eslint -> %s\n' "$(command -v eslint)" >&2
[[ $WITH_LINT_GO -eq 1 ]] && printf '  golangci-lint -> %s\n' "$(command -v golangci-lint)" >&2
exit 0
