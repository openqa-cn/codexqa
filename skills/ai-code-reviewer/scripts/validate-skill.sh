#!/usr/bin/env bash
# ai-code-reviewer: Local skill gate (skill-up substitute + pipeline smoke).
# Compatible with bash 3.2+ (macOS). Does NOT require skill-up CLI.
#
# Evidence levels covered:
#   Static     — frontmatter, tree, bash -n, jq templates
#   Structural — path links, audit-plan-coverage, no mapfile calls
#   Evaluation — local evals/fixtures expectations (not skill-up)
#   Runtime    — language detector, validate-evidence, render-html smoke
#
# Usage:
#   ./scripts/validate-skill.sh
#   ./scripts/validate-skill.sh --skip-audit   # faster iteration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/python_resolve.sh
source "$SCRIPT_DIR/lib/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKIP_AUDIT=0
FAILS=0
PASSES=0

usage() {
  cat <<'EOF'
Usage: validate-skill.sh [--skip-audit]

Local Eval / skill-change gate when `skill-up` is unavailable.
Runs static + structural + fixture runtime checks end-to-end.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-audit) SKIP_AUDIT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

pass() { PASSES=$((PASSES + 1)); echo "PASS: $*"; }
fail() { FAILS=$((FAILS + 1)); echo "FAIL: $*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command missing: $1"
    return 1
  fi
  pass "command present: $1"
}

echo "=== validate-skill: root=$ROOT ==="

# --- Static ---
need_cmd jq || true
need_cmd bash || true

if [[ -f "$ROOT/SKILL.md" ]]; then
  if head -n 20 "$ROOT/SKILL.md" | grep -q '^name: ai-code-reviewer$'; then
    pass "SKILL frontmatter name=ai-code-reviewer"
  else
    fail "SKILL frontmatter name missing or wrong"
  fi
  if head -n 30 "$ROOT/SKILL.md" | grep -q '^disable-model-invocation:'; then
    fail "disable-model-invocation present (omit so description triggers can auto-invoke, like sibling skills)"
  else
    pass "disable-model-invocation omitted (discoverable via description triggers)"
  fi
else
  fail "SKILL.md missing"
fi

# shellcheck disable=SC2043
for sh in \
  "$ROOT/scripts/collect-pr-evidence.sh" \
  "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  "$ROOT/scripts/collect-adhoc-evidence.sh" \
  "$ROOT/scripts/validate-evidence.sh" \
  "$ROOT/scripts/render-review-html.sh" \
  "$ROOT/scripts/audit-plan-coverage.sh" \
  "$ROOT/scripts/lib/codexqa-preflight.sh" \
  "$ROOT/scripts/lib/derive-design-fit.sh" \
  "$ROOT/scripts/lib/derive-complexity.sh" \
  "$ROOT/scripts/lib/derive-dependencies.sh" \
  "$ROOT/scripts/lib/derive-privacy.sh" \
  "$ROOT/scripts/lib/derive-resilience.sh" \
  "$ROOT/scripts/lib/derive-rollout.sh" \
  "$ROOT/scripts/lib/derive-risk-tier.sh" \
  "$ROOT/scripts/lib/derive-observability.sh" \
  "$ROOT/scripts/lib/derive-contract.sh" \
  "$ROOT/scripts/lib/derive-maintainability.sh" \
  "$ROOT/scripts/lib/derive-performance.sh" \
  "$ROOT/scripts/lib/derive-annotation-edges.sh" \
  "$ROOT/scripts/validate-skill.sh"
do
  if [[ -f "$sh" ]]; then
    if bash -n "$sh"; then
      pass "bash -n $(basename "$sh")"
    else
      fail "bash -n $(basename "$sh")"
    fi
  else
    fail "missing script: $sh"
  fi
done

for j in \
  "$ROOT/templates/evidence-manifest.json" \
  "$ROOT/templates/review-conclusion.json"
do
  if jq empty "$j" >/dev/null 2>&1; then
    pass "jq empty $(basename "$j")"
  else
    fail "invalid JSON: $j"
  fi
done

# templates/evidence-manifest.json is SCHEMA ONLY — runtime always writes manifest.json
if jq -e '._schema_note != null or .notes != null' "$ROOT/templates/evidence-manifest.json" >/dev/null 2>&1 \
  && grep -q 'manifest\.json' "$ROOT/templates/evidence-manifest.json"; then
  pass "evidence-manifest.json documents runtime manifest.json"
else
  fail "evidence-manifest.json must clarify it is a schema for runtime manifest.json"
fi

# No bash-4-only mapfile *calls* (comments mentioning the word are OK)
MAPFILE_HITS="$(grep -RIn --include='*.sh' -E '^[[:space:]]*mapfile([[:space:]]|$)' "$ROOT/scripts" 2>/dev/null || true)"
if [[ -z "$MAPFILE_HITS" ]]; then
  pass "no mapfile invocations (bash 3.2 safe)"
else
  fail "mapfile call found (breaks macOS bash 3.2): $MAPFILE_HITS"
fi

# No vendored CodexQA source
VENDOR="$(find "$ROOT" \( -name package.json -o -name node_modules -o -name 'codexqa.js' \) 2>/dev/null | head -5 || true)"
if [[ -z "$VENDOR" ]]; then
  pass "no vendored CodexQA package artifacts"
else
  fail "suspected vendored artifacts: $VENDOR"
fi

# Linked paths from SKILL exist (best-effort)
MISSING_LINKS=0
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  if [[ ! -e "$ROOT/$rel" ]]; then
    echo "  missing link target: $rel" >&2
    MISSING_LINKS=$((MISSING_LINKS + 1))
  fi
done < <(grep -oE '\((references|prompts|templates|scripts|examples|evals)/[^)]+\)' "$ROOT/SKILL.md" 2>/dev/null \
  | sed 's/[()]//g' | sort -u || true)
if [[ "$MISSING_LINKS" -eq 0 ]]; then
  pass "SKILL.md relative links resolve"
else
  fail "SKILL.md has $MISSING_LINKS broken relative links"
fi

# --- Structural ---
if [[ "$SKIP_AUDIT" -eq 0 ]]; then
  set +e
  AUDIT_OUT="$("$ROOT/scripts/audit-plan-coverage.sh" 2>&1)"
  AUDIT_EC=$?
  set -e
  AUDIT_FAIL="$(echo "$AUDIT_OUT" | grep -E '^FAIL=' | tail -1 || true)"
  if [[ "$AUDIT_EC" -eq 0 ]] && echo "$AUDIT_OUT" | grep -q 'FAIL=0'; then
    pass "audit-plan-coverage FAIL=0 ($AUDIT_FAIL)"
  else
    fail "audit-plan-coverage failed: $AUDIT_FAIL"
    echo "$AUDIT_OUT" | tail -30 >&2
  fi
else
  pass "audit-plan-coverage skipped (--skip-audit)"
fi

# --- Evaluation (local fixtures; skill-up optional) ---
if command -v skill-up >/dev/null 2>&1; then
  set +e
  SKILLUP_OUT="$(skill-up validate "$ROOT" 2>&1)"
  SKILLUP_EC=$?
  set -e
  if [[ "$SKILLUP_EC" -eq 0 ]]; then
    pass "skill-up validate"
  else
    fail "skill-up validate exit=$SKILLUP_EC"
    echo "$SKILLUP_OUT" | tail -20 >&2
  fi
else
  pass "skill-up not on PATH — local fixtures are the Eval gate (confirmation: optional install skill-up later)"
fi

if [[ -f "$ROOT/evals/eval.yaml" ]]; then
  pass "evals/eval.yaml present"
else
  fail "evals/eval.yaml missing"
fi

# --- Runtime smoke (fixtures; no live codexqa index required) ---
# shellcheck source=lib/codexqa-preflight.sh
source "$ROOT/scripts/lib/codexqa-preflight.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Language detector: noise langs must not beat Go
SUM="$TMP/summary.json"
cat >"$SUM" <<'EOF'
{"lang_stats":{"Markdown":100,"JSON":50,"Go":30,"YAML":20}}
EOF
PROF="$(codexqa_detect_language_profile "$SUM")"
PL="$(echo "$PROF" | jq -r '.primary_language')"
if [[ "$PL" == "Go" ]]; then
  pass "language detector prefers code lang (Go) over Markdown/JSON"
else
  fail "language detector primary=$PL expected Go"
fi

# validate-evidence: minimal OK
set +e
VO="$("$ROOT/scripts/validate-evidence.sh" --dir "$ROOT/evals/fixtures/minimal-pr-pack" --mode pr 2>&1)"
VEC=$?
set -e
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -q 'status: ok' && echo "$VO" | grep -q 'primary_language=Go'; then
  pass "validate minimal-pr-pack"
else
  fail "validate minimal-pr-pack failed"
  echo "$VO" >&2
fi

# legacy WARN but ok
set +e
VO="$("$ROOT/scripts/validate-evidence.sh" --dir "$ROOT/evals/fixtures/legacy-pr-pack" --mode pr 2>&1)"
VEC=$?
set -e
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -q 'status: ok' && echo "$VO" | grep -qi 'legacy'; then
  pass "validate legacy-pr-pack (WARN compat)"
else
  fail "validate legacy-pr-pack should pass with WARN"
  echo "$VO" >&2
fi

# invalid must fail
set +e
VO="$("$ROOT/scripts/validate-evidence.sh" --dir "$ROOT/evals/fixtures/invalid-pr-pack" --mode pr 2>&1)"
VEC=$?
set -e
if [[ "$VEC" -ne 0 ]] && echo "$VO" | grep -q 'change-groups empty'; then
  pass "validate invalid-pr-pack fails as expected"
else
  fail "validate invalid-pr-pack should fail on empty change-groups"
  echo "$VO" >&2
fi

# stubs high → confidence guidance WARN (number OR object {.total})
STUB_DIR="$TMP/stub-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$STUB_DIR"
jq '.index_quality.stubs = 80 | .index_quality.collisions = 3' \
  "$STUB_DIR/manifest.json" >"$STUB_DIR/manifest.json.tmp" && mv "$STUB_DIR/manifest.json.tmp" "$STUB_DIR/manifest.json"
set +e
VO="$("$ROOT/scripts/validate-evidence.sh" --dir "$STUB_DIR" --mode pr 2>&1)"
VEC=$?
set -e
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi 'stubs=80' && echo "$VO" | grep -qi 'UNKNOWN'; then
  pass "high stubs emit confidence guidance WARN"
else
  fail "high stubs should WARN with confidence guidance"
  echo "$VO" >&2
fi

# Object-shaped stubs (real CodexQA shape) must normalize to .total
OBJ_DIR="$TMP/stub-obj-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$OBJ_DIR"
jq '.index_quality.stubs = {"total":2175,"strategy_a":1} | .index_quality.collisions = {"groups":0}' \
  "$OBJ_DIR/manifest.json" >"$OBJ_DIR/manifest.json.tmp" && mv "$OBJ_DIR/manifest.json.tmp" "$OBJ_DIR/manifest.json"
set +e
VO="$("$ROOT/scripts/validate-evidence.sh" --dir "$OBJ_DIR" --mode pr 2>&1)"
VEC=$?
set -e
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -q 'stubs=2175' && echo "$VO" | grep -qi 'UNKNOWN' \
  && ! echo "$VO" | grep -q 'strategy_a'; then
  pass "object-shaped stubs normalize to total=2175"
else
  fail "object-shaped stubs should normalize via .total"
  echo "$VO" >&2
fi

# codexqa_index_quality_from_stats unit check
STATS_OBJ="$TMP/stats-obj.json"
cat >"$STATS_OBJ" <<'EOF'
{"stubs":{"total":42,"strategy_a":40},"collisions":{"groups":2},"nodes_total":99}
EOF
IQ="$(codexqa_index_quality_from_stats "$STATS_OBJ")"
if echo "$IQ" | jq -e '.stubs == 42 and .collisions == 2 and .nodes == 99' >/dev/null; then
  pass "codexqa_index_quality_from_stats normalizes object stubs"
else
  fail "codexqa_index_quality_from_stats failed: $IQ"
fi

# HTML render: good conclusion
RENDER_DIR="$TMP/render-ok"
mkdir -p "$RENDER_DIR"
cp "$ROOT/evals/fixtures/minimal-pr-pack/manifest.json" "$RENDER_DIR/"
cp "$ROOT/evals/fixtures/minimal-pr-pack/09-language-profile.json" "$RENDER_DIR/"
cp "$ROOT/evals/fixtures/conclusion/minimal.json" "$RENDER_DIR/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_DIR" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && [[ -s "$RENDER_DIR/REVIEW-REPORT.html" ]] \
  && grep -q 'Code Review 结论' "$RENDER_DIR/REVIEW-REPORT.html"; then
  pass "render-review-html minimal conclusion"
else
  fail "render-review-html minimal failed"
  echo "$RO" >&2
fi
# Theme contrast: meta values must use --ink/--muted (not hardcoded light-only colors)
if "$SCRIPT_DIR/acr-python" -c "
from pathlib import Path
html = Path(r'''$RENDER_DIR/REVIEW-REPORT.html''').read_text()
v = html.split('.meta .v{')[1].split('}')[0]
k = html.split('.meta .k{')[1].split('}')[0]
assert 'color:var(--ink)' in v, v
assert 'color:var(--muted)' in k, k
assert 'html[data-theme=\"dark\"]' in html
assert '--ink:#e8edf2' in html
assert '#1a1714' not in v and '#6b645c' not in k
"; then
  pass "render-review-html meta contrast uses theme vars (light+dark)"
else
  fail "render-review-html meta text must use theme vars for light/dark contrast"
fi

# Design fit derive: idempotent on fixture copy; legacy pack WARN-only for missing 10-
if [[ -x "$ROOT/scripts/lib/derive-design-fit.sh" ]]; then
  pass "derive-design-fit.sh executable"
else
  fail "derive-design-fit.sh missing or not executable"
fi

DF_DIR="$TMP/design-fit-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$DF_DIR"
rm -f "$DF_DIR/10-design-fit-signals.json"
"$ROOT/scripts/lib/derive-design-fit.sh" --dir "$DF_DIR" --mode pr >/dev/null
if jq -e '.kind == "DesignFitSignals" and .mode == "pr"' "$DF_DIR/10-design-fit-signals.json" >/dev/null; then
  pass "derive-design-fit writes DesignFitSignals"
else
  fail "derive-design-fit did not write valid signals"
fi
"$ROOT/scripts/lib/derive-design-fit.sh" --dir "$DF_DIR" --mode pr >/dev/null
if jq -e '.kind == "DesignFitSignals"' "$DF_DIR/10-design-fit-signals.json" >/dev/null; then
  pass "derive-design-fit idempotent re-run"
else
  fail "derive-design-fit re-run failed"
fi

# Complexity derive: idempotent; independent of 10-; legacy WARN for missing 11-
if [[ -x "$ROOT/scripts/lib/derive-complexity.sh" ]]; then
  pass "derive-complexity.sh executable"
else
  fail "derive-complexity.sh missing or not executable"
fi

CX_DIR="$TMP/complexity-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$CX_DIR"
rm -f "$CX_DIR/11-complexity-signals.json" "$CX_DIR/10-design-fit-signals.json"
"$ROOT/scripts/lib/derive-complexity.sh" --dir "$CX_DIR" --mode pr --repo "/tmp" >/dev/null
# Without a real repo tree, LOC-only still works; with --repo on fixture copy:
rm -f "$CX_DIR/11-complexity-signals.json"
# Prefer packing a tiny readable file if present in fixture
if [[ -f "$CX_DIR/04-changed-files.json" ]]; then
  "$ROOT/scripts/lib/derive-complexity.sh" --dir "$CX_DIR" --mode pr \
    --repo "$ROOT/evals/fixtures" >/dev/null || true
fi
"$ROOT/scripts/lib/derive-complexity.sh" --dir "$CX_DIR" --mode pr >/dev/null
if jq -e '.kind == "ComplexitySignals" and .mode == "pr" and .schema_version == 1' \
  "$CX_DIR/11-complexity-signals.json" >/dev/null; then
  pass "derive-complexity writes ComplexitySignals (without 10-)"
else
  fail "derive-complexity did not write valid signals without design-fit"
fi
# --repo flag accepted (collect passes it before manifest exists)
if "$ROOT/scripts/lib/derive-complexity.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-complexity documents --repo"
else
  fail "derive-complexity should document --repo for pre-manifest collect"
fi
"$ROOT/scripts/lib/derive-complexity.sh" --dir "$CX_DIR" --mode pr >/dev/null
if jq -e '.kind == "ComplexitySignals"' "$CX_DIR/11-complexity-signals.json" >/dev/null; then
  pass "derive-complexity idempotent re-run"
else
  fail "derive-complexity re-run failed"
fi

# legacy pack: missing 10-/11- → WARN but ok (compat)
set +e
VO="$("$ROOT/scripts/validate-evidence.sh" --dir "$ROOT/evals/fixtures/legacy-pr-pack" --mode pr 2>&1)"
VEC=$?
set -e
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '10-design-fit-signals'; then
  pass "legacy pack WARNs missing design-fit signals (compat)"
else
  # Still ok if legacy already has other WARN path; require status ok at minimum
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (design-fit WARN optional text)"
  else
    fail "legacy pack should remain valid without 10-design-fit-signals"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '11-complexity-signals'; then
  pass "legacy pack WARNs missing complexity signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (complexity WARN optional text)"
  else
    fail "legacy pack should remain valid without 11-complexity-signals"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '12-dependency-signals'; then
  pass "legacy pack WARNs missing dependency signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (dependency WARN optional text)"
  else
    fail "legacy pack should remain valid without 12-dependency-signals"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '13-privacy-signals'; then
  pass "legacy pack WARNs missing privacy signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (privacy WARN optional text)"
  else
    fail "legacy pack should remain valid without 13-privacy-signals"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '14-resilience-signals'; then
  pass "legacy pack WARNs missing resilience signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (resilience WARN optional text)"
  else
    fail "legacy pack should remain valid without 14-resilience-signals"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '15-rollout-signals'; then
  pass "legacy pack WARNs missing rollout signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (rollout WARN optional text)"
  else
    fail "legacy pack should remain valid without 15-rollout-signals"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '20-risk-tier'; then
  pass "legacy pack WARNs missing risk-tier signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (risk-tier WARN optional text)"
  else
    fail "legacy pack should remain valid without 20-risk-tier"
    echo "$VO" >&2
  fi
fi
if [[ "$VEC" -eq 0 ]] && echo "$VO" | grep -qi '21-performance-signals'; then
  pass "legacy pack WARNs missing performance signals (compat)"
else
  if [[ "$VEC" -eq 0 ]]; then
    pass "legacy pack still validates (performance WARN optional text)"
  else
    fail "legacy pack should remain valid without 21-performance-signals"
    echo "$VO" >&2
  fi
fi

# Dependencies derive: idempotent; independent of 10-/11-; --repo documented
if [[ -x "$ROOT/scripts/lib/derive-dependencies.sh" ]]; then
  pass "derive-dependencies.sh executable"
else
  fail "derive-dependencies.sh missing or not executable"
fi

DEP_DIR="$TMP/dependencies-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$DEP_DIR"
rm -f "$DEP_DIR/12-dependency-signals.json" \
  "$DEP_DIR/11-complexity-signals.json" \
  "$DEP_DIR/10-design-fit-signals.json"
"$ROOT/scripts/lib/derive-dependencies.sh" --dir "$DEP_DIR" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "DependencySignals" and .mode == "pr" and .schema_version == 1' \
  "$DEP_DIR/12-dependency-signals.json" >/dev/null; then
  pass "derive-dependencies writes DependencySignals (without 10-/11-)"
else
  fail "derive-dependencies did not write valid signals without design/complexity"
fi
if "$ROOT/scripts/lib/derive-dependencies.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-dependencies documents --repo"
else
  fail "derive-dependencies should document --repo for pre-manifest collect"
fi
"$ROOT/scripts/lib/derive-dependencies.sh" --dir "$DEP_DIR" --mode pr >/dev/null
if jq -e '.kind == "DependencySignals"' "$DEP_DIR/12-dependency-signals.json" >/dev/null; then
  pass "derive-dependencies idempotent re-run"
else
  fail "derive-dependencies re-run failed"
fi
# confidence_caps.no_network_cve must be true
if jq -e '.confidence_caps.no_network_cve == true' "$DEP_DIR/12-dependency-signals.json" >/dev/null; then
  pass "derive-dependencies asserts no_network_cve"
else
  fail "derive-dependencies should set confidence_caps.no_network_cve"
fi

# Regression: jq // must not flip signals_thin false→true when manifests hit
DEP_SMOKE="$TMP/dep-smoke"
mkdir -p "$DEP_SMOKE/repo" "$DEP_SMOKE/pack"
cat >"$DEP_SMOKE/repo/package.json" <<'EOF'
{"name":"demo","license":"UNLICENSED","dependencies":{"lodash":"latest","a":"1","b":"1","c":"1","d":"1","e":"1","f":"1","g":"1","h":"1","i":"1"}}
EOF
cat >"$DEP_SMOKE/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"package.json","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-dependencies.sh" --dir "$DEP_SMOKE/pack" --mode pr --repo "$DEP_SMOKE/repo" >/dev/null
if jq -e '.signals_thin == false
  and (.manifest_hits|length) >= 1
  and (.snapshot_or_floating|length) >= 1
  and (.lock_drift|length) >= 1
  and (.license_hints|length) >= 1
  and (.notes|map(select(test("no dependency manifests hit")))|length) == 0' \
  "$DEP_SMOKE/pack/12-dependency-signals.json" >/dev/null; then
  pass "derive-dependencies signals_thin false when manifests hit (jq bool-safe)"
else
  fail "derive-dependencies wrongly marks thin / None-notes when manifests produce signals"
  jq '{signals_thin,manifest_hits,snapshot_or_floating,lock_drift,license_hints,notes}' \
    "$DEP_SMOKE/pack/12-dependency-signals.json" >&2
fi

# Privacy derive: idempotent; independent of 10-/11-/12-; --repo documented
if [[ -x "$ROOT/scripts/lib/derive-privacy.sh" ]]; then
  pass "derive-privacy.sh executable"
else
  fail "derive-privacy.sh missing or not executable"
fi

PV_DIR="$TMP/privacy-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$PV_DIR"
rm -f "$PV_DIR/13-privacy-signals.json" \
  "$PV_DIR/12-dependency-signals.json" \
  "$PV_DIR/11-complexity-signals.json" \
  "$PV_DIR/10-design-fit-signals.json"
"$ROOT/scripts/lib/derive-privacy.sh" --dir "$PV_DIR" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "PrivacySignals" and .mode == "pr" and .schema_version == 1' \
  "$PV_DIR/13-privacy-signals.json" >/dev/null; then
  pass "derive-privacy writes PrivacySignals (without 10-/11-/12-)"
else
  fail "derive-privacy did not write valid signals without prior derives"
fi
if "$ROOT/scripts/lib/derive-privacy.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-privacy documents --repo"
else
  fail "derive-privacy should document --repo for pre-manifest collect"
fi
"$ROOT/scripts/lib/derive-privacy.sh" --dir "$PV_DIR" --mode pr >/dev/null
if jq -e '.kind == "PrivacySignals"' "$PV_DIR/13-privacy-signals.json" >/dev/null; then
  pass "derive-privacy idempotent re-run"
else
  fail "derive-privacy re-run failed"
fi
if jq -e '.confidence_caps.no_legal_conclusion == true' "$PV_DIR/13-privacy-signals.json" >/dev/null; then
  pass "derive-privacy asserts no_legal_conclusion"
else
  fail "derive-privacy should set confidence_caps.no_legal_conclusion"
fi

# Privacy smoke: log exposure with email → signals_thin false
PV_SMOKE="$TMP/privacy-smoke"
mkdir -p "$PV_SMOKE/repo" "$PV_SMOKE/pack"
cat >"$PV_SMOKE/repo/UserService.java" <<'EOF'
class UserService {
  void save(String email, String phone) {
    logger.info("user email=" + email + " phone=" + phone);
    repository.save(email);
  }
}
EOF
cat >"$PV_SMOKE/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"UserService.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-privacy.sh" --dir "$PV_SMOKE/pack" --mode pr --repo "$PV_SMOKE/repo" >/dev/null
if jq -e '.signals_thin == false
  and (.log_exposure|length) >= 1
  and (.pii_field_hits|length) >= 1
  and (.notes|map(select(test("no privacy heuristics hit")))|length) == 0' \
  "$PV_SMOKE/pack/13-privacy-signals.json" >/dev/null; then
  pass "derive-privacy signals_thin false when PII/log hits (jq bool-safe)"
else
  fail "derive-privacy wrongly marks thin when PII/log signals present"
  jq '{signals_thin,pii_field_hits,log_exposure,notes}' \
    "$PV_SMOKE/pack/13-privacy-signals.json" >&2
fi

# Resilience derive: idempotent; independent of 10-/11-/12-/13-; --repo documented
if [[ -x "$ROOT/scripts/lib/derive-resilience.sh" ]]; then
  pass "derive-resilience.sh executable"
else
  fail "derive-resilience.sh missing or not executable"
fi

RS_DIR="$TMP/resilience-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$RS_DIR"
rm -f "$RS_DIR/14-resilience-signals.json" \
  "$RS_DIR/13-privacy-signals.json" \
  "$RS_DIR/12-dependency-signals.json" \
  "$RS_DIR/11-complexity-signals.json" \
  "$RS_DIR/10-design-fit-signals.json"
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$RS_DIR" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "ResilienceSignals" and .mode == "pr" and .schema_version == 1' \
  "$RS_DIR/14-resilience-signals.json" >/dev/null; then
  pass "derive-resilience writes ResilienceSignals (without 10-/11-/12-/13-)"
else
  fail "derive-resilience did not write valid signals without prior derives"
fi
if "$ROOT/scripts/lib/derive-resilience.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-resilience documents --repo"
else
  fail "derive-resilience should document --repo for pre-manifest collect"
fi
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$RS_DIR" --mode pr >/dev/null
if jq -e '.kind == "ResilienceSignals"' "$RS_DIR/14-resilience-signals.json" >/dev/null; then
  pass "derive-resilience idempotent re-run"
else
  fail "derive-resilience re-run failed"
fi
if jq -e '.confidence_caps.no_chaos_probe == true' "$RS_DIR/14-resilience-signals.json" >/dev/null; then
  pass "derive-resilience asserts no_chaos_probe"
else
  fail "derive-resilience should set confidence_caps.no_chaos_probe"
fi

# Resilience smoke: empty catch + http.Get without timeout → signals_thin false
RS_SMOKE="$TMP/resilience-smoke"
mkdir -p "$RS_SMOKE/repo" "$RS_SMOKE/pack"
cat >"$RS_SMOKE/repo/PaymentClient.java" <<'EOF'
class PaymentClient {
  void charge() {
    try {
      http.Get("https://pay.example/charge");
    } catch (Exception e) {
    }
  }
}
EOF
cat >"$RS_SMOKE/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"PaymentClient.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$RS_SMOKE/pack" --mode pr --repo "$RS_SMOKE/repo" >/dev/null
if jq -e '.signals_thin == false
  and (.silent_swallows|length) >= 1
  and (.timeout_gaps|length) >= 1
  and (.notes|map(select(test("no resilience heuristics hit")))|length) == 0' \
  "$RS_SMOKE/pack/14-resilience-signals.json" >/dev/null; then
  pass "derive-resilience signals_thin false when swallow/timeout hits (jq bool-safe)"
else
  fail "derive-resilience wrongly marks thin when swallow/timeout signals present"
  jq '{signals_thin,silent_swallows,timeout_gaps,notes}' \
    "$RS_SMOKE/pack/14-resilience-signals.json" >&2
fi

# Resilience smoke: retry + Promise.all + payment without idempot → multi-signal
RS_SMOKE2="$TMP/resilience-smoke2"
mkdir -p "$RS_SMOKE2/repo" "$RS_SMOKE2/pack"
cat >"$RS_SMOKE2/repo/BatchPay.ts" <<'EOF'
export async function chargeAll(ids: string[]) {
  // unbounded retry loop (no max / sleep)
  for (const id of ids) {
    await retry(() => fetch("https://pay.example/charge/" + id));
  }
  return Promise.all(ids.map((id) => fetch("https://pay.example/status/" + id)));
}
EOF
cat >"$RS_SMOKE2/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"BatchPay.ts","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$RS_SMOKE2/pack" --mode pr --repo "$RS_SMOKE2/repo" >/dev/null
if jq -e '.signals_thin == false
  and (.retry_risks|length) >= 1
  and (.partial_failure_gaps|length) >= 1
  and (.idempotency_gaps|length) >= 1
  and (.timeout_gaps|length) >= 1' \
  "$RS_SMOKE2/pack/14-resilience-signals.json" >/dev/null; then
  pass "derive-resilience covers retry/partial/idempotency/timeout function points"
else
  fail "derive-resilience missing retry/partial/idempotency/timeout signals"
  jq '{signals_thin,retry_risks,partial_failure_gaps,idempotency_gaps,timeout_gaps,notes}' \
    "$RS_SMOKE2/pack/14-resilience-signals.json" >&2
fi

# Resilience smoke: remote only → residual degrade (signals_thin may still be true)
RS_SMOKE3="$TMP/resilience-smoke3"
mkdir -p "$RS_SMOKE3/repo" "$RS_SMOKE3/pack"
cat >"$RS_SMOKE3/repo/Client.go" <<'EOF'
package client
import "net/http"
func Get() { http.Get("https://example.com") }
EOF
cat >"$RS_SMOKE3/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Client.go","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$RS_SMOKE3/pack" --mode pr --repo "$RS_SMOKE3/repo" >/dev/null
if jq -e '(.timeout_gaps|length) >= 1
  and (.residual_hardening|length) >= 1
  and (.degradation_or_breaker|length) == 0
  and (.notes|map(select(test("residual_hardening|degrade/breaker")))|length) >= 1' \
  "$RS_SMOKE3/pack/14-resilience-signals.json" >/dev/null; then
  pass "derive-resilience residual_hardening for remote without degrade/breaker"
else
  fail "derive-resilience should emit residual_hardening + notes for remote-only"
  jq '{timeout_gaps,residual_hardening,degradation_or_breaker,signals_thin,notes}' \
    "$RS_SMOKE3/pack/14-resilience-signals.json" >&2
fi

# Resilience hygiene: Go-only ignored_err; skip import REMOTE/RETRY; spin loop; per-site residual
RS_HYG="$TMP/resilience-hygiene"
mkdir -p "$RS_HYG/repo" "$RS_HYG/pack"
cat >"$RS_HYG/repo/Noise.java" <<'EOF'
import org.springframework.web.client.RestTemplate;
import org.springframework.retry.annotation.Retryable;
class Noise {
  // string should NOT trip Go ignored_err
  String doc = "_, err := ioutil.ReadFile(x)";
  void spin() {
    for (;;) {
      retry();
    }
  }
  void retry() {}
}
EOF
cat >"$RS_HYG/repo/RemoteOnly.java" <<'EOF'
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
class RemoteOnly {
  @CircuitBreaker(name = "a", fallbackMethod = "fb")
  String protectedCall() { return "ok"; }
  String fb(Throwable t) { return "fb"; }
}
EOF
cat >"$RS_HYG/repo/OtherClient.java" <<'EOF'
class OtherClient {
  void otherRemote() {
    RestTemplate rt = null;
    rt.getForObject("https://example.com", String.class);
  }
}
EOF
cat >"$RS_HYG/pack/04-changed-files.json" <<'EOF'
{"nodes":[
  {"path":"Noise.java","change_status":"add"},
  {"path":"RemoteOnly.java","change_status":"add"},
  {"path":"OtherClient.java","change_status":"add"}
]}
EOF
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$RS_HYG/pack" --mode pr --repo "$RS_HYG/repo" >/dev/null
if jq -e '
  ([.silent_swallows[]? | select(.kind=="ignored_error")]|length) == 0
  and ([.timeout_gaps[]? | select(.snippet|test("^\\s*import\\s"))] | length) == 0
  and ([.retry_risks[]? | select(.kind=="spin_loop_unbounded")]|length) >= 1
  and (.residual_hardening|length) >= 1
  and ([.residual_hardening[]? | select(.path=="OtherClient.java")]|length) >= 1
  and (.degradation_or_breaker|length) >= 1
' "$RS_HYG/pack/14-resilience-signals.json" >/dev/null; then
  pass "resilience hygiene: no Java ignored_err; no import timeout; spin+per-site residual"
else
  fail "resilience hygiene regressions"
  jq '{silent_swallows,timeout_gaps,retry_risks,residual_hardening,degradation_or_breaker}' \
    "$RS_HYG/pack/14-resilience-signals.json" >&2
fi

# Annotation edges for CircuitBreaker fallbackMethod + GetMapping
ANN="$TMP/annotation-edges"
mkdir -p "$ANN/repo" "$ANN/pack"
cat >"$ANN/repo/Api.java" <<'EOF'
import org.springframework.web.bind.annotation.GetMapping;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
class Api {
  @GetMapping("/x")
  @CircuitBreaker(name = "n", fallbackMethod = "fb")
  public String call() { return "x"; }
  public String fb(Throwable t) { return "y"; }
}
EOF
cat >"$ANN/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Api.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-annotation-edges.sh" --dir "$ANN/pack" --mode pr --repo "$ANN/repo" >/dev/null
if jq -e '.kind == "AnnotationEdges"
  and (.edges|map(select(.kind=="fallbackMethod" and .to_name=="fb"))|length) >= 1
  and (.edges|map(select(.kind=="spring_entry" and .to_name=="call"))|length) >= 1' \
  "$ANN/pack/19-annotation-edges.json" >/dev/null; then
  pass "derive-annotation-edges emits fallbackMethod + spring_entry"
else
  fail "derive-annotation-edges missing expected synthetic edges"
  jq . "$ANN/pack/19-annotation-edges.json" >&2
fi

# Corrupt pack JSON must WARN (not silent swallow)
ANN_BAD="$TMP/annotation-edges-bad"
mkdir -p "$ANN_BAD/pack" "$ANN_BAD/repo"
printf '%s\n' '{not-json' >"$ANN_BAD/pack/04-changed-files.json"
ANN_BAD_OUT="$("$ROOT/scripts/lib/derive-annotation-edges.sh" --dir "$ANN_BAD/pack" --mode pr --repo "$ANN_BAD/repo" 2>&1 || true)"
if echo "$ANN_BAD_OUT" | grep -qi 'warn:.*annotation_edges: skip'; then
  pass "derive-annotation-edges WARNs on corrupt pack JSON"
else
  fail "derive-annotation-edges must warn (not silent) on unreadable pack JSON"
  echo "$ANN_BAD_OUT" >&2
fi
if jq -e '((.warnings // [])|length) >= 1' "$ANN_BAD/pack/19-annotation-edges.json" >/dev/null 2>&1; then
  pass "derive-annotation-edges records warnings[] on corrupt pack JSON"
else
  fail "derive-annotation-edges should persist warnings[] when pack JSON is unreadable"
  jq . "$ANN_BAD/pack/19-annotation-edges.json" >&2 || true
fi

if [[ -x "$ROOT/scripts/collect-adhoc-evidence.sh" ]] \
  && "$ROOT/scripts/collect-adhoc-evidence.sh" -h 2>&1 | grep -q -- '--file'; then
  pass "collect-adhoc-evidence.sh exposes --file"
else
  fail "collect-adhoc-evidence.sh missing or help incomplete"
fi

if "$ROOT/scripts/collect-fullrepo-evidence.sh" -h 2>&1 | grep -q -- '--impact-top-n' \
  && grep -q 'edges_in_count' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && grep -q 'from_count is NOT fan-in' "$ROOT/scripts/collect-fullrepo-evidence.sh"; then
  pass "fullrepo blast-radius + from_count semantics wired"
else
  fail "fullrepo should collect impact/ and document from_count≠fan-in"
fi

if grep -q 'Hard gate' "$ROOT/references/dimensions/resilience.md" \
  && grep -q 'Hard gate' "$ROOT/prompts/pr-diff-review.md"; then
  pass "resilience signal→finding hard gate documented"
else
  fail "resilience hard gate missing from card/prompt"
fi

if grep -q 'Hard gate' "$ROOT/references/dimensions/performance.md" \
  && grep -q '21-performance-signals.json' "$ROOT/prompts/pr-diff-review.md" \
  && grep -q 'n_plus_one_risks' "$ROOT/prompts/pr-diff-review.md" \
  && grep -q '21-performance-signals.json' "$ROOT/prompts/full-repo-review.md"; then
  pass "performance signal→finding hard gate documented"
else
  fail "performance hard gate missing from card/prompt"
fi

# dead_nested requires empty edges-in confirmation (not from_count==0)
DN="$TMP/dead-nested"
mkdir -p "$DN/impact/nested1"
cat >"$DN/03-change-groups.json" <<'EOF'
{}
EOF
cat >"$DN/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Outer.java"}]}
EOF
cat >"$DN/05-changed-symbols.json" <<'EOF'
{"nodes":[{"id":"nested1","name":"Inner","kind":"class","depth":2,"from_count":0,"change_status":"add"}]}
EOF
# non-empty edges-in → must NOT confirm dead_nested
cat >"$DN/impact/nested1/edges-in.json" <<'EOF'
{"edges":[{"from_name":"Caller","to_name":"Inner"}]}
EOF
"$ROOT/scripts/lib/derive-design-fit.sh" --dir "$DN" --mode pr >/dev/null
if jq -e '(.dead_nested_candidates|length) >= 1 and (.dead_nested_symbols|length) == 0' \
  "$DN/10-design-fit-signals.json" >/dev/null; then
  pass "dead_nested not confirmed when edges-in non-empty (from_count==0 ignored)"
else
  fail "dead_nested should stay candidate-only without empty edges-in"
  jq '{dead_nested_candidates,dead_nested_symbols,over_abstraction_hints}' \
    "$DN/10-design-fit-signals.json" >&2
fi
# empty edges-in → confirmed
cat >"$DN/impact/nested1/edges-in.json" <<'EOF'
{"edges":[]}
EOF
"$ROOT/scripts/lib/derive-design-fit.sh" --dir "$DN" --mode pr >/dev/null
if jq -e '(.dead_nested_symbols|length) >= 1' "$DN/10-design-fit-signals.json" >/dev/null; then
  pass "dead_nested confirmed only via empty edges-in"
else
  fail "dead_nested should confirm on empty edges-in"
fi

# Rollout derive: idempotent; independent of 10–14; --repo documented
if [[ -x "$ROOT/scripts/lib/derive-rollout.sh" ]]; then
  pass "derive-rollout.sh executable"
else
  fail "derive-rollout.sh missing or not executable"
fi

RO_DIR="$TMP/rollout-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$RO_DIR"
rm -f "$RO_DIR/15-rollout-signals.json" \
  "$RO_DIR/14-resilience-signals.json" \
  "$RO_DIR/13-privacy-signals.json" \
  "$RO_DIR/12-dependency-signals.json" \
  "$RO_DIR/11-complexity-signals.json" \
  "$RO_DIR/10-design-fit-signals.json"
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_DIR" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "RolloutSignals" and .mode == "pr" and .schema_version == 1' \
  "$RO_DIR/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout writes RolloutSignals (without 10-/11-/12-/13-/14-)"
else
  fail "derive-rollout did not write valid signals without prior derives"
fi
if "$ROOT/scripts/lib/derive-rollout.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-rollout documents --repo"
else
  fail "derive-rollout should document --repo for pre-manifest collect"
fi
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_DIR" --mode pr >/dev/null
if jq -e '.kind == "RolloutSignals"' "$RO_DIR/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout idempotent re-run"
else
  fail "derive-rollout re-run failed"
fi
if jq -e '.confidence_caps.no_ops_probe == true' "$RO_DIR/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout asserts no_ops_probe"
else
  fail "derive-rollout should set confidence_caps.no_ops_probe"
fi

# Rollout smoke: destructive migration without rollback → non-thin
RO_SMOKE="$TMP/rollout-smoke"
mkdir -p "$RO_SMOKE/repo/db/migrate" "$RO_SMOKE/pack"
cat >"$RO_SMOKE/repo/db/migrate/V2__drop_users.sql" <<'EOF'
-- destructive cutover
ALTER TABLE users DROP COLUMN legacy_email;
DROP TABLE old_accounts;
EOF
cat >"$RO_SMOKE/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"db/migrate/V2__drop_users.sql","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_SMOKE/pack" --mode pr --repo "$RO_SMOKE/repo" >/dev/null
if jq -e '(.signals_thin == false)
  and ((.schema_migrations|length) >= 1 or (.rollback_gaps|length) >= 1)
  and (.notes|map(select(test("no rollout heuristics hit")))|length) == 0' \
  "$RO_SMOKE/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout signals_thin false when migration/rollback gaps (jq bool-safe)"
else
  fail "derive-rollout wrongly marks thin when migration signals present"
  jq '{signals_thin,schema_migrations,rollback_gaps,dual_write_gaps,notes}' \
    "$RO_SMOKE/pack/15-rollout-signals.json" >&2
fi

# Rollout smoke: feature flag positive + breaking without announce/compat
RO_SMOKE2="$TMP/rollout-smoke2"
mkdir -p "$RO_SMOKE2/repo" "$RO_SMOKE2/pack"
cat >"$RO_SMOKE2/repo/Flags.java" <<'EOF'
public class Flags {
  public boolean isFeatureEnabled(String name) { return true; }
  @Deprecated
  public void oldApi() {}
}
EOF
cat >"$RO_SMOKE2/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Flags.java","change_status":"change"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_SMOKE2/pack" --mode pr --repo "$RO_SMOKE2/repo" >/dev/null
if jq -e '(.feature_flags|length) >= 1
  and (.compat_window_gaps|length) >= 1
  and (.breaking_announcement_gaps|length) >= 1
  and (.signals_thin == false)' \
  "$RO_SMOKE2/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout covers feature_flags and compat/breaking function points"
else
  fail "derive-rollout missing feature_flags or compat/breaking signals"
  jq '{feature_flags,compat_window_gaps,breaking_announcement_gaps,signals_thin}' \
    "$RO_SMOKE2/pack/15-rollout-signals.json" >&2
fi

# Rollout smoke: storage cutover without dual-write
RO_SMOKE4="$TMP/rollout-smoke4"
mkdir -p "$RO_SMOKE4/repo" "$RO_SMOKE4/pack"
cat >"$RO_SMOKE4/repo/Cutover.java" <<'EOF'
public class Cutover {
  // switch_to new_store as source_of_truth cutover — no dual_write
  void migrateData() { replace_storage(); }
}
EOF
cat >"$RO_SMOKE4/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Cutover.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_SMOKE4/pack" --mode pr --repo "$RO_SMOKE4/repo" >/dev/null
if jq -e '(.dual_write_gaps|length) >= 1 and (.signals_thin == false)' \
  "$RO_SMOKE4/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout dual_write_gaps for storage cutover without dual-write"
else
  fail "derive-rollout should emit dual_write_gaps for storage switch"
  jq '{dual_write_gaps,surfaces,signals_thin,notes}' \
    "$RO_SMOKE4/pack/15-rollout-signals.json" >&2
fi

# Rollout smoke: positive feature_flags alone → still signals_thin
RO_SMOKE5="$TMP/rollout-smoke5"
mkdir -p "$RO_SMOKE5/repo" "$RO_SMOKE5/pack"
cat >"$RO_SMOKE5/repo/OnlyFlag.java" <<'EOF'
public class OnlyFlag {
  boolean on = isFeatureEnabled("feature_flag");
}
EOF
cat >"$RO_SMOKE5/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"OnlyFlag.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_SMOKE5/pack" --mode pr --repo "$RO_SMOKE5/repo" >/dev/null
if jq -e '(.feature_flags|length) >= 1 and (.signals_thin == true)
  and (.notes|map(select(test("feature_flags are positive|signals_thin for findings")))|length) >= 1' \
  "$RO_SMOKE5/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout positive feature_flags alone stays signals_thin"
else
  fail "derive-rollout should keep signals_thin when only positive feature_flags"
  jq '{feature_flags,signals_thin,notes}' \
    "$RO_SMOKE5/pack/15-rollout-signals.json" >&2
fi

# Rollout smoke: Javadoc listing remedy keywords must NOT waive gaps (general bug)
RO_SMOKE_DOC="$TMP/rollout-smoke-javadoc"
mkdir -p "$RO_SMOKE_DOC/repo/db/migrate" "$RO_SMOKE_DOC/pack"
cat >"$RO_SMOKE_DOC/repo/db/migrate/V9__HardCut.java" <<'EOF'
package com.pay.ledger.flyway;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.sql.Statement;
/**
 * Meta docs (must not waive): dual_write feature_flag rollback compat_window
 * CHANGELOG MIGRATION_GUIDE canary blue_green.
 */
public class V9__HardCut extends BaseJavaMigration {
  @Override
  public void migrate(Context context) throws Exception {
    try (Statement st = context.getConnection().createStatement()) {
      // switch_to new_store / source_of_truth cutover — no real dual write
      st.execute("INSERT INTO new_store.t SELECT * FROM old_store.t");
      st.execute("ALTER TABLE fund_ledger DROP COLUMN legacy");
      st.execute("TRUNCATE TABLE fund_ledger_tmp");
      st.execute("DROP TABLE fund_ledger_legacy");
    }
  }
  /** @Deprecated breaking_change will_be_removed public column */
  @Deprecated
  public void dropPublic() {}
}
EOF
cat >"$RO_SMOKE_DOC/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"db/migrate/V9__HardCut.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_SMOKE_DOC/pack" --mode pr --repo "$RO_SMOKE_DOC/repo" >/dev/null
if jq -e '(.signals_thin == false)
  and (.feature_flags|length) == 0
  and (.dual_write_gaps|length) >= 1
  and (.feature_flag_gaps|length) >= 1
  and (.rollback_gaps|length) >= 1
  and (.breaking_announcement_gaps|length) >= 1
  and (.compat_window_gaps|length) >= 1
  and (.surfaces.dual_write == false)
  and (.surfaces.feature_flag == false)
  and (.surfaces.rollback == false)
  and (.surfaces.announce == false)' \
  "$RO_SMOKE_DOC/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout Javadoc remedy keywords do not waive gaps"
else
  fail "derive-rollout must ignore Javadoc dual_write/flag/rollback/CHANGELOG waivers"
  jq '{signals_thin,feature_flags,dual_write_gaps,feature_flag_gaps,rollback_gaps,breaking_announcement_gaps,compat_window_gaps,surfaces}' \
    "$RO_SMOKE_DOC/pack/15-rollout-signals.json" >&2
fi

# Risk tier: executable + migration/IaC/auth → T0; docs-only → T3
if [[ -x "$ROOT/scripts/lib/derive-risk-tier.sh" ]]; then
  pass "derive-risk-tier.sh executable"
else
  fail "derive-risk-tier.sh missing or not executable"
fi
if "$ROOT/scripts/lib/derive-risk-tier.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-risk-tier documents --repo"
else
  fail "derive-risk-tier should document --repo"
fi

RT_MIG="$TMP/risk-tier-mig"
mkdir -p "$RT_MIG/pack"
cat >"$RT_MIG/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"db/migrate/V2__drop.sql","change_status":"add"},{"path":"README.md","change_status":"change"}]}
EOF
printf '%s\n' '{"kind":"SensitivePack","search":{"results":[]},"symbol_name_queries":[]}' >"$RT_MIG/pack/06-sensitive-hits.json"
printf '%s\n' '{"kind":"TagsPack","keys":{"keys":[]},"tagged":[]}' >"$RT_MIG/pack/07-tags.json"
printf '%s\n' '{"kind":"RolloutSignals","surfaces":{"migration":true,"destructive":false,"money":false,"feature_flag":false,"breaking":false,"storage_switch":false}}' >"$RT_MIG/pack/15-rollout-signals.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_MIG/pack" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "RiskTierSignals" and .tier == "T0" and .industry_tier == "Tier3"
  and .review_depth.evidence_floor == "full_checklist"
  and .review_depth.paired_review_recommended == true' \
  "$RT_MIG/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier migration → T0 full_checklist"
else
  fail "derive-risk-tier should mark migration as T0"
  jq '{tier,industry_tier,review_depth,drivers,notes}' "$RT_MIG/pack/20-risk-tier.json" >&2
fi

RT_IAC="$TMP/risk-tier-iac"
mkdir -p "$RT_IAC/pack"
cat >"$RT_IAC/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"infra/terraform/iam_checkout.tf","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_IAC/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_IAC/pack/"
printf '%s\n' '{"kind":"RolloutSignals","surfaces":{}}' >"$RT_IAC/pack/15-rollout-signals.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_IAC/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_IAC/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier IaC path → T0"
else
  fail "derive-risk-tier should mark terraform/IAM as T0"
  jq '{tier,drivers}' "$RT_IAC/pack/20-risk-tier.json" >&2
fi

RT_AUTH="$TMP/risk-tier-auth"
mkdir -p "$RT_AUTH/pack"
cat >"$RT_AUTH/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"src/auth/OAuthMiddleware.java","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_AUTH/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_AUTH/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_AUTH/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_AUTH/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_AUTH/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier auth path → T0"
else
  fail "derive-risk-tier should mark auth path as T0"
  jq '{tier,drivers}' "$RT_AUTH/pack/20-risk-tier.json" >&2
fi

RT_PAY="$TMP/risk-tier-pay"
mkdir -p "$RT_PAY/pack"
cat >"$RT_PAY/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"services/billing/WalletCharge.java","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_PAY/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_PAY/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_PAY/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_PAY/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_PAY/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier pay/billing path → T0"
else
  fail "derive-risk-tier should mark pay/billing path as T0"
  jq '{tier,drivers}' "$RT_PAY/pack/20-risk-tier.json" >&2
fi

RT_DOCS="$TMP/risk-tier-docs"
mkdir -p "$RT_DOCS/pack"
cat >"$RT_DOCS/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"README.md","change_status":"change"},{"path":"docs/guide.md","change_status":"add"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_DOCS/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_DOCS/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_DOCS/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_DOCS/pack" --mode pr >/dev/null
if jq -e '.tier == "T3" and .review_depth.evidence_floor == "sample_ci"' \
  "$RT_DOCS/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier docs-only → T3 sample_ci"
else
  fail "derive-risk-tier should mark docs-only as T3"
  jq '{tier,review_depth,drivers,notes}' "$RT_DOCS/pack/20-risk-tier.json" >&2
fi

RT_TESTS="$TMP/risk-tier-tests"
mkdir -p "$RT_TESTS/pack"
cat >"$RT_TESTS/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"src/foo_test.go","change_status":"add"},{"path":"__tests__/bar.spec.ts","change_status":"add"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_TESTS/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_TESTS/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_TESTS/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_TESTS/pack" --mode pr >/dev/null
if jq -e '.tier == "T3"' "$RT_TESTS/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier tests-only → T3"
else
  fail "derive-risk-tier should mark tests-only as T3"
  jq '{tier,drivers}' "$RT_TESTS/pack/20-risk-tier.json" >&2
fi

RT_MIX="$TMP/risk-tier-mix"
mkdir -p "$RT_MIX/pack"
cat >"$RT_MIX/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"README.md","change_status":"change"},{"path":"infra/terraform/iam.tf","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_MIX/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_MIX/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_MIX/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_MIX/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_MIX/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier highest-wins (docs+terraform → T0)"
else
  fail "derive-risk-tier must not under-escalate mixed docs+IaC"
  jq '{tier,drivers}' "$RT_MIX/pack/20-risk-tier.json" >&2
fi

RT_DOCKER="$TMP/risk-tier-docker"
mkdir -p "$RT_DOCKER/pack"
cat >"$RT_DOCKER/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Dockerfile","change_status":"change"},{"path":".github/workflows/deploy.yml","change_status":"add"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_DOCKER/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_DOCKER/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_DOCKER/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_DOCKER/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_DOCKER/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier Dockerfile/workflows → T0"
else
  fail "derive-risk-tier should mark Dockerfile/workflows as T0"
  jq '{tier,drivers}' "$RT_DOCKER/pack/20-risk-tier.json" >&2
fi

RT_BREAK="$TMP/risk-tier-break"
mkdir -p "$RT_BREAK/pack"
cat >"$RT_BREAK/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"pkg/util/helper.go","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_BREAK/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_BREAK/pack/"
printf '%s\n' '{"kind":"RolloutSignals","surfaces":{"breaking":true,"storage_switch":false,"feature_flag":false,"migration":false,"destructive":false,"money":false}}' >"$RT_BREAK/pack/15-rollout-signals.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_BREAK/pack" --mode pr >/dev/null
if jq -e '.tier == "T1"' "$RT_BREAK/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier breaking without flag → T1"
else
  fail "derive-risk-tier should mark breaking/no-flag as T1"
  jq '{tier,drivers}' "$RT_BREAK/pack/20-risk-tier.json" >&2
fi

RT_MONEY="$TMP/risk-tier-money"
mkdir -p "$RT_MONEY/pack"
cat >"$RT_MONEY/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"pkg/util/helper.go","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_MONEY/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_MONEY/pack/"
printf '%s\n' '{"kind":"RolloutSignals","surfaces":{"money":true,"migration":true,"destructive":false,"feature_flag":false,"breaking":false,"storage_switch":false}}' >"$RT_MONEY/pack/15-rollout-signals.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_MONEY/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_MONEY/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier money+migration surfaces → T0"
else
  fail "derive-risk-tier should mark money+migration as T0"
  jq '{tier,drivers}' "$RT_MONEY/pack/20-risk-tier.json" >&2
fi

RT_MISS="$TMP/risk-tier-miss"
mkdir -p "$RT_MISS/pack"
cat >"$RT_MISS/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"README.md","change_status":"change"}]}
EOF
# intentionally omit 06/07/15 → escalate T3→T2
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_MISS/pack" --mode pr >/dev/null
if jq -e '.tier == "T2" and ((.notes|length) >= 1)' "$RT_MISS/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier missing inputs escalates one tier"
else
  fail "derive-risk-tier should escalate on missing inputs"
  jq '{tier,notes,summary}' "$RT_MISS/pack/20-risk-tier.json" >&2
fi

RT_DOC_AUTH="$TMP/risk-tier-doc-auth"
mkdir -p "$RT_DOC_AUTH/pack"
cat >"$RT_DOC_AUTH/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"docs/authentication.md","change_status":"change"}]}
EOF
cp "$RT_MIG/pack/06-sensitive-hits.json" "$RT_DOC_AUTH/pack/"
cp "$RT_MIG/pack/07-tags.json" "$RT_DOC_AUTH/pack/"
cp "$RT_IAC/pack/15-rollout-signals.json" "$RT_DOC_AUTH/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_DOC_AUTH/pack" --mode pr >/dev/null
if jq -e '.tier == "T3"' "$RT_DOC_AUTH/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier docs with auth substring stay T3"
else
  fail "derive-risk-tier must not T0 docs/authentication.md"
  jq '{tier,drivers}' "$RT_DOC_AUTH/pack/20-risk-tier.json" >&2
fi

# Catalog tag keys with repo_count=0 must not force T1 (general stability)
RT_TAG_CATALOG="$TMP/risk-tier-tag-catalog"
mkdir -p "$RT_TAG_CATALOG/pack/entries/tagged"
cat >"$RT_TAG_CATALOG/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"src/util/StringHelpers.java","change_status":"change"}]}
EOF
printf '%s\n' '{"kind":"SensitivePack","search":{"results":[]},"symbol_name_queries":[]}' >"$RT_TAG_CATALOG/pack/06-sensitive-hits.json"
cat >"$RT_TAG_CATALOG/pack/07-tags.json" <<'EOF'
{
  "kind": "TagsPack",
  "keys": [
    {"key": "framework.http", "desc": "Spring HTTP 端点", "repo_count": 0, "taggers": ["spring"]},
    {"key": "framework.mq_consumer", "desc": "MQ consumer", "repo_count": 0, "taggers": ["spring"]}
  ],
  "tagged": [
    {"key": "framework.http", "file": "entries/tagged/framework.http_.json"},
    {"key": "framework.mq_consumer", "file": "entries/tagged/framework.mq_consumer_.json"}
  ]
}
EOF
printf '%s\n' '{"kind":"Tagged","nodes":[]}' >"$RT_TAG_CATALOG/pack/entries/tagged/framework.http_.json"
printf '%s\n' '{"kind":"Tagged","nodes":[]}' >"$RT_TAG_CATALOG/pack/entries/tagged/framework.mq_consumer_.json"
printf '%s\n' '{"kind":"RolloutSignals","surfaces":{}}' >"$RT_TAG_CATALOG/pack/15-rollout-signals.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_TAG_CATALOG/pack" --mode pr >/dev/null
if jq -e '.tier == "T2" and ((.drivers.tag_hits // [])|length) == 0' \
  "$RT_TAG_CATALOG/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier empty tag catalog (repo_count=0) stays T2"
else
  fail "derive-risk-tier must ignore unused tag-key catalog / empty tagged files"
  jq '{tier,drivers}' "$RT_TAG_CATALOG/pack/20-risk-tier.json" >&2
fi

# Regex/pattern-definition sensitive snippets must not force T0
RT_SENS_META="$TMP/risk-tier-sens-meta"
mkdir -p "$RT_SENS_META/pack"
cat >"$RT_SENS_META/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"tools/scanner/_privacy_body.py","change_status":"add"}]}
EOF
cat >"$RT_SENS_META/pack/06-sensitive-hits.json" <<'EOF'
{
  "kind": "SensitivePack",
  "search": {
    "results": [
      {
        "path": "tools/scanner/_privacy_body.py",
        "text": "PII_RE = re.compile(r\"password|secret|token|auth|email|phone\")"
      }
    ]
  },
  "symbol_name_queries": []
}
EOF
printf '%s\n' '{"kind":"TagsPack","keys":[],"tagged":[]}' >"$RT_SENS_META/pack/07-tags.json"
printf '%s\n' '{"kind":"RolloutSignals","surfaces":{}}' >"$RT_SENS_META/pack/15-rollout-signals.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_SENS_META/pack" --mode pr >/dev/null
if jq -e '.tier == "T2" and ((.drivers.sensitive_hits // [])|length) == 0' \
  "$RT_SENS_META/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier pattern-definition sensitive snippets do not force T0"
else
  fail "derive-risk-tier must ignore regex/keyword-list sensitive snippets"
  jq '{tier,drivers}' "$RT_SENS_META/pack/20-risk-tier.json" >&2
fi

# BM25 file-header / module-docstring snippets mentioning auth must not force T0
RT_SENS_DOC="$TMP/risk-tier-sens-doc"
mkdir -p "$RT_SENS_DOC/pack"
cat >"$RT_SENS_DOC/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"tools/scanner/_risk_tier_body.py","change_status":"change"}]}
EOF
cat >"$RT_SENS_DOC/pack/06-sensitive-hits.json" <<'EOF'
{
  "kind": "SensitivePack",
  "search": {
    "results": [
      {
        "path": "tools/scanner/_risk_tier_body.py",
        "text": "#!/usr/bin/env python3\n\"\"\"Blast-radius risk tier from pack paths + tags + sensitive + rollout surfaces.\n\nWrites JSON body consumed by derive-risk-tier.sh. Zero CodexQA calls.\nT0 = highest blast (auth/pay/migration/IaC). Highest file tier wins.\n\"\"\"\nfrom __future__ import annotations\n"
      }
    ]
  },
  "symbol_name_queries": []
}
EOF
cp "$RT_SENS_META/pack/07-tags.json" "$RT_SENS_DOC/pack/"
cp "$RT_SENS_META/pack/15-rollout-signals.json" "$RT_SENS_DOC/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_SENS_DOC/pack" --mode pr >/dev/null
if jq -e '.tier == "T2" and ((.drivers.sensitive_hits // [])|length) == 0' \
  "$RT_SENS_DOC/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier docstring/header sensitive snippets do not force T0"
else
  fail "derive-risk-tier must ignore auth/token mentions inside module docstrings"
  jq '{tier,drivers}' "$RT_SENS_DOC/pack/20-risk-tier.json" >&2
fi

# Real secret usage snippet still forces T0
RT_SENS_REAL="$TMP/risk-tier-sens-real"
mkdir -p "$RT_SENS_REAL/pack"
cat >"$RT_SENS_REAL/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"src/config/AppConfig.java","change_status":"change"}]}
EOF
cat >"$RT_SENS_REAL/pack/06-sensitive-hits.json" <<'EOF'
{
  "kind": "SensitivePack",
  "search": {
    "results": [
      {
        "path": "src/config/AppConfig.java",
        "text": "private String apiSecret = props.get(\"token\");"
      }
    ]
  },
  "symbol_name_queries": []
}
EOF
cp "$RT_SENS_META/pack/07-tags.json" "$RT_SENS_REAL/pack/"
cp "$RT_SENS_META/pack/15-rollout-signals.json" "$RT_SENS_REAL/pack/"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_SENS_REAL/pack" --mode pr >/dev/null
if jq -e '.tier == "T0"' "$RT_SENS_REAL/pack/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier real sensitive usage still forces T0"
else
  fail "derive-risk-tier should still T0 real secret/token usage hits"
  jq '{tier,drivers}' "$RT_SENS_REAL/pack/20-risk-tier.json" >&2
fi

RT_DIR="$TMP/risk-tier-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$RT_DIR"
rm -f "$RT_DIR/20-risk-tier.json"
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_DIR" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "RiskTierSignals" and .schema_version == 1' \
  "$RT_DIR/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier writes RiskTierSignals on fixture pack"
else
  fail "derive-risk-tier did not write valid RiskTierSignals"
fi
"$ROOT/scripts/lib/derive-risk-tier.sh" --dir "$RT_DIR" --mode pr >/dev/null
if jq -e '.kind == "RiskTierSignals"' "$RT_DIR/20-risk-tier.json" >/dev/null; then
  pass "derive-risk-tier idempotent re-run"
else
  fail "derive-risk-tier re-run failed"
fi

# Performance derive: executable; N+1 / unbounded / thin smokes; no_profiler
if [[ -x "$ROOT/scripts/lib/derive-performance.sh" ]]; then
  pass "derive-performance.sh executable"
else
  fail "derive-performance.sh missing or not executable"
fi
if "$ROOT/scripts/lib/derive-performance.sh" --help 2>&1 | grep -q -- '--repo'; then
  pass "derive-performance documents --repo"
else
  fail "derive-performance should document --repo"
fi

PF_DIR="$TMP/performance-pack"
cp -R "$ROOT/evals/fixtures/minimal-pr-pack" "$PF_DIR"
rm -f "$PF_DIR/21-performance-signals.json" \
  "$PF_DIR/18-maintainability-signals.json" \
  "$PF_DIR/14-resilience-signals.json"
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_DIR" --mode pr --repo "/tmp" >/dev/null
if jq -e '.kind == "PerformanceSignals" and .mode == "pr" and .schema_version == 1
  and .confidence_caps.no_profiler == true' \
  "$PF_DIR/21-performance-signals.json" >/dev/null; then
  pass "derive-performance writes PerformanceSignals (independent of maintainability)"
else
  fail "derive-performance did not write valid signals"
fi
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_DIR" --mode pr >/dev/null
if jq -e '.kind == "PerformanceSignals"' "$PF_DIR/21-performance-signals.json" >/dev/null; then
  pass "derive-performance idempotent re-run"
else
  fail "derive-performance re-run failed"
fi

PF_N1="$TMP/performance-n1"
mkdir -p "$PF_N1/repo" "$PF_N1/pack"
cat >"$PF_N1/repo/OrderController.java" <<'EOF'
@RestController
class OrderController {
  void list(List<Long> ids) {
    for (Long id : ids) {
      orderRepository.findById(id);
    }
  }
}
EOF
cat >"$PF_N1/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"OrderController.java","change_status":"add"}]}
EOF
cat >"$PF_N1/pack/07-tags.json" <<'EOF'
{"nodes":[{"path":"OrderController.java","tags":["http","controller"]}]}
EOF
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_N1/pack" --mode pr --repo "$PF_N1/repo" >/dev/null
if jq -e '.signals_thin == false
  and (.n_plus_one_risks|length) >= 1
  and (.hot_path_risks|length) >= 1
  and (.notes|map(select(test("no performance pathology")))|length) == 0' \
  "$PF_N1/pack/21-performance-signals.json" >/dev/null; then
  pass "derive-performance N+1 + hot-path on controller"
else
  fail "derive-performance should emit N+1/hot-path for loop findById"
  jq '{signals_thin,n_plus_one_risks,hot_path_risks,notes}' \
    "$PF_N1/pack/21-performance-signals.json" >&2
fi

PF_UB="$TMP/performance-unbounded"
mkdir -p "$PF_UB/repo" "$PF_UB/pack"
cat >"$PF_UB/repo/UserService.java" <<'EOF'
class UserService {
  List<User> all() {
    return userRepository.findAll();
  }
}
EOF
cat >"$PF_UB/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"UserService.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_UB/pack" --mode pr --repo "$PF_UB/repo" >/dev/null
if jq -e '.signals_thin == false
  and (.unbounded_allocation|length) >= 1
  and (.unbounded_allocation[0].kind == "unpaginated_list")' \
  "$PF_UB/pack/21-performance-signals.json" >/dev/null; then
  pass "derive-performance unbounded unpaginated list"
else
  fail "derive-performance should emit unpaginated_list for findAll"
  jq '{signals_thin,unbounded_allocation,notes}' \
    "$PF_UB/pack/21-performance-signals.json" >&2
fi

PF_CONCAT="$TMP/performance-concat"
mkdir -p "$PF_CONCAT/repo" "$PF_CONCAT/pack"
cat >"$PF_CONCAT/repo/Build.java" <<'EOF'
class Build {
  String join(List<String> parts) {
    String s = "";
    for (String p : parts) {
      s += p;
    }
    return s;
  }
}
EOF
cat >"$PF_CONCAT/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"Build.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_CONCAT/pack" --mode pr --repo "$PF_CONCAT/repo" >/dev/null
if jq -e '.signals_thin == false
  and ([.unbounded_allocation[]? | select(.kind=="string_concat_in_loop")]|length) >= 1' \
  "$PF_CONCAT/pack/21-performance-signals.json" >/dev/null; then
  pass "derive-performance string += var in loop"
else
  fail "derive-performance should emit string_concat_in_loop for s += p"
  jq '{signals_thin,unbounded_allocation,notes}' \
    "$PF_CONCAT/pack/21-performance-signals.json" >&2
fi

PF_CACHE="$TMP/performance-cache"
mkdir -p "$PF_CACHE/repo" "$PF_CACHE/pack"
cat >"$PF_CACHE/repo/CacheSvc.java" <<'EOF'
class CacheSvc {
  void put(String k, Object v) {
    cache.put(k, v);
  }
}
EOF
cat >"$PF_CACHE/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"CacheSvc.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_CACHE/pack" --mode pr --repo "$PF_CACHE/repo" >/dev/null
if jq -e '.signals_thin == false
  and ([.unbounded_allocation[]? | select(.kind=="cache_unbounded")]|length) >= 1' \
  "$PF_CACHE/pack/21-performance-signals.json" >/dev/null; then
  pass "derive-performance cache.put without TTL/evict"
else
  fail "derive-performance should emit cache_unbounded"
  jq '{signals_thin,unbounded_allocation,notes}' \
    "$PF_CACHE/pack/21-performance-signals.json" >&2
fi

PF_THIN="$TMP/performance-thin"
mkdir -p "$PF_THIN/repo" "$PF_THIN/pack"
echo '# docs only' >"$PF_THIN/repo/README.md"
cat >"$PF_THIN/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"README.md","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-performance.sh" --dir "$PF_THIN/pack" --mode pr --repo "$PF_THIN/repo" >/dev/null
if jq -e '.signals_thin == true
  and (.n_plus_one_risks|length) == 0
  and (.hot_path_risks|length) == 0
  and (.unbounded_allocation|length) == 0' \
  "$PF_THIN/pack/21-performance-signals.json" >/dev/null; then
  pass "derive-performance docs-only stays thin"
else
  fail "derive-performance should stay thin for docs-only"
  jq '{signals_thin,n_plus_one_risks,hot_path_risks,unbounded_allocation,notes}' \
    "$PF_THIN/pack/21-performance-signals.json" >&2
fi

if grep -q 'N+1 / hot-path / unbounded alloc →' "$ROOT/references/dimensions/maintainability.md" \
  || grep -q 'performance.md' "$ROOT/references/dimensions/maintainability.md"; then
  pass "maintainability non-goals point to performance dimension"
else
  fail "maintainability should defer N+1/hot-path/alloc to performance"
fi

# line_scan: C pointer lines starting with * must not be treated as javadoc
LS_PY="$TMP/line_scan_check.py"
cat >"$LS_PY" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
from _line_scan import (
    advance_block_state,
    iter_code_lines,
    is_pattern_definition_line,
    is_heuristic_meta_line,
    is_doc_path,
)
skip, _ = advance_block_state("*ptr = 1;", False)
assert skip is False, skip
skip2, _ = advance_block_state("* javadoc text", False)
assert skip2 is True, skip2
lines = ["/**", " * dual_write feature_flag", " */", "int x = 1;"]
codes = [s for _, _, s in iter_code_lines(lines)]
assert codes == ["int x = 1;"], codes
assert is_pattern_definition_line('PII_RE = re.compile(r"password|secret|token|auth")')
assert is_pattern_definition_line('r"email|phone|mobile|id_card|"')
assert not is_pattern_definition_line('private String apiSecret = props.get("token");')
assert is_heuristic_meta_line('if FEATURE_FLAG.search(line):')
assert is_heuristic_meta_line('"feature_flag": any_flag,')
assert is_doc_path('docs/guide.md') and not is_doc_path('db/migrate/V1.sql')
print("ok")
PY
if "$SCRIPT_DIR/acr-python" "$LS_PY" "$ROOT/scripts/lib"; then
  pass "line_scan skips javadoc but keeps *ptr code lines"
else
  fail "line_scan comment skip regression"
fi

# Rollout smoke: English "truncate" in markdown must not invent DDL/T0 surfaces
RO_TRUNC="$TMP/rollout-truncate-prose"
mkdir -p "$RO_TRUNC/repo/docs" "$RO_TRUNC/pack"
cat >"$RO_TRUNC/repo/docs/guide.md" <<'EOF'
# Guide
Never feed whole files >500 lines into judgment context (scripts already truncate).
Keep a diagram to 8–15 nodes; truncate and say so.
EOF
cat >"$RO_TRUNC/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"docs/guide.md","change_status":"change"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_TRUNC/pack" --mode pr --repo "$RO_TRUNC/repo" >/dev/null
if jq -e '((.schema_migrations|length) == 0)
  and (.surfaces.migration == false)
  and (.surfaces.destructive == false)
  and (.signals_thin == true)' \
  "$RO_TRUNC/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout English truncate in markdown does not invent DDL"
else
  fail "derive-rollout must ignore prose truncate (not TRUNCATE TABLE)"
  jq '{schema_migrations,surfaces,signals_thin}' \
    "$RO_TRUNC/pack/15-rollout-signals.json" >&2
fi

# Rollout smoke: scanner/meta feature_flag lines must not light surfaces
RO_META="$TMP/rollout-meta-scanner"
mkdir -p "$RO_META/repo/tools" "$RO_META/pack"
cat >"$RO_META/repo/tools/scan_rollout.py" <<'EOF'
FEATURE_FLAG = re.compile(r"feature_flag|kill_switch")
def scan(line):
    if FEATURE_FLAG.search(line):
        feature_flags.append({"kind": "feature_flag"})
    return {"feature_flag": True, "note": "cutover without feature-flag clue"}
EOF
cat >"$RO_META/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"tools/scan_rollout.py","change_status":"change"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_META/pack" --mode pr --repo "$RO_META/repo" >/dev/null
if jq -e '((.feature_flags|length) == 0) and (.surfaces.feature_flag == false)' \
  "$RO_META/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout scanner meta feature_flag lines do not light surfaces"
else
  fail "derive-rollout must ignore FEATURE_FLAG.search / schema keys"
  jq '{feature_flags,surfaces}' "$RO_META/pack/15-rollout-signals.json" >&2
fi

# Rollout smoke: migration path only → residual_rollout
RO_SMOKE3="$TMP/rollout-smoke3"
mkdir -p "$RO_SMOKE3/repo/flyway" "$RO_SMOKE3/pack"
cat >"$RO_SMOKE3/repo/flyway/V1__init.sql" <<'EOF'
CREATE TABLE widgets (id INT);
EOF
cat >"$RO_SMOKE3/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"flyway/V1__init.sql","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-rollout.sh" --dir "$RO_SMOKE3/pack" --mode pr --repo "$RO_SMOKE3/repo" >/dev/null
if jq -e '((.schema_migrations|length) >= 1)
  and ((.residual_rollout|length) >= 1 or (.feature_flag_gaps|length) >= 1)
  and (.notes|map(select(test("residual_rollout|Never invent")))|length) >= 1' \
  "$RO_SMOKE3/pack/15-rollout-signals.json" >/dev/null; then
  pass "derive-rollout residual_rollout for migration without flag/rollback"
else
  fail "derive-rollout should emit residual_rollout or flag gaps for migration-only"
  jq '{schema_migrations,residual_rollout,feature_flag_gaps,signals_thin,notes}' \
    "$RO_SMOKE3/pack/15-rollout-signals.json" >&2
fi


# --- Heuristic gap smokes (deps source / TRACE.log / fallback noise / JDBC / secondary) ---
GAP="$TMP/heuristic-gaps"
mkdir -p "$GAP/repo" "$GAP/pack"
cat >"$GAP/repo/DepEmbed.java" <<'EOF'
class DepEmbed {
  static final String VER = "1.2.3-SNAPSHOT";
  void log(String email) { TRACE.info("user=" + email); }
  int n = asInt(text, fallback);
  void sql() { DriverManager.getConnection("jdbc:x"); }
  void sink() { el.innerHTML = user; }
  void bad() { try { x(); } catch (Exception e) { } }
}
EOF
cat >"$GAP/pack/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"DepEmbed.java","change_status":"add"}]}
EOF
"$ROOT/scripts/lib/derive-dependencies.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '(.snapshot_or_floating|map(select(.kind=="source_string_floating"))|length) >= 1 and .signals_thin == false' \
  "$GAP/pack/12-dependency-signals.json" >/dev/null; then
  pass "deps source_string_floating for SNAPSHOT in Java"
else
  fail "deps should signal SNAPSHOT strings in source"
  jq '{signals_thin,snapshot_or_floating}' "$GAP/pack/12-dependency-signals.json" >&2
fi
"$ROOT/scripts/lib/derive-privacy.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '(.log_exposure|length) >= 1' "$GAP/pack/13-privacy-signals.json" >/dev/null; then
  pass "privacy LOG_API matches TRACE.info"
else
  fail "privacy should match TRACE.info log exposure"
  jq '{log_exposure}' "$GAP/pack/13-privacy-signals.json" >&2
fi
"$ROOT/scripts/lib/derive-resilience.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '(.degradation_or_breaker|length) == 0 and (.timeout_gaps|map(select(.snippet|test("DriverManager")))|length) >= 1' \
  "$GAP/pack/14-resilience-signals.json" >/dev/null; then
  pass "resilience: no bare-fallback breaker; JDBC timeout gap"
else
  fail "resilience fallback noise or missing JDBC timeout"
  jq '{degradation_or_breaker,timeout_gaps,silent_swallows}' "$GAP/pack/14-resilience-signals.json" >&2
fi
"$ROOT/scripts/lib/derive-contract.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '.kind == "ContractSignals" and (.xss_html_hits|length) >= 1' \
  "$GAP/pack/17-contract-signals.json" >/dev/null; then
  pass "contract XSS/HTML sink heuristic"
else
  fail "contract should emit xss_html_hits"
fi
"$ROOT/scripts/lib/derive-observability.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '.kind == "ObservabilitySignals"' "$GAP/pack/16-observability-signals.json" >/dev/null; then
  pass "observability derive writes ObservabilitySignals"
else
  fail "observability derive missing"
fi
"$ROOT/scripts/lib/derive-maintainability.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '.kind == "MaintainabilitySignals"' "$GAP/pack/18-maintainability-signals.json" >/dev/null; then
  pass "maintainability derive writes MaintainabilitySignals"
else
  fail "maintainability derive missing"
fi
"$ROOT/scripts/lib/derive-performance.sh" --dir "$GAP/pack" --mode pr --repo "$GAP/repo" >/dev/null
if jq -e '.kind == "PerformanceSignals"' "$GAP/pack/21-performance-signals.json" >/dev/null; then
  pass "performance derive writes PerformanceSignals"
else
  fail "performance derive missing"
fi

# HTML with design_fit section present (committed fixture)
RENDER_DF="$TMP/render-design-fit"
mkdir -p "$RENDER_DF"
cp "$ROOT/evals/fixtures/conclusion/with-design-fit.json" "$RENDER_DF/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_DF" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q 'data-zh="架构契合"' "$RENDER_DF/REVIEW-REPORT.html" \
  && grep -q '<h3>Belong</h3>' "$RENDER_DF/REVIEW-REPORT.html" \
  && grep -q '<h3>Layer</h3>' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html shows design_fit Belong/Layer sections"
else
  fail "render-review-html should render design_fit Belong/Layer sections"
  echo "$RO" >&2
fi
# ok/none subsections omitted even when design_fit is shown
if ! grep -q '<h3>Over-engineering</h3>' "$RENDER_DF/REVIEW-REPORT.html" \
  && ! grep -q '<h3>Timing</h3>' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html omits ok/none design_fit subsections"
else
  fail "render should omit ok/none design_fit subsections from HTML"
fi
# optional complexity absent → skip section
if ! grep -q '复杂度 / 认知负担' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html skips complexity when absent (legacy conclusion)"
else
  fail "render should omit complexity section when conclusion lacks complexity"
fi
# optional dependencies absent → skip section
if ! grep -q '依赖 / 供应链' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html skips dependencies when absent (legacy conclusion)"
else
  fail "render should omit dependencies section when conclusion lacks dependencies"
fi
# optional privacy absent → skip section
if ! grep -q '隐私 / 合规' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html skips privacy when absent (legacy conclusion)"
else
  fail "render should omit privacy section when conclusion lacks privacy"
fi
# optional resilience absent → skip section
if ! grep -q '韧性 / 错误处理' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html skips resilience when absent (legacy conclusion)"
else
  fail "render should omit resilience section when conclusion lacks resilience"
fi
# optional rollout absent → skip section
if ! grep -q '变更与发布风险' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html skips rollout when absent (legacy conclusion)"
else
  fail "render should omit rollout section when conclusion lacks rollout"
fi
# optional performance absent → skip section
if ! grep -q '性能专项' "$RENDER_DF/REVIEW-REPORT.html"; then
  pass "render-review-html skips performance when absent (legacy conclusion)"
else
  fail "render should omit performance section when conclusion lacks performance"
fi

# HTML with complexity section present
RENDER_CX="$TMP/render-complexity"
mkdir -p "$RENDER_CX"
cp "$ROOT/evals/fixtures/conclusion/with-complexity.json" "$RENDER_CX/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_CX" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '复杂度 / 认知负担' "$RENDER_CX/REVIEW-REPORT.html"; then
  pass "render-review-html shows complexity section when present"
else
  fail "render-review-html should render complexity when conclusion has complexity"
  echo "$RO" >&2
fi
# ok design_fit companion omitted from HTML even though present in JSON
if ! grep -q 'data-zh="架构契合"' "$RENDER_CX/REVIEW-REPORT.html"; then
  pass "render-review-html omits ok design_fit when complexity-only concern"
else
  fail "render should omit ok/none dimension blocks from HTML"
fi
# with-complexity fixture has no dependencies → skip
if ! grep -q '依赖 / 供应链' "$RENDER_CX/REVIEW-REPORT.html"; then
  pass "render-review-html skips dependencies when complexity-only conclusion"
else
  fail "render should omit dependencies when conclusion lacks dependencies"
fi

# HTML with dependencies section present
RENDER_DEP="$TMP/render-dependencies"
mkdir -p "$RENDER_DEP"
cp "$ROOT/evals/fixtures/conclusion/with-dependencies.json" "$RENDER_DEP/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_DEP" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '依赖 / 供应链' "$RENDER_DEP/REVIEW-REPORT.html"; then
  pass "render-review-html shows dependencies section when present"
else
  fail "render-review-html should render dependencies when conclusion has dependencies"
  echo "$RO" >&2
fi
# ok complexity companion omitted
if ! grep -q '复杂度 / 认知负担' "$RENDER_DEP/REVIEW-REPORT.html"; then
  pass "render-review-html omits ok complexity when dependencies concern"
else
  fail "render should omit ok complexity from dependencies fixture HTML"
fi
# with-dependencies has no privacy → skip
if ! grep -q '隐私 / 合规' "$RENDER_DEP/REVIEW-REPORT.html"; then
  pass "render-review-html skips privacy when dependencies-only conclusion"
else
  fail "render should omit privacy when conclusion lacks privacy"
fi
# with-dependencies has no resilience → skip
if ! grep -q '韧性 / 错误处理' "$RENDER_DEP/REVIEW-REPORT.html"; then
  pass "render-review-html skips resilience when dependencies-only conclusion"
else
  fail "render should omit resilience when conclusion lacks resilience"
fi

# HTML with privacy section present
RENDER_PV="$TMP/render-privacy"
mkdir -p "$RENDER_PV"
cp "$ROOT/evals/fixtures/conclusion/with-privacy.json" "$RENDER_PV/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_PV" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '隐私 / 合规' "$RENDER_PV/REVIEW-REPORT.html"; then
  pass "render-review-html shows privacy section when present"
else
  fail "render-review-html should render privacy when conclusion has privacy"
  echo "$RO" >&2
fi
# none dependencies companion omitted
if ! grep -q '依赖 / 供应链' "$RENDER_PV/REVIEW-REPORT.html"; then
  pass "render-review-html omits none dependencies when privacy concern"
else
  fail "render should omit none dependencies from privacy fixture HTML"
fi
# with-privacy has no resilience → skip
if ! grep -q '韧性 / 错误处理' "$RENDER_PV/REVIEW-REPORT.html"; then
  pass "render-review-html skips resilience when privacy-only conclusion"
else
  fail "render should omit resilience when conclusion lacks resilience"
fi

# HTML with resilience section present
RENDER_RS="$TMP/render-resilience"
mkdir -p "$RENDER_RS"
cp "$ROOT/evals/fixtures/conclusion/with-resilience.json" "$RENDER_RS/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_RS" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '韧性 / 错误处理' "$RENDER_RS/REVIEW-REPORT.html"; then
  pass "render-review-html shows resilience section when present"
else
  fail "render-review-html should render resilience when conclusion has resilience"
  echo "$RO" >&2
fi
# companion ok/none dims omitted while resilience concern remains
if ! grep -q 'data-zh="架构契合"' "$RENDER_RS/REVIEW-REPORT.html" \
  && ! grep -q '隐私 / 合规' "$RENDER_RS/REVIEW-REPORT.html" \
  && ! grep -q '依赖 / 供应链' "$RENDER_RS/REVIEW-REPORT.html"; then
  pass "render-review-html omits ok/none companions in resilience fixture"
else
  fail "render should omit ok/none companion dimensions from resilience HTML"
fi
# with-resilience has no rollout → skip
if ! grep -q '变更与发布风险' "$RENDER_RS/REVIEW-REPORT.html"; then
  pass "render-review-html skips rollout when resilience-only conclusion"
else
  fail "render should omit rollout when conclusion lacks rollout"
fi

# HTML with rollout section present
RENDER_RO="$TMP/render-rollout"
mkdir -p "$RENDER_RO"
cp "$ROOT/evals/fixtures/conclusion/with-rollout.json" "$RENDER_RO/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_RO" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '变更与发布风险' "$RENDER_RO/REVIEW-REPORT.html"; then
  pass "render-review-html shows rollout section when present"
else
  fail "render-review-html should render rollout when conclusion has rollout"
  echo "$RO" >&2
fi
if ! grep -q '风险分档' "$RENDER_RO/REVIEW-REPORT.html"; then
  pass "render-review-html skips risk_tier when absent (legacy conclusion)"
else
  fail "legacy rollout HTML should not invent risk_tier section"
fi

# HTML with risk_tier section present
RENDER_RT="$TMP/render-risk-tier"
mkdir -p "$RENDER_RT"
cp "$ROOT/evals/fixtures/conclusion/with-risk-tier.json" "$RENDER_RT/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_RT" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '风险分档' "$RENDER_RT/REVIEW-REPORT.html"; then
  pass "render-review-html shows risk_tier section when present"
else
  fail "render-review-html should render risk_tier when conclusion has risk_tier"
  echo "$RO" >&2
fi

# HTML with performance section present
RENDER_PF="$TMP/render-performance"
mkdir -p "$RENDER_PF"
cp "$ROOT/evals/fixtures/conclusion/with-performance.json" "$RENDER_PF/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_PF" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && grep -q '性能专项' "$RENDER_PF/REVIEW-REPORT.html"; then
  pass "render-review-html shows performance section when present"
else
  fail "render-review-html should render performance when conclusion has performance"
  echo "$RO" >&2
fi
# with-performance has no risk_tier → skip
if ! grep -q '风险分档' "$RENDER_PF/REVIEW-REPORT.html"; then
  pass "render-review-html skips risk_tier when performance-only conclusion"
else
  fail "render should omit risk_tier when conclusion lacks risk_tier"
fi
# optional performance absent on risk-tier fixture → skip
if ! grep -q '性能专项' "$RENDER_RT/REVIEW-REPORT.html"; then
  pass "render-review-html skips performance when absent (legacy conclusion)"
else
  fail "render should omit performance section when conclusion lacks performance"
fi

# derive schema v2 fields present (backward compatible arrays)
if jq -e '.schema_version == 2
  and (.import_cross_layer|type)=="array"
  and (.dead_nested_symbols|type)=="array"
  and (.namespace_layers|type)=="array"' \
  "$DF_DIR/10-design-fit-signals.json" >/dev/null; then
  pass "derive schema_version=2 fields present"
else
  fail "derive should emit schema_version 2 optional arrays"
  jq '{schema_version,import_cross_layer,dead_nested_symbols,namespace_layers}' \
    "$DF_DIR/10-design-fit-signals.json" >&2
fi

if [[ -f "$ROOT/references/dimensions/correctness-family-checks.md" ]] \
  && grep -q 'equals' "$ROOT/references/dimensions/correctness-family-checks.md" \
  && grep -q 'hot-but-thin' "$ROOT/prompts/pr-diff-review.md"; then
  pass "correctness-family-checks + hot-but-thin must-read wired"
else
  fail "correctness-family-checks.md or prompt must-read missing"
fi

# Per-edge cross-layer correctness (caller layer vs that edge's target, not file-wide first target)
XL_DIR="$TMP/cross-layer-pack"
mkdir -p "$XL_DIR/impact/sym1"
echo '{}' >"$XL_DIR/03-change-groups.json"
cat >"$XL_DIR/04-changed-files.json" <<'EOF'
{"nodes":[{"path":"src/api/OrderController.java"},{"path":"src/dao/OrderDao.java"}]}
EOF
echo '{"nodes":[]}' >"$XL_DIR/05-changed-symbols.json"
cat >"$XL_DIR/impact/sym1/edges-in.json" <<'EOF'
{"edges":[
 {"from_path":"src/dao/OtherDao.java","from_name":"OtherDao.x","to_path":"src/api/OrderController.java"},
 {"from_path":"src/service/Caller.java","from_name":"Caller.y","to_path":"src/dao/OrderDao.java"}
]}
EOF
"$ROOT/scripts/lib/derive-design-fit.sh" --dir "$XL_DIR" --mode pr >/dev/null
if jq -e '
  (.cross_layer_edges | length) >= 2
  and any(.cross_layer_edges[]; .from_layer=="存储" and .to_layer=="入口")
  and any(.cross_layer_edges[]; .from_layer=="应用" and .to_layer=="存储")
' "$XL_DIR/10-design-fit-signals.json" >/dev/null; then
  pass "derive cross_layer uses per-edge target layers"
else
  fail "derive cross_layer should pair each caller with its own target layer"
  jq '.cross_layer_edges' "$XL_DIR/10-design-fit-signals.json" >&2
fi

# HTML render: partial/malformed fields coerced
RENDER_BAD="$TMP/render-partial"
mkdir -p "$RENDER_BAD"
cp "$ROOT/evals/fixtures/conclusion/partial-malformed.json" "$RENDER_BAD/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_BAD" 2>&1)"
REC=$?
set -e
if [[ "$REC" -eq 0 ]] && [[ -s "$RENDER_BAD/REVIEW-REPORT.html" ]]; then
  pass "render-review-html coerces partial/malformed conclusion"
else
  fail "render-review-html should tolerate partial conclusion"
  echo "$RO" >&2
fi

# HTML render: invalid JSON must fail clearly
RENDER_BROKEN="$TMP/render-broken"
mkdir -p "$RENDER_BROKEN"
echo '{not json' >"$RENDER_BROKEN/review-conclusion.json"
set +e
RO="$("$ROOT/scripts/render-review-html.sh" --dir "$RENDER_BROKEN" 2>&1)"
REC=$?
set -e
if [[ "$REC" -ne 0 ]] && echo "$RO" | grep -qi 'invalid\|JSON\|parse'; then
  pass "render-review-html rejects invalid JSON"
else
  fail "render-review-html should reject invalid JSON with clear error"
  echo "$RO" >&2
fi

# help flags (collect / render) — regression for --full / --primary-lang
if "$ROOT/scripts/collect-pr-evidence.sh" -h 2>&1 | grep -q -- '--full' \
  && "$ROOT/scripts/collect-pr-evidence.sh" -h 2>&1 | grep -q -- '--primary-lang'; then
  pass "collect-pr-evidence exposes --full and --primary-lang"
else
  fail "collect-pr-evidence help missing --full/--primary-lang"
fi

# --- create-skill compliance (structure / discoverability) ---
LINES="$(wc -l <"$ROOT/SKILL.md" | tr -d ' ')"
if [[ "$LINES" -lt 500 ]]; then
  pass "SKILL.md under 500 lines (lines=$LINES)"
else
  fail "SKILL.md exceeds 500 lines (lines=$LINES)"
fi

# No machine-specific home paths in committed skill docs
DOC_HITS="$(grep -RIn -E '/Users/|/home/[a-zA-Z]' "$ROOT" \
  --include='*.md' --include='*.yaml' --include='*.yml' --include='*.json' \
  2>/dev/null | grep -v '/evals/fixtures/' || true)"
if [[ -z "$DOC_HITS" ]]; then
  pass "no machine-specific absolute paths in skill docs"
else
  fail "machine-specific absolute paths in skill docs: $DOC_HITS"
fi

# Required create-skill section cues
for cue in '## Prerequisites' '## Quick start' '## Examples' '## Progressive disclosure'; do
  if grep -q "^${cue}$" "$ROOT/SKILL.md"; then
    pass "SKILL section present: $cue"
  else
    fail "SKILL missing section: $cue"
  fi
done

# Windows-style paths forbidden in docs (ignore CSS/regex noise in scripts)
if grep -RIn -E 'scripts\\|[A-Za-z]:\\(Users|home|Windows)' "$ROOT" \
  --include='*.md' --include='*.yaml' --include='*.yml' 2>/dev/null \
  | grep -v '/evals/fixtures/' | grep -q .; then
  fail "Windows-style paths found in docs"
else
  pass "no Windows-style paths"
fi

# One-level links from SKILL.md (no ../../)
if grep -nE '\]\(\.\./\.\./' "$ROOT/SKILL.md" >/dev/null 2>&1; then
  fail "SKILL.md has deeply nested ../../ links"
else
  pass "SKILL.md links are one-level deep"
fi

# Description length ≤ 1024 (create-skill)
DESC_LEN="$(
  SKILL_MD="$ROOT/SKILL.md" "$SCRIPT_DIR/acr-python" <<'PY'
from pathlib import Path
import os, re
text = Path(os.environ["SKILL_MD"]).read_text()
m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
fm = m.group(1)
dm = re.search(r"^description:\s*>\n((?:  .*\n)+)", fm, re.M)
if not dm:
    print(0)
else:
    desc = " ".join(line[2:].strip() for line in dm.group(1).splitlines() if line.strip())
    print(len(desc))
PY
)"
if [[ "$DESC_LEN" -gt 0 && "$DESC_LEN" -le 1024 ]]; then
  pass "description length OK ($DESC_LEN ≤ 1024)"
else
  fail "description length invalid ($DESC_LEN)"
fi

# Prerequisites must mention codexqa + jq + Python 3.10+
if grep -A20 '^## Prerequisites' "$ROOT/SKILL.md" | grep -q 'codexqa' \
  && grep -A20 '^## Prerequisites' "$ROOT/SKILL.md" | grep -q 'jq' \
  && grep -A20 '^## Prerequisites' "$ROOT/SKILL.md" | grep -Eqi 'Python 3\.10'; then
  pass "Prerequisites document codexqa + jq + Python 3.10+"
else
  fail "Prerequisites must document codexqa, jq, and Python 3.10+"
fi

echo
echo "=== Summary: PASS=$PASSES FAIL=$FAILS ==="
if [[ "$FAILS" -gt 0 ]]; then
  echo "status: invalid" >&2
  exit 1
fi
echo "status: ok"
exit 0
