# How defect detection works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`defect-detection`](README.md) ships no model and is not another Semgrep wrapper. It is scaffolding for a host agent: changed methods are ranked by how closely they tie to a stated requirement, the agent reviews them one at a time against the spec, and validation checks that it actually read the code and that the findings can be checked.

Why the structure looks like this is below. The runtime contract is in [`SKILL.md`](SKILL.md). What the HTML report looks like: [sample page](https://github.com/openqa-cn/openqa-skills/blob/main/docs/assets/previews/defect-report.html).

## The problem: two kinds of defects, rules only catch one

Static analysers are good at bugs you can recognise by *shape*. A null dereference, a swallowed exception, `== None`, a hardcoded secret — the syntax tree is enough. You do not need to know what the program is supposed to do.

The bugs that survive review are usually the other kind: the code is valid, idiomatic, and green in tests, and it still does not match the requirement.

- Spec says “discount at 10 items”; the code uses `>`, so 10 items get no discount.
- A refund returns the requested amount and never caps it at the remaining balance.
- One function updates an inventory counter; the cache that reads the same data is never invalidated.

No grammar rule catches these. The bug is the **gap between code and intent**. Intent lives in a requirement, a test case, or a reviewer’s head — not in the AST.

A model can read the requirement and the method together and notice the mismatch. Left unconstrained, it fails in three ways, each worse than no tool:

- **Fabrication.** A defect in a method that does not exist, or line numbers it never read.
- **Hollow output.** Fluent, confident “reviewed, looks good” across 200 methods — indistinguishable from real analysis until someone checks.
- **Noise.** Every unusual line is flagged, so true positives drown and people stop reading.

One premise: **the model judges meaning; the infrastructure makes that judgement checkable.** Almost every non-obvious decision below defends one of those three failures.

## Evidence that the split is real

One blind evaluation has been run on the [`inventory-service`](https://github.com/openqa-cn/openqa-skills/blob/main/examples/inventory-service/README.md) fixture: a JavaScript repository whose feature branch hides seven business-logic defects among clean changes, plus four decoy functions that look suspicious but are correct. The agent ran the full workflow without access to the answer key.

| Signal | Result |
| --- | --- |
| Planted defects found | 7 / 7 |
| False positives on traps | 0 / 4 |
| Defects found by Semgrep seed rules | **0 / 7** |

All seven came from reading each method against the requirements; the AST pass found none of them on this fixture. That is not a knock on the seed rules — they exist to catch a different class of bug cheaply — but it does show **the hard part is the semantic layer, so that is what has to be constrained.**

Plainly: one agent, one model, one in-house fixture, one run. A demo of the contract, not a benchmark. See [known limitations](KNOWN_LIMITATIONS.md).

## Four design decisions

### 1. Two engines, deliberately unequal

`run-ast-scan` runs Semgrep with 102 bundled seed rules across ten languages, carrying CWE / OWASP / ASVS metadata. The agent, separately, analyses changed methods one at a time against requirements and test cases.

These are not redundant passes over the same ground. The seed rules are cheap, deterministic, and reproducible, and they cover shape-recognisable defects — so they run first and their findings are dismissible in bulk when they fall outside the diff. Method-level analysis is expensive and non-deterministic, so it is rationed (see next decision) and heavily validated (see the one after).

The rules also feed a specific anti-failure check: a write-back claiming strategy 8 (AST) must report a non-zero `astRuleCount` matching the rules actually loaded. An agent cannot claim "the scan found nothing" without having run a scan.

### 2. Tiering rations the expensive analysis

Not every changed method deserves the same scrutiny, and pretending otherwise is how reviewers get buried. Each item in the detection plan is stamped with a tier derived from how strongly it connects to stated intent:

| Tier | Assigned when | What is demanded of the analysis |
| --- | --- | --- |
| **T1** | A test case directly references the method | Deepest: call-chain evidence, and ≥2 distinct context files read |
| **T2** | A requirement document directly references it, or a test case references it indirectly | Call-chain evidence, ≥1 context file |
| **T3** | No documented connection — the default | Exempt from call-chain and context-depth requirements |

`T0` is a separate concept and a common source of confusion: it is a label produced by trivial-method classification (empty bodies, getters, setters, delegates) to justify auto-dismissal. It is *not* a writable tier — write-backs accept only T1/T2/T3.

Two consequences worth internalising. First, **tiers are only ever raised, never lowered**, so supplying documents late (`add-document`, `check-phase2-readiness`) re-stamps the plan upward and is safe to do at any point. Second, and more important: **with no requirements and no test cases, everything stays at T3, and the depth requirements do not apply.** The tool's rigour is a function of the intent you give it. A run against a repository with no documents is a much weaker run, and it will not tell you so loudly.

A separate `light` / `strict` mode is set from diff size (under 200 changed lines is `light`), which relaxes some evidence thresholds for small changes.

### 3. Hard rules are an anti-fabrication contract, not a style guide

Validation rules are numbered up to 24 — 20 and 23 are intentionally unused, so 23 are live — and enforced at write-back time in `scripts/validate.ts`, alongside several unnumbered checks. Reading them as a list is unilluminating; they make sense in groups, each defending one failure mode:

**"You did not actually read the code."**
Rule 14 requires a prior `register-code-read` record for the class before a finding on it is accepted. Rule 19 requires a `register-repo-clone` record. Rule 24 — enforced during `batch-update-process` — takes the method name from the finding and greps the real source file for it; a hallucinated method name fails the batch.

**"You produced words, not analysis."**
Empty `thinking` or `processSteps` is rejected outright. `thinking` under 30 characters combined with boilerplate ("no defect", "lgtm") is rejected. Executed process steps must carry non-placeholder conclusions. And a batch-level hollow-check looks across ≥20 items for the statistical signature of a model on autopilot: near-identical consecutive `thinking` blocks, high template-phrase ratio, implausible no-defect rates. Tripping it blocks the *entire* batch — nothing is submitted.

**"Your finding is not actionable."**
Rules 11–13 and 15–17 impose structure on reported defects: a `Defect:` / `Improvement:` prefix, a `Lines:X-Y` range, a fix suggestion containing a code block, an affected-business statement, a reproduction path, and problem tags marking whether the issue is `[This change]` or `[Pre-existing]`. A confidence marker is mandatory, and anything below HIGH must also carry `[Needs confirmation]`.

**"You did not look deep enough."**
Rules 6 and 22 require call-chain evidence and context-read counts, scaled by tier as in the table above.

The blunt version: these rules exist because an agent that wants to finish quickly will, unless prevented, write plausible nothing. They are the reason the output is worth reading.

### 4. Closing is a gate, not a formality

Phase 3 does not simply mark the task done. `check-analysis-quality` re-derives context-read depth from recorded evidence and blocks on shortfalls. `check-rank-integrity` verifies that every defect-status process has a corresponding report entry and vice versa — catching the case where a finding was written but never surfaced. `reconcile-report` compares the local finding set against what the report actually renders. `finalize-all` chains these, auto-fills missing ranks, validates report content (including a minimum content length per entry), and refuses to complete the task if any blocker survives.

## The pipeline

Three phases, each writing sharded state under `data/{taskId}/`:

```text
Phase 1 — Preparation                    writes
  submit-git / phase1-init                 meta.json, static.json
  clone-and-diff [--with-plan]             meta.diff, services.localDir
  build-detection-plan                     plan.json  (tier, mode, trivial)
  add-document / add-test-case             static.extractedRules, test_cases.json
  check-phase2-readiness                   plan.json  (tiers re-stamped upward)

Phase 2 — Detection
  run-ast-scan                             (in-memory findings; agent writes back)
  register-code-read / register-context-read   writebacks.contextReads
  update-process / batch-update-process     writebacks.processWritebacks
  finalize-rank                             writebacks.ranks

Phase 3 — Close
  check-analysis-quality                    (blocks on insufficient depth)
  finalize-all --summary                    report HTML, task completion
```

The state split matters for one practical reason: `meta.json`, `plan.json`, and `writebacks.json` are separate files precisely so a long run can be resumed or inspected mid-flight without replaying Phase 1.

## Where the model fits

OpenQA does not ship a model. The host agent — Codex, Claude Code, Cursor, OpenClaw — supplies the reasoning, and `SKILL.md` plus the `references/` tree supply the instructions it follows, loaded progressively as the task demands them. Everything in this document describes the scaffolding *around* that reasoning: what the agent is required to look at, what evidence it must produce, and what happens when it does not.

This has a direct implication for results: **detection quality varies with the host model**, and the 7/7 figure above is one model on one fixture. It is also why the validation layer is worth its complexity — it is the part that stays constant when the model underneath changes.

## Reading further

| Topic | Document |
| --- | --- |
| What the tool cannot do, with concrete failure cases | [Known limitations](KNOWN_LIMITATIONS.md) |
| Verified runtimes, languages, and evidence | [Support matrix](https://github.com/openqa-cn/openqa-skills/blob/main/docs/SUPPORT_MATRIX.md) |
| Runnable fixtures including the blind-eval repository | [Examples](https://github.com/openqa-cn/openqa-skills/blob/main/examples/README.md) |
| Repository layout and documentation audiences | [Architecture](https://github.com/openqa-cn/openqa-skills/blob/main/docs/ARCHITECTURE.md) |
| Agent-facing runtime contract | [`SKILL.md`](SKILL.md) |
| Rule-by-rule validation reference | [`validation-rules.md`](references/rules/validation-rules.md) |
