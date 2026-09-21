# codexqa-testcase-generator user guide

Conversation-driven local test-plan and test-case generation. You say whether you want a test plan, test cases, or both; the Skill persists Markdown locally through fixed stages. It does not connect to a case platform or a doc platform, and it does not call an external knowledge-retrieval Skill.

Finer stage rules are in `SKILL.md` and its `references/`. This file covers **how to use it** and **the current policy** only.

---

## 1. What you say, what the Skill runs

| Your intent | What the Skill does | Where it stops |
|---|---|---|
| Generate a test plan / plan only | Full **Plan** (Stages 0–5) | Stage 0–4-1 artifacts + composed `testdesign/test_design.md` (file alone is not Plan-done) |
| Generate cases / cases only, and a formal test plan exists | Full **Exec** (Stage 6) | `{run_dir}/testcase/initialcase/` and `cases/` |
| Both plan and cases | Full Plan first; after the plan is on disk, ask once, then Exec on confirmation | Plan first, then cases |
| Want cases but the plan is missing or incomplete | Explain why, complete Plan, then ask whether to write cases | Must not skip Plan |
| Pre-submit edit of existing cases | Follow `references/presubmit-case-edit.md` | Do not redo the whole test plan |
| Post-submit incremental / enhance existing cases | **Incremental** inside this Skill (diff enhancement or direct update) | `{run_dir}/testcase/cases/`; process area in `.case-enhance/` |
| Incremental cases from a PR / custom repo URL | Incremental `DIFF_ENHANCEMENT` only with a baseline: git-fetch into `.pr-cache/` then diff; bootstrap an initial version if there is no baseline | `{run_dir}/testcase/cases/` |

If intent is unclear, ask first; do not guess. "Just the result", "skip init", and "not enough information" cannot skip analysis, audit, or validation. Missing facts are marked pending clarification; do not invent them.

Specifying APP / Web / server only limits the output end; it does not cut that end's internal steps.

---

## 2. What you need to provide

### Requirement input (required when Plan must run)

Accepted:

- Local files (for example `prd.md`, a technical design)
- A local directory
- Body text pasted in the conversation
- `http(s)://` document URLs you give in this turn (any host; the Skill fetches that page as Stage 0 body and does not crawl other links on the page)

If a URL fetch fails or is login-walled, export or paste the body instead.

**Incremental exception (code only):** when you explicitly say to increment cases from a PR / MR or a custom git repo URL, this Skill git-fetches into `{run_dir}/testcase/.pr-cache/`, then diff-enhances existing cases. Supported: GitHub/GitLab-style links, `https://dev.example.com/code/repo-detail/{group}/{repo}/pr/{n}` (optional `/diff`), and `https://` / `git@host:path` / `ssh://git@host/path`. Requires existing `testcase/cases/` (or a baseline you specify); without a baseline, bootstrap an initial version first and do not fetch code yet. Failures are explained by the script `error.code`: `PR_PERMISSION_DENIED` only means permission denied; `PR_HEAD_REF_MISSING` asks for a local repo path, branch name, or head SHA. With a local repo, default to local git objects only and do not change your working tree. Links inside requirement text are not treated as repo URLs.

**Examples:**

> Generate a test plan: /Users/me/docs/prd.md
>
> This directory has a PRD and a technical design; generate a test plan: /Users/me/docs/feature-x/
>
> Generate a test plan from https://docs.example.com/prd/feature-x
>
> I want both the plan and the cases. Requirements: …

### Knowledge supplement (optional, not a gate)

Facts come first from requirements / technical design / prior reports; how to analyze and write the plan and cases comes from this repo's built-in norms. Extra business knowledge is used only when you **actively provide** it:

| You provide | What the Skill does |
|---|---|
| A local knowledge directory | Scan `.md` / `.txt`, generate `{run_dir}/knowledge/index.md`, close-read by keyword in each stage |
| Explicitly say "this is a knowledge-repo URL" and paste a Git URL | Shallow-clone to `knowledge/repo/`, then build `index.md`, then the same local close reading |
| Neither | An empty index is valid; finish with requirements + built-in norms; mark gaps as pending clarification |

Git URLs support only `https://…`, `git@…`, and `ssh://git@…`, optionally with `#branch`. Links in requirement text are **not** treated as a knowledge repo. Mid-run, the Skill will not ask you for a knowledge directory or Git URL just to fill dimensions. It does not call an external knowledge-retrieval Skill.

If clone fails, write an empty index, record the failure, and continue Plan / Exec.

---

## 3. Quick start

Send local requirements or document URLs you give this turn, and state the goal. No remote-space binding. No doc-platform or identity CLI to install.

```
You: Generate a test plan; materials are at /Users/me/docs/prd.md
AI: Init run_dir → Stages 0–5 → persist the formal test plan → ask whether to generate cases
You: Continue and generate cases
AI: Stage 6, write local cases from the formal test plan
```

Optional knowledge at the same time:

```
You: Generate a test plan. Requirements: /Users/me/docs/prd.md
    Knowledge repo: https://git.example.com/team/biz-knowledge.git#main
```

or:

```
You: Use knowledge directory /Users/me/kb/biz ; requirements are in /Users/me/docs/feature-x/
```

---

## 4. Stages and artifacts (aligned with current rules)

| Stage | What it does | Main artifacts |
|---|---|---|
| 0 | Local requirement ingest; optional bootstrap of a knowledge directory or user Git URL | `testcase/testdocs/` materials, `userConfig.json` |
| 1 | Extract functions, rules, and test objects from requirement text | `stage1-requirement-analysis-report.md` |
| 2 | Impact and risk analysis, primarily from the technical design | `stage2-impact-and-risk-report.md` |
| 3 | Local coverage judgment; no remote space; treat all as new | `stage3-coverage-judgment-report.md` |
| 4 | Design scenarios with built-in type models and fusion rules; add team rules only if a local pack exists | `stage4-test-design-report.md` |
| 4-1 | Fill gaps from prior reports and inputs; three audit rounds (edit the Stage 4 report in place) | `stage4-1-audit-receipt.md` + in-place Stage 4 report |
| 5 | Integrate prior reports only; no new retrieval, no new scenarios | `testdesign/test_design.md` |
| 6 | Write cases from the formal test plan + built-in three-end templates | `testcase/initialcase/`, `testcase/cases/` |
| Incremental | Diff-enhance or directly update on an existing baseline; do not rerun the test plan | `testcase/cases/`; process area `.case-enhance/{executionId}/` |

Plan stops after Stage 5 and asks whether to Exec. If you asked for plan + cases from the start, still confirm once after the plan is on disk. Post-submit incremental does not change the formal test plan.

---

## 5. Working directory

`{run_dir}` is created or reused by this Skill: your specified directory → existing `userConfig.runDir` → default `$HOME/codexqa-testdata-generator/runs/{runid}`. `runid` is this task id. Original internal subdirectories (test plan, test cases, and so on) still live under that `run_dir`. Artifacts are not written outside it.

The full path map is the "Path conventions for later stages" section in `references/run-workspace.md`. Sketch:

```
{run_dir}/
├── knowledge/                 ← optional knowledge pack (index.md; Git clone in repo/)
├── testdesign/
│   ├── test_design.md         ← Stage 5 only formal test plan
│   ├── testcase_generation_report.html  ← Stage 6 aggregated Web/Server/APP case report
│   └── testdesign_changelog.md
└── testcase/
    ├── testdocs/              ← userConfig and Stage 0–4-1 materials/reports
    ├── knowledge-biz/         ← close-reading and decision traces
    ├── initialcase/           ← Stage 6 initial cases (read-only for incremental)
    ├── procase/               ← first diff-enhancement protection copy; read-only after
    ├── cases/                 ← current valid cases (incremental publish target)
    ├── .case-enhance/         ← incremental process area (isolated by executionId)
    └── .pr-cache/             ← PR code cache when a URL is explicitly given
```

Local Markdown is the only edit source. Edit the files directly to change the test plan or cases.

---

## 6. userConfig.json

Path: `{run_dir}/testcase/testdocs/userConfig.json`. Written automatically on first init; not a remote-space binding wizard. `runDir` must be an expanded absolute path; when no directory is specified, default to `$HOME/codexqa-testdata-generator/runs/{runid}`.

```json
{
  "projectId": "",
  "projectName": "",
  "projectSource": "none",
  "staffId": "",
  "initTime": "2026-03-12 00:00:00",
  "runid": "20260820-143000",
  "runDir": "/Users/name/codexqa-testdata-generator/runs/20260820-143000",
  "knowledgeSource": "",
  "knowledgeGitUrl": "",
  "knowledgeGitRef": ""
}
```

| Field | Meaning |
|---|---|
| `projectId` / `projectName` / `staffId` | Reserved empty fields; no remote-space binding |
| `projectSource` | Fixed `none` |
| `runid` / `runDir` / `initTime` | This task id, run root (default `$HOME/codexqa-testdata-generator/runs/{runid}`), and init time |
| `knowledgeSource` | Local knowledge directory you provided; empty if none |
| `knowledgeGitUrl` / `knowledgeGitRef` | Knowledge-repo URL you explicitly gave, and optional branch |

`userConfig` ignores `planSaveMode` / `docsParentId`. The test plan is local Markdown only.

When `userConfig.json` already exists, reuse the same `run_dir`; do not re-init every time. If this turn you actively give a new knowledge directory or Git URL, the `knowledge/` index is overwritten and the matching fields are updated.

---

## 7. Cleanup

Artifacts are kept by default. When you explicitly ask to delete, the AI lists the scope first, then after confirmation deletes only Skill process artifacts, keeping the case baseline (`initialcase/`, `cases/`, `procase/`) and `userConfig.json`.

---

## 8. FAQ

**What do I need the first time?**  
A local requirement file or directory, plus one sentence saying you want a test plan or test cases. A knowledge directory or Git URL is optional.

**Does it sync to a case platform or a doc platform?**  
No. Local Markdown only.

**Where are the files?**  
Stages 0–4-1 are in `{run_dir}/testcase/testdocs/`; the formal test plan is `{run_dir}/testdesign/test_design.md`; initial cases are in `{run_dir}/testcase/initialcase/`; the current valid copy is in `testcase/cases/`. The post-submit incremental process area is `testcase/.case-enhance/{executionId}/`.

**Where is post-submit incremental done?**  
All inside this Skill. Compare old vs new materials or edit existing cases from comments. If there is no initial version, complete the plan / initial version first, then continue incremental.

**Where does knowledge come from?**  
A local directory, or a shallow clone of a Git URL you explicitly gave; close reading uses the local `index.md`. The run can finish without knowledge. It does not call an external knowledge-retrieval Skill.

**If the requirements contain a Git / web link, is it treated as a knowledge repo?**  
No. It is fetched only when you explicitly say "this is a knowledge-repo URL".

**Can a PR link or custom repo URL auto-fill cases?**  
Yes, but you must explicitly say to increment from that URL, and a case baseline must already exist. This Skill uses git and does not depend on `gh`. Supported: GitHub/GitLab PR/MR, `https://dev.example.com/code/repo-detail/{group}/{repo}/pr/{n}` (optional `/diff`), and `https` / `git@` / `ssh://git@` custom repos. Private repos need local Git permission, or a local repo path (optionally plus a branch or head commit). Only `PR_PERMISSION_DENIED` means permission denied; `PR_HEAD_REF_MISSING` asks for a local repo, branch name, or head SHA; other failures report the script `error.code`. PRD web links are still not fetched.

**How do I self-check scripts?**  
Run `<skill_dir>/scripts/tcg-python scripts/incremental/pull_remote_code.py --self-check` (offline parse and permission classification). Run `<skill_dir>/scripts/tcg-python scripts/check_run_gate.py --self-check` and `<skill_dir>/scripts/tcg-python scripts/close_stage.py --self-check` for the Stage 5/6 artifact gate and Plan/Exec `run-status.json` pointer. Stage 0 ingest script stdout should be JSON containing `ok` and `gapStats`. After each Plan/Exec persist the Agent must run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <run_dir> --stage <N>`. After an interrupt, resume from `testcase/testdocs/run-status.json` `currentStage`; do not jump to `test_design.md`. Before Stage 5 or Stage 6 the Agent must run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/check_run_gate.py --run-dir <run_dir> --gate stage5|stage6`; if `ok` is false it must not write the formal plan or cases. Stage 6 also requires `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <run_dir> --allow-exec` after the user confirms.

**Can I change the generated result?**  
Yes. Edit the local Markdown directly.
