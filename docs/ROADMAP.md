# Capability map and roadmap

[简体中文](ROADMAP.zh-CN.md)

codexqa's product direction covers the full AI software engineering quality lifecycle. Its current value is narrower and concrete: six local-first skills turn requirements, code changes, reviews, cases, and test data into separate, checkable workflows instead of one unconstrained AI conversation. This repository currently ships [`code-analyzer`](../skills/code-analyzer/README.md), [`defect-detection`](../skills/defect-detection/README.md), [`code-reviewer`](../skills/code-reviewer/README.md), [`requirements-analyzer`](../skills/requirements-analyzer/README.md), [`testcase-generation`](../skills/testcase-generation/README.md), and [`testdata-generation`](../skills/testdata-generation/README.md). Capabilities marked **Available** or **Partial** below are delivered through those workflows unless stated otherwise. The remaining rows describe planned extensions, not features already included here.

## Capability map

| Capability | Current repository status | Scope |
| --- | --- | --- |
| Defect detection | **Available** | Agent-led static and business-logic review for code changes, test plans, and delivery tasks |
| Code analysis | **Available** | Local symbol graph for supported languages (`code-analyzer`), plus AST-based rules and changed-method analysis in `defect-detection`; parser and framework coverage still varies |
| Requirement review | **Available** | Gap/conflict analysis of requirement documents (`requirements-analyzer`); implementation-vs-requirement check is still planned |
| Specification review | **Planned** | Review technical specifications for completeness, consistency, and testability |
| AI Code Review | **Available** | Playbook-driven PR / branch / commit review (`code-reviewer`); no published fixture yet |
| Change-impact analysis | **Available** | `code-analyzer` traces changed symbols to callers and HTTP / RPC / MQ / scheduled-task entries inside one indexed repository; cross-repository impact analysis is planned |
| Test-gap analysis | **Available** | `code-analyzer` checks symbol-level `tests` edges and reports changed production symbols with no graph-backed test relation |
| Test execution orchestration | **Planned** | Run and collect results from existing test frameworks as part of the verification workflow |
| Code coverage analysis | **Planned** | Runtime coverage signals and requirement-to-test coverage; symbol-level test-gap analysis is already available through `code-analyzer` |
| UI end-to-end testing | **Planned** | Browser and UI workflow generation, execution, and result integration |
| Test-case generation | **Available** | Generate and update structured manual cases from PRD, technical design, specs, and knowledge files |
| Test-data construction | **Available** | Build reusable domain test data from slots, tools, APIs, and generated scripts; write constructed values back into case preconditions |
| Issue localization and diagnosis | **Partial** | `code-analyzer` maps logs, stack text, and error strings to symbols and callers; `defect-detection` findings include locations, triggers, reasoning, and fixes; automated root-cause diagnosis is still limited |
| Evidence collection and structured findings | **Available** | Validation, write-back, ranking, tagging, and traceable HTML reports |
| Local providers and reports | **Available** | Local-first JSON persistence and report generation without a private backend |
| Enterprise and external integrations | **Partial** | HTTP and GitHub adapters are available in code and require deployment configuration |
| Quality gates and release decisions | **Product direction** | Connect verification results to CI gates and release workflows |
| Hosted verification services | **Product direction** | Managed engineering systems outside this repository |

## Status vocabulary

**Available** means usable in the current repository. **Partial** means a working path exists but coverage or integration is incomplete. **Planned** means not shipped here yet. **Product direction** means a broader codexqa platform goal.

A capability is marked available in this repository only when its implementation, example, and limitations are published. What has actually been checked per component: [support matrix](SUPPORT_MATRIX.md). What the workflows cannot do: [known limitations](../skills/defect-detection/KNOWN_LIMITATIONS.md).

## Sequence

- **Now:** harden clean installation, agent compatibility, public fixtures, and developer documentation.
- **Next:** add specification review, deepen symbol-graph parser and framework coverage, and publish broader fixtures under the same evidence-and-human-review contract.
- **Later:** connect cross-repository impact analysis, AI Code Review, CI quality gates, and hosted engineering systems.

Progress is tracked in the [public roadmap](https://openqa.cn/roadmap). Released changes are in the [changelog](../CHANGELOG.md).
