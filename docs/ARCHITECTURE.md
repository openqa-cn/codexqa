# Repository architecture

codexqa uses a single-repository model while the interfaces are still evolving. This keeps the public installation path simple and lets the project establish shared evidence and quality standards before splitting components.

```text
codexqa/
├── skills/       # Agent-facing workflows and skill contracts
├── schemas/      # Stable machine-readable contracts
├── scripts/      # Repository checks (check-docs.py)
├── examples/     # Small, runnable public examples
├── benchmarks/   # Seeded defects and evaluation methodology
├── docs/         # Architecture, support, roadmap, release, and commercial boundaries
├── skills.json   # Installer-facing skill index
└── .github/      # CI, issue forms, contribution automation
```

## Where documentation lives

A skill is installed on its own. `npx skills add … --skill codexqa-defect-analyzer` and `pack-skill.sh` both copy exactly one directory, `skills/<name>/`, so **anything a user needs after installing has to live inside that directory.** Repository-level files do not travel with it.

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
| **Evaluating or using a skill** | The skill's own human-facing documentation (`README.md`, plus `HOW_IT_WORKS.md` / `KNOWN_LIMITATIONS.md` where present); [Getting Started](GETTING_STARTED.md), [Support matrix](SUPPORT_MATRIX.md), [FAQ](FAQ.md), [examples](../examples/README.md) | Start here. Enough to decide whether to trust the tool and how far. [Index of per-skill method docs](HOW_IT_WORKS.md). Sample HTML/screenshots: [README · What the output looks like](../README.md#what-the-output-looks-like). |
| **The agent, at runtime** | `skills/*/SKILL.md` and `skills/*/references/**` | Loaded progressively when a task triggers the skill, not read front to back. This is by far the bulk of the text and it is written as instructions to a model, not as a manual. |
| **Operating, extending, contributing** | [Contributing](../CONTRIBUTING.md), this document, [benchmarks](../benchmarks/README.md), `skills/codexqa-defect-analyzer/README.md` / `HOW_IT_WORKS.md` | Human-facing skill docs; `SKILL.md` is agent-facing and marks README/HOW_IT_WORKS as not needed at runtime. |

A practical consequence: to understand *how a skill works*, start with its human-facing README or `HOW_IT_WORKS.md` rather than opening `references/` or deep stage specs. Those trees answer "what exactly must the agent do at step N" — a different question with a much longer answer. Index: [How the skills work](HOW_IT_WORKS.md). Examples: [codexqa-skill-router](../skills/codexqa-skill-router/HOW_IT_WORKS.md), [codexqa-code-analyzer](../skills/codexqa-code-analyzer/README.md), [codexqa-rootcause-analyzer](../skills/codexqa-rootcause-analyzer/HOW_IT_WORKS.md), [codexqa-defect-analyzer](../skills/codexqa-defect-analyzer/HOW_IT_WORKS.md), [codexqa-code-reviewer](../skills/codexqa-code-reviewer/HOW_IT_WORKS.md), [codexqa-requirement-analyzer](../skills/codexqa-requirement-analyzer/HOW_IT_WORKS.md), [codexqa-testcase-generator](../skills/codexqa-testcase-generator/HOW_IT_WORKS.md), [codexqa-testdata-generator](../skills/codexqa-testdata-generator/HOW_IT_WORKS.md).

## Naming and maturity

- A skill directory uses a short action-oriented name, such as `codexqa-skill-router`, `codexqa-code-analyzer`, `codexqa-rootcause-analyzer`, `codexqa-defect-analyzer`, `codexqa-code-reviewer`, `codexqa-requirement-analyzer`, `codexqa-testcase-generator`, or `codexqa-testdata-generator`.
- `SKILL.md` is the agent-facing contract.
- Examples and tests are required before a skill is called supported.
- Experimental adapters may change without a compatibility promise.
- Schemas use explicit versions; breaking changes require a new version and migration notes.

## Why one repository first

The project is intentionally not split into one repository per skill yet. Splitting too early fragments stars, issues, documentation, and contributor discovery. A component should become a separate repository only when it has an independent release cadence, maintainers, and a stable public API.
