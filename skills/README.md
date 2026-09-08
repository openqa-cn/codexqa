# Skills

Each skill is independently documented. Every published skill has an agent-facing `SKILL.md` and a human-facing `README.md`.

## Available skills

- [`defect-detection`](defect-detection/): local-first defect review for git branches, PRs, and test plans (method-level on Java/Kotlin; HTML report + user confirm). [How it works](defect-detection/HOW_IT_WORKS.md).
- [`testcase-generation`](testcase-generation/): generate and update structured manual test cases from PRD, technical design, specs, and knowledge files. Cases keep `{placeholder}`s; backfill is `testdata-generation`. [How it works](testcase-generation/HOW_IT_WORKS.md).
- [`testdata-generation`](testdata-generation/): construct reusable test data from domain slots, tools, APIs, and generated scripts; write values back as case-material preconditions. [How it works](testdata-generation/HOW_IT_WORKS.md).
- [`code-reviewer`](code-reviewer/): playbook-driven P0/P1/P2 review of a local Git checkout (branch / PR / commit). Not a clone-and-detect workflow — that is `defect-detection`. [How it works](code-reviewer/HOW_IT_WORKS.md).
- [`requirements-analyzer`](requirements-analyzer/): quality-and-risk analysis of requirement documents; one gap/conflict register with P0/P1 verification. Not a case writer — that is `testcase-generation`. [How it works](requirements-analyzer/HOW_IT_WORKS.md).

Use [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md) when proposing a new skill. A contribution should solve a distinct verification problem, include acceptance criteria, and provide reproducible evidence.
