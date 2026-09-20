#!/usr/bin/env bash
# ai-code-reviewer: Derive annotation-edge compensation (0 extra CodexQA).
# Writes 19-annotation-edges.json for Spring/Resilience4j callback callers.
set -euo pipefail

DIR=""
MODE="pr"
REPO=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"

usage() {
  cat <<'EOF'
Usage: derive-annotation-edges.sh --dir <OUT_DIR> [--mode pr|full|adhoc] [--repo PATH]

Writes <OUT_DIR>/19-annotation-edges.json from on-disk sources listed in the pack.
Compensates empty edges-in for @CircuitBreaker fallbackMethod / Spring entries.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
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
  *) echo "error: --mode must be pr|full|adhoc" >&2; exit 2 ;;
esac

OUT="$DIR/19-annotation-edges.json"
BODY="$SCRIPT_DIR/_annotation_edges_body.py"

if [[ -z "$REPO" && -f "$DIR/manifest.json" ]]; then
  REPO="$(jq -r '.repo // empty' "$DIR/manifest.json" 2>/dev/null || true)"
fi

if ! { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; }; then
  jq -n '{
    kind:"AnnotationEdges",
    generated_by:"derive-annotation-edges.sh",
    schema_version:1,
    signals_thin:true,
    edges:[],
    notes:["${ACR_PY:-python3} unavailable — annotation edges skipped"]
  }' >"$OUT"
  echo "Annotation edges thin (no python3): $OUT"
  exit 0
fi

if [[ ! -f "$BODY" ]]; then
  echo "error: missing $BODY" >&2
  exit 1
fi

"$SCRIPT_DIR/../acr-python" "$BODY" "$DIR" "$OUT" "${REPO:-}"
echo "Annotation edges written: $OUT"
