# Incremental Workspace layout

## Root directory

The run root is `userConfig.runDir`, not the last path segment, and must not be guessed from a directory name. The Incremental workspace lives at:

```text
{run_dir}/testcase/.case-enhance/{executionId}/
```

Where:

```text
run_dir = userConfig.runDir
runid = userConfig.runid
workspaceRef = testcase/.case-enhance/{executionId}
```

Do not **guess** `run_dir` from the home directory or a fixed prefix (must read the already-written `userConfig.runDir`). `userConfig.runDir` defaults to `$HOME/testdata-generation/runs/{runid}`; see [run-workspace.md](../run-workspace.md). Do not write artifacts outside `{run_dir}`.

## Directory structure

```text
<executionId>/
├── workspace-manifest.json
├── inputs/
│   ├── input-manifest.json
│   ├── raw/<inputId>/
│   └── git/<repositoryId>.git/
├── candidates/
│   ├── candidate-manifest.json
│   ├── candidate-index.json
│   └── diff-candidates.json
├── artifacts/
│   ├── intent/
│   ├── standards/
│   │   ├── source/standard-source-manifest.json
│   │   ├── source/sections/<platform>/...section-3.md
│   │   └── <platform>/<sourceId>/standard-profile.json
│   ├── case-format/<platform>/<sourceId>/
│   ├── change-analysis/
│   ├── case-decisions/<platform>/<sourceId>/
│   └── environment/<platform>/<sourceId>/
├── outputs/
│   ├── cases/<platform>/<sourceId>/content/
│   └── reports/review-summary.md
├── publication/
│   ├── publication-plan.json
│   ├── publication-record.json
│   └── backup/
└── status/
    ├── task-status.json
    └── task-history.jsonl
```

`workspace-manifest.json` at least records:

- `runDir`: the absolute path of `userConfig.runDir`.
- `runId`: `userConfig.runid`.
- `testcaseRoot`: `{run_dir}/testcase`.
- `executionId`.
- `workspaceRef`: `testcase/.case-enhance/{executionId}`.

For script-argument compatibility, `runRoot` and `runDir` take the same value. Scripts only validate the identity the Agent has already confirmed; they do not re-identify.

In one input archive of the same execution, baseline/target inputs with the same `repositoryId` share one `inputs/git/<repositoryId>.git/`.

## Write boundaries

| Directory | Writer | Rule |
| --- | --- | --- |
| `inputs/` | `freeze_inputs.py` | Write raw inputs and Git commits once; do not overwrite |
| `artifacts/standards/source/` | `freeze_case_standard.py` | Save only Chapter 3 snapshots and hashes of the three templates in this repo; do not overwrite |
| `candidates/` | `build_diff_candidates.py` | May overwrite the current candidates when using the same frozen inputs |
| `artifacts/` | Agent | Write current business artifacts at fixed paths |
| `outputs/` | Agent | Write current end-level delivery at fixed paths |
| `publication/` | Agent | Save only the current publication plan, result, and this failure-recovery backup |
| `status/` | `write_task_status.py` | Current status may be updated; event history is appended |

## No revision

Inside the same execution, each node, end, and source has only one current artifact. Fix a bad artifact by editing or overwriting it on the original path. Recovery relies on regenerating from the frozen raw inputs.

## Public case tree

The execution workspace is separate from the public case tree. The public case tree is fixed as:

```text
{run_dir}/testcase/
├── initialcase/                       # initial-version cases; incremental is read-only
│   ├── testcase_app/
│   │   ├── testcase_app_index.md
│   │   └── testcases/{ID}-{casename}.md
│   ├── testcase_web/
│   │   ├── testcase_web_index.md
│   │   └── testcases/{ID}-{casename}.md
│   └── testcase_srv.md
├── procase/                           # read-only protection after the first DIFF dual-write
│   ├── testcase_app/
│   ├── testcase_web/
│   └── testcase_srv.md
├── cases/                             # current valid cases
│   ├── testcase_app/
│   ├── testcase_web/
│   └── testcase_srv.md
└── testcase_changelog.md
```

APP and Web must keep index + `testcases/` details; Server uses the `testcase_srv.md` large table. Do not collapse Web into a single file, and do not fake an APP/Web directory as a Server single file.

Implicit baseline always prefers `testcase/cases/<end-target>`; read `testcase/initialcase/<end-target>` only when that path does not exist. `procase` is not a baseline source.
