<div align="center">

# codexqa

**Seven local-first Agent Skills for requirements, test design, test data, change impact, exception RCA, requirement defects, and code review.**

[![CI](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=release&style=flat)](https://github.com/openqa-cn/codexqa/releases)
[![GitHub stars](https://img.shields.io/github/stars/openqa-cn/codexqa?style=flat)](https://github.com/openqa-cn/codexqa/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/codexqa)](LICENSE)

**English | [简体中文](README.zh-CN.md)**

<a href="#quick-start"><strong>Quick Start</strong></a> ·
<a href="docs/assets/previews/defect-report.html"><strong>Sample report</strong></a> ·
<a href="docs/HOW_IT_WORKS.md"><strong>How It Works</strong></a> ·
<a href="examples/inventory-service/README.md"><strong>Blind Evaluation</strong></a> ·
<a href="#evidence-and-limitations"><strong>Evidence & Limits</strong></a> ·
<a href="docs/GETTING_STARTED.md"><strong>Getting Started</strong></a> ·
<a href="docs/FAQ.md"><strong>FAQ</strong></a> ·
<a href="docs/SUPPORT_MATRIX.md"><strong>Support Matrix</strong></a>

</div>

<p align="center">
  <a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="Defect-detection HTML report: three requirement mismatches" width="100%"></a>
</p>

<p align="center">
  <sub><em>Coding agents write the change. codexqa makes the intent, impact, review evidence, cases, and test data checkable.<br>(Above: one of seven outputs, a defect-detection sample page with canned findings.)</em></sub>
</p>

---

AI can produce a green pull request quickly. Teams still have to check whether the implementation matches the requirement, identify affected callers and entries, review the evidence, and prepare runnable tests. codexqa splits that verification work into seven Agent Skills.

`codexqa` is a public, local-first [Agent Skills](https://agentskills.io/specification) pack for [Cursor](https://cursor.com), [Claude Code](https://claude.com/claude-code), [Codex](https://openai.com/codex), and OpenClaw. Install only the workflow you need with `npx skills add`; there is no codexqa account, gateway, or platform migration.

## How the seven skills fit together

| Stage | Skill | Question it answers | Checkable output |
| --- | --- | --- | --- |
| Requirement review | [`requirements-analyzer`](skills/requirements-analyzer/README.md) | Is the PRD complete, consistent, and testable? | One gap/conflict register with P0 / P1 verification |
| Test design | [`testcase-generation`](skills/testcase-generation/README.md) | What manual cases follow from the PRD and design? | A structured case library with unknowns marked, not invented |
| Test data | [`testdata-generation`](skills/testdata-generation/README.md) | What real IDs and preconditions make those cases runnable? | Backend-returned values written back into case preconditions |
| Change impact | [`code-analyzer`](skills/code-analyzer/README.md) | What changed, who calls it, which entries are hit, and what is untested? | Symbol-graph evidence, regression scope, test gaps, and diagrams |
| Exception RCA | [`root-cause-diagnosis`](skills/root-cause-diagnosis/README.md) | What is the in-repo root cause of this stack / log / crash? | Gated English root-cause report on top of CodexQA CLI facts |
| Requirement defects | [`defect-detection`](skills/defect-detection/README.md) | Does the changed implementation violate a requirement or case? | Structured candidate findings that pass write-back gates |
| Code review | [`code-reviewer`](skills/code-reviewer/README.md) | What concrete quality, security, or maintainability problems are in this diff? | Playbook-driven P0 / P1 / P2 findings with file:line and fixes |

The skills use different inputs by design. The Agent can tell whether it should read documents, index a local checkout, clone a branch, write cases, or call a data backend.

## Why codexqa?

- `defect-detection` compares changed code with requirements and test cases; those mismatches often cannot be found by static rules alone.
- `code-analyzer` uses a local symbol graph to trace changed symbols to callers, entries, and graph-backed test relationships.
- `root-cause-diagnosis` turns exception evidence into a gated English RCA report on top of the same CodexQA CLI.
- The document and test skills keep requirement review, case design, and data construction separate instead of asking one prompt to do everything.
- Each skill has a narrow input contract, evidence format, and stop conditions. The skills install into the Agent you already use; findings remain candidates for human review.

## Choose the right code workflow

The four code-facing skills overlap on the same repository but answer different questions:

| Skill | Primary question | Input | It does not replace |
| --- | --- | --- | --- |
| [`code-analyzer`](skills/code-analyzer/README.md) | What changed, what can it reach, and where are the test gaps? | Local repository + optional diff base | Requirement judgement, exception RCA, or P0 / P1 / P2 review |
| [`root-cause-diagnosis`](skills/root-cause-diagnosis/README.md) | What is the in-repo root cause of this exception? | Exception evidence + git / dir / file / open workspace | Structure/impact mapping or requirement write-back |
| [`defect-detection`](skills/defect-detection/README.md) | Does the implementation contradict a requirement or test case? | Git URL + branch + available requirements/cases | General maintainability review or test execution |
| [`code-reviewer`](skills/code-reviewer/README.md) | What concrete implementation problems deserve review findings? | Local checkout + branch / PR / commit | Symbol-graph impact mapping or requirement-document review |

Detailed workflow and boundary documents live with each skill: [code-analyzer](skills/code-analyzer/README.md) ([limitations](skills/code-analyzer/KNOWN_LIMITATIONS.md)), [root-cause-diagnosis](skills/root-cause-diagnosis/HOW_IT_WORKS.md), [defect-detection](skills/defect-detection/HOW_IT_WORKS.md), [code-reviewer](skills/code-reviewer/HOW_IT_WORKS.md), [requirements-analyzer](skills/requirements-analyzer/HOW_IT_WORKS.md), [testcase-generation](skills/testcase-generation/HOW_IT_WORKS.md), and [testdata-generation](skills/testdata-generation/HOW_IT_WORKS.md). Host, language, and verification status are tracked in the [support matrix](docs/SUPPORT_MATRIX.md).

## Install on Cursor, Claude Code, and Codex

Check the basic tools first. `code-analyzer` requires Node.js 18+; the `defect-detection` CLI suite is tested on Node.js 22.15.0.

```bash
node --version
npx --version
git --version
```

Install only the skill needed for the current task:

```bash
npx skills add openqa-cn/codexqa --skill code-analyzer
npx skills add openqa-cn/codexqa --skill root-cause-diagnosis
npx skills add openqa-cn/codexqa --skill defect-detection
npx skills add openqa-cn/codexqa --skill code-reviewer
npx skills add openqa-cn/codexqa --skill requirements-analyzer
npx skills add openqa-cn/codexqa --skill testcase-generation
npx skills add openqa-cn/codexqa --skill testdata-generation
```

`code-analyzer` and `root-cause-diagnosis` also require Node.js 18+ / 22+ respectively and `npm install -g @openqa-cn/codexqa`. This package is the separately distributed, closed-source local code-analysis engine; index and query run on the user's machine without an LLM. [code-analyzer limitations](skills/code-analyzer/KNOWN_LIMITATIONS.md) · [root-cause-diagnosis limitations](skills/root-cause-diagnosis/KNOWN_LIMITATIONS.md).

Choose an Agent when prompted. For a user-level Codex installation add `--agent codex --global`. Each `--skill` copies one directory.

No codexqa or npm account is required. See [Getting started](docs/GETTING_STARTED.md) for runtime requirements, installation scope, and troubleshooting.

## Quick start

1. Install the skill you need with the command above.
2. Start a new Coding Agent session.
3. Give the agent the material **that** skill expects. They are not interchangeable.

### Path A: find requirement defects in a branch

```text
Review https://github.com/<ORG>/<REPO>.git at feature/refund-limit with defect-detection.
Requirement: a refund must not exceed the order's remaining refundable balance.
For each suspected defect, report the location, trigger, evidence, and fix.
```

HTTPS and SSH Git URLs are accepted. Use a branch name such as `main` or `feature/refund-limit`; requirements can be pasted into the request or provided as documents.

**Installation acceptance check, no model required:**

```bash
node examples/checkout-boundary/verify.mjs
```

Expected ending:

```text
PASS: known-good implementation satisfies sampled contract
EXPECTED FAILURE: defective implementation accepts zero
Fixture verified; no AI detection claim.
```

### Path B: map change impact in a local checkout

```bash
npm install -g @openqa-cn/codexqa
codexqa --help
codexqa index /path/to/repo --diff-base origin/main
codexqa stats /path/to/repo
```

`codexqa --help` should list the CLI commands; `stats` should report indexed files, symbols, and languages. Then open the repository in the agent and ask:

```text
Use code-analyzer to review this repository against origin/main.
Show the highest-risk change groups, affected callers and entries, and changed symbols with no graph-backed test relationship.
```

This path uses the separately distributed closed-source local analysis engine. The current engine is not installed or exercised by this repository's CI; see [known limitations](skills/code-analyzer/KNOWN_LIMITATIONS.md).

### Path C: diagnose an exception

```text
Use root-cause-diagnosis on this NullPointerException stack and the order-service checkout.
Produce an English root-cause report: trigger vs root cause, mapped call path, and Confidence.
```

Provide the exception text or file plus a git URL, local directory, single file, or already-open workspace. This path also uses `@openqa-cn/codexqa`; see [root-cause-diagnosis limitations](skills/root-cause-diagnosis/KNOWN_LIMITATIONS.md).

<details>
<summary><b>What to say to the other four skills</b></summary>

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

## What the output looks like

The large image at the top is the `defect-detection` HTML report. Other sample artifacts:

| Skill | Sample |
| --- | --- |
| `code-analyzer` | [Change-impact graph](skills/code-analyzer/assets/checkout-change-impact.svg) |
| `code-reviewer` | [P0 / P1 findings](docs/assets/previews/cr-findings.html) |
| `requirements-analyzer` | [Gap/conflict register](docs/assets/previews/ra-register.html) |
| `testcase-generation` | [Structured manual case](docs/assets/previews/testcase-sample.html) |
| `testdata-generation` | [Backend values written into case preconditions](docs/assets/previews/testdata-writeback.html) |

These pages use the project renderers and prepared sample data. They are illustrations, not recorded Agent runs.

## Evidence and limitations

The workflows do not have the same public evidence maturity:

| Skill | Public evidence today |
| --- | --- |
| `defect-detection` | Repository CLI tests, reproducible fixtures, and one recorded Agent run: 7/7 planted defects, 0 false positives; one model and one in-house fixture, not a benchmark |
| `code-analyzer` | Published Skill contract, schemas, playbook, example diagram, and limitations; the separately distributed closed-source engine is not run by this repository's CI |
| `root-cause-diagnosis` | Local CLI tests (parse, materialize, draft, smoke); uses `@openqa-cn/codexqa`; no published host-agent score; RCA narrative is model-judged |
| `code-reviewer` | Offline tooling contract checks; no public fixture or recorded host-Agent run |
| `requirements-analyzer` | Evaluation cases and parse/convert scripts; no recorded host-Agent score |
| `testcase-generation` | Integration validators and case-document linting; no public fixture or recorded Agent run |
| `testdata-generation` | Packer, slot search, and local catalog mock; runtime depends on configured adapters and slots |

Findings are candidates for human review. codexqa does not replace tests, static analysis, security review, or maintainer judgment, and it cannot infer business rules that were not supplied. Local workflows write data to disk; cloning, document fetching, external providers, tool installation, and the host Agent/model may use the network.

See the [support matrix](docs/SUPPORT_MATRIX.md), [FAQ](docs/FAQ.md), per-skill limitations, and [benchmark methodology](benchmarks/README.md) before using private source or comparing quality claims.

## Developer verification

Before contributing, run the repository checks:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

These checks cover documentation links, translation section parity, the repository's `defect-detection` CLI and provider behavior, packaging, isolation, write-back validation, and the bundled boundary fixture. They do not execute the separately distributed `code-analyzer` / `root-cause-diagnosis` engine path or prove that every defect will be found.

## Documentation

| I want to… | Start here |
| --- | --- |
| Run a review today | [Getting Started](docs/GETTING_STARTED.md) · [Quick start](#quick-start) |
| Understand how it reaches a conclusion, and what stops autopilot output | [How the skills work](docs/HOW_IT_WORKS.md) · [defect-detection method](skills/defect-detection/HOW_IT_WORKS.md) |
| Know what a skill misses and when not to trust it | [How the skills work](docs/HOW_IT_WORKS.md) · [code-analyzer limitations](skills/code-analyzer/KNOWN_LIMITATIONS.md) · [defect-detection limitations](skills/defect-detection/KNOWN_LIMITATIONS.md) · [Support Matrix](docs/SUPPORT_MATRIX.md) |
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
