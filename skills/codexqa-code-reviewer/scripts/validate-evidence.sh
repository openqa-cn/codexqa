#!/usr/bin/env bash
# codexqa-code-reviewer: Validate CodexQA evidence pack before review reasoning.
# PR: fails on empty change-groups or all change_status=default (plan gate).
set -euo pipefail

DIR=""
MODE="pr"

usage() {
  cat <<'EOF'
Usage: validate-evidence.sh --dir <evidence-dir> [--mode pr|full|adhoc]

Exit 0 if pack looks usable; non-zero with reasons otherwise.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "error: --dir must be an existing directory" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

ERRORS=()
WARNINGS=()

need() {
  local f="$1"
  if [[ ! -f "$DIR/$f" ]]; then
    ERRORS+=("missing file: $f")
  elif [[ ! -s "$DIR/$f" ]]; then
    ERRORS+=("empty file: $f")
  fi
}

need_any() {
  local ok=0
  local f
  for f in "$@"; do
    if [[ -f "$DIR/$f" && -s "$DIR/$f" ]]; then
      ok=1
      break
    fi
  done
  if [[ "$ok" -eq 0 ]]; then
    ERRORS+=("missing one of: $*")
  fi
}

need "manifest.json"
need "01-stats.json"
need "02-summary.json"

# --- CodexQA provenance gate (all languages) ---
# New packs: engine=codexqa. Legacy packs: accept if commands/log prove codexqa CLI.
if [[ -f "$DIR/manifest.json" ]]; then
  ENGINE="$(jq -r '.engine // .analysis_backend // empty' "$DIR/manifest.json" 2>/dev/null || true)"
  HAS_CODEXQA_CMD=0
  if jq -e '(.commands // []) | map(tostring) | any(test("codexqa"))' "$DIR/manifest.json" >/dev/null 2>&1; then
    HAS_CODEXQA_CMD=1
  elif [[ -f "$DIR/commands.log" ]] && grep -q 'codexqa' "$DIR/commands.log" 2>/dev/null; then
    HAS_CODEXQA_CMD=1
  fi
  case "$ENGINE" in
    codexqa|codexqa-cli) ;;
    "")
      if [[ "$HAS_CODEXQA_CMD" -ne 1 ]]; then
        ERRORS+=("CodexQA provenance missing: set manifest.engine=codexqa or include codexqa in commands/commands.log. ALL languages must use CodexQA CLI — no git-diff-only / grep-only primary analysis.")
      else
        WARNINGS+=("legacy pack without manifest.engine; codexqa found in commands — recollect to stamp engine=codexqa")
      fi
      ;;
    *)
      ERRORS+=("unsupported analysis engine='$ENGINE' — only CodexQA CLI is allowed as primary backend for any language")
      ;;
  esac
  SKILL_NAME="$(jq -r '.skill // empty' "$DIR/manifest.json" 2>/dev/null || true)"
  if [[ -n "$SKILL_NAME" && "$SKILL_NAME" != "codexqa-code-reviewer" && "$SKILL_NAME" != "code-review-codexqa" ]]; then
    WARNINGS+=("manifest.skill=$SKILL_NAME (expected codexqa-code-reviewer); continuing for compatibility")
  fi
fi

# --- Primary language gate (compat: warn if missing on legacy packs) ---
if [[ -f "$DIR/09-language-profile.json" ]]; then
  PL="$(jq -r '.primary_language // empty' "$DIR/09-language-profile.json" 2>/dev/null || true)"
  CONF="$(jq -r '.confidence // empty' "$DIR/09-language-profile.json" 2>/dev/null || true)"
  if [[ -z "$PL" || "$PL" == "null" ]]; then
    # Empty primary is OK only when lang_stats truly empty
    HAS_LANGS="$(jq -r '(.lang_stats // {}) | keys | length' "$DIR/09-language-profile.json" 2>/dev/null || echo 0)"
    if [[ "${HAS_LANGS:-0}" != "0" ]]; then
      ERRORS+=("09-language-profile.json has lang_stats but primary_language is null — re-run collect scripts")
    else
      WARNINGS+=("primary_language UNKNOWN (empty CodexQA lang_stats)")
    fi
  else
    echo "primary_language=$PL confidence=${CONF:-unknown}"
  fi
  # Cross-check manifest stamp when present
  if [[ -f "$DIR/manifest.json" ]]; then
    MPL="$(jq -r '.primary_language // empty' "$DIR/manifest.json" 2>/dev/null || true)"
    if [[ -n "$MPL" && "$MPL" != "null" && -n "$PL" && "$MPL" != "$PL" ]]; then
      WARNINGS+=("manifest.primary_language=$MPL differs from 09-language-profile ($PL)")
    fi
  fi
elif [[ -f "$DIR/02-summary.json" ]]; then
  # Legacy pack: try to hint from summary without failing
  LEGACY_TOP="$(jq -r '
    (.lang_stats // .result.lang_stats // {})
    | to_entries | sort_by(-.value) | .[0].key // empty
  ' "$DIR/02-summary.json" 2>/dev/null || true)"
  if [[ -n "$LEGACY_TOP" ]]; then
    WARNINGS+=("legacy pack missing 09-language-profile.json; inferred hint=$LEGACY_TOP from summary — recollect for full primary-language stamp")
  else
    WARNINGS+=("legacy pack missing 09-language-profile.json and empty lang_stats")
  fi
fi

case "$MODE" in
  pr)
    need "03-change-groups.json"
    need "04-changed-files.json"
    need "05-changed-symbols.json"
    need_any "07-tags.json" "07-tag-keys.json"
    need "08-hot-but-thin.json"

    if [[ -f "$DIR/03-change-groups.json" ]]; then
      if jq -e '.error == true' "$DIR/03-change-groups.json" >/dev/null 2>&1; then
        ERRORS+=("03-change-groups.json contains command error")
      else
        GROUP_COUNT="$(jq -r '(.result.groups // .groups // []) | length' "$DIR/03-change-groups.json" 2>/dev/null || echo 0)"
        if [[ "$GROUP_COUNT" == "0" ]]; then
          ERRORS+=("change-groups empty — re-run: codexqa index <repo> --diff-base <ref>")
        fi
        TRUNCATED="$(jq -r '.result.truncated // .truncated // false' "$DIR/03-change-groups.json" 2>/dev/null || echo false)"
        if [[ "$TRUNCATED" == "true" ]]; then
          WARNINGS+=("change-groups truncated=true — graph incomplete; lower confidence")
        fi
      fi
    fi

    if [[ -f "$DIR/05-changed-symbols.json" ]]; then
      if jq -e '.error == true' "$DIR/05-changed-symbols.json" >/dev/null 2>&1; then
        ERRORS+=("05-changed-symbols.json contains command error")
      else
        NODE_COUNT="$(jq -r '(.nodes // .result.nodes // []) | length' "$DIR/05-changed-symbols.json" 2>/dev/null || echo 0)"
        DEFAULT_ONLY="$(jq -r '
          (.nodes // .result.nodes // []) as $n
          | if ($n|length)==0 then "empty"
            elif all($n[]; (.change_status // "default") == "default") then "all_default"
            else "ok" end
        ' "$DIR/05-changed-symbols.json" 2>/dev/null || echo unknown)"
        if [[ "$NODE_COUNT" == "0" ]]; then
          WARNINGS+=("no changed function/method symbols — check diff-base or kind filter")
        fi
        if [[ "$DEFAULT_ONLY" == "all_default" ]]; then
          ERRORS+=("all symbols change_status=default — not a diff index; re-run with --diff-base")
        fi
      fi
    fi

    if [[ -f "$DIR/manifest.json" ]]; then
      DB="$(jq -r '.diff_base // empty' "$DIR/manifest.json")"
      if [[ -z "$DB" || "$DB" == "null" ]]; then
        ERRORS+=("manifest.diff_base missing for pr mode")
      fi
      if ! jq -e '.index_quality != null' "$DIR/manifest.json" >/dev/null 2>&1; then
        WARNINGS+=("manifest.index_quality missing — prefer recollect with latest script")
      fi
      if ! jq -e '(.commands | type) == "array"' "$DIR/manifest.json" >/dev/null 2>&1; then
        WARNINGS+=("manifest.commands missing — prefer recollect with latest script")
      fi
    fi

    DIFF_COUNT=0
    if [[ -d "$DIR/diffs" ]]; then
      DIFF_COUNT="$(find "$DIR/diffs" -name '*.diff.json' 2>/dev/null | wc -l | tr -d ' ' || true)"
    fi
    if [[ "${DIFF_COUNT:-0}" == "0" ]]; then
      WARNINGS+=("no diffs/*.diff.json — symbol-diff not collected for top symbols")
    fi

    if [[ ! -f "$DIR/10-design-fit-signals.json" ]]; then
      WARNINGS+=("10-design-fit-signals.json missing — Design fit thin; recollect or run scripts/lib/derive-design-fit.sh")
    elif ! jq -e '.kind == "DesignFitSignals"' "$DIR/10-design-fit-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("10-design-fit-signals.json present but kind != DesignFitSignals — regenerate via derive-design-fit.sh")
    fi
    if [[ ! -f "$DIR/11-complexity-signals.json" ]]; then
      WARNINGS+=("11-complexity-signals.json missing — Complexity thin; recollect or run scripts/lib/derive-complexity.sh")
    elif ! jq -e '.kind == "ComplexitySignals"' "$DIR/11-complexity-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("11-complexity-signals.json present but kind != ComplexitySignals — regenerate via derive-complexity.sh")
    fi
    if [[ ! -f "$DIR/12-dependency-signals.json" ]]; then
      WARNINGS+=("12-dependency-signals.json missing — Dependencies thin; recollect or run scripts/lib/derive-dependencies.sh")
    elif ! jq -e '.kind == "DependencySignals"' "$DIR/12-dependency-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("12-dependency-signals.json present but kind != DependencySignals — regenerate via derive-dependencies.sh")
    fi
    if [[ ! -f "$DIR/13-privacy-signals.json" ]]; then
      WARNINGS+=("13-privacy-signals.json missing — Privacy thin; recollect or run scripts/lib/derive-privacy.sh")
    elif ! jq -e '.kind == "PrivacySignals"' "$DIR/13-privacy-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("13-privacy-signals.json present but kind != PrivacySignals — regenerate via derive-privacy.sh")
    fi
    if [[ ! -f "$DIR/14-resilience-signals.json" ]]; then
      WARNINGS+=("14-resilience-signals.json missing — Resilience thin; recollect or run scripts/lib/derive-resilience.sh")
    elif ! jq -e '.kind == "ResilienceSignals"' "$DIR/14-resilience-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("14-resilience-signals.json present but kind != ResilienceSignals — regenerate via derive-resilience.sh")
    elif ! jq -e 'has("charset_gaps") and has("null_deref_gaps") and has("authz_audit_gaps")' \
      "$DIR/14-resilience-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("14-resilience-signals.json is a legacy pack without charset_gaps/null_deref_gaps/authz_audit_gaps — re-run derive-resilience.sh before treating those shapes as absent")
    fi
    if [[ ! -f "$DIR/15-rollout-signals.json" ]]; then
      WARNINGS+=("15-rollout-signals.json missing — Rollout thin; recollect or run scripts/lib/derive-rollout.sh")
    elif ! jq -e '.kind == "RolloutSignals"' "$DIR/15-rollout-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("15-rollout-signals.json present but kind != RolloutSignals — regenerate via derive-rollout.sh")
    fi

    if [[ ! -f "$DIR/16-observability-signals.json" ]]; then
      WARNINGS+=("16-observability-signals.json missing — Observability thin; recollect or run scripts/lib/derive-observability.sh")
    elif ! jq -e '.kind == "ObservabilitySignals"' "$DIR/16-observability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("16-observability-signals.json present but kind != ObservabilitySignals — regenerate via derive-observability.sh")
    fi
    if [[ ! -f "$DIR/17-contract-signals.json" ]]; then
      WARNINGS+=("17-contract-signals.json missing — Contract thin; recollect or run scripts/lib/derive-contract.sh")
    elif ! jq -e '.kind == "ContractSignals"' "$DIR/17-contract-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("17-contract-signals.json present but kind != ContractSignals — regenerate via derive-contract.sh")
    fi
    if [[ ! -f "$DIR/18-maintainability-signals.json" ]]; then
      WARNINGS+=("18-maintainability-signals.json missing — Maintainability thin; recollect or run scripts/lib/derive-maintainability.sh")
    elif ! jq -e '.kind == "MaintainabilitySignals"' "$DIR/18-maintainability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("18-maintainability-signals.json present but kind != MaintainabilitySignals — regenerate via derive-maintainability.sh")
    elif ! jq -e 'has("unused_accumulators")' "$DIR/18-maintainability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("18-maintainability-signals.json is a legacy pack without unused_accumulators — re-run derive-maintainability.sh before treating that shape as absent")
    fi
    if [[ ! -f "$DIR/20-risk-tier.json" ]]; then
      WARNINGS+=("20-risk-tier.json missing — Risk tier thin; recollect or run scripts/lib/derive-risk-tier.sh")
    elif ! jq -e '.kind == "RiskTierSignals"' "$DIR/20-risk-tier.json" >/dev/null 2>&1; then
      WARNINGS+=("20-risk-tier.json present but kind != RiskTierSignals — regenerate via derive-risk-tier.sh")
    fi
    if [[ ! -f "$DIR/21-performance-signals.json" ]]; then
      WARNINGS+=("21-performance-signals.json missing — Performance thin; recollect or run scripts/lib/derive-performance.sh")
    elif ! jq -e '.kind == "PerformanceSignals"' "$DIR/21-performance-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("21-performance-signals.json present but kind != PerformanceSignals — regenerate via derive-performance.sh")
    elif ! jq -e 'has("unpooled_connections")' "$DIR/21-performance-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("21-performance-signals.json is a legacy pack without unpooled_connections — re-run derive-performance.sh before treating that shape as absent")
    fi
    if [[ ! -f "$DIR/23-sast-signals.json" ]]; then
      WARNINGS+=("23-sast-signals.json missing — SAST thin; recollect or run scripts/lib/derive-sast.sh")
    elif ! jq -e '.kind == "SastSignals"' "$DIR/23-sast-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("23-sast-signals.json present but kind != SastSignals — regenerate via derive-sast.sh")
    elif ! jq -e '(.findings // []) as $f | ($f | length) == 0 or any($f[]; has("disposition"))' "$DIR/23-sast-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("23-sast-signals.json is a legacy pack without per-hit disposition — re-run derive-sast.sh before treating triage as present")
    fi
    if [[ ! -f "$DIR/26-review-digest.json" ]]; then
      WARNINGS+=("26-review-digest.json missing — PR file split thin; recollect or run scripts/lib/build-review-digest.py")
    elif ! jq -e '.kind == "ReviewDigest" and ((.history.three_dot | type) == "object" or (.history.three_dot_counts | type) == "object") and (.report.unique_lines | type) == "array"' "$DIR/26-review-digest.json" >/dev/null 2>&1; then
      WARNINGS+=("26-review-digest.json present but is not a ReviewDigest — regenerate via build-review-digest.py")
    fi
    ;;
  full)
    need "03-files-sample.json"
    need "04-hot-symbols.json"
    need "05-untested-hotspots.json"
    need_any "07-tags.json" "07-tag-keys.json"
    if [[ -f "$DIR/manifest.json" ]]; then
      MMODE="$(jq -r '.mode // empty' "$DIR/manifest.json")"
      if [[ -n "$MMODE" && "$MMODE" != "full" ]]; then
        WARNINGS+=("manifest.mode=$MMODE but validation mode=full")
      fi
      DB="$(jq -r '.diff_base // empty' "$DIR/manifest.json")"
      if [[ -n "$DB" && "$DB" != "null" ]]; then
        WARNINGS+=("full mode pack has diff_base set — do not invent PR conclusions unless intentionally mixed")
      fi
    fi
    if [[ ! -d "$DIR/imports" ]]; then
      WARNINGS+=("imports/ directory missing — architecture import evidence may be thin")
    fi
    if [[ ! -f "$DIR/10-design-fit-signals.json" ]]; then
      WARNINGS+=("10-design-fit-signals.json missing — Design fit thin; recollect or run scripts/lib/derive-design-fit.sh")
    elif ! jq -e '.kind == "DesignFitSignals"' "$DIR/10-design-fit-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("10-design-fit-signals.json present but kind != DesignFitSignals — regenerate via derive-design-fit.sh")
    fi
    if [[ ! -f "$DIR/11-complexity-signals.json" ]]; then
      WARNINGS+=("11-complexity-signals.json missing — Complexity thin; recollect or run scripts/lib/derive-complexity.sh")
    elif ! jq -e '.kind == "ComplexitySignals"' "$DIR/11-complexity-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("11-complexity-signals.json present but kind != ComplexitySignals — regenerate via derive-complexity.sh")
    fi
    if [[ ! -f "$DIR/12-dependency-signals.json" ]]; then
      WARNINGS+=("12-dependency-signals.json missing — Dependencies thin; recollect or run scripts/lib/derive-dependencies.sh")
    elif ! jq -e '.kind == "DependencySignals"' "$DIR/12-dependency-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("12-dependency-signals.json present but kind != DependencySignals — regenerate via derive-dependencies.sh")
    fi
    if [[ ! -f "$DIR/13-privacy-signals.json" ]]; then
      WARNINGS+=("13-privacy-signals.json missing — Privacy thin; recollect or run scripts/lib/derive-privacy.sh")
    elif ! jq -e '.kind == "PrivacySignals"' "$DIR/13-privacy-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("13-privacy-signals.json present but kind != PrivacySignals — regenerate via derive-privacy.sh")
    fi
    if [[ ! -f "$DIR/14-resilience-signals.json" ]]; then
      WARNINGS+=("14-resilience-signals.json missing — Resilience thin; recollect or run scripts/lib/derive-resilience.sh")
    elif ! jq -e '.kind == "ResilienceSignals"' "$DIR/14-resilience-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("14-resilience-signals.json present but kind != ResilienceSignals — regenerate via derive-resilience.sh")
    elif ! jq -e 'has("charset_gaps") and has("null_deref_gaps") and has("authz_audit_gaps")' \
      "$DIR/14-resilience-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("14-resilience-signals.json is a legacy pack without charset_gaps/null_deref_gaps/authz_audit_gaps — re-run derive-resilience.sh before treating those shapes as absent")
    fi
    if [[ ! -f "$DIR/15-rollout-signals.json" ]]; then
      WARNINGS+=("15-rollout-signals.json missing — Rollout thin; recollect or run scripts/lib/derive-rollout.sh")
    elif ! jq -e '.kind == "RolloutSignals"' "$DIR/15-rollout-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("15-rollout-signals.json present but kind != RolloutSignals — regenerate via derive-rollout.sh")
    fi

    if [[ ! -f "$DIR/16-observability-signals.json" ]]; then
      WARNINGS+=("16-observability-signals.json missing — Observability thin; recollect or run scripts/lib/derive-observability.sh")
    elif ! jq -e '.kind == "ObservabilitySignals"' "$DIR/16-observability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("16-observability-signals.json present but kind != ObservabilitySignals — regenerate via derive-observability.sh")
    fi
    if [[ ! -f "$DIR/17-contract-signals.json" ]]; then
      WARNINGS+=("17-contract-signals.json missing — Contract thin; recollect or run scripts/lib/derive-contract.sh")
    elif ! jq -e '.kind == "ContractSignals"' "$DIR/17-contract-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("17-contract-signals.json present but kind != ContractSignals — regenerate via derive-contract.sh")
    fi
    if [[ ! -f "$DIR/18-maintainability-signals.json" ]]; then
      WARNINGS+=("18-maintainability-signals.json missing — Maintainability thin; recollect or run scripts/lib/derive-maintainability.sh")
    elif ! jq -e '.kind == "MaintainabilitySignals"' "$DIR/18-maintainability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("18-maintainability-signals.json present but kind != MaintainabilitySignals — regenerate via derive-maintainability.sh")
    elif ! jq -e 'has("unused_accumulators")' "$DIR/18-maintainability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("18-maintainability-signals.json is a legacy pack without unused_accumulators — re-run derive-maintainability.sh before treating that shape as absent")
    fi
    if [[ ! -f "$DIR/20-risk-tier.json" ]]; then
      WARNINGS+=("20-risk-tier.json missing — Risk tier thin; recollect or run scripts/lib/derive-risk-tier.sh")
    elif ! jq -e '.kind == "RiskTierSignals"' "$DIR/20-risk-tier.json" >/dev/null 2>&1; then
      WARNINGS+=("20-risk-tier.json present but kind != RiskTierSignals — regenerate via derive-risk-tier.sh")
    fi
    if [[ ! -f "$DIR/21-performance-signals.json" ]]; then
      WARNINGS+=("21-performance-signals.json missing — Performance thin; recollect or run scripts/lib/derive-performance.sh")
    elif ! jq -e '.kind == "PerformanceSignals"' "$DIR/21-performance-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("21-performance-signals.json present but kind != PerformanceSignals — regenerate via derive-performance.sh")
    elif ! jq -e 'has("unpooled_connections")' "$DIR/21-performance-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("21-performance-signals.json is a legacy pack without unpooled_connections — re-run derive-performance.sh before treating that shape as absent")
    fi
    if [[ ! -f "$DIR/23-sast-signals.json" ]]; then
      WARNINGS+=("23-sast-signals.json missing — SAST thin; recollect or run scripts/lib/derive-sast.sh")
    elif ! jq -e '.kind == "SastSignals"' "$DIR/23-sast-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("23-sast-signals.json present but kind != SastSignals — regenerate via derive-sast.sh")
    elif ! jq -e '(.findings // []) as $f | ($f | length) == 0 or any($f[]; has("disposition"))' "$DIR/23-sast-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("23-sast-signals.json is a legacy pack without per-hit disposition — re-run derive-sast.sh before treating triage as present")
    fi
    if [[ ! -d "$DIR/impact" ]] || [[ -z "$(find "$DIR/impact" -name 'edges-in.json' 2>/dev/null | head -n 1)" ]]; then
      WARNINGS+=("impact/*/edges-in.json missing — full-repo blast-radius thin; recollect with IMPACT_TOP_N>0")
    fi
    if [[ ! -f "$DIR/19-annotation-edges.json" ]]; then
      WARNINGS+=("19-annotation-edges.json missing — annotation callback compensation thin; run derive-annotation-edges.sh")
    fi
    ;;
  adhoc)
    need "03-change-groups.json"
    need "04-changed-files.json"
    need "05-changed-symbols.json"
    if [[ -f "$DIR/manifest.json" ]]; then
      MMODE="$(jq -r '.mode // empty' "$DIR/manifest.json")"
      if [[ -n "$MMODE" && "$MMODE" != "adhoc" ]]; then
        WARNINGS+=("manifest.mode=$MMODE but validation mode=adhoc")
      fi
      if ! jq -e '.adhoc == true or .mode == "adhoc"' "$DIR/manifest.json" >/dev/null 2>&1; then
        WARNINGS+=("adhoc pack should set manifest.mode=adhoc (and preferably adhoc=true)")
      fi
    fi
    # adhoc intentionally has no diff_base / may have synthetic change-groups
    if [[ ! -f "$DIR/14-resilience-signals.json" ]]; then
      WARNINGS+=("14-resilience-signals.json missing — Resilience thin; run derive-resilience.sh")
    elif ! jq -e 'has("charset_gaps") and has("null_deref_gaps") and has("authz_audit_gaps")' \
      "$DIR/14-resilience-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("14-resilience-signals.json is a legacy pack without charset_gaps/null_deref_gaps/authz_audit_gaps — re-run derive-resilience.sh before treating those shapes as absent")
    fi
    if [[ -f "$DIR/18-maintainability-signals.json" ]] \
      && ! jq -e 'has("unused_accumulators")' "$DIR/18-maintainability-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("18-maintainability-signals.json is a legacy pack without unused_accumulators — re-run derive-maintainability.sh before treating that shape as absent")
    fi
    if [[ -f "$DIR/21-performance-signals.json" ]] \
      && ! jq -e 'has("unpooled_connections")' "$DIR/21-performance-signals.json" >/dev/null 2>&1; then
      WARNINGS+=("21-performance-signals.json is a legacy pack without unpooled_connections — re-run derive-performance.sh before treating that shape as absent")
    fi
    if [[ ! -f "$DIR/19-annotation-edges.json" ]]; then
      WARNINGS+=("19-annotation-edges.json missing — annotation edges thin")
    fi
    ;;
  *)
    echo "error: --mode must be pr, full, or adhoc" >&2
    exit 2
    ;;
esac

# Soft quality signal from stats and/or manifest.index_quality
# High stubs/collisions do NOT invalidate the pack (compat), but force confidence guidance.
# CodexQA may emit stubs/collisions as numbers OR objects with .total — normalize both.
quality_num_from_manifest() {
  local field="$1"
  jq -r --arg f "$field" '
    def quality_num($x):
      if $x == null then empty
      elif ($x | type) == "number" then $x
      elif ($x | type) == "object" then ($x.total // $x.count // $x.groups // empty)
      elif ($x | type) == "string" and ($x | test("^[0-9]+$")) then $x
      else empty end;
    quality_num(.index_quality[$f] // empty)
  ' "$DIR/manifest.json" 2>/dev/null || true
}

quality_num_from_stats() {
  local field="$1"
  jq -r --arg f "$field" '
    def quality_num($x):
      if $x == null then empty
      elif ($x | type) == "number" then $x
      elif ($x | type) == "object" then ($x.total // $x.count // $x.groups // empty)
      elif ($x | type) == "string" and ($x | test("^[0-9]+$")) then $x
      else empty end;
    if $f == "stubs" then
      quality_num(.stubs // .stub_count // .quality.stubs // empty)
    else
      quality_num(.collisions // .collision_count // .quality.collisions // empty)
    end
  ' "$DIR/01-stats.json" 2>/dev/null || true
}

STUBS=""
if [[ -f "$DIR/manifest.json" ]]; then
  STUBS="$(quality_num_from_manifest stubs)"
fi
if [[ -z "$STUBS" && -f "$DIR/01-stats.json" ]] && ! jq -e '.error == true' "$DIR/01-stats.json" >/dev/null 2>&1; then
  STUBS="$(quality_num_from_stats stubs)"
fi
if [[ -n "${STUBS:-}" && "$STUBS" != "null" && "$STUBS" != "0" ]]; then
  WARNINGS+=("stats/index_quality stubs=$STUBS — lower confidence on incomplete edges")
  if [[ "$STUBS" =~ ^[0-9]+$ ]] && [[ "$STUBS" -ge 20 ]]; then
    WARNINGS+=("index_quality stubs=$STUBS (>=20) — cap edge/reach/path finding confidence at UNKNOWN; do not claim complete blast radius; do not treat from_count as real fan-in — prefer edges-in callers")
  fi
fi

COLLISIONS=""
if [[ -f "$DIR/manifest.json" ]]; then
  COLLISIONS="$(quality_num_from_manifest collisions)"
fi
if [[ -z "$COLLISIONS" && -f "$DIR/01-stats.json" ]] && ! jq -e '.error == true' "$DIR/01-stats.json" >/dev/null 2>&1; then
  COLLISIONS="$(quality_num_from_stats collisions)"
fi
if [[ -n "${COLLISIONS:-}" && "$COLLISIONS" != "null" && "$COLLISIONS" != "0" ]]; then
  WARNINGS+=("index_quality collisions=$COLLISIONS — lower confidence on edges/reach")
  if [[ "$COLLISIONS" =~ ^[0-9]+$ ]] && [[ "$COLLISIONS" -ge 1 ]]; then
    WARNINGS+=("index_quality collisions=$COLLISIONS — prefer UNKNOWN confidence on ambiguous symbol identity")
  fi
fi

# Optional conclusion JSON (post-review). Invalid file must not block pack validation,
# but warn so HTML render is not attempted blindly.
if [[ -f "$DIR/review-conclusion.json" ]]; then
  if ! jq -e 'type == "object"' "$DIR/review-conclusion.json" >/dev/null 2>&1; then
    WARNINGS+=("review-conclusion.json present but not a JSON object — fix before render-review-html.sh")
  elif [[ -f "$DIR/14-resilience-signals.json" ]] \
    && jq -e '.kind == "ResilienceSignals"' "$DIR/14-resilience-signals.json" >/dev/null 2>&1; then
    # Hard gate: non-empty actionable resilience hits must not vanish into HTML None
    HIT_N="$(jq '
      [ .silent_swallows[]?, .timeout_gaps[]?, .retry_risks[]?, .partial_failure_gaps[]?, .idempotency_gaps[]? ]
      | map(select(.disposition == "report"))
      | length
    ' "$DIR/14-resilience-signals.json" 2>/dev/null || echo 0)"
    UNSTAMPED="$(jq '
      [ .silent_swallows[]?, .timeout_gaps[]?, .retry_risks[]?, .partial_failure_gaps[]?, .idempotency_gaps[]? ]
      | map(select(has("disposition") | not))
      | length
    ' "$DIR/14-resilience-signals.json" 2>/dev/null || echo 0)"
    if [[ "${UNSTAMPED:-0}" =~ ^[0-9]+$ ]] && [[ "$UNSTAMPED" -gt 0 ]]; then
      WARNINGS+=("14-resilience-signals.json has $UNSTAMPED unstamped rows — re-run scripts/lib/derive_triage.py before treating them as report or drop")
    fi
    if [[ "${HIT_N:-0}" =~ ^[0-9]+$ ]] && [[ "$HIT_N" -gt 0 ]]; then
      RES_NONE="$(jq -r '
        (.resilience.verdict // .resilience.summary // .dimensions.resilience // "")
        | tostring | ascii_downcase
      ' "$DIR/review-conclusion.json" 2>/dev/null || echo "")"
      FIND_N="$(jq '
        ([.p0,.p1,.p2] | map(select(type=="array") | .[]) | map(select(
          ((.category // .dimension // .kind // "")|tostring|test("resilience|error.?handl|timeout|retry|swallow|idempot"; "i"))
          or ((.title // "")|tostring|test("resilience|timeout|retry|swallow|idempot|degrad"; "i"))
        )) | length)
      ' "$DIR/review-conclusion.json" 2>/dev/null || echo 0)"
      if [[ "$RES_NONE" == "none" || "$RES_NONE" == "n/a" ]] && [[ "${FIND_N:-0}" == "0" ]]; then
        WARNINGS+=("resilience hard-gate: 14-… has $HIT_N actionable hits but conclusion has Resilience None and zero resilience findings — promote hits to findings or explicit deferred residuals with path:line")
      fi
    fi
  fi
fi

if [[ ! -f "$DIR/24-coverage-ledger.json" ]]; then
  WARNINGS+=("24-coverage-ledger.json missing — symbol coverage ledger thin; recollect or run scripts/lib/build-coverage-ledger.py")
elif ! jq -e '.kind == "CoverageLedger"' "$DIR/24-coverage-ledger.json" >/dev/null 2>&1; then
  WARNINGS+=("24-coverage-ledger.json present but kind != CoverageLedger — regenerate via build-coverage-ledger.py")
fi

echo "validate-evidence: mode=$MODE dir=$DIR"
if ((${#WARNINGS[@]} > 0)); then
  for w in "${WARNINGS[@]}"; do
    echo "WARN: $w"
  done
fi

if ((${#ERRORS[@]} > 0)); then
  for e in "${ERRORS[@]}"; do
    echo "ERROR: $e" >&2
  done
  echo "status: invalid" >&2
  exit 1
fi

echo "status: ok"
exit 0
