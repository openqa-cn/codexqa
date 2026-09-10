# Known limitations and failure cases

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is something visible in the files or observed while running the skill, not a defensive disclaimer. Design context: [How it works](HOW_IT_WORKS.md).

## No public fixture, no measured accuracy

There is no answer-key repository and no recorded host-agent score comparable to defect-detection's inventory-service 7/7. `tooling/` contract tests lock script behavior (skip, missing token, progress, no-diff). They do not prove that a model will cite a real line or keep P1/P2 noise down.

## This is not defect-detection

The two skills can both be triggered by “review this PR”. They do different jobs:

| | `code-reviewer` | `defect-detection` |
|---|---|---|
| Input | Local checkout + branch / PR / commit | Git URL + branch (clones) |
| Engine | Playbooks + optional `tooling/` | CLI, AST, optional call-graph, 23 write-back rules |
| Output | P0 / P1 / P2 findings report | Structured write-backs + HTML report |

Installing only this skill does not create a detection task, does not run Semgrep seed packs, and does not validate findings against source the way `validate.ts` does.

## Locations are a playbook rule, not a mechanical gate

P0 asks for file:line, a runtime consequence, and a rule citation. Nothing in `tooling/` re-reads the file to prove the line exists. A model can still invent a location and mark the three-step check as done. Human review of the report is required.

## Optional scripts are optional

`review-progress.js`, security/dependency scans, and packers are skipped when Node cannot run them or the host blocks the command. The review continues without a progress file; resume-from-breakpoint is then unavailable. That is by design (Convention A in `review-playbook.md`), not a failed install.

## HTTP integrations stay off until you enable them

Without `code-reviewer.config.json` in the **reviewed** repository, browse-URL templates and all `integrations.*` are unused. The skill will not discover an internal Git browser or a notify webhook from the OpenQA repo.

## License is MIT

This skill is MIT (`LICENSE` in this directory). The rest of `codexqa` is Apache-2.0. Do not assume SPDX of the parent repository applies to files here.
