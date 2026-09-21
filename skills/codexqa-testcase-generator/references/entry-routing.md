# User-intent routing

This file defines the entry routing for `codexqa-testcase-generator`. Before routing finishes, do not initialize the workspace, do not read business materials, and do not generate test cases. Routing uses only **user conversation intent** to decide whether to run Plan, Exec, pre-submit update, Incremental, or ask for clarification. Once released, internal stages, knowledge consumption, and artifact rules must follow `SKILL.md`; do not cut them. For user-facing wording and examples, see [user-guide.md](../user-guide.md) at the repo root.

Routing uses only the user's original words and local `userConfig` / existing artifacts. `run_dir` is created or reused by this Skill. Post-submit incremental is handled inside this Skill.

## 1. Directory responsibilities

```text
    run_dir = the run root directory this Skill creates or reuses from the user interaction; all artifacts (testdesign/, testcase/, etc.) are stored here
```

Read `run_dir` from the `runDir` field of `{run_dir}/testcase/testdocs/userConfig.json`; determination rules are in [run-workspace.md](run-workspace.md).

Mandatory constraints:

- Do not arbitrarily overwrite an already-written `userConfig.runid` or `userConfig.runDir` (except filling a missing `runDir` during initialization).
- After the matching scope is released, both initial generation and pre-submit update write `<run_dir>/testcase/initialcase/`.
- Incremental publish writes `<run_dir>/testcase/cases/` (on the first diff enhancement, if `procase` is empty, also write `procase` at the same time); `initialcase` is read-only.

## 2. Raw input

When this Skill receives a user message, keep the raw input. Routing decisions are used only inside the current Skill; do not reconstruct or rewrite the user's original words before executing.

## 3. Decide this run's scope (Plan / Exec / Incremental)

Decide from the user's original words and local artifacts; **ask first, then execute**.

| User intent | Local artifacts | Execute |
| --- | --- | --- |
| Generate a test plan / do test analysis / plan only；生成测试方案 / 做测试分析 / 只要方案 | Regardless of whether an old plan already exists (if the user asks to redo, rerun Plan) | **Plan** (Stages 0–5) |
| Generate cases / write cases / cases only；生成用例 / 写用例 / 只要用例 | `{run_dir}/testdesign/test_design.md` exists, is readable, and contains a final client type decision | **Exec** (Stage 6) |
| Generate cases, but the formal test plan is missing or incomplete | The plan is unusable | First explain the reason, then run **Plan**; after Plan finishes, ask whether to continue generating cases |
| Both plan and cases / from requirements through cases；生成方案和用例 / 从需求一直做到用例 | — | First complete **Plan**; after persist, ask whether to **Exec** immediately; run Stage 6 only after the user confirms |
| Pre-submit edit of existing cases | `testcase/cases/` already exists, or the user provided a baseline | [presubmit-case-edit.md](presubmit-case-edit.md) |
| Post-submit incremental / enhance existing cases / diff-fill cases；提测后增量 / 已有用例增强 / diff 补用例 | The target end has a valid baseline | **Incremental**; see [postsubmit-enhance.md](postsubmit-enhance.md) |
| Post-submit incremental, but the target end has no valid baseline | The initial version is missing | First backfill the initial version per [postsubmit-bootstrap.md](postsubmit-bootstrap.md), then stay in this Skill and continue incremental |
| Intent is unclear | — | Ask whether the user wants a test plan, test cases, both, or post-submit incremental; do not guess by default |

Once the scope is set: Plan must fully walk Stages 0–5, Exec must fully walk Stage 6, and Incremental must fully walk the incremental flow. The user saying "just the result" / "只要结果" also must not skip internal steps.

After Plan finishes, default to stopping at the plan and ask in one sentence whether to generate cases; **enter Exec only if the user explicitly agrees, or originally asked for both and then confirmed after the plan was completed**. Do not automatically write cases when the user has not stated a position.

Incremental does not rewrite `{run_dir}/testdesign/test_design.md`. If the user also wants a new plan, first complete Plan, then decide from confirmation whether to Exec or incremental.

## 4. Target end

When the user specifies APP / Web / server, only limit the output end; do not cut that end's scenarios, and do not skip knowledge, templates, coverage, incremental decisions, or persist. When the target end is unclear and cannot be decided from the plan's client type or the baseline, ask the user; do not default to server only.

## 5. Pre-submit update

When the user asks to edit existing cases, and it is not "redo the plan" / "重新出方案", and it is not post-submit incremental, read [presubmit-case-edit.md](presubmit-case-edit.md).

Baseline priority:

```text
cases the user provided in this turn
> <run_dir>/testcase/cases/<end file>
```

Pre-submit update writes only `initialcase`; do not merge it with Incremental.

## 6. Post-submit incremental

When the user explicitly says post-submit enhancement, diff-fill cases, incremental on existing cases, and the like:

1. The target end has a valid baseline: read [postsubmit-enhance.md](postsubmit-enhance.md) and run Incremental inside this Skill.
2. The target end has no valid baseline: first backfill Plan / Exec per [postsubmit-bootstrap.md](postsubmit-bootstrap.md); after the initial version is on disk, stay in this Skill and continue incremental.
3. When both the formal test plan and the initial version are missing, first run Plan per the user's confirmation, then ask whether to Exec; incremental is allowed only after the initial version is complete.

The incremental mode is decided by user intent; do not infer it from the existence of `procase` or `cases`:

- Comparing old vs new PRD / technical design / code → `DIFF_ENHANCEMENT`
- The user explicitly gives a PR / MR, a Code-platform `/code/repo-detail/.../pr/{n}`, or a custom git repo URL in this turn and asks for a code incremental → `DIFF_ENHANCEMENT`. Pull to local and then archive per [incremental/code-fetch-spec.md](incremental/code-fetch-spec.md) only when the target end has a valid baseline; if there is no baseline, bootstrap first and **do not fetch code first**
- Updating from conversation, comments, specified fields, or specified cases → `DIRECT_CASE_UPDATE`

## 7. Release conditions

If any of the following is met, continue executing `SKILL.md`:

1. The user wants a test plan → Plan
2. The user wants initial-version cases and the formal test plan is usable → Exec
3. The user wants plan + cases → Plan, then Exec after confirmation
4. The user wants a pre-submit update of existing cases
5. The user confirms backfilling initial-version cases for a missing end (Exec if the formal test plan is usable; otherwise Plan first)
6. The user wants post-submit incremental / enhancement of existing cases, and the target end has a valid baseline → Incremental
7. The user explicitly gives a PR / MR, a Code-platform `/code/repo-detail/.../pr/{n}`, or a custom git repo URL in this turn and asks for a code incremental, and the target end has a valid baseline → Incremental (`DIFF_ENHANCEMENT`); only then is fetching code allowed
8. The user wants post-submit incremental but the initial version is missing (including a PR already given but no `cases/` baseline) → first [postsubmit-bootstrap.md](postsubmit-bootstrap.md), **do not fetch the PR first**; after the initial version is on disk, then Incremental

In all other cases, ask for clarification, or fail per Section 8.

## 8. Exception handling

- The case file the user provided is illegal: fail immediately; do not fall back to guessing.
- Cases in the fixed directory are illegal: fail immediately; do not pretend they are missing and regenerate.
- Requirement information needed for initial-version generation is insufficient: ask the user to supply local materials per Stage 0 rules; do not invent.
- Initial-version generation fails: block subsequent updates.
- Incremental input is incomplete, spec freeze fails, or publish read-back fails: block the corresponding end; do not invent placeholder cases.
- An explicitly given PR / MR or custom repo URL cannot be fetched: block this code incremental per the script `error.code` (only `PR_PERMISSION_DENIED` means permission is insufficient; `PR_HEAD_REF_MISSING` asks for a local repo, branch name, or head SHA). Do not fall back to scraping a web page, and do not look for another link from the requirement body.
