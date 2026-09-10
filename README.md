<div align="center">

# codexqa

**Agent Skills that check whether AI-written code still matches the requirement — and turn a PRD into manual test cases and real testdata.**

[![CI](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=release&style=flat)](https://github.com/openqa-cn/codexqa/releases)
[![GitHub stars](https://img.shields.io/github/stars/openqa-cn/codexqa?style=flat)](https://github.com/openqa-cn/codexqa/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/codexqa)](LICENSE)

**English | [简体中文](README.zh-CN.md)**

<a href="#quick-start"><strong>Quick Start</strong></a> ·
<a href="#what-the-output-looks-like"><strong>What it looks like</strong></a> ·
<a href="docs/HOW_IT_WORKS.md"><strong>How It Works</strong></a> ·
<a href="examples/inventory-service/README.md"><strong>Blind Evaluation</strong></a> ·
<a href="skills/defect-detection/KNOWN_LIMITATIONS.md"><strong>Limitations</strong></a> ·
<a href="docs/GETTING_STARTED.md"><strong>Getting Started</strong></a> ·
<a href="docs/FAQ.md"><strong>FAQ</strong></a> ·
<a href="docs/SUPPORT_MATRIX.md"><strong>Support Matrix</strong></a>

</div>

<p align="center">
  <a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="Defect-detection HTML report: three requirement mismatches" width="100%"></a>
</p>

<p align="center">
  <sub><em>Coding agents write the change. These skills check the requirement, the review, the cases, and the testdata.<br>(Above is a sample page: same renderer as a local run, canned findings.)</em></sub>
</p>

---

For [Cursor](https://cursor.com), [Claude Code](https://claude.com/claude-code), [Codex](https://openai.com/codex), and OpenClaw. Install with `npx skills add` ([Agent Skills](https://agentskills.io/specification)). Local-first; no codexqa account.

Coding agents make a green pull request cheap. The expensive part is now **requirement bugs, rubber-stamp reviews, and test work the model cannot finish alone**:

| What goes wrong after the agent writes code | Skill |
| --- | --- |
| The PR looks right and CI is green; the spec said “discount at 10 items” and the code used `>` | [`defect-detection`](skills/defect-detection/README.md) — business-logic / requirement defects, not only Semgrep shape |
| You need AI code review of a local branch or PR: file:line, runtime impact, a fix — not “LGTM” | [`code-reviewer`](skills/code-reviewer/README.md) |
| The PRD contradicts the API note, or a P0 has no way to fail | [`requirements-analyzer`](skills/requirements-analyzer/README.md) |
| QA still writes the manual test-case library from the PRD by hand | [`testcase-generation`](skills/testcase-generation/README.md) |
| Cases are full of `{placeholder}` and nobody created the real IDs on a backend | [`testdata-generation`](skills/testdata-generation/README.md) |

We have not measured and published a score per host — [what was actually checked is in the support matrix](docs/SUPPORT_MATRIX.md). Findings are candidates for a human.

## What this repository provides

`codexqa` is a public, local-first [Agent Skills](https://agentskills.io/specification) pack. Five skills; they do not share one input:

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

codexqa runs the workflow. The host Agent / model does the semantic review. Local providers need no private backend; adapters can attach the same flow to an external platform.

Three controls do the real work:

1. **Tiers.** Methods tied to a stated requirement or case get deeper analysis; the rest are not treated equally.
2. **23 write-back rules.** Rejected if the code was never read, the method name is not in the source, or the batch looks like autopilot output.
3. **A close gate.** Coverage, report consistency, and evidence depth are checked again before the task can finish.

On the [inventory-service](examples/inventory-service/README.md) blind fixture, seven business-logic defects sit inside ordinary feature work, plus four decoys that look wrong but are correct. One recorded agent run found 7/7 with 0 false positives, and none of the seven came from the 102 Semgrep seed rules. That is one model, one run, one in-house fixture — not a benchmark. [Methodology](benchmarks/README.md), [design](skills/defect-detection/HOW_IT_WORKS.md), [known limitations](skills/defect-detection/KNOWN_LIMITATIONS.md).

## What the output looks like

These are all **sample pages** (same renderer as a local run, canned findings). Open the HTML if an image is stale.

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

The defect-detection report is the page at the top; you can also [open it directly](docs/assets/previews/defect-report.html).

## Hosts and language support

The skill instructions target **Cursor, Claude Code, Codex, and OpenClaw**: install, start a new session, hand over the material. Installing is not the same as a complete run on that host; per-component status is in the [support matrix](docs/SUPPORT_MATRIX.md).

`defect-detection` does language-aware method extraction for the languages below, each with its own Semgrep seed pack (102 seed rules in total). The extractors are regex / brace / indentation based, not full parsers:

| Language | Method-level extraction | Extra |
| --- | --- | --- |
| Java | ✓ | Optional GitNexus call graph |
| Kotlin · Scala | ✓ | — |
| JavaScript · TypeScript | ✓ | Where the one recorded blind-eval sample (7/7) ran |
| Python | ✓ | 17 seed rules; method bounds from indentation |
| Go | ✓ | Optional go vet / staticcheck overlays |
| C · C++ | ✓ | Macro-heavy code is approximated |
| C# | ✓ | — |

Optional overlays run when the binary is installed and are skipped when it is not: gitleaks, trivy / grype, bandit, gosec, cppcheck, eslint, detekt.

## Install on Cursor, Claude Code, and Codex

```bash
npx skills add openqa-cn/codexqa --skill defect-detection
npx skills add openqa-cn/codexqa --skill code-reviewer
npx skills add openqa-cn/codexqa --skill requirements-analyzer
npx skills add openqa-cn/codexqa --skill testcase-generation
npx skills add openqa-cn/codexqa --skill testdata-generation
```

Choose an Agent when prompted. For a user-level Codex installation add `--agent codex --global`. Each `--skill` copies one directory.

No codexqa or npm account is required. See [Getting started](docs/GETTING_STARTED.md) for runtime requirements, installation scope, and troubleshooting.

## Quick start

1. Install the skill you need with the command above.
2. Start a new Coding Agent session.
3. Give the agent the material **that** skill expects. They are not interchangeable.

Start with one: **review a branch** (`defect-detection`).

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

<details>
<summary><b>What to say to the other four skills</b></summary>

<br/>

**Review a local checkout (`code-reviewer`)** — open the repository in the agent. This skill diffs in place; it does not clone.

```text
Review the current branch with code-reviewer against main.
For each finding give severity, file:line, the rule, the runtime impact, and a fix.
```

There is no public fixture yet. For method-level requirement defects with write-back gates, use `defect-detection` instead.

**Analyze requirements (`requirements-analyzer`)** — give documents, not a repo.

```text
Analyze these requirement documents with requirements-analyzer.
Produce one gap/conflict register. P0 items must include verification fields.
Do not invent endpoints or SLAs that are not in the source.
```

This reviews the PRD. To write a case library from `prd/`, use `testcase-generation`.

**Generate manual test cases from a PRD (`testcase-generation`)** — put PRD / design / specs under `prd/` first. `code/` is not required for generate.

```text
Generate a manual case library with testcase-generation from the documents under prd/.
Do not invent engineering fields that are not in the source. Mark those TBD.
```

When the agent stops on a PRD vs design conflict, reply `Confirm follow PRD` or `Item N follow technical design`. There is no public fixture yet.

**Construct test data (`testdata-generation`)** — not a git clone. Say what to construct, or point at written cases / OpenAPI:

```text
Create a standard catalog product named Northwind Standard with testdata-generation.
Use the local mock if no enterprise gateway is configured.
```

For write-back into cases:

```text
Prepare test data for this case file and write the IDs back as preconditions.
```

Default backend is the bundled mock on `http://127.0.0.1:8765`. A demo ID is not proof that a real system was written.

</details>

## Why a skill, not another platform

What you install is files, not a service. `npx skills add … --skill <name>` copies one directory, and the agent you already use reads it — **no account, no gateway, no workflow to migrate**.

- **Semantic judgement stays with the model you already pay for.** This repository ships no model and does not rank them. It organizes the context, then makes the model's conclusion checkable: 23 write-back rules, tiers, a close gate.
- **Local-first is literal.** Local JSON providers persist to disk and the report is an HTML file you can double-click. Configure the HTTP / GitHub adapters only when you want an external system attached.
- **Install one at a time.** The five skills do not share an input; installing all of them mostly helps the agent pick the wrong one. Install for the task in front of you.
- **Capabilities and claims are written down separately.** What ships versus what is planned: [capability map and roadmap](docs/ROADMAP.md). What was actually checked per component: [support matrix](docs/SUPPORT_MATRIX.md). What it cannot do: [known limitations](skills/defect-detection/KNOWN_LIMITATIONS.md).

## Scope and limitations

> [!IMPORTANT]
> The current defect-detection workflow is a usable engineering tool, not an experiment-only prototype. It produces candidates for human confirmation and does not replace tests, static analysis, security review, or maintainer judgment.

This project helps organize code context and evidence; it does not replace tests, static analysis, security review, or maintainer judgment. It cannot prove the absence of defects or infer business rules that were not provided. Findings are candidates, not automatic merge decisions.

Local providers write data to disk. Repository cloning, document fetching, remote providers, automatic Semgrep/GitNexus installation, and the host Agent/model may use the network. Review [FAQ](docs/FAQ.md), [support matrix](docs/SUPPORT_MATRIX.md), and [security policy](SECURITY.md) before using private source.

## Developer verification

Before contributing, run the repository checks:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

These checks cover documentation links, translation section parity, CLI and provider behavior, packaging, isolation, write-back validation, and the bundled boundary fixture. They do not prove that every defect will be found.

## Documentation

| I want to… | Start here |
| --- | --- |
| Run a review today | [Getting Started](docs/GETTING_STARTED.md) · [Quick start](#quick-start) |
| Understand how it reaches a conclusion, and what stops autopilot output | [How the skills work](docs/HOW_IT_WORKS.md) · [defect-detection method](skills/defect-detection/HOW_IT_WORKS.md) |
| Know what it misses and when not to trust it | [Known Limitations](skills/defect-detection/KNOWN_LIMITATIONS.md) · [Support Matrix](docs/SUPPORT_MATRIX.md) |
| Check whether code or data leaves my machine | [FAQ](docs/FAQ.md) · [Security Policy](SECURITY.md) |
| Reproduce the 7/7 blind evaluation myself | [Examples](examples/README.md) · [inventory-service](examples/inventory-service/README.md) · [Methodology](benchmarks/README.md) |
| See what is next and what is only planned | [Capability map and roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md) |
| Understand the repository layout and why docs sit where they do | [Architecture](docs/ARCHITECTURE.md) |
| Know where open source ends and commercial begins | [Commercial boundary](docs/COMMERCIAL_BOUNDARY.md) · [LICENSE](LICENSE) |
| Send a PR or cut a release | [Contributing](CONTRIBUTING.md) · [Publishing](PUBLISHING.md) |

## Support

- Report reproducible bugs through [GitHub Issues](https://github.com/openqa-cn/codexqa/issues)
- Ask questions and discuss implementations in [GitHub Discussions](https://github.com/openqa-cn/codexqa/discussions)
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md)

When asking for help, include the commit or skill version, operating system, Agent, command, expected result, and actual result. Remove credentials, private source, and proprietary logs.

Elsewhere: [Website](https://openqa.cn) · [Product](https://openqa.cn/agent) · [Skill Hub](https://openqa.cn/skills)

## Contribute

Useful contributions include minimal public reproductions of false positives or missed defects, known-good controls, new analysis rules, fixtures, and documentation improvements. Remove credentials, private source, and proprietary logs before sharing. Start with [Contributing](CONTRIBUTING.md), [examples](examples/README.md), and [Publishing](PUBLISHING.md).

Apache-2.0 · [GitHub](https://github.com/openqa-cn/codexqa)
