# Repository architecture

OpenQA Skills uses a single-repository model while the interfaces are still evolving. This keeps the public installation path simple and lets the project establish shared evidence and quality standards before splitting components.

```text
openqa-skills/
├── skills/       # Agent-facing workflows and skill contracts
├── schemas/      # Stable machine-readable contracts
├── adapters/     # Tool and framework integrations (future)
├── examples/     # Small, runnable public examples
├── benchmarks/   # Seeded defects and evaluation methodology
├── docs/         # Architecture, support, release, and commercial boundaries
└── .github/      # CI, issue forms, contribution automation
```

## Naming and maturity

- A skill directory uses a short action-oriented name, such as `verify-change`.
- `SKILL.md` is the agent-facing contract.
- Examples and tests are required before a skill is called supported.
- Experimental adapters may change without a compatibility promise.
- Schemas use explicit versions; breaking changes require a new version and migration notes.

## Why one repository first

The project is intentionally not split into one repository per skill yet. Splitting too early fragments stars, issues, documentation, and contributor discovery. A component should become a separate repository only when it has an independent release cadence, maintainers, and a stable public API.
