# Test Design Spec

> ⚙️ **Reading convention**: Quote blocks in this spec marked ⚙️ "generation action" are checks/completions that must be executed during test design; **their content is not written into the design.md artifact**. Only tables/structures defined by "Output format" are design.md chapter content.

**Output**: `usecases/testdocs/design.md` (test design plan)

**Input dependencies**:
- `usecases/testdocs/analysis.md` (requirement analysis report, §1.1~§1.6)
- Knowledge base (optional; all available knowledge-base paths for this run are passed in conditionally; retrieve business rules/entity dependencies from them and use as needed)

**Chapter structure**:

```
§1 Test design
   1.1 Design inputs
   1.2 Point-identification rules
   1.3 Call-chain scene identification
   1.4 Business-knowledge enhancement (conditional)
   1.5 Server vs client judgment
   1.6 Output format
       1.6.1 Feature modules (non-E2E)
       1.6.2 Flow modules (E2E, independent blocks)
       1.6.3 Common output requirements (shared by both module types)
   1.7 Generation-action checks (not written into the artifact)
§2 Test data inventory
   2.1 Identification rules (two steps)
   2.2 Business-dependency completion (conditional)
   2.3 Output format
§3 Test regression (conditional: appended by step 3 when a local knowledge base is configured and there are change points that need redesign)
   3.1 Generation conditions and inputs
   3.2 Regression-convergence logic
   3.3 Output format
```

---

## §1 Test design

Based on the analysis output in `analysis.md`, identify the test points that need verification for each module. **List only points plus their design rationale and verification summary; do not enumerate concrete cases** — expansion details are executed in phase 3 per `case-authoring-rules.md`.

**Duty**: turn analysis output (change points, rules, API characteristics, call chains) into test points — tell phase 3 "which points you should expand cases toward".

> Graphic-display boundary: `design.md` keeps only auditable text and tables; do not embed Mermaid or images. After R2 passes, the main agent immediately generates a "test design diagram" and a "test-data entity-relation diagram" using this file's §1/§2/§3 as the only input, and renders them in the conversation for user confirm; diagrams are not a new design source and must not contain information that does not exist in the text artifact.

### 1.1 Design inputs

| Input source | Role |
| ------------ | ---- |
| §1.2 Requirement change analysis | Split modules (change-point tables grouped by module), identify the core driver of test points (change content decides operation nature), add boundary and constraint points (numeric/state constraints in acceptance rules drive boundary scenes) |
| §1.3 Technical implementation analysis | Confirm which module an API belongs to; API characteristics help judge point applicability; constraints in implementation logic drive exception scenes |
| §1.4 Call-chain analysis | Drive API-sequence orchestration for scene cases |
| §1.5 Risk points | Points corresponding to P0 risks must be included |

### 1.2 Point-identification rules

Starting from the operation nature of each change point C-x, identify points that need verification by the rules below. Only hit points appear in the output; unhit points are not listed and need no exclusion evidence.

> ⚠️ **Point identification always centers on this change**: in the "involves / has XX" column of "Operation nature" below, the criterion is always that **this change (C-x) actually reached XX** — i.e. `analysis.md §1.2 / §1.3` impact-surface inference confirmed this change modified that write path / state transition / downstream call / concurrent write / transaction / message consume, etc., not that "the API statically has that characteristic". Existing capabilities the API already had but this change did not modify are not used to identify points, avoiding generalized extra-testing of unchanged existing behavior from the source. This constraint applies to every row in the full table.
>
> ⚠️ **Cross-layer independent identification**: if the same business rule affects UI, API contract, and server execution constraints at the same time, list each layer's verification points separately. Correct page display cannot replace API fields, error codes, or permission results; a correct API response cannot replace persistence, state, or intercept results. Only when materials explicitly say a layer was not affected do you omit that layer's points.
>
> ⚠️ **Classifying complex conditions**: multiple objects, combined conditions, membership changes, or time semantics themselves do not add test points. Only when `analysis.md §1.2` has already made clear that different conditions correspond to different observable results, first classify by result into existing normal/exception scenes; if the difference shows up as a state result, state legality, or a critical condition, then add state-boundary or state-exception points; for an explicit time window or threshold, then add parameter/state boundary-value points. Do not split when conditions are the same or the result is unspecified; do not generate a point when the period-switch result is `TBD`.
>
> ⚠️ **Compatibility/isolation design for new enums**: only when `analysis.md §1.2` has already recorded different results for the new value vs an evidenced existing value at the same decision entry, design both sides using existing normal/exception scenes or effective-scope negative cases; if results are the same, converge with a parameterized data table. Do not extra-test all historical business lines just because of a "new enum".

**Server point-identification rules**:

| Changed operation nature | Point | Design focus |
| ------------------------ | ----- | ------------ |
| Involves write (DB/Cache/MQ) | Data integrity | Master-table persist, related-table consistency, cache sync, MQ message send |
| Involves multi-source writes (multi-table, Cache+DB, read/write split) | Data consistency | Read-after-write consistency, primary/replica consistency, Cache vs DB consistency |
| Involves config switches or circuit-break policy | Degrade / circuit break | Behavior difference when the switch is on/off |
| Involves gray release or AB Experiment | Gray release / Experiment grouping | Behavior difference when hit / not hit |
| §1.2 acceptance rules contain an effective-scope statement "only effective for X business line/type/scene" | Effective-scope negative case | Target value takes the new logic; each other known enum value verifies the new logic does not take effect and existing behavior stays unchanged |
| §1.4 registers same-name-field consistency constraints across stages/APIs | Consistency check (positive/negative) | Pass when consistent; fail or degrade when inconsistent; when affected by a switch, verify the check policy after the switch is on |
| §1.4 registers multi-effective-point switch inconsistency | Multi-effective-point switch consistency | Explicit fallback or actual behavior when all effective, all degraded, and states are inconsistent |
| §1.2 acceptance rules have numeric-range, length, quantity, etc. constraints | Parameter boundary values | Legal extremes that equal or just exceed the constraint boundary |
| §1.2 acceptance rules have a state machine, threshold condition, or count limit | State boundary values | State critical points that just meet / just miss the threshold |
| This change adds or modifies request params, or §1.2 acceptance rules explicitly require parameter validation | Parameter validation | Expand only evidenced requiredness, type, range, special-value, and business-logic checks |
| This change adds or modifies state-transition logic, or §1.2 has an explicit state-exception branch | State exception | Illegal jump, repeat operation |
| This change adds or modifies auth logic, or §1.2 has explicit permission constraints | Permission exception | Over-privilege, unprivileged access |
| Involves a write with a business unique key | Idempotent / resubmit | Resubmit with the same unique key |
| Involves shared-resource contention (inventory/balance/quota/distributed lock) | Concurrency conflict | Unique-key conflict, deduct contention, optimistic lock, distributed lock |
| This change adds or modifies a downstream RPC call, or §1.2 explicitly handles a downstream exception (HTTP downstreams are triggered only by the latter) | Downstream exception | Expand only timeout, response-exception, or unreachable branches that materials make explicit |
| This change directly modifies this-layer internal exception handling, or §1.2 explicitly handles an internal exception | Internal exception | DB exception, lock exception, internal-method exception related to this change |
| Involves a cross-service write or multi-step transaction | Transaction consistency | Rollback completeness when a middle step fails |
| Involves MQ consume logic | Message exception | Format exception, duplicate consume, out-of-order consume |

**Client point-identification rules** (apply only when the client itself changed, or an API change causes an observable display change on the client):

| Changed operation nature | Point | Design focus |
| ------------------------ | ----- | ------------ |
| Involves list/dialog/async load | Page interaction | Pagination, search/filter, dialog interaction, async loading state |
| Involves permission-control logic | Permission isolation (positive+negative) | Privileged access succeeds + unprivileged access is blocked |
| Involves page jump / multi-entry | User flow | Core flow, multi-entry, interrupt-resume |
| Involves share / outbound jump | Share and jump | Share-link launch, landing-page data consistency |
| Involves long text / list / empty-state display | Polymorphic / boundary display | Truncation, empty state, skeleton |
| Involves a new page / input / gesture interaction | User experience | First-screen load, dark mode, keyboard occlusion |
| Involves input form / file upload | Config error | Illegal input, format error, over-limit |
| Involves a network-request change | Network and fault tolerance | Weak network, offline, network switch |
| Involves a new page or UI-layout change | Compatibility | Multi-device, multi-resolution, multi-OS version |

### 1.3 Call-chain scene identification (this section is the authoritative spec for flow identification; case-authoring-rules.md cites it)

> **Positioning**: Identifying a "flow scene" and deciding its owning unit is a test-design-phase duty, including whether the flow holds, the module scope involved, and the API call sequence — all decided in this phase. case-authoring-rules.md does not re-identify; it only expands verification-point content inside an already-decided flow unit.
> **Overall principle**: whenever APIs have a natural business series (full lifecycle, full business flow), default to identifying them as one flow scene, preferred over single-API point design.

**Two-step identification**:

- **Step 1 (business understanding, from analysis.md as a whole)**: Combine `analysis.md` to identify a full lifecycle (state transitions of the same business object from create to terminal state) or a multi-step business flow (multiple APIs together complete one end-to-end goal; a prior API's output is a later API's input, including multi-role collaboration scenes). Each flow scene corresponds to one business goal and is named with a readable business-semantic name.

  | Typical example | Business goal |
  | --------------- | ------------- |
  | Coupon-config lifecycle | Create coupon → modify → online → offline → delete |
  | User-coupon lifecycle | issueCoupon → validate coupon → use coupon → refund coupon |
  | Checkout with coupon | Get available coupons → compute threshold → pre-use coupon → confirm use → use-coupon callback |
  | Cancel and refund coupon | Order cancel → batch refund coupon → coupon-status restore |
  | Payment flow | Create order → start pay → pay callback → query result |
  | Review flow | Submit review → approve/reject → status-change notify |

- **Step 2 (complete the API sequence from `analysis.md` §1.4 API call chain)**: For each flow scene identified in Step 1, complete the concrete API sequence from `analysis.md` §1.4 (in call order); independent chains in §1.4 that cannot be classified into any already-identified scene are added as new flow scenes.

**Judgment rules: scene case vs single API**:

| Judgment dimension | Flow scene (default) | Single API (exception) |
| ------------------ | -------------------- | ---------------------- |
| Whether APIs have data dependency | Yes (a prior API produces a later API's request) | No |
| Whether the business goal needs multiple steps | Yes | No; one step is enough to verify |
| Whether either of the two identification steps is hit | Yes | No |
| Typical applicable scenes | Happy-path main flow, lifecycle verification, cross-service integration chain | Parameter-validation exceptions, concurrency conflict, MQ consume, cron jobs, and other exception scenes that cannot be chained |

> ⚠️ **Exception scenes are not forced into a chain**: parameter validation, downstream timeout, concurrency conflict, message exception, etc., because of special trigger methods (Mock injection, concurrency construction, etc.), belong to their owning single-API module and are not forcibly edited into a flow scene.

**Owning output of a flow scene**:

- Each identified flow scene **must be output as an independent module**, with module-title format `#### [Flow-{businessDomain}{fullProcessName} E2E]` (e.g. `#### [Flow-coupon lifecycle E2E]`), in parallel with ordinary modules split by feature.
- Inside a flow module, list only one "flow scene" verification-point row; its "Covered APIs" column fills the full API sequence this flow chains (joined in call order with ` → `).
- Why an independent block: phase-3 case design dispatches subagents in parallel at the **module grain** of design.md §1; after a flow scene is an independent block, a dedicated subagent expands inside the flow unit, avoiding each feature-module subagent guessing a cross-module flow and duplicating or missing it.
- For APIs covered by a flow module, their **happy-path main flow** is no longer listed again as an independent normal-scenario point in each feature module (exceptions/boundaries still stay in the feature module as needed).

### 1.4 Knowledge supplement (conditional)

This section runs after finishing scene and point identification in §1.1~§1.3. Wiki knowledge bases and changed-interface knowledge have different duties and are used per 1.4.1 and 1.4.2 respectively; neither may override conclusions already decided by PRD, technical design, or `analysis.md`.

#### 1.4.1 Wiki knowledge base: supplement business rules

Run only when a Wiki knowledge base is passed in. Filter relevant content per library from all passed-in Wiki knowledge bases; do not read whole documents; take only business knowledge (scenes, rules, constraints, exception states, etc.). Use API names, field names, business entities, and flow names in `analysis.md` as keywords and search hit paragraphs in each `cachePath`; a library that hits a keyword is relevant and its hit paragraphs are read; a library that hits no keyword is irrelevant and is skipped.

The Wiki knowledge base is used to check business gaps in existing points and to supplement points that design rules cannot derive, that source materials did not cover, and that are necessary in the business; it does not replace the main design-rule flow of §1.1~§1.3. Only when hit content is directly related to this change may you supplement per the table below:

| Point category | Business content supplemented from the Wiki knowledge base |
| -------------- | ---------------------------------------------------------- |
| Flow scene | The full business flow this change step belongs to, plus other flows that have upstream/downstream / association with the changed API; confirm the full chain is included; supplement cross-flow impact as a new flow scene |
| Normal scenario | The concrete correct result this operation should produce in the business: which business fields, flags, or states need to be checked per business rules, not only "persist succeeded" or "call succeeded" |
| Boundary scenario | Business-rule constraints source materials did not write, such as quantity caps, count limits, stack or mutex rules, turned into boundary/constraint points |
| Exception scenario | Business-state exceptions that need domain knowledge to recognize, such as the object already invalid, state not satisfied, intercepted by a business rule; distinguished from technical-state exceptions already covered by design rules |

> ⛔ **Enhancement boundary**: supplement only business knowledge directly related to this change; scenes, rules, or exceptions in the knowledge base that this change did not touch are not included; when knowledge-base info contradicts conclusions already decided by PRD, technical design, or `analysis.md`, follow the source materials and existing conclusions.

#### 1.4.2 Changed-interface knowledge: land existing points

Run only when `changed-interface-knowledge.json` is passed in. First locate same-API body fragments by the changed APIs and change anchors in `analysis.md §1.3`; use them only when the body explicitly relates to that anchor and §1 already has a corresponding new-feature point. Document titles, API names, empty `documents`, or fragments that only describe existing business must not be used as design basis.

| Knowledge content | Design info that may be landed | Write location | Must not be used for |
| ----------------- | ------------------------------ | -------------- | -------------------- |
| Response fields, persist fields, Cache/MQ side effects, or page-observable locations | Concrete assertion objects, fields, and side-effect locations | The corresponding point's "Verification summary" / "Covered APIs" | Adding success/failure expectations or changing existing expectations |
| Prerequisite entities, config, state, or call prep | Construction order, dependency relations, and config prep | §2 Entity inventory, the corresponding point's "Verification summary" | Adding scenes, entities, or business rules because of an existing flow |
| API call order or in-API execution location | Trigger location of an existing flow/API point | An existing flow point's "Covered APIs" / "Verification summary" | Creating a new flow module or treating an existing caller as a new-feature entry |

Body fragments that only describe existing scenes, old rules, old error codes, other business-line behavior, or are unrelated to the change anchor are not written into §1/§2; §3 regression-convergence logic judges them separately. When using this knowledge to supplement content, note `changed-interface knowledge: {document source}` in the corresponding point's "Design rationale"; if the body only states an implementation location and does not state an observable result or prerequisite dependency, do not write it into design.md.

### 1.5 Server vs client judgment

For each module, decide which points to identify by these rules:

- **Server points only**: no corresponding page, or the core result cannot be observed on a page (pure backend state change, DB/Cache write with no page presentation, MQ consume, cron jobs, etc.).
- **Client points only**: no server change; only the client itself changed (new page, new interaction, UI-logic change, etc.).
- **Both needed**: there is a server change, and the client itself changed or an API change causes an observable display change on the client.

### 1.6 Output format

§1 output modules are of **two types**; their title formats, examples, and constraints differ, see 1.6.1 / 1.6.2 respectively; common output requirements shared by both types are in 1.6.3.

- **Feature module** `#### [Module name]`: carries single-API/client normal, boundary, and exception scenes (**no flow scene**).
- **Flow module** `#### [Flow-{businessDomain}{fullProcessName} E2E]`: carries one cross-API chained flow scene, **as an independent block**.

#### 1.6.1 Feature modules (non-E2E)

Ordinary modules split by feature; inside the block list only this module's single-API verification points and client verification points; category values are normal scenario / boundary scenario / exception scenario. ⛔ **Must not** have a "flow scene" row inside a feature module — flows always become independent 1.6.2 flow modules.

#### [Module name]

{Full module overview: state this module's business object of this change, the change action, key rules/conditions, and the expected business result; do not write only the module name or "verify XX feature". This overview will be used as the module description in the human-confirm test-design diagram.}

| Category | Verification point | Design rationale | Verification summary | Covered APIs | Source |
| -------- | ------------------ | ---------------- | -------------------- | ------------ | ------ |
| Normal scenario | Data integrity | The new write involves multi-table persist; need to verify data correctness | XX table and YY table persist correctly | `batchGrantCoupon` | Change point: C-1 request adds count field |
| Boundary scenario | Parameter boundary values | Amount and quantity have explicit upper-bound constraints; need to verify boundary behavior | Amount exactly 500 / over 501; quantity exactly 10 / over 11 | `batchGrantCoupon` | Rule: BR-2 amount cap 500, BR-3 quantity no more than 10 |
| Exception scenario | Idempotent / resubmit | The issueCoupon API has a business unique-key constraint; need to verify resubmit is blocked | Resubmit with the same unique key is blocked | `batchGrantCoupon` | Rule: TR-1 consumer-side idempotent dedup |
| Exception scenario | Downstream exception | Newly calls the inventory service; need to verify behavior when downstream is unavailable | Timeout, response exception, unreachable | `batchGrantCoupon` | Change point: C-3 newly calls the inventory service |
| Normal scenario | Page interaction | New coupon-list page; need to verify list-interaction completeness | Paginated load, list refresh | Page: coupon list page | Change point: C-2 new coupon-list page |
| Exception scenario | Compatibility | New page needs multi-end adaptation | Multi-device, multi-resolution adaptation | Page: coupon list page | Change point: C-2 new page |

#### 1.6.2 Flow modules (E2E, independent blocks)

Produced when 1.3 call-chain scene identification rules are hit; each flow is an independent block, title format `#### [Flow-{businessDomain}{fullProcessName} E2E]`; inside the block list only one "flow scene" row; the "Covered APIs" column fills the full API sequence joined in call order with ` → `. Do not produce a flow module when there is no cross-API chained scene.

> ⛔ **A flow must be an independent block and must not be mixed into a feature module**: the happy-path main flow of APIs covered by a flow module is not listed again as a feature-module normal scenario (exceptions/boundaries still stay in the feature module as needed); when phase 3 dispatches at module grain, a flow module is expanded by a dedicated subagent inside the flow unit.

#### [Flow-coupon lifecycle E2E]

{Full flow overview: make clear the flow-entry business scene, how key data/state is passed or checked across APIs, and the terminal state or observable result finally verified, e.g. "verify that in the full lifecycle from user creating a coupon through review, online, claim, and redeem, coupon status, user assets, and redeem result flow correctly in order". This overview will be used as the flow-goal description in the human-confirm test-design diagram.}

| Category | Verification point | Design rationale | Verification summary | Covered APIs | Source |
| -------- | ------------------ | ---------------- | -------------------- | ------------ | ------ |
| Flow scene | Coupon-lifecycle happy-path full flow | Coupon from create to delete involves a multi-API chain; prior output is later request; need end-to-end verification of state transitions | Create coupon → update coupon → online → offline → delete each step persists the correct status; terminal state is complete | `createCoupon` → `updateCoupon` → `onlineCoupon` → `offlineCoupon` → `deleteCoupon` | Feature point: F1 coupon-config management<br>Change point: C-1 coupon state-machine adjustment |

#### 1.6.3 Common output requirements (shared by both module types)

> - **Module title** writes only the module name; do not list feature-point / change-point / rule codes after the title; under the title, use one natural-language sentence to overview this module's coverage of this change; do not add a "test points" or similar subtitle between the title and the table
> - **Design rationale** column: in natural language write "why this direction should be tested", stating the change's nature or risk source so a reader can understand the design intent without jumping to analysis.md
> - **Verification summary** column: give the key judgment facts Phase 3 case design needs to expand cases (concrete numbers, field names, API names, error-tip copy, etc.), but do not orchestrate them as Step → Expected case steps
> - **Covered APIs** column: mark the target API this verification point will verify; it is the hard anchor of "verification point → API", used by phase-2 case expansion to locate the API and its request/response (api-details.md) directly, instead of reverse-looking up §1.2/§1.3 by source-column codes. Fill rules:
>   - **Data source**: from this verification point's source (change point C-x), go to analysis.md §1.3, find APIs whose "Related change points" contain that C-x, and fill their methodName into this column; write only the methodName (e.g. `batchGrantCoupon`), consistent with analysis.md §1.3 / api-details.md.
>   - **Flow scene (1.6.2 flow module)**: fill the API sequence this scene chains, joined in call order with ` → ` (e.g. `batchGrantCoupon → queryCouponList`), consistent with the analysis.md §1.4 API call chain.
>   - **Single-API verification point (1.6.1 feature module)**: when one verification point maps to one API, fill that API's methodName; when one C-x maps to multiple APIs and this verification point covers them at the same time, list them comma-separated.
>   - **Pure client verification point (no server API)**: fill `Page: {page name}`, with the page name consistent with the analysis.md §1.3 client page table; that page row's "Related Server APIs" can then trace the related API.
>   - **Truly no API and no page carrier** (e.g. a pure engineering-config verification point): fill `none`.
> - **Source** column: note the feature point, change point, and rule this verification point corresponds to in analysis.md, in the format `Feature point: Fx description`, `Change point: C-x description`, `Rule: BR-x/TR-x description`; different categories are line-broken with `<br>`; omit categories with no corresponding item
> - List only verification points that hit design rules and whose source is traceable — do not list points that did not hit a design rule or cannot mark a source
> - Feature-module categories are grouped as normal scenario, boundary scenario, exception scenario; the category basis matches the "Group" column of the `case-authoring-rules.md` §0 mapping table

### 1.7 Generation-action checks (not written into design.md)

> ⚙️ **Generation action (not written into design.md)**: the following are checks that must be executed after producing §1; **they are process actions only, and their content (the table below) must not be written into the design.md artifact as a chapter**. design.md §1 contains only the per-module test-point tables defined by 1.6 "Output format".
>
> After all modules are produced, run these two checks:
>
> | Check item | Method | Handling when not passed |
> | ---------- | ------ | ------------------------ |
> | Change-point full coverage | Walk every C-x in §1.2 and confirm it is referenced by at least one test point's "Source" column in some module | Trace that change point's operation nature and add points per design rules |
> | API full ownership | Walk every API in §1.3 and confirm it already belongs to some module | Add the missed API to the corresponding module or create a new module |
> | Covered APIs all marked | Walk every test point and confirm the "Covered APIs" column is filled: verification points involving a server API filled the corresponding API methodName (flow scenes fill the API sequence), pure client verification points filled `Page: {page name}`, truly no carrier filled `none`; must not be left empty | Go back to §1.3 and complete by finding APIs whose "Related change points" match this point's source C-x; if §1.3 has no corresponding API, trace whether §1.2/§1.3 extraction omitted it |
> | Covered APIs are traceable | Walk the API methodName filled in every test point's "Covered APIs" column and confirm it can be found in the §1.3 Server APIs table, and that API's "Related change points" contains this point's source C-x | If the API name does not match, change it to a methodName that truly exists in §1.3; if C-x does not match, check API ownership or trace change-point extraction |

---

## §2 Test data inventory

Based on scenes and verification points already identified in §1 test design, derive each scene's prerequisite data dependencies, and decide whether each dependency needs an Entity constructed or is passed as a request param.

### 2.1 Identification rules (two steps)

**Step 1: Identify prerequisite dependencies from §1 scenes**

For each already-planned test point in §1 (flow scene, normal scenario, boundary scenario, exception scenario), analyze one by one: **to let this scene execute, which business data must already exist in the system?**

Typical examples:
- §1 scene "user holds a coupon and queries available coupons on the checkout page" → prerequisite dependencies: user, store, already-issued coupon instance
- §1 scene "user cancels after placing an order, triggering coupon refund" → prerequisite dependencies: user, store, already-issued coupon instance, an already-created order in the target state

**Candidate classification filter (required after Step 1 and before eligibility judgment)**

First classify each prerequisite dependency into one of the rows below; only a "candidate business entity" enters Step 2. Do not treat something as an entity just because the field name contains `id`, the value comes from context, or it affects a branch judgment.

| Candidate type | Judgment criterion | Correct landing |
| -------------- | ------------------ | --------------- |
| Candidate business entity | A real business object that must already exist for the scene to execute, e.g. user, store, coupon instance, real order, SKU, selected order | Enter Step 2 eligibility; after passing, write into §2 |
| Entity construction condition | Used to constrain the state, attribute, scope, or business eligibility an entity should have, e.g. pickup / non-pickup store, normally open, paid order, new user | Do not write as a standalone entity; describe it in the entity row's "Construction conditions / business constraints" column |
| Request params / scene params | Fields the tester passes directly at call time or takes directly by scene, e.g. `clientType`, `phone`, `deliveryType`, enums, operation type, fixed flags, custom numbers, and IDs used only for query/routing/association | Do not write §2; write directly into request params or scene conditions. Only when the real object corresponding to that ID must be pre-created and its state/relations affect the scene, enter entity judgment as that object |
| Context carrier | request context, thread local, call-chain context, session, pass-through map, and other non-independent business objects | Do not write §2; write into request params, 1. Prerequisites, or engineering notes per the actual source |
| Config / env prerequisites | Config service / gray-release / Experiment switches, Mock, env vars, rule config, cache switches, or states the tester can set directly | Do not write §2; write into the corresponding point's "Verification summary"; when generating cases, land them in "1. Prerequisites - Config service/Experiment config, Mock, or env prep" |

> ⛔ **Forbidden mis-identification**: pickup/non-pickup, order status, user type, etc. are entity construction conditions, not entities; `orderId` enters §2 as an "order" entity only when a real business flow must create the order and the order status/amount/relations will affect the test result; otherwise it is only a request param or a context association value. Config service, gray-release switches, Experiment groups, Mock, env vars, fixed rule config, and engineering identifiers are not business-data entities even if they have a key/value or structured look; context must not be disguised as an entity node.

**Step 2: Entity eligibility and prerequisite split**

Only for items classified as "candidate business entity", check the three eligibility gates in order: is it a real business object that must already exist; is its identifier generated by the system; can the tester not decide or temporarily set that identifier/value. **All three must be satisfied** for it to be an Entity; if any is not satisfied, it must not be written into §2.

**Judgment examples**:

| Prerequisite dependency | Handling | Reason |
| ----------------------- | -------- | ------ |
| User | Construct Entity, identifier `{userId}` | A real user must exist in the system; the ID is system-generated |
| Already-issued coupon instance | Construct Entity, identifier `{couponId}` | Need to issueCoupon in advance; the coupon ID is system-generated |
| Pickup store | Construction condition of a "store" Entity | Pickup is a store attribute, not an independent entity |
| Paid order | Construct an "order" Entity, condition "paid" | The order must be pre-created and order status affects the scene result |
| `orderId` used only for query | Request param | Does not require pre-creating an order or depending on order status |
| `clientType` / `phone` / `deliveryType` | Request param | Passed directly at call time; not a pre-existing business object |
| request context / thread local | Context carrier | Not an independently constructible business object |
| Config service / gray-release switch / Experiment grouping | Config/env prerequisite | The tester can set it directly; do not write §2 |

### 2.2 Business-dependency completion (conditional: run when a knowledge base or changed-interface knowledge is passed in)

> **Retrieve from passed-in knowledge sources**: Wiki knowledge bases are filtered per library, not read whole; take only **business-dependency relations among entities**; changed-interface knowledge only supplements already-explicit prerequisite dependencies.
> - **Take keywords**: use **entity names** already in the inventory as keywords (e.g. `coupon instance`, `campaign`, `user account`).
> - **Grep per library**: search this set of entity names in each passed-in knowledge base's `cachePath` file; a hit library is relevant — read its hit paragraphs for that entity's upstream prerequisite dependencies; a library with no hits is irrelevant — skip and do not read.

After Step 1 and Step 2, read entity-dependency info from the knowledge base, compare it with entities already in the inventory, and complete **upstream prerequisite dependencies** that design derivation may have missed: for each entity in the inventory, look up the prerequisite entities that must exist first in the business — if a prerequisite entity is necessary for the scene to execute but is not in the inventory, add it to the inventory.

> ⛔ **Completion boundary**: a knowledge base may cover entity relations of the whole business domain; supplement only prerequisite business entities that are **directly related to scenes already identified in §1 and that pass the three 2.1 eligibility gates**; do not extend to uninvolved scenes; do not add Config service/Experiment/gray-release/Mock/env config from the knowledge base into the entity inventory; existing scenes in changed-interface knowledge must not be used as a basis for adding entities; when they contradict §1 scene-derivation conclusions, follow §1

### 2.3 Output format

| Entity | Identifier | Construction conditions / business constraints | Mutex conditions | Dependency | Related scenes (from §1) |
| ------ | ---------- | ---------------------------------------------- | ---------------- | ---------- | ------------------------ |
| User | `{userId}` | Can normally participate in the target business | none | none (base entity) | All scenes |
| Store | `{storeId}` | Pickup; normally open; inside the target business scope | Do not merge with "non-pickup store" | none (base entity) | Pickup-store scenes |
| Store | `{storeId}` | Non-pickup; normally open; inside the target business scope | Do not merge with "pickup store" | none (base entity) | Non-pickup-store scenes |
| Coupon instance | `{couponId}` | Already issued and satisfies the target coupon state | none | Depends on: user, store | Checkout with coupon, cancel and refund coupon |
| Order | `{orderId}` | Created by the above user and store; status is paid | Do not merge with unpaid/canceled orders | Depends on: user, store, coupon instance | Cancel and refund coupon |

> **3-axis uniqueness and merge rules**: each row is uniquely determined by "Entity + Construction conditions / business constraints + Mutex conditions" together. Merge only when all three are the same and the dependency is consistent; if any differs (e.g. pickup vs non-pickup, paid vs unpaid, different user eligibility) it must be a separate row. Identifier placeholders only express a system-generated entity identifier; they must not encode construction conditions, business meaning, sequence numbers, or construction method, e.g. `{storeId_pickup}` and `{orderId_paid}` are forbidden; only when the same case truly needs multiple entities of the same kind at the same time may you distinguish with `{storeId_1}` / `{storeId_2}`, and explain each in the "Construction conditions / business constraints" column.

> **Dependency** column notes: mark the prerequisite entities that must exist first in the business (upstream dependencies); base entities with no prerequisite write "none (base entity)". This column makes entity construction order explicit — depended-on entities must be constructed before the depender.

> This inventory is the data-construction basis for phase-3 case generation:
> - Entity rows in the case 1. Prerequisites "test data" table must and can only come from this inventory, and inherit that row's identifier, Construction conditions / business constraints, and mutex conditions; Config service/gray-release/Experiment, Mock, env vars, context, and directly settable states must be written into the corresponding request params, 1. Prerequisites, or 4. Engineering Info, and must not be filled into the test-data table;
> - In the engineering-info request JSON, whenever a field value depends on some Entity in this inventory (e.g. `couponId`, `storeId`), fill that field with the corresponding identifier placeholder; whenever a field value is determined directly by scene semantics (e.g. `clientType`, `phone`, `deliveryType`, enums, operation type, custom numbers, fixed flags, etc.), fill the concrete value directly. Construction conditions and mutex conditions may only be written as natural language into §2 and the case "data requirements" column; do not stuff them into placeholders.

### 2.4 Snapshot persist (mandatory exit action)

After the §2.3 output format is written into design.md, **immediately** use the Write tool to copy the markdown original of the §2 "Test data inventory" chapter (from the `## §2 Test data inventory` heading to the end of §2, including the 2.3 output table + 2.1/2.2 notes) as-is to `{snapshotDir}/init_design_data.md`, as the later design-compare baseline of "design first-edition entity plan". `snapshotDir` is passed explicitly by the dispatch prompt (the `usecases/testdocs/snapshots/` subdirectory of the shared working directory).

⛔ Strictly forbidden to modify, compress, or structurally transform the §2 markdown in any way (do not convert to JSON, do not extract fields, do not normalize entity names). Later compare analyzes the markdown table directly. This action is a mandatory subagent exit and cannot be omitted.

> **Read-only constraint**: once generated, `init_design_data.md` is a read-only snapshot used as the baseline for later diff compare. Any later change flow (including design rerun, plan redo, human adjustment, etc.) must not modify that file; if a design snapshot needs to be regenerated, create a new init file (e.g. `init_design_data_v2.md`) or a new planId batch, rather than overwriting the original file.

### 2.5 Final snapshot (persist after human confirm)

After R2 review-fix + human confirm pass (the user explicitly confirms design.md, before entering phase 3), the main agent **immediately** uses the Write tool to copy the current markdown original of design.md §2 (same cut range as 2.4) as-is to `{snapshotDir}/final_design_data.md`, as the "design final entity plan" baseline, paired with `init_design_data.md` for later design compare of "pre/post design entity consistency" (init/final entity-type intersection / final entity-type count).

- Persist only after the first confirm; if the user later raises change comments after confirm, re-confirm does not overwrite (the final baseline is fixed to the first-confirm state).
- The same read-only constraint applies: once generated, it must not be modified.

---

## §3 Test regression (conditional generation)

§1 focuses on which test points the **new/modified features** of this change need to verify (forward verification). §3 focuses on how **existing features this change may affect** should be regressed (protection verification). Both share the same module point table — §3 regression directions appear as `Category=regression scenario` rows in the §1 same-name module point table (when §1 has no same-name module, create a same-name block at the §3 position). Output format and how phase 3 takes them over are in 3.3.

### 3.1 Generation conditions and inputs

> **Role of this phase**: changed-interface knowledge is only used to judge whether an existing scene relates to this change path or an affected resource; only after path-association evidence is formed may you design a regression item. It is not used to reinterpret PRD or supplement new-feature points.
>
> **Generation conditions**: appended by the regression-recall phase (step 3). Script-coverage conclusions are only used to judge whether reuse is possible and are not equivalent to a regression-design conclusion: when there are `partially_reusable` or `not_reusable` changed APIs, you must first finish reading the changed-interface knowledge body, then write the redesigned regression cases for those APIs; only when body reading and necessary extra lookup still cannot form an evidence closed loop may you register evidenced no-regression-plan APIs. If changed-interface knowledge is not ready, or every changed API is `reusable` and the reuse script already covers all impact points, this chapter does not exist. Coverage three-state, script-library recall, and exception extra-lookup execution details are in step 3.

**Input sources**:
- Changed-interface knowledge: change anchors and body fragments in `changed-interface-knowledge.json`; extra-lookup results when the body makes a material gap explicit
- `analysis.md` §1.2 Requirement change analysis (mark related change-point IDs when producing)
- `analysis.md` §1.3 Technical implementation analysis (API list and implementation logic)
- `analysis.md` §1.4 Call-chain analysis (call relations and impact scope)

### 3.2 Regression-convergence logic

Script-reuse three-state of regression recall, changed-interface knowledge consumption, exception extra lookup, and file/message artifacts follow `phase-2-design.md` Step 3 as the execution spec; this section defines the judgment model for regression scope. Changed-interface knowledge is organized by API; a single API body may contain a large number of business scenes and branch logic. You must not take the evidence as a whole as the regression scope; you must cross-filter by this change path — only existing features that share a code path or share an affected resource with this change are included in regression.

Convergence steps:

1. **Anchor the change path (precise to method/location grain)**: use each API's "Implementation logic", request change, and response change in `analysis.md §1.3` as location clues; read anchors and body fragments in changed-interface knowledge that correspond to the changed API; confirm each change point's concrete location: which class/method, which if/else branch, which field's assign/read, which table's which column, which cache or config. Form a "change-path set"; grain must reach methodName, field name, table.column, cache key, or config key; do not stay at the API-level grain of "some API changed". If existing materials and changed-interface knowledge cannot locate a concrete position, mark `TBD` and do not include it in path cross-match.

   > Example: if the change point is assigning a new `promoBadge` field in `assembleCouponListResponse`, the change path is `{assembleCouponListResponse, CouponView.promoBadge assign}`, not merely the `queryCouponList` API.

2. **Cross-match (judge per scene whether the execution path passes the change point)**: for each existing business scene/branch logic in the body cited by changed-interface knowledge, judge whether its actual execution path from entry to exit calls, passes, reads, or asserts a method, field, or shared resource in the "change-path set". Include only when three kinds of evidence form the closed loop "this change → shared path/resource → existing scene": change-anchor evidence states the location this change modified; existing-scene evidence states that an existing API, caller, business branch, or config scene uses that anchor; path-association evidence states why that scene would call, pass, read, or assert that anchor.

   - ✅ **Include**: the scene execution path directly calls the changed method, reads/asserts the changed field, or body evidence proves it reads/writes the same affected table, cache, or config; you must point out the concrete intersection.
   - ❌ **Exclude**: the scene only belongs to the same API, the same serviceId, a similar title, or a similar business name, but the execution path does not pass the changed method and does not involve the changed field or a shared affected resource. Request validation, route dispatch, rate limit, cache-hit judgment, downstream degrade, etc., if they execute on an independent branch before or outside the change location, are unrelated to this change.

   > ⛔ **Typical mistake**: API A has scenes such as request validation, routing, rate limit, cache, downstream call, and response assemble; when the change only modifies the response-assemble method, do not list request-validation, rate-limit, or cache scenes that do not pass that method as regression directions. "Same API" is not "shared code path".

3. **Include or exclude**:
   - The execution path intersects the change path, and you can point to a concrete method call, field read/assert, or shared-resource read/write that constitutes the intersection → include as a regression direction, and record the intersection as "Impact analysis".
   - The execution path is completely independent of the change path, even if they belong to the same API document → exclude, do not regress.

On this convergence basis, organize regression directions along these three dimensions:

1. **Direct change impact**: which other business scenes the changed method/branch still serves in the knowledge base, i.e. different call paths of the same method.
2. **Upstream/downstream association impact**: whether existing logic of the change point's upstream callers and downstream dependers depends on the pre-change API contract or behavior.
3. **Shared-resource impact**: whether other features that share a data table, cache, or config with the change point may be affected by a data-structure or write-logic change.

> ⛔ **Evidence first; do not pad dimensions**: the three dimensions are an organization and retrieval framework, not output categories that must be filled. Each regression direction's "Design rationale" and "Source" must be able to locate the change anchor, existing scene, and path association in the API business-knowledge-base body or in the full extra-lookup text triggered by a body clue; data flows not explicitly recorded must not be completed by domain common sense or code inference. When a retrieval view has no evidenced item, do not output a regression row for that view.

**Fallback for no-evidence APIs**: an empty script library, no `case_id`, a script mismatch, or not reusable can only show that the script is not reusable; it never constitutes a no-regression plan. Only after finishing per-API script-library coverage judgment, API business-knowledge-base body reading, and necessary extra lookup triggered by a body clue, and still being unable to form the evidence closed loop above, may you register a no-regression plan; do not invent regression directions, and do not silently skip. Hand that API to the main agent via the regression subagent's report message, and write it into the §3 "No-regression-plan APIs" audit list; `design.md` keeps only a refined audit summary; the complete change path, executed query, hit documents, body reading, and extra-lookup evidence must be kept per API in the subagent report for the main agent and R2 review to verify. `regression-checklist.json` only stores reusable scripts and does not carry this list. Regression output is complete only after every changed API that needs redesign has either formed a regression direction or been registered in this list.

### 3.3 Output format

> 🧭 **A regression direction = a regression-scenario row inside a module**: §3 regression directions do not get their own table; they **appear as ordinary rows in the §1 same-name module point table**, with the "Category" column filled `regression scenario` (a category in parallel with normal scenario / boundary scenario / exception scenario / flow scene), reusing §1's six-column table structure. Therefore one business module corresponds to only one `#### [Module name]` block and one point table, which contains both new-feature rows and regression-scenario rows, taken over by **the same subagent** in phase 3. Isolation of new-feature vs regression-scenario caliber (new-feature expectations come from PRD; regression expectations come from knowledge-base existing behavior) is explicitly constrained by the phase-3 dispatch prompt and does not depend on table-structure distinction (see `phase-3-cases.md` Step One). Regression cases do not participate in aggregation; inside a module you can already eliminate duplicate happy-path verification points between regression and new feature; flow scenes still become independent `#### [Flow-XXX E2E]` blocks and are dispatched separately.

How to fill a regression-scenario row: **append a regression-scenario row** to the §1 same-name module's point table; column fill is the same as §1 except two places — the "Category" column is always `regression scenario`; the "Source" column writes `Regression impact: {knowledge-base source summary}` (distinct from a new-feature row's `Change point: C-x`). If the module a regression direction belongs to does not exist in §1, create a same-name `#### [Module name]` block at the §3 position; inside it is the same six-column point table containing only regression-scenario rows.

> When "§1 has no same-name module" appears: when this change modifies a shared method/field/table column **reused across modules**, regression will affect other business modules that reused that code path but that this PRD did not involve. Those modules are not in §1 (§1 only lists feature modules newly added/modified this time), so you need to create their same-name blocks at §3 to carry regression-scenario rows. Example: the change modifies the shared response-assemble method `CouponView`; besides this time's [Coupon query] module, that method is also called by [Promo campaign] module's `queryActivityCoupons` → regression affects [Promo campaign], and §1 has no [Promo campaign] block → create `#### [Promo campaign]` at §3, whose point table contains only `regression scenario` rows.

```
#### [Module name]   ← merge with the §1 same-name module (append regression-scenario rows); if §1 has no such module, create it at §3

{One-sentence overview of this module's coverage (reuse the §1 overview when merging same-name).}

| Category | Verification point | Design rationale | Verification summary | Covered APIs | Source |
| -------- | ------------------ | ---------------- | -------------------- | ------------ | ------ |
| {§1 existing new-feature rows…… (from §1 when merging same-name; do not rewrite)} | | | | | |
| Regression scenario | {existing feature/scene that needs regression verification} | {why this feature may be affected by this change} | {the expected behavior this existing feature should keep, from knowledge-base existing behavior} | {API methodName; flow type fills the API sequence; fill `none` when there is no API carrier} | Regression impact: {summary of the knowledge-base recall fragment} |
```

> Output requirements:
> - **Module ownership**: each regression direction is classified into the corresponding module by the feature/API it involves, as a `regression scenario` row in that module's point table; existing feature modules that did not appear in §1 but are newly involved by this regression (e.g. modules affected because a changed shared method is reused by another module's API) get a same-name module created at the §3 position to carry their `regression scenario` rows.
> - **Category column is always `regression scenario`**: the phase-3 subagent uses this to recognize that the row takes the regression caliber (expectations come from knowledge-base existing behavior, do not apply PRD), and produces `category: "regression"` cases; other category rows take the new-feature caliber and produce `category: "new_feature"` cases.
> - **Verification summary / Source columns**: the verification summary writes the expected behavior this existing feature should keep (from knowledge-base existing behavior; do not write vague phrases such as "behavior unchanged"); the source column writes `Regression impact: {knowledge-base source}`, stating why this feature may be affected by this change and the knowledge-base fragment used.
> - **Covered APIs column**: fill the API methodName this regression direction actually verifies, consistent with analysis.md §1.3 / api-details.md; flow-type regression fills the API sequence (joined with ` → `); shared-resource regression with truly no API carrier fills `none`. This column is used by phase-2 regression-case expansion to locate API request/response.

After regression-scenario rows, if there are APIs whose evidence closed loop is insufficient as described in "Fallback for no-evidence APIs", append a "No-regression-plan APIs" list (omit if none). This list is for user reading and records only a conclusion summary; complete audit evidence stays in the regression subagent report and is not expanded again in design.md:

```
**No-regression-plan APIs**

> Per-API script-coverage judgment, changed-interface knowledge body reading, and one necessary extra lookup when there was an explicit material gap have been completed; none of the following APIs formed an evidenced association of "change path → existing scene", so no regression case is designed.

| API | No-regression-plan summary |
| --- | -------------------------- |
| {API methodName} | Change path: {method/field/resource}; retrieval result: {N} body docs already checked; no associated existing scene found. |
```

> ⛔ The summary may only write the three minimum pieces of information "change path + number of body docs already checked + body-check conclusion"; do not retell the retrieval process, query, document names, or extra-lookup details line by line; but that complete evidence must stay in the subagent report so review can trace per API.

**Example** (a regression-scenario row appended into the same-name §1 module `#### [Coupon query]`):

#### [Coupon query]

{……§1 existing new-feature rows……}

| Category | Verification point | Design rationale | Verification summary | Covered APIs | Source |
| -------- | ------------------ | ---------------- | -------------------- | ------------ | ------ |
| Regression scenario | Coupon-list query response assemble | Response assemble of `queryStoreCoupons` also calls the changed `CouponView` and shares that method with store-coupon query; need to regress that its original field exposure is not affected by adding `promoBadge` | Original fields returned by coupon-list query (amount, validity, etc.) keep exposing original values and are not affected by the new `promoBadge` | `queryStoreCoupons` | Regression impact: API doc `queryStoreCoupons` response-assemble sequence diagram, which shows it calls `CouponView` |
