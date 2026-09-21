---
name: codexqa-testcase-generator
description: Generates test plans and test cases from local requirements for APP, Web, and server. Use when the user wants a test plan, test analysis, test design, write cases, both plan and cases, PRD-based testing, pre-submit case edits, post-submit incremental, PR/git regression, or says 测试方案、测试分析、测试设计、测试计划、只要方案、写用例、出用例、只要用例、方案和用例都要、按 PRD 出测试、提测前改用例、提测后增量、按 PR 或 git 补回归用例、帮我出测试、补测试、做一轮测试设计. Do not switch to other case-generation, knowledge-retrieval, or generic writing skills even if unnamed. Input is local files, directories, pasted text, or HTTPS document URLs the user gives this turn; output is local Markdown only. Complete Plan and Exec without skipping. For code incremental, require a case baseline before fetching the given PR/MR/git URL; otherwise bootstrap first. Does not connect to case or doc platforms.
  Former skill name: testcase-generation.
license: MIT
compatibility: >-
  Requires Python 3.10+ on PATH (use `scripts/tcg-python` when system `python3`
  is older). Git is required only when the user gives a knowledge-repo Git URL,
  or an Incremental PR/git URL.
metadata:
  version: "V56"
---

# codexqa-testcase-generator

This file is the Agent execution map: decide the scope first, then read only the references that scope needs. How the user phrases requests and where artifacts go: [user-guide.md](user-guide.md). Do not use the user guide to cut stages — skipping steps makes the test plan and test cases drift apart.

`README.md` / `README.zh-CN.md` / `HOW_IT_WORKS.md` / `KNOWN_LIMITATIONS.md` (and their `.zh-CN` twins) are human-facing. Do not load them at runtime.

When invoking skill scripts, **always** use `<skill_dir>/scripts/tcg-python` (resolves Python 3.10+ on PATH). Do not use bare `python3` — on some hosts it is too old and will exit before gates run.

References longer than about 300 lines start with a "Reading guide". Read in those segments; do not load the whole file at once.

## 1. Route first

Scope can only be decided from the user's original words. Before reading materials, creating directories, or writing a test plan or test cases, read [references/entry-routing.md](references/entry-routing.md) and clear the gate. Ask before acting; do not guess that the user "really only wants cases".

| The user is roughly saying | Take this path |
|---|---|
| test plan / test analysis / test design / plan only | **Plan** |
| write cases / cases only, and a formal test plan is available | **Exec** |
| both plan and cases / from requirements through cases | Full **Plan** first; after the plan is on disk, ask once, then **Exec** on confirmation |
| pre-submit edit of a case or a field | **pre-submit update** |
| post-submit incremental / add to existing cases from a PR or git | **Incremental** (bootstrap an initial version if there is no baseline) |
| unclear | Ask whether they want a test plan, test cases, both, or incremental |

The same conversation can run Plan then Exec; both segments must be complete. Incremental is a sibling scope, not Stage 7, and does not rerun the whole test plan.

## 2. Scopes and done criteria

| Scope | What to do | Done when |
|---|---|---|
| **Plan** (Stages 0–5) | Ingest requirements through a formal test plan | Stage 0–4-1 artifacts + last `check_run_gate.py --gate stage5` stdout `ok: true` + last `close_stage.py --stage 5` stdout `ok: true`. The file alone is not done. |
| **Exec** (Stage 6) | Write local test cases from the formal test plan | `{run_dir}/testcase/initialcase/` and dual-write `cases/` + `{run_dir}/testdesign/testcase_generation_report.html` + last `check_run_gate.py --gate stage6` stdout `ok: true` + last `close_stage.py --stage 6` stdout `ok: true` |
| **pre-submit update** | Edit existing cases from the conversation; do not redo the test plan | `{run_dir}/testcase/initialcase/` |
| **Incremental** | Diff-enhance or directly update on an existing baseline | `{run_dir}/testcase/cases/` has been read back; the process area has decisions and a report |

## 3. Boundaries (and why)

These boundaries exist to avoid dropping a half-finished artifact and later patching it, and to keep the test plan, test cases, and incremental work from polluting each other.

1. **Plan does not write test cases; Exec does not redo the test plan.** Cases must be anchored to the formal test plan already on disk; writing cases during the plan stage means they drift when the design later changes.
2. **Do not cut steps.** "Just the result", "skip init", and "no knowledge pack" are not reasons to skip routing, audit, coverage, or persist. What is missing is facts, not stages.
3. **Exec accepts only Stage 5's** `{run_dir}/testdesign/test_design.md`. If the file is missing, unreadable, or has no final client-type decision, complete Plan first, then ask whether to write cases. Do not guess, and do not substitute a simplified case set.
4. **Incremental does not change the formal test plan.** Incremental maintains existing cases. If the user also wants a new test plan, run full Plan first, then decide Exec or incremental from confirmation.
5. **If information is missing, clarify or mark pending clarification / TBD.** Fall back to the matching stage. Do not invent business facts. Do not call an external knowledge-retrieval Skill.
6. **Write local Markdown only.** `run_dir` is created or reused by this Skill from the conversation. Do not connect to a case platform or a doc platform.
7. **After the current scope is on disk and work receipts are written, ask about the next step.**

## 4. After routing: directory and knowledge

Read [references/shared-rules.md](references/shared-rules.md) and [references/run-workspace.md](references/run-workspace.md), then confirm `run_dir` (`userConfig.runDir` → user-specified → default `$HOME/codexqa-testdata-generator/runs/{runid}`). `userConfig.runDir` is the same path as the working directory; first write or a missing-field fill uses this default. After routing, the first script is `close_stage.py --init`, not writing the plan. Then read `{run_dir}/testcase/testdocs/run-status.json` and continue from `currentStage`. Do not jump to `test_design.md`. User-given `http(s)://` document URLs this turn are Stage 0 input: persist the fetched body under `testcase/testdocs/`; `ingest_local_docs.py` is optional.

Knowledge follows only [references/knowledge-adapter.md](references/knowledge-adapter.md):

**Requirements / technical design / prior reports → built-in norms in this repo → a local knowledge directory or an explicitly given Git URL the user already provided (optional)**

When the user actively pastes a knowledge-repo URL, shallow-clone it, then read the local `index.md`. An empty index is valid; continue with built-in norms. Write a work receipt for every actual action.

| Scope | Knowledge-read limit |
|---|---|
| Stage 0 | May bootstrap a local directory or user Git URL; empty index is valid. No business close reading |
| Stages 1–4 | Facts come from requirements / technical design; close-read only if a local pack exists |
| Stage 4-1 | Fill only gaps that prior stages did not cover and that the inputs can verify |
| Stage 5 | Integrate prior reports only; no new retrieval, no new scenarios |
| Stage 6 | Use the formal test plan and the three-end templates first; read the pack only if test-data setup / format gaps remain and a local pack already exists |
| Incremental | Use the formal test plan, the frozen baseline, and Chapter 3 of the three-end templates first; read the pack only if compatibility / regression / test-data setup gaps remain and a local pack already exists |

## 5. Plan (test plan)

After the gate, choose a mode. Automatic: do not wait for the user between Stages 0–5. Manual: persist, summarize, and continue after confirmation. Neither mode may omit a stage or merge persist. Each stage must write its artifacts, run close_stage.py --stage N, then read only the next row’s files plus prior artifacts.

When entering a stage, read only that row's files. Each stage file opens with Minimum persist; the gate checks those headings.

| Stage | Read | Goal | Main artifacts |
|---|---|---|---|
| 0 | [s00-req-ingest.md](references/s00-req-ingest.md) | Persist local or user-given HTTPS materials and validate | `testcase/testdocs/`, `userConfig.json`, `run-status.json`, Stage 0 receipts |
| 1 | [s01-req-analysis.md](references/s01-req-analysis.md) | Identify terms, flows, rules, functions, and test objects from requirements | Stage 1 report, `stage1-*/index.json` |
| 2 | [s02-impact-risk.md](references/s02-impact-risk.md) | Impact and risk from the technical design | Stage 2 report, `stage2-*/index.json` |
| 3 | [s03-coverage-judge.md](references/s03-coverage-judge.md) | Local coverage judgment; no remote space; treat all as new | Stage 3 report, `stage3-*/index.json` |
| 4 | [s04-object-design.md](references/s04-object-design.md), [scene-fusion.md](references/scene-fusion.md) | Design scenarios with built-in models | Stage 4 report, `stage4-*/index.json` |
| 4-1 | [s04a-design-audit.md](references/s04a-design-audit.md) | Three audit rounds; edit the Stage 4 report in place | `stage4-1-audit-receipt.md` + in-place Stage 4 report |
| 5 | [s05-plan-compose.md](references/s05-plan-compose.md), [plan-md-template.md](references/plan-md-template.md), [plan-export-notes.md](references/plan-export-notes.md) | Integrate prior conclusions only | `testdesign/test_design.md`, changelog |

After each Plan/Exec persist, run:

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage <N>
```

Before Stage 5 writes the plan, run `--gate stage5`. After Stage 6 dual-writes `initialcase/` and `cases/`, run `--gate stage6` (missing `cases/` fails).

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/check_run_gate.py --run-dir <userConfig.runDir> --gate stage5
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/check_run_gate.py --run-dir <userConfig.runDir> --gate stage6
```

Redirect stdout only (see shared-rules). If `ok` is false, do not write `test_design.md`, and do not claim Exec done. Resume from `run-status.json` `currentStage` or the first item in `failures`. The gate rejects heading-only reports, stub `index.json`, a missing or empty `stage4-1-audit-receipt.md`, empty Loop bodies, a plan missing Minimum persist headings or empty plan chapters, a plan whose `S-xx` set does not match Stage 4, and Stage 6 without `cases/` dual-write. Stage 5 gate requires `currentStage` `5` and `4-1` in `completed`. Before saying Plan is done, this turn must have run `--gate stage5` and you must cite that stdout `ok: true`. Before saying Exec is done, this turn must have run `--gate stage6` and you must cite that stdout `ok: true`. Without that JSON, say draft.

After composing the plan, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 5` (sets `planPersistedAt`, keeps `execAllowed=false`). Ask whether to generate test cases, then stop this turn. Do not run `--allow-exec`, do not read s06, and do not write cases in the same turn that first persisted `test_design.md`. A later user message that confirms Exec is required before `--allow-exec`.

## 6. Exec (test cases)

Start Exec only after a later user message that confirms Exec. Then run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --allow-exec`. If `execAllowed` is still false, do not write cases. Then read [references/s06-case-write.md](references/s06-case-write.md). Accept only the Stage 5 formal test plan. After dual-write to `initialcase/` and `cases/`, run `check_run_gate.py --gate stage6` via `tcg-python`, then `close_stage.py --stage 6` via `tcg-python`. Without stage6 stdout `ok: true`, say draft.

Finish in order: client-type routing → necessary knowledge close reading → decompose and write from templates → coverage check → local persist (dual-write) → aggregated HTML report. Three-end writing follows Stage 6 and the matching `case-tpl-*.md`. After dual-write, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/generate_case_report.py --run-dir <userConfig.runDir>` and cite the stdout `out` path (`{run_dir}/testdesign/testcase_generation_report.html`). The report aggregates Web / Server / APP case sets (missing ends show empty-state). Do not upload to a case platform. Do not write remote docs.

## 7. Pre-submit update

When the user wants to edit existing cases, and it is not a plan redo and not post-submit incremental, read [references/presubmit-case-edit.md](references/presubmit-case-edit.md). Write only `{run_dir}/testcase/initialcase/`. Do not merge with Incremental.

## 8. Incremental (post-submit incremental)

Before starting, read [references/postsubmit-enhance.md](references/postsubmit-enhance.md). Diff-enhance or directly update only on an existing valid baseline. If the target end has no baseline, bootstrap an initial version per [references/postsubmit-bootstrap.md](references/postsubmit-bootstrap.md), then continue incremental.

Finish in order: identity confirm → execution workspace → freeze Chapter 3 of the three-end templates → archive inputs → change / intent analysis → per-end decisions → environment review (if any) → container placement read-back → publish. Details follow `references/incremental/` and `scripts/incremental/`.

**Valid baseline** is defined in [references/incremental/input-spec.md](references/incremental/input-spec.md): user-explicit cases, or that end's `testcase/cases/`; read `initialcase/` only when that `cases/` path does not exist. If `cases/` exists but is empty or corrupt, do not fall back.

When the user this turn explicitly gives a PR / MR, a Code-platform `/code/repo-detail/.../pr/{n}`, or a git repo URL, and routing is `DIFF_ENHANCEMENT`: confirm a valid baseline first. Do not call `pull_remote_code.py` without a baseline. With a baseline, fetch locally and archive per [references/incremental/code-fetch-spec.md](references/incremental/code-fetch-spec.md).

When explaining failures to the user, follow the script `error.code`:

- `PR_PERMISSION_DENIED`: permission denied
- `PR_HEAD_REF_MISSING`: ask for a local repo, branch name, or head SHA
- other: report that error code
