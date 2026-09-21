# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is a real boundary of the current skill, not a marketing disclaimer. Read [how it works](HOW_IT_WORKS.md) first for the design split.

## Depends on closed-source `@openqa-cn/codexqa`

Structured repo analysis comes from the separately distributed npm package `@openqa-cn/codexqa`. This repository publishes the skill scripts, prompts, and report contract; it does **not** include the engine source. Install and talk to the `codexqa` binary only.

## Not exercised by this repository's CI

Local `bash scripts/validate-skill.sh` covers static layout, fixture validate/render smoke, and plan-coverage audit. The closed-source CLI is not installed or executed by the repository CI, so end-to-end index/query success depends on the user's machine and package version.

## Review prose and Agent LLM judgment are model-judged

Bash collects signals, runs `merge-llm-findings.py` for deterministic dedupe, and renders HTML from `review-conclusion.json`. Whether findings, dimension cards, bilingual prose, and the order-16 Agent LLM judgment candidates are *true* for the business domain is decided by the host model. A pack that validates can still yield a wrong report if the model invents edges, ignores `confidence: UNKNOWN`, or proposes novel issues that miss the pack scope. Dedupe removes duplicate phrasing; it does not prove correctness.

## Graph gaps weaken evidence

When CodexQA cannot resolve callers, reachability, or test edges (parser limits, stubs ≥ 20, collisions, missing index), cap edge/reach findings at **UNKNOWN**. Prefer `edges-in` callers over `from_count`. Never treat a path under `test/` as proof of coverage.

## No published host-agent score

There is no public answer-key fixture and no recorded host-agent score for full live reviews. Treat a finished `REVIEW-REPORT.html` as the intended design path, not as a measured false-positive rate.

## Workflow boundary

This skill produces **graph-backed review reports**. It does not replace `defect-detection` scan reports, `code-analyzer` ad-hoc graph Q&A, or `root-cause-diagnosis` exception RCA.
