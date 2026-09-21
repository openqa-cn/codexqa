# Stage 1: requirement analysis and test-object identification

## Minimum persist (this stage)

- File: `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`
- File: `stage1-*/index.json`
- Required headings: `Function inventory` | `Interface-object inventory` | `Scope boundary`

Close-read the requirement document, understand the business background, identify explicit and implied requirements, systematically identify test objects, and bound the test scope.

**Two-stage isolation analysis**: Stage 1 is split into two substeps, 1-A (requirements analysis only) and 1-B (technical-design comparison and verification). 1-A must not consult the technical design, so that requirement-completeness judgment is not anchored by implementation details; 1-B is when the technical design is introduced for comparison and verification.

## Reading guide

Execute in order: inputs and knowledge consumption → 1-A requirements only → 1-A self-check → 1-B technical-design comparison → test-object identification → 1-B self-check → output compression and format. Do not skip 1-A and read the technical design first.

## Inputs

> Before this stage starts, first follow [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" to confirm `run_dir` is available (userConfig.runDir → user-specified path → this Skill's initialized default directory); do not perform any reads or writes before that confirmation.

- Requirement document: full text of the PRD / user stories / requirement specification (1-A primary input)
- Technical design document: technical design, architecture design, database design, interface design, Spec documents (1-B primary input; do not read during 1-A)

---

## Stage 1 knowledge consumption

> Knowledge-interaction adaptation is unified in [knowledge-adapter.md](knowledge-adapter.md); output templates are in [knowledge-receipt-templates.md](knowledge-receipt-templates.md).

### Consumption timing

After requirement-document parsing is complete and before function-point extraction (one-time consumption; this stage has the largest Token cost, so knowledge injection prioritizes precision).

### Knowledge acquisition

Per [knowledge-adapter.md](knowledge-adapter.md), first extract terms, flows, rules, and functions from the requirement body; Stage 1 has no reusable close-reading artifacts. Only when the user already provided a local knowledge directory at init, filter directionally from `knowledge/index.md` as a supplement using the table below. When the index is empty or a dimension is not hit, continue with the PRD and annotate to be confirmed; do not ask for a knowledge directory to be supplied; do not invent.

| Filter dimension | Value |
|---------|------|
| stage | `requirement-analysis` |
| knowledge dimension | object-under-test knowledge / business knowledge |

**Stage 1 keyword construction**: after the requirement document is parsed and before function points are extracted, build base words in three layers: L1 scan H1~H3 titles to get function names / module names / business actions; L2 scan body, tables, and flows to get business objects, status enums, and config switches; L3 merge synonyms, deduplicate, and fill missed modules. When a local pack exists, further combine with "term / rule / flow / map" for filtering. On a miss, annotate the gap per the adapter; do not invent.

### Needed knowledge types (corresponding knowledge dimensions: object-under-test knowledge / business knowledge)

| Knowledge type | Priority | Use |
|---------|--------|------|
| Business terms and concepts | Required | Interpret domain jargon, enum values, and abbreviations in the PRD so function source-text understanding is not distorted |
| Business flows | Required | End-to-end path cognition, supporting user-path closed-loop checks and status-transition completeness checks |
| Function map | Important | Locate function-module hierarchy and entries, supporting function-point completeness cross-checks (multi-end coverage, page ownership) |
| Business rules and constraints | Required | Complete implied rules the PRD did not state explicitly, supporting deep branch-logic identification (exhaustive decision conditions, boundary values) |
| Pitfalls and reviews (related modules) | Optional | Help identify implied branches (concurrent operations, data inconsistency, third-party exceptions, and so on) |

### Close-reading layer execution

**Keyword combination**: base keywords (function name / module name / business action / business object / status enum / config switch, extracted per this stage's "Stage 1 keyword construction" L1 titles → L2 body entities → L3 semantic induction) + stage modifiers (term / rule / flow / map). With no local pack, skip index filtering and close-read only the PRD; with a local pack but no hit, grep testdocs and the pack per the adapter; if still no hit, annotate the gap; do not invent.

**Close-reading rules**:

| Item | Spec |
|------|------|
| Close-reading objects | Business terms, business flows, business rules, function map |
| Close-reading artifacts | "function point-condition-result-exception" rule conclusions; fill implied branches |
| TopN · budget | Single group Top10; this stage has the largest token cost; injection prioritizes precision |
| Stop condition | Business rules already written in the PRD can support function-point and boundary identification; mark unwritten ones to be confirmed |

**Extended retrieval**: if the PRD identifies interfaces / services / dependencies and the local pack did not provide entry locations, grep testdocs (and the optional pack) per [knowledge-adapter.md](knowledge-adapter.md) section 2.5; adopt only protocols and parameters already written in the source; do not invent Class/Provider.

**Output**: output per the Stage 1 template in [knowledge-receipt-templates.md](knowledge-receipt-templates.md) and persist to `{run_dir}/testcase/knowledge-biz/{project-name}/stage1-requirement-analysis/`.

### Knowledge use

Inject into deep function-branch-logic identification (use business rules as the basis when building the implied-branch matrix), business-dimension interpretation (7 dimensions), and B01-B12 implied-business-function checks.

> **Note**: function source-text extraction still follows the 6 bans and the "do not invent" principle; knowledge is used only to verify and complete implied logic and must not rewrite the requirement source text.

---

## Substep 1-A: requirements analysis only

**Core principle**: look only at the requirement document (PRD/Spec) and the local knowledge pack the user already provided; do not consult the technical design. Analyze from the perspective of "is the requirement complete"; annotate every ambiguity and missing item as "to be confirmed".

### Part 1: requirement understanding

### Function source-text extraction rules (6 bans)

**Function points may come only from the body**: function points must be extracted from the **Stage 0 cleaned-version** PRD body (including tables, blockquotes, comments, footnotes) and anchored word-for-word to the source location — "blockquote" means a native PRD blockquote, not a 📷 image-transcription / 📊 flowchart-summary annotation block inserted back by Stage 0 (the latter is image content and is an object of this ban); **do not reverse-construct function points from image content**; **do not construct function points from strikethrough fragments or from titles of unretrieved remote child docs**. When figure and text disagree, treat the body as authoritative and register an ambiguity. Extract adjacent unstruck body text as usual.

| Ban | ❌ Wrong | ✅ Right | Check method |
|:-----|:--------|:--------|:---------|
| Do not trim paragraphs | Extract only 3 of 5 paragraphs | All 5 paragraphs | Paragraph-count check |
| Do not summarize | "Mainly includes A, B, C" | Copy the full original text | Keyword match |
| Do not omit parameters | "When the threshold is exceeded" | "When 15 minutes is exceeded" | Numeric regex match |
| Do not drop branches | Copy only if, lose else | Complete if-else | Condition-keyword count |
| Do not rewrite wording | Source "if" rewritten as "when" | Keep the source "if" | Similarity ≥95% |
| Do not omit sub-items | Extract only 1) of 1)2)3) | Extract all | Sub-item-marker count |

**Mandatory self-check**: paragraph counts match? numeric parameters match? condition-branch counts match? sub-item counts match? character-count difference ≤5%?

### Function-point completeness check (mandatory)

Before extracting function points, a completeness check of the document structure must be performed first, to ensure no function module or business logic is missed.

#### Document-structure scan

1. **TOC / outline extraction**: extract all heading levels from the document (h1-h6 or numbered headings) and build a document outline tree
2. **Section-number continuity check**: check whether numbering is continuous (for example 1.1, 1.2, 1.3 must not jump to 1.5)
3. **Section-content non-empty check**: each section heading must have corresponding content; mark empty sections as "content missing"

#### Function-point cross-check

After all function points are extracted, execute the following cross-checks:

| Check item | Method | Handling on failure |
|--------|------|-------------|
| **Document sections vs function inventory** | Whether every function-related section in the document has a corresponding function point | Supplement missed function points |
| **Condition-branch completeness** | Whether every if / when / if-so has a corresponding else / otherwise / other case | Mark as "branch incomplete, needs clarification" |
| **Status-transition completeness** | For functions that involve status changes, whether every status has an entry and an exit | Supplement missing status transitions |
| **Multi-end / multi-scenario coverage** | Whether every end (APP / mini-program / H5 and so on) and scenario mentioned in the document has a corresponding function point | Supplement missed ends or scenarios |
| **Config-item completeness** | Whether every configurable item mentioned in the document has been identified | Supplement missed config items |

#### Deep logic-completeness check

Perform a deep check of each function point's business logic:

1. **Exhaustive decision conditions**: for every decision condition the function involves, whether every possible value has corresponding handling logic
2. **Priority / mutex relations**: whether priority is explicit when multiple conditions are satisfied at once, and whether mutex conditions are complete
3. **Boundary-value identification**: whether boundary values of numeric parameters (max / min / critical values) have all been identified
4. **Exception-path coverage**: whether every positive function has considered the corresponding exception cases (interface exceptions, data exceptions, permission exceptions, and so on)

#### Deep function-branch-logic identification (mandatory)

**This is a high-frequency miss area; the following branch-identification flow must be executed for every function point:**

**Step 1: condition-keyword scan**

Scan the full function description for the following keywords; at every keyword occurrence the complete branch logic must be identified:

| Keyword type | Example keywords | Identification requirement |
|-----------|-----------|---------|
| Condition judgment | if / if-so / when / at ... time / if ... then / if not then | Identify the if branch + else branch (including default handling) |
| Status judgment | already / not yet / whether / has or not / exists / does not exist | Identify different handling logic under the two statuses |
| Role / permission | admin / ordinary user / merchant / courier / has permission / no permission | Identify behavior differences under each role / permission |
| Quantity / range | exceeds / does not exceed / greater than / less than / equal to / at least / at most | Identify different handling logic on both sides of the boundary |
| Time condition | before ... / after ... / during / expired / effective | Identify different handling logic inside and outside the time window |
| Operation order | first ... then / at the same time / concurrent / repeat / already operated | Identify handling logic for operation order and repeat operations |
| Data status | empty / not empty / default value / already filled / not filled | Identify handling logic for valued / empty / abnormal data |

**Step 2: branch-completeness matrix**

For each identified condition, build a branch-completeness matrix:

| Condition | Branch 1 (condition holds) | Branch 2 (condition does not hold) | Branch 3 (boundary / special case) | Complete? |
|------|----------------|------------------|---------------------|---------|
| Example: whether the user is logged in | Show personal information normally | Redirect to the login page | Token expired / login-state exception | ✓ |

**Step 3: implied-branch identification**

The following scenarios have high-frequency implied branches and must be identified proactively:

- **When a list is empty**: when a function involves list display, the "no data" handling must be identified (empty-state page / prompt copy / guided action)
- **When an operation fails**: every user operation (submit / save / delete / pay and so on) must identify failure handling (error prompt / compensation / retry mechanism)
- **When operations are concurrent**: handling when multiple users operate the same resource at once (lock mechanism / prompt / overwrite strategy)
- **When data is inconsistent**: handling when frontend and backend data are out of sync, or cache and DB are inconsistent
- **When a third-party dependency is abnormal**: the business fallback result when an external service times out / is unavailable
- **When permissions change**: handling when user permissions change during an operation
- **When an operation is repeated**: idempotent handling when the user clicks repeatedly / submits repeatedly

**Step 4: branch-coverage self-check**

| Self-check item | Check method | Handling on failure |
|--------|---------|------------|
| if-branch count = else-branch count | Count condition keywords and confirm every if has a corresponding else | Supplement the missing else branch |
| Status-enum completeness | List every possible status and confirm each status has handling logic | Supplement handling for missed statuses |
| Role-permission-matrix completeness | List every role and confirm each role's behavior has been identified | Supplement missed role behavior |
| Exception-path coverage | Whether every positive flow has a corresponding exception-handling path | Supplement the exception-handling path |

### Business-dimension interpretation (7 dimensions)

| Dimension | Output requirement | Key checkpoints |
|------|---------|-----------|
| Business goal | Core problem, quantified success criteria | KPI is measurable |
| User scenarios | User personas, operation paths, multi-role coverage | Are exception scenarios covered? |
| Function scope | IN / OUT / pending boundary | Inclusion and exclusion are explicit |
| Business rules | Algorithms, validation rules, status transitions | Rules are unambiguous and boundaries are explicit |
| Data requirements | Data entities, fields, sources, lifecycle | Volume, historical compatibility |
| Acceptance criteria | Given-When-Then atomization | Automatable verification |
| Analytics-event requirements | Complete extraction of analytics-event objects (see the analytics-event extraction rules below) | Identification-feature match + four-field extraction |

> ⚠️ The following technical-dimension interpretation, technical risk signals (R01-R12), and business-to-technical mapping analysis are **not executed** in Stage 1-A; they move to Stage 1-B.

---

## Substep 1-A self-check (mandatory)

After 1-A analysis is complete, the following self-check must be executed:

| Self-check item | Check method | Handling on failure |
|--------|---------|------------|
| **Stage isolation** | Confirm the entire 1-A process did not read the technical design | If it was read, re-execute 1-A |
| **Function completeness** | Every function-related section in the requirement documents has a corresponding function point | Supplement misses |
| **Ambiguity annotation** | Every unclear business rule is annotated "to be confirmed" | Supplement annotations |
| **Exception scenarios** | Every positive function has considered exception paths | Supplement exception scenarios |
| **Analytics-event completeness** | Regex-scan count = extraction count | Compare one by one and recover |

---

## Substep 1-B: technical-design comparison and verification

**Core principle**: after 1-A is complete, introduce the technical design / Spec document, do a four-dimension comparison with the 1-A requirement-analysis results, and supplement technical-dimension test objects. Mark the source as "🔧 Technical-design supplement", distinct from 1-A's original requirement analysis.

### Four-dimension comparison and verification

#### Dimension 1: implementation-deviation comparison

Compare the 1-A function inventory with the technical design item by item:

| Deviation type | Definition | Handling |
|---------|------|----------|
| PRD has, technical does not | The requirement mentions it but the technical design does not cover it | Annotate "technical design not covered"; high risk |
| Technical has, PRD does not | The technical design has it but the PRD did not mention it | Annotate "🔧 Technical-design supplement"; confirm whether it is an implied requirement |
| The two contradict | PRD and technical-design descriptions are inconsistent | Annotate "requirement vs technical contradiction"; must clarify |
| Granularity difference | Both have it but the level of detail differs | Treat the finer granularity as authoritative and annotate the source |

#### Dimension 2: technical-dimension interpretation (10 dimensions)

| Dimension | Key checkpoints | Risk signals |
|------|-----------|---------|
| System architecture | Identify new / change modules | New technology introduced, major architecture adjustment |
| Data model | Large-table change? Data-recovery strategy? | 10-million-plus table DDL change |
| Interface contract | Compatibility? Business return after rate-limit? | Incompatible change to an external interface |
| Core algorithm | Does algorithm complexity affect timeout-return semantics? | Complex computation at O(n²) or above |
| State-machine design | Are statuses complete? Illegal interception? | Missing status, dead status |
| Concurrency control | Distributed-lock choice? Deadlock? | High-concurrency hotspot-resource contention |
| Cache strategy | Consistency? Hot Key? | Penetration / breakdown / avalanche |
| Dependency integration | Stability? Business-fallback semantics? | Strong single-point dependency, no business fallback |
| Deployment architecture | Does it directly affect old/new business logic or interface results? | Launch/release path alone is not a test object for this period |
| Security design | Permission model? Data masking? | Sensitive data transmitted in plaintext |

#### Dimension 2-1: structured breakdown of server-side technical objects (mandatory)

Server-side implementation in the technical design must not be abstracted as only "add/modify one interface". 1-B must break it down by technical responsibility into test objects that can be passed to Stage 4; types with no hit may be skipped; hit types must enter the "technical-implementation-object inventory" or the "interface-object inventory". This rule applies to all server-side requirements and is not bound to a specific business domain.

| Technical-object type | Identification signals | Information that must be extracted | Test focus passed to Stage 4 |
|-------------|---------|---------------|----------------------|
| Interface contract | HTTP/RPC/IDL/OpenAPI/DTO/error codes/response wrapping | Protocol, method, request fields, response fields, error codes, auth, callers, compatibility constraints | Parameter combinations, field boundaries, error codes, compatibility fields, consumer contract |
| Business orchestration | Controller/Application/Service/Orchestrator/flowchart/step sequence | Main flow, precondition checks, short-circuit conditions, post-processing, call order | Main flow, precondition not met, short-circuit, must-not-call, repeat call |
| Rule adjudication | State machine/enum/decision table/priority/mutex rules/rule engine | Condition set, result set, priority, default branch, illegal branch | Status matrix, condition combinations, priority conflict, unknown/default result |
| Dependency interaction | Gateway/Client/third party/internal service/SDK/downstream interface | Dependency name, request construction, success/empty/failure/timeout/illegal response/partial-success semantics | Dependency-return semantics, business-fallback result, post-retry result, partial success, call amplification |
| Data transformation | Assembler/Converter/Mapper/field mapping/unit conversion | Source fields, target fields, defaults, enum mapping, precision/units, dropped fields | Null, default, precision, units, enum mapping, missing fields |
| Data read/write | DB/cache/MQ/job/index/batch | Read/write objects, transaction boundary, consistency requirements, idempotency key, retry/compensation | Consistency, concurrency, idempotency, repeat consumption, compensation and data recovery |
| Batch/rate-limit/degrade business semantics | deadline/timeout/rate-limit/batch/concurrency/cache/degrade | Extract only information that changes the interface response, data state, or business-fallback result | Post-timeout return, batch-boundary result, rate-limit error code, degrade business result |
| Switch/experiment business semantics | switch/experiment/gray release/version compatibility/old client | Extract only information that changes old/new business logic or interface results | Switch off, gray release not hit, business result after old-version compatibility |

**Breakdown requirements**:
- When the technical design shows signals such as "status, enum, condition, priority, fallback, short-circuit, timeout, failure, empty response, partial success, compatibility, gray-hit rule, field mapping, batch, concurrency", first judge whether they change the interface response, data state, or business rule; if they change it, generate the corresponding technical object or explicitly record the test focus on an existing object; pure release-rollback, capacity, monitoring, and similar assurance tasks do not generate test objects.
- If one interface includes orchestration, rule adjudication, dependency interaction, data transformation, timeout-return semantics, or compatibility constraints, it must be split into multiple test objects; do not keep only the interface object.
- A technical object's owning module inherits the related business-function module first; if the technical design itself crosses modules, it must be split into multiple objects by responsibility; do not mix multiple modules' test responsibilities in one object.
- Do not invent unmentioned implementation details; but constraints, branches, and risks the technical design already made explicit must be kept in structured form and must not be compressed into one-sentence summaries.

### Technical risk signals (R01-R12 mandatory check)

| ID | Risk type | Identification flags | Test response |
|------|---------|---------|---------|
| R01 | Large-table operations | 10-million-plus table DDL change | Historical-data compatibility and data-result verification |
| R02 | Distributed transactions | Cross-service calls, eventual consistency | Transaction consistency + reconciliation/compensation verification |
| R03 | Concurrency hotspots | High-concurrency shared-resource contention | Business-result verification under concurrency conflict |
| R04 | Cache risk | Penetration / breakdown / avalanche, consistency | Cache-exception injection + consistency verification |
| R05 | Interface change | External-interface field/protocol change | Contract tests + consumer regression |
| R06 | Tech-debt introduction | Temporary solution, hard-coding | Code scan + debt tracking |
| R07 | Performance bottleneck | Complex SQL, large-volume in-memory computation | Generate a business scenario only when it affects the interface result or timeout semantics |
| R08 | Dependency single point | Strong dependency on an external system, no business fallback | Verification of the business return and data state after a dependency exception |
| R09 | Data migration | Historical-data cleaning, format conversion | Migration-script verification + data reconciliation |
| R10 | Complex state machine | Multiple statuses, multiple events, complex transitions | Status traversal + illegal-event injection |
| R11 | Message queue | Message loss, duplication, ordering | Message tracing + dead-letter verification |
| R12 | Security vulnerability | Privilege escalation, injection, sensitive-data leak | Permission-result and sensitive-data-return verification |

#### Dimension 3: business-to-technical mapping analysis

| ID | Risk category | Identification flags | Clarification suggestion |
|------|---------|---------|---------|
| B01 | Implied-function missing | Main function exists but no supporting admin/rollback | Product must confirm whether it was missed |
| B02 | Exception business flow missing | Success scenarios only | Exception-scenario PRD must be supplemented |
| B03 | Business rule ambiguous | "Depending on the situation", "in principle" | Quantified standard must be made explicit |
| B04 | Boundary conditions undefined | Max/min definition missing | Boundary values must be made explicit |
| B05 | Multi-role permission ambiguous | "Visible to related roles" | Role-permission matrix must be made explicit |
| B06 | Data ownership and isolation | Data visibility scope not stated | Data-isolation strategy must be made explicit |
| B07 | Timeliness rule missing | Timeout / effective timing not defined | Timeliness rules must be made explicit |
| B08 | Compensation and rollback mechanism | Positive flow only | Compensation strategy must be confirmed |
| B09 | Statistics caliber ambiguous | "Count per actual situation" | Calculation formula must be made explicit |
| B10 | External-dependency assumption | Behavior on external exception not stated | Dependency contract must be made explicit |
| B11 | Business-fallback requirement | A dependency exception or timeout would change the business result but fallback semantics are not stated | Interface return, data state, or business rule on exception must be made explicit |
| B12 | Compliance and audit requirements | Sensitive-data handling not mentioned | Compliance requirements must be confirmed |

**Must not be treated as ambiguities**: explicit rules and conditions, explicit interaction descriptions, explicit copy content, explicit time descriptions, routine technical implementation.

#### Dimension 4: business-to-technical mapping-deviation analysis

Identify the mapping between business requirements and technical implementation and find implementation deviations:

| Business requirement | Technical implementation | Mapping consistency | Deviation risk |
|---------|-------------|-----------|---------|
| Example: order auto-closes if unpaid for 30 minutes | Delayed message queue | consistent / deviation | Scheduled-job backlog risk |

### Business-diagram extraction and registration (mandatory; the only entry for scenario-side diagram provenance)

From document images, extract only **system-under-test business diagrams** — figures that describe what a page/UI looks like (prototype figures, interaction diagrams, page screenshots in the PRD); register the URL, containing section, owning function module, and corresponding page name, and state what function that page serves. Architecture diagrams, flowcharts, table screenshots, decorative images, and other non-page figures **are not registered**.

**Section restriction**: except **background / current-state / goal sections**, register page figures in all other sections (judge by section title; skip when it contains "background / current-state / goal"). Current-state page screenshots in a background section are the old state before the change; their page ownership would collide on the same key with new-function diagrams and cause downstream 04-1 match write-back to hang an expired page figure. Do not do a semantic judgment of "whether this figure is related to the function" — the structural signal (section title) is objective and executable; semantic judgment has a high false-cut rate (a page figure in an analytics-event section may look unrelated but must be registered).

**Image source**: the "source" URL on the multimedia-transcription annotation line in the Stage 0 cleaned-version document (that is, the URL field of `📷 Image-content transcription: <summary> (source: <image URL>...)`; **do not and must not re-fetch the image**).

**Business-diagram judgment features** (judge from Stage 0 visual-transcription content): the transcribed content describes page layout, UI elements, controls, page copy/style — that is, a person seeing it would know "this page looks like this". A figure that describes node edges / module dependencies / row-column data / no business information is not a business diagram; skip it directly.

**Descriptions are anchored to the body**: owning module / corresponding page / page-function description must be anchored from the PRD body of the section that contains the image (including tables, blockquotes, comments — "blockquote" means a native PRD blockquote, not a 📷/📊 transcription annotation block inserted back by Stage 0) — image transcription describes only the figure itself and does not define function ownership; **do not reverse-invent from in-figure elements a function the body does not have** (for example inventing a list-page screenshot into an independent "benefits center" page, registering a tag badge as a page, or assigning a comparison figure to a page type that does not exist). When it cannot be anchored to a body function, fill the owning module with the containing section title and fill the corresponding page as `---`.

**Corresponding page name** is extracted from the transcribed content or the containing-section context; fill `---` when it cannot be determined. The business-diagram URL is the only legal source for Stage 4-1 to attach a "diagram link" on app/web scenarios; a miss in registration at this stage = no figure for downstream to attach.

Output format (write into each function's business-diagram field in Chapter 2, or a standalone business-diagram inventory table; fields must be complete):

| Image URL | Containing section | Owning module | Corresponding page | Page-function description |
|---------|---------|---------|---------|---------|

> The URL must be taken word-for-word from the Stage 0 transcription annotation line; do not concatenate, rewrite, or invent. Misclassification has two directions and both consequences are controllable: **false registration** (registering a non-page figure as a business diagram) — the worst result is that downstream attaches an unrelated link, which is removed after human review, and does not invent a link; **missed registration** (missing a true page figure) — the worst result is a missed diagram attachment, and downstream falls back to `---`.

**Empty-judgment rescan fallback (mandatory)**: when the business-diagram inventory is empty and a conclusion such as "the requirement document does not contain page diagrams" needs to be written, **do not write the empty judgment directly**; a rescan must be executed first, branched by "original image-marker count":

1. Regex-scan the Stage 0 cleaned-version input documents for three annotation-block counts: `📷 Image-content transcription`, `📊 Flowchart summary`, `📷 Image fetch failed` (the total is the transcription-block count); then scan `!\[.*\]\(` and `<img ` original image-marker count.
2. **Original markers >0** → images exist but did not enter the transcription pipeline (a Stage 0 gap); register a pending clarification item: "Input contains N image markers but no transcription annotations; business diagrams cannot be extracted; return to Stage 0 to complete multimedia transcription"; **at this time do not write a statement that contradicts the facts such as "the document provided no images"**.
3. **Original markers =0 and "📷 Image fetch failed" annotations >0** → images exist but fetch/parse failed (content unknown); do not judge empty; register a pending-completion item: "Input contains N image-fetch failures; their content is unknown; re-judge after they are completed"; write the conclusion "The document contains images but content ingest failed; cannot judge whether it contains page diagrams".
4. **Original markers =0, fetch-failed annotations =0, transcription blocks >0** → empty judgment holds; write the conclusion "After scan: all images have been processed (transcription blocks N); none are page diagrams; no registerable business diagrams are included", and attach the scan counts as evidence.
5. **Both counts are 0** → empty judgment holds; write the conclusion "After scan: input-document image-marker count is 0 (transcription blocks 0 / original markers 0); no page diagrams are included", and attach the scan counts as evidence.

> An empty-judgment conclusion must attach source evidence (scan counts); unevidenced absolute statements are not allowed — "did not see" is not equal to "does not exist".

### Analytics-event extraction rules (mandatory)

Analytics-event information in the requirement document must be fully identified and extracted. Analytics events are an important part of test analysis; missing an analytics event equals missing a test object.

#### Identification features

Common forms of analytics events in documents:

| Feature type | Match pattern | Example |
|---------|---------|------|
| bid identifier | `b_<biz>_<hash>_<type>` | `b_biz_1rko5sji_mv`, `b_biz_6yhy6jyn_mc` |
| cid identifier | `c_<biz>_<hash>` | `c_biz_ryom3rt4` |
| Analytics-event table | The table contains columns such as "analytics event" / "bid" / "cid" / "event name" | Analytics-event requirements table |
| Inline annotation | An analytics-event ID follows parentheses or a dash in the copy | "Click MC-b_biz_xxx_mc" |
| Independent section | Title contains "analytics event" / "data collection" / "behavior tracking" | "VI. Analytics-event requirements" |

**Scan rule**: run a regex scan over the full document text matching the `[bc]_[a-z]+_[a-z0-9]+(_[a-z]+)?` pattern, to ensure analytics-event IDs scattered in body, tables, and image captions are not missed.

#### Analytics-event type judgment

Judge the analytics-event type from the identifier suffix or document context:

| Type | Suffix / keywords | Meaning | Notes |
|------|-----------|------|------|
| mc | `_mc`, "click MC", "click" | Click event | Triggered by a user-initiated click |
| mv | `_mv`, "exposure MV", "exposure", "exposure" | Exposure event | Triggered when an element enters the viewport |
| pv | `_pv`, "page PV", "pageview" | Page view | Triggered when page load completes |
| Other | No explicit suffix | Judge from context | Annotate as "type to be confirmed" |

#### Four-field extraction requirements

Each identified analytics event must extract the following 4 fields:

| Field | Description | Extraction rule |
|------|------|---------|
| **English original name** | Full analytics-event identifier | 100% fidelity copy, for example `b_biz_1rko5sji_mv`; do not abbreviate or rewrite |
| **Type** | mc/mv/pv and so on | Judge from suffix or context |
| **Trigger timing** | When the report is triggered | Extract from document context, for example "when the button is clicked", "when the module is exposed", "when page load completes" |
| **Parameters** | Business parameters carried in the report | Extract the parameter list from the document; when the document does not list them, annotate "not mentioned in the requirement document" |

#### Analytics-event ownership

Each analytics event must be associated with its owning function module. Ownership judgment basis: the document section that contains the analytics event, and the page/component/action mentioned in the analytics-event description.

**Mandatory self-check**: have all identifiers starting with `b_`/`c_` in the document been extracted? Are the 4 fields of each analytics event complete? Has the analytics event been associated with a function module?

#### Analytics-event completeness mandatory check

Lost analytics events are a high-frequency problem; the following multi-layer checks must be executed to ensure analytics-event extraction is complete:

**Layer 1: full-text regex scan**

Run a regex scan over the obtained full document text (including table content) and count all identifiers matching the `[bc]_[a-z]+_[a-z0-9]+(_[a-z]+)?` pattern. Record the scan-result count as `N_scan`.

**Layer 2: extraction-result comparison**

Record the final extracted analytics-event inventory count as `N_extract`. If `N_extract < N_scan`, some analytics events were lost during extraction; they must be compared one by one to find the misses.

**Layer 3: document-structure cross-check**

| Check item | Method | Expected |
|--------|------|------|
| Whether an analytics-event section exists | Search the document for keywords such as "analytics event" / "data collection" / "behavior tracking" | If the document has an analytics-event section, that section's content must be fully extracted |
| Function module vs analytics-event coverage | Whether every function module with user interaction has a corresponding analytics event | If a function module has interaction but no analytics event, annotate "this module did not define analytics events; confirm" |
| Analytics-event parameter completeness | Whether each analytics event's parameter list was fully extracted | The parameter list must not extract only some fields |
| ocean / analytics-event platform links | Whether the document has ocean or other analytics-event platform links | If yes, record the links for later reference |

**Layer 4: analytics-event count reasonableness judgment**

Estimate the expected analytics-event count from the function-module count. General rule: every function module with user interaction has at least 1 mc (click) + 1 mv (exposure). If the actual extracted count is far below expectation, warn and suggest the user confirm.

---

## Part 2: test-object identification and scope bounding

> This part is executed in steps across 1-A and 1-B. Stage 1-A executes items that depend on the requirement document (function-object inventory, analytics-event-object inventory, the PRD part of the data-object inventory, the PRD part of the dependency-object inventory, user-path analysis, initial scope-boundary judgment); Stage 1-B supplements items that depend on the technical design (interface-object inventory, technical-implementation-object inventory, the technical-design part of the data-object inventory, the technical-design part of the dependency-object inventory, scope-boundary refinement).

### Hierarchical naming compression rules

| Level | Naming rule | Mandatory compression rule | Example |
|------|---------|-------------|------|
| Business domain | 2–4-character noun | Delete conjunctions such as "and" / "plus" / "also" | "signing" |
| Business module | 2–4-character noun | No verbs; delete "module / function / service" | "managed ops" |
| Function | ≤6 characters, nouns preferred | Delete adverbials such as "after / when / and / then" | "category check" |
| Test scenario | Parameterized description | Delete enum details; extract the common factor | "category=same/different/allowlist" |

**Function-granularity principle**: all variants of the same business goal are forcibly rolled up into a single function; differences sink to scenario parameters. Multi-client / multi-status / multi-role / enum-value differences must not be split into independent functions.

**4 mandatory corrections**: module too long (>4 characters) → extract the head noun; function fragmentation (same object ≥2 times) → roll up; name is descriptive (>6 characters) → keep subject-verb-object; verb-first → nominalize.

### Six-dimension test-object identification

#### 1. Function-object inventory (business view)

Each function object includes: module name (≤4 characters), function name (≤6 characters), test type (positive / exception / boundary / concurrency / compatibility / permission / security), client-type candidates (server/web/app/unknown, multi-select allowed), final client-type judgment (server/web/app/unknown), client-type judgment basis, technical risk (R01-R12), source-text description (100% fidelity), implied functions (B01-B12), ambiguities.

#### 2. Technical-implementation-object inventory (executed in Stage 1-B)

Technical-object types reuse the classification in "structured breakdown of server-side technical objects" above; this section does not repeat the classification table and only specifies persist fields.

| Field | Fill requirement |
|------|---------|
| Owning module | Inherit the module name from the 1-A function-object inventory |
| Object type | Choose from the technical-object types above; do not generate if no hit |
| Object name | Original name in the technical design of the interface, service, rule, dependency, converter, data object, switch, and so on |
| Identified content | The technical responsibility and change points this object bears |
| Extraction source | Technical-design section, interface design, data design, flowchart, or Spec |
| Key branches/constraints | Verifiable branches Stage 4 must expand; when there is no branch but there is a contract constraint, record the contract constraint |
| Test focus passed to Stage 4 | In one sentence, state what model or matrix Stage 4 should expand by |
| Client-type calibration | server/web/app/unknown; used to map the technical object onto the actual hosting end |
| Validation surface | business result / visibility / path / analytics event / unknown; used by later stages to judge whether to generate the corresponding case type |

#### 3. Data-object inventory

Each data object includes: owning module, data entity, change type (new table / field change / index adjustment / migration / delete), data volume, sensitivity level (public / internal / sensitive / confidential), test focus, construction strategy. The owning module must be associated with a module name in the 1-A function-object inventory.

#### 4. Interface-object inventory (executed in Stage 1-B)

Each interface includes: owning module, **serviceId**, path, protocol, change nature, request method, request parameters (mandatory JSON format), response structure (mandatory JSON format), callers, idempotency, rate-limit strategy, compatibility risk, test strategy, auth method. The owning module must be associated with a module name in the 1-A function-object inventory; every field is required; fill `---` for fields the technical design did not mention; Stage 2 re-checks once more only in testdocs and the optional local pack; keep `---` and pass it downstream if still incomplete.

**serviceId extraction rule**: whatever the original key name of a service/app identifier in the user materials (see [shared-rules.md](shared-rules.md) "Current field names and read normalization"), land it uniformly on `serviceId`. Fill `---` when not written; do not invent. environment ID is not extracted in this stage.

**Do not extract empty interfaces and template sections (mandatory)**: the following cases **must not** generate an interface object, and must not invent Interface/Method/URL/protocol from a service name:
- The section title is "Interface design" or similar but the body is empty, or the body is only a placeholder such as "fill in the interface"
- A header exists and every data row is empty, or only template/sample empty rows remain
- Only an affected service name or a config-owning service exists, with no written path or Interface+Method+protocol

**Config lists**: extract config tables as config objects (`serviceId`, Config Key, meaning, config value if already written). A config row **does not enter the interface-object inventory** unless the same row also writes the protocol and a method or path.

**Strikethrough and typos**: read only the Stage 0 cleaned version. Text inside strikethrough segments must not enter the function inventory or InScope. Do not correct business typos; when the same concept appears in two writings, keep both sides and record "⚠️ Inter-document conflict, to be confirmed".

**Mandatory protocol-field rule**: each interface's protocol type must be explicitly one of `HTTP`, `Thrift`, `InternalRPC`; the value source is an explicit label in the technical design / Spec, or a protocol type hit in testdocs / the optional local pack in Stage 2; when both are absent, fill `---` and add a pending clarification item; **do not infer the protocol from Interface/Class naming style**. An RPC interface must not be written generically as RPC; it must be explicitly Thrift or InternalRPC.

**Mandatory table-to-JSON rule**: table "store_id|string|yes|store ID" → `{"store_id": {"type": "string", "required": true, "desc": "store ID"}}`

**Strengthened interface-parameter extraction rules (mandatory)**:

Interface-parameter completeness in the technical design varies; extract by the following rules:

| Scenario | Extraction rule | Annotation method |
|------|---------|---------|
| Technical design contains a complete parameter structure | Extract the complete JSON structure directly; placeholder all fields with type defaults | No extra annotation needed |
| Technical design only mentions changed fields | Extract the complete structure of the changed fields + annotate remaining fields as "pending completion" | Add an `"_incomplete": true` marker in the JSON |
| Technical design only describes change logic | Extract the change-logic description and annotate the parameter structure as "pending completion" | Fill request/response structure as `{"_incomplete": true, "_desc": "Technical design only describes change logic; parameter structure pending completion"}` |
| Technical design has no parameter information | Annotate "not mentioned in the technical design, pending human confirmation" | Fill request/response structure as `{"_incomplete": true, "_desc": "Not mentioned in the technical design"}` |

**Parameter format rules (valid JSON object template)**:

Placeholder field values by type with defaults, producing a JSON template that can be used directly for test construction:

| Java type | JSON placeholder | Example |
|---------|-----------|------|
| int / Integer | 0 | `"count": 0` |
| long / Long | 0 | `"orderId": 0` |
| String | "" | `"name": ""` |
| boolean / Boolean | false | `"needInvoice": false` |
| object / DTO | {} | `"sqtInfo": {}` |
| array / List | [] | `"items": []` |
| BigDecimal / Double | 0 | `"amount": 0` |

**Complete parameter-structure extraction examples**:

```json
// Push-order API — technical design contains the complete change fields
{
  "sqtInfo": {
    "sqtOrder": 0,
    "sqtNeedInvoice": 0
  },
  "sqtNeedInvoiceFlag": 0,
  "dealInfoList": [
    {
      "dealId": 0,
      "sqtInfo": {
        "sqtOrder": 0,
        "sqtNeedInvoice": 0
      }
    }
  ]
}
```

```json
// Query API — technical design only mentions the changed fields
{
  "_incomplete": true,
  "_desc": "Technical design only mentions the new settleInfoDTO.sqtInvoiceInfoDTO.sqtInvoiceTag; remaining fields pending completion",
  "settleInfoDTO": {
    "sqtInvoiceInfoDTO": {
      "sqtInvoiceTag": 0
    }
  }
}
```

#### 5. Dependency-object inventory

| Owning module | Dependency type | Dependency mode | Risk level | Test strategy |
|---------|---------|---------|---------|---------|
| [associated 1-A function module] | Internal service | Sync RPC / async message | high / medium / low | Mock/Stub/real call |
| [associated 1-A function module] | Third-party system | HTTP interface / SDK | high / medium / low | Mock / contract test / sandbox |
| [associated 1-A function module] | Middleware | Client connection | high / medium / low | Business-result verification after a dependency exception |
| [associated 1-A function module] | Base resource | Infrastructure | high / medium / low | Record only resource constraints that affect the business result |
| [associated 1-A function module] | Shared data | Database / cache | high / medium / low | Data-sync verification |

The owning module must be associated with a module name in the 1-A function-object inventory.

#### 6. Analytics-event-object inventory

Based on the extraction results of Part 1 "Analytics-event extraction rules", organize all identified analytics events into a structured inventory.

Each analytics-event object includes: English original name (100% fidelity copy, for example `b_biz_1rko5sji_mv`), type (mc/mv/pv and so on), trigger timing (extracted from document context), parameters (business parameters carried in the report; annotate "not mentioned in the requirement document" when the document does not list them), owning module (associated function-module name), client type (web/app/unknown, judged from context), validation surface (visibility / analytics event).

**Handling when there are no analytics events**: if no analytics-event ID is identified in the document, leave this inventory empty and annotate "the requirement document does not contain analytics-event information"; do not invent analytics events.

### Scope-boundary declaration

| Scope type | Definition standard | Test handling |
|---------|---------|---------|
| InScope (must test) | Functions + technical objects involved in this change | Full test design |
| OutOfScope (do not test) | Explicitly excluded, unchanged | Depend on historical automation |
| Pending Scope | Requirements or technical design did not make the boundary explicit | Risk fallback + time-boxed clarification |
| Technical-risk Scope | Technical-driven and would change the business result, but the business did not explicitly require it | Business-result verification or risk note |

### User-path analysis [P0 priority]

**Path identification**: entry identification → step breakdown → branch identification → exit identification → closed-loop check.

| Path type | Definition | Coverage requirement |
|---------|------|---------|
| Main path (Happy Path) | The most core success path | 100% coverage, P0 |
| Exception path | Error, failure, timeout | Cover based on risk level |
| Branch path | Branches produced by condition judgments | Cover all condition combinations |
| Cross-function path | End-to-end flow across multiple modules | Cover key paths |

**Completeness check**: is the entry explicit? are steps continuous? are branches exhaustive? is the exit defined? is data closed-loop? is exception rollback present?

---

## Substep 1-B self-check (mandatory)

| Self-check item | Check method | Handling on failure |
|--------|---------|------------|
| **Deviation full coverage** | Every item in the 1-A function inventory has had the four-dimension comparison | Supplement misses |
| **Source annotation** | All 1-B supplemented content is annotated "🔧 Technical-design supplement" | Supplement annotations |
| **Technical-risk completeness** | R01-R12 checked item by item | Supplement misses |
| **Interface-object completeness** | Every interface in the technical design has been extracted into the interface-object inventory, and each row contains a `serviceId` field (may be `---`) | Supplement misses |
| **Technical-implementation-object completeness** | Technical-object types identified in Stage 1-B (interface contract, business orchestration, rule adjudication, dependency interaction, data transformation, data read/write, batch/rate-limit/degrade business semantics, switch/experiment business semantics, and so on) have all been identified; pure launch assurance, ops assurance, and capacity assurance are not test objects for this period | Supplement misses |
| **Contradiction annotation** | Every PRD vs technical-design contradiction has been annotated and needs clarification | Supplement annotations |

---

## Stage 1 output-compression rules (mandatory; prevent Token overflow)

**This stage is the largest Token-consuming stage in the whole flow**, because it needs to fully extract requirement source text, interface parameters, the analytics-event inventory, and a large amount of other content. The following compression rules must be strictly executed, to avoid outputting the full content into the conversation.

### Execution order

1. **1-A complete analysis**: execute requirements analysis only; fully extract function points, business rules, exception scenarios, analytics events, and so on; execute the 1-A self-check.
2. **1-B comparison and verification**: introduce the technical design, execute the four-dimension comparison, supplement technical-dimension test objects, and execute the 1-B self-check.
3. **Write the complete report to a file**: write the complete analysis report (including all 1-A and 1-B content; mark the source of 1-B supplements) to the single file `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`.
4. **Show only a summary in the conversation**: show the "summary output format" below in the conversation; **do not output the complete report in the conversation**.

### Per-field compression rules

| Field | Where the full content goes | Shown in the conversation |
|------|------------|-----------|
| Function source-text description | Write to the local file (100% fidelity) | Truncate to **100 characters**; annotate the overflow "[see local file]" |
| Interface request-parameter JSON | Write to the local file (complete structure) | Show only the parameter **field-name list**; do not show types and descriptions |
| Interface response-structure JSON | Write to the local file (complete structure) | Show only **top-level field names**; do not show nested structure |
| Analytics-event-object inventory | Write to the local file (complete 4 fields) | Show only **analytics-event ID + type**; do not show trigger timing and parameters |
| Technical-risk inventory | Write to the local file (complete content) | Show only **risk ID + object name**; do not show response strategy |
| Business-risk inventory | Write to the local file (complete content) | Show only **risk ID + brief**; do not show clarification suggestions |
| Dependency-object inventory | Write to the local file (complete content) | Show only **dependency name + risk level** |
| User-path analysis | Write to the local file (complete steps) | Show only **path name + step count**; do not show detailed steps |

### Summary output format (show this format in the conversation)

```
## Stage 1 analysis complete ✅

**Function-module inventory** (X modules, Y function points in total):
| Module name | Function count | Has analytics events | Risk signals |
|--------|--------|--------|---------|
| Module A  | 3      | yes (2)| R03     |
| Module B  | 5      | no     | -       |
...

**Key data**: X interfaces | X analytics events (mv:X mc:X pv:X) | X client-type candidates (server/web/app/unknown) | X technical-risk items | X business ambiguities

**Pending clarification items** (titles only, X items in total):
- [B03] Rule ambiguous: xxx (one-sentence description)
- [B07] Timeliness undefined: xxx (one-sentence description)

**Completeness check**: section coverage X/Y | analytics-event completeness N_extract/N_scan | client-type completeness X/Y | condition branches pass/fail

Complete report saved to: {run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md
```

---

## Output format

> ⚠️ **Important**: the following format is the complete format written to the local file `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`; **it is not the conversation output format**. The conversation shows only the "summary output format" above.

Output as Markdown with the following sections:

### [{project-name}] Requirement analysis and test-object identification report

#### 1. Business goals and user scenarios
Business domain, core problem, success criteria, operation paths listed by role.

#### 2. Function inventory
Organized by module; each function includes: module name, function name, function source-text description (6 bans, 100% fidelity written in full), business rules, implied functions, ambiguities, analytics events, business diagrams, user paths (complete steps for main path / branch / exception), test-scenario list.

#### 3. Technical-architecture and data-model analysis
Architecture current state and change, risk signals, client-type calibration.

**Technical-implementation-object inventory**: each object includes owning module, object type, object name, identified content, extraction source, key branches/constraints, test focus passed to Stage 4, client-type calibration, validation surface. The owning module must match the module name in the Chapter 2 function inventory.

**Data-object inventory**: each object includes owning module, data entity, change type, data volume, sensitivity level, test focus, construction strategy. The owning module must match the module name in the Chapter 2 function inventory.

#### 4. Interface-object inventory
Each interface includes owning module, serviceId, path, protocol (one of HTTP/Thrift/InternalRPC; an RPC interface must not be written generically as RPC; fill `---` and add a pending clarification item when it cannot be confirmed; do not infer from naming style), change type, request-parameter JSON (complete structure), response-structure JSON (complete structure), compatibility risk, test strategy. The owning module must match the module name in the Chapter 2 function inventory. Fill `---` when `serviceId` is not written.

#### 5. Dependency-object inventory
Owning module, type, name, risk, test strategy. The owning module must match the module name in the Chapter 2 function inventory.

#### 6. Analytics-event-object inventory
Each analytics event includes English original name, type (mc/mv/pv and so on), trigger timing, parameters (complete parameter list), owning module. When there are no analytics events, annotate "the requirement document does not contain analytics-event information".

#### 7. Scope boundary
InScope / OutOfScope / Pending Scope / Technical-risk Scope.

#### 8. Technical-risk inventory (R01-R12)
Type, object, response strategy.

#### 9. Business-diagram inventory
System-under-test business diagrams (extracted and registered per the "Business-diagram extraction and registration" section, including URL, containing section, owning module, corresponding page, page-function description); when there are no business diagrams, annotate "the requirement document does not contain page diagrams"

#### 10. Business-risk inventory (B01-B12)
Type, object, response strategy.

#### 11. Mapping deviations and pending clarification items
Deviation description, suggestion, risk level.

#### 12. Completeness check

| Check item | Result | Notes |
|--------|------|------|
| Document section count | X | Total sections identified in the document outline |
| Function-point count | X | Total extracted function points |
| Function-point coverage | X/Y | Covered section count / total function-related section count |
| Analytics-event regex-scan count (N_scan) | X | Count of analytics-event identifiers matched by the regex scan |
| Analytics-event extraction count (N_extract) | X | Count finally extracted into the analytics-event inventory |
| Analytics-event completeness | N_extract/N_scan | If <100%, the miss reason must be explained |
| Condition-branch completeness | pass/fail | Whether every condition branch has corresponding handling |
| Business-diagram registration count | X | Count of extracted and registered system-under-test business diagrams; when the registration count is 0, the "empty-judgment rescan fallback" scan-count evidence (transcription-block count / original-marker count / fetch-failed count) and conclusion must be attached; an unevidenced empty judgment is treated as a failed check |
| Content-missing warning | yes/no | Whether any section content is missing or ingest failed |

If any check item fails, it must be annotated explicitly, and the missing parts must be risk-marked in later-stage analysis.

After Stage 1 persist, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 1` (redirect stdout only). If `ok` is false, do not enter Stage 2.
