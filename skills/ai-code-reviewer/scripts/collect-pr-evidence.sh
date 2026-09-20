#!/usr/bin/env bash
# ai-code-reviewer: Collect PR/diff evidence via CodexQA CLI only. No CodexQA source embedding.
# Implements plan: index --diff-base → change-groups → symbol-diff → edges/reach/path/tests
#                  + sensitive search + tag keys/tagged + hot-but-thin + manifest quality.
set -euo pipefail

REPO=""
DIFF_BASE=""
OUT_DIR=""
TOP_N="${TOP_N:-8}"
REACH_DEPTH="${REACH_DEPTH:-3}"
MAX_DIFF_LINES="${MAX_DIFF_LINES:-200}"
TAG_KEY_LIMIT="${TAG_KEY_LIMIT:-5}"
PATH_ENTRY_LIMIT="${PATH_ENTRY_LIMIT:-3}"
SKIP_INDEX=0
SKIP_SEARCH_INDEX=0
SKIP_VALIDATE=0
FORCE_FULL=0
PRIMARY_LANG=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/codexqa-preflight.sh
source "$SCRIPT_DIR/lib/codexqa-preflight.sh"
COMMANDS=()

usage() {
  cat <<'EOF'
Usage: collect-pr-evidence.sh --repo <path|id> --diff-base <ref> [--out DIR] [options]

ALL languages / polyglot monorepos MUST use this CodexQA CLI path.
Do not substitute git-diff-only, grep-only, or language-native SAST as the primary analyzer.
Primary language is auto-detected from CodexQA summary.lang_stats (override with --primary-lang).

Options:
  --repo PATH          Repository path or CodexQA repo id (required)
  --diff-base REF      Git ref for diff index, e.g. origin/main (required)
  --out DIR            Output directory (default: <repo>/.codexqa-review/<run-id>)
  --primary-lang LANG  Override detected primary language (e.g. Go, Java, TypeScript)
  --top-n N            Max changed symbols for deep impact (default: 8)
  --reach-depth N      reach --depth (default: 3)
  --max-diff-lines N   symbol-diff --max-lines (default: 200)
  --tag-key-limit N    Max tag keys to expand via tagged (default: 5)
  --path-entry-limit N Max entry candidates per symbol for path (default: 3)
  --skip-index         Skip codexqa index (reuse existing CodexQA diff index only)
  --full               Pass --full to codexqa index (force full reparse + diff-base tags)
  --skip-search-index  Do not run search-index / sensitive search
  --skip-validate      Do not run validate-evidence.sh at end
  -h, --help           Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --diff-base) DIFF_BASE="${2:-}"; shift 2 ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --top-n) TOP_N="${2:-}"; shift 2 ;;
    --reach-depth) REACH_DEPTH="${2:-}"; shift 2 ;;
    --max-diff-lines) MAX_DIFF_LINES="${2:-}"; shift 2 ;;
    --tag-key-limit) TAG_KEY_LIMIT="${2:-}"; shift 2 ;;
    --path-entry-limit) PATH_ENTRY_LIMIT="${2:-}"; shift 2 ;;
    --primary-lang) PRIMARY_LANG="${2:-}"; shift 2 ;;
    --skip-index) SKIP_INDEX=1; shift ;;
    --full) FORCE_FULL=1; shift ;;
    --skip-search-index) SKIP_SEARCH_INDEX=1; shift ;;
    --skip-validate) SKIP_VALIDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$REPO" || -z "$DIFF_BASE" ]]; then
  echo "error: --repo and --diff-base are required" >&2
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

mkdir -p "$OUT_DIR"/{diffs,impact,entries}
LOG="$OUT_DIR/commands.log"
touch "$LOG"

run() {
  echo "+ $*" | tee -a "$LOG"
  COMMANDS+=("$*")
  "$@"
}

run_json() {
  local out="$1"; shift
  echo "+ $* > $out" | tee -a "$LOG"
  COMMANDS+=("$* > $out")
  if "$@" >"$out" 2>"$OUT_DIR/.last_err"; then
    return 0
  fi
  {
    echo "{\"error\":true,\"command\":\"$*\",\"stderr\":$(jq -Rs . <"$OUT_DIR/.last_err")}"
  } >"$out"
  echo "warn: command failed, wrote error stub to $out" | tee -a "$LOG" >&2
  return 0
}

CODEXQA_VERSION="$(codexqa_version_string)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$SKIP_INDEX" -eq 0 ]]; then
  if [[ "$FORCE_FULL" -eq 1 ]]; then
    run codexqa index "$REPO_ABS" --full --diff-base "$DIFF_BASE"
  else
    run codexqa index "$REPO_ABS" --diff-base "$DIFF_BASE"
  fi
else
  echo "+ (skipped) codexqa index --diff-base $DIFF_BASE" | tee -a "$LOG"
  COMMANDS+=("(skipped) codexqa index --diff-base $DIFF_BASE")
  codexqa_require_existing_index "$REPO_ABS"
fi

run_json "$OUT_DIR/01-stats.json" codexqa stats "$REPO_ABS" --format json
run_json "$OUT_DIR/02-summary.json" codexqa query --repo "$REPO_ABS" summary
run_json "$OUT_DIR/03-change-groups.json" codexqa query --repo "$REPO_ABS" change-groups
run_json "$OUT_DIR/04-changed-files.json" codexqa query --repo "$REPO_ABS" files --change add,change
run_json "$OUT_DIR/05-changed-symbols.json" codexqa query --repo "$REPO_ABS" symbols --change add,change --kind function,method

# Primary language profile (CodexQA lang_stats + changed-file languages)
echo "+ detect primary language from CodexQA summary/lang_stats" | tee -a "$LOG"
COMMANDS+=("codexqa_detect_language_profile 02-summary.json 04-changed-files.json")
codexqa_detect_language_profile \
  "$OUT_DIR/02-summary.json" \
  "$OUT_DIR/04-changed-files.json" \
  "$PRIMARY_LANG" >"$OUT_DIR/09-language-profile.json"

# Hot-but-thin among changed symbols (high from_count + tested_count==0)
jq '
  (.nodes // .result.nodes // []) as $n
  | [
      $n[]
      | select((.tested_count // 0) == 0)
      | .
    ]
  | sort_by(-(.from_count // 0))
  | {kind:"HotButThinChanged", nodes: ., note:"Changed production symbols with tested_count==0; from_count is NOT fan-in (re-ranked by edges_in_count after impact/)."}
' "$OUT_DIR/05-changed-symbols.json" >"$OUT_DIR/08-hot-but-thin.json"

# Sensitive search + symbols --name (plan: search / symbols --name + callers)
SENSITIVE_NAMES=(password secret token auth pay)
if [[ "$SKIP_SEARCH_INDEX" -eq 0 ]]; then
  echo "+ codexqa search-index $REPO_ABS (best-effort)" | tee -a "$LOG"
  COMMANDS+=("codexqa search-index $REPO_ABS")
  if codexqa search-index "$REPO_ABS" >>"$LOG" 2>&1; then
    run_json "$OUT_DIR/06-sensitive-search.json" \
      codexqa query --repo "$REPO_ABS" search --query "password OR secret OR token OR api_key OR auth OR pay"
  else
    echo '{"kind":"Bm25Search","results":[],"note":"search-index unavailable or failed"}' >"$OUT_DIR/06-sensitive-search.json"
  fi
else
  echo '{"kind":"Bm25Search","results":[],"note":"search skipped"}' >"$OUT_DIR/06-sensitive-search.json"
fi

mkdir -p "$OUT_DIR/06-sensitive-symbols"
SENS_SYM_INDEX='[]'
for n in "${SENSITIVE_NAMES[@]}"; do
  out="$OUT_DIR/06-sensitive-symbols/${n}.json"
  run_json "$out" \
    codexqa query --repo "$REPO_ABS" symbols --name "$n" --kind function,method --limit 30
  # Expand callers for top hit ids (plan: + 调用方展开)
  SIDS=()
  codexqa_read_lines SIDS < <(jq -r '(.nodes // .result.nodes // [])[:3][] | .id // empty' "$out" 2>/dev/null | awk 'NF')
  for sid in "${SIDS[@]+"${SIDS[@]}"}"; do
    [[ -z "$sid" ]] && continue
    ssafe="$(echo "$sid" | tr -c 'A-Za-z0-9._-' '_')"
    run_json "$OUT_DIR/06-sensitive-symbols/${n}-edges-in-${ssafe}.json" \
      codexqa query --repo "$REPO_ABS" edges --id "$sid" --direction in
  done
  SENS_SYM_INDEX="$(jq --arg n "$n" --arg f "06-sensitive-symbols/${n}.json" '. + [{name:$n, file:$f}]' <<<"$SENS_SYM_INDEX")"
done

jq -n \
  --slurpfile search "$OUT_DIR/06-sensitive-search.json" \
  --argjson symbols "$SENS_SYM_INDEX" \
  '{kind:"SensitivePack", search:$search[0], symbol_name_queries:$symbols, note:"Escalate hits intersecting changed symbols; use edges-in files for callers."}' \
  >"$OUT_DIR/06-sensitive-hits.json"

# Tags: keys + tagged samples → 07-tags.json (plan naming)
echo "+ codexqa tag keys (best-effort)" | tee -a "$LOG"
COMMANDS+=("codexqa tag $REPO_ABS keys --json")
TAG_KEYS_RAW="$OUT_DIR/.tag-keys-raw.json"
if codexqa tag "$REPO_ABS" keys --json >"$TAG_KEYS_RAW" 2>>"$LOG"; then
  :
else
  echo '{"keys":[],"note":"tag keys unavailable"}' >"$TAG_KEYS_RAW"
fi

TAGGED_DIR="$OUT_DIR/entries/tagged"
mkdir -p "$TAGGED_DIR"
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
  out="$TAGGED_DIR/${safe_key}.json"
  run_json "$out" codexqa query --repo "$REPO_ABS" tagged --key "$key" --limit 50
  TAGGED_INDEX="$(jq --arg k "$key" --arg f "entries/tagged/${safe_key}.json" '. + [{key:$k, file:$f}]' <<<"$TAGGED_INDEX")"
done

jq -n \
  --slurpfile keys "$TAG_KEYS_RAW" \
  --argjson tagged "$TAGGED_INDEX" \
  '{kind:"TagsPack", keys: $keys[0], tagged: $tagged, note:"Entry roles from tag keys + tagged queries; do not invent entries when empty."}' \
  >"$OUT_DIR/07-tags.json"
# Keep alias for older docs/prompts
cp "$OUT_DIR/07-tags.json" "$OUT_DIR/07-tag-keys.json"

# Select top symbol ids: prefer change-groups order, else changed-symbols
SYMBOL_IDS=()
codexqa_read_lines SYMBOL_IDS < <(
  jq -r '
    if .result.groups then
      [.result.groups[].symbols[]?.id // .result.groups[].symbols[]?.node_id // empty] | .[]
    elif .groups then
      [.groups[].symbols[]?.id // .groups[].symbols[]?.node_id // empty] | .[]
    else empty end
  ' "$OUT_DIR/03-change-groups.json" 2>/dev/null | awk 'NF' | head -n "$TOP_N"
)

if [[ ${#SYMBOL_IDS[@]} -eq 0 ]]; then
  SYMBOL_IDS=()
  codexqa_read_lines SYMBOL_IDS < <(
    jq -r '
      (.nodes // .result.nodes // [])[]
      | (.id // empty)
    ' "$OUT_DIR/05-changed-symbols.json" 2>/dev/null | awk 'NF' | head -n "$TOP_N"
  )
fi

SELECTED_JSON='[]'
for id in "${SYMBOL_IDS[@]+"${SYMBOL_IDS[@]}"}"; do
  [[ -z "$id" ]] && continue
  safe="$(echo "$id" | tr -c 'A-Za-z0-9._-' '_')"
  # Plan naming: diffs/<id>.diff.json
  run_json "$OUT_DIR/diffs/${safe}.diff.json" \
    codexqa query --repo "$REPO_ABS" symbol-diff --id "$id" --max-lines "$MAX_DIFF_LINES"
  mkdir -p "$OUT_DIR/impact/$safe/paths"
  run_json "$OUT_DIR/impact/$safe/edges-in.json" \
    codexqa query --repo "$REPO_ABS" edges --id "$id" --direction in
  run_json "$OUT_DIR/impact/$safe/reach-in.json" \
    codexqa query --repo "$REPO_ABS" reach --id "$id" --direction in --depth "$REACH_DEPTH"
  run_json "$OUT_DIR/impact/$safe/tests-reach.json" \
    codexqa query --repo "$REPO_ABS" reach --id "$id" --edge-kinds tests

  # Entry candidates: nodes with from_count==0 on reach-in hops (plan: reach to from_count==0)
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

  SELECTED_JSON="$(jq --arg id "$id" --arg safe "$safe" --argjson paths "$PATHS_META" \
    '. + [{id:$id, dir:$safe, diff:("diffs/"+$safe+".diff.json"), paths:$paths}]' <<<"$SELECTED_JSON")"
done

# Re-rank hot-but-thin by edges_in_count (fan-in), not from_count
if [[ -d "$OUT_DIR/impact" ]] && [[ -f "$OUT_DIR/08-hot-but-thin.json" ]]; then
  EDGE_MAP='{}'
  while IFS= read -r ef; do
    [[ -n "$ef" ]] || continue
    rel="${ef#"$OUT_DIR"/}"
    # impact/<safe>/edges-in.json
    safe_dir="$(basename "$(dirname "$ef")")"
    cnt="$(jq '((.edges // .result.edges // .result.items // .items // []) | length)' "$ef" 2>/dev/null || echo 0)"
    # map both sanitized dir and any matching node id later via dir
    EDGE_MAP="$(jq --arg k "$safe_dir" --argjson v "${cnt:-0}" '.[$k]=$v' <<<"$EDGE_MAP")"
  done < <(find "$OUT_DIR/impact" -name 'edges-in.json' 2>/dev/null | sort | head -n 80)
  echo "$EDGE_MAP" >"$OUT_DIR/impact/edges-in-counts.json"
  jq --slurpfile emap "$OUT_DIR/impact/edges-in-counts.json" '
    ($emap[0] // {}) as $m
    | .nodes as $nodes
    | [
        $nodes[]
        | . as $n
        | (($n.id // "") | gsub("[^A-Za-z0-9._-]"; "_")) as $safe
        | $n + {
            edges_in_count: ($m[$safe] // null),
            fan_in_basis: (if ($m[$safe] != null) then "edges_in" else "from_count_ambiguous" end),
            from_count_note: "from_count is NOT fan-in on current CodexQA; prefer edges_in_count"
          }
      ]
    | sort_by(-(.edges_in_count // -1), -(.from_count // 0))
    | {
        kind: "HotButThinChanged",
        nodes: .,
        note: "Ranked by edges_in_count when impact/ present; from_count is tie-break only (NOT fan-in)."
      }
  ' "$OUT_DIR/08-hot-but-thin.json" >"$OUT_DIR/08-hot-but-thin.json.tmp"
  mv "$OUT_DIR/08-hot-but-thin.json.tmp" "$OUT_DIR/08-hot-but-thin.json"
fi

# Design fit signals (pure jq; 0 extra codexqa). WARN-only on failure — do not block collect.
if [[ -x "$SCRIPT_DIR/lib/derive-design-fit.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-design-fit.sh" --dir "$OUT_DIR" --mode pr; then
    echo "warn: derive-design-fit.sh failed; continuing without 10-design-fit-signals.json" >&2
  fi
else
  echo "warn: derive-design-fit.sh missing; Design fit signals skipped" >&2
fi

# Complexity signals (pure local; 0 extra codexqa). Pass --repo because manifest
# is written after derive — otherwise body scan (decisions/nesting/YAGNI comments) is skipped.
if [[ -x "$SCRIPT_DIR/lib/derive-complexity.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-complexity.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-complexity.sh failed; continuing without 11-complexity-signals.json" >&2
  fi
else
  echo "warn: derive-complexity.sh missing; Complexity signals skipped" >&2
fi

# Dependencies / supply-chain signals (local manifests/locks only; 0 extra codexqa; no network CVE).
if [[ -x "$SCRIPT_DIR/lib/derive-dependencies.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-dependencies.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-dependencies.sh failed; continuing without 12-dependency-signals.json" >&2
  fi
else
  echo "warn: derive-dependencies.sh missing; Dependencies signals skipped" >&2
fi

# Privacy / compliance signals (local PII/log heuristics; 0 extra codexqa; no legal conclusions).
if [[ -x "$SCRIPT_DIR/lib/derive-privacy.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-privacy.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-privacy.sh failed; continuing without 13-privacy-signals.json" >&2
  fi
else
  echo "warn: derive-privacy.sh missing; Privacy signals skipped" >&2
fi

# Error handling / resilience signals (local timeout/retry/swallow heuristics; 0 extra codexqa).
if [[ -x "$SCRIPT_DIR/lib/derive-resilience.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-resilience.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-resilience.sh failed; continuing without 14-resilience-signals.json" >&2
  fi
else
  echo "warn: derive-resilience.sh missing; Resilience signals skipped" >&2
fi

# Change / rollout signals (migration/dual-write/flag/compat/rollback; 0 extra codexqa).
if [[ -x "$SCRIPT_DIR/lib/derive-rollout.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-rollout.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-rollout.sh failed; continuing without 15-rollout-signals.json" >&2
  fi
else
  echo "warn: derive-rollout.sh missing; Rollout signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-risk-tier.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-risk-tier.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-risk-tier.sh failed; continuing without 20-risk-tier.json" >&2
  fi
else
  echo "warn: derive-risk-tier.sh missing; Risk tier skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-observability.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-observability.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-observability.sh failed; continuing without 16-observability-signals.json" >&2
  fi
else
  echo "warn: derive-observability.sh missing; Observability signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-contract.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-contract.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-contract.sh failed; continuing without 17-contract-signals.json" >&2
  fi
else
  echo "warn: derive-contract.sh missing; Contract signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-maintainability.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-maintainability.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-maintainability.sh failed; continuing without 18-maintainability-signals.json" >&2
  fi
else
  echo "warn: derive-maintainability.sh missing; Maintainability signals skipped" >&2
fi

if [[ -x "$SCRIPT_DIR/lib/derive-performance.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-performance.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-performance.sh failed; continuing without 21-performance-signals.json" >&2
  fi
else
  echo "warn: derive-performance.sh missing; Performance signals skipped" >&2
fi

# Annotation-edge compensation (Spring/Resilience4j callbacks; 0 extra CodexQA)
if [[ -x "$SCRIPT_DIR/lib/derive-annotation-edges.sh" ]]; then
  if ! "$SCRIPT_DIR/lib/derive-annotation-edges.sh" --dir "$OUT_DIR" --mode pr --repo "$REPO_ABS"; then
    echo "warn: derive-annotation-edges.sh failed; continuing without 19-annotation-edges.json" >&2
  fi
else
  echo "warn: derive-annotation-edges.sh missing; annotation edges skipped" >&2
fi

# Index quality summary from stats (plan: manifest 含 stub/碰撞提示)
# Normalize object-shaped stubs/collisions (CodexQA {"total":N}) to numeric totals.
INDEX_QUALITY="$(codexqa_index_quality_from_stats "$OUT_DIR/01-stats.json")"

TRUNCATED="$(jq -r '.result.truncated // .truncated // false' "$OUT_DIR/03-change-groups.json" 2>/dev/null || echo false)"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMANDS_JSON="$(printf '%s\n' "${COMMANDS[@]}" | jq -R . | jq -s .)"

jq -n \
  --arg mode "pr" \
  --arg run_id "$RUN_ID" \
  --arg repo "$REPO_ABS" \
  --arg diff_base "$DIFF_BASE" \
  --arg out_dir "$OUT_DIR" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$FINISHED_AT" \
  --arg codexqa_version "$CODEXQA_VERSION" \
  --argjson top_n "$TOP_N" \
  --argjson reach_depth "$REACH_DEPTH" \
  --argjson selected "$SELECTED_JSON" \
  --argjson commands "$COMMANDS_JSON" \
  --argjson index_quality "$INDEX_QUALITY" \
  --argjson truncated "$TRUNCATED" \
  --argjson lang_stats "$(jq '.lang_stats // .result.lang_stats // {}' "$OUT_DIR/02-summary.json" 2>/dev/null || echo '{}')" \
  --argjson language_profile "$(cat "$OUT_DIR/09-language-profile.json")" \
  '{
    mode: $mode,
    engine: "codexqa",
    analysis_backend: "codexqa-cli",
    polyglot_mandate: true,
    skill: "ai-code-reviewer",
    run_id: $run_id,
    repo: $repo,
    diff_base: $diff_base,
    out_dir: $out_dir,
    started_at: $started_at,
    finished_at: $finished_at,
    codexqa_version: $codexqa_version,
    lang_stats: $lang_stats,
    language_profile: $language_profile,
    primary_language: $language_profile.primary_language,
    review_language_focus: $language_profile.review_language_focus,
    is_polyglot: $language_profile.is_polyglot,
    top_n: $top_n,
    reach_depth: $reach_depth,
    selected_symbols: $selected,
    commands: $commands,
    index_quality: $index_quality,
    change_groups_truncated: $truncated,
    artifacts: [
      "manifest.json",
      "01-stats.json",
      "02-summary.json",
      "03-change-groups.json",
      "04-changed-files.json",
      "05-changed-symbols.json",
      "06-sensitive-hits.json",
      "06-sensitive-search.json",
      "06-sensitive-symbols/",
      "07-tags.json",
      "08-hot-but-thin.json",
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
      "commands.log",
      "diffs/",
      "impact/",
      "entries/"
    ],
    notes: [
      "ALL languages must be analyzed via CodexQA CLI; this pack is the only primary evidence source.",
      "primary_language / review_language_focus come from 09-language-profile.json (CodexQA lang_stats).",
      "All graph claims in review must cite these files.",
      "tested_count / tests-reach define coverage edges; test path names do not.",
      "from_count is NOT fan-in — prefer edges_in_count / edges-in callers (08-hot-but-thin re-ranked after impact/).",
      "Entry reachability: use 07-tags.json + impact/*/paths (from_count==0 candidates on reach hops).",
      "When edges-in empty for annotated methods, cite 19-annotation-edges.json synthetic callers.",
      "Design fit: 10-design-fit-signals.json derived locally (no extra CodexQA); see references/dimensions/design-fit.md.",
      "Complexity: 11-complexity-signals.json derived locally (no extra CodexQA); see references/dimensions/complexity.md.",
      "Dependencies: 12-dependency-signals.json derived locally (no extra CodexQA, no network CVE); see references/dimensions/dependencies.md.",
      "Privacy: 13-privacy-signals.json derived locally (no extra CodexQA, no legal conclusions); see references/dimensions/privacy.md.",
      "Resilience: 14-resilience-signals.json — every non-empty swallow/timeout/retry/partial/idempotency hit MUST become a finding or explicit deferred residual (hard gate); see references/dimensions/resilience.md.",
      "Change/rollout: 15-rollout-signals.json derived locally (no extra CodexQA, no ops probes); see references/dimensions/rollout.md.",
      "Risk tier: 20-risk-tier.json (T0–T3 blast-radius triage from paths+tags+sensitive+rollout surfaces); see references/dimensions/risk-tier.md.",
      "Observability: 16-observability-signals.json; see references/dimensions/observability.md.",
      "Contract: 17-contract-signals.json (incl. XSS sinks); see references/dimensions/contract.md.",
      "Maintainability: 18-maintainability-signals.json; see references/dimensions/maintainability.md.",
      "Performance: 21-performance-signals.json (hot-path/N+1/unbounded-alloc; no profiler); see references/dimensions/performance.md.",
      "Annotation callbacks: 19-annotation-edges.json; see collect/derive-annotation-edges.",
      "If change-groups empty or all change_status=default, re-index with --diff-base."
    ]
  }' >"$OUT_DIR/manifest.json"

PRIMARY_DETECTED="$(jq -r '.primary_language // "UNKNOWN"' "$OUT_DIR/09-language-profile.json")"
echo "Primary language: $PRIMARY_DETECTED (see 09-language-profile.json)"
echo "Evidence pack written: $OUT_DIR"

if [[ "$SKIP_VALIDATE" -eq 0 ]]; then
  if [[ -x "$SCRIPT_DIR/validate-evidence.sh" ]]; then
    "$SCRIPT_DIR/validate-evidence.sh" --dir "$OUT_DIR" --mode pr
  else
    echo "warn: validate-evidence.sh not executable; skip auto-validate" >&2
  fi
else
  echo "Next: validate-evidence.sh --dir \"$OUT_DIR\" --mode pr"
fi
