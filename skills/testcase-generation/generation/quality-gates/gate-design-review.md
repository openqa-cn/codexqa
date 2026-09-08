# R2: Test design review (Design Review)

> **Role**: Review the reasonableness of `design.md` test-design points, entity completeness, and regression-point quality, so Phase 3 case design has sufficient reliable input — **Phase 3 Step One** depends directly on design.md §1 (test-design points) to expand verification points, §2 (entity inventory) to determine placeholders, and §3 (regression points) to generate regression cases.
> **Trigger timing**: After generate-skill **Phase 2 Step 1** (subagent B generates design.md) + **Step 2** (interface query) + **Step 3** (regression recall, if any) are all complete, and before human confirmation.
> **Token strategy**: Run by the review subagent (the main agent does not participate after dispatch). design.md is usually ≤ 150 lines and can be read in full; grep analysis.md on demand (mainly §1.2/§1.3/§1.4/§1.5 and their links to test points); grep api-details.md by methodName to locate.

---

## Input

| Input | Description |
|------|------|
| `usecases/testdocs/design.md` | The test-design plan under review (read in full) |
| `usecases/testdocs/analysis.md` | Requirement-analysis report (grep on demand; verify the basis of test points) |
| `usecases/testdocs/api-details.md` | Interface request/response details (grep by methodName to locate; verify FQCN) |
| Source material files under `prd/` | Used for comparison (read-only, grep on demand) |

---

## Execution flow

```
Step R2-1  Design-plan structure check (deterministic)
  ↓ pass
Step R2-2  Test-design-point reasonableness review (design.md §1; the following rules must all run in order)
  ├─ Rule R2-1  Test-point reasonableness
  ├─ Rule R2-2  Verification-point interface-anchor completeness
  ├─ Rule R2-3  Design-rule hit completeness
  ├─ Rule R2-4  Technical-attribute point relevance
  ├─ Rule R2-5  Verification-unit completeness and merge
  ├─ Rule R2-6  Test points vs risk matching
  ├─ Rule R2-7  Client test-point completeness
  └─ Rule R2-8  Link-scenario identification completeness
  ↓
Step R2-3  Entity-inventory completeness review (Rule R2-9)
  ↓
Step R2-4  Regression-point reasonableness review (Rule R2-10; when regression artifacts exist)
  ↓
Step R2-5  Interface-info completeness validation (Rule R2-11)
  ↓
Step R2-6  Aggregation + disposition
```

---

## Step R2-1: Design-plan structure check

Run by the review subagent. Deterministic check, must not be skipped:

| Check item | How to judge | Fail disposition |
|--------|---------|-----------|
| Both §1 and §2 chapters exist | grep that `## 1` and `## 2` headings exist | Missing → block |
| §1 Test design produced modules | grep `Verification point` inside the §1 chapter, and the table has at least 1 data row | No verification point produced → block |
| §2 Test-data inventory is non-empty | grep `Test data` inside the §2 chapter, and the table has at least 1 entity row | No entity row → block (phase 3 subagent cannot determine placeholders) |
| §3 content type is legal | If §3 exists, it may only contain a new regression module created when §1 has no same-name module, a "no-regression-plan interfaces" audit list, or a "TBD-attribution regression rows" list; do not replace these with a master table, an interface-cluster block, or a duplicated module | Illegal content type → block; tidy up and re-review |
| `api-details.md` has been generated and is non-empty | Check file existence (`test -s api-details.md`) | Missing or empty → block (interface request/response not queried) |

**Exit condition**: All pass, enter R2-2.

---

## Step R2-2: Test-design-point reasonableness review

**Review target**: `design.md §1 Test design`

### Rule R2-1: Test-point reasonableness

| Check item | Judgment | Finding type |
|--------|---------|-------------|
| A module with a change-point association produced points | Whether every change point (C-x) in §1.2 has a matching module in §1 and the table lists at least one point | `CHANGE_NO_DIRECTION` |
| Every point has a design basis | Whether the "Design basis" column of every §1 table row marks the associated §1.2 change point C-x or acceptance rule, and the referenced change point actually exists in §1.2 (when an interface is involved, further semantic matching in §1.3/§1.4 is allowed) | `DIRECTION_NO_BASIS` |
| Points match the change's operation nature | Whether the points listed in §1 match the design-rule table in test-design-guide.md (e.g. a claimed "data integrity" point — does the matching change point actually involve a write) | `DIRECTION_RULE_MISMATCH` |

### Rule R2-2: Verification-point interface-anchor completeness

> Corresponds to the test-design-guide.md §1 "Covered interfaces" column. That column is the hard anchor from "verification point → interface"; phase 3 case expansion locates the interface and its request/response from it. A miss or mismatch causes a case to hang on the wrong interface or fail to locate request/response. These rules are all non-blocking hints (do not modify design.md; only emit findings for human confirmation).

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Every verification point has Covered interfaces marked | The "Covered interfaces" column of every §1 table row is non-empty: a server verification point filled a methodName (a link scenario fills an interface sequence), a pure-client verification point filled `page: {pageName}`, and a truly unhosted one filled `none` | `COVERAGE_INTERFACE_MISSING` | P1 |
| Covered interfaces are traceable to §1.3 | Each methodName in the "Covered interfaces" column (split a sequence and check one by one) can find a matching interface in the §1.3 Server APIs table, and that interface's "related change points" include the C-x from this verification point's source column | `COVERAGE_INTERFACE_UNTRACEABLE` | P1 |
| Covered interfaces have details in api-details.md | Each methodName in the "Covered interfaces" column can find a matching `<details>` block in `api-details.md` (rows marked `page:` or `none` skip this check) | `COVERAGE_INTERFACE_NO_DETAIL` | P1 |

### Rule R2-3: Design-rule hit completeness

> Verify whether §1 omitted a point that the design rules should have hit.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|----------|
| State-machine rules require a state-related point | §1.4 has a state machine → whether §1 has a "state exception" or "state boundary" point | `STATE_DIRECTION_MISSING` | P1 |
| Concurrency / idempotency rules require a concurrency point | §1.4 has a concurrency / idempotency rule → whether §1 has an "idempotency / duplicate submit" or "concurrency conflict" point | `CONCURRENCY_DIRECTION_MISSING` | P1 |
| New / modified downstream calls require a downstream-exception point | A downstream RPC call whose §1.4 change type is "add" or "modify", or §1.2 explicitly states that downstream's exception handling (HTTP is triggered only by the latter) → whether §1 has a "downstream exception" point | `DOWNSTREAM_DIRECTION_MISSING` | P1 |
| An effective-scope statement requires an effective-scope negative point | §1.2 has "effective only for X line of business / type / scenario" and already recorded the target value and other enum values → whether §1 has an "effective-scope negative" point | `SCOPE_NEGATIVE_DIRECTION_MISSING` | P1 |
| A cross-stage consistency constraint requires positive/negative points | §1.4 data flow registered a same-field cross-stage consistency constraint → whether §1 has a "consistency check (positive/negative)" point; if it is marked as switch-affected, the post-switch-on validation strategy must also be covered | `CONSISTENCY_DIRECTION_MISSING` | P0 |
| A multi-effective-point switch requires a consistency point | §1.4 exception-link registered multi-effective-point switch inconsistency → whether §1 has a "multi-effective-point switch consistency" point | `MULTI_SWITCH_DIRECTION_MISSING` | P1 |
| Cross-layer business rules have independent verification points | The same §1.2 change point records both UI display/interaction and an interface contract or server-side execution constraint → whether §1 lists independent points on the matching layers; a UI-only point cannot cover interface fields / error codes / permission results, and an interface-only point cannot cover display or persist / state constraints | `CROSS_LAYER_DIRECTION_MISSING` | P1 |

### Rule R2-4: Technical-attribute point relevance

> Paired with R2-3: R2-3 prevents "a technical-attribute point that should have been identified was missed"; R2-4 prevents "a technical-attribute point that should not have been identified was generalized". Boundary between them: as long as §1.4 has a concurrency / idempotency rule, or §1.3 impact-surface inference confirms this change reached the matching path, there should be a point (owned by R2-3) and R2-4 is not reported; report R2-4 only when "the interface has that characteristic but this change did not reach that path".

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|----------|
| Technical-attribute point exceeds change relevance | §1 has an "idempotency / duplicate submit", "concurrency conflict", "transaction consistency", or "message exception (duplicate consume / out-of-order consume part)" point, but §1.2 acceptance rules do not involve the matching write / concurrency / multi-step transaction / message consume, and §1.3 impact-surface inference did not identify this change reaching that path — this is generalized identification of an unchanged legacy technical attribute (violates the test-design-guide.md §1.2 overall constraint "point identification always expands around this change" — "involves XX" in the operation-nature column always means this change actually reached XX, not that the interface statically has it). Delete the point or trace back to confirm whether the change truly reached it | `TECH_ATTR_DIRECTION_OVER` | P1 |
| Param validation, downstream exception, or internal exception has no basis | §1 has a param-validation, downstream-exception, or internal-exception point, but the matching C-x did not add/modify request params, a downstream call, or this-layer internal handling, and §1.2 did not explicitly state the matching exception handling; do not use an interface's inherent capability, generic robustness, or infrastructure risk as the generation basis | `EXCEPTION_DIRECTION_OUT_OF_SCOPE` | P1 |

### Rule R2-5: Verification-unit completeness and merge

> A **verification unit** is the smallest object of design review. It is carried in one test-point row of design.md §1; no independent artifact is added. It answers "which business rule is verified, under what condition it is triggered, and what result is expected". When reviewing, judge equivalence by the three items **verification object, triggered decision branch, expected result**: if all three are the same, merge; if any one differs, keep an independent verification unit. The number of interfaces, fields, pages, or entries is not itself a split basis.
>
> This rule only reviews the design quality of the verification target. It does not decide concrete case counts or step arrangement at this stage; those are handled by R3 coverage-path review.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|----------|
| Verification unit cannot be judged | A §1 test point cannot identify any of verification object, trigger condition, or expected result from "Verification summary + Design basis + Covered interfaces"; e.g. it only says "verify coupon logic is normal" or "check API returns correctly", so later coverage cannot be judged | `VERIFICATION_UNIT_UNDEFINED` | P1 |
| Isomorphic verification units were not merged | Multiple test-point rows verify the same object, trigger the same business decision or error-handling branch, and have isomorphic expected results, and were listed separately only because the interface / field / entry differs; merge them into one primary verification unit and list the involved carriers in Covered interfaces or Verification summary | `VERIFICATION_UNIT_DUPLICATE` | P1 |
| Heterogeneous verification targets were wrongly merged | One test-point row contains verification targets with different decision branches, different expected results, or mutually exclusive prerequisite states; e.g. success-allow and exception-block, two mutually exclusive switch states, or different error-handling branches are vaguely written in the same point; split them into independent verification units | `VERIFICATION_UNIT_SPLIT_REQUIRED` | P1 |

### Rule R2-6: Test points vs risk matching

| Check item | Judgment | Finding type |
|--------|---------|-------------|
| A risk point has a matching test point | For every §1.5 risk point, whether §1 has a matching point covering that risk | `RISK_NOT_COVERED` |
| Test points do not exceed the analysis boundary | Whether every point in §1 is inside the §1.1 analysis boundary "what to do" | `DIRECTION_OUT_OF_SCOPE` |

### Rule R2-7: Client test-point completeness

> Corresponds to the client-related design rules in test-design-guide.md §1.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| A module with a client change must have a client test point | For a module registered in the §1.3 client-page table with a change, whether the §1 table produced a client-related point (classification contains "client" or the point involves page interaction) | `CLIENT_DIRECTION_MISSING` | P0 |
| A module with no client change must not produce a client test point | For a module whose §1.3 client-page table is empty or marked "no client change", the §1 table should not have a client-related point | `CLIENT_DIRECTION_EXTRA` | P2 |

### Rule R2-8: Link-scenario identification completeness

> Corresponds to the two-step test-design-guide.md §1.3 "Link-scenario identification" rule (Step 1 business understanding + Step 2 interface call chain). A link scenario is produced as a §1 test-point table row whose classification is "link scenario".

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| A multi-step call chain in §1.4 requires a link-scenario point in §1 | The §1.4 interface call-chain table has ≥ 2 steps (multiple rows forming a caller→callee serial chain); whether the §1 table has a row classified as "link scenario" (Verification summary contains an interface sequence) | `SCENARIO_CASE_MISSING` | P1 |
| When there is no link scenario, it is truly not needed | When the §1 table has no "link scenario" classification row, whether every interface is truly an independent query, with no cross-interface data dependency and no complete lifecycle | `SCENARIO_SKIP_WEAK` | P1 |

---

## Step R2-3: Entity-inventory completeness review

**Review target**: `design.md §2 Test data inventory`

### Rule R2-9: Entity completeness

> Corresponds to the test-design-guide.md §2 identification rules. Phase 3 subagent item 4 states that "entity rows in the test-data table must and may only come from §2". An omitted inventory item causes a field that should have kept a placeholder in case request params to be wrongly filled with a real value or left blank.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Prerequisite dependencies of §1 scenarios are all registered in §2 | From each module's test-point table in §1 (including link scenarios and points of every classification), derive its prerequisite data dependencies (business data that must already exist in the system, with a system-generated identifier) and check whether the §2 table has a matching entity row | `DATA_ENTITY_MISSING` | P1 |
| §2 contains no illegal entities | Check each row against the candidate classes and three eligibility gates in test-design-guide.md §2: a real business object, a system-generated identifier, and a value the tester cannot set directly. Request params such as `clientType`, `phone`, `deliveryType`, enums, operation type, and IDs that are passed in directly or only used for query/routing/association; context such as request context, thread local, session, and pass-through maps; Config service / gray release / Experiment config, Mock, environment variables, rule config, cache switches, engineering identifiers, fixed enums/thresholds, or any item the tester can set directly are all illegal entities. Pickup / non-pickup, order status, user type, etc. may only be entity construction conditions and must not be standalone entities | `DATA_ENTITY_INVALID_TYPE` | P1 |
| §2 entity conditions and mutex info are complete | Every entity row's "construction conditions / business constraints", "mutex conditions", and "related scenarios" are non-empty; conditions must be expressed in words and must not be hidden inside the identifier placeholder | `DATA_ENTITY_CONSTRAINT_MISSING` | P1 |
| §2 three-dimension uniqueness is correct | Compare by "Entity + construction conditions / business constraints + mutex conditions": duplicate rows with the same three items and the same dependency relationship should be merged; entity rows that differ in any item must not be merged. Encoding a business condition, construction method, or meaningless serial number into the identifier (except the necessary distinction when the same case uses multiple entities of the same class at once) is also a violation | `DATA_ENTITY_UNIQUENESS_INVALID` | P1 |
| Entities depended on in the §2 "dependencies" column are in the inventory | If an entity's "dependencies" column is marked `depends: A, B`, then depended-on entities A and B must appear as independent entity rows in this inventory (must not depend on an entity outside the inventory); entities marked `none (base entity)` skip this check | `DATA_ENTITY_DEP_MISSING` | P1 |
| The §2 "dependencies" column has no cyclic dependency | The dependency graph formed by the §2 table "dependencies" column must be a directed acyclic graph (DAG) and must not contain a cycle (e.g. A depends on B and B depends on A, or a longer cycle); otherwise `testdata-generation` cannot determine a topological construction order | `DATA_ENTITY_DEP_CYCLE` | P0 |
| The §2 "dependencies" column format is compliant | Every entity's "dependencies" column in the §2 table is non-empty and matches the format — a base entity writes `none (base entity)`, one with dependencies writes `depends: {entity name list}` | `DATA_ENTITY_DEP_FORMAT` | P2 |

`DATA_ENTITY_INVALID_TYPE` disposition: remove illegal items from §2; migrate config / switch / Mock / environment prep into the related point's "Verification summary" so phase 3 can write them into the matching Prerequisites; migrate request params, context, enums, fixed values, thresholds, and engineering locator fields into scenario conditions, request params, or engineering notes; migrate entity attributes / states into the owning entity's "construction conditions / business constraints" column. `DATA_ENTITY_CONSTRAINT_MISSING` / `DATA_ENTITY_UNIQUENESS_INVALID` disposition: complete the condition and mutex wording; merge truly duplicate rows and split rows with different conditions by three-dimension uniqueness, and restore the standard identifier placeholder. Afterward, re-check the §2 dependency DAG, placeholder sources, and entity-relationship graph so no illegal node or edge remains.

---

## Step R2-4: Regression-point reasonableness review (when regression artifacts exist)

> Corresponds to test-design-guide.md §3 "Regression test points". Final placement of a regression row follows "append to the original table if §1 already has the module; create a same-name block in §3 only if §1 has no such module": therefore the review target is **every `classification=regression scenario` row** in design.md, whether it sits in an existing §1 module table or a newly created §3 module. After regression recall is triggered, R2 must read the per-interface regression handling report: script-reuse conclusions and regression-design conclusions are two independent states; a `partially_reusable` / `not_reusable` interface must finish body reading and produce a regression entry or an evidenced no-plan conclusion. A no-regression-plan interface must be registered after body reading and any necessary follow-up lookup. Skip this step only when regression recall was not triggered.

**Review target**: every `classification=regression scenario` row in `design.md`, plus the §3 no-regression-plan interfaces / TBD-attribution candidate lists (if any)

### Rule R2-10: Regression-point reasonableness

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Regression-row module placement is correct | Compare the regression row's "Covered interfaces" and "Source" against the §1 module's covered interfaces and module overview. When §1 already has the matching module, the regression row must sit in that module's original table; only when §1 has no such business module may a same-name block be created in §3 | `REGRESSION_MODULE_PLACEMENT_INVALID` | P0 |
| The change point associated with a regression point exists | The C-x referenced in each regression-scenario row's "Design basis" or "Source" actually exists in §1.2 | `REGRESSION_CHANGE_LINK_BROKEN` | P0 |
| Regression points have Covered interfaces marked | The "Covered interfaces" column of every regression-scenario row is non-empty: it filled a methodName (a link-type regression fills an interface sequence), or filled `none` when there is truly no interface host | `REGRESSION_COVERAGE_MISSING` | P1 |
| Regression Covered interfaces are traceable | Each methodName in a regression-scenario row's "Covered interfaces" column (split a sequence and check one by one; skip those marked `none`) can find a matching interface in the §1.3 Server APIs table or `api-details.md` | `REGRESSION_COVERAGE_UNTRACEABLE` | P1 |
| Regression points have impact analysis | Each regression-scenario row's "Design basis" or "Source" can explain how the change affects existing functionality, not an empty generic description such as "may be affected" | `REGRESSION_IMPACT_VAGUE` | P1 |
| Regression points have a complete evidence chain | Each regression-scenario row's "Design basis" and "Source" can locate: the change anchor (method/field/branch/config), the legacy scenario (interface/caller/business branch), and the path association (why that scenario calls / passes / reads that anchor); any missing item, or only citing a title/abstract without showing a body association → finding | `REGRESSION_EVIDENCE_CHAIN_INCOMPLETE` | P0 |
| Regression points have a knowledge-base source | The "Source" column of every regression-scenario row is non-empty and marks a recalled-snippet summary or a knowledge-base file path | `REGRESSION_NO_KB_SOURCE` | P1 |
| Regression points do not duplicate new-feature points | A regression-scenario row should not duplicate a same-module new-feature point; when both verify the same interface and the same positive goal, keep the new-feature point | `REGRESSION_DUPLICATES_NEW` | P2 |
| Regression points can converge (code-path level) | "Design basis" must include a concrete method name or field name that can be located in the same row's "Source" summary; a generic description such as "logic change may affect", or a core identifier that cannot be located in the source, both fail | `REGRESSION_NOT_CONVERGENT` | P0 |
| Regression handling report is complete | When regression recall is triggered, the review subagent must ask the main agent for the per-interface regression handling report and check that every current-change interface contains `changeAnchors`, `scriptReuseStatus`, `scriptReuseReason`, `knowledgeReviewStatus`, `knowledgeDocumentsReviewed`, `legacyScenarioEvidence`, `regressionDesignStatus`, and the matching entries/reasons; a missing field, or any interface still at `knowledgeReviewStatus=pending` / `regressionDesignStatus=pending`, means regression recall is incomplete. `reusable` is allowed only when `knowledgeReviewStatus=not_required` and `regressionDesignStatus=designed`, and there must be evidence that the checklist covers every impact point | `REGRESSION_KB_REVIEW_SKIPPED` | P0 |
| Non-reusable interfaces finished knowledge-base design | For every `partially_reusable` / `not_reusable` interface, `knowledgeReviewStatus=completed` must be checked, and design.md must have a matching regression-scenario row, or an evidenced no-plan conclusion for that interface; "script library empty", "no case_id", "script mismatch", or "cannot reuse" cannot themselves be the reason for no plan | `REGRESSION_DESIGN_MISSING` | P0 |
| No-regression-plan interface registration is compliant | In the §3 "no-regression-plan interfaces" list (if any), each interface's display summary must include the minimum conclusion: change path, number of bodies checked, and that no associated legacy scenario was found. The review subagent must check that interface's full report audit evidence and verify from it that the associated change point truly exists in §1.2: executed query, hit documents, body reading, one necessary follow-up lookup when material is missing, and the reason it cannot be associated; it must meet the registration prerequisites in test-design-guide.md §3.2. Do not register from a miss, title mismatch, abstract, unread body, empty script library, or missing case_id alone; if that interface already has a matching regression-scenario row, it should not be registered here either | `REGRESSION_NOPLAN_MISUSED` | P0 |

---

## Step R2-5: Interface-info completeness validation

**Review target**: `usecases/testdocs/api-details.md`

### Rule R2-11: Interface-detail completeness

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| FQCN is filled | Every interface `<details>` block in `api-details.md` contains an FQCN (starting with `com.`) or is marked `(interface doc not found)` | `CLASSNAME_MISSING` | P1 |
| Every interface in the §1.3 interface table has a record in api-details.md | Extract every methodName from the §1.3 Server APIs table and check one by one whether `api-details.md` has a matching `<details>` block | `API_DETAIL_MISSING` | P1 |

---

## Step R2-6: Aggregation + disposition

### Finding confidence and self-check

Every finding must carry `confidence`:

| Confidence | Definition |
|--------|------|
| `HIGH` | Has a concrete design.md/analysis.md chapter number or file line number as evidence |
| `MEDIUM` | Has indirect evidence; needs human confirmation |
| `LOW` | Inferred from testing experience; no direct evidence |

After producing each finding, run a rebuttal check:

| Check item | Fail disposition |
|--------|-----------|
| Is the finding inside the requirement boundary? | Out of scope → delete |
| Is there a concrete chapter number or line number as evidence? | None → downgrade to LOW |
| Does a P0 finding have HIGH confidence? | P0 + not HIGH → downgrade to P1 |

### Disposition rules

**Has P0 finding (`CHANGE_NO_DIRECTION` / `CLIENT_DIRECTION_MISSING` / `REGRESSION_CHANGE_LINK_BROKEN` / `REGRESSION_NOT_CONVERGENT` / `REGRESSION_MODULE_PLACEMENT_INVALID`, etc.)**:
- The review subagent fixes design.md in place (add missing test points, add client test points; the `REGRESSION_NOT_CONVERGENT` fix is to **delete** regression-scenario rows in design.md whose core identifier is not visible in the KB source; the `REGRESSION_MODULE_PLACEMENT_INVALID` fix is to **move** the regression row into the original point table of the matching §1 module. Keep or create a same-name module in §3 only when §1 truly has no such actual business module)
- For `REGRESSION_KB_REVIEW_SKIPPED`, `REGRESSION_DESIGN_MISSING`, or `REGRESSION_NOPLAN_MISUSED`, R2 is **forbidden** from inventing a regression row or passing it in place: the main agent must dispatch a new regression-recall subagent, passing the current `analysis.md`, `changed-interface-knowledge.json`, `design.md`, `regression-checklist.json`, `knowledgePath`, all source-material paths, and this P0 finding; the new subagent must re-output a complete per-interface report and finish body reading and design for `partially_reusable` / `not_reusable`. After merging the result, re-dispatch R2 review
- After the fix, re-run the R2-1 structure check to confirm the fix is effective

**Only P1/P2 findings or no findings**:
- Output the review summary and mark pass

**Output format**:

```
✅ R2 test design review complete
Structural completeness: pass
P0: {x}  P1: {y}  P2: {z}

{if there are P0:}
| Finding | Chapter | Evidence | Fix action |
|---------|------|---------|---------|
| CHANGE_NO_DIRECTION: change point "batch issue coupon" has no test point | §1 | §1.2 C-3 change point, §1 has no matching module | already added the test point |
```

---

## Forbidden actions

- Loading source-material files in full (only grep key patterns)
- Emitting findings outside the requirement boundary
- Forcing a challenge on every test point (no evidence → no finding)
- Skipping the R2-1 structure check and going straight to semantic review
- Labeling a LOW confidence finding as P0
- Introducing information that does not exist in analysis.md or the source materials during review
