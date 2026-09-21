# Incremental publish

Publish is an Agent task, not a script entry. The Agent is responsible for confirming targets, generating the plan, temporary writes, replacement, failure recovery, and read-back.

## Public directory structure

```text
{run_dir}/testcase/
├── initialcase/
│   ├── testcase_app/
│   │   ├── testcase_app_index.md
│   │   └── testcases/{ID}-{casename}.md
│   ├── testcase_web/
│   │   ├── testcase_web_index.md
│   │   └── testcases/{ID}-{casename}.md
│   └── testcase_srv.md
├── procase/
│   ├── testcase_app/
│   ├── testcase_web/
│   └── testcase_srv.md
├── cases/
│   ├── testcase_app/
│   ├── testcase_web/
│   └── testcase_srv.md
└── testcase_changelog.md
```

`{run_dir}` is `userConfig.runDir`. All public targets must sit under `{run_dir}/testcase/`.

End-level layouts cannot be swapped:

- APP: `testcase_app/` directory
- Web: `testcase_web/` directory
- Server: `testcase_srv.md` single file

## Baseline selection and write lifecycle

Publish rules execute independently per the same `run_dir + platform + sourceId`.

1. When the user explicitly provides `inputs.baseline.cases` that covers the current end, use that frozen input.
2. Otherwise first check `testcase/cases/<end-target>`:
   - `EXISTING_VALID`: use `cases`
   - `ABSENT`: only then may a valid `initialcase` be used
   - `EMPTY_NO_CASES`: still record the source as `CASES`; do not fall back to `initialcase`
   - `EXISTING_INVALID`: block
3. Write the actual source to `caseBaselineSource`: `EXPLICIT_CASES`, `CASES`, or `INITIALCASE`

Then decide write targets by `procase` state:

| Scenario | Read baseline | Write targets | `procase` behavior |
| --- | --- | --- | --- |
| `DIFF_ENHANCEMENT`, `procase=ABSENT/EMPTY_NO_CASES` | By the priority above | `procase` + `cases` | Create or replace the empty skeleton; read-only after completion |
| `DIFF_ENHANCEMENT`, `procase=EXISTING_VALID` and `cases=EXISTING_VALID` | `cases` or explicit input | `cases` | Keep the original content |
| `DIRECT_CASE_UPDATE` | By the priority above | `cases` | Do not create, do not overwrite |

State judgment:

- `ABSENT`: the agreed target path does not exist.
- `EMPTY_NO_CASES`: the path type is correct, but there are only empty directories, empty files, an empty index, or a statistics framework only.
- `EXISTING_VALID`: the type is correct and readable, and it satisfies that end's complete layout and index consistency.
- `EXISTING_INVALID`: wrong type, a symlink, unreadable, or some real content exists but the structure is corrupt.

APP / Web validity: must be a non-symlink directory; index and details cross-check each other, and there must be no orphan detail files. `EMPTY_NO_CASES` when the index is empty and the details are empty. Server validity: a non-symlink `testcase_srv.md`; empty file or framework-only is `EMPTY_NO_CASES`.

Special states:

- `procase` missing, `cases` present: `cases` is the current baseline; DIFF may create `procase` and update `cases` in the transaction.
- Both `procase` and `cases` missing: use a valid `initialcase` as the baseline only when it exists.
- `procase=EXISTING_VALID` but `cases` missing or illegal: incomplete publication state; must block.
- `procase=EXISTING_INVALID`: block in all modes.
- `initialcase` is always read-only. An `EXISTING_VALID` `procase` is always read-only.

## Publication plan and record

`publication/publication-plan.json` and `publication/publication-record.json` use `publicationContractVersion=1.0`, and record `runDir`, `runId` (i.e. `userConfig.runid`), `testcaseRoot`, `executionMode`, and per-end `items[]`.

`runRoot` and `runDir` take the same value. `baselinePath`, `casesTargetPath`, and `procaseTargetPath` are paths relative to `run_dir`; after normalization they must sit under `testcaseRoot`.

## Transaction, protection, and recovery

- Before publish, temporarily back up the targets in this plan to `publication/backup/`.
- On DIFF dual-write, APP / Web must prepare both directory sets at the same time; Server must prepare both target files at the same time.
- Only `DIFF_ENHANCEMENT` updates `Total case count` and `Enhanced cases` in basic statistics; keep the `New cases` row as the baseline original text.
- After publish, read back entry files, directory layout, real case count, action distribution, container placement, and statistics rows.
- If any target fails or read-back is inconsistent, set status to `FAILED` or `BLOCKED`, and restore already-written targets.
- Do not modify files under `testcase/` that are not in the plan, and do not rewrite `testdesign/`.
