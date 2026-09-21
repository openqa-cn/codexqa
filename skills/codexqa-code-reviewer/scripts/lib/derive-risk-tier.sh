#!/usr/bin/env bash
# codexqa-code-reviewer: Derive blast-radius risk tier (T0–T3) from a CodexQA pack.
# Local only — zero extra codexqa calls.
# Usage: derive-risk-tier.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
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
Usage: derive-risk-tier.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]

Writes <OUT_DIR>/20-risk-tier.json from 04-changed-files (+ full sample),
06-sensitive-hits, 07-tags, and 15-rollout-signals surfaces.
Missing inputs → escalate one tier (never down), exit 0.

--repo: absolute repo root (accepted for collector parity; body does not need disk).
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

OUT="$DIR/20-risk-tier.json"
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

BODY_PY="$(cd "$(dirname "$0")" && pwd)/_risk_tier_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$DIR" "$REPO" "$files_file" "$lang_file" "$TMPD/body.json"
else
  echo '{"body_ok":false,"signals_thin":true,"tier":"T1","tier_numeric":1,"industry_tier":"Tier2","drivers":{"path_hits":[],"tag_hits":[],"sensitive_hits":[],"rollout_surfaces":{}},"file_tiers":[],"review_depth":{"evidence_floor":"trimmed_checklist"},"files_considered":0,"missing_inputs":["python3"],"notes":["risk_tier body skipped (${ACR_PY:-python3} missing) — default T1"]}' >"$TMPD/body.json"
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
  | ($b.tier // "T1") as $tier
  | {
      kind: "RiskTierSignals",
      mode: $mode,
      generated_by: "derive-risk-tier.sh",
      schema_version: 1,
      signals_thin: (if ($b|has("signals_thin")) then $b.signals_thin else true end),
      tier: $tier,
      tier_numeric: ($b.tier_numeric // 1),
      industry_tier: ($b.industry_tier // "Tier2"),
      drivers: ($b.drivers // {
        path_hits: [],
        tag_hits: [],
        sensitive_hits: [],
        rollout_surfaces: {}
      }),
      file_tiers: ($b.file_tiers // []),
      review_depth: ($b.review_depth // {
        evidence_floor: "trimmed_checklist",
        must_attempt_dimensions: ["all_registry"],
        required_graph: true,
        min_evidence_cites_per_finding: 1,
        paired_review_recommended: false,
        escalate_if: ["new_t0_surface"]
      }),
      summary: {
        tier: $tier,
        industry_tier: ($b.industry_tier // "Tier2"),
        files_considered: ($b.files_considered // 0),
        path_hit_count: ((($b.drivers // {}).path_hits // [])|length),
        tag_hit_count: ((($b.drivers // {}).tag_hits // [])|length),
        sensitive_hit_count: ((($b.drivers // {}).sensitive_hits // [])|length),
        missing_input_count: (($b.missing_inputs // [])|length),
        body_ok: (if ($b|has("body_ok")) then $b.body_ok else false end)
      },
      confidence_caps: {
        heuristic: "medium",
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total,
        escalate_on_uncertainty: true
      },
      evidence_refs: [
        "04-changed-files.json",
        "06-sensitive-hits.json",
        "07-tags.json",
        "15-rollout-signals.json"
      ],
      notes: (
        ($b.notes // [])
        + (
          if (if ($b|has("body_ok")) then $b.body_ok else false end | not) then
            ["risk_tier body metrics skipped (${ACR_PY:-python3} missing)"]
          else []
          end
        )
        + ["T0=highest blast; auth/pay/migration/IaC force T0; never downgrade mid-review"]
      )
    }
  ' >"$OUT"

echo "Risk tier written: $OUT"
