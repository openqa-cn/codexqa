#!/usr/bin/env bash
# codexqa-code-reviewer: Derive Error handling / resilience signals from a CodexQA pack.
# Local only — zero extra codexqa calls; no network chaos/SLO probes.
# Usage: derive-resilience.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
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
Usage: derive-resilience.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]

Writes <OUT_DIR>/14-resilience-signals.json from 04-changed-files (or full
sample) + bounded on-disk source scan (timeout/retry/swallow/partial/idempot).
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

OUT="$DIR/14-resilience-signals.json"
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

BODY_PY="$(cd "$(dirname "$0")" && pwd)/_resilience_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$DIR" "$REPO" "$files_file" "$lang_file" "$TMPD/body.json"
else
  echo '{"body_ok":false,"repo_resolved":false,"signals_thin":true,"silent_swallows":[],"timeout_gaps":[],"retry_risks":[],"degradation_or_breaker":[],"partial_failure_gaps":[],"idempotency_gaps":[],"residual_hardening":[],"thresholds":{},"files_considered":0,"files_scanned":0,"surfaces":{}}' >"$TMPD/body.json"
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
      kind: "ResilienceSignals",
      mode: $mode,
      generated_by: "derive-resilience.sh",
      schema_version: 1,
      signals_thin: (if ($b|has("signals_thin")) then $b.signals_thin else true end),
      thresholds: ($b.thresholds // {
        max_files: 40,
        max_lines: 4000,
        neighbor: 4
      }),
      silent_swallows: ($b.silent_swallows // []),
      timeout_gaps: ($b.timeout_gaps // []),
      retry_risks: ($b.retry_risks // []),
      degradation_or_breaker: ($b.degradation_or_breaker // []),
      partial_failure_gaps: ($b.partial_failure_gaps // []),
      idempotency_gaps: ($b.idempotency_gaps // []),
      exception_unwraps: ($b.exception_unwraps // []),
      resource_leaks: ($b.resource_leaks // []),
      charset_gaps: ($b.charset_gaps // []),
      null_deref_gaps: ($b.null_deref_gaps // []),
      authz_audit_gaps: ($b.authz_audit_gaps // []),
      disabled_bounds: ($b.disabled_bounds // []),
      retry_side_effects: ($b.retry_side_effects // []),
      shared_mutables: ($b.shared_mutables // []),
      process_defaults: ($b.process_defaults // []),
      protection_gaps: ($b.protection_gaps // []),
      residual_hardening: ($b.residual_hardening // []),
      surfaces: ($b.surfaces // {}),
      summary: {
        silent_swallow_count: (($b.silent_swallows // [])|length),
        timeout_gap_count: (($b.timeout_gaps // [])|length),
        retry_risk_count: (($b.retry_risks // [])|length),
        degrade_breaker_count: (($b.degradation_or_breaker // [])|length),
        partial_failure_count: (($b.partial_failure_gaps // [])|length),
        idempotency_gap_count: (($b.idempotency_gaps // [])|length),
        exception_unwrap_count: (($b.exception_unwraps // [])|length),
        resource_leak_count: (($b.resource_leaks // [])|length),
        charset_gap_count: (($b.charset_gaps // [])|length),
        null_deref_gap_count: (($b.null_deref_gaps // [])|length),
        authz_audit_gap_count: (($b.authz_audit_gaps // [])|length),
        disabled_bound_count: (($b.disabled_bounds // [])|length),
        retry_side_effect_count: (($b.retry_side_effects // [])|length),
        shared_mutable_count: (($b.shared_mutables // [])|length),
        process_default_count: (($b.process_defaults // [])|length),
        protection_gap_count: (($b.protection_gaps // [])|length),
        residual_hardening_count: (($b.residual_hardening // [])|length),
        files_considered: ($b.files_considered // 0),
        files_scanned: ($b.files_scanned // 0),
        body_ok: (if ($b|has("body_ok")) then $b.body_ok else false end),
        repo_resolved: (if ($b|has("repo_resolved")) then $b.repo_resolved else false end)
      },
      confidence_caps: {
        heuristic: "medium",
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total,
        no_chaos_probe: true
      },
      evidence_refs: ["04-changed-files.json"],
      notes: (
        if (if ($b|has("body_ok")) then $b.body_ok else false end) then
          (
            if (if ($b|has("repo_resolved")) then $b.repo_resolved else false end) then []
            else ["repo not resolved — pass --repo or write manifest.repo before derive"]
            end
            + (
              if (if ($b|has("signals_thin")) then $b.signals_thin else true end) then
                (
                  if (($b.residual_hardening // [])|length) > 0 then
                    ["signals_thin for findings — emit None; still report residual_hardening (degrade/breaker clues absent)"]
                  else
                    ["no resilience heuristics hit — emit None in review"]
                  end
                )
              else []
              end
            )
            + (
              if (($b.residual_hardening // [])|length) > 0
                 and (if ($b|has("signals_thin")) then $b.signals_thin else true end | not) then
                ["residual_hardening present — cover as residual in report, not automatic P1"]
              else []
              end
            )
            + (
              if (($b.charset_gaps // [])|length) > 0
                 or (($b.null_deref_gaps // [])|length) > 0
                 or (($b.authz_audit_gaps // [])|length) > 0
                 or (($b.resource_leaks // [])|length) > 0 then
                ["Hard gate: each charset_gaps, null_deref_gaps, authz_audit_gaps, resource_leaks, disabled_bounds, retry_side_effects, shared_mutables, and process_defaults row needs path:line. A disabling literal is not a residual. A max retry count does not close retry_side_effects. A different rule_id on the same line is a separate finding."]
              else []
              end
            )
            + ["Never invent production SLO/chaos conclusions; residual hardening when thin"]
          )
        else ["resilience body metrics skipped (${ACR_PY:-python3} missing)"]
        end
      )
    }
  ' >"$OUT"

if [[ -f "$OUT" ]]; then
  "$SCRIPT_DIR/../acr-python" "$SCRIPT_DIR/derive_triage.py" "$OUT" "${REPO:-}" || echo "warn: derive triage failed for $OUT" >&2
fi
echo "Resilience signals written: $OUT"
