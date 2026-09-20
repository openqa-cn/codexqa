# How testcase-generation works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`testcase-generation`](README.md) turns local requirements into a formal test plan and/or Markdown cases. The host agent follows staged references; Python scripts gate and close each stage. There is no case-platform or doc-platform connection.

The runtime contract is in [`SKILL.md`](SKILL.md). Usage phrasing: [`user-guide.md`](user-guide.md).

## Data flow

```text
local files / paste / HTTPS doc URL (+ optional knowledge dir or Git URL)
        │
        ▼
   entry routing (Plan | Exec | pre-submit | Incremental)
        │
        ├─ Plan 0→5  →  testdocs reports + testdesign/test_design.md
        │                 (check_run_gate stage5 + close_stage)
        ├─ Exec 6    →  testcase/initialcase/ + cases/ dual-write
        │                 + testdesign/testcase_generation_report.html
        │                 (allow-exec → dual-write → generate_case_report → gate stage6 + close_stage)
        └─ Incremental → .case-enhance/ process + updated cases/
                          (optional PR/git fetch into .pr-cache/)
```

1. **Route** — from the user's words only (`references/entry-routing.md`). Ask if unclear; do not invent "cases only".
2. **Workspace** — `close_stage.py --init`, then continue from `run-status.json` `currentStage`.
3. **Plan** — Stages 0–4-1 produce reports; Stage 5 composes `test_design.md` only after gate `stage5` stdout `ok: true`.
4. **Exec** — only after a later user confirmation and `--allow-exec`; dual-write cases; generate the aggregated HTML report; gate `stage6`.
5. **Incremental** — sibling scope on an existing baseline; optional code fetch when the user gives a PR/git URL.

## What scripts own vs the model

| Layer | Owns |
|---|---|
| `close_stage.py` / `check_run_gate.py` / `generate_case_report.py` / ingest & incremental scripts | Run status, stage gates, aggregated HTML report, doc ingest helpers, PR fetch, freeze helpers |
| Host agent | Routing, analysis prose, plan chapters, case bodies under `references/` |
| Built-in templates (`case-tpl-*.md`, plan template) | End-specific case shape and plan Minimum persist headings |

## Relationship to other skills

| Skill | Difference |
|---|---|
| [`requirements-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/requirements-analyzer/README.md) | Requirement quality / gap register — does not write a case library |
| [`testdata-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testdata-generation/README.md) | Live backend IDs and precondition write-back — not plan/case authoring |
| [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.md) / [`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.md) | Code-risk scan or graph-evidence review — not test design |

## Evidence status

`scripts/tcg-python scripts/close_stage.py --self-check`, `check_run_gate.py --self-check`, and `generate_case_report.py --self-check` cover offline fixtures. There is no published host-agent score for full Plan→Exec runs. See [Known limitations](KNOWN_LIMITATIONS.md).
