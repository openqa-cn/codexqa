#!/usr/bin/env bash
# codexqa-code-reviewer: Deterministic SAST signals (secondary to CodexQA).
# Invokes Semgrep, Bandit, gosec, gitleaks, osv-scanner, ruff, eslint when present.
# Usage: derive-sast.sh --dir <OUT_DIR> [--mode pr|full|adhoc] [--repo <REPO>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
# shellcheck source=sast-tool-path.sh
source "$SCRIPT_DIR/sast-tool-path.sh"

DIR=""
MODE="pr"
REPO_ARG=""

usage() {
  cat <<'EOF'
Usage: derive-sast.sh --dir <OUT_DIR> [--mode pr|full|adhoc] [--repo <REPO>]

Writes <OUT_DIR>/23-sast-signals.json. Before scanning, installs any missing
Semgrep, Bandit, gosec, gitleaks, osv-scanner, ruff, or eslint via
install-sast-tools.sh. Semgrep uses fixed packs p/java, p/security-audit,
and p/secrets with --metrics=off (never --config auto). Each pack is its own
process, so one pack timing out keeps hits from the packs that finished.
tools.semgrep.status
is ran only after that ruleset loads; a non-0/1 exit, non-JSON stdout, or
non-empty errors is status=error and keeps stderr. Set
CODEXQA_SAST_SKIP_INSTALL=1 only for the offline skill gate — a real review
must not skip install.
Pattern classes (SSRF, path traversal, pickle, weak hash, float money, …)
are owned here; the LLM pass must not re-file them.

--repo: absolute repo root (prefer when collect runs before manifest.json).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --repo) REPO_ARG="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "error: --dir must be an existing evidence pack directory" >&2
  exit 2
fi

case "$MODE" in
  pr|full|adhoc) ;;
  *) echo "error: --mode must be pr, full, or adhoc" >&2; exit 2 ;;
esac

REPO="$REPO_ARG"
if [[ -z "$REPO" && -f "$DIR/manifest.json" ]]; then
  REPO="$(jq -r '.repo // empty' "$DIR/manifest.json" 2>/dev/null || true)"
fi

# Same probe as the installer. A child install cannot export PATH back here.
sast_refresh_path

# install-sast-tools.sh re-resolves PATH and runs --version on the Go tools.
# When every binary is already visible, that second pass only adds latency.
sast_tools_on_path() {
  local tool
  for tool in semgrep bandit ruff eslint gitleaks gosec osv-scanner; do
    command -v "$tool" >/dev/null 2>&1 || return 1
  done
  return 0
}

if [[ "${CODEXQA_SAST_SKIP_INSTALL:-}" != "1" ]]; then
  if sast_tools_on_path; then
    echo "[derive-sast] SAST tools already on PATH; skip install" >&2
  elif [[ -x "$SCRIPT_DIR/install-sast-tools.sh" ]]; then
    if ! "$SCRIPT_DIR/install-sast-tools.sh"; then
      echo "warn: install-sast-tools.sh did not finish; scan continues with tools that are present" >&2
    fi
    sast_refresh_path
  else
    echo "error: install-sast-tools.sh missing; refusing to scan without the install step" >&2
    exit 1
  fi
fi

BODY="$SCRIPT_DIR/_sast_body.py"
if [[ -f "$BODY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY" "$DIR" "${REPO:-}" "$MODE"
else
  echo '{"kind":"SastSignals","schema_version":1,"tools":{},"findings":[],"lint_notes":[],"pattern_classes_owned":[],"llm_report_policy":{},"llm_must_not_report":[]}' >"$DIR/23-sast-signals.json"
fi
