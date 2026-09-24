#!/usr/bin/env bash
# codexqa-code-reviewer: Shared CodexQA preflight for all languages / all repos.
# Sourced by collect-*.sh — do not execute as a standalone product path.
# Compatible with bash 3.2+ (macOS).

codexqa_die() {
  echo "error: $*" >&2
  exit 1
}

# Apply the shared PATH policy in scripts/lib/sast-tool-path.sh before any lookup.
# npm global bins come from ~/.npmrc prefix, $npm_config_prefix, and `npm prefix -g`.
codexqa_prepare_path() {
  local _preflight_dir
  _preflight_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${_preflight_dir}/sast-tool-path.sh" ]]; then
    # shellcheck source=sast-tool-path.sh
    source "${_preflight_dir}/sast-tool-path.sh"
    sast_refresh_path
  fi
}

# Print the absolute path of the installed codexqa CLI.
# Empty when the path probe does not find one. Do not reinstall when this prints a path.
codexqa_cli_path() {
  codexqa_prepare_path
  command -v codexqa 2>/dev/null || true
}

# Require CodexQA CLI on PATH. No language-specific analyzer may substitute.
# Refresh in this shell. Do not call codexqa_cli_path inside $() here: a
# command substitution would drop the PATH update.
codexqa_require_cli() {
  codexqa_prepare_path
  if ! command -v codexqa >/dev/null 2>&1; then
    codexqa_die "codexqa CLI is mandatory for ALL language repos. Resolve it with codexqa_cli_path (npmrc prefix and npm prefix -g) before installing. Install only if that prints nothing: npm i -g @openqa-cn/codexqa (Node >= 18). Do not fall back to git-diff-only / grep-only / language-native SAST as the analysis backend."
  fi
  if ! command -v jq >/dev/null 2>&1; then
    codexqa_die "jq is required to process CodexQA JSON evidence"
  fi
}

codexqa_version_string() {
  codexqa --version 2>/dev/null || echo "unknown"
}

# Resolve filesystem path when possible; keep repo id / URL as-is.
codexqa_resolve_repo() {
  local repo="${1:-}"
  if [[ -z "$repo" ]]; then
    codexqa_die "--repo is required"
  fi
  if [[ -d "$repo" ]]; then
    (cd "$repo" && pwd)
  else
    printf '%s' "$repo"
  fi
}

# When --skip-index: prove a CodexQA index already exists (still CodexQA-backed).
codexqa_require_existing_index() {
  local repo="$1"
  if ! codexqa stats "$repo" --format json >/dev/null 2>&1; then
    codexqa_die "skip-index requested but no usable CodexQA index for repo=$repo. Run: codexqa index \"$repo\" [--diff-base <ref>]"
  fi
}

# bash 3.2-compatible replacement for mapfile -t (macOS /bin/bash).
# Usage: codexqa_read_lines ARR_NAME < <(cmd)
# or:    codexqa_read_lines ARR_NAME <<< "$text"
codexqa_read_lines() {
  local __varname="$1"
  local __line
  eval "$__varname=()"
  while IFS= read -r __line || [[ -n "$__line" ]]; do
    [[ -z "$__line" ]] && continue
    eval "$__varname+=(\"\$__line\")"
  done
}

# Write engine provenance stamp into a JSON file (merge later via jq).
codexqa_engine_fields_json() {
  local version="$1"
  jq -n --arg v "$version" '{
    engine: "codexqa",
    analysis_backend: "codexqa-cli",
    polyglot_mandate: true,
    codexqa_version: $v,
    note: "All languages must be analyzed via CodexQA CLI symbol graph. No alternate primary backend."
  }'
}

# Normalize CodexQA stats stubs/collisions into numeric totals for manifest.index_quality.
# CodexQA may emit either a number or an object like {"total":2175,"strategy_a":...}.
# Args: stats.json path → prints index_quality JSON object.
codexqa_index_quality_from_stats() {
  local stats_json="${1:-}"
  if [[ -z "$stats_json" || ! -f "$stats_json" ]]; then
    echo '{"raw_present":false,"stubs":null,"collisions":null,"nodes":null,"note":"stats missing"}'
    return 0
  fi
  jq '
    def quality_num($x):
      if $x == null then null
      elif ($x | type) == "number" then $x
      elif ($x | type) == "object" then ($x.total // $x.count // $x.groups // null)
      elif ($x | type) == "string" and ($x | test("^[0-9]+$")) then ($x | tonumber)
      else null end;
    def quality_detail($x):
      if ($x | type) == "object" then $x else null end;
    {
      raw_present: (type == "object"),
      stubs: quality_num(.stubs // .stub_count // .quality.stubs),
      stubs_detail: quality_detail(.stubs // .quality.stubs),
      collisions: quality_num(.collisions // .collision_count // .quality.collisions),
      collisions_detail: quality_detail(.collisions // .quality.collisions),
      nodes: (.nodes_total // .nodes // .node_count // .totals.nodes // .local_nodes // null),
      note: "stubs/collisions are numeric totals (CodexQA may emit objects with .total). stubs>=20 → cap edge/reach confidence at UNKNOWN."
    }
  ' "$stats_json" 2>/dev/null || echo '{"note":"stats parse failed"}'
}

# Detect primary / secondary languages from CodexQA summary (+ optional changed files).
# Args: summary.json [changed-files.json] [override_primary]
# Prints language-profile JSON to stdout.
codexqa_detect_language_profile() {
  local summary_json="${1:-}"
  local changed_files_json="${2:-}"
  local override_primary="${3:-}"

  if [[ -z "$summary_json" || ! -f "$summary_json" ]]; then
    jq -n --arg note "missing summary" '{
      primary_language: null,
      detected_primary_language: null,
      primary_share: 0,
      confidence: "UNKNOWN",
      is_polyglot: false,
      lang_stats: {},
      code_lang_stats: {},
      secondary_languages: [],
      change_primary_language: null,
      change_lang_stats: {},
      review_language_focus: null,
      detection_method: "codexqa_summary_lang_stats",
      override_primary: null,
      note: $note
    }'
    return 0
  fi

  local changed_arg='{}'
  if [[ -n "$changed_files_json" && -f "$changed_files_json" ]]; then
    changed_arg="$(jq -c '
      (.files // .nodes // .result.files // .result.nodes // [])
      | map(.language // empty)
      | map(select(. != null and . != ""))
      | group_by(.)
      | map({key: .[0], value: length})
      | from_entries
    ' "$changed_files_json" 2>/dev/null || echo '{}')"
  fi

  jq -n \
    --slurpfile summary "$summary_json" \
    --argjson change_stats "$changed_arg" \
    --arg override "${override_primary}" \
    '
    def canon:
      ascii_downcase
      | if . == "js" or . == "javascript" then "JavaScript"
        elif . == "ts" or . == "typescript" or . == "tsx" then "TypeScript"
        elif . == "py" or . == "python" then "Python"
        elif . == "go" or . == "golang" then "Go"
        elif . == "rs" or . == "rust" then "Rust"
        elif . == "java" then "Java"
        elif . == "kt" or . == "kotlin" then "Kotlin"
        elif . == "c" then "C"
        elif . == "cpp" or . == "c++" or . == "cxx" then "C++"
        elif . == "cs" or . == "csharp" or . == "c#" then "C#"
        elif . == "rb" or . == "ruby" then "Ruby"
        elif . == "php" then "PHP"
        elif . == "swift" then "Swift"
        elif . == "scala" then "Scala"
        elif . == "dart" then "Dart"
        elif . == "shell" or . == "bash" or . == "zsh" or . == "sh" then "Shell"
        elif . == "markdown" or . == "md" then "Markdown"
        elif . == "json" then "JSON"
        elif . == "yaml" or . == "yml" then "YAML"
        elif . == "toml" then "TOML"
        elif . == "xml" then "XML"
        elif . == "html" or . == "htm" then "HTML"
        elif . == "css" or . == "scss" or . == "sass" or . == "less" then "CSS"
        elif . == "csv" then "CSV"
        elif . == "ini" then "Ini"
        elif . == "properties" or . == "props" then "Properties"
        elif . == "text" or . == "txt" or . == "plain" then "Text"
        else (.[0:1]|ascii_upcase) + .[1:] end;

    def is_noise:
      . as $l
      | ($l == "Markdown" or $l == "Text" or $l == "JSON" or $l == "YAML"
         or $l == "TOML" or $l == "XML" or $l == "HTML" or $l == "CSS"
         or $l == "CSV" or $l == "Ini" or $l == "Properties");

    def normalize_stats($obj):
      ($obj // {})
      | to_entries
      | map(select(.key != null and .key != "" and (.value|tonumber? // 0) > 0))
      | map({key: (.key|tostring|canon), value: (.value|tonumber)})
      | group_by(.key)
      | map({key: .[0].key, value: (map(.value)|add)})
      | from_entries;

    def rank($stats):
      $stats
      | to_entries
      | sort_by(-.value);

    def pick_primary($ranked):
      ($ranked | map(select(.key|is_noise|not))) as $code
      | if ($code|length) > 0 then $code[0]
        elif ($ranked|length) > 0 then $ranked[0]
        else null end;

    def code_only($stats):
      $stats
      | to_entries
      | map(select(.key|is_noise|not))
      | from_entries;

    ($summary[0].lang_stats // $summary[0].result.lang_stats // {}) as $raw
    | normalize_stats($raw) as $stats
    | ([$stats[] ] | add // 0) as $total
    | code_only($stats) as $code_stats
    | ([$code_stats[] ] | add // 0) as $code_total
    | rank($stats) as $ranked
    | rank($code_stats) as $code_ranked
    | pick_primary($ranked) as $top
    | ($top.key // null) as $detected
    | (if ($override != null and $override != "") then ($override|canon) else $detected end) as $primary
    # Share / confidence / polyglot always from detected code-language primary so --primary-lang
    # override does not wipe statistical signal when the forced name is absent from lang_stats.
    | (if $detected == null or $code_total == 0 then 0
       else (($code_stats[$detected] // 0) / $code_total) end) as $share
    | (if $detected == null or ($code_total == 0 and $total == 0) then "UNKNOWN"
       elif ($override != null and $override != "") then "high"
       elif $share >= 0.70 then "high"
       elif $share >= 0.50 then "medium"
       else "low" end) as $conf
    | ($code_ranked
       | map(select(.key != $detected))
       | .[0:3]
       | map({language: .key, files: .value,
              share: (if $code_total==0 then 0 else (.value/$code_total) end)})) as $detected_secondaries
    | (if ($override != null and $override != "" and $detected != null and $detected != $primary) then
         ([{language:$detected, files:($code_stats[$detected]//0), share:$share}] + $detected_secondaries)[0:3]
       else $detected_secondaries end) as $secondary
    | normalize_stats($change_stats) as $cstats
    | code_only($cstats) as $ccode
    | ([$ccode[] ] | add // 0) as $ctotal
    | rank($cstats) as $cranked
    | pick_primary($cranked) as $ctop
    | ($ctop.key // null) as $change_primary
    | {
        primary_language: $primary,
        detected_primary_language: $detected,
        primary_file_count: (if $primary==null then 0 else ($stats[$primary] // 0) end),
        primary_share: $share,
        confidence: $conf,
        is_polyglot: (if $detected==null then false
                      elif $share < 0.70 then true
                      elif (($detected_secondaries|length)>0 and ($detected_secondaries[0].share >= 0.15)) then true
                      else false end),
        lang_stats: $stats,
        code_lang_stats: $code_stats,
        secondary_languages: $secondary,
        change_primary_language: $change_primary,
        change_lang_stats: $cstats,
        change_primary_share: (if $change_primary==null or $ctotal==0 then 0
                               else (($ccode[$change_primary] // $cstats[$change_primary] // 0) / $ctotal) end),
        files_total_lang: $total,
        files_total_code: $code_total,
        detection_method: "codexqa_summary_lang_stats",
        override_primary: (if $override=="" then null else $override end),
        review_language_focus: (if $change_primary != null then $change_primary else $primary end),
        note: "primary_language from CodexQA lang_stats (max files among code langs; Markdown/JSON/YAML/... deprioritized). primary_share uses code-language denominator. review_language_focus prefers change_primary when PR changed files expose language."
      }
    '
}
