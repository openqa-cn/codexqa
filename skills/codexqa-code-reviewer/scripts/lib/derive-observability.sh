#!/usr/bin/env bash
# codexqa-code-reviewer: Derive observability signals (local; 0 extra CodexQA).
# Usage: derive-observability.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"
DIR=""; MODE="pr"; REPO_ARG=""
usage() { cat <<'U'
Usage: derive-observability.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
Writes <OUT_DIR>/16-observability-signals.json (missing logs/metrics on catch).
U
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
[[ -n "$DIR" && -d "$DIR" ]] || { echo "error: --dir required" >&2; exit 2; }
case "$MODE" in pr|full) ;; *) echo "error: --mode pr|full" >&2; exit 2 ;; esac
OUT="$DIR/16-observability-signals.json"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
files_file="$DIR/04-changed-files.json"
[[ "$MODE" == "full" && -f "$DIR/03-files-sample.json" ]] && files_file="$DIR/03-files-sample.json"
manifest_file="$DIR/manifest.json"
[[ -f "$files_file" ]] || files_file=""
[[ -f "$manifest_file" ]] || manifest_file=""
echo '{}' >"$TMPD/empty.json"
[[ -n "$files_file" ]] || files_file="$TMPD/empty.json"
[[ -n "$manifest_file" ]] || manifest_file="$TMPD/empty.json"
REPO="$(jq -r '.repo // empty' "$manifest_file" 2>/dev/null || true)"
[[ -n "$REPO_ARG" ]] && REPO="$REPO_ARG"
[[ -z "$REPO" && -n "${CODEXQA_REPO:-}" ]] && REPO="$CODEXQA_REPO"
BODY_PY="$(cd "$(dirname "$0")" && pwd)/_secondary_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$REPO" "$files_file" "$TMPD/body.json" "observability"
else
  echo '{"body_ok":false,"repo_resolved":false,"signals_thin":true}' >"$TMPD/body.json"
fi
jq -n --arg mode "$MODE" --slurpfile body "$TMPD/body.json" --slurpfile iq "$manifest_file" '
  def stubs_total:
    ($iq[0].index_quality.stubs // 0) as $s
    | if ($s|type)=="object" then ($s.total // 0) elif ($s|type)=="number" then $s else 0 end;
  ($body[0] // {}) as $b
  | $b + {
      kind: "ObservabilitySignals",
      mode: $mode,
      generated_by: "derive-observability.sh",
      schema_version: 1,
      signals_thin: (if ($b|has("signals_thin")) then $b.signals_thin else true end),
      confidence_caps: { heuristic: "medium", stubs_cap_unknown: (stubs_total >= 20), stubs: stubs_total },
      evidence_refs: ["04-changed-files.json"]
    }
' >"$OUT"
echo "ObservabilitySignals written: $OUT"
