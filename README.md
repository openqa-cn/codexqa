# OpenQA Skills

[简体中文](README.zh-CN.md)

**End-to-end quality verification for AI software engineering.**

AI Coding makes implementation cheap. Verification is still expensive. A patch can satisfy a prompt while missing a requirement, weakening a test, breaking an indirect caller, or passing checks that do not exercise the intended behavior. The evidence needed for a merge or release is usually spread across the specification, repository, test system, and delivery tools.

[OpenQA](https://openqa.cn) is building the verification layer for that workflow. It connects specification and requirement review, test-case generation, code analysis, AI code review, test execution, impact analysis, evidence collection, and release decisions. The result is a traceable answer to one question: **is this change supported by enough evidence to ship?**

## This repository

`openqa-skills` is OpenQA's public, local-first skill layer. It is designed to run alongside Coding Agents and existing CI tools. The repository currently ships [`ai-defect-detection`](skills/ai-defect-detection/README.md), an executable workflow for reviewing code changes and test plans. It includes the Agent instructions, TypeScript CLI, local and HTTP providers, fixtures, reports, and tests.

The broader OpenQA platform is being built in stages. Specification review, requirement review, structured test-case generation, broader code analysis, AI Code Review integrations, and hosted services will be published as they reach a reproducible release. They are product direction, not claims about this repository's current coverage.

- [OpenQA website](https://openqa.cn)
- [OpenQA product](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)

## Install

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

Choose an Agent when prompted. Add `--agent codex --global` for a user-level Codex installation. No OpenQA or npm account is required. See [Getting started](docs/GETTING_STARTED.md) for runtime requirements and local verification.

## Use it

After installation, give your Coding Agent an accessible repository, branch, and the requirement or test material to check:

```text
Review REPOSITORY_URL at BRANCH_NAME with ai-defect-detection.
Requirement: checkout amounts must be greater than zero.
For each suspected defect, report the location, trigger, evidence, and fix.
```

The workflow collects context, analyzes changed methods, runs available checks, validates findings, and produces a report for human review. It can use local providers or configured enterprise adapters.

## See the result

The [checkout boundary fixture](examples/checkout-boundary/README.md) contains a known-good implementation and a seeded defect:

```bash
node examples/checkout-boundary/verify.mjs
```

The [test suite](skills/ai-defect-detection/tests) covers CLI, provider, packaging, isolation, and write-back behavior. It does not measure model accuracy or prove that every defect is found:

```bash
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
```

## Boundaries and status

Findings are candidates for human confirmation. Local providers write to disk; the host Agent/model controls how source context is processed; remote providers, repository cloning, document fetching, and automatic tool installation may use the network. The project is experimental and has no published precision/recall benchmark yet. Read the [FAQ](docs/FAQ.md), [support matrix](docs/SUPPORT_MATRIX.md), and [security policy](SECURITY.md).

## Contribute

Submit a small public reproduction, a known-good control, expected results, and the environment used. Remove credentials and private source. Start with [Contributing](CONTRIBUTING.md), [examples](examples/README.md), and [Publishing](PUBLISHING.md).

Apache-2.0 · [GitHub](https://github.com/openqa-cn/openqa-skills)
