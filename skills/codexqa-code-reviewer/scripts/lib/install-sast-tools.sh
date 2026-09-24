#!/usr/bin/env bash
# Install SAST binaries that are not already on PATH.
# Already-present tools are skipped. CodexQA stays the primary review engine.
#
# Usage:
#   ./scripts/lib/install-sast-tools.sh            # install every missing tool
#   ./scripts/lib/install-sast-tools.sh --print    # print the commands only
#
# Real reviews must run this (derive-sast.sh does) before scanning.
# CODEXQA_SAST_SKIP_INSTALL=1 is only for the offline skill gate.
set -euo pipefail

PRINT_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --print) PRINT_ONLY=1; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: install-sast-tools.sh [--print]

Installs each missing tool. Commands (run only for tools not already on PATH):

  semgrep     python3 -m pip install --user --break-system-packages 'semgrep>=1.80'
  bandit      python3 -m pip install --user --break-system-packages bandit
  ruff        python3 -m pip install --user --break-system-packages ruff
  eslint      npm install -g eslint
  gitleaks    go install github.com/gitleaks/gitleaks/v8@latest
  gosec       go install github.com/securego/gosec/v2/cmd/gosec@latest
  osv-scanner go install github.com/google/osv-scanner/cmd/osv-scanner@latest

Before deciding a tool is missing, scripts/lib/sast-tool-path.sh prepends
each directory that actually holds the CodexQA CLI, a SAST binary, or the
runtime that installs it. codexqa_cli_path prints the CLI after that probe.
No install prefix is hardcoded. npm bins (codexqa, eslint) come from the
prefix in ~/.npmrc, $npm_config_prefix, and `npm prefix -g`
(<prefix>/bin on Unix; the prefix directory on Windows). pip bins
(semgrep, bandit, ruff) come from Python sysconfig (bin, or Scripts on
Windows). Go bins come from $GOBIN, $GOPATH, and `go env` (';' on Windows),
including go.exe. Node shims come from
$NVM_DIR, $VOLTA_HOME, $FNM_DIR, and $ASDF_DATA_DIR. The GitHub release download for
gitleaks / gosec / osv-scanner runs only when no `go` binary runs, or
`go install` still leaves that tool missing. A copy that fails
`--version` is moved aside first.

--print  show the commands for missing tools and do not download.
EOF
      exit 0
      ;;
    *) echo "error: unknown arg: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
# shellcheck source=sast-tool-path.sh
source "$SCRIPT_DIR/sast-tool-path.sh"
PY="$(acr_resolve_python 2>/dev/null || true)"
if [[ -z "${PY:-}" ]]; then
  PY="$(command -v python3 || true)"
fi

refresh_path() { sast_refresh_path; }

refresh_path

have() { command -v "$1" >/dev/null 2>&1; }

# Truncated GitHub downloads are executable and still crash. Do not keep them
# ahead of a later `go install` result in ~/.local/bin.
drop_unusable() {
  local bin="$1" path
  path="$(command -v "$bin" 2>/dev/null || true)"
  [[ -n "$path" && -x "$path" ]] || return 0
  if [[ "$PRINT_ONLY" -eq 1 ]]; then
    return 0
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout 8 "$bin" --version >/dev/null 2>&1 && return 0
  else
    "$bin" --version >/dev/null 2>&1 && return 0
  fi
  log "WARN: ${path} does not run (${bin} --version); moving it aside"
  mv -f "$path" "${path}.broken.$(date +%s)"
  hash -r
}

tool_runs() {
  local bin="$1"
  have "$bin" || return 1
  case "$bin" in
    gitleaks|gosec|osv-scanner)
      if command -v timeout >/dev/null 2>&1; then
        timeout 8 "$bin" --version >/dev/null 2>&1
      else
        "$bin" --version >/dev/null 2>&1
      fi
      ;;
    *) return 0 ;;
  esac
}

log() { printf '[install-sast-tools] %s\n' "$*" >&2; }

run_install() {
  log "RUN: $*"
  if [[ "$PRINT_ONLY" -eq 1 ]]; then
    printf '%s\n' "$*"
    return 0
  fi
  # shellcheck disable=SC2294
  eval "$@"
}

pip_user() {
  if [[ -z "${PY:-}" ]]; then
    log "ERROR: Python 3.10+ required to pip-install $1"
    return 1
  fi
  run_install "\"$PY\" -m pip install --user --break-system-packages $1"
  refresh_path
}

arch_token() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "amd64" ;;
  esac
}

# Download one GitHub release asset whose name matches a jq test() regex.
github_release_bin() {
  local repo="$1" asset_re="$2" inner="$3" dest_name="$4"
  local tag url tmp
  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    log "ERROR: curl and jq are required to download ${dest_name}"
    return 1
  fi
  tag="$(curl -fsSL --max-time 20 "https://api.github.com/repos/${repo}/releases/latest" | jq -r '.tag_name // empty')"
  url="$(curl -fsSL --max-time 20 "https://api.github.com/repos/${repo}/releases/latest" \
    | jq -r --arg re "$asset_re" '[.assets[].browser_download_url | select(test($re))][0] // empty')"
  if [[ -z "$tag" || -z "$url" || "$url" == "null" ]]; then
    log "ERROR: no GitHub asset for ${repo} matching ${asset_re}"
    return 1
  fi
  log "DOWNLOAD: ${url}"
  if [[ "$PRINT_ONLY" -eq 1 ]]; then
    printf 'curl -fsSL -L -o "$HOME/.local/bin/%s" %q && chmod +x "$HOME/.local/bin/%s"\n' \
      "$dest_name" "$url" "$dest_name"
    return 0
  fi
  mkdir -p "${HOME}/.local/bin"
  tmp="$(mktemp -d)"
  curl -fsSL --max-time 45 -L "$url" -o "$tmp/asset"
  local found=""
  if [[ "$url" == *.tar.gz || "$url" == *.tgz ]]; then
    tar -xzf "$tmp/asset" -C "$tmp"
    found="$(find "$tmp" -type f -name "$inner" | head -n 1)"
  else
    found="$tmp/asset"
  fi
  if [[ -z "$found" || ! -f "$found" ]]; then
    log "ERROR: ${inner} not inside ${url}"
    rm -rf "$tmp"
    return 1
  fi
  mv -f "$found" "${HOME}/.local/bin/${dest_name}"
  chmod +x "${HOME}/.local/bin/${dest_name}"
  rm -rf "$tmp"
  refresh_path
}

install_go_or_release() {
  local bin="$1" go_pkg="$2" repo="$3" asset_re="$4" inner="$5"
  drop_unusable "$bin"
  if have "$bin"; then
    return 0
  fi
  if have go; then
    run_install "go install ${go_pkg}"
    refresh_path
    if [[ "$PRINT_ONLY" -eq 1 ]] || have "$bin"; then
      return 0
    fi
  fi
  if [[ "$PRINT_ONLY" -eq 1 ]]; then
    printf 'curl -fsSL -L -o "$HOME/.local/bin/%s" <latest %s release matching %s> && chmod +x "$HOME/.local/bin/%s"\n' \
      "$bin" "$repo" "$asset_re" "$bin"
    return 0
  fi
  log "no runnable go, or go install left ${bin} missing; downloading release"
  github_release_bin "$repo" "$asset_re" "$inner" "$bin"
}

missing_any=0
note_missing() { missing_any=1; }

if ! have semgrep; then
  pip_user "'semgrep>=1.80'" || note_missing
fi
if ! have bandit; then
  pip_user "bandit" || note_missing
fi
if ! have ruff; then
  pip_user "ruff" || note_missing
fi
if ! have eslint; then
  if have npm; then
    run_install "npm install -g eslint" || note_missing
    refresh_path
  else
    log "ERROR: npm is required to install eslint (Node >= 18)"
    note_missing
  fi
fi

ARCH="$(arch_token)"
if ! have gitleaks; then
  install_go_or_release gitleaks \
    "github.com/gitleaks/gitleaks/v8@latest" \
    "gitleaks/gitleaks" \
    "linux_${ARCH}.*\\.tar\\.gz|linux_x64.*\\.tar\\.gz" \
    "gitleaks" || note_missing
fi
if ! have gosec; then
  install_go_or_release gosec \
    "github.com/securego/gosec/v2/cmd/gosec@latest" \
    "securego/gosec" \
    "linux_${ARCH}.*\\.tar\\.gz" \
    "gosec" || note_missing
fi
if ! have osv-scanner; then
  install_go_or_release osv-scanner \
    "github.com/google/osv-scanner/cmd/osv-scanner@latest" \
    "google/osv-scanner" \
    "osv-scanner_linux_${ARCH}" \
    "osv-scanner" || note_missing
fi

refresh_path
still=()
for t in semgrep bandit ruff eslint gitleaks gosec osv-scanner; do
  if ! tool_runs "$t"; then
    still+=("$t")
  fi
done

if [[ ${#still[@]} -gt 0 ]]; then
  log "still missing after install: ${still[*]}"
  log "PATH=${PATH}"
  exit 1
fi

log "SAST tools ready: semgrep bandit ruff eslint gitleaks gosec osv-scanner"
exit 0
