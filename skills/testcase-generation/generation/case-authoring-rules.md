# Case Design Spec (Phase 3 Step One)

**Output**:
- `usecases/cases/{module}/*.md`: case documents (all cases)

**Input**:
- `usecases/testdocs/analysis.md` (phase 1 output; do not reread PRD or other source materials)


**When to use**: This spec is cited in **`phase-3-cases.md` Step One, first action (case design)**; the concrete execution flow is in §0. Phase 3 Step Two no longer cites this spec and only does formatted output.

> ⚠️ **Two independent numbering scopes**: `Step One` / `Step Two` always refer to generate-skill **Phase 3**. The `Step 1` / `Step 2` / `Step 3` headings inside §0 below are this document's own internal expansion stages and are unrelated to the phase numbering.

**Core duties**:

- §0 defines the case-design flow: expand verification points + three rules for aggregating them into a case list
- §1/§2/§3 give concrete specs for expanding verification points: which concrete verification points each coverage direction expands into, and how to choose assertion dimensions
- Provide template specs for Phase 3 Step Two formatted output: generate case `.md` files per the `manual-case-template.md` template


---

## 0. Verification-point expansion and case aggregation rules

> This section is the execution spec for generate-skill Phase 3 Step One, first action "case design"; `phase-3-cases.md` Step One cites it.

### Step 1: Expand verification points

> 🧭 **Scope**: This rule takes a **single module** of `design.md §1` (including `#### [Flow-XXX E2E]` flow modules) as its scope. Both "Step 1 expand" and "Step 2 aggregate" run **inside a single-module scope** — only read, expand, and aggregate points listed in this module; **do not expand or aggregate across modules**. Cross-module global dedup is not this scope; it is handled later by the global-dedup phase (see Step 3 "Global second-pass dedup"; orchestration is in `phase-3-cases.md`).

> 🔁 **First split caliber by "Category", then decide whether to look up the mapping table**: for each row of the module point table, first look at the "Category" column to decide which caliber to take —
> - **Non-regression rows (Category is normal scenario / boundary scenario / exception scenario / flow scene)** → take the **new-feature caliber**, locate the chapter via the "coverage direction → expansion-spec mapping table" below, and mark `category: "new_feature"`.
> - **Regression rows (Category is `regression scenario`, regression directions appended by §3)** → take the **regression caliber**, **do not look up the mapping table and do not expand per §2/§3 design specs**; restore the existing feature's operations directly from that row's "Verification summary", "Covered APIs", and "Source", expand into 1~2 regression cases (happy-path main path + key boundary; do not expand the full exception set), and mark `category: "regression"`. ⛔ A regression case's 1. Prerequisites, 2. Steps, called APIs/sequences, parameter values, and assertion fields may only reproduce the existing flow that regression row can prove; do not add steps, call a new entry, pass a new param/enum, construct data that only serves an incremental branch, or assert a new field/new behavior just to verify this change. A regression row's expectations may only come from the knowledge-base existing behavior stated in "Verification summary"; **do not apply this PRD's new/modified expectations** (e.g. do not add an assertion of the new field `promoBadge` to a regression case). If the existing steps cannot be restored from that row, stop generating and write back to design; do not borrow PRD, technical design, or `analysis.md` inference.
>
> The mapping table below and its closing details serve only the **new-feature caliber**; regression rows do not apply. After expansion they enter Step 2 in-module aggregation together with new-feature cases.

Read **this module**'s test-point table. **For rows whose "Category" is not `regression scenario`**, locate the corresponding chapter of this spec via the table below and expand into concrete verification points. The expansion result is a **complete verification-point list** for this module; each verification point includes: trigger condition, operation, expected result.

> ⚠️ **Coverage-direction vocabulary is authoritative**: the names of the two columns "Group / Coverage direction" in the table below take the point-identification rules of `design.md §1` as the authoritative source; this table only provides the mapping from each coverage direction to an expansion-spec chapter. If a point name read from design.md §1 has no corresponding chapter in this table, the vocabulary is out of sync — go back to design.md and check the point name; do not guess a chapter or skip that point.

> ⚠️ **Prerequisite constraints (must read before expanding any coverage direction)**:
> - §1.5 Positive/negative pairing and expansion-completeness rules: positive/negative pairing (symmetric assertion dimensions, concrete negative expectations, associated impact must not be omitted), business effective-scope statement → other-enum-value negative derivation, multi-level dimension expansion for sort/prefer logic, isomorphic-expectation convergence (when the same logic has multiple carriers and the same expectation, do not over-expand; converge with a parameterized data table / involved-API list)
> - §1.6 Normal-scenario design principles: assertion-dimension selection rules, applicable to all normal scenarios and scene cases
> - §1.7 Boundary-scenario design principles: distinction between boundary and exception scenes, identification sources, design points
> - §1.8 Exception-scenario design principles: common constraints for all exception scenes (must not return NPE/500, must not produce dirty data, etc.)
> - §1.9 Scene-case structure spec: step-table structure, data passing, Mock, and assertion strategy for flow scenes in the case-design phase (flow identification and judgment are in `test-design-guide.md §1`; flows are already independent modules in the design phase)

**Coverage direction → expansion-spec mapping table**

> How to use: after reading a module's test points from `design.md §1`, look up this table by point name to find the corresponding chapter, jump to that chapter's "Test points" and "Verification items", and expand row by row into verification points.

**Server**

| Group | Coverage direction | Expansion-spec chapter | Expansion points |
| ----- | ------------------ | ---------------------- | ---------------- |
| Scene case | Scene case | §1.9 | The flow scene was already identified in the design phase and made an independent `#### [Flow-XXX E2E]` module (API sequence already fixed); expand that API sequence into one flow-scene case per the §1.9.2 structure spec |
| Normal scenario | Data integrity | §2.1.1 | Expand each scene row in the table: DB master-table persist, related-table consistency, update-scope convergence, cache sync, MQ message send |
| Normal scenario | Data consistency | §2.1.2 | Expand each scene row in the table: read-after-write consistency, primary/replica consistency, Cache vs DB consistency, etc. |
| Normal scenario | Degrade / circuit break | §2.1.3 | Expand one verification point each for config-switch degrade and circuit-break degrade |
| Normal scenario | Gray release / Experiment grouping | §2.1.3 | Expand one verification point each for gray release (hit/not hit) and AB Experiment (control group/experiment group) |
| Boundary scenario | Effective-scope negative case | §1.5.2.1 | Target value takes effect under the new logic; each other known enum value verifies the new logic does not take effect and existing behavior stays unchanged |
| Normal scenario | Consistency check (positive/negative) | §1.5.1 | Verify as a rule branch: pass when consistent, fail or degrade when inconsistent; when analysis.md §1.4 marks it as switch-affected, add the check policy after the switch is on |
| Normal scenario | Multi-effective-point switch consistency | §1.5.1 | Verify as a rule branch: when all effective, all degraded, and states are inconsistent, verify the explicit fallback or actual behavior separately |
| Boundary scenario | Parameter boundary values | §2.2 | Combined with quantity limits, amount thresholds, string-length, etc. constraints identified in `analysis.md §1.2` acceptance rules, expand extreme-value verification points row by row by parameter type in the table |
| Boundary scenario | State boundary values | §2.2 | Combined with state critical points identified in `analysis.md §1.2` acceptance rules (just meeting the threshold, just expiring, just reaching the max count, etc.), expand extreme-value verification points by the state-boundary rows in the table; the expected result is that business logic executes normally |
| Exception scenario | Parameter validation | §2.3.1 | After design.md has listed this point, converge by the applicable requiredness, type, range, special-value, and business-logic subtables |
| Exception scenario | State exception | §2.3.3 (business-logic exception row) | After design.md has listed this point, construct an evidenced illegal jump or repeat operation |
| Exception scenario | Permission exception | §2.3.1 (business-logic validation → related-resource row) | After design.md has listed this point, expand evidenced unprivileged/over-privilege access |
| Exception scenario | Idempotent / resubmit | §2.3.4 (concurrent-write unique-key conflict row) | First pass the §2.3 change-relevance gate (expand only when the requirement/change involves the corresponding write); if hit, expand one verification point for resubmit with the same business unique key |
| Exception scenario | Concurrency conflict | §2.3.4 | First pass the §2.3 change-relevance gate (expand only when the requirement/change reaches a concurrent write); if hit, expand the four scene rows in the table one by one (unique-key conflict, deduct a finite resource, optimistic lock, distributed lock) |
| Exception scenario | Downstream exception | §2.3.2 | After design.md has listed this point, expand by the exception branches materials make explicit; do not default-enumerate the six scene types |
| Exception scenario | Internal exception | §2.3.3 | After design.md has listed this point, expand by the exception branches materials make explicit; do not default-enumerate infrastructure exceptions such as DB, lock, transaction |
| Exception scenario | Transaction consistency | §2.3.3 (transaction-rollback row) | A middle-step exception triggers rollback; expand one verification point |
| Exception scenario | Message exception | §2.3.5 | Format/structure exception and business-logic exception expand by whether the API consumes MQ; the duplicate-consume and out-of-order-consume rows first pass the §2.3 change-relevance gate (expand only when the requirement/change reaches message-driven) |

**Client**

| Group | Coverage direction | Expansion-spec chapter | Expansion points |
| ----- | ------------------ | ---------------------- | ---------------- |
| Scene case | Scene case | §1.9 | Client flow scenes (cross-page flow, multi-role collaboration) were already identified in the design phase and made an independent `#### [Flow-XXX E2E]` module; expand them into one flow-scene case per the §1.9.2 structure spec |
| Normal scenario | Page interaction | §3.1.1 (Web) / §3.2.1 (App) | Expand interaction items row by row: list pagination, search/filter, dialog/drawer, form reset, async load, etc. |
| Normal scenario | Permission isolation (positive) | §3.1.1 (permission-isolation row) / §3.2.1 | A privileged user normally accesses a protected page or action button; expand one verification point |
| Normal scenario | User flow | §3.2.1 | Expand flow types row by row: core main flow, multi-entry, interrupt-resume, forward/back |
| Normal scenario | Share and jump | §3.2.1 (share-and-jump row) | A share link/QR code launches the App; landing-page data matches the shared content; expand one verification point |
| Boundary scenario | Polymorphic / boundary display | §3.1.2 (Web) / §3.2.2 (App) | Long-text truncation, empty-state display, skeleton/Loading, keyboard occlusion, landscape/portrait switch, etc.; expand test items row by row |
| Boundary scenario | User experience | §3.2.2 | First-screen load time, dark-mode adaptation, etc.; expand test items row by row |
| Exception scenario | Config error | §3.1.3 | Expand config items/interaction items row by row: required field not configured, numeric out of range, time-logic error, image/file format, rich text/URL |
| Exception scenario | Permission isolation (negative) | §3.1.3 (permission-isolation row) | An unprivileged user accessing a protected page or action button is blocked; expand one verification point |
| Exception scenario | Network and fault tolerance | §3.2.3 | Expand scene rows row by row: weak network, offline, network switch, gesture operations |
| Exception scenario | Compatibility | §3.2.4 | Expand one verification point each for the dimensions in the table (iOS version, Android version, screen resolution, App version) |

> ⚠️ **Expansion constraints**: every test point listed in §1 must be expanded and must not be skipped; points not listed are not expanded (regression rows take the regression caliber in the 🔁 split at the start of this section and do not apply this mapping table).
>
> **API location (prefer the "Covered APIs" column)**: when expanding a test point, **read that point's "Covered APIs" column directly** to decide the target API this verification point will test — server verification points use it to locate the API and its request/response (`<details>` of the corresponding API in `api-details.md`); flow scenes orchestrate steps by their API sequence; a pure client verification point (`Page: {page name}`) traces the related API via "Related Server APIs" in the §1.3 client page table; `none` means no API call is involved.
>
> **Business-semantic location (still use the "Source" column)**: use the codes in the test-point table "Source" column (feature point Fx, change point C-x, rule BR-x/TR-x) to locate the corresponding `analysis.md` item; combine §1.2 acceptance rules to take assertion copy/error codes/numbers; combine the §1.3 API info of the "Covered APIs" API to decide which sub-rows apply; do not expand inapplicable sub-rows (e.g. if the API has no MQ, "MQ message send" is not expanded).
>
> If a verification point's "Covered APIs" column is empty or the filled API cannot be found in `api-details.md`, go back to design.md §1 and complete/correct "Covered APIs" by its source C-x before expanding; do not guess the API yourself.

### Step 2: In-module aggregation (single-module scope)

> 🧭 **Scope**: This step only aggregates the verification-point list expanded by Step 1 for **this module**; **not across modules**. Flatten this module's verification-point list (no longer distinguish sub-sources inside this module), then make aggregation judgments in the following three rule classes in order:

**Rule 1: Cross-API merge (flow scene, flow modules only)**

For a flow module (`#### [Flow-XXX E2E]`) verification point, the API sequence was already fixed in the design.md phase; merge directly by that API sequence into **one flow-scene case**; do not split into multiple single-API cases. The two flow modes (§1.9.2 structure spec):
- Mode 1: Full lifecycle (the same business object from create to terminal state)
- Mode 2: Full business flow (multiple APIs together complete one end-to-end goal; a prior API's output is a later API's input)

> ⚠️ Ordinary feature modules **do not do cross-API flow merge** — flows were already made independent blocks in the design phase; a feature module only handles single-API verification points inside this module (Rule 2, Rule 3).

**Rule 2: Happy-path verification-point dedup (in-module)**

Happy-path verification points inside an ordinary feature module (normal scenario, supplemental path) are deduped **only inside the same module**: verification points with the same API, the same verification goal, and substantially the same trigger condition and expected result → merge into one, and no longer generate a standalone case. A flow scene and a single-API case belong to different modules; whether they duplicate is not judged in this step and is left to Step 3 global second-pass dedup.

**Rule 3: Single-API exception merge (in-module)**

Exception verification points in this module not covered by Rule 1 are handled as follows:
- **Parameter-validation class**: all parameter-validation verification points of the same API (required missing, type error, boundary values, special values, etc.) → merge into one case
- **Other exception class** (downstream exception, degrade, concurrency, MQ, etc.): same prerequisite dependency → merge into one case; different prerequisite dependency (e.g. need different Mock construction, switch on vs switch off) → keep independent

> ⚠️ **Aggregation constraint**: aggregation judgment must finish before planning the case list; do not first map cases one by one and then merge afterward.

**Rule 4: Regression-case handling (in-module)**

`category: "regression"` cases (from `Category=regression scenario` rows) **do not participate in Rule 1~3 aggregation** — each regression direction becomes one independent regression case and is kept. But do one **regression vs new-feature duplicate elimination** inside this module: if a regression case and some `new_feature` case in this module cover the same API and the same happy-path verification goal → delete that regression case (keep the new-feature case; the value of regression is covering existing scenes §1 did not involve; no need to repeat what new feature already covers). This elimination finishes inside the module and belongs to the in-module scope.

After this module's aggregation, produce this module's case list — each case includes: case name + the complete covered verification-point list (`coverage` content) + caseType judgment + `category` (new_feature / regression; values and linkage constraints are in §1.3.2) + owning module name + design-source citation (module name, category, verification point, verification summary, covered APIs). The design-source citation is passed to the main agent with the candidate case and written as-is into the registry `source_design_ref`; it must not be lost during aggregation, dedup, or registry write; it is the only design source for R3/R4 to judge category and regression existing steps. This phase only produces a case list inside the module; it does not write files, generate UUIDs, or write the registry.

### Step 3: Global second-pass dedup (cross-module scope, run once after all modules are collected)

> 🧭 **Scope**: This is not a per-module step; it is a **global** dedup close after **all modules** have each finished Step 1 and Step 2 and results are collected, and only then are UUIDs batch-generated and written into case-registry.json. This step does not re-expand or rewrite a single case's coverage content; it only eliminates cross-module duplicates.

After collecting every module's case list, scan by these rules:

- **Overlapping happy-path verification between a flow and a single API**: when a feature module's happy-path single-API case and a flow-scene case have the same verification goal, delete the verification points in the single-API case that the flow already covers; if after deletion the single-API case still has verification points the flow does not cover, keep it and let it carry only the remaining verification points; if no verification points remain, delete that single-API case. A flow case's coverage is not rewritten because a single-API case exists; if a middle API carries an independent verification goal or necessary state passing, keep it as originally defined by the flow scene.
- **Cross-module leftover duplicates**: semantically equivalent cases produced by different modules because of boundary-understanding differences (same API, same verification goal) → keep one, delete the rest; if a deleted item's coverage has verification points the keeper is missing, merge them into the keeper.
- **Cross-module same-switch / same-dimension two-state merge**: the two states of the same switch, the same shared decision, or the same config dimension (on/off, hit/not hit) appear repeatedly in multiple modules (same logic unit, same assertion goal; only the owning API/module differs) → merge into one primary verification + one "involved APIs/modules list", and delete the other duplicate items; if a deleted item contains an API entry the keeper is missing, add it to the list. This is the global-scope fallback of §1.5.3 "isomorphic-expectation convergence"; the criterion is likewise whether the verification goal is the same.
- **Do not over-merge**: ⛔ Global dedup only deletes "duplicates"; it must not forcibly merge cases that **belong to different business modules and have different verification goals** (e.g. "coupon-config status validation" and "coupon-redeem status validation" are two; merging is forbidden); the two-state merge above is under the same constraint — only merge cross-module restatements of the same decision logic; different verification goals are not merged.

After global dedup, you have the final case list; from it, batch-pregenerate UUIDs and write `case-registry.json` (orchestration is in `generation/phase-3-cases.md` Step One).

---

## 1. Common strategy

This chapter's strategy applies to both server testing and client testing and provides the base design framework for all test scenes. Cases are split by scene nature into **normal scenario** and **exception scenario**.

### 1.1 Case standards

> **Overall design principle**: weaken layering; do not split cases by the dimension "API layer / service layer / data layer"; organize cases by real business scenes; when multiple change points can be chained, prefer merging them into a complete flow; case style stays close to black-box integration tests and avoids unit-test style (do not verify internal method calls; do not take a single function as the test object).

| Dimension | Requirement |
| --------- | ----------- |
| Scene completeness | One case covers one complete business scene; steps are coherent; assertions cover all key results in the scene |
| **Scene case first** | **Whenever APIs have a natural business series (full lifecycle, full business flow), default to generating a cross-API scene case rather than splitting into multiple single-API cases. Flow identification criteria are in `test-design-guide.md §1` (flows are independent modules in the design phase); the case-design-phase structure spec is in §1.9.2.** |
| Independence | Cases have no implicit dependency and can run independently |
| Readability | One md file may contain only one case |
| Assertion completeness | Cover all key verification dimensions involved in the scene (API response, DB, Cache, MQ, etc., selected as needed) |
| Data isolation | Test data uses an independent account/tenant to avoid polluting a shared environment |
| Case type | Every case must mark `caseType` (UI / SERVER); rules are in 1.3 |
| No unit tests | Do not generate white-box unit-test cases against a single method/function; a case must fire from an API or page entry and verify business behavior rather than code-implementation details |

### 1.2 File naming and case-title rules

Each case corresponds to one `.md` file. **The file name (without `.md`) is exactly the same as the H1 title text**, in the unified format:

```
[<domain>-<flow/page>] <scenario>-<goal>
```

| Dimension | Notes | Example |
| --------- | ----- | ------- |
| **Domain** | Business module or feature domain | Order, coupon, SKU detail, payment |
| **Flow/page** | Concrete flow name or page name | Checkout flow, detail page, issueCoupon API |
| **Scenario** | Brief of the trigger scene, including normal/exception/gray-release types | Happy path, downstream timeout, config degrade, impression tracking |
| **Goal** | The result this case core-verifies | Data persists correctly, degrade returns default, params reported correctly |

Examples:

| File name | H1 title |
| --------- | -------- |
| `[Order-checkout flow] happy path-order succeeds with sufficient inventory.md` | `# [Order-checkout flow] happy path-order succeeds with sufficient inventory` |
| `[Coupon-issueCoupon API] downstream timeout-degrade to default.md` | `# [Coupon-issueCoupon API] downstream timeout-degrade to default` |

### 1.3 Case-tag rules (caseType and category)

> Every case must mark two orthogonal tags: `caseType` (trigger dimension: UI / SERVER, see 1.3.1) and `category` (source dimension: new_feature / regression, see 1.3.2). They do not affect each other and are judged independently.

#### 1.3.1 Case-type tag (caseType)

**Every case must mark `caseType` in frontmatter, judged by these rules**:

| caseType | Meaning | Judgment condition |
| -------- | ------- | ------------------ |
| `UI` | Triggered via a client page; end-to-end verifies page display + API response + corresponding DB/Cache checks | **Preferred**. The client page table has a corresponding page for this feature point; it can fire from the page and observe the result on the page; if server checks are involved, you may directly assert the corresponding API response and storage |
| `SERVER` | Triggered by calling a server API directly; pure server verification | **Fallback**. No corresponding page, the page did not change, or it cannot fire from the page (exception params intercepted by the client, MQ consume, cron jobs, concurrency/idempotent); or the core result cannot be observed on a page (pure backend state change, DB/Cache write with no page presentation) |

> ⚠️ If a module's happy-path main flow is marked `SERVER`, but `analysis.md §1.3` already registered a corresponding client page, that means end-to-end coverage was missed; change it to `UI` and add page-verification dimensions. Exception scenes (parameter validation, MQ consume, concurrency, cron jobs, etc.) cannot fire from the client themselves; marking them all `SERVER` is normal.

#### 1.3.2 Case-category tag (category)

**Every case must mark `category` (written into `case-registry.json`); choose one of two values; there is no third state; must not be missing or left empty**:

| category | Meaning | Judgment condition |
| -------- | ------- | ------------------ |
| `new_feature` | Forward verification of this PRD's **new/modified features** | **Default**. From rows in the design.md module point table whose "Category" is normal scenario / boundary scenario / exception scenario / flow scene; expectations come from this PRD/technical design |
| `regression` | Protection regression of **existing features this change may affect** | From rows in any design.md module point table whose "Category" is `regression scenario`; that row may live in an existing §1 module table, or in a §3 newly created module when §1 has no corresponding module. Expectations come from knowledge-base existing behavior; **do not apply this PRD's new/modified expectations** |

> ⚠️ **Linkage constraints**:
> - **Decide source first, then fill the tag**: every candidate case must keep its design-source citation when aggregating; any case whose cited design point's category is normal scenario / boundary scenario / exception scenario / flow scene is always marked `new_feature`; only a source row `Category=regression scenario` is marked `regression`. Forbidden to guess/reverse-infer category from similar API names, the same module, coverage copy, or caseName. Missing/empty/illegal values are fatal errors (R3 check `CATEGORY_INVALID`, P0).
> - **Bidirectional consistency with the `[Regression]` prefix**: `category: "regression"` ⟺ caseName starts with `[Regression]`; both must hold together or fail together (R3 check `CATEGORY_PREFIX_MISMATCH`, P0).
> - **regression must have a precise regression-scene source**: every `category: "regression"` case must carry `source_design_ref`, and in the design.md point table of the module that filePath belongs to, trace back to the `Category=regression scenario` row that object points to; that row's "Verification summary" and "Covered APIs" must both correspond to its coverage. That row is a legal source even if it lives in an existing §1 module table and design.md has no §3. When it cannot correspond precisely, you must change it to `new_feature` and remove the `[Regression]` prefix (R3 check `CATEGORY_NO_SOURCE`, P0).
> - **Orthogonal to `caseType`**: `category` marks the source dimension "new feature / regression"; `caseType` marks the trigger dimension "UI / SERVER"; they do not affect each other and are marked independently.

### 1.4 Case-generation constraints

Information in technical design, PRD, or `analysis.md` must not be copied into a case indiscriminately; write only content this case needs to execute. Every item in the case details must satisfy one of the following keep/drop criteria; otherwise do not write it:

- **1. Prerequisites / 2. Steps / assertions**: if removing this item does not affect the case's execution or assertions — do not write it.
- **5. Teardown**: after the case runs, will leftover env state need manual restore (Mock, Config service, test data) — if there is no leftover impact, do not write it.

**Every case file must be generated strictly per the `manual-case-template.md` template**; do not invent a structure or omit chapters. The template covers:

- frontmatter (`caseId`, `caseType`)
- H1 title
- 1. Prerequisites (client env / Entity / Config service / Experiment / Mock / tracking info; keep as needed; delete unused whole sections)
- 2. Steps and Expected Results table
- 5. Teardown (Config service restore / test-data restore; keep as needed; delete if none apply)
- 3. Request and Assertions (required when an API call is involved; request must come from the corresponding API's `<details>` request/response details in `api-details.md`; do not construct them yourself; when filling, keep data-related field values as `{placeholder}` and fill other fields with real values)
- 4. Engineering Info (required when an API call is involved; list API serviceId / type / methodName, plus the database / cache / mq fields declared by `profile.components` in `integrations-resolved.json` — default datasource / table / shardingRule, cluster / key / command, cluster / topic / producer. Missing values fill `TBD`. Forbidden to write Redis / KV store split tables or fields the profile did not declare)

#### 1.4.1 Expected-result organization: by dimension ownership (common to UI / SERVER)

Expected results are organized by verification dimension; UI / SERVER cases share this (they do not diverge by caseType):

- **Page-behavior class** (Toast / page jump / element display / data echo / tracking report, etc.): record directly in the Expected column of the "2. Steps and Expected Results" table as `▸ UI: ...` / `▸ tracking: ...` on separate lines (cite `analysis.md` original copy; do not fuzz). Only UI cases have this dimension.
- **Backend-assertion class** (API response / DB / Cache / MQ / exception handling / degrade / gray release, etc.): **full assertions are externalized** — write them into that step's "expected" fold in "3. Request and Assertions", expressed as commented `jsonc` (format in `manual-case-template.md` chapter 3); for every step that involves an API call, the request fold and the expected fold **appear as a pair** (`Step N · {methodName} request` + `Step N · {methodName} expected`). **The step table writes only a summary** — each verification dimension uses `▸ {dimension} {locator}: {key value}` on **its own line** (separate cells with `<br>`), and the last line is `See chapter 3` alone. ⛔ Different dimensions must not be squeezed onto the same line; ⛔ do not degrade to valueless descriptions such as "as expected / success / failure / normal".

**caseType correspondence**:

| caseType and backend call | Step-table Expected column | Chapter 3 expected fold |
|---------------------------|----------------------------|-------------------------|
| SERVER case (always has a backend call) | Only backend-assertion `▸` rows + `See chapter 3` | Required |
| UI case (includes a backend call) | First `▸ UI: ...`, then `▸ API response/DB/...` backend summary + `See chapter 3` | Required |
| Pure-frontend UI (no backend call at all) | Only `▸ UI: ...` / `▸ tracking: ...` | Do not write (delete the whole chapter) |

**Summary examples**:
- Pure SERVER: `▸ API response \`createActivity\`: code=1, activeId not empty<br>▸ DB active_info: added 1 row, version=0<br>▸ Cache active_info: Key=coupon:{activeId} synced<br>See chapter 3`
- UI with a backend call: `▸ UI: Toast "Added to cart", cart badge +1<br>▸ API response \`addCartItem\`: code=0, cartId not empty<br>▸ DB cart_item: added 1 row, goods_id persisted<br>See chapter 3`
- Pure-frontend UI: `▸ UI: {Toast/jump/display}<br>▸ tracking: event={name}, {param}={value}`

**API-response per-field completeness (critical)**: the `// ① API response` segment of the expected fold must take the corresponding API's response structure in `api-details.md` as the basis and **assert every business field inside `data` one by one** — write a value when the expected value can be decided (error codes/copy/state values cite `analysis.md` original text); write a placeholder comment when the value cannot be decided (`"<not empty>"` / `"<type:xxx>"`). ⛔ Forbidden to stop after asserting only code/msg, and forbidden to verify only the DB dimension while omitting assertions of the API response itself.

**Request-comment conventions (key fields must be marked)**: the request fold, like the expected fold, uses commented `jsonc` (not plain `json`); **key fields must be marked with an inline `//` comment** — meaning + legality basis + expected branch. Key fields include: ① business enums / state switches (mark the value meaning + which branch this case takes); ② legal/illegal constructed fields (the positive/negative distinction, e.g. `"filterId": "{filterId_s1}"  // legal: filter_rule exists and status=0, expect persist` / `"{filterId_s2}"  // illegal: filter_rule does not exist, expect to enter invalidFilterIds`); ③ boundary-value fields (mark upper/lower/over-limit); ④ scene-difference fields (different cases take different values here to distinguish scenes); ⑤ when an array mixes legal/illegal elements, comment each element. Simple base fields (constants and path params with no scene difference) need no comment.

**Non-value assertion expression**: comparison (`utime > previous`), negation (no new record / field unchanged), range (only field X changed, the rest unchanged), existence (not empty / current millisecond), degrade (`TBD`), and other assertions that cannot be expressed as a JSON value are carried by `//` comments, written on the corresponding field line or at the start of the dimension segment.

**Engineering identifiers**: locator info in the expected-fold DB/Cache/MQ segments must use `profile.components[].fields` (default datasource / table / shardingRule / cluster / key / topic / producer) and must come from `analysis.md`; when missing, mark the segment start `TBD (engineering info missing, need to supplement {missing fields})`; inference and fabrication are forbidden.

### 1.5 Positive/negative pairing and expansion-completeness rules

This section provides three groups of common completeness rules for "expand verification points", applicable to normal/boundary/exception scenes; they must be read before expanding any coverage direction. The unified criterion of the three is **whether the expected result changes with the dimension value**: §1.5.1 "Positive/negative pairing" handles binary results — the two sides have opposite expectations and must each get a case; §1.5.2 "Expectation-differentiated expansion" handles a multi-value dimension — each value has a different expectation and must each get a case; §1.5.3 "Isomorphic-expectation convergence" handles the same logic flowing through multiple carriers — each carrier has the same expectation and must be synthesized into one case that lists them all in a data table. **First judge whether the expectation changes with the value: if it changes, split per §1.5.2; if it does not, converge per §1.5.3** — this criterion is used in scenes such as parameter validation to distinguish §1.5.2 from §1.5.3 and avoid wanting both to split and to merge.

#### 1.5.1 Positive/negative pairing

Trigger caliber (not limited to switch branches): whenever business logic has a binary result of "allow vs intercept / success vs failure / satisfy vs not satisfy / adopt vs degrade", whether the trigger factor is a gray-release switch, a degrade switch, permission, a condition branch, or **a threshold compare, consistency check, sort/prefer, or state judgment**, you must generate the positive and the negative as a pair; you must not generate only one side.

> ⚠️ Common missed-pairing scenes (historically high-miss areas; must self-check one by one):
> - **Consistency-check class**: when the source point is "Consistency check (positive/negative)", you must expand pass when consistent and fail or degrade when inconsistent; if `analysis.md §1.4` marks it as switch-affected, you must also expand the concrete behavior of skipping the check or degrading after the switch is on.
> - **Multi-effective-point switch class**: when the source point is "Multi-effective-point switch consistency", you must expand the concrete behavior when all effective, all degraded, and states are inconsistent; do not only verify the on/off two-state of a single switch.
> - **Threshold/state class**: only write "reaching the threshold fires (e.g. frozen coupons reaching 500 fire archive)" and miss the negative "not reaching the threshold does not fire".
> - **Sort/prefer class**: only write "the best candidate is selected" and miss the negative "the second-best candidate is not selected" or "when a candidate does not meet the threshold, degrade to second-best".
> - **Exception focus causing a missing positive**: an exception scene only writes "fail and intercept" and misses the corresponding "legal input succeeds and is allowed" positive; a normal scenario only writes "success" and misses the corresponding failure negative.

After pairing succeeds, both sides must obey:

1. **Assertion-dimension symmetry**: whichever dimensions the positive verified (API response, DB, Cache, page display, state linkage, etc.), the negative must also verify the reverse expectation of each corresponding dimension one by one; you must not only verify "it took the other branch" and omit associated impact. E.g. if the positive verified "the detail page shows new-logic content", the negative must verify "the detail page shows old-logic content/default"; you must not omit page verification.
2. **Negative expected results are concrete**: a negative's expected result must not only write vague descriptions such as "take the degrade branch" / "take old logic"; it must make the concrete behavior of degrade/old logic explicit (what value is returned, what the page shows, what the DB/Cache state is).
3. **Associated impact must not be omitted**: if some operation in the positive triggers downstream linkage (e.g. after write the detail page can query it, after a state change the list refreshes), the negative must verify that linkage's behavior under the reverse condition (e.g. on degrade the detail page shows default/old data; when gray release is not hit the list has no new field).
4. **Same-response contrast objects must not be omitted**: only when the same API response can return both the target object and an evidenced contrast object, and materials make clear that the new logic applies only to some objects, the verification point must assert both the target object's result and the keep-result of at least one contrast object. E.g. when the target coupon enters the unavailable zone and adds copy, also assert that an unrestricted coupon or an existing-enum coupon keeps its original availability / does not show the new copy; do not only assert the target object. This rule only completes assertion dimensions of the same verification point; it does not replace the §1.5.2.1 duty to cover independent existing branches; when the contrast object cannot be determined from materials, mark `TBD` and do not fabricate it yourself.

#### 1.5.2 Expectation-differentiated expansion

When a dimension has multiple values, combined conditions, or multiple levels, and **different conditions correspond to different expected results**, you must not cover only one of them; you must write verification points separately by different results. Multiple objects, membership changes, or time conditions are not an automatic expansion reason; this clause applies only when source materials have already made clear that they change the observable result; when the period-switch result is `TBD`, do not generate a verification point. (If conditions differ but the expectation is the same, this clause does not apply; converge into one data table per §1.5.3.) The following two situations are high-miss and must be force-expanded:

**1.5.2.1 Business effective-scope statement → other-enum-value negatives are auto-derived**

When PRD/technical design has an **effective-scope statement** such as "only effective on X business line/X scene" / "only X-type coupons are supported", besides verifying the positive of the target dimension value (new logic takes effect), you must cover the other known enum values of that dimension one by one and verify "new logic does not take effect, existing behavior stays unchanged". The enum-value list comes from business-line/scene field values in the technical design (e.g. `skuBizType`, `orderBizType`, `sceneCode`, `bizType` arrays, etc.) or from the existing knowledge base; when enum values share the same expectation, you may list them row by row in the same verification point's data table; only when the decision branch, expected result, or entry differs do you split into independent verification points. When you cannot enumerate all enum values, mark that case's expectation `TBD` and register it in the `analysis.md §1.6` consistency check. E.g. "only online-SKU coupons write the fixed-price field" must add the negative "in-person coupon / marketplace coupon / gift-pack coupon passed in does not write that field".

If materials did not write "only X takes effect", but `analysis.md §1.2` already recorded keep-or-isolate behavior of an existing value at the same decision entry per the new-enum rule, then add only one corresponding verification point for that already-registered existing value; the "expand every remaining enum value one by one" requirement does not apply.

**1.5.2.2 Multi-level dimension expansion for sort/prefer logic**

When business logic involves "pick the best / sort / prefer / hit priority", you must not cover only the first-level sort dimension; you must explicitly expand **all sort dimensions** (secondary and last-level compares when the primary dimension is equal). For each secondary dimension, you must construct one case where "multiple candidates are all equal on every parent dimension and only this level decides the winner", to verify that this level truly takes effect — otherwise whether the secondary dimension takes effect cannot be verified. E.g. if the sort rule is "amount desc > threshold asc > end-time asc", besides a case with different amounts, you must also construct "same amount, decided by threshold" and "same amount and threshold, decided by end time". When the technical design did not write all sort dimensions, mark that case's expectation `TBD` and register it in the `analysis.md §1.6` consistency check; do not default to stopping at the first level.

#### 1.5.3 Isomorphic-expectation convergence — prevent over-expanding by physical carrier

The expansion unit is a "logic unit", not a "physical carrier". A logic unit is one business rule / one shared decision logic / one catch exception branch; a physical carrier is the API call site, request field, value enum, copy variant, exception type, etc. that carries that logic. **When the same logic unit flows through multiple physical carriers and each carrier's expected result is the same**, generate only one primary verification point and converge those carriers into that verification point with a parameterized data table or an "involved APIs/fields list", rather than making one case per carrier count — the data table lists every carrier row by row, coverage is not lost, and it is not amplified into duplicates. (If some carrier's expectation differs from the others, that carrier is a §1.5.2 differentiation item and becomes its own case.)

The following three situations are high-over-expansion areas and must converge by logic unit:

1. **The same switch/shared decision flows through multiple APIs** → one verification point + an involved-API list. E.g. a degrade switch's on/off two-state is shared by five APIs; produce only one "switch two-state" case, list the five API entries, not five cases.
2. **The same parameter-validation segment covers multiple fields/multiple illegal values** → one case carries them with a data table; do not make one case per "each field × each illegal value" (consistent with Step 2 aggregation Rule 3; this clause produces at that grain from the expansion source).
3. **Multiple copy variants of the same display** → one copy-matrix verification point lists them all in a data table; do not make one case per copy.
4. **Same-expectation data variants inside the same module and the same verification unit** → one verification point lists different values in a parameterized data table; only when a value changes the expected result or the decision branch do you split per §1.5.2. Isomorphic data variants across different modules are not converged in this section; they are left to Step 3 global second-pass dedup.

> ⚠️ **Convergence boundary**: only converge repeats of the "same logic unit" on multiple carriers; the criterion is whether the verification goal is the same. Different verification goals belong to different logic units and each becomes its own case — that is legitimate expansion of §1.5.1/§1.5.2 and this clause does not apply — e.g. "coupon-config status validation" and "coupon-redeem status validation" are not merged even if both call a status API.

### 1.6 Normal-scenario design principles

Organize cases by a complete business flow; parameters use real business-semantic values; establish a complete before → after state assertion.

**Assertion-dimension selection rules**: select by actual behavior per the table below; any involved dimension must be asserted; uninvolved ones are not written.

| Assertion dimension | Trigger scene | Verification focus |
| ------------------- | ------------- | ------------------ |
| API response | Required for all server scenes | Status code is correct; response body is asserted field by field per the response structure (SERVER cases write it into the expected fold; see §1.4.1) |
| Database | The API has a write (add/update/delete); or a read API can build a "response field → DB table field" mapping | Write: target field values persist correctly, related-table data is consistent, no extra field is modified; Read: each response field value matches the corresponding DB field one by one |
| Cache | Scenes with cache-update logic after a write, or cache-query scenes | After write, cache value matches DB; when a read API hits cache, the returned value is correct |
| MQ message | Scenes that send a message after a successful operation (e.g. a state-change notify) | The message was sent, Topic is correct, key message-body fields match the business request |
| Downstream call | Scenes where the API internally calls an external service | The downstream was called correctly, request matches expectation (may verify via Mock-framework captured call records) |
| State transition | Scenes where the operation triggers a business-object state change | Before/after states match the state-machine definition; no intermediate state remains |
| Data consistency | Scenes involving multi-table writes or read/write split | Primary/replica data is consistent; multi-table related-field correspondence is correct |
| Page display | Required for all client scenes | The page renders normally; key copy, images, and buttons display correctly; no white screen / garbled text / layout shift |
| Data echo | Scenes where the page must show backend-returned data after the operation | Displayed content matches the API response; old data or cached data is not shown |
| Form submit | Scenes where the user fills a form and submits | Submit params match user input; after success the page state updates correctly (e.g. jump, Toast) |
| Page jump | Scenes where the operation triggers a route jump or page navigation | The target page is correct, carried params are complete, and after return the original page state is not lost |
| List and pagination | Scenes where the page includes list display or paginated load | List data matches the API response; pagination / pull-up load appends correctly; no duplicate or miss |
| State linkage | Scenes where multiple in-page components must sync-update state after the operation | Related component states refresh in sync; no local not-updated or state inconsistency |
| Permission control | Scenes where the page includes an action entry shown/hidden by permission | When privileged the entry is visible and operable; when unprivileged the entry is hidden or grayed and cannot be bypassed |
| Local storage | Scenes where the operation writes Cookie, LocalStorage, or an App local DB | Written content is correct; read can restore correctly; other business data is not affected |

### 1.7 Boundary-scenario design principles

A boundary scene means the input is at a legal-range extreme (min, max, just reaching the cap, etc.) and business logic should execute normally rather than error. The core distinction from an exception scene: **a boundary scene's input is legal and the expected result is success**; an exception scene's input is illegal and the expected result is validation failure.

**Identification source**: extract quantity limits, amount thresholds, time windows, string-length caps, and other constraints from `analysis.md §1.2` acceptance rules; each constraint's extreme is one boundary scene.

**Design points**:

- Verify whether business logic executes correctly at the extreme (not misjudged as illegal input)
- Assertion results match the business semantics of the boundary value (e.g. "just meeting the threshold" should fire the offer; "just reaching the cap quantity" should process the full set)
- The boundary value and the over-boundary value (max+1) should be designed separately: the former belongs to a boundary scene, the latter to an exception scene

### 1.8 Exception-scenario design principles

Expansion specs for each exception type: server → §2, client → §3.

**Common constraints for all exception scenes**: must verify the system returns an explicit error code and error message; returning an NPE/500 stack is forbidden; exception input must not trigger business-logic execution and must not produce dirty data.

---

### 1.9 Scene-case structure spec

> **Core principle**: a scene case is the default choice; a single-API case is the exception. Whenever there is a natural business series, generate a scene case.

#### 1.9.1 Identification and judgment (ownership is in test-design-guide.md; not repeated here)

> 🧭 **Duty boundary**: **identification** of a flow scene (two-step identification: business understanding + completing the `analysis.md` §1.4 API call chain) and **scene vs single-API judgment rules** are a test-design-phase duty; the authoritative spec is `test-design-guide.md §1 "scene-case identification"`; in the design.md phase, flow scenes have already been identified and independently produced as `#### [Flow-XXX E2E]` modules. This section (§1.9) only specifies the **case-design-phase structure spec** for a flow scene — i.e. after obtaining the already-fixed API sequence inside a flow module, how to expand it into one structurally compliant scene case (step table, data passing, Mock, assertions).

#### 1.9.2 Scene-case structure spec

**File naming**: a scene case's domain and flow name should express full-flow semantics.

```
[{businessDomain}-{fullProcessName}] {scenario}-{goal}
```

Examples:
- `[Coupon-coupon lifecycle] happy path-create to delete full-flow status correct.md`
- `[Order-checkout delivery E2E] happy path-order to delivered status flow.md`

**Step-table structure**: step writing differs by caseType — a UI case writes only user-view operations; a SERVER case writes `→ trigger call`; inter-step data dependencies are passed via placeholders.

**SERVER scene-case example** (no corresponding page; call the API directly):

```markdown
| # | Step | Expected |
|---|------|----------|
| 1 | → trigger call `createCoupon`, request/expected see 3. Request and Assertions | ▸ API response `createCoupon`: `code`=0, `couponId`={couponId}<br>▸ DB `coupon`: added 1 row, `status`=DRAFT<br>See chapter 3 |
| 2 | → trigger call `updateCoupon`, request/expected see 3. Request and Assertions (couponId takes step 1 return) | ▸ API response `updateCoupon`: `code`=0<br>▸ DB `coupon`: `amount` updated, other fields unchanged<br>See chapter 3 |
| 3 | → trigger call `onlineCoupon`, request/expected see 3. Request and Assertions | ▸ API response `onlineCoupon`: `code`=0<br>▸ DB `coupon`: `status`=ONLINE<br>See chapter 3 |
| 4 | → trigger call `offlineCoupon`, request/expected see 3. Request and Assertions | ▸ API response `offlineCoupon`: `code`=0<br>▸ DB `coupon`: `status`=OFFLINE<br>See chapter 3 |
| 5 | → trigger call `deleteCoupon`, request/expected see 3. Request and Assertions | ▸ API response `deleteCoupon`: `code`=0<br>▸ DB `coupon`: record deleted or `status`=DELETED<br>See chapter 3 |
```

**UI scene-case example** (has a corresponding page; fires from the page):

```markdown
| # | Step | Expected |
|---|------|----------|
| 1 | Enter the coupon-admin page, fill coupon info, then click the "Create" button | ▸ UI: Toast "Created successfully", list adds 1 row<br>▸ API response `createCoupon`: `code`=0, `couponId`={couponId}<br>▸ DB `coupon`: added 1 row, `status`=DRAFT<br>See chapter 3 |
| 2 | In the coupon list, click the "Online" button | ▸ UI: status column becomes "Online"<br>▸ API response `onlineCoupon`: `code`=0<br>▸ DB `coupon`: `status`=ONLINE<br>See chapter 3 |
```

**Inter-step data-passing rules**:

- ID-class fields returned by a prior API (e.g. `couponId`, `orderId`) are noted in later steps' operation description as "take step N return"
- In 3. Request and Assertions, later steps' request JSON keep that field as `{placeholder}` and note the source step in a comment
- When `testdata-generation` backfills placeholders, fill in step order to keep the dependency correct

**Mock handling rules**:

- In a scene case, **real data produced by a prior API call does not need Mock** (e.g. after step 1 creates a coupon, when step 2 modifies the coupon the coupon already exists for real; no need to Mock a coupon-query downstream)
- Mock only third-party downstream dependencies outside the flow scene
- If some step in the scene needs to Mock a downstream, declare it separately in that step's corresponding 1. Prerequisites Mock block

**Assertion strategy**:

- Every step must assert the API response and key DB state
- The final step additionally asserts terminal-state completeness of the whole lifecycle (e.g. query after delete returns empty; the final state matches the state-machine definition)
- Middle-step assertions focus on "whether this step's change persisted correctly, and whether other fields were not changed by mistake"

---

## 2. Server testing

On top of the common normal/exception/boundary scene framework, this chapter adds server-specific verification logic (data integrity, consistency, parameter validation, downstream/internal exceptions, concurrency, messages, degrade/gray release, etc.), organized in the three classes **normal scenario / boundary scenario / exception scenario**.

### 2.1 Normal scenario

#### 2.1.1 Data integrity

| Scene | Test point | Verification item |
| ----- | ---------- | ----------------- |
| DB master-table field persist | After a successful write, query DB directly | Each business field's value, type, and precision were written correctly |
| DB related-table consistency | Involves multi-table writes (master+detail, master+relation) | All related tables were written correctly; FK / related-ID correspondence is correct |
| DB update-scope convergence | After an update, query DB directly | Only target fields were modified; other field values are unchanged |
| Cache sync | After a write completes, read cache | Cache is updated, value matches DB, no dirty read; if it is a delete, the cache key is already invalid |
| MQ message send | After a write completes, query the message platform | The message was sent; Topic and message-body fields match expectation |

#### 2.1.2 Data consistency

| Scene | Test point | Verification item |
| ----- | ---------- | ----------------- |
| Read-after-write consistency | After a successful write, read via a query API | Returned data matches the write request; old values are not returned |
| DB primary/replica consistency | After a write, read data from the replica | Primary/replica sync finished; replica data matches primary; no old value returned because of delay |
| Cache vs DB consistency | After a write, read cache and DB separately | Cache value matches DB value; no dirty cache; after a delete the cache key is already invalid |
| Consistency after cache breakdown | Fire a read after cache expiry | After back-to-source DB the cache is rebuilt; returned value matches DB; no empty-value cache appears |
| Read-after-concurrent-write consistency | Read immediately after concurrent writes | Read the correct final written value; no intermediate state or old value appears |

#### 2.1.3 Degrade and gray-release testing

| Scene | Test point | Verification item |
| ----- | ---------- | ----------------- |
| Config-switch degrade | Config service turns the feature switch off | Take the degrade branch; do not execute incremental feature logic; the API returns the concrete degrade-state value; related pages/downstreams show the concrete post-degrade content (follow §1.5 positive/negative pairing rules) |
| Circuit-break degrade | Trigger the circuit-break threshold (error rate over limit) | Circuit break takes effect, returns the concrete fallback value, logs an alert; related pages show fallback content |
| Gray release | Gray-release flag hit / not hit | Hit takes new logic, returns the new-version response, related pages show new-logic content; not hit takes old logic, returns the old-version response, related pages show old-logic content; new and old logic are independent and do not affect each other |
| AB Experiment | Hit control group / experiment group | Hit takes new logic, returns the new-version response, related pages show new-logic content; not hit takes old logic, returns the old-version response, related pages show old-logic content; control group and experiment group are independent and do not affect each other |

> ⚠️ Degrade/gray-release scenes must obey §1.5 positive/negative pairing rules: assertion dimensions of the positive (hit/on) and the negative (not hit/off) must be symmetric; the negative must not omit associated-impact verification (e.g. detail page, list, state linkage).

### 2.2 Boundary scenario

| Parameter type | Test point | Expected result |
| -------------- | ---------- | --------------- |
| Numeric range | Min, max (legal-range extremes) | Business logic executes normally and returns success; assertion results match boundary-value semantics |
| int/long extremes | Pass `Integer.MAX_VALUE`, `Long.MAX_VALUE` | Boundary values are handled normally; no numeric truncation or overflow exception |
| String length | Exactly the max length | Written normally, not truncated |
| List array count | Exactly the cap count | Full set processed successfully; result is complete |
| Pagination params | pageSize is exactly the max allowed value | Returned normally, not truncated |
| State boundary | The business object is at a state critical point (just meeting the threshold, just expiring, just reaching the max count, and other legal extremes) | Business logic executes normally and returns success; assertion results match state-boundary semantics (e.g. "just meeting the threshold" should fire the offer) |

### 2.3 Exception scenario

> ⚠️ **Change-relevance gate for technical-attribute verification points**: **technical-attribute verification points** are verification points that are not produced directly by this feature change but attach to inherent technical characteristics of the system, such as concurrency conflict (§2.3.4), message duplicate consume / out-of-order (§2.3.5), amount precision, idempotent, transaction consistency, etc. Such verification points may be expanded only when they satisfy either of the following; if neither is satisfied they are not generated, and unchanged existing capabilities must not be extra-tested by default:
>
> - **Requirement basis**: PRD, technical design, or `analysis.md §1.2` acceptance rules explicitly involve the scene corresponding to that technical characteristic;
> - **Change basis**: `analysis.md §1.3` impact-surface inference identified that this change reached the execution path corresponding to that technical characteristic (e.g. concurrent write, message-driven, amount calculation, unique-key write, cross-service transaction).
>
> Pre-exclusion: if `analysis.md §1.1` responsibility ownership already judged that capability **depends on external (downstream / middleware) rather than being implemented at this layer**, then even if the conditions above hold, this layer only verifies interaction and degrade and does not extra-test that technical attribute.
>
> The generation basis for parameter validation, downstream exception, and internal exception is judged in the design phase by `test-design-guide.md §1.2`; this phase only expands points design.md already listed, and reconfirms exception branches materials make explicit. When design basis or material branches are missing, do not default-add the API's inherent parameter validation, downstream faults, or infrastructure exceptions.

#### 2.3.1 Parameter validation

**Requiredness validation**

| Parameter type | Test point | Expected result |
| -------------- | ---------- | --------------- |
| Required field | Field missing, value is null | Validation fails, returns an explicit error message |
| Required string | Pass empty string `""`, whitespace-only `" "` | Validation fails, returns an explicit error message |
| Required array/object | Pass `[]`, `{}`, or null | Validation fails, returns an explicit error message |

**Data-type validation**

| Parameter type | Test point | Expected result |
| -------------- | ---------- | --------------- |
| Numeric field | Expect int/long but pass a string (e.g. `"abc"`) | Type mismatch, returns an explicit error message, does not throw a deserialize exception |
| Float field | Expect decimal but pass a string (e.g. `"1.5CNY"`) | Type mismatch, returns an explicit error message |
| Date/time field | Incorrect format (e.g. `"2026/01/01"`, `"20260101"`) | Validation fails, returns an explicit error message |
| Enum field | Pass an illegal enum value | Validation fails; do not silently fall back to default |
| Boolean field | Pass strings `"true"`, `"false"`, `"1"` | Make explicit whether string conversion is supported; if not, return an explicit error message |

**Data-range validation (illegal values)**

| Parameter type | Test point | Expected result |
| -------------- | ---------- | --------------- |
| Numeric range | Min-1, max+1 (outside the legal range) | Validation fails, does not enter business logic |
| int/long extremes | Pass `Integer.MAX_VALUE + 1`, `Long.MAX_VALUE + 1` | On overflow, validation fails; no numeric truncation or exception |
| String length | Exceed the max length | Validation fails; do not allow write after truncation |
| List array count | Exceed the cap (e.g. pass 21 when limited to 20) | Over-limit validation fails, returns an explicit tip, does not partially process |
| Pagination params | pageSize passed as 0, a negative, or a huge value (e.g. 10000) | 0/negative validation fails; a huge value is truncated to the max allowed or validation fails |

**Special-value validation**

| Parameter type | Test point | Expected result |
| -------------- | ---------- | --------------- |
| Numeric field | Pass `0`, a negative | Validate per business rules; when not allowed, return an explicit error message |
| String field | Pass `null`, `"null"`, `""`, `" "` | Handle them distinctly; do not treat the string `"null"` as empty |
| Boolean field | Pass `"true"`, `"false"` strings | Make explicit whether supported; if not, return an explicit error message |
| Array field | Pass `[]` empty array | Validate per business rules; when not allowed, return an explicit error message |
| ID field | Pass `0`, a negative, mixed letters, an overlong ID | Validation fails; leaking a database exception is forbidden |

**Business-logic validation**

| Parameter type | Test point | Expected result |
| -------------- | ---------- | --------------- |
| Amount logic | Offer amount ≥ threshold amount | Validation fails, returns an explicit business error message, does not persist |
| Time logic | End time ≤ start time | Validation fails, tips that the time range is illegal |
| Quantity logic | Used quantity > total quantity | Validation fails, tips that the quantity relation is illegal |
| Related resource | Reference a resource ID that does not exist or was deleted | Validation fails, explicitly tips that the resource does not exist |

**Quadrant combinations of fund-loss decision fields in Map / complex-object request (mandatory expansion)**

> **Trigger condition**: when an API request contains a Map-typed or complex-object-typed field (e.g. `giftCouponMap`, `subsidyItemMap`) and its inner fields participate in a **fund-loss-related decision** such as "whether to allow / whether to refund / whether to issue / whether to deduct", you must not only do a coarse empty / non-empty binary check of the whole Map; you must expand **quadrant combinations for every key field that participates in the decision**, each combination as an independent verification point, with a concrete expected result (refundable / not refundable, how much to refund, allow / intercept).

| Expansion dimension | Test point | Expected result |
| ------------------- | ---------- | --------------- |
| Single-field value quadrant | For each key field, construct `0 / non-0 / empty / missing / type exception` separately | Make the fund-loss decision result of that value explicit one by one; do not silently fall back |
| Multi-field combination quadrant | Cartesian combination of multiple key fields that participate in the same decision (e.g. `receiveUserId ∈ {0,non-0}` × `receiveCouponId ∈ {0,non-0}` four quadrants) | Independently assert each combination's allow/intercept result; do not merge into one sentence "params illegal" |
| Ownership consistency | A key ID does not belong to the current context (e.g. `couponId` does not belong to this `outerCodes` coupon pack) | Not refundable / not allowed; do not operate someone else's resource by mistake |
| Degrade fallback path | Some detail item in the Map is empty but the whole is non-empty (e.g. `couponGiftDetail` is empty) | Make the degrade-judgment basis explicit (e.g. switch to judging by user-coupon status); do not depend on a missing map item |

> ⚠️ This class of API is a high fund-loss area (wrong refund / missed refund / wrong deduct); missing quadrant combinations directly cause fund-loss negatives to be missed. Each quadrant combination must also complete the corresponding positive per §1.5 positive/negative pairing rules.

#### 2.3.2 Downstream-exception testing

> **Mock-analysis trigger condition**: only when design.md has already listed a "Downstream exception" point, generate Mock cases for the new downstreams that point involves; normal scenarios are not Mocked and are designed on the real chain. A new RPC call may be used as a design-phase identification basis; an HTTP downstream does not auto-generate exception Mocks merely because it is new — expand only when §1.2 makes its exception handling explicit and design.md has already listed the point. Existing downstreams likewise expand only when §1 has a downstream-exception point.
>
> **Mock info source**: downstream serviceId and API info in Mock cases all come from the `api-details.md` `## New downstream services` chapter (location path: H3 serviceId → H4 methodName); do not infer them yourself. Mock exception responses are mutated from the complete JSON in the corresponding downstream's normal-response `<details>` block in `api-details.md` (e.g. change code to non-0, empty data, delayed return).

| Test point | Scene | Verification item |
| ---------- | ----- | ----------------- |
| Mock downstream response delay exceeding the timeout threshold | Downstream service timeout | Verify the current service handles it correctly and returns a reasonable result; verify an idempotent API may retry and a non-idempotent API does not auto-retry; logs record exception details |
| Mock downstream throwing Exception | Downstream service response exception | Verify the current service handles it correctly and returns a reasonable result; verify an idempotent API may retry and a non-idempotent API does not auto-retry; logs record exception details |
| Mock downstream returning a business error code | Downstream service response error | Verify the current service handles the business error correctly and does not throw an exception directly |
| Mock downstream service completely unreachable | Downstream service unavailable | Verify whether the degrade policy fires (return default / cache value / degrade error code) and does not block the main flow |
| Mock downstream returning an empty object, empty array, missing key field, or missing array count | Returned-data format/structure exception | Verify exception intercept takes effect and later flow is interrupted; do not throw NPE; logs record exception details |
| Mock downstream returning a negative amount, create time greater than end time, returned data inconsistent with the request, etc. | Returned-data logic exception | Verify the exception logic is recognized and intercepted and later flow is interrupted; do not write bad data into DB; logs record exception details |

#### 2.3.3 Internal-exception testing

| Test point | Scene | Verification item |
| ---------- | ----- | ----------------- |
| Mock a DB operation throwing an exception (connection timeout, deadlock, unique-key conflict, etc.) | Database operation exception | Verify the transaction rolls back correctly and produces no dirty data; return an explicit error message; logs record exception details |
| Mock acquiring a distributed lock failing or lock timeout | Concurrent-lock exception | Verify that on lock failure an explicit error message is returned and later writes do not continue; no duplicate data write appears |
| Construct a request that triggers a business-rule conflict (e.g. illegal state-machine jump, repeat operation) | Business-logic exception | Verify business-rule validation takes effect and returns an explicit error code; do not modify existing data state |
| Mock an internal method returning an empty object, empty array, or missing key field | Internal-method returned-data format/structure exception | Verify exception intercept takes effect and later flow is interrupted; do not throw NPE; logs record exception details |
| Mock an internal method returning a negative amount, illegal time range, data inconsistent with context, etc. | Internal-method returned-data logic exception | Verify the exception logic is recognized and intercepted and later flow is interrupted; do not write bad data into DB; logs record exception details |
| A middle-step exception triggers rollback | Transaction rollback | All already-executed DB data is fully rolled back, with no dirty-data residue; neither Cache nor MQ messages were produced |

#### 2.3.4 Concurrency testing

| Scene | Test point | Verification item |
| ----- | ---------- | ----------------- |
| Concurrent-write unique-key conflict | Concurrently submit create requests with the same business unique key | Eventually only one record persists; the other requests return an explicit business error code and do not leak a DB exception |
| Concurrent deduct of a finite resource | Fire N deduct requests concurrently against inventory, balance, or quota (N > remaining) | Final deducted total does not exceed the initial value, is not negative; extra requests return an insufficient-inventory error |
| Concurrent update of the same record | Concurrently update the same record carrying an old version (optimistic-lock scene) | Only one request succeeds; the others return a version-conflict error; no silent overwrite or data mess |
| Concurrent trigger of a distributed lock | Concurrently trigger an operation that has a distributed lock | Lock mutex takes effect; later requests wait or fail fast; business data is not written in duplicate |

#### 2.3.5 Message-exception testing

| Scene | Test point | Verification item |
| ----- | ---------- | ----------------- |
| Message-body format/structure exception | Construct a message body that is an empty object, empty array, missing a key field, type-mismatched, etc. | Consume logic is interrupted and later business is not executed; do not throw NPE; logs record exception details |
| Message-body business-logic exception | Construct a message body that does not match business logic (e.g. negative amount, create time > end time, negative inventory) | Exception logic is recognized and intercepted and later flow is interrupted; do not write bad data into DB; logs record exception details |
| Message duplicate consume | Resend the same message in a short time (same msgId/business unique key) | Idempotent handling takes effect; business logic is not executed in duplicate; no duplicate data is produced |
| Message out-of-order consume | Construct out-of-order messages (e.g. state-change messages out of order, issueCoupon and use-coupon out of order, use-coupon and refund-coupon out of order) | The system correctly handles a missing prior event; state transitions are not messed up; no intermediate-state data remains |

---

## 3. Client testing

Client testing is split into Web and App. On top of the common normal/exception scene framework it adds customized or client-specific verification logic, organized in the three classes **normal scenario / boundary scenario / exception scenario**.

### 3.1 Web testing

#### 3.1.1 Normal scenario

| Interaction item | Test point | Expected result |
| ---------------- | ---------- | --------------- |
| List pagination | Page jump, page-size switch | Jump is correct, page-size switch takes effect, data matches the API response |
| Search/filter | Query with multiple filter conditions combined; clear all filter conditions | Combined result is accurate; after clear, full-set data display is restored |
| Dialog/drawer | Open, close, trigger a second-confirm dialog | Each overlay's state is independent and does not pollute the others |
| Form reset | Fill a form, click cancel or back, then open again | The form restores the initial state and does not keep the last filled content |
| Async load | Fire a data request and observe loading and loaded UI | Loading state displays correctly; after success data renders normally |
| Permission isolation | A privileged user accesses a protected page or action button | The action button displays normally and is operable |

#### 3.1.2 Boundary scenario

| Display scene | Test point | Expected result |
| ------------- | ---------- | --------------- |
| Long text | Title/description content exceeds the display-area max length | Overlong content is truncated; tooltip or expand can view the full text |
| Empty state | List query result is empty | Show an empty-state illustration and guide copy; do not show a blank page |

#### 3.1.3 Exception scenario

| Config item / interaction item | Test point | Expected result |
| ------------------------------ | ---------- | --------------- |
| Required field not configured | Required items are empty on submit | Frontend validation tips; empty data is forbidden from submitting to the backend |
| Numeric out of range | Enter a numeric value outside the allowed range | Real-time validation tips; the value is auto-truncated or input is blocked |
| Time-logic error | Start time > end time | Validation errors; save is not allowed |
| Image/file format | Upload an illegal-format or over-size file | Explicitly tip file type/size requirements; do not upload |
| Rich text/URL | Rich text containing script injection, illegal URL | Filter or tip; do not render executable content |
| Async load failure | API request returns an error or a network exception | Show an explicit error-tip message and provide a retry entry |
| Permission isolation | An unprivileged user accesses a protected page or action button | The action button is not shown; directly visiting a protected URL should redirect |

### 3.2 App testing

#### 3.2.1 Normal scenario

| Flow type | Test point |
| --------- | ---------- |
| Core main flow | The complete path from entry to finish; verify each step's jump and data passing are correct |
| Multi-entry | Enter the same feature from different entries (home/search/push); the result is consistent |
| Interrupt-resume | After leaving midway (switch to background, take a call) and re-entering, data is not lost and state restores correctly |
| Forward/back | Multi-level page back; verify the page stack is correct and no white screen or data mess appears |
| Share and jump | A share link/QR code launches the App; landing-page data matches the shared content |

#### 3.2.2 Boundary scenario

| Test item | Test point | Expected result |
| --------- | ---------- | --------------- |
| First-screen load | Core-page cold-start load time | Normal network < 2s; weak-network 3G < 5s |
| Skeleton/Loading | Page state while an async data request has not returned | Show a skeleton or Loading placeholder; a direct white screen is forbidden |
| Keyboard occlusion | Soft keyboard pops when an input is focused | The soft keyboard does not cover the input area; the page auto-shifts up |
| Landscape/portrait switch | Rotate the device during use | Layout adapts; content is not truncated or overlapped |
| Dark mode | Page display after the system switches to dark mode | Text/background contrast meets the bar; icons/images are recognizable on dark |

#### 3.2.3 Exception scenario

| Scene | Test point | Expected result |
| ----- | ---------- | --------------- |
| Weak network | Fire a business request on a 2G/3G network | After request timeout, give an explicit tip and provide a retry button |
| Offline | Operate the page after fully disconnecting the network | Show cached data (if any), or explicitly tip no network; do not crash |
| Network switch | Operate the business while switching Wi-Fi ↔ mobile data | Switch does not crash; after auto-reconnect the business can continue normally |
| Gesture operations | Swipe, long-press, double-tap, and other gesture interactions | Do not conflict with system gestures; response is snappy with no jank |

#### 3.2.4 Compatibility

| Dimension | Coverage |
| --------- | -------- |
| iOS version | Latest + latest-2 (e.g. 18 / 17 / 16) |
| Android version | Android 12 / 13 / 14, mainstream vendors (Huawei/Xiaomi/OPPO) |
| Screen resolution | Small (5.5") / standard (6.1") / large (6.7"+) / foldable |
| App version | Current version, latest gray-release version; data compatibility after an old version upgrades |
