# Method analysis framework (STEP A/B/C/C.5/D)

> This file defines the full detail of the 4-step mandatory analysis for every process in Phase 2.
> The references/phase2-detection.md trunk keeps only a compact decision flow; dimensions and rules live here.

---

## Contents

- [Overview](#overview)
- [STEP A: Read code](#step-a-read-code)
- [STEP B: Read context](#step-b-read-context)
- [STEP C: Analyze and judge](#step-c-analyze-and-judge)
- [Facade / proxy vs first-party handler](#facade--proxy-vs-first-party-handler-must)
- [STEP C.5: Systematic self-review before writeback](#step-c5-systematic-self-review-before-writeback)
- [STEP D: Build writeback](#step-d-build-writeback)
- [strategy=11 special requirements](#strategy11-special-requirements)
- [Extra requirements for frontend / client projects](#extra-requirements-for-frontend-client-projects)
- [Extra requirements when docs exist (`$ISSUE_LIST[]` non-empty)](#extra-requirements-when-docs-exist-issue_list-non-empty)
- [Extra requirements when test cases exist (HAS_CASES=true)](#extra-requirements-when-test-cases-exist-has_casestrue)
- [Extra requirements when submitted defects exist (see L2.1)](#extra-requirements-when-submitted-defects-exist-see-l21)
- [minDetectLevel minimum-depth constraint](#mindetectlevel-minimum-depth-constraint)
- [Phase 3 quality gate (check-analysis-quality)](#phase-3-quality-gate-check-analysis-quality)

---

## Overview

```
STEP A (read code) → STEP B (read context) → STEP C (analyze & judge) → STEP C.5 (self-review) → STEP D (build writeback)
```

Every step is MUST (do not skip).

---

## STEP A: Read code

1. Open the file at gitFilePath and locate the methodName line range
2. Read the full method (including comments and annotations)
3. Call `register-code-read`

**When the file/method does not exist**: write back bugStatus=2, thinking="file/method does not exist: <reason>", processSteps stepStatus="failed", then go to the next one.

### register-code-read command

```bash
node "$SKILL_SCRIPT" register-code-read \
  --task-id $TASK_ID --batch-id $BATCH_ID \
  --class-name "<className>" --file-path "<filePath>" \
  --code-snippet "<first 50 chars of the code>"
```

`--class-name` may be the pending FQCN (`com/foo/Bar`) or the short class name (`Bar`). The code-read gate matches both, including slash vs dot.

---

## STEP B: Read context

1. Read callers of the method (default GitNexus `impact({direction:"upstream"})`; grep methodName only if `ensure-gitnexus` already tried to install and still failed)
2. Read dependencies the method calls (default `impact({direction:"downstream"})` / `context()`; if unavailable, read dao/rpc/service)
3. Read related config (enums / constants / Mapper)
4. Read cross-repo upstream/downstream (caller-service and callee-service interface contracts and implementations)
5. For iteration-level analysis, understand context from all repo changes in this iteration together (do not look at one repo in isolation)

### Shared reads inside a chain group (mandatory optimization when chainGroupId is non-empty)

When the current method belongs to a chain group (`$DETECTION_PLAN[].chainGroupId` is non-empty, e.g. `A→B→C` all in `chain-1`),
**STEP A code reads and STEP B context understanding happen once per group and are shared**, so the same Call chain is not rebuilt per method:

1. When entering the chain group, **read the full code of every method in the group once** in `A→B→C` order from the entry, plus upstream/downstream/deps/config shared by the whole chain.
2. When each method in the group runs STEP C, **reuse** this already-read chain code and context. Do not reopen the same file or re-understand the same chain.
3. **Credentials cannot be skipped** (core constraint 3 validation is the authority): even though reads are shared, **every className in the group must still `register-code-read`** (Hard rule 14), and **every strategy=11 method must still `register-context-read` to its tier's minimum** (Hard rule 22: T1 ≥2, T2 ≥1, T3 exempt; light mode lowers by one). What is shared is "the read action and the analysis understanding", not "per-process registration credentials".

> When `chainGroupId=null` (isolated method / cross-repo unreachable / dynamic dispatch cannot be computed), do not share; follow items 1–5 above per method.

### register-context-read command (MUST)

Every time you read a context file (caller / dependency / config / upstream / downstream), you **must** call `register-context-read` to persist it. This record is used by the Phase 3 quality gate (Hard rule 22) to verify analysis depth.

```bash
node "$SKILL_SCRIPT" register-context-read \
  --task-id $TASK_ID --batch-id $BATCH_ID \
  --class-name "<className currently being analyzed>" \
  --purpose "<caller|dependency|config|upstream|downstream>" \
  --file-path "<repo-relative path of the file that was read>" \
  --lines-read "<e.g. 12-48>"
```

**Parameters**:

| Parameter | Meaning | Allowed values |
|------|------|--------|
| purpose | Why the file was read (context type) | caller / dependency / config / upstream / downstream (default dependency) |
| file-path | Path of the file that was read (repo-relative preferred) | string |
| lines-read | Line range actually read | `X-Y`, optional |

Distinct `file-path` values count toward Hard rule 22; registering the same file twice does not.

**Hard constraints**:

- For strategy=11: T1 needs ≥ 2 contextReads, T2 needs ≥ 1, **T3 and trivial-filter methods are exempt** (Hard rule 22 / `check-analysis-quality`)
- For other strategies, ≥ 1 is recommended; not a hard intercept yet
- Skipping register-context-read on a T1/T2 method does not block entering STEP C, but the final `check-analysis-quality` quality gate will fail. Do not invent STEP B reads for T3.

---

## STEP C: Analyze and judge

### Choose the analysis view by strategy

| Strategy | Analysis view |
|------|----------|
| s11 | L1+L2+L3: Agent decides depth by method difficulty (detectTier) — code logic / Call chain / business comparison |
| s8 | L1 (code patterns): AST rule-hit patterns (handled independently in Step 2.1; does not enter this flow) |

If the same method has both s8 and s11, each strategy's conclusion is written back independently. Do not merge.

### L0 rule compare (MUST when rules exist)

1. Load `get_rules_for_agent_strategy(grouped, current strategyCode)`
2. Take category=2 (custom) + category=4 (generic) rules
3. Compare the current method against each known defect pattern
4. Also check category=3 exclusion rules; if an exclusion scene hits, mark excluded
5. On a hit, thinking cites the rule number + description

### L1 pure-code analysis

Judge whether the logic itself is correct + exception traffic. No fixed checklist — any problem that can be derived directly from the code is L1.

### L2 business-context deep analysis

Deep analysis with business context (single-repo + cross-repo) — combine code + historical defects + business knowledge to judge defect likelihood.

#### L2.1 Check issues related to already-submitted defects (MUST when submitted defects exist)

**Purpose**: use already-submitted defects as clues to find **new problems** in this code and sync them to the detection platform. **Do not write back the fix status of any already-submitted defect, and do not update its recheck status** — this step only produces new defects for this detection.

**Data source**: the "submitted defects" list under this test plan / iteration. Prefer querying via the **plan provider**:

- By test plan: `get-delivery-defects --plan-id <planId>`
- By iteration detail page: `get-delivery-defects --plan-id <iterationId> --plan-type 4` (mutually exclusive with `-p`)

> If the plan provider has no permission or cannot fetch, degrade to this Skill's built-in `$DELIVERY_DEFECTS[]` (already pulled in Phase 1 via `get-delivery-defects`).

**What to check**: for the method under analysis, filter submitted defects related to that file / class / feature and check these three classes one by one:

1. **Same class of problem still exists**: the defect's problem pattern (NPE, bounds, state transition, concurrency, SQL, etc.) **recurs or appears elsewhere** in the current method or nearby same-repo code — "same mistake, different place".
2. **New problem introduced by the fix (regression)**: the change made to fix that defect **introduced a new defect or broke existing logic** (e.g. fixing A breaks path B; a new check changes normal-branch behavior).
3. **Not fully fixed**: only the surface was changed and **the root cause is not gone** (e.g. a null check added in one place, other call paths still uncovered; only the main flow handled, bounds/exception branches still missing).

**How to handle conclusions**:

| Check conclusion | Handling |
|---|---|
| Hits any of the three classes | Write back as a suspected defect of this detection (bugStatus=6); go through standard update-process → finalize-rank **to sync to the detection platform**; thinking must cite the submitted defect's title/ID + which class ("same-class recurrence / fix regression / not fully fixed") + concrete evidence (line numbers, uncovered paths) |
| None of the three hit | Produce no defect and **write no status back**; thinking states "compared submitted defect [title/ID]; no same-class recurrence, fix regression, or residual issue found" |

**thinking hard requirement**: the check conclusion must land on a concrete line number or call path, and must say which submitted defect was compared, which class it belongs to, and what the evidence is.

### L3 cross-service / system-level analysis

Cross-repo Call chain / service compatibility, completeness of requirement implementation, compatibility, completeness, etc.

### thinking hard requirements

- Must cite at least 1 concrete line number or variable name
- Do not use "no obvious issue found" as the only analysis content

### Mandatory document integration (when `$ISSUE_LIST[]` is non-empty)

1. Load DOC_SUMMARY.md first and locate the business-rule numbers for this method
2. thinking must cite at least 1 rule (e.g.: "per DOC_SUMMARY R3 'show when termInfoDTOList≥2'...")
3. processSteps must include refDocUrls or referencedSources(sourceType=prd_doc/tech_doc)
4. L2 business analysis cannot be skipped — even if L1 already found a defect, you must still assess impact from a business view
5. If not met → thinking marks `[DOC_NOT_USED]` and waits for self-review to backfill

### Mandatory test-case integration (when HAS_CASES=true)

1. If `$DETECTION_PLAN` has caseRelevance=direct/indirect for this method, thinking **must** cite the **concrete step numbers and expected results** of a concrete test case (not only the case ID)
2. processSteps must include referencedSources(sourceType=test_case, sourceId=<case ID>, sourceName=<title>)
3. Analysis view: take case steps as input and verify whether code behavior matches expectation
4. Code behavior ≠ case expectation → bugStatus=6, content includes `Test case ID:[ID](url)` + Expected vs actual
5. If not met → thinking marks `[CASE_NOT_USED]` and waits for self-review to backfill
6. **Parameter-constraint compare**: the case/doc does not limit a parameter's range, but the code hard-codes an extra constraint → treat as **over-constraint in code**, mark bugStatus=6 or suggested verification. **Do not** rationalize the difference with "data layer may only have this value" or "a code comment wrote this value"

**Do not rationalize deviations**: case/doc is the "spec"; code is the "implementation". When they disagree, the Agent's job is to report the difference faithfully and **must not** guess why the code is reasonable. Typical violations:
- ❌ The case writes condition A (no sub-condition); the code writes A && extra B; the Agent says "B is surely satisfied" → this invents an implicit condition the case never declared
- ❌ The case expects behavior A; the code does B; the Agent says "historical code also does B so it is fine" → Pre-existing is still a defect; write back with the [Pre-existing] tag
- ❌ After finding a disagreement, say "needs confirmation of business intent" then judge bugStatus=2 → when in doubt judge bugStatus=6 (suspected defect) so the developer can confirm

**No formalistic analysis**: the following thinking is a violation (Hard rule 21 will intercept):
- ❌ "Compared test cases; no issue found" (no concrete step cited)
- ❌ "Test cases cover this scene" (does not say which case, which step)
- ✅ "Test case [ID] step N expects 'XX'; code line M methodName() is called in the callback; behavior matches"

### Facade / proxy vs first-party handler (MUST)

> **Purpose**: stop the most common high-severity false positive on gateway / BFF / unified-API repos — treating a documented pass-through as "missing local enforcement".

A handler that **forwards** credentials, body, or work to another service is not the same kind of object as a handler that **owns** auth, billing, or validation. Filing the difference as a defect is only valid when the spec says *this* layer must do that work.

**Before writing bugStatus=6/7 for "this method does not do X":**

1. Read the requirement for **this route**, not a sibling route. If the doc says this layer only forwards / does not charge / does not authenticate, and names a downstream that does X, **do not** write `[Confidence:HIGH]` "missing X locally".
2. Confirm the downstream contract is actually absent (code or doc of the callee says it does not check). If you cannot confirm, write `[Needs confirmation]` at MED/LOW — or bugStatus=2 with the delegation cited.
3. A 401/403 that the **callee** is documented to return is the expected contract. Do not demand the same 401 from the facade just because a first-party handler (`HandleSpeech`, a Controller `@PreAuthorize`, …) returns 401 itself.

**When filing an improvement (bugStatus=7) about a missing limit, timeout, or check:**

- The analog must be a **same-kind** sibling: JSON API ↔ JSON API, raw proxy ↔ raw proxy, stream ↔ stream.
- A reverse-proxy `LimitReader` / header-copy helper is **not** evidence that a first-party JSON decoder is defective. The right analog is the first-party handler this facade wraps or mirrors.

**thinking when you considered and rejected this trap:**

```
[Facade/proxy] Doc says this route only forwards X to <downstream>. Local absence of X is by design. Same-kind analog: <sibling>, not <other-kind handler>.
```

Language notes (`go-gotchas.md` and others) restated this with stack-specific examples. The rule here is the authority.

---

## STEP C.5: Systematic self-review before writeback

### Fast path (bugStatus=2 no defect)

Confirm D1+D2 have no gaps, **and finish D10 spec-vs-implementation scan**, then append `[C5✓]` at the end of thinking and enter STEP D.

> ⚠️ **bugStatus=2 reverse self-review (D10)**: before judging no defect, you must run these checks (stops the Agent from rationalizing the code and under-reporting):
> 1. **Parameter-constraint compare**: every condition parameter described in the test case/doc must be aligned **item by item** with the actual checks in code. Did the code hard-code extra constraints the case did not limit? Did the code drop a condition the case requires?
> 2. **Hidden-assumption review**: does thinking contain speculative wording such as "should be", "must be", "data layer only has"? If yes, what is the basis? If there is no clear basis, mark as suggested verification.
> 3. **Code comments vs cases**: do parameter notes in comments match the test case/doc? On disagreement, the case/doc wins.
>
> If D10 finds a disagreement → upgrade to bugStatus=6 and enter the full path.

### Full path (bugStatus=6/7 has a defect)

You must execute every dimension below.

### Analysis-dimension self-check (confirm each)

| Dimension | Self-check question | Action if it fails |
|------|----------|-------------|
| D1. Functional completeness | Are all requirement/case scenes this method involves covered? | Backfill analysis of uncovered scenes |
| D2. Logic correctness | Were state transitions, rule judgments, and calculations verified one by one? | Backfill step-by-step derivation |
| D3. Design consistency | Do requirement text, interface contracts, data structures, and flow constraints match the implementation? | Mark the inconsistencies |
| D4. Case satisfiability (including parameter-constraint alignment) | Can the code support the test-case input/output expectations? **Compare per parameter**: does the code fully match every judgment condition in the case/doc (e.g. type, subtype, status) — no more, no less? Extra hard-coded constraints = over-constraint risk; missing constraints = under-constraint risk. | List each mismatched parameter and the delta; mark bugStatus=6 |
| D5. Data consistency | Is data aligned across get→parse→transform→process→return? | Trace field flow and locate the break |
| D6. Compatibility | Is the interface-contract change backward compatible? Is it safe for old and new versions to coexist during rollout? Is there risk when old and new logic run in parallel during canary? | Analyze release-stage and cross-service compatibility impact |
| D7. Chain completeness | Are all Call chains this method involves (including cross-repo upstream/downstream) included? Any key node missing? | Backfill analysis of uncovered chain nodes |
| D8. Case-doc consistency | Do test cases cover the document business rules this method relates to? Do case descriptions match the requirement / implementation? | Record as a risk hint (register-finding source=case-coverage-check); do not block writeback |
| D9. Devil's Advocate | **Try to defend the code**: is there a reasonable business/context explanation that makes this "defect" actually correct behavior? | See the detailed notes below |

### D9. Devil's Advocate — details (MUST when bugStatus=6/7)

> **Purpose**: lower the false-positive rate and stabilize judgment. Before confirming a defect, the Agent must actively challenge its own conclusion.

Steps:

1. **Assume the code is correct** and try to find at least one reasonable explanation:
   - Did an upstream caller already guarantee the precondition (e.g. non-null check done at the caller)?
   - Is there framework/middleware protection (e.g. Spring Validation, AOP intercept)?
   - Is there a config/switch that makes this path unreachable in production?
   - Do comments/docs say this is intentional (fail-fast, defensive programming)?
   - Do comments/docs say this layer only forwards / delegates X to a downstream service (facade / BFF / reverse proxy)?
   - Do historical commit messages / PRs explain why this writing is reasonable?

2. **Judgment**:
   - Found a reasonable explanation with sufficient evidence → **downgrade to bugStatus=2**; thinking records the defense
   - Found a partial explanation that is insufficient (e.g. "upstream may have validated but cannot confirm") → keep bugStatus=6/7, mark `[Confidence:MED]`
   - Completely indefensible → keep bugStatus=6/7, mark `[Confidence:HIGH]`

3. **thinking format**:
   ```
   [D9 Devil's Advocate] Tried to defend: <angle>. Conclusion: <defense failed/succeeded/partial>. [Confidence:HIGH/MED]
   ```

### Confidence-mark spec

| Mark | Meaning | When to use |
|------|------|----------|
| `[Confidence:HIGH]` | High-confidence defect | D9 completely indefensible; clear code evidence (e.g. an NPE path is reachable with no protection). **Forbidden** when the spec documents that X is delegated downstream and you have not shown the callee also skips X |
| `[Confidence:MED]` | Medium-confidence defect | D9 found a partial defense that is insufficient; depends on runtime conditions / config / assumed upstream behavior |
| `[Confidence:LOW]` | Low-confidence defect | Needs extra external business knowledge; reasonable doubt cannot be excluded; user confirmation needed |

- bugStatus=2 (no defect) does not need a confidence mark
- Write the confidence mark at the end of thinking, before `[C5✓]`
- `LOW` confidence essentially means "needs user confirmation" and must also fill the "pending user confirmation" section below

### Pending user confirmation: mandatory output when in doubt

**Core principle**: the job is to find more defects and miss none. When the conclusion is in doubt (you cannot fully decide from code and existing docs alone) and the user must supply business context or knowledge to fully confirm, **you must output it explicitly to the user. Do not assume arbitrarily.**

**Trigger conditions** (any one is enough):

- The defect depends on "what normal behavior of this API/scene is in business" — and code/docs/cases never state it
- The conclusion depends on "what the production config/switch actually is" — cannot confirm from code or config files
- Impact scope depends on "what the user's real usage path is" — cannot infer from code and docs
- A suspected defect cannot exclude "this is a known, historical design decision" — needs confirmation whether it is intentional
- Downstream Call-chain behavior is uncertain — needs confirmation of the expected upstream/downstream contract
- Any other judgment premise that "AI does not know but the business does"

**thinking format** (after the `[D9 Devil's Advocate]` paragraph, before the confidence mark):

```
[D9 Devil's Advocate] Tried to defend: <angle>. Conclusion: <defense failed/succeeded/partial>.
[Needs confirmation] <open-point description>. Current assumption: <temporary assumption before the user confirms>. Needs user confirmation: <what business information is required to fully decide>. [Confidence:LOW/MED]
[C5✓] Systematic self-review passed; enter writeback
```

**Required elements in thinking when in doubt**:

- What the concrete open question is (do not vaguely say "uncertain")
- What temporary assumption the current analysis is based on (must be written; cannot be empty)
- What business information the user must provide (must be specific enough to answer directly)
- How that confirmation would change the final conclusion (would it overturn the defect or keep it)

**content field output** (required when bugStatus=6/7 and in doubt):

The defect description in content should include confidence and pending-confirmation info. Example format:

```
## Defect description

[Confidence:LOW]
[Needs confirmation]
- Open question: <concrete open point>
- Current assumption: <temporary assumption>
- Please confirm: <business information the user must provide>

... other standard fields ...
```

**summary output**: every in-doubt defect is marked `❗(needs confirmation)` or `⚡(needs confirmation)` in the summary Risks section, and all open points are rolled up in the new 🔔[Pending confirmation] section, asking the user to help confirm.

**Forbidden**:

- ❌ "Uncertain; treat as a defect / treat as no defect for now" (not assuming is correct; not outputting to the user is wrong)
- ❌ "Looks like a problem, but the business may have a special reason" (guessing the business instead of asking the user)
- ❌ Only wrote "uncertain" in thinking, without "what needs confirmation" and "what the current assumption is"
- ❌ Found a problem but did not write it back because confidence is low (in doubt ≠ false positive; in-doubt defects still write back as bugStatus=6/7, but need the user to help confirm further)

### Process-taboo self-check (exclude each)

- ✗ Only looked at business logic and ignored the data-get / transform layer?
- ✗ Only looked at the diff and did not trace the concrete implementation of shared methods?
- ✗ Assumed "same interface = same behavior" without verifying the implementation?
- ✗ Only verified the main flow and ignored key branches / boundary conditions?
- ✗ Ignored base-component changes affected outside the diff?
- ✗ Only watched method calls and did not inspect callee implementation details?
- ✗ Assumed the data source is correct and did not verify data-get logic?
- ✗ Replaced spec requirements with best practices and ignored concrete constraints?
- ✗ Compared this handler to a **different-kind** sibling (pass-through proxy vs first-party owner) and filed the difference as a defect?
- ✗ Treated "this layer does not do X" as HIGH missing work when the doc says X is the downstream's job?

### Pass condition

D1–D9 all pass + none of the 8 taboos hit → append `[Confidence:HIGH/MED] [C5✓] Systematic self-review passed; enter writeback` at the end of thinking (bugStatus=2 needs no confidence mark; just `[C5✓]`)

Any failure → backfill analysis and re-enter STEP C.

> **D8 special note**: D8 failure does not block writeback (unlike D1–D7). You only need to ensure the risk was recorded via `register-finding`. Case-doc consistency is a test-design review topic and is output as a risk hint, not a detection conclusion.

---

## STEP D: Build writeback

1. Pick the matching template (A/B/C) from `references/writeback.md`
2. Fill in real values
3. Submit directly (prefer `batch-update-process`): format pre-fix + validation already run inside; do not call `pre_validate_and_fix` by hand
4. If it returns `validation_failed`, that is a quality issue pre-fix cannot repair (thinking too short / empty conclusion) → re-run a real analysis. **Do not tweak format as a trial-and-error retry**

---

## strategy=11 special requirements

- The Agent decides Call-chain depth by method difficulty: complex methods expand 2–3 hops (Controller → Service → Dao); simple methods may be simplified
- content writes the full path: `A#method(L12) → B#method(L45) → C#method(L88)`
- fileCodes includes every class on the chain
- STEP C L0 loads `by_strategy[11]` rules and watches code-logic + chain + business issues
- **Prefer chain groups**: if strategy=11 methods are already clustered into the same `chainGroupId`, read the whole chain once during the shared-read stage and reuse that understanding for every s11 method in the group. This avoids expanding the Call chain repeatedly and finds parameter-pass / exception-propagation / return-contract defects from a "full-chain view"

## Extra requirements for frontend / client projects

- JS/TS projects STEP C L0 additionally load frontend-specific rules
- When a frontend-specific rule hits, write back with the matching strategyCode
- Exclusion rules still apply
- See `references/rules/frontend-gotchas.md`

## Extra requirements when docs exist (`$ISSUE_LIST[]` non-empty)

- STEP C must include L2 business analysis: compare document rules with code
- thinking example: "the requirement doc requires 'field XX cannot be empty', but code line N does not validate"
- processSteps add refDocUrls
- When the doc has no directly related description: "reviewed the requirement doc; this method is not involved in the business rules described there"

## Extra requirements when test cases exist (HAS_CASES=true)

- When caseRelevance=direct/indirect, STEP C must analyze from the case view
- thinking cites a concrete case: "test case [ID] step N expects 'XX', but code line M returns YY"
- processSteps add referencedSources
- When there is no directly related scene: "compared test cases; this method is outside existing case coverage"

## Extra requirements when submitted defects exist (see L2.1)

- STEP C L2 analysis must run L2.1 related-issue check on submitted defects (query via plan provider first; degrade to `$DELIVERY_DEFECTS[]`)
- Only check three classes of **new problems**: ① same-class recurrence ② fix regression ③ not fully fixed; any hit → write back bugStatus=6, **sync to the detection platform**
- **Do not write back the fix/recheck status of already-submitted defects**; this step only produces new defects for this detection
- thinking cites the concrete defect and the class: "submitted defect [title/ID] is 'XX NPE'; current method line N has the same call without a null check (same-class recurrence)"
- When none of the three hit, thinking states "compared submitted defects; no same-class recurrence, fix regression, or residual issue found"

---

## minDetectLevel minimum-depth constraint

Each method's `minDetectLevel` in `$DETECTION_PLAN` defines the minimum analysis depth that method needs. Phase 1 computes it automatically from docRelevance / caseRelevance.

### Level definitions

| minDetectLevel | Meaning | Evidence thinking must include |
|---|---|---|
| L1 | Pure-code analysis | Line-number / variable-name citation (baseline) |
| L1+doc | Code + document analysis | Line numbers + document-rule citation (e.g. "DOC_SUMMARY R3") |
| L2 | Business-context deep analysis | Line numbers + Call-chain / dependency analysis evidence |
| L2+TC | Business + test-case analysis | Line numbers + Test case ID citation + Call-chain evidence |

### minDetectLevel for cross-repo dependency classes

When a cross-repo dependency class takes strategy D (source unreachable), you still analyze from the caller side. The minDetectLevel constraint **degrades but is not exempt**:

| Original minDetectLevel | After cross-repo degrade | thinking evidence |
|---|---|---|
| L2+TC | L1 (caller-side analysis) | Line numbers + "cross-repo source unreachable; based on caller-side analysis" + call-arg / return-value / exception-handling analysis |
| L2 | L1 (caller-side analysis) | Same as above |
| L1+doc | L1 (caller-side analysis) | Same as above |
| L1 | L1 (caller-side analysis) | Line-number / variable-name citation |

> Hard rule 21 automatically degrades strategy-D cross-repo methods to L1 validation (triggered when thinking contains the keyword "cross-repo source unreachable").

### Hard rule 21 intercept logic

`scripts/validate.ts` Hard rule 21 checks thinking content on writeback:

- **L2+TC**: thinking must contain both the `test case` keyword and one of `call` / `dependency` / `upstream` / `downstream`
- **L2**: thinking must contain one of `call` / `dependency` / `upstream` / `downstream` / `chain`
- **L1+doc**: thinking must contain one of `document` / `requirement` / `DOC_SUMMARY` / `rule`

If not met → writeback is rejected with an error asking for more analysis.

---

## Phase 3 quality gate (check-analysis-quality)

After all methods are analyzed and before writeback, run the quality-gate command for an overall check:

```bash
node "$SKILL_SCRIPT" check-analysis-quality --task-id $TASK_ID
```

### Checks

1. **contextReads depth (Hard rule 22)**: strategy=11 T1 ≥ 2, T2 ≥ 1, T3 / trivial-filter exempt
2. **minDetectLevel conformance preview**: roll up each method's minDetectLevel and hint which methods need deeper analysis (not a hard intercept; warning only)

### Return value

- Pass: `{"passed": true, "warnings": [...]}`
- Fail: `{"passed": false, "failures": [...], "warnings": [...]}`

On failure you must backfill STEP B context reads per `failures` and resubmit.
