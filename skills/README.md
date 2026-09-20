# Skills

[简体中文](README.zh-CN.md)

Each skill is independently documented. Every published skill has an agent-facing `SKILL.md` and a human-facing `README.md`. The [root README](../README.md) links the sample report, quick starts, and per-skill documentation.

## Available skills

- [`defect-detection`](defect-detection/): local-first defect review for git branches, PRs, and test plans (method-level extraction across 10 languages; HTML report + user confirm). [How it works](defect-detection/HOW_IT_WORKS.md).
- [`testcase-generation`](testcase-generation/): generate and update structured manual test cases from PRD, technical design, specs, and knowledge files. Cases keep `{placeholder}`s; backfill is `testdata-generation`. [How it works](testcase-generation/HOW_IT_WORKS.md).
- [`testdata-generation`](testdata-generation/): construct reusable test data from domain slots, tools, APIs, and generated scripts; write values back as case-material preconditions. [How it works](testdata-generation/HOW_IT_WORKS.md).
- [`code-reviewer`](code-reviewer/): playbook-driven P0/P1/P2 review of a local Git checkout (branch / PR / commit). Not a clone-and-detect workflow — that is `defect-detection`. [How it works](code-reviewer/HOW_IT_WORKS.md).
- [`requirements-analyzer`](requirements-analyzer/): quality-and-risk analysis of requirement documents; one gap/conflict register with P0/P1 verification. Not a case writer — that is `testcase-generation`. [How it works](requirements-analyzer/HOW_IT_WORKS.md).
- [`code-analyzer`](code-analyzer/): local symbol-graph QA — index a repo, then review changes, bound regression, find test gaps, and trace errors with the `codexqa` CLI. [Skill README](code-analyzer/README.md).
- [`code-wiki`](code-wiki/): local architecture knowledge graph — index a repo, export community digests with `wiki inputs` (no model), and write a Claude Code-style HTML wiki. [Skill README](code-wiki/README.md).

Use [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md) when proposing a new skill. A contribution should solve a distinct verification problem, include acceptance criteria, and provide reproducible evidence.
