# Stage 4-1: Three-round test-design audit and fill-in

## Minimum persist (this stage)

- File: `{run_dir}/testcase/testdocs/stage4-test-design-report.md` (in-place edits)
- File: `{run_dir}/testcase/testdocs/stage4-1-audit-receipt.md`
- Required headings: `Problem type` | `Source` | `Correction action` | `Result`

Based on the Stage 4 first-draft test design, run a three-round funnel audit in the review style of a senior business-test expert. Stage 4-1 is responsible for correcting the Stage 4 first draft into the final complete test-design set.

> Stage 4-1 is a **mandatory Plan stage** and cannot be skipped by manual mode or input gaps. Missing information can only be marked, targeted-filled, or escalated to a human per this file and [knowledge-adapter.md](knowledge-adapter.md); you must not treat the Stage 4 first draft directly as formal test-plan input.

## Reading guide

First read the audit principles and termination conditions, then Loop 1 / Loop 2 / Loop 3 in order, and finally the post-audit report and quality self-check list.

## Inputs

> Before this stage starts, first confirm `run_dir` is available per [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" (userConfig.runDir → user-specified path → this Skill's initialized default directory). Do not perform any read or write before confirmation.

- Stage 1 output: `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md` (function list, business rules, technical objects, API objects, data objects, dependency objects, analytics-event / UI content list, business-diagram list, pending-clarification items)
- Stage 2 output: `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md` (impact scope, high-risk items, change-chain verification scenarios, optional local-pack fill-in information)
- Stage 3 output: `{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md` (if already executed, used for coverage-status check)
- Stage 4 output: `{run_dir}/testcase/testdocs/stage4-test-design-report.md` (test objects, model products, first-draft test scenarios, Priority basis)

## Outputs

- Pin-edit `{run_dir}/testcase/testdocs/stage4-test-design-report.md` in place (scenario corrections, write-back columns, Priority). The "corrected report" below always means that file after the audit completes.
- Write `{run_dir}/testcase/testdocs/stage4-1-audit-receipt.md` with the audit-diff trail (`Problem type` / `Source` / `Correction action` / `Result`) plus Loop 1–3 tables and ID mapping. `close_stage.py --stage 4-1` and the stage5 gate require this file.
- Write server-scenario trigger-source information back to the Stage 4 report, and write app/web scenario page-ownership information back to the same report; do not produce a separate write-back artifact.

The Stage 4 first draft does not keep an independent copy. The receipt is the change trail; humans calibrate from it. The corrected Stage 4 report is the baseline for later plan integration and case generation.

### In-place pinpoint-edit execution (mandatory)

1. **Only pinpoint edit is allowed**: every audit correction must apply a precise text replacement (edit tool) to the hit scenario row / field / chapter; do not rewrite the whole file; do not "read in → change → write back in full" — write amplification is the pipeline's largest time source, and this rule is the root fix.
2. **Edit-failure fallback**: when precise match fails, re-read the target region's original text (including a few context lines), confirm the current state, and try once more; if it still fails, register a TBD item (Handling column mark "edit failed, escalate to human") and do not degrade to a full rewrite.
3. **Post-edit consistency review (mandatory)**: after all pinpoint edits complete, you must fully re-read the edited report once and confirm: ① no ambiguity (the corrected wording is semantically consistent with the context); ② no duplication (no leftover old-and-new copies of the same content); ③ no context contradiction (ID references, field conventions, and cross-chapter references were not broken by a local edit). When an anomaly is found, fix it on the spot and re-check that item.
4. **Placement convention**: write the audit-diff summary (Loop 1–3 tables and ID mapping) only to `stage4-1-audit-receipt.md`. TBD items, the server-side contract-information summary, and write-back appended columns stay at the established chapter / table end inside the Stage 4 report; do not copy the audit-diff back into that report.

---

## Audit principles

1. Run the three audit rounds from coarse to fine: first find gaps, then correct deviations, and finally check executability item by item.
2. When the audit finds a gap, you must go back to the Stage 4 test-design methodology to fill it: expand by the input-output model, state-machine model, cause-effect graph model, and sequence / call-chain model, then merge per the scenario-fusion rules.
3. Do not fill pure launch-assurance, ops-assurance, or capacity-assurance items into test scenarios; only content that changes API return, data state, business rules, error code, idempotent result, downstream-consume result, or page-visibility result enters the corrected scenario table.
4. Stage 4-1 may correct Stage 4 scenarios, model products, Priority basis, coverage status, and Preconditions; it must not invent requirements, APIs, fields, or dependencies.
5. The report must keep the Stage 4 scenario-table format and field definitions, and reserve write-back slots for server trigger-source information, app/web page-ownership information, and diagram links. Write-back slot notes: the Stage 4 scenario table itself does not have these columns; when writing back, **append columns** at the end of the scenario table — "trigger-source information" (server fills API / service information; web/app page-ownership information is written into this column first, see the write-back requirements below) and "diagram link"; appended columns appear in the same table as the original columns; do not build a separate table.

---

## Audit termination conditions (mandatory)

The three audit rounds run in order, but **they are not a fixed flow that must always run to the end** — judge termination before each round ends, to avoid spinning on a target whose "information never existed":

**Round-advance criteria** (evaluate at the end of each of Loop 1/2/3):

1. **Structural issues are zero + every remaining gap is the "information does not exist" type** → terminate the audit. Move every remaining gap into TBD items (Handling column uniformly mark "pending clarification, information does not exist") and do not enter the next round. Judgment standard: the gap's source information (PRD / technical design / optional local pack) was already searched in Stage 1/2 with no result, or it is a known gap already released in the clarification stage.
2. **A new structural issue is found** (missing scenario, wrong split, Priority trigger condition hit, missing write-back field) → continue to the next round.
3. **All three rounds completed and there is no structural issue** → converge normally and exit.

**Known-gap list**: pending-clarification items marked in Stage 1/2 form a "known-gap list" when entering Stage 4-1 (list item by item: source, gap field, release reason). Gaps hit during the audit are first checked against this list: a hit on a known gap is marked "pending clarification, information does not exist" directly; it does not trigger fill-in retrieval, does not count toward fill-in times, and does not block round advance.

**Count fixes and gaps separately**: the audit summary must count "fixed item count" (structural-issue corrections) and "known-gap item count" (information does not exist) separately; do not merge them into "handled N items" — the two are different in nature, and merging would distort governance data (treating unfixable items as fixed).

---


## Loop 1: Coverage completeness and knowledge fill-in

Goal: confirm whether content that should be tested in the PRD, technical design, requirement analysis, and impact scope has already entered the test design.

### 1.1 Coverage mapping

Map the following sources item by item. Mapping results fall into three classes: **covered** (has a corresponding scenario ID), **not applicable** (clearly state why not applicable, e.g. explicitly OutScope or only belongs to launch / ops / capacity assurance), **missing** (trigger 1.2 fill-in or mark pending clarification). Every "not applicable" and "missing" source item must be recorded in the audit summary's "Coverage-mapping results" table; "covered" items record the mapping between the source item and the scenario ID, for later stages to look up.

| Source | Must-check content | Audit action |
|------|---------|---------|
| Stage 1 function list | Business functions, business rules, role permissions, states, time, configuration, effective scope, client-type candidates | Confirm each InScope function has scenario coverage, a final client-type decision, or is marked pending clarification |
| Stage 1 technical objects | API contract, business orchestration, rule adjudication, dependency interaction, data transformation, data read/write, switch / experiment business semantics, client-type calibration, verification surface | Confirm each technical object that changes a business result has a model product or scenario, and the client type and verification surface have been calibrated; or mark pending clarification |
| Stage 1 analytics-event / UI content list | Analytics-event IDs (mv/mc/pv), page-display changes, interaction changes, client type | Confirm each analytics-event ID and UI change point has a corresponding visibility / analytics-event scenario or is marked pending clarification; when client type is web/app expand standard scenarios; when server keep source-text-level visibility scenarios; when unknown mark pending clarification |
| Stage 2 impact scope | Direct impact, indirect impact, data-consistency checkpoints, high-risk items | Confirm the corresponding scenario or verification point is covered, or mark pending clarification |
| Stage 2 change chain | Chain from the changed API to the downstream verification API | Confirm it lands as a scenario-chain candidate |
| Stage 3 recall results | reuse, change, new conclusions | Confirm coverage status is consistent with the change suggestion |

### 1.2 Missing-item knowledge fill-in

This stage only handles objects confirmed as gaps in the audit. Unified reuse, receipts, and decision trails follow [knowledge-adapter.md](knowledge-adapter.md); do not rerun Stages 1–4, and do not shrink the three-round audit because of missing information.

When a test item is missing or information is incomplete, first judge whether it can be filled from **already-persisted inputs and prior reports** (and the local pack already provided at initialization):

| Missing type | Fill-in target |
|---------|---------|
| Incomplete API reference | serviceId, protocol type (HTTP/Thrift/InternalRPC), interface/class, method, url, request method |
| Incomplete parameters | Request-parameter JSON template, response fields, error codes, state enums |
| Incomplete dependency | Downstream service, return semantics, empty / failure / timeout / partial-success results |
| Incomplete scenario chain | Downstream verification API, consume relationship, explicit parameter-pass relationship (including field name and type); when a cross-system field type is inconsistent, mark the risk in TBD items |
| Incomplete MQ / job / config | topic, message body, consumer serviceId, JobScheduler job and serviceId, Config Key, config-owning serviceId, config meaning |
| Incomplete page ownership | app/web page name, page path / route, entry, action controls, page-level permission / visibility, page-level verification focuses |

Execution rules:

1. First check whether Stage 1/2/4 artifacts already searched this object.
2. If it was already searched and there was no result, do not search again; keep `---` and enter TBD items.
3. If it was not searched before, only targeted-fill the current gap in testdocs and the optional pack; do not open a new external retrieval.
4. Mark successfully filled content's source as "prior report / local knowledge pack"; fill failed content as `---`; do not invent.
5. **Fill-in count cap**: this round's targeted fill-in covers at most 8 objects; remaining gaps are no longer searched; fill `---` directly, enter TBD items, and mark "fill-in exceeded limit, escalate to human".

---

## Loop 2: Split-dimension precision audit

Goal: confirm the test-design items are split on the correct dimensions: neither missing a key branch nor over-fragmented.

### 2.1 Cell-by-cell check of split dimensions

For each technical object that changes a business result, **check cell by cell** its existing scenarios (including model products) against the dimensions in the table below: each dimension cell is marked as one of two states, "has scenario (scenario ID) / not applicable (reason)"; leaving it blank and skipping is not allowed. An object with an "empty cell" (neither a scenario nor a not-applicable reason) must go back to the Stage 4 methodology to fill the corresponding scenario, or give a clear not-applicable reason. Record the check results in the audit summary's "Dimension-check results" table (record only objects that had empty cells and their fill-in actions; do not list objects that all hit).

| Object type | Correct split dimensions |
|---------|-------------|
| Business process | state × event × Preconditions × exception interrupt point × time-window boundary (before-effective / in-effect / expired / critical point) |
| Rule adjudication | condition combination × Priority × mutual exclusion × default / unknown branch |
| API contract | required / optional × legal / illegal × boundary value × error code × response wrapping |
| Dependency interaction | success-nonempty × success-empty × failure × timeout × illegal response × partial success |
| Data transformation | source field × target field × default value × enum mapping × precision / unit |
| Data read/write | write result × idempotent result × consistency × duplicate consume × concurrency conflict |
| Scenario chain | step order × artifact consume relationship × downstream verification point × cross-system field contract (field name + type consistent) |

### 2.2 Correction actions

- Split: when one large scenario swallows multiple independent business results, split it into multiple scenarios.
- Merge: when multiple scenarios have highly consistent Preconditions, trigger, and expectation, fuse per [scene-fusion.md](scene-fusion.md).
- De-noise: delete content that only belongs to launch assurance, ops assurance, or capacity assurance; it does not enter the corrected scenario table.
- Priority correction: inherit the Stage 4 first-draft Priority; correct only when the following trigger conditions hit, and record the raise/lower magnitude and evidence in the audit summary:
  1. A Stage 2 high-risk item (or data-consistency checkpoint) clearly mismatches the first-draft Priority (e.g. the scenario corresponding to a high-risk item is only P2/P3);
  2. A defect-pattern trigger condition in the requirements or local pack is hit, but the first draft did not raise Priority per the adjudication rules;
  3. The historical Priority of an existing case recalled in Stage 3 seriously diverges from the first draft (a gap of two levels or more), and after verification the existing case is not outdated.
  - When no trigger condition hits, do not modify the first-draft Priority; the first draft is the final Priority. After correction, form the corrected scenario table's "final Priority" and "Priority basis" per the Stage 4 Priority-adjudication logic.

---

## Loop 3: Correctness and executability audit

Goal: confirm each test-design point can support later trigger-source write-back and case expansion.

Check the corrected scenarios item by item:

| Check item | Pass standard |
|-------|---------|
| Test point | In one sentence, say clearly the business rule, server-side result, or visibility result being verified, and write the corresponding client type; do not end vaguely with "normal" or "etc." |
| Preconditions | Write the key data states of user, store, product, coupon, order, configuration, time, dependency return, etc. |
| Verification point | Contains an assertable field, status, amount, error code, persist result, or downstream pass-through result |
| Related TO | Relate only TOs in the same module; split a cross-module chain into steps; do not re-aggregate across modules |
| Priority | Explicitly the corrected final Priority; source is the Stage 4 first draft or this stage's audit correction |
| Priority basis | Explain the source of the final Priority and the correction reason; the basis is traceable |
| Coverage status | Consistent with the Stage 3 recall conclusion; fill "new" if Stage 3 did not run |
| Placeholders | Every `---` has a TBD note and is not guessed by later consumers |

---

## Post-audit report requirements

The post-audit report reuses the original chapter structure and scenario-table fields of `stage4-test-design-report.md` and carries the corrected final complete test-design set directly on the original file (in-place pinpoint edit; see the execution method in the "Outputs" section). The scenario table's "Priority" column carries the final Priority (Stage 4 first draft or audit-corrected value); the "Priority basis" column is updated in sync.

### Corrected-scenario ID rules

- After the audit completes, you must re-number continuously in the final scenario-table order (in-place edit of that file's scenario table); the format remains `S-01, S-02...S-N`.
- Do not use derived IDs such as `S-07a`, `S-07-1`, `S-new`; do not duplicate, skip numbers, or reuse a deleted scenario ID and leave a hole.
- When splitting a scenario, the split scenarios get new continuous IDs in the corrected final order; when merging scenarios, keep only the merged scenario's new ID.
- To keep provenance, every split, merge, delete, and re-number relation must be recorded in the audit summary's "ID mapping" table.

Write `{run_dir}/testcase/testdocs/stage4-1-audit-receipt.md` with this trail. Do not append this summary to the Stage 4 report.

```markdown
## Stage 4-1 three-round audit summary

### Loop 1 coverage-mapping results
| Source | Source item | Mapping result | Corresponding scenario ID | Notes |
|------|--------|---------|-------------|------|

(Record full information only for "not applicable" and "missing" items; "covered" items may be summarized by source as a short table of the form "function list 12 items all covered, corresponding S-01~S-18")

### Loop 1 coverage completeness and knowledge fill-in
| Problem type | Source | Correction action | Result |
|---------|------|---------|------|

(The "Result" column has two classes: `fixed` (structural issue already corrected) / `known gap` (information does not exist, moved to TBD items); do not merge the counts)

### Loop 2 dimension-check results
| Object | Empty-cell dimension | Judgment | Fill-in action | Post-fill scenario ID |
|------|---------|------|---------|---------------|

(Record only objects that had empty cells)

### Loop 2 split-dimension precision
| Original scenario | Problem | Correction action | Corrected scenario |
|-------|------|---------|-----------|

### Loop 2 Priority correction
| Scenario ID | First-draft Priority | Final Priority | Trigger condition | Evidence |
|---------|-----------|-----------|---------|------|

(When there is no Priority correction, output "This stage has no Priority correction")

### ID mapping
| Stage 4 original scenario ID | Corrected scenario ID | Change type | Notes |
|------------------|---------------|---------|------|

### Loop 3 correctness and executability
| Scenario ID | Problem | Correction action | Passed |
|---------|------|---------|---------|
```

Loop 4 write-back, TBD items, and the server-side contract-information summary stay on the Stage 4 report (in-place append). Do not require a Loop 4 body in the receipt.

### Loop 4 client-type information write-back

Write-back rules:

1. Write trigger-source information back for server scenarios.
2. Write page-ownership information and diagram links back for app/web scenarios.
3. Do not write trigger source or page ownership back for unknown scenarios; fill the related fields as `---`.
4. Write-back information must come from Stage 1, Stage 2, and Stage 4-1 known information; do not extrapolate.
5. Prefer writing back the change-chain verification scenarios identified in Stage 2.

Write-back fields:

| Scenario type | Write-back fields |
|---------|---------|
| HTTP | API name, serviceId, request type, full path, request-parameter JSON template, auth method |
| RPC | API name, protocol type (Thrift/InternalRPC, required; if missing fill `---` and enter TBD items; do not infer), serviceId, Interface, Method, request-parameter JSON template, auth method |
| MQ | Topic, message-body JSON template, consumer serviceId, auth method |
| JobScheduler | Job name, serviceId |
| ConfigCenter | serviceId, Config Key, config meaning |
| Scenario chain | Step sequence, each step's trigger-source information, inter-step parameter-pass relationship, verification focuses |
| Page ownership | Page name, page path / route, entry, action controls, page-level permission / visibility, page-level verification focuses |
| Diagram link | Image URL registered in the Stage 1 business-diagram list (app/web scenarios only; not applicable to server/unknown scenarios) |

Write-back requirements:

- The parameter template of a server scenario must be a legal JSON object
- Keep field paths in the request parameters per the contract structure; write confirmed values for stable common parameters and fixed technical parameters already explicit in Stage 1, Stage 2, Stage 4-1, or the optional local pack
- Do not invent concrete business values for business-semantic parameters or dependency backfill parameters (parameters that need later data-construction results backfilled); to keep the JSON legal, keep only empty placeholders by field type
- Division of labor between `---` and type default values: `---` may appear only in a table cell to express "field-level missing / unknown"; inside a JSON object body always use a type default as the placeholder (int/long→`0`, string→`""`, boolean→`false`, object→`{}`, array→`[]`); do not write `---` into a JSON value position
- The protocol type of an RPC scenario must be written back: the value comes from the protocol field of the Stage 1 API-object list or a protocol type written in testdocs / the optional local pack; if both are absent, fill `---` and register a TBD item
- Fill missing fields as `---`
- Write service identifiers only as `serviceId`; convert other original key names per [shared-rules.md](shared-rules.md) "Current field names and read normalization"
- Do not invent; do not infer
- Every step in a scenario chain must contain complete trigger-source information
- Prefer writing app/web scenario page-ownership information into that scenario's trigger-source information column; source Priority is Stage 1 analytics-event / UI content list, requirement-document page descriptions, design drafts / page screenshots, page-hosting information in the Stage 2 impact scope, optional local-pack function map
- Server scenarios still primarily use API / service information; do not force-fill page ownership
- **Diagram-link write-back rules (app/web scenarios only)**: by the scenario's page ownership (page name / route) and owning module, match the corresponding page / owning-module hit images in the Stage 1 business-diagram list; on a hit, write that image URL character for character into the "diagram link" field; when there are multiple hits, list them all, separated by semicolons. When there is no match, fill `---` and register it as a TBD item (missing field: diagram link). **The diagram link must be a provenance link**: the URL can only come character for character from an image URL registered in the Stage 1 business-diagram list; do not concatenate, rewrite, truncate, or invent; do not split or attach an aggregated design-draft image (the whole-draft design-draft link stays only in the plan-header materials table and does not enter the scenario table)
- **Empty-list cross-check (mandatory)**: when the Stage 1 business-diagram list is empty, the audit must cross-check the **image-mark scan dual counts** in the Stage 0 input-processing report (original image-mark count + transcription annotation-block count), and check whether the report registered a missing item for image-fetch failure: ① original marks >0 → Stage 0 gap (images did not enter the transcription pipeline); register it as a TBD item (missing field: business-diagram list, reason: Stage 0 did not transcribe) and attach a pending-clarification item that traces back to Stage 0; ② original marks =0 and the transcription blocks contain a "📷 Image fetch failed" annotation (or the report missing items registered an image-fetch failure) → image content unknown; register a TBD item (reason: image fetch failed, content unknown) and attach a pending-clarification item that traces back to Stage 0; ③ original marks =0 and transcription blocks >0 and they contain no fetch-failure annotation → all images were processed; an empty list is then a legal result of "none are page images"; the check passes and no gap is registered; but you must cross-check whether the Stage 1 report attached scan-count evidence for an "empty-judgment rescan fallback"; if there is no evidence, register a pending-clarification item that traces back to Stage 1; ④ both counts are 0 → the document has no images; an empty list is legal; the check passes. Do not treat an empty list as an established fact and continue without a cross-check

| Scenario ID | Client type | Write-back type | Write-back content | Result |
|---------|----------|---------|---------|------|

(server records trigger source; web/app records page ownership and diagram link; unknown fills `---`)

### TBD items
| Scenario ID | Missing field | Already-queried record | Handling |
|---------|---------|-----------|------|

### Server-side contract information summary

Summarize the server-side Thrift, InternalRPC, HTTP, MQ, JobScheduler, and ConfigCenter contracts involved in this test design; expand field semantics, constraints, and enum meanings by contract dimension, for later stages to understand fields; do not hang scenarios, do not write verification points, and do not adjudicate data construction.

**Five-way parameter classification** (the annotation basis for the contract-summary "classification notes" column; judgment-basis Priority and judgment discipline take [shared-rules.md](shared-rules.md) "Five-way parameter classification notes rules" as the only authority; the table below is a verbatim copy of the judgment-standard table; do not unilaterally rewrite it; keep it in sync with the authority version):

| Class | Judgment standard |
|------|---------|
| stable common parameter | A technical parameter unrelated to test data, with the same value in every scenario (e.g. channel / version / client identifiers such as clientType, version, source), and the judgment basis has already made its value explicit |
| fixed technical parameter | A parameter the API contract agrees has a fixed value (e.g. a hard-coded flag, an enum switch), and the judgment basis is already explicit |
| business-semantic parameter | A parameter whose value depends on a concrete business object or scenario semantics (e.g. business IDs such as user / product / order, amount, quantity) |
| test-data parameter | An input parameter whose value is decided by the test design (e.g. boundary values, exception values, switch combinations) |
| dependency backfill parameter | A parameter whose value depends on a prior-step execution result being backfilled (e.g. a token produced by login, an spuId produced by product creation) |

> Do not guess the class from field-name semantics; with no basis fill `unclassified (no basis)`; see shared-rules for the annotation format of composite fields and conditional classification.

| Contract ID | Contract name | Contract type | Contract role | Minimal identification information | Source |
|---------|---------|---------|---------|-------------|------|
| CQ-01 | [API / message / job / config name] | [Thrift/InternalRPC/HTTP/MQ/JobScheduler/ConfigCenter] | [primary execution entry / dependency observation / message / job / config] | [see the format rules below] | [Stage 1 / Stage 2 / Stage 4-1 / local knowledge pack] |

Minimal identification-information format (fixed semicolon-separated, machine-parseable):

- Thrift/InternalRPC: `serviceId; Interface; Method; Auth` (4-tuple; if auth is unknown fill `---`)
- HTTP: `serviceId; URL; Type; Auth`
- MQ: `Topic; consume group; consumer serviceId`
- JobScheduler: `job-name; serviceId`
- ConfigCenter: `Config Key; serviceId`

| Contract ID | Field path | Field direction | Type | Required | Field meaning | Constraint notes | Enum values and meanings | Classification notes |
|---------|---------|---------|------|------|---------|---------|-------------|-------------|
| CQ-01 | request.xxx | request/response/message/config/task-param | string/int/boolean/object/array | yes/no/--- | [field business meaning] | [length / range / format / compatibility requirement / ---] | [enum-value=meaning; fill --- if not an enum] | [annotate per shared-rules "Five-way parameter classification notes rules": class name + basis citation; composite / conditional use the matching format; with no basis fill unclassified (no basis)] |

Fill rules:

- Contract scope comes from the corrected server trigger sources, scenario-chain steps, MQ, JobScheduler, and ConfigCenter configs; app/web page ownership does not enter this table.
- Do not write a generic RPC for contract type: Thrift/InternalRPC must be one of the two; the value source is the protocol field of the Stage 1 API-object list or a protocol type written in testdocs / the optional local pack; if both are absent, fill `---` and register a TBD item.
- Field meaning, constraints, and enums only adopt explanations already present in the technical design, Spec, Stage 1/2 artifacts, or the optional local pack; if they cannot be confirmed, fill `---` and enter TBD items; for a field whose business meaning cannot be made explicit, fill the "Field meaning" column as `---` directly; do not infer and do not write a sample value.
- Enum fields must list known enum values and meanings; when the enum set is incomplete, list the known part and mark the gap.
- Classification notes follow shared-rules "Five-way parameter classification notes rules": write only the class name and the judgment-basis citation; do not write any concrete value.
- Contract role distinguishes the primary execution entry from a dependency-observation object; do not expand by scenario and do not write related scenario IDs.

## Quality self-check list

- [ ] Every Stage 1 InScope function, every technical object that changes a business result, and every analytics-event ID and UI change point has been covered or marked pending clarification, and the client type has been calibrated
- [ ] Stage 2 high-risk items, direct / indirect impact, and data-consistency checkpoints have been covered or marked pending clarification
- [ ] The coverage-mapping results table has been output: every "not applicable" and "missing" source item is recorded; "covered" items have a scenario-ID mapping
- [ ] Every technical object that changes a business result has completed the cell-by-cell dimension check; empty cells have been filled or a not-applicable reason recorded; client type and verification surface have no blanks
- [ ] Missing API, parameter, dependency, and chain information first searched historical knowledge records; items not searched before have been targeted-filled; fill-in did not exceed the 8-object cap
- [ ] Every Priority correction has a trigger condition and evidence record; when no trigger condition hit, the first-draft Priority was not changed
- [ ] Corrected scenarios were filled per the Stage 4 test-design methodology; do not bypass the models and invent scenarios
- [ ] Pure launch assurance, ops assurance, and capacity assurance did not enter test scenarios
- [ ] Scenario split dimensions are accurate, with no obvious duplication, over-coarseness, or over-fragmentation
- [ ] Corrected test-scenario IDs have been re-numbered continuously, with no duplicate, skipped, or derived IDs; the ID-mapping table has recorded the relation from original IDs to corrected IDs
- [ ] Each scenario's Preconditions, verification points, related TO, Priority basis, and coverage status can support later case expansion
- [ ] Server-scenario trigger-source information, app/web page-ownership information, and diagram links have been written back to the corrected Stage 4 report
- [ ] The server-side contract-information summary covers the Thrift, InternalRPC, HTTP, MQ, JobScheduler, and ConfigCenter contracts involved in this test design; contract type has no generic RPC; field meaning, constraints, and enums are traceable; classification notes are annotated per the shared-rules five-way classification, containing only the class name and the basis citation and containing no value or decision wording; no-basis items have been filled unclassified (no basis); missing items have been registered as TBD
- [ ] Every audit correction has been completed in place on `{run_dir}/testcase/testdocs/stage4-test-design-report.md` (pinpoint edit); `{run_dir}/testcase/testdocs/stage4-1-audit-receipt.md` exists with the trail table and Loop 1–3 bodies; the post-edit consistency review has been executed (no ambiguity, no duplication, no context contradiction)

After the in-place audit persist and the receipt is on disk, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 4-1` (redirect stdout only). If `ok` is false, do not enter Stage 5.
