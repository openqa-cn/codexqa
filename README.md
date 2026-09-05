# OpenQA Skills

Open-source verification skills for coding agents.

OpenQA helps coding agents prove that software changes work—not only generate code or tests.

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
- Commercial platform: https://openqa.cn/agent
- Report a problem: https://github.com/openqa-com/openqa-skills/issues
