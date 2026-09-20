# Post-submit incremental: enhance existing cases

## Minimum persist (this stage)

- File: `artifacts/change-analysis/`
- File: `artifacts/case-decisions/`
- File: `outputs/cases/`
- No Incremental `check_run_gate`; details in [incremental/artifact-spec.md](incremental/artifact-spec.md)

This file is the Incremental execution entry. Do diff enhancement or a direct update on an existing baseline; do not rerun Stages 0–6; do not rewrite `{run_dir}/testdesign/test_design.md`.

Read contract details on demand:

- Start the task: [incremental/exec-layout.md](incremental/exec-layout.md), [incremental/input-spec.md](incremental/input-spec.md), [incremental/script-spec.md](incremental/script-spec.md), [incremental/standard-source-spec.md](incremental/standard-source-spec.md), [incremental/code-fetch-spec.md](incremental/code-fetch-spec.md)
- Generate artifacts: [incremental/artifact-spec.md](incremental/artifact-spec.md), [incremental/output-spec.md](incremental/output-spec.md), [incremental/report-spec.md](incremental/report-spec.md)
- End standard and publish: [incremental/case-standard-format.md](incremental/case-standard-format.md), [incremental/publish-rules.md](incremental/publish-rules.md)

Script entries always use this repo's `scripts/incremental/`. Long output follows the file-relay and segmented-read rules in [shared-rules.md](shared-rules.md).

## 1. Identify the task

Read the user request first and make clear:

- Whether this is comparing old vs new materials and enhancing (`DIFF_ENHANCEMENT`), or directly updating from conversation / comments / specified fields (`DIRECT_CASE_UPDATE`).
- The target end and the source.
- Which local raw inputs are required.
- Whether the user must confirm missing materials, an ambiguous end type, or a format-expression limit.

Do not infer user intent from `testcase/procase`, file counts, keywords, or old artifact state. Use `procase` only in the publish stage as the basis for protection and dual-write / single-write.

When the target end has no valid baseline, follow [postsubmit-bootstrap.md](postsubmit-bootstrap.md) first; after the initial version is on disk, return to this file. Do not misclassify a direct update as a diff because a PRD is missing.

## 2. Initialize and freeze

1. Read `runDir` and `runid` from `{run_dir}/testcase/testdocs/userConfig.json`. `run_dir` must equal `userConfig.runDir`. Do not use the last path segment as runId. Do not guess `run_dir` from a directory name.
2. Call `scripts/incremental/make_ids.py --kind execution-id` to fix this `executionId`. Reuse the original value for the same confirmation, retry, or partial rerun.
3. Call `setup_execution.py` and pass the Agent-confirmed `runDir`, `runid`, and `executionId` explicitly:

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/incremental/setup_execution.py \
  --run-dir <userConfig.runDir> \
  --run-id <userConfig.runid> \
  --execution-id <executionId>
```

4. Use this repo's `references/` to freeze Chapter 3 at the top level of the three-end templates:

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/incremental/freeze_case_standard.py \
  --workspace <workspace-absolute-path> \
  --source-reference-dir <this-repo-references-absolute-path> \
  --source-skill-name testcase-generation \
  --source-skill-version V56
```

5. If the user this turn explicitly gives a PR / MR, a Code-platform `/code/repo-detail/.../pr/{n}`, or a custom git repo URL: **confirm a valid case baseline first**. When there is no baseline, **do not** call `pull_remote_code.py`; follow [postsubmit-bootstrap.md](postsubmit-bootstrap.md) first, and return to this step after the initial version is on disk. Only after a baseline exists, fetch into `{run_dir}/testcase/.pr-cache/`, and use the returned worktree and full SHAs as `baseline.code` / `target.code`. On failure, explain by the script `error.code` (only `PR_PERMISSION_DENIED` means permission denied and ask to check credentials or give a local repo; `PR_HEAD_REF_MISSING` asks for a local repo, a branch name, or a head SHA). Rules are in [incremental/code-fetch-spec.md](incremental/code-fetch-spec.md).
6. The Agent itself decides the archive list. Except for the Incremental PR-code exception above, accept only local files, directories, or pasted body text already on disk; do not fetch document pages for Incremental archive. Stage 0 HTTPS fetch is Plan-only.
7. Call `freeze_inputs.py`. When archive fails, standard fetch fails, or inputs are incomplete, block the corresponding task; do not generate placeholder content.
8. Afterward, read only frozen inputs and Chapter 3 snapshots inside the workspace.

## 3. Diff enhancement

Execute only when the user asks to compare old vs new materials:

1. Call `build_diff_candidates.py`. The script processes input pairs with bounded parallelism.
2. Read `candidates/candidate-manifest.json`, confirm `candidateContractVersion=2.0`, then read `candidate-index.json`.
3. After filtering with the candidate index, take the full candidate from `contentFile`; do not parse paths from the diff header.
4. Return to the frozen original at `locations.*.workspacePath` and judge old behavior, new behavior, conflicts, affected ends, and affected cases.
5. Write `artifacts/change-analysis/change-analysis.json`.
6. For each affected case, first decide the primary execution end, then read only that end's Chapter 3 snapshot, and write `standard-profile.json`.
7. Write `case-decisions.json` per end and per source. `MODIFY`, `ADD`, `SPLIT`, and `MERGE` must carry `standardRefs`.
8. If the archive includes `test_env`, write `environment-review.json` per [incremental/case-standard-format.md](incremental/case-standard-format.md); do not generate that end's delivery content when decisions are incomplete. Pure environment supplementation promotes `KEEP` to `MODIFY`.
9. For each new target, first read the container rules for the current end and current source; after writing, read back the full entry points and the affected details.
10. Generate `delivery-manifest.json` and `content/` only after placement checks pass.
11. Generate `review-summary.md` per [incremental/report-spec.md](incremental/report-spec.md).

The candidate script's `candidateConfidence` only means mechanical similarity. The Agent must state the real change, the case impact, and the action.

## 4. Direct update

When the user explicitly asks to update from conversation, comments, specified fields, or specified cases:

1. Write the update request into `artifacts/intent/intent.md`; archive necessary read-only materials first.
2. Baseline priority: user-explicit `inputs.baseline.cases` > that end's `testcase/cases/` > read a valid `initialcase` only when that `cases` path does not exist. Do not fall back when the path exists but is empty or corrupt.
3. After the target end is determined, read only that end's Chapter 3 snapshot and write `standard-profile.json`.
4. Modify only the hit cases and fields; `MODIFY`, `ADD`, `SPLIT`, and `MERGE` must have `standardRefs`.
5. When environment context exists, complete the same per-case, per-item review.
6. New targets must land in the correct container; block when the location cannot be determined; do not append to the end of the file.
7. Write decisions, delivery content, and the report. Publish writes `cases` only; do not create `procase` because `procase` is missing.

A direct update does not trigger a diff because a PRD, a technical design, or code is missing.

## 5. End and source isolation

- Understand and produce APP, Web, and Server separately, using this project's Exec layout: APP / Web are index + `testcases/`; Server is the `testcase_srv.md` large table.
- Use an independent `sourceId` for each source.
- When one end cannot be understood, block only that end.
- Do not force a cross-end unified collection.
- The report may summarize across ends, but must keep end and source boundaries.

## 6. Partial rerun

When the current artifacts need a fix:

1. Find the earliest Agent node that failed.
2. List the downstream nodes that depend on it directly.
3. Mark only those nodes as `INVALIDATED`.
4. Overwrite the current artifacts on the original paths.
5. Regenerate the invalidated downstream.

Do not create a new execution when inputs have not changed. When independent historical analysis is needed, the user must explicitly ask to create another execution.

## 7. Publish

Publish is an Agent task, not a script entry. Rules are in [incremental/publish-rules.md](incremental/publish-rules.md).

- The public directory is `{run_dir}/testcase/`, i.e. `workspace-manifest.json.testcaseRoot`.
- `initialcase` is read-only.
- On the first `DIFF_ENHANCEMENT` when that end's `procase` is `ABSENT` or `EMPTY_NO_CASES`, dual-write `procase` and `cases` in the same transaction.
- Subsequent DIFFs that already have a valid `procase`, and all `DIRECT_CASE_UPDATE`, write `cases` only.
- Only DIFF updates that end's "Total case count" and "Enhanced cases" rows; count from the final real cases.

## 8. Pre-completion self-check

- References among changes, decisions, and results are locatable.
- `KEEP` keeps the original content.
- Modifications are the minimum necessary modifications.
- Adds, splits, and merges match the corresponding end standard, and `standardRefs` are complete.
- When environment context exists, `environment-review.json` covers all final cases and the filtered environment items.
- Output keeps the source baseline format; each new target appears only once and sits in the correct container.
- Report Chapter 4 uses `Original logic` and `New logic`; Chapters 5 through 8 are organized by change module.
- Publish targets are explicit and read-back is complete; strictly distinguish first-DIFF dual-write from subsequent `cases` single-write.
- `{run_dir}/testdesign/test_design.md` was not rewritten.
