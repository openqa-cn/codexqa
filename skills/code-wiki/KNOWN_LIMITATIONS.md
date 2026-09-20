# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

This file covers the limits of the `code-wiki` skill and its required local analysis engine.

## Distribution boundary

The skill files, playbook, and examples are published in this repository. The `codexqa` command comes from the separately distributed, closed-source `@openqa-cn/codexqa` npm package. The engine source is not included in this repository.

Indexing, `wiki inputs`, and `wiki --no-llm` run locally and do not require an LLM. Installation downloads the npm package. Local indexes live under `~/.codexqa/`; uninstalling the CLI does not automatically remove that data.

## Compatibility and verification

- This repository does not currently install or execute the closed-source CLI in CI.
- No public host-agent run or independent quality benchmark has been published for `code-wiki`.
- Diagram templates show the report contract; they are not a recorded analysis of a public repository.
- A formal skill-to-CLI version compatibility matrix has not been published yet. Check `codexqa --version` when reporting a problem.

## Graph and community completeness

Communities come from Leiden clustering plus directory / module priors and a page cap. Cuts can split a real package or merge unrelated files. Stub nodes and symbol collisions also reduce confidence. Review `stats` / `summary` and the `communities` vs `selected` counts before treating the map as complete.

Without a model, page titles are rule titles (often directory-like). That is expected. Do not rewrite them into product names unless signatures justify it.

`wiki inputs` for `visualization` / `architecture` / `overview` uses those rule titles and has no model-written body. Empty `（无摘要）` is not a finding.

## What the signals mean

- `deps` and `cross_community` are static graph relationships between communities, not runtime coupling.
- Empty `deps` means “no counted cross-community edge”, not “this code is unused”.
- `call_chain` / `method_flows` are digest excerpts under a token budget, not the full method body.
- `called_by` on a signature is fan-in in the digest, not production traffic.
- A reading guide is a path through listed deps. It is not a proof that a newcomer should read only those files.

## Workflow boundary

`code-wiki` maps communities, real dependencies, and onboarding paths. It does not call `codexqa wiki` without `--no-llm`, does not run `wiki embed` or `query wiki`, does not review a change, and does not assign P0 / P1 / P2 findings. Use `code-analyzer` for impact and test gaps, `defect-detection` for requirement-oriented defects, and `code-reviewer` for implementation review.
