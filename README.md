# OpenQA Skills

**Quality verification infrastructure for AI software engineering, from requirements to release.**

[![CI](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml)
[![License](https://img.shields.io/github/license/openqa-cn/openqa-skills)](LICENSE)

[简体中文](README.zh-CN.md)

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="#what-the-output-looks-like"><strong>What it looks like</strong></a> ·
  <a href="docs/HOW_IT_WORKS.md"><strong>How It Works</strong></a> ·
  <a href="examples/inventory-service/README.md"><strong>Blind Evaluation</strong></a> ·
  <a href="skills/defect-detection/KNOWN_LIMITATIONS.md"><strong>Limitations</strong></a> ·
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

`openqa-skills` is OpenQA's public, local-first skill layer for Coding Agents. It currently ships five skills. They do not share one input:

| Skill | You bring | It does |
| --- | --- | --- |
| [`defect-detection`](skills/defect-detection/README.md) | Git URL + branch (plus requirements or cases) | Clone, analyze changed methods, write gated findings |
| [`code-reviewer`](skills/code-reviewer/README.md) | A local Git checkout + branch / PR / commit | Playbook CR with a P0 / P1 / P2 report; does not clone |
| [`requirements-analyzer`](skills/requirements-analyzer/README.md) | PRD / stories / API notes (documents) | One gap/conflict register with P0 / P1 verification |
| [`testcase-generation`](skills/testcase-generation/README.md) | PRD / design / specs under `prd/` | Write and update a manual case library. `code/` is update-only |
| [`testdata-generation`](skills/testdata-generation/README.md) | A construct request, cases, and/or OpenAPI | Call a backend (or local mock) and return real IDs; not a git clone |

[`defect-detection`](skills/defect-detection/README.md) workflow:

- Task creation, repository cloning, branch and diff context collection
- Changed-method analysis with AST rules and optional Java call-graph analysis
- Local JSON providers plus optional HTTP, GitHub, test-case, document, issue, and trace adapters
- Structured finding validation, write-back, ranking, tagging, and HTML reports
- A deterministic known-good/seeded-defect fixture and an automated CLI test suite

Method write-ups live in each skill: [defect-detection](skills/defect-detection/HOW_IT_WORKS.md), [code-reviewer](skills/code-reviewer/HOW_IT_WORKS.md), [requirements-analyzer](skills/requirements-analyzer/HOW_IT_WORKS.md), [testcase-generation](skills/testcase-generation/HOW_IT_WORKS.md), [testdata-generation](skills/testdata-generation/HOW_IT_WORKS.md). Index: [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## How defect-detection works

Static rules catch bugs you can recognise by *shape*: a swallowed exception, a hardcoded secret, a missing null check. The bugs that survive review are usually different: the code looks fine, the tests are green, and it still does not match the requirement.

- Spec says “discount at 10 items”; the code uses `>`, so 10 items get no discount.
- A refund pays the requested amount and never caps it at the remaining balance.
- One function updates a counter; the cache that reads the same data is never invalidated.

Those bugs are not in the syntax tree. They sit in the **gap between code and intent**, and the intent lives in requirements and test cases. A model can compare the two. Left unconstrained, it also invents methods it never read, stamps “looks good” on hundreds of methods, and files so much noise that people stop reading.

So the split is: **the model judges meaning; the infrastructure makes that judgement checkable.**

```text
Repo + branch + requirements or cases
                  │
                  ▼
     Collect context, analyse the change
                  │
                  ▼
     AST rules + optional call graph
                  │
                  ▼
     Agent review, findings validated
                  │
                  ▼
     Structured findings + HTML report
                  │
                  ▼
              Human review
```

OpenQA runs the workflow. The host Agent / model does the semantic review. Local providers need no private backend; adapters can attach the same flow to an external platform.

Three controls do the real work:

1. **Tiers.** Methods tied to a stated requirement or case get deeper analysis; the rest are not treated equally.
2. **23 write-back rules.** Rejected if the code was never read, the method name is not in the source, or the batch looks like autopilot output.
3. **A close gate.** Coverage, report consistency, and evidence depth are checked again before the task can finish.

On the [inventory-service](examples/inventory-service/README.md) blind fixture, seven business-logic defects sit inside ordinary feature work, plus four decoys that look wrong but are correct. One recorded agent run found 7/7 with 0 false positives, and none of the seven came from the 102 Semgrep seed rules. That is one model, one run, one in-house fixture — not a benchmark. Design: [How it works](skills/defect-detection/HOW_IT_WORKS.md). Limits: [known limitations](skills/defect-detection/KNOWN_LIMITATIONS.md).

### What the output looks like

These are **sample pages** (same renderer as a local run, canned findings). Open the HTML if the image is stale.

<p align="center">
  <a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="Sample defect-detection HTML report: inventory reservation findings" width="880"></a>
</p>

<p align="center"><em>Defect-detection HTML report — task header, KPIs, and three requirement mismatches. <a href="docs/assets/previews/defect-report.html">Open the page</a>.</em></p>

<p align="center">
  <a href="docs/assets/previews/testcase-sample.html"><img src="docs/assets/previews/testcase-sample.png" alt="Sample generated manual test case for inventory hold" width="880"></a>
</p>

<p align="center"><em>testcase-generation writes Markdown cases. This is that file rendered: steps, expected results, empty Construction column. <a href="docs/assets/previews/testcase-sample.html">Open the page</a>.</em></p>

<p align="center">
  <a href="docs/assets/previews/cr-findings.html"><img src="docs/assets/previews/cr-findings.png" alt="Sample code-reviewer P0 and P1 findings" width="880"></a>
</p>

<p align="center"><em>code-reviewer report: each finding has location, rule, runtime impact, and a fix. <a href="docs/assets/previews/cr-findings.html">Open the page</a>.</em></p>

<p align="center">
  <a href="docs/assets/previews/ra-register.html"><img src="docs/assets/previews/ra-register.png" alt="Sample requirements-analyzer gap register" width="880"></a>
</p>

<p align="center"><em>requirements-analyzer: one gap / conflict register with an executable check per row. <a href="docs/assets/previews/ra-register.html">Open the page</a>.</em></p>

<p align="center">
  <a href="docs/assets/previews/testdata-writeback.html"><img src="docs/assets/previews/testdata-writeback.png" alt="Sample testdata write-back replacing placeholders" width="880"></a>
</p>

<p align="center"><em>testdata-generation fills <code>{placeholder}</code> with IDs the backend actually returned. <a href="docs/assets/previews/testdata-writeback.html">Open the page</a>.</em></p>

## Capability map

OpenQA's product direction covers the full AI software engineering quality lifecycle. This repository currently ships [`defect-detection`](skills/defect-detection/README.md), [`code-reviewer`](skills/code-reviewer/README.md), [`requirements-analyzer`](skills/requirements-analyzer/README.md), [`testcase-generation`](skills/testcase-generation/README.md), and [`testdata-generation`](skills/testdata-generation/README.md). Capabilities marked **Available** or **Partial** below are delivered through those workflows unless stated otherwise. The remaining rows describe planned extensions, not features already included here.

| Capability | Current repository status | Scope |
| --- | --- | --- |
| Defect detection | **Available** | Agent-led static and business-logic review for code changes, test plans, and delivery tasks |
| Code analysis | **Partial** | AST-based rules and changed-method analysis; broader language and framework coverage is still expanding |
| Requirement review | **Available** | Gap/conflict analysis of requirement documents (`requirements-analyzer`); implementation-vs-requirement check is still planned |
| Specification review | **Planned** | Review technical specifications for completeness, consistency, and testability |
| AI Code Review | **Available** | Playbook-driven PR / branch / commit review (`code-reviewer`); no published fixture yet |
| Change-impact analysis | **Partial** | Java call-graph path through GitNexus, with fallback behavior; cross-repository impact analysis is planned |
| Test execution orchestration | **Planned** | Run and collect results from existing test frameworks as part of the verification workflow |
| Code coverage analysis | **Planned** | Coverage-aware quality signals and requirement-to-test coverage |
| UI end-to-end testing | **Planned** | Browser and UI workflow generation, execution, and result integration |
| Test-case generation | **Available** | Generate and update structured manual cases from PRD, technical design, specs, and knowledge files |
| Test-data construction | **Available** | Build reusable domain test data from slots, tools, APIs, and generated scripts; write constructed values back into case preconditions |
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
npx skills add openqa-cn/openqa-skills --skill defect-detection
npx skills add openqa-cn/openqa-skills --skill code-reviewer
npx skills add openqa-cn/openqa-skills --skill requirements-analyzer
npx skills add openqa-cn/openqa-skills --skill testcase-generation
npx skills add openqa-cn/openqa-skills --skill testdata-generation
```

Choose an Agent when prompted. For a user-level Codex installation add `--agent codex --global`. Each `--skill` copies one directory.

No OpenQA or npm account is required. See [Getting started](docs/GETTING_STARTED.md) for runtime requirements, installation scope, and troubleshooting.

## Quick start

1. Install the skill you need with the command above.
2. Start a new Coding Agent session.
3. Give the agent the material **that** skill expects. They are not interchangeable.

### Review a branch (`defect-detection`)

```text
Review REPOSITORY_URL at BRANCH_NAME with defect-detection.
Requirement: checkout amounts must be greater than zero.
For each suspected defect, report the location, trigger, evidence, and fix.
```

Replace the uppercase placeholders. The workflow collects context, analyzes changed methods, validates findings, and produces a report for human review.

A model-free fixture of the contract (not a detection-accuracy claim):

```bash
node examples/checkout-boundary/verify.mjs
```

### Review a local checkout (`code-reviewer`)

Open the repository in the agent. This skill diffs in place; it does not clone.

```text
Review the current branch with code-reviewer against main.
For each finding give severity, file:line, the rule, the runtime impact, and a fix.
```

There is no public fixture yet. For method-level requirement defects with write-back gates, use `defect-detection` instead.

### Analyze requirements (`requirements-analyzer`)

Give documents, not a repo.

```text
Analyze these requirement documents with requirements-analyzer.
Produce one gap/conflict register. P0 items must include verification fields.
Do not invent endpoints or SLAs that are not in the source.
```

This reviews the PRD. To write a case library from `prd/`, use `testcase-generation`.

### Write a case library (`testcase-generation`)

Put PRD / design / specs under `prd/` first. `code/` is not required for generate.

```text
Generate a manual case library with testcase-generation from the documents under prd/.
Do not invent engineering fields that are not in the source. Mark those TBD.
```

When the agent stops on a PRD vs design conflict, reply `Confirm follow PRD` or `Item N follow technical design`. There is no public fixture yet.

### Construct test data (`testdata-generation`)

Not a git clone. Say what to construct, or point at written cases / OpenAPI:

```text
Create a standard catalog product named Northwind Standard with testdata-generation.
Use the local mock if no enterprise gateway is configured.
```

For write-back into cases:

```text
Prepare test data for this case file and write the IDs back as preconditions.
```

Default backend is the bundled mock on `http://127.0.0.1:8765`. A demo ID is not proof that a real system was written.

## Developer verification

Before contributing, run the repository checks:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

These checks cover documentation links, CLI and provider behavior, packaging, isolation, write-back validation, and the bundled boundary fixture. They do not prove that every defect will be found.

## Scope and limitations

This project helps organize code context and evidence; it does not replace tests, static analysis, security review, or maintainer judgment. It cannot prove the absence of defects or infer business rules that were not provided. Findings are candidates, not automatic merge decisions.

Local providers write data to disk. Repository cloning, document fetching, remote providers, automatic Semgrep/GitNexus installation, and the host Agent/model may use the network. Review [FAQ](docs/FAQ.md), [support matrix](docs/SUPPORT_MATRIX.md), and [security policy](SECURITY.md) before using private source.

## Roadmap

- **Now:** harden clean installation, agent compatibility, public fixtures, and developer documentation.
- **Next:** add specification review, requirement review, and broader analysis skills under the same evidence-and-human-review contract.
- **Later:** connect cross-repository impact analysis, AI Code Review, CI quality gates, and hosted engineering systems.

A capability is marked available in this repository only when its implementation, example, and limitations are published. Progress is tracked in the [public roadmap](https://openqa.cn/roadmap).

## Documentation

| Document | What it covers |
| --- | --- |
| [How the skills work](docs/HOW_IT_WORKS.md) | Index of per-skill method docs |
| [Known Limitations](skills/defect-detection/KNOWN_LIMITATIONS.md) | Concrete failure cases, implementation gaps, and what the evidence does not support |
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
