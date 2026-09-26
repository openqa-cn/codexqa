#!/usr/bin/env bash
# codexqa-code-reviewer: Collect full-repo health evidence via CodexQA CLI only. No CodexQA source embedding.
# Plan focus: summary/stats/imports/high fan-in / tested_count==0 hotspots (+ tags/sensitive).
set -euo pipefail

REPO=""
OUT_DIR=""
SYMBOL_LIMIT="${SYMBOL_LIMIT:-100}"
HOTSPOT_LIMIT="${HOTSPOT_LIMIT:-30}"
IMPORT_SAMPLE="${IMPORT_SAMPLE:-12}"
IMPACT_TOP_N="${IMPACT_TOP_N:-8}"
REACH_DEPTH="${REACH_DEPTH:-3}"
PATH_ENTRY_LIMIT="${PATH_ENTRY_LIMIT:-3}"
TAG_KEY_LIMIT="${TAG_KEY_LIMIT:-5}"
SKIP_INDEX=0
SKIP_SEARCH_INDEX=0
SKIP_VALIDATE=0
IMPORT_FILE=""
PRIMARY_LANG=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/python_resolve.sh
source "$SCRIPT_DIR/lib/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"
# shellcheck source=lib/codexqa-preflight.sh
source "$SCRIPT_DIR/lib/codexqa-preflight.sh"
COMMANDS=()

usage() {
  cat <<'EOF'
Usage: collect-fullrepo-evidence.sh --repo <path|id> [--out DIR] [options]

ALL languages / polyglot monorepos MUST use this CodexQA CLI path.
Do not substitute git-diff-only, grep-only, or language-native SAST as the primary analyzer.
Primary language is auto-detected from CodexQA summary.lang_stats (override with --primary-lang).

Options:
  --repo PATH            Repository path or CodexQA repo id (required)
  --out DIR              Output directory (default: <repo>/.codexqa-review/<run-id>)
  --primary-lang LANG    Override detected primary language (e.g. Go, Java, TypeScript)
  --symbol-limit N       Max symbols to fetch (default: 100)
  --hotspot-limit N      Max untested hotspots to keep (default: 30)
  --import-sample N      Auto-sample N files for imports (default: 12; 0 to disable)
  --import-file PATH     Extra relative file for imports (in addition to samples)
  --impact-top-n N       Max hotspot symbols for blast-radius impact/ (default: 8)
  --reach-depth N        reach --depth for impact (default: 3)
  --path-entry-limit N   Max entry candidates per symbol for path (default: 3)
  --tag-key-limit N      Max tag keys to expand via tagged (default: 5)
  --skip-index           Skip codexqa index (reuse existing CodexQA index only)
  --skip-search-index    Skip search-index / sensitive search
  --skip-validate        Do not run validate-evidence.sh at end
  -h, --help             Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --symbol-limit) SYMBOL_LIMIT="${2:-}"; shift 2 ;;
    --hotspot-limit) HOTSPOT_LIMIT="${2:-}"; shift 2 ;;
    --import-sample) IMPORT_SAMPLE="${2:-}"; shift 2 ;;
    --import-file) IMPORT_FILE="${2:-}"; shift 2 ;;
    --impact-top-n) IMPACT_TOP_N="${2:-}"; shift 2 ;;
    --reach-depth) REACH_DEPTH="${2:-}"; shift 2 ;;
    --path-entry-limit) PATH_ENTRY_LIMIT="${2:-}"; shift 2 ;;
    --primary-lang) PRIMARY_LANG="${2:-}"; shift 2 ;;
    --tag-key-limit) TAG_KEY_LIMIT="${2:-}"; shift 2 ;;
    --skip-index) SKIP_INDEX=1; shift ;;
    --skip-search-index) SKIP_SEARCH_INDEX=1; shift ;;
    --skip-validate) SKIP_VALIDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "error: --repo is required" >&2
  usage
  exit 2
fi

codexqa_require_cli
REPO_ABS="$(codexqa_resolve_repo "$REPO")"

RUN_ID="$(date +%Y%m%d_%H%M%S)_$$"
if [[ -z "$OUT_DIR" ]]; then
  if [[ -d "$REPO_ABS" ]]; then
    OUT_DIR="$REPO_ABS/.codexqa-review/$RUN_ID"
  else
    OUT_DIR="${TMPDIR:-/tmp}/codexqa-review/$RUN_ID"
  fi
fi

mkdir -p "$OUT_DIR/imports" "$OUT_DIR/entries/tagged"
LOG="$OUT_DIR/commands.log"
touch "$LOG"
# shellcheck source=lib/collect-trace.sh
source "$SCRIPT_DIR/lib/collect-trace.sh"

query_imports_for_file() {
  local fpath="$1"
  [[ -z "$fpath" ]] && return 0
  local safe
  safe="$(echo "$fpath" | tr -c 'A-Za-z0-9._-' '_')"
  run_json "$OUT_DIR/imports/${safe}-in.json" \
    codexqa query --repo "$REPO_ABS" imports --file "$fpath" --direction in
  run_json "$OUT_DIR/imports/${safe}-out.json" \
    codexqa query --repo "$REPO_ABS" imports --file "$fpath" --direction out
  # CodexQA Java/Kotlin imports often empty — on-disk package/import fallback (0 extra CodexQA)
  local thin_in thin_out
  thin_in=0
  thin_out=0
  if jq -e '
      (.error == true)
      or ((.imports // .result.imports // .edges // .result.edges // .items // .result.items // []) | length) == 0
    ' "$OUT_DIR/imports/${safe}-in.json" >/dev/null 2>&1; then
    thin_in=1
  fi
  if jq -e '
      (.error == true)
      or ((.imports // .result.imports // .edges // .result.edges // .items // .result.items // []) | length) == 0
    ' "$OUT_DIR/imports/${safe}-out.json" >/dev/null 2>&1; then
    thin_out=1
  fi
  if [[ "$thin_in" -eq 1 && "$thin_out" -eq 1 && -f "$REPO_ABS/$fpath" ]] && { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; }; then
    "$SCRIPT_DIR/acr-python" - "$REPO_ABS/$fpath" "$fpath" "$OUT_DIR/imports/${safe}-ondisk.json" <<'PY'
import json, re, sys
from pathlib import Path
abs_p, rel, out = sys.argv[1:4]
text = Path(abs_p).read_text(encoding="utf-8", errors="ignore")[:80000]
pkgs = re.findall(r"(?m)^\s*package\s+([\w.]+)\s*;?", text)
imps = []
for m in re.finditer(
    r"(?m)^\s*(?:import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;"
    r"|import\s+\"([^\"]+)\""
    r"|from\s+['\"]([^'\"]+)['\"]"
    r"|import\s+['\"]([^'\"]+)['\"])",
    text,
):
    for g in m.groups():
        if g:
            imps.append(g)
            break
Path(out).write_text(
    json.dumps(
        {
            "kind": "OnDiskImports",
            "file": rel,
            "packages": pkgs[:5],
            "imports": imps[:80],
            "note": "CodexQA imports empty/error — local package/import extract for Design-fit layers",
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)
PY
  fi
}

CODEXQA_VERSION="$(codexqa_version_string)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$SKIP_INDEX" -eq 0 ]]; then
  run codexqa index "$REPO_ABS"
else
  collect_trace "(skipped) codexqa index"
  COMMANDS+=("(skipped) codexqa index")
  codexqa_require_existing_index "$REPO_ABS"
fi

run_json "$OUT_DIR/01-stats.json" codexqa stats "$REPO_ABS" --format json
run_json "$OUT_DIR/02-summary.json" codexqa query --repo "$REPO_ABS" summary
run_json "$OUT_DIR/03-files-sample.json" codexqa query --repo "$REPO_ABS" files --limit 200
run_json "$OUT_DIR/04-hot-symbols.json" \
  codexqa query --repo "$REPO_ABS" symbols --kind function,method --limit "$SYMBOL_LIMIT"

collect_trace "detect primary language from CodexQA summary/lang_stats"
COMMANDS+=("codexqa_detect_language_profile 02-summary.json")
codexqa_detect_language_profile \
  "$OUT_DIR/02-summary.json" \
  "" \
  "$PRIMARY_LANG" >"$OUT_DIR/09-language-profile.json"

# Candidate pool: from_count is NOT fan-in on current CodexQA (closer to out-edges).
# Prefer edges-in length after impact/ collection below.
jq --argjson lim "$((HOTSPOT_LIMIT * 2))" '
  (.nodes // .result.nodes // []) as $n
  | [
      $n[]
      | select((.tested_count // 0) == 0)
      | .
    ]
  | sort_by(-(.from_count // 0))
  | .[0:$lim]
  | {kind:"UntestedHotspots", nodes: ., note:"Candidate pool sorted by from_count (NOT fan-in; re-ranked by edges-in after impact/)."}
' "$OUT_DIR/04-hot-symbols.json" >"$OUT_DIR/05-untested-hotspots.json"

# Blast-radius for top untested hotspots (prompts/templates require impact/*)
mkdir -p "$OUT_DIR/impact"
HOTSPOT_IDS=()
codexqa_read_lines HOTSPOT_IDS < <(
  jq -r '
    (.nodes // .result.nodes // [])[]
    | (.id // empty)
  ' "$OUT_DIR/05-untested-hotspots.json" 2>/dev/null | awk 'NF' | head -n "$IMPACT_TOP_N"
)

SELECTED_JSON='[]'
for id in "${HOTSPOT_IDS[@]+"${HOTSPOT_IDS[@]}"}"; do
  [[ -z "$id" ]] && continue
  safe="$(echo "$id" | tr -c 'A-Za-z0-9._-' '_')"
  mkdir -p "$OUT_DIR/impact/$safe/paths"
  run_json "$OUT_DIR/impact/$safe/edges-in.json" \
    codexqa query --repo "$REPO_ABS" edges --id "$id" --direction in
  run_json "$OUT_DIR/impact/$safe/reach-in.json" \
    codexqa query --repo "$REPO_ABS" reach --id "$id" --direction in --depth "$REACH_DEPTH"
  run_json "$OUT_DIR/impact/$safe/tests-reach.json" \
    codexqa query --repo "$REPO_ABS" reach --id "$id" --edge-kinds tests

  ENTRY_IDS=()
  codexqa_read_lines ENTRY_IDS < <(
    jq -r '
      (.result.hops // .hops // []) | add // []
      | .[]
      | select((.from_count // 1) == 0)
      | .id
    ' "$OUT_DIR/impact/$safe/reach-in.json" 2>/dev/null | awk 'NF' | head -n "$PATH_ENTRY_LIMIT"
  )

  PATHS_META='[]'
  for eid in "${ENTRY_IDS[@]+"${ENTRY_IDS[@]}"}"; do
    [[ -z "$eid" || "$eid" == "$id" ]] && continue
    esafe="$(echo "$eid" | tr -c 'A-Za-z0-9._-' '_')"
    pout="$OUT_DIR/impact/$safe/paths/from-${esafe}.json"
    run_json "$pout" \
      codexqa query --repo "$REPO_ABS" path --from "$eid" --to "$id" --depth 10
    PATHS_META="$(jq --arg from "$eid" --arg file "impact/$safe/paths/from-${esafe}.json" \
      '. + [{from:$from, to:"'"$id"'", file:$file}]' <<<"$PATHS_META")"
  done
  echo "$PATHS_META" >"$OUT_DIR/impact/$safe/paths/index.json"

  EIN_COUNT="$(jq '
    ((.edges // .result.edges // .result.items // .items // []) | length)
  ' "$OUT_DIR/impact/$safe/edges-in.json" 2>/dev/null || echo 0)"

  SELECTED_JSON="$(jq --arg id "$id" --arg safe "$safe" --argjson paths "$PATHS_META" --argjson ein "${EIN_COUNT:-0}" \
    '. + [{id:$id, dir:$safe, edges_in_count:$ein, paths:$paths}]' <<<"$SELECTED_JSON")"
done
echo "$SELECTED_JSON" >"$OUT_DIR/impact/index.json"

if [[ -f "$SCRIPT_DIR/lib/collect-unit-calls.sh" ]]; then
  bash "$SCRIPT_DIR/lib/collect-unit-calls.sh" --repo "$REPO_ABS" --dir "$OUT_DIR" >>"$LOG" 2>&1 \
    || echo "warn: unit calls failed" >&2
fi

# Re-rank hotspots by edges_in_count (true-ish fan-in), then from_count as tie-break only
jq --argjson lim "$HOTSPOT_LIMIT" --slurpfile idx "$OUT_DIR/impact/index.json" '
  ($idx[0] // []) as $ix
  | ($ix | map({key: .id, value: (.edges_in_count // 0)}) | from_entries) as $emap
  | .nodes as $nodes
  | [
      $nodes[]
      | . as $n
      | $n + {
          edges_in_count: ($emap[$n.id // ""] // null),
          fan_in_basis: (if ($emap[$n.id // ""] != null) then "edges_in" else "from_count_ambiguous" end),
          from_count_note: "from_count is NOT fan-in on current CodexQA (closer to out-degree); prefer edges_in_count"
        }
    ]
  | sort_by(-(.edges_in_count // -1), -(.from_count // 0))
  | .[0:$lim]
  | {
      kind: "UntestedHotspots",
      nodes: .,
      note: "Ranked by edges_in_count when impact/ present; from_count is sort tie-break only (NOT fan-in)."
    }
' "$OUT_DIR/05-untested-hotspots.json" >"$OUT_DIR/05-untested-hotspots.json.tmp"
mv "$OUT_DIR/05-untested-hotspots.json.tmp" "$OUT_DIR/05-untested-hotspots.json"

if [[ "$SKIP_SEARCH_INDEX" -eq 0 ]]; then
  collect_trace "codexqa search-index $REPO_ABS (best-effort)"
  COMMANDS+=("codexqa search-index $REPO_ABS")
  if codexqa search-index "$REPO_ABS" >>"$LOG" 2>&1; then
    run_json "$OUT_DIR/06-sensitive-hits.json" \
      codexqa query --repo "$REPO_ABS" search --query "password OR secret OR token OR api_key OR auth OR pay"
  else
    echo '{"kind":"Bm25Search","results":[],"note":"search-index unavailable or failed"}' >"$OUT_DIR/06-sensitive-hits.json"
  fi
else
  echo '{"kind":"Bm25Search","results":[],"note":"search skipped"}' >"$OUT_DIR/06-sensitive-hits.json"
fi

collect_trace "codexqa tag keys (best-effort)"
COMMANDS+=("codexqa tag $REPO_ABS keys --json")
TAG_KEYS_RAW="$OUT_DIR/.tag-keys-raw.json"
if codexqa tag "$REPO_ABS" keys --json >"$TAG_KEYS_RAW" 2>>"$LOG"; then
  :
else
  echo '{"keys":[],"note":"tag keys unavailable"}' >"$TAG_KEYS_RAW"
fi

TAG_KEYS=()
codexqa_read_lines TAG_KEYS < <(
  jq -r '
    if type=="array" then .[].key // .[] // empty
    elif .keys then (.keys[] | (if type=="object" then .key else . end))
    elif .result.keys then (.result.keys[] | (if type=="object" then .key else . end))
    else empty end
  ' "$TAG_KEYS_RAW" 2>/dev/null | awk 'NF' | head -n "$TAG_KEY_LIMIT"
)

TAGGED_INDEX='[]'
for key in "${TAG_KEYS[@]+"${TAG_KEYS[@]}"}"; do
  [[ -z "$key" ]] && continue
  safe_key="$(echo "$key" | tr -c 'A-Za-z0-9._-' '_')"
  out="$OUT_DIR/entries/tagged/${safe_key}.json"
  run_json "$out" codexqa query --repo "$REPO_ABS" tagged --key "$key" --limit 50
  TAGGED_INDEX="$(jq --arg k "$key" --arg f "entries/tagged/${safe_key}.json" '. + [{key:$k, file:$f}]' <<<"$TAGGED_INDEX")"
done

jq -n \
  --slurpfile keys "$TAG_KEYS_RAW" \
  --argjson tagged "$TAGGED_INDEX" \
  '{kind:"TagsPack", keys: $keys[0], tagged: $tagged, note:"Entry roles from tag keys + tagged; skip inventing when empty."}' \
  >"$OUT_DIR/07-tags.json"
cp "$OUT_DIR/07-tags.json" "$OUT_DIR/07-tag-keys.json"

# Auto-sample imports from files list (plan: imports as full-repo focus)
IMPORTS_LIST='[]'
if [[ "$IMPORT_SAMPLE" -gt 0 ]]; then
  SAMPLE_FILES=()
  codexqa_read_lines SAMPLE_FILES < <(
    jq -r '
      (.files // .nodes // .result.files // .result.nodes // [])[]
      | (.path // .file_path // .file // empty)
    ' "$OUT_DIR/03-files-sample.json" 2>/dev/null \
      | awk 'NF && $0 !~ /(^|\/)(test|tests|__tests__|spec)(\/|$)/ && $0 !~ /\.(test|spec)\./' \
      | head -n "$IMPORT_SAMPLE"
  )
  for fpath in "${SAMPLE_FILES[@]+"${SAMPLE_FILES[@]}"}"; do
    [[ -z "$fpath" ]] && continue
    query_imports_for_file "$fpath"
    IMPORTS_LIST="$(jq --arg f "$fpath" '. + [$f]' <<<"$IMPORTS_LIST")"
  done
fi

if [[ -n "$IMPORT_FILE" ]]; then
  query_imports_for_file "$IMPORT_FILE"
  IMPORTS_LIST="$(jq --arg f "$IMPORT_FILE" '. + [$f]' <<<"$IMPORTS_LIST")"
fi
echo "$IMPORTS_LIST" >"$OUT_DIR/imports/index.json"

# Design fit signals (pure jq; 0 extra codexqa). WARN-only on failure.
if [[ -x "$SCRIPT_DIR/lib/derive-design-fit.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-design-fit.sh" --dir "$OUT_DIR" --mode full >>"$LOG" 2>&1; then
    echo "warn: derive-design-fit.sh failed; continuing without 10-design-fit-signals.json" >&2
  fi
else
  echo "warn: derive-design-fit.sh missing; Design fit signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-complexity.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-complexity.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-complexity.sh failed; continuing without 11-complexity-signals.json" >&2
  fi
else
  echo "warn: derive-complexity.sh missing; Complexity signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-dependencies.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-dependencies.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-dependencies.sh failed; continuing without 12-dependency-signals.json" >&2
  fi
else
  echo "warn: derive-dependencies.sh missing; Dependencies signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-privacy.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-privacy.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-privacy.sh failed; continuing without 13-privacy-signals.json" >&2
  fi
else
  echo "warn: derive-privacy.sh missing; Privacy signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-resilience.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-resilience.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-resilience.sh failed; continuing without 14-resilience-signals.json" >&2
  fi
else
  echo "warn: derive-resilience.sh missing; Resilience signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-rollout.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-rollout.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-rollout.sh failed; continuing without 15-rollout-signals.json" >&2
  fi
else
  echo "warn: derive-rollout.sh missing; Rollout signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-risk-tier.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-risk-tier.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-risk-tier.sh failed; continuing without 20-risk-tier.json" >&2
  fi
else
  echo "warn: derive-risk-tier.sh missing; Risk tier skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-observability.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-observability.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-observability.sh failed; continuing without 16-observability-signals.json" >&2
  fi
else
  echo "warn: derive-observability.sh missing; Observability signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-contract.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-contract.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-contract.sh failed; continuing without 17-contract-signals.json" >&2
  fi
else
  echo "warn: derive-contract.sh missing; Contract signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-maintainability.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-maintainability.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-maintainability.sh failed; continuing without 18-maintainability-signals.json" >&2
  fi
else
  echo "warn: derive-maintainability.sh missing; Maintainability signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-performance.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-performance.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-performance.sh failed; continuing without 21-performance-signals.json" >&2
  fi
else
  echo "warn: derive-performance.sh missing; Performance signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-sast.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-sast.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-sast.sh failed; continuing without 23-sast-signals.json" >&2
  fi
else
  echo "warn: derive-sast.sh missing; SAST signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-annotation-edges.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-annotation-edges.sh" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: derive-annotation-edges.sh failed; continuing without 19-annotation-edges.json" >&2
  fi
else
  echo "warn: derive-annotation-edges.sh missing; annotation edges skipped" >&2
fi

# Coverage ledger: hits annotate symbols and do not dequeue them. No extra CodexQA.
if [[ -f "$SCRIPT_DIR/lib/build-coverage-ledger.py" ]]; then
  if [[ -x "$SCRIPT_DIR/acr-python" ]]; then
    LEDGER_PY=("$SCRIPT_DIR/acr-python")
  else
    LEDGER_PY=(python3)
  fi
  if ! "${LEDGER_PY[@]}" "$SCRIPT_DIR/lib/build-coverage-ledger.py" --dir "$OUT_DIR" --mode full --repo "$REPO_ABS" >>"$LOG" 2>&1; then
    echo "warn: build-coverage-ledger.py failed; continuing without 24-coverage-ledger.json" >&2
  fi
else
  echo "warn: build-coverage-ledger.py missing; coverage ledger skipped" >&2
fi

INDEX_QUALITY="$(codexqa_index_quality_from_stats "$OUT_DIR/01-stats.json")"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMANDS_JSON="$(printf '%s\n' "${COMMANDS[@]}" | jq -R . | jq -s .)"

jq -n \
  --arg mode "full" \
  --arg run_id "$RUN_ID" \
  --arg repo "$REPO_ABS" \
  --arg out_dir "$OUT_DIR" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$FINISHED_AT" \
  --arg codexqa_version "$CODEXQA_VERSION" \
  --argjson symbol_limit "$SYMBOL_LIMIT" \
  --argjson import_files "$IMPORTS_LIST" \
  --argjson commands "$COMMANDS_JSON" \
  --argjson index_quality "$INDEX_QUALITY" \
  --argjson lang_stats "$(jq '.lang_stats // .result.lang_stats // {}' "$OUT_DIR/02-summary.json" 2>/dev/null || echo '{}')" \
  --argjson language_profile "$(cat "$OUT_DIR/09-language-profile.json")" \
  '{
    mode: $mode,
    engine: "codexqa",
    analysis_backend: "codexqa-cli",
    polyglot_mandate: true,
    skill: "codexqa-code-reviewer",
    run_id: $run_id,
    repo: $repo,
    diff_base: null,
    out_dir: $out_dir,
    started_at: $started_at,
    finished_at: $finished_at,
    codexqa_version: $codexqa_version,
    lang_stats: $lang_stats,
    language_profile: $language_profile,
    primary_language: $language_profile.primary_language,
    review_language_focus: $language_profile.review_language_focus,
    is_polyglot: $language_profile.is_polyglot,
    symbol_limit: $symbol_limit,
    import_files: $import_files,
    commands: $commands,
    index_quality: $index_quality,
    artifacts: [
      "manifest.json",
      "01-stats.json",
      "02-summary.json",
      "03-files-sample.json",
      "04-hot-symbols.json",
      "05-untested-hotspots.json",
      "06-sensitive-hits.json",
      "07-tags.json",
      "09-language-profile.json",
      "10-design-fit-signals.json",
      "11-complexity-signals.json",
      "12-dependency-signals.json",
      "13-privacy-signals.json",
      "14-resilience-signals.json",
      "15-rollout-signals.json",
      "16-observability-signals.json",
      "17-contract-signals.json",
      "18-maintainability-signals.json",
      "19-annotation-edges.json",
      "20-risk-tier.json",
      "21-performance-signals.json",
      "24-coverage-ledger.json",
      "commands.log",
      "imports/",
      "entries/",
      "impact/"
    ],
    notes: [
      "ALL languages must be analyzed via CodexQA CLI; this pack is the only primary evidence source.",
      "primary_language / review_language_focus come from 09-language-profile.json (CodexQA lang_stats).",
      "Full-repo mode: do not invent PR change analysis without a diff index.",
      "Architecture layers must use real symbols/files from this pack.",
      "Blast radius: impact/<id>/{edges-in,reach-in,tests-reach} for top untested hotspots (IMPACT_TOP_N).",
      "from_count is NOT fan-in — prefer edges_in_count / edges-in callers when ranking hotspots.",
      "Design fit: 10-design-fit-signals.json + imports/ (+ on-disk import fallback); see references/dimensions/design-fit.md.",
      "Complexity: 11-complexity-signals.json; see references/dimensions/complexity.md.",
      "Dependencies: 12-dependency-signals.json; see references/dimensions/dependencies.md.",
      "Privacy: 13-privacy-signals.json; see references/dimensions/privacy.md.",
      "Resilience: 14-resilience-signals.json (includes exception_unwraps hard gate; resource_leaks is RES-001, including close_not_in_finally; charset_gaps, null_deref_gaps, authz_audit_gaps are per-row hard gates); see references/dimensions/resilience.md.",
      "Change/rollout: 15-rollout-signals.json; see references/dimensions/rollout.md.",
      "Risk tier: 20-risk-tier.json (T0–T3); see references/dimensions/risk-tier.md.",
      "Observability: 16-observability-signals.json; see references/dimensions/observability.md.",
      "Contract: 17-contract-signals.json; see references/dimensions/contract.md.",
      "Maintainability: 18-maintainability-signals.json; see references/dimensions/maintainability.md.",
      "Performance: 21-performance-signals.json; weak_perf_tests is a test_gaps hard gate. unpooled_connections is a hard gate and does not change signals_thin. env_config_gaps and uncontrolled_log_sinks are hard gates on rollout and observability. magic_numbers and unused_accumulators are maintainability hard gates.",
      "Annotation callbacks: 19-annotation-edges.json when present (Spring/Resilience4j synthetic callers).",
      "Lower confidence when stats show high stubs/collisions.",
      "Entry concentration: use 07-tags.json tagged samples when present."
    ]
  }' >"$OUT_DIR/manifest.json"
collect_write_conclusion_stub

PRIMARY_DETECTED="$(jq -r '.primary_language // "UNKNOWN"' "$OUT_DIR/09-language-profile.json")"
echo "Primary language: $PRIMARY_DETECTED (see 09-language-profile.json)"
echo "Evidence pack written: $OUT_DIR"

if [[ "$SKIP_VALIDATE" -eq 0 ]]; then
  if [[ -x "$SCRIPT_DIR/validate-evidence.sh" ]]; then
    "$SCRIPT_DIR/validate-evidence.sh" --dir "$OUT_DIR" --mode full
  else
    echo "warn: validate-evidence.sh not executable; skip auto-validate" >&2
  fi
else
  echo "Next: validate-evidence.sh --dir \"$OUT_DIR\" --mode full"
fi
