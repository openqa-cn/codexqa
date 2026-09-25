#!/usr/bin/env bash
# Decide when codexqa index --diff-base must be a full reparse.
# A changed base is a cache miss. An incremental run that parses nothing
# while git or GitHub still lists changed files is a cache miss too.
# shellcheck shell=bash

index_diff_base_stamp_path() {
  local repo="$1"
  printf '%s\n' "$repo/.codexqa-review/index-diff-base"
}

index_diff_base_read_sha() {
  local stamp="$1"
  [[ -f "$stamp" ]] || return 1
  awk -F= '$1=="sha" { print $2; exit }' "$stamp"
}

# Cache miss when the stamp is absent or names a different resolved base.
index_diff_base_cache_miss() {
  local stamp="$1"
  local sha="$2"
  local old=""
  old="$(index_diff_base_read_sha "$stamp" 2>/dev/null || true)"
  [[ -z "$old" || "$old" != "$sha" ]]
}

# Incremental "no changes" is a miss when this base was not indexed for the
# current diff size. A stamp that already records that size is a hit: the
# tree did not change, so another full parse would repeat the same index.
index_diff_base_ignored_diff() {
  local mode="$1"
  local parsed="$2"
  local expected="$3"
  local stamp="$4"
  local recorded=""
  [[ "$mode" == *incremental* && "$parsed" -eq 0 && "$expected" -gt 0 ]] || return 1
  if [[ -f "$stamp" ]]; then
    recorded="$(awk -F= '$1=="expected" { print $2; exit }' "$stamp")"
  fi
  [[ "$recorded" != "$expected" ]]
}

index_diff_base_write_stamp() {
  local stamp="$1"
  local ref="$2"
  local sha="$3"
  local expected="$4"
  mkdir -p "$(dirname "$stamp")"
  printf 'ref=%s\nsha=%s\nexpected=%s\n' "$ref" "$sha" "$expected" >"$stamp"
}

# Resolved commit for the base ref, or the ref text when git cannot resolve it.
index_diff_base_sha() {
  local repo="$1"
  local ref="$2"
  local sha=""
  sha="$(git -C "$repo" rev-parse "${ref}^{commit}" 2>/dev/null || true)"
  if [[ -n "$sha" ]]; then
    printf '%s\n' "$sha"
  else
    printf '%s\n' "$ref"
  fi
}

# Three-dot name count. 0 when the base is not a commit in this repo.
index_diff_base_git_count() {
  local repo="$1"
  local ref="$2"
  if ! git -C "$repo" rev-parse --verify "${ref}^{commit}" >/dev/null 2>&1; then
    printf '0\n'
    return 0
  fi
  git -C "$repo" diff --name-only "${ref}...HEAD" 2>/dev/null | awk 'NF { n++ } END { print n+0 }'
}

# owner/repo#number -> owner repo number via stdout fields.
index_diff_base_parse_pr() {
  local spec="$1"
  local repo_part="${spec%%#*}"
  local number="${spec##*#}"
  [[ "$repo_part" == */* && "$number" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s\n' "$repo_part" "$number"
}

# Write one filename per line. Returns 0 when the API returns a list.
index_diff_base_github_files() {
  local spec="$1"
  local dest="$2"
  local parsed owner_repo number
  parsed="$(index_diff_base_parse_pr "$spec" 2>/dev/null || true)"
  [[ -n "$parsed" ]] || return 1
  owner_repo="${parsed%% *}"
  number="${parsed##* }"
  command -v gh >/dev/null 2>&1 || return 1
  GH_PROMPT_DISABLED=1 gh api --paginate \
    "repos/${owner_repo}/pulls/${number}/files" \
    --jq '.[].filename' >"$dest" 2>/dev/null || return 1
  [[ -s "$dest" ]]
}

index_diff_base_file_count() {
  local path="$1"
  [[ -f "$path" ]] || { printf '0\n'; return 0; }
  awk 'NF { n++ } END { print n+0 }' "$path"
}

# mode line and "N parsed" from codexqa index stdout.
index_diff_base_parse_index_log() {
  local log="$1"
  local mode parsed
  mode="$(awk -F: '/^mode:/ { gsub(/^[ \t]+/, "", $2); print $2; exit }' "$log")"
  parsed="$(awk '
    /files:/ {
      if (match($0, /\/[ \t]*[0-9]+[ \t]*parsed/)) {
        s = substr($0, RSTART, RLENGTH)
        gsub(/[^0-9]/, "", s)
        print s
        exit
      }
    }
  ' "$log")"
  printf '%s\n%s\n' "${mode:-unknown}" "${parsed:-0}"
}
