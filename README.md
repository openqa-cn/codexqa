# OpenQA Skills

**Quality verification infrastructure for AI software engineering, from requirements to release.**

[![CI](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[简体中文](README.zh-CN.md)

<p align="center">
  <a href="#capability-map"><strong>Capability Map</strong></a> ·
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="examples/checkout-boundary/README.md"><strong>Runnable Example</strong></a> ·
  <a href="docs/GETTING_STARTED.md"><strong>Getting Started</strong></a> ·
  <a href="docs/FAQ.md"><strong>FAQ</strong></a> ·
  <a href="docs/SUPPORT_MATRIX.md"><strong>Support Matrix</strong></a>
</p>

AI Coding makes implementation cheaper, but a patch can still miss a requirement, weaken a test, break an indirect caller, or pass checks that do not exercise the intended behavior. OpenQA is building a verification layer that connects repository context, requirements, tests, analysis, evidence, and human release decisions.

> **Coding Agents help create changes. OpenQA helps review whether those changes are ready to trust.**

Use this repository when you want to:

- Review a pull request, branch, test plan, or delivery task against explicit requirements
- Find static and business-logic defect candidates before human review
- Turn analysis into structured findings with locations, triggers, reasoning, and suggested fixes
- Run locally first, while retaining optional integration points for existing engineering systems

## What this repository provides

`openqa-skills` is OpenQA's public, local-first skill layer for Coding Agents. It currently ships [`ai-defect-detection`](skills/ai-defect-detection/README.md): an executable workflow for reviewing code changes and test plans and producing structured, evidence-backed defect candidates.

The current workflow includes:

- Task creation, repository cloning, branch and diff context collection
- Changed-method analysis with AST rules and optional Java call-graph analysis
- Local JSON providers plus optional HTTP, GitHub, test-case, document, issue, and trace adapters
- Structured finding validation, write-back, ranking, tagging, and HTML reports
- A deterministic known-good/seeded-defect fixture and an automated CLI test suite

## How it works

```text
Repository + branch + requirements or test material
                         │
                         ▼
       Context collection and change analysis
                         │
                         ▼
      AST rules + optional call-graph analysis
                         │
                         ▼
         Agent review and finding validation
                         │
                         ▼
        Structured findings + HTML report
                         │
                         ▼
                    Human review
```

OpenQA coordinates the workflow; the host Agent/model performs the semantic review. Local providers work without a private OpenQA backend, while adapters can connect the same workflow to external platforms.

## Capability map

OpenQA's product direction covers the full AI software engineering quality lifecycle. This repository currently ships one primary Skill, [`ai-defect-detection`](skills/ai-defect-detection/README.md). Capabilities marked **Available** or **Partial** below are delivered through that workflow unless stated otherwise. The remaining rows describe planned extensions, not features already included here.

| Capability | Current repository status | Scope |
| --- | --- | --- |
| Defect detection | **Available** | Agent-led static and business-logic review for code changes, test plans, and delivery tasks |
| Code analysis | **Partial** | AST-based rules and changed-method analysis; broader language and framework coverage is still expanding |
| Requirement review | **Planned** | Check implementation and tests against structured business requirements |
| Specification review | **Planned** | Review technical specifications for completeness, consistency, and testability |
| AI Code Review | **Planned** | Broader pull-request review, collaboration, and platform integrations |
| Change-impact analysis | **Partial** | Java call-graph path through GitNexus, with fallback behavior; cross-repository impact analysis is planned |
| Test execution orchestration | **Planned** | Run and collect results from existing test frameworks as part of the verification workflow |
| Code coverage analysis | **Planned** | Coverage-aware quality signals and requirement-to-test coverage |
| UI end-to-end testing | **Planned** | Browser and UI workflow generation, execution, and result integration |
| Test-case generation | **Planned** | Generate structured cases from requirements and existing materials |
| Test-data construction | **Planned** | Build boundary, scenario, and reusable domain test data |
| Issue localization and diagnosis | **Partial** | Findings include locations, triggers, reasoning, and fix suggestions; deeper root-cause diagnosis is planned |
| Evidence collection and structured findings | **Available** | Validation, write-back, ranking, tagging, and traceable HTML reports |
| Local providers and reports | **Available** | Local-first JSON persistence and report generation without a private backend |
| Enterprise and external integrations | **Partial** | HTTP and GitHub adapters are available in code and require deployment configuration |
| Quality gates and release decisions | **Product direction** | Connect verification results to CI gates and release workflows |
| Hosted verification services | **Product direction** | Managed engineering systems outside this repository |

> **Status vocabulary:** **Available** means usable in the current repository; **Partial** means a working path exists but coverage or integration is incomplete; **Planned** means not shipped here yet; **Product direction** means a broader OpenQA platform goal.

> [!IMPORTANT]
> The current defect-detection workflow is a usable engineering tool, not an experiment-only prototype. It produces candidates for human confirmation and does not replace tests, static analysis, security review, or maintainer judgment.

- [OpenQA website](https://openqa.cn)
- [OpenQA product](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)

## Install

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

Choose an Agent when prompted. For a user-level Codex installation:

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection --agent codex --global
```

No OpenQA or npm account is required. See [Getting started](docs/GETTING_STARTED.md) for runtime requirements, installation scope, and troubleshooting.

## Quick start

1. Install the Skill with the command above.
2. Start a new Coding Agent session.
3. Provide an accessible repository, branch, and requirement or test material:

```text
Review REPOSITORY_URL at BRANCH_NAME with ai-defect-detection.
Requirement: checkout amounts must be greater than zero.
For each suspected defect, report the location, trigger, evidence, and fix.
```

Replace the uppercase placeholders with real values. The workflow collects context, analyzes changed methods, runs available checks, validates findings, and produces a report for human review.

For a runnable repository example that does not require an AI model or private backend:

```bash
node examples/checkout-boundary/verify.mjs
```

This fixture contains a known-good implementation and a seeded boundary defect. It demonstrates the expected contract and verification flow; it is not a claim about model detection accuracy.

## Developer verification

Before contributing, run the repository checks:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

These checks cover documentation links, CLI and provider behavior, packaging, isolation, write-back validation, and the bundled boundary fixture. They do not prove that every defect will be found.

## Scope and limitations

This project helps organize code context and evidence; it does not replace tests, static analysis, security review, or maintainer judgment. It cannot prove the absence of defects or infer business rules that were not provided. Findings are candidates, not automatic merge decisions.

Local providers write data to disk. Repository cloning, document fetching, remote providers, automatic Semgrep/GitNexus installation, and the host Agent/model may use the network. Review [FAQ](docs/FAQ.md), [support matrix](docs/SUPPORT_MATRIX.md), and [security policy](SECURITY.md) before using private source.

## Roadmap

- **Now:** harden clean installation, agent compatibility, public fixtures, and developer documentation.
- **Next:** add specification review, requirement review, test-case generation, and broader analysis skills under the same evidence-and-human-review contract.
- **Later:** connect cross-repository impact analysis, AI Code Review, CI quality gates, and hosted engineering systems.

A capability is marked available in this repository only when its implementation, example, and limitations are published. Progress is tracked in the [public roadmap](https://openqa.cn/roadmap).

## Documentation

| Document | What it covers |
| --- | --- |
| [Getting Started](docs/GETTING_STARTED.md) | Runtime requirements, installation scope, local setup, and troubleshooting |
| [FAQ](docs/FAQ.md) | Accounts, data handling, network behavior, reports, and limitations |
| [Support Matrix](docs/SUPPORT_MATRIX.md) | Verified runtimes, Agents, integrations, and known limitations |
| [Architecture](docs/ARCHITECTURE.md) | Repository structure, naming, and project maturity model |
| [Examples](examples/README.md) | Runnable fixtures and expected outcomes |
| [Security Policy](SECURITY.md) | Security reporting and data-handling guidance |

## Support

- Report reproducible bugs through [GitHub Issues](https://github.com/openqa-cn/openqa-skills/issues)
- Ask questions and discuss implementations in [GitHub Discussions](https://github.com/openqa-cn/openqa-skills/discussions)
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md)

When asking for help, include the commit or Skill version, operating system, Agent, command, expected result, and actual result. Remove credentials, private source, and proprietary logs.

## Contribute

Useful contributions include minimal public reproductions of false positives or missed defects, known-good controls, new analysis rules, fixtures, and documentation improvements. Remove credentials, private source, and proprietary logs before sharing. Start with [Contributing](CONTRIBUTING.md), [examples](examples/README.md), and [Publishing](PUBLISHING.md).

Apache-2.0 · [GitHub](https://github.com/openqa-cn/openqa-skills)
