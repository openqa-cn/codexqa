# Incremental input contract

## Input responsibility

The Agent is responsible for:

- Judging user intent and task scope.
- Selecting the local input sources that need to be used.
- Assigning each input an `inputId`, slot, end, source, and version role.
- Deciding which inputs need to be frozen.

Scripts do not scan directories, do not guess sources, do not fall back by filename, and do not judge whether inputs are sufficient to support a business conclusion.

Incremental archive accepts local files, directories, or pasted body text already on disk. Do not fetch document pages as Incremental input. Stage 0 HTTPS fetch is Plan-only and is not an Incremental archive source.

**Incremental narrow exception**: when the user this turn explicitly gives a PR / MR, a Code-platform `/code/repo-detail/.../pr/{n}`, or a custom git repo URL, and routing is `DIFF_ENHANCEMENT`, **confirm a valid baseline by the baseline priority below first**. Do not call [code-fetch-spec.md](code-fetch-spec.md) without a baseline. After a baseline exists, fetch into a local worktree and archive by the GIT rules below. On failure, explain by the script `error.code` (only `PR_PERMISSION_DENIED` means permission denied; `PR_HEAD_REF_MISSING` asks for a local repo, a branch name, or a head SHA). Do not automatically extract a URL from requirement body. This exception does not apply to Plan / Exec.

When an end's baseline is not explicitly provided, the Agent may only read this project's agreed locations under `workspace-manifest.json.testcaseRoot`. The public directory is `{run_dir}/testcase/`.

`DIFF_ENHANCEMENT` and `DIRECT_CASE_UPDATE` use the same baseline priority:

1. User-explicit `inputs.baseline.cases` that covers the current end.
2. When there is no explicit source, or the explicit source does not cover the current end, read that end's `testcase/cases/`.
3. Read that end's valid `testcase/initialcase/` only when that end's `testcase/cases/` path does not exist.

Do not fall back to `initialcase` when the `cases` path already exists but is empty, framework-only, or structurally corrupt. Record the actual choice as `EXPLICIT_CASES`, `CASES`, or `INITIALCASE`.

**Valid baseline**: the priority above hits and the corresponding path is readable with a complete structure. Do not call `pull_remote_code.py` when there is no valid baseline.

End-level layout:

- APP: `testcase_app/` (index + `testcases/`)
- Web: `testcase_web/` (index + `testcases/`)
- Server: `testcase_srv.md`

Do not collapse an APP/Web directory into a single file, and do not fake a Server single file as a directory.

## Archivable inputs

Common slots:

- `baseline.prd`
- `baseline.techDesign`
- `baseline.code`
- `baseline.cases`
- `target.prd`
- `target.techDesign`
- `target.code`
- User direct-update requests, comments, or control materials such as `test_env`

`test_env` keeps its control-context identity and does not occupy the seven business slots; once archived, it triggers forced environment-supplementation review.

## Archive request

The Agent generates a JSON object and passes it to `scripts/incremental/freeze_inputs.py`:

```json
{
  "inputs": [
    {
      "inputId": "baseline-prd",
      "slot": "baseline.prd",
      "platform": null,
      "sourceId": "prd-main",
      "documentKey": "main-prd",
      "pairKey": "prd-main",
      "versionRole": "BASELINE",
      "sourceKind": "PATH",
      "sourcePath": "/absolute/path/to/prd.md",
      "originalRef": "User-provided local file identifier"
    }
  ]
}
```

Field rules:

- `inputId`: a unique single-level path name inside the same execution.
- `slot`, `platform`, `sourceId`, `documentKey`, `versionRole`: the Agent interprets and fills them; the script records them as-is.
- `pairKey`: the same `pairKey` must have exactly one `BASELINE` and one `TARGET`.
- `sourcePath`: the absolute path of the local file or directory to freeze.
- `sourceKind`: defaults to `PATH`; code inputs may use `GIT`.
- `originalRef`: a readable source description, not used as a read path.
- `documentKey`: the stable identity of the same logical document between baseline/target; write `null` explicitly when that dimension does not exist.

### Git code inputs

When `sourceKind=GIT`, also provide:

```json
{
  "inputId": "baseline-code-main",
  "slot": "baseline.code",
  "sourceKind": "GIT",
  "sourcePath": "/absolute/path/to/repository",
  "git": {
    "repositoryId": "repo-main",
    "commitId": "0123456789abcdef0123456789abcdef01234567"
  }
}
```

- `sourcePath` must be a local Git worktree.
- `git.commitId` must be a full immutable commit ID.
- baseline and target must both be `GIT`, and must use the same `repositoryId`.
- Git applies only to `baseline.code` / `target.code`.
- When fetching from a PR link or a custom repo URL, `sourcePath` must be the local `worktree` returned by `pull_remote_code.py`, and both sides use the same `repositoryId` and the full `baselineCommitId` / `targetCommitId`. The archive script does not accept a PR URL or a git address.

## Raw-input freeze

The script copies each input to `<workspace>/inputs/raw/<inputId>/` and generates `inputs/input-manifest.json`. The manifest is written only once. Refuse to overwrite when a manifest already exists or an `inputId` already exists.

Do not append a second competing set of raw inputs in the same execution. Create a new execution when raw inputs need revision.
