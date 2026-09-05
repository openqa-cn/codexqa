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

## Status

Early access. The public repository is being built around real, reproducible examples and benchmarks. Interfaces may change before v1.0.

## Design principles

1. Evidence over claims.
2. Local-first and tool-agnostic.
3. Existing test runners remain the execution layer.
4. A green test is not proof unless the test can fail when behavior is broken.
5. Verification and code generation should be independently reviewable.

## Roadmap

- [ ] Publish the first three production-usable skills
- [ ] Add portable evidence schema
- [ ] Add seeded-defect benchmark
- [ ] Add GitHub Action and CLI
- [ ] Add adapters for Claude Code, Codex, Cursor, Playwright, pytest, and API runners
- [ ] Document optional OpenQA Cloud capabilities for team history, assets, impact analysis, and hosted execution

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

## Project status

This repository is the public, local-first layer of the OpenQA project. Commercial services may provide hosted execution, enterprise history, private deployment, and organization-level analysis. See [the boundary](docs/COMMERCIAL_BOUNDARY.md).
