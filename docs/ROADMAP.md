# Capability map and roadmap

[简体中文](ROADMAP.zh-CN.md)

codexqa's product direction covers the full AI software engineering quality lifecycle. Its current value is narrower and concrete: eight local-first verification skills turn requirements, architecture, code changes, reviews, cases, test data, code-risk scans, and exception diagnosis into separate, checkable workflows, plus [`codexqa-skill-router`](../skills/codexqa-skill-router/README.md) to auto-select and optionally fetch the right worker. This repository currently ships [`codexqa-skill-router`](../skills/codexqa-skill-router/README.md), [`codexqa-code-wiki`](../skills/codexqa-code-wiki/README.md), [`codexqa-code-analyzer`](../skills/codexqa-code-analyzer/README.md), [`codexqa-rootcause-analyzer`](../skills/codexqa-rootcause-analyzer/README.md), [`codexqa-defect-analyzer`](../skills/codexqa-defect-analyzer/README.md), [`codexqa-code-reviewer`](../skills/codexqa-code-reviewer/README.md), [`codexqa-requirement-analyzer`](../skills/codexqa-requirement-analyzer/README.md), [`codexqa-testcase-generator`](../skills/codexqa-testcase-generator/README.md), and [`codexqa-testdata-generator`](../skills/codexqa-testdata-generator/README.md). Capabilities marked **Available** or **Partial** below are delivered through those workflows unless stated otherwise. The remaining rows describe planned extensions, not features already included here.

## Capability map

| Capability | Current repository status | Scope |
| --- | --- | --- |
| Defect detection | **Available** | Agent-led static and business-logic review for code changes, test plans, and delivery tasks |
| Code analysis | **Available** | Local symbol graph for supported languages (`codexqa-code-analyzer`); `codexqa-defect-analyzer` adds SAST/lint/secrets/SCA plus Agent LLM Detection scan reports (dedupe/merge); parser and framework coverage still varies |
| Architecture knowledge graph | **Available** | `codexqa-code-wiki` exports Leiden communities and real `deps` with `wiki inputs` (no model) and writes a DeepWiki-style HTML wiki (sidebar + article + TOC); titles without a model stay rule titles |
| Requirement review | **Available** | Gap/conflict analysis of requirement documents (`codexqa-requirement-analyzer`); implementation-vs-requirement check is still planned |
| Specification review | **Planned** | Review technical specifications for completeness, consistency, and testability |
| AI Code Review | **Available** | CodexQA evidence-pack + heuristic dims + Agent LLM judgment (dedupe) → bilingual `REVIEW-REPORT.html` (`codexqa-code-reviewer`); fixture validate+render smoke locally |
| Change-impact analysis | **Available** | `codexqa-code-analyzer` traces changed symbols to callers and HTTP / RPC / MQ / scheduled-task entries inside one indexed repository; cross-repository impact analysis is planned |
| Test-gap analysis | **Available** | `codexqa-code-analyzer` checks symbol-level `tests` edges and reports changed production symbols with no graph-backed test relation |
| Test execution orchestration | **Planned** | Run and collect results from existing test frameworks as part of the verification workflow |
| Code coverage analysis | **Planned** | Runtime coverage signals and requirement-to-test coverage; symbol-level test-gap analysis is already available through `codexqa-code-analyzer` |
| UI end-to-end testing | **Planned** | Browser and UI workflow generation, execution, and result integration |
| Test-case generation | **Available** | Generate and update structured manual cases from PRD, technical design, specs, and knowledge files |
| Test-data construction | **Available** | Build reusable domain test data from slots, tools, APIs, and generated scripts; write constructed values back into case preconditions |
| Issue localization and diagnosis | **Available** | `codexqa-rootcause-analyzer` turns stacks/logs into a gated English RCA report on top of the CodexQA CLI; `codexqa-code-analyzer` still maps logs and error strings to symbols and callers; `codexqa-defect-analyzer` findings include file/line, evidence, severity (P0–P3), and suggestions. RCA narrative quality is model-judged and not independently scored |
| Evidence collection and structured findings | **Available** | Validation, write-back, ranking, tagging, and traceable HTML reports |
| Local providers and reports | **Available** | Local-first JSON persistence and report generation without a private backend |
| Enterprise and external integrations | **Partial** | HTTP and GitHub adapters are available in code and require deployment configuration |
| Quality gates and release decisions | **Product direction** | Connect verification results to CI gates and release workflows |
| Hosted verification services | **Product direction** | Managed engineering systems outside this repository |

## Status vocabulary

**Available** means usable in the current repository. **Partial** means a working path exists but coverage or integration is incomplete. **Planned** means not shipped here yet. **Product direction** means a broader codexqa platform goal.

A capability is marked available in this repository only when its implementation, example, and limitations are published. What has actually been checked per component: [support matrix](SUPPORT_MATRIX.md). What the workflows cannot do: [known limitations](../skills/codexqa-defect-analyzer/KNOWN_LIMITATIONS.md).

## Sequence

- **Now:** harden clean installation, agent compatibility, public fixtures, and developer documentation.
- **Next:** add specification review, deepen symbol-graph parser and framework coverage, and publish broader fixtures under the same evidence-and-human-review contract.
- **Later:** connect cross-repository impact analysis, AI Code Review, CI quality gates, and hosted engineering systems.

Progress is tracked in the [public roadmap](https://openqa.cn/roadmap). Released changes are in the [changelog](../CHANGELOG.md).
