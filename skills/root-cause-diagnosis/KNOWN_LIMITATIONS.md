# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is a real boundary of the current skill, not a marketing disclaimer. Read [how it works](HOW_IT_WORKS.md) first for the design split.

## Depends on closed-source `@openqa-cn/codexqa`

Structured repo analysis comes from the separately distributed npm package `@openqa-cn/codexqa`. This repository publishes the skill scripts and report contract; it does **not** include the engine source. Install and talk to the `codexqa` binary only.

## Not exercised by this repository's CI

Local `npm test` covers parse, materialize, draft, and CLI smoke paths. The closed-source CLI is not installed or executed by the repository CI, so end-to-end index/query success depends on the user's machine and package version.

## RCA narrative is model-judged

TypeScript extracts facts and rejects mechanical `storyGaps`. Optional narrative (race/contend, catch-all swallow, line-drift hypothesis, weak-frame labels) is required only when the matching facts flag is set; inventing those claims without evidence is rejected. Overstating `Confidence: high` when `facts.confidence` is `medium` is also rejected. Whether other causal sentences are *true* for this business domain is still decided by the host model. A report that passes `write-report` can still be wrong if the model invents edges or misreads contracts.

## Graph gaps weaken evidence

When CodexQA cannot resolve frames, callers, or branch targets (parser limits, stubs, collisions, missing index), evidence is marked weak or hypothetical. Missing graph → hypothesis + how to verify; never invent call edges. After a real `ensure-codexqa` attempt with `ready=false`, grep is allowed and confidence must stay low.

## No published host-agent score

There is no public answer-key fixture and no recorded host-agent score comparable to defect-detection's inventory-service 7/7. Treat a finished English report as the intended design path, not as a measured RCA accuracy claim.

## Workflow boundary

This skill diagnoses **exceptions**. It does not replace `code-analyzer` for change-impact review, `defect-detection` for requirement write-back, or `code-reviewer` for P0/P1/P2 findings.
