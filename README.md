# OpenQA Skills

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-early%20access-orange.svg)](https://openqa.cn)
[![Website](https://img.shields.io/badge/website-openqa.cn-111827.svg)](https://openqa.cn)

**Languages:** English · [简体中文](README.zh-CN.md)

Open-source verification skills for coding agents.

OpenQA helps coding agents prove that software changes work—not only generate code or tests.

> AI writes the change. OpenQA helps prove it.

## What this project provides

- `verify-change`: inspect a change, identify risk, run relevant checks, and produce a merge-readiness decision.
- `test-quality`: detect weak assertions, missing negative paths, and tests that pass without proving behavior.
- `evidence-report`: turn execution results into portable, reviewable evidence.

The skills are designed to run locally with your existing coding agent, test runner, and CI. No OpenQA Cloud account is required.

## Quick start

Clone the repository and open the skill instructions in your coding agent:

```bash
git clone https://github.com/openqa-cn/openqa-skills.git
cd openqa-skills
```

Start with [`skills/verify-change/SKILL.md`](skills/verify-change/SKILL.md). Copy or reference the instructions from your agent, then provide a local diff, acceptance criteria, and the commands that can be run safely. The current release is a contract and workflow preview; executable adapters are being added incrementally.

## Status

Early access. The public repository is being built around real, reproducible examples and benchmarks. Interfaces may change before v1.0.

## Design principles

1. Evidence over claims.
2. Local-first and tool-agnostic.
3. Existing test runners remain the execution layer.
4. A green test is not proof unless the test can fail when behavior is broken.
5. Verification and code generation should be independently reviewable.

## Roadmap

- [x] Publish the first three skill contracts
- [x] Add portable evidence schema
- [ ] Publish executable skill adapters with reproducible examples
- [ ] Add seeded-defect benchmark
- [ ] Add GitHub Action and CLI
- [ ] Add adapters for Claude Code, Codex, Cursor, Playwright, pytest, and API runners
- [ ] Document optional OpenQA Cloud capabilities for team history, assets, impact analysis, and hosted execution

See the [repository architecture](docs/ARCHITECTURE.md) for the long-term structure and maturity rules.
See [PUBLISHING.md](PUBLISHING.md) and [skills.json](skills.json) for the public Skill registry and release rules.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please share reproducible examples, failures, and adapters.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Links

- Website: https://openqa.cn
- Product preview: https://openqa.cn/agent
- Open-source project: https://github.com/openqa-cn/openqa-skills
- Report a problem: https://github.com/openqa-cn/openqa-skills/issues
- Discussions: https://github.com/openqa-cn/openqa-skills/discussions
- Support matrix: [docs/SUPPORT_MATRIX.md](docs/SUPPORT_MATRIX.md)

## Project status

This repository is the public, local-first layer of the OpenQA project. Commercial services may provide hosted execution, enterprise history, private deployment, and organization-level analysis. See [the boundary](docs/COMMERCIAL_BOUNDARY.md).
