# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

This file covers the limits of the `codexqa-code-analyzer` skill and its required local analysis engine.

## Distribution boundary

The skill files, playbook, query schemas, and examples are published in this repository. The `codexqa` command comes from the separately distributed, closed-source `@openqa-cn/codexqa` npm package. The engine source is not included in this repository.

Indexing and graph queries run locally and do not require an LLM. Installation downloads the npm package, and optional features that use configured external services may use the network. Local indexes and sessions are stored under `~/.codexqa/`; uninstalling the CLI does not automatically remove that data.

## Compatibility and verification

- This repository does not currently install or execute the closed-source CLI in CI.
- No public host-agent run or independent quality benchmark has been published for `codexqa-code-analyzer`.
- The example diagram shows the report contract; it is not a recorded analysis of a public repository.
- A formal skill-to-CLI version compatibility matrix has not been published yet. Check `codexqa --version` when reporting a problem.

See the repository [support matrix](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md) for the current evidence status.

## Graph completeness

The graph can miss or approximate relationships when a language construct, framework convention, generated source, macro, dynamic dispatch, reflection, or runtime registration is not resolved by the parser. Stub nodes and symbol collisions can also reduce confidence. Review `stats` and `summary` before treating impact results as complete.

## What the signals mean

- A `tests` edge is a static graph relationship, not runtime code coverage.
- No `tests` edge means "no graph-backed test relationship was found," not "this code is definitely untested."
- Reachability describes paths represented in the index. It does not prove that a runtime path is feasible under every condition.
- HTTP / RPC / MQ / scheduled-task entry detection depends on available framework tags and source patterns.
- Full-text search requires a separate search index and can be affected by tokenizer choice.

## Workflow boundary

`codexqa-code-analyzer` maps structure, change impact, callers, entries, and test gaps. It does not execute tests, prove the absence of defects, decide whether code matches a business requirement, or replace graph-evidence code review. Use `codexqa-defect-analyzer` for SAST + Agent LLM Detection code-risk scans, `codexqa-code-reviewer` for CodexQA evidence-pack HTML review (incl. Agent LLM judgment), and `codexqa-rootcause-analyzer` for full exception root-cause reports on top of the CodexQA CLI.
