#!/usr/bin/env bash
# Resolve a GitHub PR to a local checkout before any git fetch.
# Local commit objects win. Each remote URL is fetched at most once.
# "Empty reply from server" gets one HTTP/1.1 downgrade, then stop.
# Compatible with bash 3.2+ (no associative arrays, no mapfile).
set -euo pipefail

PR_SPEC=""
SEARCH_ROOTS=()
HEAD_SHA="${HEAD_SHA:-}"
BASE_SHA="${BASE_SHA:-}"
BASE_REF="${BASE_REF:-}"
BASE_REPO="${BASE_REPO:-}"
CLONE_URL="${CLONE_URL:-}"
MAX_DEPTH="${MAX_DEPTH:-4}"

usage() {
  cat <<'EOF'
Usage: resolve-pr-checkout.sh --pr <url|owner/repo#N> [--search-root DIR ...]

Find a local git repo that already has the PR head and base commits.
Fetch only when those objects are missing.

  --pr SPEC           GitHub PR URL or owner/repo#number (required)
  --search-root DIR   Directory to scan for clones (repeatable). Default: $PWD
  --head-sha SHA      Skip the GitHub API when the caller already knows SHAs
  --base-sha SHA
  --base-ref NAME     Base branch name, default main
  --base-repo OWNER/NAME
  --clone-url URL     One fetch URL used only if the commits are absent
  -h, --help

Prints one JSON object on stdout:
  status: local | fetched | blocked
  repo:   path whose HEAD is the PR head (a clean detached worktree when needed)
  diff_base, head_sha, base_sha, fetches

Exit 0 when the checkout is ready. Exit 2 when a fetch was not allowed or
the objects are still absent. Do not run git fetch yourself after exit 2.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR_SPEC="${2:-}"; shift 2 ;;
    --search-root) SEARCH_ROOTS+=("${2:-}"); shift 2 ;;
    --head-sha) HEAD_SHA="${2:-}"; shift 2 ;;
    --base-sha) BASE_SHA="${2:-}"; shift 2 ;;
    --base-ref) BASE_REF="${2:-}"; shift 2 ;;
    --base-repo) BASE_REPO="${2:-}"; shift 2 ;;
    --clone-url) CLONE_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$PR_SPEC" && -z "$HEAD_SHA" ]]; then
  echo "error: --pr or --head-sha is required" >&2
  usage
  exit 2
fi

if [[ ${#SEARCH_ROOTS[@]} -eq 0 ]]; then
  SEARCH_ROOTS+=("$PWD")
fi

TRIED_FILE="$(mktemp)"
trap 'rm -f "$TRIED_FILE"' EXIT

json_escape() {
  # One line, no jq required for a single string.
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

parse_pr_spec() {
  local spec="$1"
  spec="${spec%/}"
  spec="${spec%.git}"
  if [[ "$spec" =~ github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
    printf '%s/%s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  local repo_part="${spec%%#*}"
  local number="${spec##*#}"
  [[ "$repo_part" == */* && "$number" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s\n' "$repo_part" "$number"
}

load_pr_meta() {
  [[ -n "$HEAD_SHA" && -n "$BASE_SHA" ]] && return 0
  [[ -n "$PR_SPEC" ]] || return 1
  local parsed owner_repo number
  parsed="$(parse_pr_spec "$PR_SPEC" 2>/dev/null || true)"
  [[ -n "$parsed" ]] || return 1
  owner_repo="${parsed%% *}"
  number="${parsed##* }"
  BASE_REPO="${BASE_REPO:-$owner_repo}"
  command -v gh >/dev/null 2>&1 || return 1
  local meta
  meta="$(GH_PROMPT_DISABLED=1 gh api "repos/${owner_repo}/pulls/${number}" --jq \
    '[.head.sha, .base.sha, .base.ref, .base.repo.full_name, .base.repo.clone_url] | @tsv' 2>/dev/null || true)"
  [[ -n "$meta" ]] || return 1
  IFS="$(printf '\t')" read -r api_head api_base api_ref api_repo api_url <<<"$meta"
  HEAD_SHA="${HEAD_SHA:-$api_head}"
  BASE_SHA="${BASE_SHA:-$api_base}"
  BASE_REF="${BASE_REF:-$api_ref}"
  BASE_REPO="${api_repo:-$BASE_REPO}"
  CLONE_URL="${CLONE_URL:-$api_url}"
}

has_commit() {
  local repo="$1"
  local sha="$2"
  [[ -n "$sha" ]] || return 1
  git -C "$repo" cat-file -e "${sha}^{commit}" 2>/dev/null
}

remote_matches() {
  local repo="$1"
  local url
  url="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"
  [[ -z "$BASE_REPO" ]] && return 0
  [[ "$url" == *"$BASE_REPO"* ]]
}

# Return 0 when this exact attempt has not been used yet.
claim_attempt() {
  local key="$1"
  if grep -Fxq "$key" "$TRIED_FILE" 2>/dev/null; then
    echo "skip: already tried ${key}" >&2
    return 1
  fi
  printf '%s\n' "$key" >>"$TRIED_FILE"
  return 0
}

empty_reply() {
  local err="$1"
  grep -Eqi 'empty reply|early eof|curl: \(52\)|RPC failed|Connection reset by peer' "$err"
}

# One default fetch. On an empty HTTP reply, one HTTP/1.1 downgrade. Never a third try.
fetch_once() {
  local repo="$1"
  local url="$2"
  local refspec="$3"
  local key err
  key="${url} ${refspec}"
  claim_attempt "$key" || return 1
  err="$(mktemp)"
  echo "+ git fetch ${url} ${refspec}" >&2
  if git -C "$repo" fetch --no-tags "$url" "$refspec" >"$err" 2>&1; then
    rm -f "$err"
    return 0
  fi
  if empty_reply "$err"; then
    echo "warn: empty reply; one HTTP/1.1 downgrade for ${url}" >&2
    claim_attempt "${key} http/1.1" || { cat "$err" >&2; rm -f "$err"; return 1; }
    if git -C "$repo" -c http.version=HTTP/1.1 fetch --no-tags "$url" "$refspec" >"$err" 2>&1; then
      rm -f "$err"
      return 0
    fi
  fi
  cat "$err" >&2
  rm -f "$err"
  return 1
}

find_repos() {
  local root gitdir repo
  for root in "${SEARCH_ROOTS[@]}"; do
    [[ -d "$root" ]] || continue
    # Depth-capped. Skip dependency and evidence trees.
    find "$root" -maxdepth "$MAX_DEPTH" \
      \( -name node_modules -o -name .codexqa-review -o -name dist -o -name .next -o -name vendor \) -prune \
      -o -name .git \( -type d -o -type f \) -print 2>/dev/null | while IFS= read -r gitdir; do
      repo="$(dirname "$gitdir")"
      printf '%s\n' "$repo"
    done
  done
}

pick_repo() {
  local repo best="" best_score=-1 score
  while IFS= read -r repo; do
    [[ -n "$repo" ]] || continue
    has_commit "$repo" "$HEAD_SHA" || continue
    has_commit "$repo" "$BASE_SHA" || continue
    score=1
    if remote_matches "$repo"; then
      score=$((score + 2))
    fi
    if [[ "$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)" == "$HEAD_SHA" ]]; then
      score=$((score + 1))
    fi
    if [[ "$score" -gt "$best_score" ]]; then
      best="$repo"
      best_score=$score
    fi
  done
  printf '%s\n' "$best"
}

ensure_checkout() {
  local repo="$1"
  local head current dirty dest
  head="$HEAD_SHA"
  current="$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"
  dirty="$(git -C "$repo" status --porcelain 2>/dev/null || true)"
  if [[ "$current" == "$head" && -z "$dirty" ]]; then
    printf '%s\n' "$repo"
    return 0
  fi
  dest="${TMPDIR:-/tmp}/codexqa-pr-${head:0:12}"
  if [[ -d "$dest/.git" || -f "$dest/.git" ]]; then
    if [[ "$(git -C "$dest" rev-parse HEAD 2>/dev/null || true)" == "$head" ]]; then
      printf '%s\n' "$dest"
      return 0
    fi
  fi
  rm -rf "$dest"
  git -C "$repo" worktree add --detach "$dest" "$head" >/dev/null
  printf '%s\n' "$dest"
}

emit() {
  local status="$1"
  local repo="$2"
  local fetches="$3"
  local diff_base reason
  diff_base=""
  if [[ -n "$repo" && -n "$BASE_REF" ]]; then
    if git -C "$repo" rev-parse --verify "origin/${BASE_REF}^{commit}" >/dev/null 2>&1; then
      diff_base="origin/${BASE_REF}"
    elif git -C "$repo" rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null 2>&1; then
      diff_base="$BASE_SHA"
    fi
  fi
  reason=""
  if [[ "$status" == "blocked" ]]; then
    reason="local commits absent and the one allowed fetch did not add them"
  fi
  printf '{\n'
  printf '  "status": "%s",\n' "$(json_escape "$status")"
  printf '  "repo": "%s",\n' "$(json_escape "$repo")"
  printf '  "head_sha": "%s",\n' "$(json_escape "$HEAD_SHA")"
  printf '  "base_sha": "%s",\n' "$(json_escape "$BASE_SHA")"
  printf '  "base_ref": "%s",\n' "$(json_escape "$BASE_REF")"
  printf '  "diff_base": "%s",\n' "$(json_escape "$diff_base")"
  printf '  "fetches": %s,\n' "$fetches"
  printf '  "reason": "%s"\n' "$(json_escape "$reason")"
  printf '}\n'
}

main() {
  load_pr_meta || true
  if [[ -z "$HEAD_SHA" || -z "$BASE_SHA" ]]; then
    echo "error: PR head and base SHAs are unknown (gh api failed and --head-sha/--base-sha were not set)" >&2
    emit blocked "" 0
    exit 2
  fi
  BASE_REF="${BASE_REF:-main}"

  local found checkout
  found="$(find_repos | pick_repo)"
  if [[ -n "$found" ]]; then
    checkout="$(ensure_checkout "$found")"
    emit local "$checkout" 0
    exit 0
  fi

  # Missing objects. Fetch into a clone of this repo if we have one; one URL only.
  local host="" repo
  while IFS= read -r repo; do
    [[ -n "$repo" ]] || continue
    if remote_matches "$repo"; then
      host="$repo"
      break
    fi
  done < <(find_repos)

  if [[ -z "$host" || -z "$CLONE_URL" || -z "$PR_SPEC" ]]; then
    echo "error: no local commit ${HEAD_SHA} and no single clone URL to fetch once" >&2
    emit blocked "" 0
    exit 2
  fi

  local parsed number
  parsed="$(parse_pr_spec "$PR_SPEC" 2>/dev/null || true)"
  number="${parsed##* }"
  local fetches=0
  if [[ "$number" =~ ^[0-9]+$ ]]; then
    if fetch_once "$host" "$CLONE_URL" "+refs/pull/${number}/head:refs/codexqa/pr-${number}"; then
      fetches=$((fetches + 1))
    fi
  fi
  if ! has_commit "$host" "$HEAD_SHA" || ! has_commit "$host" "$BASE_SHA"; then
    echo "error: fetch did not provide the PR commits; not retrying ${CLONE_URL}" >&2
    emit blocked "$host" "$fetches"
    exit 2
  fi
  checkout="$(ensure_checkout "$host")"
  emit fetched "$checkout" "$fetches"
}

main "$@"
