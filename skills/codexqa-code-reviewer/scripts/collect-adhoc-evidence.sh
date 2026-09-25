#!/usr/bin/env bash
# codexqa-code-reviewer: Collect single-file / small-set adhoc evidence via CodexQA.
# Does not require a pre-existing git identity on the upload alone — bootstraps a
# mini git repo when --repo is omitted, then indexes and packs like a mini PR.
set -euo pipefail

FILE=""
FILES=()
REPO=""
OUT_DIR=""
SKIP_VALIDATE=0
PRIMARY_LANG=""
KEEP_MINI=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/python_resolve.sh
source "$SCRIPT_DIR/lib/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"
# shellcheck source=lib/codexqa-preflight.sh
source "$SCRIPT_DIR/lib/codexqa-preflight.sh"
COMMANDS=()

usage() {
  cat <<'EOF'
Usage: collect-adhoc-evidence.sh --file <path> [--file <path>...] [--repo DIR] [--out DIR]

Single-file / multi-file adhoc review without a full PR diff-base.
When --repo is omitted, copies files into a temporary mini git repo, commits an
empty root and then the files, indexes with CodexQA, and builds a pack
(mode=adhoc). The empty root is the diff base so the files are only_on_head.
26–30 are written before the mini repo is removed.

Options:
  --file PATH          Source file to review (repeatable; required at least once)
  --repo DIR           Existing repo root (files must live under it). Optional.
  --out DIR            Output pack directory
  --primary-lang LANG  Override language profile
  --keep-mini          Keep bootstrap mini-repo under out/.adhoc-mini-repo
  --skip-validate      Do not run validate-evidence.sh --mode adhoc
  -h, --help           Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILES+=("${2:-}"); shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --primary-lang) PRIMARY_LANG="${2:-}"; shift 2 ;;
    --keep-mini) KEEP_MINI=1; shift ;;
    --skip-validate) SKIP_VALIDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "error: at least one --file is required" >&2
  usage
  exit 2
fi

codexqa_require_cli

ABS_FILES=()
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: file not found: $f" >&2
    exit 2
  fi
  ABS_FILES+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")")
done

MINI_CLEANUP=""
BOOTSTRAPPED=0
ADHOC_DIFF_BASE=""

if [[ -n "$REPO" ]]; then
  REPO_ABS="$(codexqa_resolve_repo "$REPO")"
  # Ensure files are under repo
  RELS=()
  for af in "${ABS_FILES[@]}"; do
    case "$af" in
      "$REPO_ABS"/*)
        RELS+=("${af#"$REPO_ABS"/}")
        ;;
      *)
        echo "error: $af is not under --repo $REPO_ABS" >&2
        exit 2
        ;;
    esac
  done
else
  BOOTSTRAPPED=1
  RUN_TMP="${OUT_DIR:-${TMPDIR:-/tmp}/codexqa-adhoc}"
  mkdir -p "$RUN_TMP"
  MINI="$(mktemp -d "${RUN_TMP%/}/adhoc-mini.XXXXXX")"
  MINI_CLEANUP="$MINI"
  REPO_ABS="$MINI"
  RELS=()
  mkdir -p "$MINI/src"
  for af in "${ABS_FILES[@]}"; do
    base="$(basename "$af")"
    cp "$af" "$MINI/src/$base"
    RELS+=("src/$base")
  done
  # Minimal git identity local to mini-repo only (does not touch user gitconfig)
  git -C "$MINI" init -q
  git -C "$MINI" config user.email "adhoc@codexqa-code-reviewer.local"
  git -C "$MINI" config user.name "codexqa-code-reviewer-adhoc"
  # Empty root first. The file commit then has a parent, so --diff-base can
  # merge-base and the files land in only_on_head instead of branch drift.
  git -C "$MINI" commit -q --allow-empty -m "adhoc root"
  ADHOC_DIFF_BASE="$(git -C "$MINI" rev-parse HEAD)"
  git -C "$MINI" add -A
  git -C "$MINI" commit -q -m "adhoc seed"
fi

RUN_ID="$(date +%Y%m%d_%H%M%S)_$$"
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$REPO_ABS/.codexqa-review/adhoc_$RUN_ID"
fi
mkdir -p "$OUT_DIR/impact" "$OUT_DIR/imports" "$OUT_DIR/diffs"
LOG="$OUT_DIR/commands.log"
touch "$LOG"

if [[ "$BOOTSTRAPPED" -eq 1 && "$KEEP_MINI" -eq 1 ]]; then
  cp -R "$REPO_ABS" "$OUT_DIR/.adhoc-mini-repo"
fi

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

run codexqa index "$REPO_ABS"
run_json "$OUT_DIR/01-stats.json" codexqa stats "$REPO_ABS" --format json
run_json "$OUT_DIR/02-summary.json" codexqa query --repo "$REPO_ABS" summary

# Synthesize change-groups / changed-files / changed-symbols for the target files
FILES_JSON='[]'
for rel in "${RELS[@]}"; do
  FILES_JSON="$(jq --arg p "$rel" '. + [{path:$p, change_status:"add"}]' <<<"$FILES_JSON")"
done
jq -n --argjson nodes "$FILES_JSON" \
  '{kind:"ChangedFiles", nodes:$nodes, note:"adhoc mode — uploaded/selected files treated as changed"}' \
  >"$OUT_DIR/04-changed-files.json"

jq -n --argjson files "$FILES_JSON" \
  '{kind:"ChangeGroups", result:{groups:[{id:"adhoc", symbols:[], files:$files}]}, note:"adhoc synthetic change-group"}' \
  >"$OUT_DIR/03-change-groups.json"

# Query symbols limited to files (best-effort); fall back to name-empty pack
run_json "$OUT_DIR/05-changed-symbols.json" \
  codexqa query --repo "$REPO_ABS" symbols --kind function,method,class --limit 80

# Filter symbols to our files when path present
jq --argjson files "$FILES_JSON" '
  ($files | map(.path) | unique) as $want
  | (.nodes // .result.nodes // []) as $n
  | [
      $n[]
      | select(
          (($want|length)==0)
          or (((.file // .path // "") as $fp | ($want | index($fp)) != null))
          or (((.file // .path // "") | length) == 0)
        )
    ] as $f
  | {kind:"ChangedSymbols", nodes: ($f | .[0:60]), note:"adhoc symbols (path-filtered when available)"}
' "$OUT_DIR/05-changed-symbols.json" >"$OUT_DIR/05-changed-symbols.json.tmp" \
  || cp "$OUT_DIR/05-changed-symbols.json" "$OUT_DIR/05-changed-symbols.json.tmp"
mv "$OUT_DIR/05-changed-symbols.json.tmp" "$OUT_DIR/05-changed-symbols.json"

# Full symbol list for the coverage ledger only. 05 stays capped for derive inputs.
run_json "$OUT_DIR/05-coverage-universe.json" \
  codexqa query --repo "$REPO_ABS" symbols --kind function,method,class --limit 5000 || true
if [[ -f "$OUT_DIR/05-coverage-universe.json" ]]; then
  jq --argjson files "$FILES_JSON" '
    ($files | map(.path) | unique) as $want
    | (.nodes // .result.nodes // []) as $n
    | [
        $n[]
        | select(
            (($want|length)==0)
            or (((.file // .path // .file_path // "") as $fp | ($want | index($fp)) != null))
            or (((.file // .path // .file_path // "") | length) == 0)
          )
      ] as $f
    | {kind:"CoverageUniverse", nodes: $f, note:"adhoc symbols for the coverage ledger; not capped at 60"}
  ' "$OUT_DIR/05-coverage-universe.json" >"$OUT_DIR/05-coverage-universe.json.tmp" \
    && mv "$OUT_DIR/05-coverage-universe.json.tmp" "$OUT_DIR/05-coverage-universe.json"
fi

jq -n '{kind:"HotButThinChanged", nodes:[], note:"adhoc — hot-but-thin optional"}' \
  >"$OUT_DIR/08-hot-but-thin.json"
jq -n '{kind:"Bm25Search", results:[], note:"adhoc — sensitive search skipped"}' \
  >"$OUT_DIR/06-sensitive-hits.json"
jq -n '{kind:"TagsPack", keys:[], tagged:[], note:"adhoc — tags optional"}' \
  >"$OUT_DIR/07-tags.json"
cp "$OUT_DIR/07-tags.json" "$OUT_DIR/07-tag-keys.json"

codexqa_detect_language_profile \
  "$OUT_DIR/02-summary.json" \
  "" \
  "$PRIMARY_LANG" >"$OUT_DIR/09-language-profile.json"

# Impact for top symbols
TOP_N=8
REACH_DEPTH=3
SYMBOL_IDS=()
codexqa_read_lines SYMBOL_IDS < <(
  jq -r '(.nodes // .result.nodes // [])[] | (.id // empty)' \
    "$OUT_DIR/05-changed-symbols.json" 2>/dev/null | awk 'NF' | head -n "$TOP_N"
)

for id in "${SYMBOL_IDS[@]+"${SYMBOL_IDS[@]}"}"; do
  [[ -z "$id" ]] && continue
  safe="$(echo "$id" | tr -c 'A-Za-z0-9._-' '_')"
  mkdir -p "$OUT_DIR/impact/$safe/paths"
  run_json "$OUT_DIR/diffs/${safe}.diff.json" \
    codexqa query --repo "$REPO_ABS" symbol-diff --id "$id" --max-lines 200 || true
  run_json "$OUT_DIR/impact/$safe/edges-in.json" \
    codexqa query --repo "$REPO_ABS" edges --id "$id" --direction in
  run_json "$OUT_DIR/impact/$safe/reach-in.json" \
    codexqa query --repo "$REPO_ABS" reach --id "$id" --direction in --depth "$REACH_DEPTH"
  run_json "$OUT_DIR/impact/$safe/tests-reach.json" \
    codexqa query --repo "$REPO_ABS" reach --id "$id" --edge-kinds tests
  echo '[]' >"$OUT_DIR/impact/$safe/paths/index.json"
done

if [[ -f "$SCRIPT_DIR/lib/collect-unit-calls.sh" ]]; then
  bash "$SCRIPT_DIR/lib/collect-unit-calls.sh" --repo "$REPO_ABS" --dir "$OUT_DIR" \
    || echo "warn: unit calls failed" >&2
fi

# On-disk imports for Design fit
for rel in "${RELS[@]}"; do
  safe="$(echo "$rel" | tr -c 'A-Za-z0-9._-' '_')"
  if [[ -f "$REPO_ABS/$rel" ]] && { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; }; then
    "$SCRIPT_DIR/acr-python" - "$REPO_ABS/$rel" "$rel" "$OUT_DIR/imports/${safe}-ondisk.json" <<'PY'
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
Path(out).write_text(json.dumps({
    "kind":"OnDiskImports","file":rel,"packages":pkgs[:5],"imports":imps[:80],
    "note":"adhoc on-disk import extract"
}, ensure_ascii=False), encoding="utf-8")
PY
  fi
done
printf '%s\n' "${RELS[@]}" | jq -R . | jq -s . >"$OUT_DIR/imports/index.json"

# Derives (same chain as PR; WARN-only)
for d in derive-design-fit derive-complexity derive-dependencies derive-privacy \
         derive-resilience derive-rollout derive-risk-tier derive-observability derive-contract \
         derive-maintainability derive-performance derive-sast derive-annotation-edges; do
  if [[ -x "$SCRIPT_DIR/lib/${d}.sh" ]]; then
    mode_arg="adhoc"
    case "$d" in
      derive-design-fit|derive-complexity|derive-dependencies|derive-privacy|\
      derive-resilience|derive-rollout|derive-risk-tier|derive-observability|derive-contract|\
      derive-maintainability|derive-performance|derive-sast)
        # most derives accept pr|full only — use pr semantics on adhoc packs
        mode_arg="pr"
        ;;
    esac
    if ! "$SCRIPT_DIR/lib/${d}.sh" --dir "$OUT_DIR" --mode "$mode_arg" --repo "$REPO_ABS" 2>/dev/null; then
      # design-fit has no --repo
      if ! "$SCRIPT_DIR/lib/${d}.sh" --dir "$OUT_DIR" --mode "$mode_arg" 2>/dev/null; then
        echo "warn: ${d}.sh failed; continuing" >&2
      fi
    fi
  fi
done

# Coverage ledger: hits annotate symbols and do not dequeue them. No extra CodexQA.
if [[ -f "$SCRIPT_DIR/lib/build-coverage-ledger.py" ]]; then
  if [[ -x "$SCRIPT_DIR/acr-python" ]]; then
    LEDGER_PY=("$SCRIPT_DIR/acr-python")
  else
    LEDGER_PY=(python3)
  fi
  if ! "${LEDGER_PY[@]}" "$SCRIPT_DIR/lib/build-coverage-ledger.py" --dir "$OUT_DIR" --mode adhoc --repo "$REPO_ABS"; then
    echo "warn: build-coverage-ledger.py failed; continuing without 24-coverage-ledger.json" >&2
  fi
else
  echo "warn: build-coverage-ledger.py missing; coverage ledger skipped" >&2
fi

# Same digest as a PR: 26–30, including inlined source in 29. The mini repo
# must still be on disk here; deleting it first leaves the packet without text.
if [[ -z "$ADHOC_DIFF_BASE" ]] && git -C "$REPO_ABS" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  ADHOC_DIFF_BASE="$(git -C "$REPO_ABS" rev-list --max-parents=0 HEAD 2>/dev/null | head -n 1 || true)"
fi
if [[ -n "$ADHOC_DIFF_BASE" && -f "$SCRIPT_DIR/lib/build-review-digest.py" ]]; then
  if [[ -x "$SCRIPT_DIR/acr-python" ]]; then
    DIGEST_PY=("$SCRIPT_DIR/acr-python")
  else
    DIGEST_PY=(python3)
  fi
  if ! "${DIGEST_PY[@]}" "$SCRIPT_DIR/lib/build-review-digest.py" \
      --dir "$OUT_DIR" --repo "$REPO_ABS" --diff-base "$ADHOC_DIFF_BASE"; then
    echo "warn: build-review-digest.py failed; continuing without 26-review-digest.json" >&2
  fi
elif [[ -z "$ADHOC_DIFF_BASE" ]]; then
  echo "warn: no diff base for adhoc digest; 26-review-digest.json skipped" >&2
else
  echo "warn: build-review-digest.py missing; review digest skipped" >&2
fi

INDEX_QUALITY="$(codexqa_index_quality_from_stats "$OUT_DIR/01-stats.json")"
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMANDS_JSON="$(printf '%s\n' "${COMMANDS[@]}" | jq -R . | jq -s .)"
RELS_JSON="$(printf '%s\n' "${RELS[@]}" | jq -R . | jq -s .)"

jq -n \
  --arg mode "adhoc" \
  --arg run_id "$RUN_ID" \
  --arg repo "$REPO_ABS" \
  --arg out_dir "$OUT_DIR" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$FINISHED_AT" \
  --arg codexqa_version "$CODEXQA_VERSION" \
  --argjson commands "$COMMANDS_JSON" \
  --argjson index_quality "$INDEX_QUALITY" \
  --argjson adhoc_files "$RELS_JSON" \
  --argjson bootstrapped "$BOOTSTRAPPED" \
  --arg diff_base "${ADHOC_DIFF_BASE}" \
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
    diff_base: (if $diff_base == "" then null else $diff_base end),
    adhoc: true,
    adhoc_bootstrapped_mini_repo: ($bootstrapped == 1),
    adhoc_files: $adhoc_files,
    out_dir: $out_dir,
    started_at: $started_at,
    finished_at: $finished_at,
    codexqa_version: $codexqa_version,
    lang_stats: $lang_stats,
    language_profile: $language_profile,
    primary_language: $language_profile.primary_language,
    commands: $commands,
    index_quality: $index_quality,
    artifacts: [
      "manifest.json","01-stats.json","02-summary.json","03-change-groups.json",
      "04-changed-files.json","05-changed-symbols.json","07-tags.json",
      "08-hot-but-thin.json","09-language-profile.json","10-design-fit-signals.json",
      "11-complexity-signals.json","12-dependency-signals.json","13-privacy-signals.json",
      "14-resilience-signals.json","15-rollout-signals.json","16-observability-signals.json",
      "17-contract-signals.json","18-maintainability-signals.json","19-annotation-edges.json",
      "20-risk-tier.json","21-performance-signals.json","24-coverage-ledger.json",
      "26-review-digest.json","26-review-digest-detail.json","27-suspect-queue.json",
      "28-symbol-bundle.json","29-judgment-packet.json","30-conclusion-skeleton.json",
      "impact/","imports/","commands.log"
    ],
    notes: [
      "adhoc mode: review reads 29-judgment-packet.json. The empty root commit is diff_base so the files are only_on_head.",
      "When bootstrapped, a mini git repo was created locally for CodexQA index gates only.",
      "from_count is NOT fan-in — prefer edges-in / 19-annotation-edges.json.",
      "Resilience signal hits must become findings or explicit deferred residuals (hard gate), including exception_unwraps. resource_leaks is RES-001, including close_not_in_finally. charset_gaps, null_deref_gaps, and authz_audit_gaps are per-row hard gates.",
      "Performance: 21-performance-signals.json (hot-path/N+1/unbounded-alloc; no profiler); hard gate on non-empty signal arrays. unpooled_connections is a hard gate and does not change signals_thin. weak_perf_tests is a test_gaps hard gate. env_config_gaps and uncontrolled_log_sinks are hard gates. magic_numbers and unused_accumulators are maintainability hard gates."
    ]
  }' >"$OUT_DIR/manifest.json"

echo "Adhoc evidence pack written: $OUT_DIR"

if [[ "$SKIP_VALIDATE" -eq 0 ]]; then
  if [[ -x "$SCRIPT_DIR/validate-evidence.sh" ]]; then
    "$SCRIPT_DIR/validate-evidence.sh" --dir "$OUT_DIR" --mode adhoc
  fi
else
  echo "Next: validate-evidence.sh --dir \"$OUT_DIR\" --mode adhoc"
fi

# Cleanup bootstrap mini-repo unless kept or OUT is inside it
if [[ "$BOOTSTRAPPED" -eq 1 && "$KEEP_MINI" -eq 0 && -n "$MINI_CLEANUP" ]]; then
  case "$OUT_DIR" in
    "$MINI_CLEANUP"/*) ;;
    *) rm -rf "$MINI_CLEANUP" ;;
  esac
fi
