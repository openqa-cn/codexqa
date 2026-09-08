# R3: Case design review (Registry Review)

> **Role**: Review the case-design quality of `case-registry.json`, ensuring coverage is complete (no gaps), aggregation is correct (scene cases first, exceptions merged, no redundancy), and registry field format is compliant (caseName/filePath/caseType/category/coverage structure), so the Phase 3 Step Two subagent can format output directly from the registry.
> **Trigger timing**: After generate-skill **Phase 3 Step One** (case design + registry initialization) is complete, and before **Phase 3 Step Two** (case file generation) starts.
> **Token strategy**: Run by the review subagent (the main agent does not participate after dispatch). Read analysis.md §1.x + design.md §1 (skip interface-detail blocks) + case-registry.json caseName/filePath/caseType/category/source_design_ref/coverage fields. Do not read case `.md` files (they have not been generated yet).

---

## Input

| Input | Description |
|------|------|
| `usecases/testdocs/analysis.md` | Read only §1.x; do not read `api-details.md` |
| `usecases/testdocs/design.md` | Read only §1 |
| `usecases/testdocs/case-registry.json` | Read only caseName/filePath/caseType/category/source_design_ref/coverage fields |

---

## Execution flow

```
Step R3-1  Build the checkpoint list (extract from analysis.md)
  ↓
Step R3-2  Build the coverage matrix (checkpoint → case mapping)
  ↓
Step R3-3  Gap detection
  ↓
Step R3-4  Coverage-path and case-split review
↓
Step R3-5  Redundancy detection
↓
Step R3-6  Granularity detection
↓
Step R3-7  Registry field compliance check
↓
Step R3-8  coverage quality check
↓
Step R3-9  Aggregation + disposition
```

> R3-3 ~ R3-8 are logically independent, share the R3-2 coverage matrix, and are run in order by the review subagent (all in-memory; no further child subagent dispatch).

---

## Step R3-1: Build the checkpoint list

The review subagent extracts every checkpoint that should be covered by tests from analysis.md and builds the list `checkpoints[]`:

| Source section | Extracted content | Checkpoint type |
|---------|---------|-----------|
| §1.2 change points | Each change point (C-x), representing one change dimension that must be covered | `CHANGE` |
| §1.2 acceptance rules | Conditional branches split from each acceptance rule (each side of if/else) and state-transition paths | `RULE` |
| analysis.md §1.5 Risk points | Each risk point | `RISK` |
| §1 Test design | Each verification point listed by a module (by classification: normal / exception / boundary scenario) | `COVERAGE_DIRECTION` |

**Extraction constraints**:
- A point not listed in §1 does not generate a checkpoint (the new structure only produces hit points; there is no exclusion mark)
- Content explicitly excluded in §1.1 "what not to do" does not generate a checkpoint
- Each if/else branch generates an independent checkpoint (do not merge)
- One change point (C-x) may correspond to multiple acceptance rules; in that case the rule-granularity `RULE` checkpoint is authoritative, and the `CHANGE` checkpoint is a fallback — so even if a change point's acceptance-rule split is incomplete, gap detection can still catch it via the `CHANGE` checkpoint
- **Expansion dimensions must be split into independent checkpoints**: when an acceptance rule involves a dimension that must be force-expanded, besides the `RULE` checkpoint for the rule itself, generate one `RULE` checkpoint for each sub-item that should be expanded, as the comparison baseline for R3-3 expansion-gap detection — (1) each key-field value quadrant and multi-field combination quadrant of a Map / complex-object request param that participates in a pay-loss decision (corresponds to case-authoring-rules.md §2.3.1); (2) a negative for every other known enum value of that dimension in an effective-scope statement ("effective only for X line of business / scenario / coupon type") (corresponds to §1.5.2.1); (3) each secondary / last-level sort dimension in a multi-level sort rule (corresponds to §1.5.2.2); (4) each side of a binary-result branch as its own point (corresponds to §1.5.1)

**Checkpoint format**:

```json
{ "id": "CP-001", "type": "RULE", "source": "§1.2", "desc": "return exclusive price when userLevel >= 3", "priority": "P0" }
```

---

## Step R3-2: Build the coverage matrix

The review subagent reads case-registry.json, extracts each case's caseName + coverage, and builds the mapping:

```
CP-001 → [caseId-A]        # covered
CP-002 → [caseId-B, caseId-C]  # covered by multiple cases (possible redundancy)
CP-003 → []                # zero coverage (gap)
```

**Matching rule**: if a coverage entry's `trigger` or `expected` contains a keyword from the checkpoint desc (methodName / business-rule keyword / status value), it counts as coverage. Matching is semantic and does not require an exact string match, but there must be a clear keyword hit.

---

## Step R3-3: Gap detection

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Zero-coverage checkpoint | Coverage-matrix mapping is an empty array | `COVERAGE_GAP` | P0 (P0 checkpoint) / P1 (P1 checkpoint) |
| Change point has zero coverage | A §1.2 change point (CHANGE-type checkpoint) maps to empty in the coverage matrix, and every RULE-type checkpoint split from that change point's acceptance rules is also zero-coverage | `CHANGE_NOT_COVERED` | P0 |
| Normal path missing | A test point listed in §1 whose classification is "normal scenario" has no matching case in the registry | `NORMAL_PATH_MISSING` | P0 |
| Exception path missing | A test point listed in §1 whose classification is "exception scenario" has no matching case in the registry | `EXCEPTION_PATH_MISSING` | P1 |
| Key boundary missing | A §1.2 acceptance rule has a numeric boundary (e.g. ">= 3", "<= 100") and the registry has no boundary-value case | `BOUNDARY_MISSING` | P1 |
| State-transition path missing | Each legal transition path in a state machine described by a §1.2 acceptance rule has no matching case in the registry | `STATE_TRANSITION_MISSING` | P1 |
| Case exceeds planned test points | The registry has a case covering a point not listed in §1 (e.g. no "concurrency conflict" point but there is a concurrency case) | `DIRECTION_NOT_PLANNED` | P1 |
| Map / complex-object pay-loss field quadrants not expanded | A §1 test point or §1.2 acceptance rule involves a Map / complex-object request field (e.g. `giftCouponMap`, `subsidyItemMap`) that participates in a pay-loss decision such as "refund / allow / issue / deduct", but the registry only has coarse binary cases of "whole Map empty / non-empty" and lacks value-quadrant or multi-field combination-quadrant cases for the key decision fields (violates case-authoring-rules.md §2.3.1 Map quadrant-combination force expansion) | `PAYLOSS_QUADRANT_MISSING` | P0 |
| Other-enum negatives of a business effective scope are missing | §1.2 has an effective-scope statement such as "effective only for X line of business / X scenario / X coupon type", the registry has a positive for the target dimension value, but the other known enum values of that dimension (`skuBizType` / `orderBizType` / `sceneCode` / `bizType`, etc.) lack matching "new logic not effective, legacy unchanged" negatives (violates case-authoring-rules.md §1.5.2.1) | `ENUM_NEGATIVE_MISSING` | P1 |
| Multi-level sort secondary dimensions not expanded | A §1.2 acceptance rule contains "sort / pick-best / hit priority" and the sort dimension has ≥ 2 levels (e.g. "amount desc > threshold asc > end time asc"), the registry only covers the first-level dimension and lacks a case of "all higher-level dimensions equal, winner decided only by a secondary dimension" (violates case-authoring-rules.md §1.5.2.2) | `SORT_LEVEL_MISSING` | P1 |
| Cross-stage consistency counterexample missing | When a §1 test point contains "consistency check (positive/negative)", the registry lacks either the pass-when-consistent side or the fail-or-degrade-when-inconsistent side; if analysis.md §1.4 marks it as switch-affected but there is no post-switch-on validation-strategy case, report the same finding | `CONSISTENCY_COUNTEREXAMPLE_MISSING` | P0 |
| Multi-effective-point switch combinations missing | When a §1 test point contains "multi-effective-point switch consistency", the registry lacks a concrete-behavior case for any registered combination of all-effective, all-degraded, or inconsistent states | `MULTI_SWITCH_COMBINATION_MISSING` | P1 |

---

## Step R3-4: Coverage-path and case-split review

> A **coverage path** is the combination of entry, interface/operation sequence, prerequisite data, and assertions that a registry case chooses to carry its coverage. The review goal is not merely to reduce steps or case count; it is to keep the fewest paths required to cover the verification units **without lowering failure diagnosability**. Path entry, steps, and data dependencies are derived from case-registry.json caseName, coverage, filePath and design.md §1 Covered interfaces / §2 entity inventory; no new registry field is added.
>
> An interface or operation may enter a path only if it meets any of: constructing state or data needed by a later step, directly triggering the logic under test, providing a necessary assertion basis, or being a required hop to the business end state. A step that is only "passed through" on the chain and does not carry any of the above roles must not be kept.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|----------|
| Path contains an unnecessary step | The case's covered-interface sequence contains an interface/operation whose output is not consumed by a later step, that is not a direct trigger or assertion object of coverage, and whose removal does not affect reaching the business end state; the step is only a chain pass-through or a repeated query | `PATH_STEP_NOT_NECESSARY` | P1 |
| Mergeable paths were split without need | Two or more cases have compatible prerequisite data, a reusable interface entry or continuous path, and verification-unit assertions that can be listed separately without polluting each other, but were split into independent paths; merge them into one case or reuse the same scene path | `PATH_MERGE_CANDIDATE` | P1 |
| Conflicting targets were wrongly merged | A single case carries verification units whose prerequisite states are mutually exclusive, whose trigger methods are incompatible, whose exception injection would break the main flow, or whose failure ownership cannot be located by independent assertions after the merge; split them into independent paths | `PATH_SPLIT_REQUIRED` | P1 |
| Path coverage is not diagnosable | Case coverage contains multiple verification units, but failure cannot be located to a concrete business rule via an independent trigger, step, or expected result; e.g. multiple rules share one sentence "result as expected" or one vague assertion | `PATH_NOT_DIAGNOSABLE` | P1 |
| Prerequisite data is repeatedly constructed and not reused | Multiple cases repeatedly construct equivalent prerequisite data for the same business entity or state, design.md §2 already has a reusable entity, and rebuild is not required by isolation, state mutex, or exception injection; reuse the same data prep or scene path | `SETUP_DATA_NOT_REUSED` | P2 |

> **Merge / split boundary**: merging requires compatible prerequisite states, a continuous call path, non-polluting assertions, and diagnosable failures; if any one is not met, do not merge merely to compress count. When path step counts are equal, prefer the one that reuses more prerequisite data; when path compression conflicts with diagnosability, diagnosability wins.

---

## Step R3-5: Redundancy detection

> 🧭 **Detection scope**: Phase 3 case design is produced by "module subagent in-module expand+aggregate (row by row, distinguishing new_feature / regression by `classification`, including inter-row dedup) + main-agent global second-pass dedup". The module subagent finishes dedup between regression cases and new_feature cases inside the module; residual cross-module duplicates are removed by the main agent's global dedup. R3-5 is the review fallback and focuses on **whether dedup was complete** — i.e. residual cross-module duplicates, positive functional-module cases that a link already covered but were not deleted, and residual duplicate positive cases between regression and new_feature cases inside the same module that should have been deleted. When detecting, compare similarity across all coverage in the full table.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| coverage highly overlaps | Two cases have substantially the same verification object, triggered decision branch, and expected result; coverage-text-set similarity > 80% is only an auxiliary clue and must not be used to evade a duplicate judgment via different wording | `COVERAGE_DUPLICATE` | P1 |
| Residual cross-module duplicate | Two cases belong to **different modules** (different filePath module directories) but cover the same verification target of the same interface (`trigger` + `expected` substantially the same) — the main agent's global dedup should have kept one; finding it here means global dedup missed it | `CROSS_MODULE_DUPLICATE` | P1 |
| Same switch / same dimension dual-state restated across modules | Multiple cases cover **the same dual state of the same switch / same shared decision / same config dimension** (on/off, hit/miss) and differ **only by interface** (so they do not fall under the CROSS_MODULE_DUPLICATE "same interface" bar) — the main agent's global dedup should merge them into one primary verification + involved-interface list (violates case-authoring-rules.md §0 step 3 "cross-module same-switch / same-dimension dual-state merge"; root cause is that §1.5.3 expected-isomorph convergence was not applied during expansion). The criterion is whether the underlying decision logic is the same and the verification target is the same; do not report this finding when verification targets differ | `SWITCH_DUAL_STATE_DUP` | P1 |
| Overlapping verification points between a link and a single interface were not removed | A functional module's positive single-interface case and a `[Link-XXX]` scene case share the same verification target, but the single-interface case still keeps a coverage verification point already covered by the link; delete the overlapping verification point from the single-interface case, and delete the whole single-interface case only when its coverage becomes empty | `LINK_OVERLAP_NOT_REMOVED` | P1 |
| In-module regression vs new_feature duplicate positive verification point | Inside the **same module** (same filePath module directory), a `category: "regression"` case and a `category: "new_feature"` case cover the same positive verification target of the same interface — the module subagent should have kept the new-feature case and deleted the duplicate regression case during in-module dedup; finding it here means in-module dedup missed it | `REGRESSION_DUP_NEW_FEATURE` | P1 |
| Same-interface param-validation cases >= 2 | Param-validation verification points of the same interface are spread across >= 2 cases (they should be merged into one per aggregation rule 3) | `PARAM_MERGE_SUGGEST` | P1 |
| Same-interface exception cases share the same prerequisite dependency but were not merged | Non-param exception verification points of the same interface (downstream exception, degradation, concurrency, etc.) share the same prerequisite dependency (e.g. all need to Mock the same downstream) but are spread across multiple cases | `EXCEPTION_MERGE_SUGGEST` | P2 |
| Multiple cases verify the exact same business rule | Multiple cases' coverage all point to the same §1.2 acceptance rule with the same trigger | `RULE_DUPLICATE` | P1 |
| Technical-attribute cases exceed the change-relevance threshold | The registry has concurrency / idempotency / MQ duplicate-consume / out-of-order / amount-precision cases, but §1.2 acceptance rules do not involve the matching write / concurrency / message consume / precision calculation, and §1.3 impact-surface inference also did not identify this change reaching that path — this is generalized extra testing of an unchanged legacy technical attribute (violates case-authoring-rules.md §2.3 technical-attribute change-relevance threshold) | `TECH_ATTR_NOT_RELEVANT` | P2 |
| Param, downstream, or internal-exception cases have no basis | The registry has param-validation, downstream-exception, or internal-exception cases, but the matching test point / source C-x did not add or modify request params, a downstream call, or this-layer internal handling, and §1.2 did not explicitly state the matching exception handling; do not default to extra testing merely because the interface can take params, has a downstream, or depends on infrastructure such as DB/locks | `EXCEPTION_NOT_RELEVANT` | P2 |
| Same-expected data variants were not parameterized | Inside the **same module** (same filePath module directory), multiple cases were split only because input values of the same logic unit differ, while the triggered decision branch, expected behavior, and assertions are the same; merge them into one case and list the values in the data table; keep the split only when a value changes the expected result or decision branch. Cross-module data variants are judged only by the global dedup rule for whether they constitute a duplicate, and this finding does not apply | `DATA_VARIANT_NOT_PARAMETERIZED` | P2 |

> ⚠️ **Distinguish "residual duplicate" from "legal split"**: `CROSS_MODULE_DUPLICATE` only targets semantically equivalent cases of **the same interface and the same verification target**. Cases that belong to different business modules and have different verification targets (e.g. "coupon-config status validation" vs "coupon-redeem status validation", even if both call a status interface) **are not duplicates** and must not report this finding — this is exactly the legitimate split the redesign aims to protect and must not over-aggregate.

---

## Step R3-6: Granularity detection

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Fragmented case | A single case's coverage has only 1 entry, and that entry can be merged into another case of the same interface | `FRAGMENT_CASE` | P2 |
| Link scenario not aggregated | The §1.4 interface call chain has a ≥ 2-step serial chain, and verification points in coverage that involve consecutive steps of that chain are spread across multiple independent cases instead of being merged into one scene case (violates aggregation rule 1) | `SCENE_NOT_MERGED` | P1 |
| Case granularity too coarse | A single case's coverage entry count > 10 and involves multiple unrelated interfaces | `CASE_TOO_COARSE` | P2 |
| Unit-test-style case | The case caseName or coverage description points to "a single internal method" or "function-call verification" rather than a business behavior (violates case-authoring-rules.md §1.1 no unit tests) | `UNITTEST_STYLE` | P1 |

---

## Step R3-7: Registry field compliance check

> Step 1 already has a self-check checklist after write (entry count, caseName format, module consistency). R3-7 does a finer-grained structural check on top of that so the step 2 subagent can consume the registry directly.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| caseName format non-compliant | caseName does not match `[domain-flow/page] scenario-goal` (missing `[]`, missing domain, or missing goal), or contains a non-business-semantic string such as a UUID or TC number | `CASENAME_FORMAT_INVALID` | P0 |
| filePath module directory does not match caseName domain | The `{module}/` directory name in filePath is not the same business module as the domain description in caseName `[domain-...]` (e.g. the directory is "min delivery price" but the caseName prefix is "coupon calculation scope") | `MODULE_MISMATCH` | P0 |
| caseType value illegal | caseType is not `UI` or `SERVER` | `CASETYPE_INVALID` | P0 |
| caseType does not match page registration | caseType is `SERVER`, but the `analysis.md §1.3` client-page table has a matching page for that module, and the case is a normal main flow (not an exception / concurrency / MQ scenario) — per case-authoring-rules.md §1.3 it should be `UI` | `CASETYPE_SHOULD_BE_UI` | P1 |
| category value illegal or design-source ref missing | category is not `new_feature` or `regression` (including missing/empty), or the required `source_design_ref` is missing / that object is missing any of module, category, verificationPoint, verificationSummary, coveredInterfaces | `CATEGORY_INVALID` | P0 |
| category does not pair with the `[Regression]` prefix | category is `regression` but caseName does not start with `[Regression]`, or caseName starts with `[Regression]` but category is `new_feature` — the two must be bidirectionally consistent (see case-authoring-rules.md §1.3.2 case classification tags) | `CATEGORY_PREFIX_MISMATCH` | P0 |
| Regression case has no precise regression-scenario source | The registry has a `category: regression` case, but its `source_design_ref` does not point to a `classification=regression scenario` row in the design.md of the module that owns the filePath, or that row's "Verification summary" and "Covered interfaces" cannot match its coverage; do not treat a similar methodName, the same module, or the existence of another regression row as a match. A regression scenario may sit in an existing §1 module original table, or in a newly created §3 module when §1 has no matching module; whether §3 exists is not the criterion | `CATEGORY_NO_SOURCE` | P0 |
| A non-regression source was labeled regression | A `category: regression` case may only correspond to a source row whose classification is `regression scenario`; if its coverage can only match a normal scenario / boundary scenario / exception scenario / link scenario row, or has no precise regression source, it must not be kept as regression because of a similar methodName, module name, caseName, or coverage wording | `CATEGORY_SOURCE_MISMATCH` | P0 |
| coverage is an empty array | A case's coverage field is `[]` or missing | `COVERAGE_EMPTY` | P0 |

---

## Step R3-8: coverage quality check

> The step 2 subagent formats the case directly from coverage and does not re-expand. Coverage-entry quality directly determines case-file quality.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Trigger is missing a methodName label | A coverage entry's trigger involves a server API call but does not label the methodName (the step 2 subagent cannot write `trigger call `{methodName}``) | `COVERAGE_NO_INTERFACE` | P1 |
| Expected result is missing an assertion dimension | A coverage entry involves a write, but expected only has an API-response check and is missing DB/Cache/MQ expected checks (or is missing a `TBD` degradation label); or the assertion dimensions of the same logic's positive/negative (not limited to gray release/degradation; including every binary result such as **threshold comparison, consistency check, sort/pick-best, state judgment** — allow vs block / success vs failure / met vs unmet / adopt vs degrade) are asymmetric — the positive has a page/state linkage check while the negative omits it, or the negative expected only says a vague "take degradation / old logic" without being concrete; when the same response can observe both the target object and an evidenced control object, and the new logic applies only to some objects, asserting only the target and not that the control object keeps its result is also this finding (violates case-authoring-rules.md §1.5.1 positive/negative pairing) | `COVERAGE_ASSERTION_INCOMPLETE` | P1 |
| One side of a positive/negative pair is missing | A §1.2 acceptance rule has a binary-result branch (allow vs block / success vs failure / reached threshold vs not / field consistent vs inconsistent / hit best vs degrade to next-best, etc.), and the registry covers only one side — an exception scenario only writes "fail and block" and misses the matching "legal input succeeds and allows" positive, or a normal scenario only writes "success" and misses the matching failure negative (violates case-authoring-rules.md §1.5.1 positive/negative pairing trigger) | `PAIR_ONE_SIDE_MISSING` | P1 |
| Expected result contains vague wording | A coverage entry's expected contains non-executable vague wording such as "related records updated in DB", "cache updated", "message sent" (violates the step 1 degradation rule: when engineering info is missing, write `{XX} check: TBD (engineering info missing)`); or `analysis.md` already specifies copy / error code / status value, but expected substitutes vague words such as "success" / "failure" / "as expected" instead of quoting the original | `COVERAGE_ASSERTION_VAGUE` | P1 |

---

## Step R3-9: Aggregation + disposition

### Finding confidence self-check

After producing each finding, run a rebuttal check:

| Check item | Fail disposition |
|--------|-----------|
| Does the finding have a concrete checkpoint ID or coverage entry as evidence? | No evidence → delete the finding |
| Is a P0 finding truly zero coverage (coverage-matrix mapping empty)? | Not zero coverage → downgrade to P1 |
| Is a redundancy finding truly substantially the same (not the normal/exception two sides of the same function)? | Not substantially the same → delete |
| Does a caseName/caseType finding truly violate the format rule (not a misjudgment)? | Uncertain → downgrade to P2 |
| Has a category finding checked "classification, Verification summary, Covered interfaces" against the source row of the module that owns the filePath? | Precise source check not finished → must not emit a finding or modify category |

### Disposition rules

**Has P0 finding (`COVERAGE_GAP` (P0 checkpoint) / `CHANGE_NOT_COVERED` / `NORMAL_PATH_MISSING` / `PAYLOSS_QUADRANT_MISSING` / `CASENAME_FORMAT_INVALID` / `MODULE_MISMATCH` / `CASETYPE_INVALID` / `CATEGORY_INVALID` / `CATEGORY_PREFIX_MISMATCH` / `CATEGORY_NO_SOURCE` / `CATEGORY_SOURCE_MISMATCH` / `COVERAGE_EMPTY`)**:

Gap-class P0 (`COVERAGE_GAP`/`CHANGE_NOT_COVERED`/`NORMAL_PATH_MISSING`/`PAYLOSS_QUADRANT_MISSING`):
- The review subagent adds case-registry.json registry entries in place. Required fields for a new entry:
  - `caseId`: generate with `node -e 'console.log(crypto.randomUUID())'` (node is a hard dependency of this skill; `uuidgen` is not)
  - `caseName`: name as `[module-scene] description-goal`
  - `caseType`: judge `UI` or `SERVER` from the feature
  - `category`: decided by the source point-row classification; do not guess
  - `source_design_ref`: write the design-source-ref module, category, verificationPoint, verificationSummary, coveredInterfaces; it must precisely locate the matching design.md design point
  - `coverage`: fill the gap checkpoint's trigger + expected
  - `status`: `"pending"`
  - `created_at`: get the real time with `date "+%Y-%m-%d %H:%M:%S"`
- After the add, continue to step 2 (the new entry's status initial value is "pending", same as other entries; no extra action)

Field-class P0 (`CASENAME_FORMAT_INVALID`/`MODULE_MISMATCH`/`CASETYPE_INVALID`/`CATEGORY_INVALID`/`CATEGORY_PREFIX_MISMATCH`/`CATEGORY_NO_SOURCE`/`CATEGORY_SOURCE_MISMATCH`/`COVERAGE_EMPTY`):
- The review subagent corrects the corresponding entry's field values in place (fix caseName format, unify filePath and caseName module, fix caseType, complete source_design_ref, fill coverage). For a category-related finding, first make a precise judgment from the design.md source row of the module that owns the filePath: if it matches a `classification=regression scenario` row and only the `[Regression]` prefix is missing, keep `category: regression` and add the prefix; if there is no precise regression source, or the source is a non-regression row, correct to `category: new_feature` and remove the `[Regression]` prefix. ⛔ Do not add a `[Regression]` prefix to a non-regression case merely to clear a prefix inconsistency; after any classification correction, write the complete `source_design_ref` of the actual source row, then continue

**Has P1 finding (`COVERAGE_GAP` (P1 checkpoint) / redundancy / granularity / caseType / coverage quality, etc.)**:
- List the P1 findings in the conversation and ask whether to handle them
- User confirms filling a P1 gap → add a registry entry the same way as P0
- User confirms merging redundancy → merge registry entries (delete the redundant entry, update the kept entry's coverage)
- User confirms fixing caseType → fix in place
- User skips → continue to step 2

**Only P2 findings or no findings**:
- Output the review summary and continue to step 2

**Output format**:

```
R3 case design review complete
Checkpoint total: {N}  |  Covered: {M}  |  P0 gaps: {x}  P1 issues: {y}  P2 suggestions: {z}
New pending entries: {a}  |  Fields corrected: {b}  |  Total entries after fix: {T}

{if there are P0 gaps:}
| Checkpoint | Source | Gap type |
|--------|------|---------|
| CP-003: return default price when userLevel=0 | §1.2 | COVERAGE_GAP |
→ automatically added registry entry: [xxx-exception] user-level-0-returns-default-price

{if there are field-compliance P0:}
| Entry | Issue | Fix action |
|------|------|---------|
| caseId-xxx | CASENAME_FORMAT_INVALID: missing [domain] prefix | already corrected to "[Coupon-Issue API]..." |

{if residual P1 remains (not auto-fixed):}
| Finding type | Entry/checkpoint | Notes |
|-------------|------------|------|
| EXCEPTION_PATH_MISSING | §1 "param validation-negative value" | suggest adding but do not block |
```

---

## Forbidden actions

- Reading case `.md` files (they have not been generated yet)
- Reading `api-details.md` interface details (token waste; R3 does not need them)
- Blocking the flow on a P2 finding
- Judging coverage by "probably related" (there must be a keyword hit)
- Emitting a gap finding for content excluded in §1.1 "what not to do"
- Requiring that an exception scenario must generate a scene case (an exception scenario may exist as a single-interface case; the scene-case-first principle is in case-authoring-rules.md §1.9)
