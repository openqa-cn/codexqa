# Skills

[简体中文](README.zh-CN.md)

Each skill is independently documented. Every published skill has an agent-facing `SKILL.md` and a human-facing `README.md`. The [root README](../README.md) links the sample report, quick starts, and per-skill documentation.

Install one skill with `npx skills add openqa-cn/codexqa --skill <name>` (for example `--skill skill-router` or `--skill defect-detection`).

## Available skills

- [`skill-router`](skill-router/): matches live siblings plus a bundled catalog, on-demand installs the winner beside the router, then hands off. Not a worker — it only selects, may fetch, and follows another skill. [How it works](skill-router/HOW_IT_WORKS.md).
- [`defect-detection`](defect-detection/): SAST/lint/secrets/SCA plus Agent LLM Detection → `report_scan.*` (P0–P3, deduped). Not graph-evidence CR (`ai-code-reviewer`), not structure/impact (`code-analyzer`), and not exception RCA (`root-cause-diagnosis`). [How it works](defect-detection/HOW_IT_WORKS.md).
- [`testcase-generation`](testcase-generation/): conversation-driven test plans and manual cases (Plan 0–5, Exec 6, Incremental) from local requirements / HTTPS docs; local Markdown only, plus aggregated HTML report (`testcase_generation_report.html`). Live backend data is `testdata-generation`. [How it works](testcase-generation/HOW_IT_WORKS.md).
- [`testdata-generation`](testdata-generation/): construct reusable test data from domain slots, tools, APIs, and generated scripts; write values back as case-material preconditions. [How it works](testdata-generation/HOW_IT_WORKS.md).
- [`ai-code-reviewer`](ai-code-reviewer/): CodexQA graph-evidence pack + heuristic dims + Agent LLM judgment (dedupe) → bilingual `REVIEW-REPORT.html` (PR/diff, full-repo, or adhoc). Not SAST + Agent LLM Detection scan reports (`defect-detection`) and not structure/impact Q&A alone (`code-analyzer`). [How it works](ai-code-reviewer/HOW_IT_WORKS.md).
- [`requirements-analyzer`](requirements-analyzer/): quality-and-risk analysis of requirement documents; one gap/conflict register with P0/P1 verification. Not a case writer — that is `testcase-generation`. [How it works](requirements-analyzer/HOW_IT_WORKS.md).
- [`code-analyzer`](code-analyzer/): local symbol-graph QA — index a repo, then review changes, bound regression, find test gaps, and trace errors with the `codexqa` CLI. [Skill README](code-analyzer/README.md).
- [`root-cause-diagnosis`](root-cause-diagnosis/): exception root-cause diagnosis from stacks/logs on top of the CodexQA CLI; English gated report. Not structure/impact (`code-analyzer`) and not code-risk scan (`defect-detection`). [How it works](root-cause-diagnosis/HOW_IT_WORKS.md).

Use [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md) when proposing a new skill. A contribution should solve a distinct verification problem, include acceptance criteria, and provide reproducible evidence.
