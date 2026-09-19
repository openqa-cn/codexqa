# Open source and commercial boundary

## Open source

- Skills and workflows
- Evidence schema
- Repository CI checks
- Example projects
- Reproducible benchmark fixtures

## Closed-source local engine

`code-analyzer` uses the separately distributed `@openqa-cn/codexqa` npm package. This package is a closed-source local code-analysis engine; its source is not included in this repository. It builds and queries indexes on the user's machine, and index/query operations do not require an LLM. Local data is stored under `~/.codexqa/`.

The public Skill defines when to invoke the engine, which evidence to query, how to interpret the results, and what limitations must be disclosed. See the [`code-analyzer` known limitations](../skills/code-analyzer/KNOWN_LIMITATIONS.md).

## Commercial extensions

- Private repository and team history
- Enterprise test-asset graph
- Cross-repository change impact analysis
- Request-level coverage analytics
- Hosted execution, devices, and environments
- Enterprise identity, policy, audit, and private deployment

The public Skill pack must be independently useful. The closed-source local analysis engine is an explicit dependency of `code-analyzer`, not a hidden replacement for the other five workflows. Commercial products reduce organizational operating cost and preserve long-term context; they should not merely remove the first successful local workflow.

## Project status language

Use `shipped` only for capabilities present in this repository or a released product. Use `experimental`, `private beta`, or `planned` for everything else. Public case studies and metrics must identify their methodology, sample, time period, and whether they are illustrative.
