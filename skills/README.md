# Skills

[简体中文](README.zh-CN.md)

Each skill is independently documented. Every published skill has an agent-facing `SKILL.md` and a human-facing `README.md`. The [root README](../README.md) links the sample report, quick starts, and per-skill documentation.

Install one skill with `npx skills add openqa-cn/codexqa --skill <name>` (for example `--skill codexqa-skill-router` or `--skill codexqa-defect-analyzer`).

## Available skills

- [`codexqa-skill-router`](codexqa-skill-router/): matches live siblings plus a bundled catalog, on-demand installs the winner beside the router, then hands off. Not a worker — it only selects, may fetch, and follows another skill. [How it works](codexqa-skill-router/HOW_IT_WORKS.md).
- [`codexqa-defect-analyzer`](codexqa-defect-analyzer/): SAST/lint/secrets/SCA plus Agent LLM Detection → `report_scan.*` (P0–P3, deduped). Not graph-evidence CR (`codexqa-code-reviewer`), not structure/impact (`codexqa-code-analyzer`), and not exception RCA (`codexqa-rootcause-analyzer`). [How it works](codexqa-defect-analyzer/HOW_IT_WORKS.md).
- [`codexqa-testcase-generator`](codexqa-testcase-generator/): conversation-driven test plans and manual cases (Plan 0–5, Exec 6, Incremental) from local requirements / HTTPS docs; local Markdown only, plus aggregated HTML report (`testcase_generation_report.html`). Live backend data is `codexqa-testdata-generator`. [How it works](codexqa-testcase-generator/HOW_IT_WORKS.md).
- [`codexqa-testdata-generator`](codexqa-testdata-generator/): construct reusable test data from domain slots, tools, APIs, and generated scripts; write values back as case-material preconditions. [How it works](codexqa-testdata-generator/HOW_IT_WORKS.md).
- [`codexqa-code-reviewer`](codexqa-code-reviewer/): CodexQA graph-evidence pack + heuristic dims + Agent LLM judgment (dedupe) → bilingual `REVIEW-REPORT.html` (PR/diff, full-repo, or adhoc). Not SAST + Agent LLM Detection scan reports (`codexqa-defect-analyzer`) and not structure/impact Q&A alone (`codexqa-code-analyzer`). [How it works](codexqa-code-reviewer/HOW_IT_WORKS.md).
- [`codexqa-requirement-analyzer`](codexqa-requirement-analyzer/): quality-and-risk analysis of requirement documents; one gap/conflict register with P0/P1 verification. Not a case writer — that is `codexqa-testcase-generator`. [How it works](codexqa-requirement-analyzer/HOW_IT_WORKS.md).
- [`codexqa-code-analyzer`](codexqa-code-analyzer/): local symbol-graph QA — index a repo, then review changes, bound regression, find test gaps, and trace errors with the `codexqa` CLI. [Skill README](codexqa-code-analyzer/README.md).
- [`codexqa-rootcause-analyzer`](codexqa-rootcause-analyzer/): exception root-cause diagnosis from stacks/logs on top of the CodexQA CLI; English gated report. Not structure/impact (`codexqa-code-analyzer`) and not code-risk scan (`codexqa-defect-analyzer`). [How it works](codexqa-rootcause-analyzer/HOW_IT_WORKS.md).

Use [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md) when proposing a new skill. A contribution should solve a distinct verification problem, include acceptance criteria, and provide reproducible evidence.
