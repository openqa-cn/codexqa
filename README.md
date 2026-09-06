# OpenQA Skills

[简体中文](README.zh-CN.md)

**End-to-end quality verification infrastructure for AI software engineering.**

AI Coding changes how software is produced, but the delivery problem remains: a generated change can satisfy the prompt and still misunderstand the specification, miss a requirement, weaken a test, break an indirect caller, or pass a check that does not prove the intended behavior. Verification has to follow the change from intent to release.

OpenQA is building that verification layer for Coding Agents and engineering teams. It connects specification review, requirement review, test-case generation, code analysis, AI code review, test execution, evidence collection, and release decisions. Each capability can use the tools already in a team's workflow and can be combined with an Agent or CI pipeline.

## OpenQA and this repository

OpenQA is the organization and product initiative behind this work. The broader platform is a full-chain quality verification system: it plans checks from the change intent, understands repository and cross-repository impact, calls appropriate testing and engineering tools, and records evidence and remaining risk for a human or policy decision.

This repository is the public, local-first part of that platform. It currently ships the `ai-defect-detection` skill, including its Agent workflow, executable CLI, providers, fixtures, and tests. Other parts of the chain—such as specification and requirement review, structured test-case generation, broader code analysis, and AI Code Review integrations—are being built and will be published as they reach a reproducible release. The repository is therefore a starting point for the full OpenQA verification model, not a claim that every planned capability is already available here.

- [OpenQA website](https://openqa.cn)
- [OpenQA product](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)
- [OpenQA Skills source](https://github.com/openqa-cn/openqa-skills)

## Install

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

Choose an agent interactively. Use `--agent codex --global` for a user-level Codex installation. The installer fetches this repository from GitHub; no OpenQA or npm account is required.

Requirements for running the workflow are Node.js 22+, Git, and an agent that can read skill files and run commands. Start with the [installation guide](docs/GETTING_STARTED.md).

## Use it

After installation, ask your coding agent to review a repository and provide the requirement or test material it should use:

```text
Review REPOSITORY_URL at BRANCH_NAME with ai-defect-detection.
Check this requirement: checkout amounts must be greater than zero.
For each suspected defect, give the location, trigger, evidence, and fix.
```

The workflow collects context, analyzes changed methods, runs available checks, validates findings, and produces a report for human review. It can run with local providers or connect to configured enterprise adapters.

## Example and verification

The [checkout boundary fixture](examples/checkout-boundary/README.md) contains a known-good implementation and a seeded defect. Run it with:

```bash
node examples/checkout-boundary/verify.mjs
```

The repository test suite covers the CLI and provider behavior. It does not measure model accuracy or prove that a review found every defect:

```bash
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
```

## Boundaries

Findings are candidates for human confirmation. Local providers write to disk; the host agent/model controls how source context is processed; remote providers and automatic tool installation can use the network. The current project is experimental, and complete agent benchmarks are still pending. See the [FAQ](docs/FAQ.md) and [support matrix](docs/SUPPORT_MATRIX.md).

## Contributing

Add a public reproduction, a known-good control, expected results, and the environment used. Remove credentials and private source. Read [CONTRIBUTING.md](CONTRIBUTING.md), [PUBLISHING.md](PUBLISHING.md), and [SECURITY.md](SECURITY.md).

Apache-2.0. See [LICENSE](LICENSE).
