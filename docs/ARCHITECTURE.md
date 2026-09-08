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

## Where documentation lives

A skill is installed on its own. `npx skills add … --skill defect-detection` and `pack-skill.sh` both copy exactly one directory, `skills/<name>/`, so **anything a user needs after installing has to live inside that directory.** Repository-level files do not travel with it.

That single constraint decides the layout:

| Content | Location | Why |
| --- | --- | --- |
| `SKILL.md`, `references/`, `scripts/`, `assets/` | Inside the skill | The agent loads them at runtime |
| `README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md` | Inside the skill | Skill-specific, and needed after install |
| Installation, contribution, security policy, code of conduct, this document | Repository level | Shared across skills |
| `examples/`, `benchmarks/` | Repository level | Fixtures are large and shared; skills link to them by absolute URL |

Two rules follow, and `scripts/check-docs.py` enforces both:

- **A relative link inside a skill must not escape the skill directory.** It resolves correctly in the repository and breaks after install, which is why the check exists rather than relying on review.
- **Cross-boundary references use absolute GitHub URLs**, not `../../`.

## Documentation audiences

Three different readers, and the largest body of text is not written for humans at all.

| Audience | Where to read | Notes |
| --- | --- | --- |
| **Evaluating or using a skill** | The skill's own `README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md`; plus [Getting Started](GETTING_STARTED.md), [Support matrix](SUPPORT_MATRIX.md), [FAQ](FAQ.md), [examples](../examples/README.md) | Start here. Enough to decide whether to trust the tool and how far. [Index of per-skill method docs](HOW_IT_WORKS.md). |
| **The agent, at runtime** | `skills/*/SKILL.md` and `skills/*/references/**` | Loaded progressively when a task triggers the skill, not read front to back. This is by far the bulk of the text and it is written as instructions to a model, not as a manual. |
| **Operating, extending, contributing** | [Contributing](../CONTRIBUTING.md), this document, [benchmarks](../benchmarks/README.md), `skills/defect-detection/references/operator-manual.md` | The operator manual sits under `references/` next to the agent files but is explicitly a human walkthrough; `SKILL.md` marks it as not needed by the agent. |

A practical consequence: to understand *how a skill works*, read that skill's `HOW_IT_WORKS.md` rather than opening `references/` or `generation/`. Those trees answer "what exactly must the agent do at step N" — a different question with a much longer answer. Index: [How the skills work](HOW_IT_WORKS.md). Examples: [defect-detection](../skills/defect-detection/HOW_IT_WORKS.md), [code-reviewer](../skills/code-reviewer/HOW_IT_WORKS.md), [requirements-analyzer](../skills/requirements-analyzer/HOW_IT_WORKS.md), [testcase-generation](../skills/testcase-generation/HOW_IT_WORKS.md), [testdata-generation](../skills/testdata-generation/HOW_IT_WORKS.md).

## Naming and maturity

- A skill directory uses a short action-oriented name, such as `defect-detection`, `code-reviewer`, `requirements-analyzer`, `testcase-generation`, or `testdata-generation`.
- `SKILL.md` is the agent-facing contract.
- Examples and tests are required before a skill is called supported.
- Experimental adapters may change without a compatibility promise.
- Schemas use explicit versions; breaking changes require a new version and migration notes.

## Why one repository first

The project is intentionally not split into one repository per skill yet. Splitting too early fragments stars, issues, documentation, and contributor discovery. A component should become a separate repository only when it has an independent release cadence, maintainers, and a stable public API.
