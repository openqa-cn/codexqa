# Known limitations and failure cases

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is something we have observed or verified in the code, not a defensive disclaimer. If you are evaluating this tool, this page is more useful than the feature list. Read [how it works](HOW_IT_WORKS.md) first for the design context.

## The big one: rigour depends on the intent you supply

Detection tiers are derived from how strongly a changed method connects to a requirement document or test case. With neither, **every plan item stays at T3**, and T3 is exempt from the call-chain requirement (rule 6) and the context-depth requirement (rule 22).

So a run against a repository with no documents does not fail — it quietly becomes a much shallower run. The findings are still validated for structure and authenticity, but the depth guarantees are gone.

Practically: if you point the skill at a branch and give it nothing else, you are getting the weakest configuration. Supply requirements via `add-document` and cases via `add-test-case`, then run `check-phase2-readiness` to re-stamp tiers upward. This was a real defect we hit during evaluation — documents added mid-run did not lift tiers until `restamp_plan_relevance` was wired into `add-document`.

## Depth rules 21 and 22 arm themselves from the plan, not from the code being reviewed

Hard rule 21 (minimum detection depth) and rule 22 (context-read count) read `_minDetectLevel`, `_contextReadsCount` and `_mode` off the write-back request body. `update_process` now copies all three from the plan item before validation, so they fire without the agent volunteering anything — but only as far as the plan is right. A method the plan never saw, or one written back under a className the plan does not carry, still bypasses both rules.

This was an open gap until the self-scan run: only `detectTier` was injected, and it was injected *after* validation, so the two rules were inert in every production path.

Depth enforcement is still layered: Phase 3's `check-analysis-quality` re-derives context-read depth from recorded `contextReads` and blocks on shortfalls at close time.

## Method extraction is approximate outside the JVM

Per-language unit extraction uses regex and brace/indentation heuristics, not real parsers. Known consequences:

- Nested and anonymous functions are frequently folded into their enclosing unit rather than extracted separately.
- Macro-heavy C is approximated; complex preprocessor use can misalign ranges.
- Python extraction is indentation-based, so unusual formatting can shift boundaries.
- When extraction finds nothing for a changed file, it falls back to a **file-level unit** rather than skipping — this keeps the plan non-empty but produces coarser analysis for that file.

Call-graph analysis is attempted through GitNexus for every profiled language except JavaScript and TypeScript, which skip it outright. But *attempted* is the operative word: only Java is verified end to end. For the other seven the call graph may come back thin or empty, and the pipeline falls back to grep-based caller search without failing the run — so treat call-chain evidence outside Java as best-effort, and weigh the agent's own context-read records more heavily there.

## Static rules find a different class of defect than you might expect

On the `inventory-service` blind evaluation, the 102 Semgrep seed rules contributed **zero** of the seven detections. All seven were business-logic defects — a wrong comparison operator against a documented tier boundary, a missing cache invalidation across two functions, an uncapped refund amount. These have no syntactic signature.

The seed rules earn their place on injection, taint, and hygiene patterns, not on business logic. Do not read a clean AST pass as a clean review. Additionally, taint rules run intra-function only on Semgrep Community Edition, and older Semgrep versions silently drop rules they cannot parse (reported in `droppedRules`).

## Evidence quality is one sample, one model

The headline 7/7 recall and 7/7 precision figures come from a single agent, a single model, a single run, on a fixture we authored ourselves. That is a demonstration that the contract works end to end. It is **not** a benchmark, and it should not be compared against published benchmark numbers for other tools.

What is missing before it could be called one: multiple models, variance across repeated runs, third-party fixtures, and defect classes we did not plant. Detection quality varies with the host model, and we have not measured that variance.

## Platform and environment

- **Windows** is structurally supported — no `/tmp` assumptions, `.cmd` shims handled, LF enforced via `.gitattributes` — but has no CI host yet. Semgrep on Windows is beta and GitNexus is untested there. Quick-start snippets assume Git Bash or WSL.
- **Concurrency** is not certified. Local providers write JSON to disk; concurrent or multi-user operation against the same data directory is untested.
- **Optional overlays** (gitleaks, trivy, bandit, ruff, gosec, eslint, detekt, …) are covered only by stubbed-binary unit tests. No real-binary CI run exists, and several need the project's own config or toolchain.
- **A Node/TypeScript backend is classified as a client language** by the frontend heuristic, which keys off the language family (`js`) rather than the project's role. It will be asked for semantic-case compilation as if it were a browser app. Set the service's `serviceKey` explicitly if that gate is wrong for your repo. **Go, Python, C, C++ and C# are not client languages**: they use a path-style `className` so the report can record `gitFilePath`, but they must not take the frontend write-back path or load `frontend-gotchas.md`.
- **`.h` headers are always treated as C**, never C++. The extractor is shared, so units and ranges are unaffected, but a header-only change in a C++ repo loads the C seed rules rather than the C++ set.
- **HTTP / GitHub providers** have adapter implementations and selected contract tests, but no verified deployment.

## Fundamental limits

Findings are candidates for human confirmation. The tool cannot prove the absence of defects, cannot infer business rules you did not give it, and does not replace tests, security review, or maintainer judgement. A clean report means "nothing was found under these constraints", which is a much weaker statement than "nothing is wrong".

## Reporting a gap

Minimal public reproductions of false positives and missed defects are among the most useful contributions to this repository — more useful than most feature requests. See [Contributing](CONTRIBUTING.md), and strip credentials and proprietary source before sharing.
