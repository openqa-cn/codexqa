# OpenQA Skills

**AI-assisted defect review for coding agents.**

Review code changes against implementation and business context. Produce defect candidates with source locations, reasoning, and suggested fixes for human review.

[简体中文](README.zh-CN.md) · [Getting started](docs/GETTING_STARTED.md) · [Example](examples/checkout-boundary/README.md) · [Report an issue](https://github.com/openqa-cn/openqa-skills/issues)

## About OpenQA

[OpenQA](https://openqa.cn) is building verification infrastructure for AI software engineering. As coding agents take on more implementation work, teams need an independent way to determine whether a change satisfies its intent, affects the right parts of a system, and has enough direct evidence to merge or release. OpenQA treats that as an engineering verification problem rather than as a larger code-generation prompt.

The platform direction connects several layers:

- **Verification Agent** — plans and executes change-level verification in a developer workstation or controlled CI environment.
- **Skill Hub** — an open catalog of reusable skills and MCP tools that teach agents how to perform focused testing and verification workflows.
- **Software systems and SaaS solutions** — integrations for requirements, test cases, issues, traces, and other engineering records; examples include cross-repository code knowledge graphs and change-impact analysis.
- **Tools and benchmarks** — a directory and evaluation layer for comparing testing tools and recording evidence about what works.

These layers have different release and trust boundaries. The website describes the broader product direction and hosted capabilities. This repository contains the public, local-first Skill layer: instructions, executable adapters, fixtures, and tests that developers can inspect, run, and contribute to.

- [OpenQA website](https://openqa.cn)
- [OpenQA product preview](https://openqa.cn/agent)
- [Skill Hub](https://openqa.cn/skills)
- [OpenQA Skills source](https://github.com/openqa-cn/openqa-skills)

This repository does not claim that a skill proves the absence of defects. It provides a repeatable workflow for collecting context, selecting checks, preserving evidence, and presenting findings for human review. Hosted or organization-level capabilities may be provided separately; see the [commercial boundary](docs/COMMERCIAL_BOUNDARY.md).

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Repository checks](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml)

## Install

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

Choose your agent interactively. Installation is project-level by default; add `--agent codex --global` for a user-level Codex installation. OpenQA does not require an npm account or its own npm package. The command installs the version available on GitHub.

**Runtime:** Node.js and Git. Node 22.15.0 was tested with `NODE_OPTIONS=--experimental-strip-types`; set this in the environment used by the agent's commands. See [installation and troubleshooting](docs/GETTING_STARTED.md) before your first analysis.

## When to use it

- Review a repository branch before merging or handing it to QA.
- Check implementation against supplied requirements and test cases.
- Revisit findings with additional context and record human feedback.

The current skill is [ai-defect-detection](skills/ai-defect-detection/README.md). It combines analysis instructions, a TypeScript CLI, static-analysis integration, local storage, and optional enterprise adapters.

## Start a review

After installing, open a new agent session and provide a request such as:

```text
Use ai-defect-detection to review <repository URL>, branch <branch name>.
Requirement: checkout amounts must be strictly positive.
Focus on changed code and report each suspected defect with its location,
trigger condition, supporting evidence, and suggested fix.
```

Replace the placeholders with an accessible repository and branch. The agent performs the analysis; the CLI alone does not supply an AI model. Missing business material limits what the review can assess.

## See what a finding looks like

| Field | Boundary-case example |
| --- | --- |
| Candidate | Zero-value checkout is accepted |
| Trigger | `checkout(0)` |
| Expected / actual | Reject / accept |
| Evidence | A boundary assertion fails on the defective implementation |
| Suggested fix | Reject amounts less than or equal to zero |
| Status | Candidate for human review |

This is a documented fixture, not a claim that an agent discovered it. [Run both implementations and inspect the expected result](examples/checkout-boundary/README.md).

## How it works

1. Collect a branch diff, changed methods, rules, and available business context.
2. Combine static-analysis candidates with agent-led code inspection.
3. Validate finding structure and record analysis progress.
4. Produce a local HTML report or a configured platform report.
5. Let a human confirm, reject, or follow up on findings.

Coverage checks track workflow records; they do not establish exhaustive defect detection. Suspected defects and improvements remain separate from human decisions.

## Compatibility and data handling

The project is **experimental**. CLI tests exist; complete agent workflows and detection accuracy have not yet been independently benchmarked. See the [support matrix](docs/SUPPORT_MATRIX.md).

Local providers store data on disk without an OpenQA Cloud account. Your coding agent/model may transmit source context according to its configuration. Repository cloning, remote providers, and tool installation can use the network. Current analysis paths may automatically install Semgrep or GitNexus. See [FAQ and data boundaries](docs/FAQ.md).

## Documentation and contribution

- [Skill manual](skills/ai-defect-detection/README.md): requirements, adapters, and tests.
- [Getting started](docs/GETTING_STARTED.md): install, verify, update, remove.
- [Examples](examples/README.md) and [benchmark plan](benchmarks/README.md): evidence and remaining evaluation work.
- [Contributing](CONTRIBUTING.md): reproduce bugs, contribute fixtures, or improve adapters.
- [Release process](PUBLISHING.md) and [changelog](CHANGELOG.md).

Useful contributions include false-positive examples, missed-defect cases, and verified agent/environment combinations. Remove private source and credentials before sharing. [Security reporting](SECURITY.md).

## Roadmap

- [ ] Validate complete reviews across named agent and runtime versions.
- [ ] Measure false positives and missed defects on a public benchmark.
- [ ] Publish a reproducible agent-generated report and walkthrough.

Apache-2.0. See [LICENSE](LICENSE). [OpenQA website](https://openqa.cn) · [Commercial boundary](docs/COMMERCIAL_BOUNDARY.md).
