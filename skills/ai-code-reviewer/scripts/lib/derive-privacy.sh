#!/usr/bin/env bash
# ai-code-reviewer: Derive Privacy / compliance signals from a CodexQA pack.
# Local only — zero extra codexqa calls; no network legal lookups.
# Usage: derive-privacy.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"

DIR=""
MODE="pr"
REPO_ARG=""

usage() {
  cat <<'EOF'
Usage: derive-privacy.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]

Writes <OUT_DIR>/13-privacy-signals.json from 04-changed-files (or full
sample) + bounded on-disk source scan + optional 06-sensitive-hits reuse.
Missing inputs → thin signals, exit 0.

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
  pr|full) ;;
  *) echo "error: --mode must be pr or full" >&2; exit 2 ;;
esac

OUT="$DIR/13-privacy-signals.json"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

files_file="$DIR/04-changed-files.json"
if [[ "$MODE" == "full" ]]; then
  [[ -f "$DIR/03-files-sample.json" ]] && files_file="$DIR/03-files-sample.json"
fi
manifest_file="$DIR/manifest.json"
lang_file="$DIR/09-language-profile.json"

[[ -f "$files_file" ]] || files_file=""
[[ -f "$manifest_file" ]] || manifest_file=""
[[ -f "$lang_file" ]] || lang_file=""

echo '{}' >"$TMPD/empty.json"
[[ -n "$files_file" ]] || files_file="$TMPD/empty.json"
[[ -n "$manifest_file" ]] || manifest_file="$TMPD/empty.json"
[[ -n "$lang_file" ]] || lang_file="$TMPD/empty.json"

REPO="$(jq -r '.repo // empty' "$manifest_file" 2>/dev/null || true)"
if [[ -n "$REPO_ARG" ]]; then
  REPO="$REPO_ARG"
elif [[ -z "$REPO" && -n "${CODEXQA_REPO:-}" ]]; then
  REPO="$CODEXQA_REPO"
fi

BODY_PY="$(cd "$(dirname "$0")" && pwd)/_privacy_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$DIR" "$REPO" "$files_file" "$lang_file" "$TMPD/body.json"
else
  echo '{"body_ok":false,"repo_resolved":false,"signals_thin":true,"pii_field_hits":[],"log_exposure":[],"minimization_flags":[],"retention_gaps":[],"consent_or_transfer_hints":[],"sensitive_reuse":[],"thresholds":{},"files_considered":0,"files_scanned":0}' >"$TMPD/body.json"
fi

jq -n \
  --arg mode "$MODE" \
  --slurpfile iq "$manifest_file" \
  --slurpfile body "$TMPD/body.json" \
  '
  def stubs_total:
    ($iq[0].index_quality.stubs // 0) as $s
    | if ($s|type) == "object" then ($s.total // 0)
      elif ($s|type) == "number" then $s
      else 0 end;

  ($body[0] // {}) as $b
  | {
      kind: "PrivacySignals",
      mode: $mode,
      generated_by: "derive-privacy.sh",
      schema_version: 1,
      signals_thin: (if ($b|has("signals_thin")) then $b.signals_thin else true end),
      thresholds: ($b.thresholds // {
        pii_fields: 5,
        max_files: 40,
        max_lines: 4000,
        log_neighbor: 3
      }),
      pii_field_hits: ($b.pii_field_hits // []),
      log_exposure: ($b.log_exposure // []),
      minimization_flags: ($b.minimization_flags // []),
      retention_gaps: ($b.retention_gaps // []),
      consent_or_transfer_hints: ($b.consent_or_transfer_hints // []),
      sensitive_reuse: ($b.sensitive_reuse // []),
      summary: {
        pii_field_count: (($b.pii_field_hits // [])|length),
        log_exposure_count: (($b.log_exposure // [])|length),
        minimization_flag_count: (($b.minimization_flags // [])|length),
        retention_gap_count: (($b.retention_gaps // [])|length),
        consent_transfer_hint_count: (($b.consent_or_transfer_hints // [])|length),
        files_considered: ($b.files_considered // 0),
        files_scanned: ($b.files_scanned // 0),
        body_ok: (if ($b|has("body_ok")) then $b.body_ok else false end),
        repo_resolved: (if ($b|has("repo_resolved")) then $b.repo_resolved else false end)
      },
      confidence_caps: {
        heuristic: "medium",
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total,
        no_legal_conclusion: true
      },
      evidence_refs: (
        ["04-changed-files.json"]
        + (if (($b.sensitive_reuse // [])|length) > 0 then ["06-sensitive-hits.json"] else [] end)
      ),
      notes: (
        if (if ($b|has("body_ok")) then $b.body_ok else false end) then
          (
            if (if ($b|has("repo_resolved")) then $b.repo_resolved else false end) then []
            else ["repo not resolved — pass --repo or write manifest.repo before derive"]
            end
            + (
              if (if ($b|has("signals_thin")) then $b.signals_thin else true end) then
                ["no privacy heuristics hit — emit None in review"]
              else []
              end
            )
            + ["Never invent GDPR/compliance conclusions; residual DPO/legal/privacy scan when thin"]
          )
        else ["privacy body metrics skipped (${ACR_PY:-python3} missing)"]
        end
      )
    }
  ' >"$OUT"

echo "Privacy signals written: $OUT"
