# Incremental PR code-fetch contract

## When it is allowed

The Agent may call `scripts/incremental/pull_remote_code.py` only when all of the following hold at once:

- Routing has already judged Incremental, and the execution mode is `DIFF_ENHANCEMENT`
- The user **this turn explicitly gives** a PR / MR, a Code-platform `/code/repo-detail/.../pr/{n}`, or a custom git repo URL; a local repo path, `--head-sha`, or `--head-ref` may also be given at the same time
- The target end already has a valid case baseline. **Do not call this script when there is no baseline**; follow [postsubmit-bootstrap.md](../postsubmit-bootstrap.md) first, and fetch code only after the initial version is on disk

Forbidden:

- Automatically extract a URL from requirement body, technical design, or comments and fetch it
- Use this script in Plan / Exec / Stage 0 to fetch a PRD, a document, or a web page
- Depend on `gh` / `glab`
- Automatically treat a PR description or comments as `DIRECT_CASE_UPDATE` input

## Script entry

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/incremental/pull_remote_code.py \
  --pr-url "<PR/MR link or git repo URL the user explicitly gave>" \
  --run-dir "<userConfig.runDir>" \
  --run-id "<userConfig.runid>" \
  --cache-dir "<optional; must be under runDir/testcase/.pr-cache>" \
  --local-repo "<optional; local worktree absolute path>" \
  --git-url "<optional; override the git remote actually cloned/fetched>" \
  --base-sha "<optional; full 40-character base commit>" \
  --head-sha "<optional; full 40-character head commit>" \
  --head-ref "<optional; override the remote head ref>"
```

The script only: parses the address, git clone/fetch, and resolves full base/head SHAs. It does not judge case actions, does not archive, and does not publish.

## Parse rules

Recognize address shapes only; do not open page HTML:

- GitHub style: `https://host/owner/repo/pull/123` (suffixes such as `/files` are allowed)
- GitLab style: `https://host/group/repo/-/merge_requests/123`
- Other HTTPS PR/MR paths: `/pulls/`, `/pull-requests/`, `/merge-requests/`, `/merge_requests/`, standalone segment `/pr/` (for example `https://host/owner/repo/pr/123`)
- Code-platform PR page: path is `/code/repo-detail/{group}/{repo}/pr/{n}` (suffixes such as `/diff` and `/files` are allowed). `family=code-ui`: take group/repo/number from the path; do not treat a suffix as the repo name. **Rewrite the host to `git.` only when the page host starts with `dev.`** (for example `dev.example.com` → `git.example.com`); keep other hostnames as-is. The default `gitUrl` is `https://{rewritten-host}/{group}/{repo}.git`, and fall back to trying `ssh://git@{rewritten-host}/{group}/{repo}.git`. Do not hit the PR API on the page host; resolve base via merge-base
- Custom git repo: `https://host/path/repo.git`, `git@host:path/repo.git`, `ssh://git@host[:port]/path/repo.git`; an HTTPS repo may also omit `.git`
- A custom repo may specify a branch/tag with `#ref` or `--head-ref`
- Forbid account/password embedded in the URL (except `ssh://git@`); forbid whitespace and `..`
- `--git-url` / `--local-repo` may still override the remote actually cloned

Commit-resolution order:

1. If `--local-repo` is present: only `clone --no-checkout` from that local worktree (origin=local path), and resolve SHAs from local objects. **By default do not** point `source` at the rewritten remote, and do not access the network. Do not change the user's worktree. Fall back to the remote `source` only when local objects are missing.
2. head: `--head-sha` > local existing branch / remote-tracking refs (including `--head-ref` aliases `origin/` and `refs/heads/`) > `git ls-remote` / fetch PR head ref (`refs/pull/{n}/head` and the like) > `HEAD` of a custom repo. Code UI remotes usually do not publish these refs: use local when a local repo or `--head-sha` / `--head-ref` is present; if none of them is present, `PR_HEAD_REF_MISSING`.
3. base: `--base-sha` > platform JSON API `base.sha` without a token (GitHub/GitLab PR/MR only) > `merge-base` of the default branch and head.
4. Succeed only after both full SHAs have entered the worktree at `{run_dir}/testcase/.pr-cache/{host}/{owner}/{repo}/`.

Exit non-zero on failure. The Agent explains to the user by `error.code`:

| `error.code` | Tell the user |
|---|---|
| `PR_PERMISSION_DENIED` | Permission denied (auth failure, 401/403, Permission denied, SSO/login redirect, including `unable to update url base from redirection` / `无法更新重定向后的 URL 基址`). Check local Git credentials, or switch to a local repo path (optionally also give a branch name / head SHA) |
| `PR_HEAD_REF_MISSING` | The remote has no usable PR head ref. Give a local repo path, a branch name, or a head SHA (script counterparts `--local-repo` / `--head-ref` / `--head-sha`) |
| Other (`PR_URL_UNSUPPORTED`, `PR_CLONE_FAILED`, `PR_FETCH_FAILED`, `PR_BASE_UNRESOLVED`, `CACHE_DIR_OUTSIDE_PR_CACHE`, and the like) | Report that error code and the script `msg` |

On script success, both full base/head SHAs must be resolvable in the cached worktree. On the user side, give a repo URL, plus an optional local repo, branch name, or head SHA.

Offline self-check: `<skill_dir>/scripts/tcg-python scripts/incremental/pull_remote_code.py --self-check`.

## Success output

stdout is JSON only, and at least contains:

- `ok`
- `prUrl`
- `gitUrl` (no userinfo)
- `worktree`
- `repositoryId`
- `baselineCommitId`
- `targetCommitId`
- `headRef`
- `baseResolution`: `api` / `merge-base` / `explicit`
- `limitations`

Git noise and elapsed time go to stderr. Do not print tokens, cookies, or passwords.

## Hand off to archive

The Agent builds an archive request from the script output, then calls the existing `freeze_inputs.py`. `sourcePath` is `worktree`; both sides use `sourceKind=GIT` and the same `repositoryId`:

| Slot | commit |
| --- | --- |
| `baseline.code` | `baselineCommitId` |
| `target.code` | `targetCommitId` |

`freeze_inputs.py` does not open a PR URL.
