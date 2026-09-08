# Requirements analysis: principles

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`requirements-analyzer`](README.md) does not ship a model. It is a fixed pipeline the host agent follows: audit the materials you already have, write **one** gap/conflict register, and attach executable verification to P0 / P1 items.

**Input is requirement text, not source code.** A PRD, stories, API notes, a scope sheet — not a git clone and not `code/`. See [README — What you give it](README.md#what-you-give-it).

Agents read [`SKILL.md`](SKILL.md) then [`prompts/requirements-analyzer.md`](prompts/requirements-analyzer.md), not this page. Gaps: [Known limitations](KNOWN_LIMITATIONS.md). Sample register: [preview](https://github.com/openqa-cn/openqa-skills/blob/main/docs/assets/previews/ra-register.html).

## Problem

Asking a model to “review this PRD” typically fails in three ways:

| Failure | Symptom | Constraint |
|---|---|---|
| Several overlapping lists | Gaps, conflicts, and “TOP 3 risks” repeat the same questions | Exactly one register (`RA-xx`). No extra gap/conflict chapters |
| Invented facts | Endpoints, SLAs, or a winner on a product dispute appear from nowhere | Unknowns stay questions. Conflicts keep both views and a suggested decider |
| Untestable P0 | “Improve completeness” with no oracle | P0/P1 need preconditions, stimulus, expected, evidence. No observable failure → `untestable` |

The model judges wording and conflicts. Grids in `references/` decide what “complete” means. Writing cases is [`testcase-generation`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/testcase-generation/README.md).

## Evaluation status

`evals/` is a skill-up case list (incomplete input, cross-source conflict, missing oracle). There is no published host-agent score and no answer-key fixture comparable to defect-detection's inventory-service 7/7. See [Known limitations](KNOWN_LIMITATIONS.md).

## What you will see

| When | Shown | Your reply |
|---|---|---|
| Thin or missing materials | First draft; assumptions and gaps marked | Supply the missing class, or accept the draft |
| Two sources disagree | One `conflict` row; both views; suggested owner | Decide; do not expect the skill to freeze the rule |
| Item has no observable failure | `untestable`, not executable P0 | Add an oracle, or leave it untestable |
| Analysis finished | 7-section Markdown (or the format you asked for) | Hand P0s to humans or to case writing |

## Mechanisms

### 1. Pipeline before risks

Intake → audit → grids → one register → risk → verification → blockers. Do not start with a “TOP 3” list.

### 2. One register

Status values and field names live in [`references/register-fields.md`](references/register-fields.md). Do not also emit “Gaps and Ambiguities” or “Cross-Source Conflicts”.

### 3. Do not invent the system

No endpoints, fields, SLAs, environments, or root causes the user did not provide. Stale or incomparable sources must not be marked `aligned`.

### 4. Role reports stay attributed

If a document has `source_role`, keep that role on each item. Do not flatten into anonymous consensus. A role Skill is never required.

## Pipeline

```text
PRD / stories / API notes / optional role reports
        │
        ▼
  Five-class intake + short-input gate
        │
        ▼
  Structure inventory + source audit + smell / NFR / KPI / dependency grids
        │
        ▼
  One gap/conflict register (RA-xx)
        │
        ▼
  Risk + testability (P0 needs FailureMode)
        │
        ▼
  Blockers and next actions
```

## Further reading

| Topic | Doc |
|---|---|
| What to bring, prompts | [README](README.md) |
| Observed boundaries | [Known limitations](KNOWN_LIMITATIONS.md) |
| Agent entry | [`SKILL.md`](SKILL.md) |
| Quality bar | [`prompts/requirements-analyzer.md`](prompts/requirements-analyzer.md) |
| Shortest path | [`quick-start.md`](quick-start.md) |
| What each published skill takes | [FAQ](https://github.com/openqa-cn/openqa-skills/blob/main/docs/FAQ.md) |
