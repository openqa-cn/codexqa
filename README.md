# OpenQA Skills

**Verification infrastructure for AI software engineering.**

AI coding tools can produce a patch quickly. They do not automatically show that the patch satisfies the requirement, covers the affected code paths, or remains safe to merge. Tests may pass while checking the wrong behavior; a code review may miss an indirect caller or a business rule hidden in another document.

OpenQA adds a verification layer around that work. It connects change intent, repository context, code impact, tests, static analysis, runtime evidence, and human decisions. The goal is a reviewable answer to a practical question: **is this change supported by enough evidence to merge or release?**

## What OpenQA provides

OpenQA is building an open platform for AI software engineering verification:

- **Verifier / Agent** plans and runs checks for a concrete software change.
- **Skill Hub** distributes reusable skills and MCP tools for coding agents.
- **Engineering systems and SaaS** connect requirements, test cases, issues, traces, and release workflows. Cross-repository code graphs and change-impact analysis are examples of this layer.
- **Benchmarks and tool catalogues** record what a tool can do and how it performs on reproducible tasks.

This repository is the public, local-first skill layer. It contains the `ai-defect-detection` workflow, its executable CLI, providers, fixtures, and tests. Product services and hosted capabilities may live outside this repository; see the [commercial boundary](docs/COMMERCIAL_BOUNDARY.md).

- [OpenQA website](https://openqa.cn)
- [OpenQA product](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)

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
