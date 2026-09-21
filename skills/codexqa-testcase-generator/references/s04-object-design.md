# Stage 4: Test-object type analysis and test design

## Minimum persist (this stage)

- File: `{run_dir}/testcase/testdocs/stage4-test-design-report.md`
- File: `stage4-*/index.json`
- Required headings: `Type-identification results` | `Test-scenario summary` | `Test-scenario ID`

Based on prior-stage results, identify test-object types (10 major types), analyze characteristics, match test-design methods, and output test scenarios. For existing cases already recalled in Stage 3, mark coverage status and avoid duplicate design.

## Reading guide

Read in order: inputs and knowledge consumption → type identification and characteristic analysis → scenario classification and coverage → method matching → output format. Read scenario-fusion rules separately in [scene-fusion.md](scene-fusion.md).

## Inputs

> Before this stage starts, first confirm `run_dir` is available per [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" (userConfig.runDir → user-specified path → this Skill's initialized default directory). Do not perform any read or write before confirmation.

- Stage 1 output: read from `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md` (function list, technical architecture, data model, API list, five-dimension test-object list, user journeys)
- Stage 2 output: read from `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md` (P0-P3 Priority partitioning, high-risk items, impact-scope analysis)
- Stage 3 output: read from `{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md` (reuse list, change list, blank-scenario list (if Stage 3 already ran))


---

## Stage 4 knowledge consumption

> Knowledge-interaction adaptation is unified in [knowledge-adapter.md](knowledge-adapter.md); output templates are in [knowledge-receipt-templates.md](knowledge-receipt-templates.md).

### Consumption timing

Before test-object type classification, and before scenario generation.

### Knowledge fetch

First reuse Stage 1–3 reports and `index.json`. Test-design methods follow this repo's built-ins: T01–Txx in `s04-object-design.md`, `scene-fusion.md`, 5:3:2, P0–P3 defaults, and the three-end templates. Only when the user has already provided a local knowledge directory, supplement team-custom rules from `knowledge/index.md`. With no local pack, do not ask, and do not compress high-risk scenario design.

| Filter dimension | Value |
|---------|------|
| stage | `test-design` |
| Knowledge dimension | Built-in norms first; the local pack only supplements team-custom rules |

### Needed knowledge types

| Knowledge type | Source | Priority | Use |
|---------|------|--------|------|
| Test-object types and models | Built-in `s04-object-design.md` | Required | T01–Txx, matrix and expansion methods |
| Scenario fusion and dedup | Built-in `scene-fusion.md` | Required | Split, merge, dedup |
| Case structure | Built-in three-end templates | Required | Scenario granularity and verification-point organization |
| Ratio and Priority defaults | Built-in 5:3:2, P0–P3 rules | Required | Default design constraints when there is no local pack |
| Custom generation rules | Optional local pack | Optional | Team aggregation / dedup / tags; must not override the P0-P3 first draft |
| Business-custom test methods | Optional local pack | Optional | Correct 5:3:2; if none, use the built-in ratio |
| Test focus / regression strategy | Requirements, Stage 2, optional local pack | Optional | Raise-priority basis; if none, use only Stage 2 `risk_priority` |
| Defect patterns / implicit test points | Requirement retrospectives, optional local pack | Optional | Defensive scenarios; if none, do not invent experience points |

### Close-reading-layer execution

**Knowledge stacking**: first design scenarios with the built-in type models and fusion rules. Only when `knowledge/index.md` has entries, then filter test focus, regression strategy, samples, and custom rules by functional module, dedup, and inject. Do not concurrently retrieve from a "business knowledge base + case knowledge base" dual store.

**Keyword combination**: base keywords (functional-module name + test-object type, e.g. "merchant whitelist form submit" "transaction fulfillment state transition") + stage modifiers (test focus / regression strategy / test method / defect / implicit / sample / rule).

**Close-reading rules**:

| Item | Spec |
|------|------|
| Close-reading objects | Test focus, regression strategy, custom test methods, core-scenario Priority, defect patterns, implicit test points, sample cases |
| Close-reading products | Test scenarios and coverage strategy (core business-scenario Priority, positive/negative ratio, business-exception / business-concurrency / contract-compatibility scenarios, fusion and dedup rules); when a defect pattern that would affect a business result is hit, generate a defensive scenario |
| TopN · budget | Single group Top10; sample same type ≤3 items |
| Stop condition | Every high-risk feature point has a corresponding scenario; defect patterns in the requirements or local pack already have defensive scenarios (if none, do not invent) |

**Output**: output per the Stage 4 template in [knowledge-receipt-templates.md](knowledge-receipt-templates.md), and persist to `{run_dir}/testcase/knowledge-biz/{project-name}/stage4-test-design/`.

### Knowledge use

The four design models and scenario refinement are constrained by built-in methods by default; stack business-custom test methods only if the local pack has them. Stage 2 `risk_priority` is the Priority base; test focus and regression strategy in the local pack may raise Priority. With no local pack, do not invent implicit test points or defect patterns. If implicit test points come from a requirement retrospective or the local pack, map them to supplemental scenarios and mark the source.

### Prefer business functions and de-noise non-functionals

The default Stage 4 goal is to turn business functions, visibility changes, and key technical implementations in the requirements / technical design into verifiable test scenarios. Treat non-functional content as a secondary concern; do not over-compress core business-function and visibility coverage because of specialized risks.

Classification principles:

| Type | Enter test-design scenarios | Handling |
|------|----------------------|---------|
| Constraints that change API return, data state, business rules, error code, idempotent result, downstream-consume result, or page-visibility result | Yes | Expand as business-function or visibility scenarios |
| Gray / switch / experiment that directly decides new vs old business logic, API result, or page-display result | Yes | Cover only the verifiable business results of hit / miss / after-off |
| Capacity, load test, Profiling, monitoring alerts, release-rollback operations, circuit-breaker drills, chaos drills, security scans | No | Do not output test scenarios this period; do not enter the main business-function or visibility test-design chain |
| Materials only contain launch-assurance statements such as "needs gray / rollbackable / watch performance / needs monitoring", with no defined verifiable business result | No | Do not output test scenarios this period |

Output requirements:
- Prefer covering the core chain, business rules, API contract, state transitions, data consistency, idempotency, and business returns after dependency exceptions in business-function scenarios.
- Visibility scenarios normally keep page display, interaction, analytics-event, and client-side-behavior verification points, for later visibility test-chain consumption.
- Do not split load-test, release-rollback, monitoring-alert, and other assurance tasks into ordinary test scenarios, and do not extra-output side files.

### Standard-scenario-library conditional-load rules

Analytics-event standard test scenarios (MV/MC/PV) and generic interaction-pattern standard scenarios (LIST/CLICK/SHOW) are Skill built-in norms and do not depend on a local knowledge pack.

Stage 4 decides whether to load the UI / visibility standard scenario library from the final client type:

| Stage 4-1 final client-type decision | Load rule |
|------------------------|---------|
| server | Do not load the body of [ui-visible-scenarios.md](ui-visible-scenarios.md); keep only source-text-level visibility scenarios and the client-type calibration basis |
| web / app | Read [ui-visible-scenarios.md](ui-visible-scenarios.md) and expand T06/T08, LIST/CLICK/SHOW scenarios per its rules |
| unknown | Do not force-fill a client-type decision; keep pending-clarification items; do not enter standard-scenario-library expansion |

If the PRD / technical design contains UI display, interaction, or analytics-event content, Stage 4 must first give the final client-type decision; when the decision is web/app, expand standard-scenario-library details; when the decision is server, keep source-text-level visibility scenarios; if unknown, record the reason and leave it pending clarification.

### First-draft Priority adjudication rules (mandatory)

Stage 4 produces a first-draft Priority and a Priority basis for each test scenario, to express this stage's design judgment based on risk, test focus, and regression strategy.

#### Input fields

| Field | Source | Meaning |
|------|------|------|
| `risk_priority` | Stage 2 impact-scope and risk analysis | Priority Stage 2 computed from business risk and technical risk |
| `test_focus_priority_floor` | Requirements / Stage 2 / optional local pack | Priority floor converted from "test focus"; empty if none |
| `regression_priority_floor` | Requirements / Stage 2 / optional local pack | Priority floor converted from "regression strategy"; empty if none |
| `existing_case_priority` | Stage 3 existing-case recall | Original Priority of the existing case; read-only; does not participate in new-scenario Priority adjudication |

#### Single-scenario adjudication

1. First collect candidate Priorities for the current test scenario: Stage 2 `risk_priority`, `test_focus_priority_floor`, `regression_priority_floor`.
2. Convert `regression_priority_floor` from the regression strategy: scenarios that hit "P0 must-regress", "core-chain must-regress", or "core regression list" have candidate Priority P0; scenarios that hit "P1 sample" or "focus sample regression" have candidate Priority P1; hitting "skippable" does not produce a raise-priority candidate and must not lower other candidate Priorities.
3. Convert `test_focus_priority_floor` from the test focus: scenarios that hit "focus verification", "must cover", or "minimum coverage standard requires exception / concurrency / state-machine / funds-inventory and other deep verification" have candidate Priority at least P1; if the test focus is explicitly bound to a P0 core chain or must-regress list, the candidate Priority is P0; ordinary design-direction notes do not produce a raise-priority candidate.
4. The first-draft Priority takes the highest Priority among all candidates, in the order `P0 > P1 > P2 > P3`; local-pack / requirement raise-priority only raises Priority and does not lower the Stage 2 risk Priority. When there is no raise-priority candidate, use Stage 2 `risk_priority` directly.
5. Keep `existing_case_priority` of existing cases at the original value; do not modify it and do not override the Stage 4 new-scenario first-draft Priority; when reusing / changing existing cases, record it only as a read-only note.

#### Fused-scenario adjudication

When multiple sub-scenarios fuse into one test scenario, first get each sub-scenario's first-draft Priority by "single-scenario adjudication", then take the highest value by `P0 > P1 > P2 > P3` as the fused scenario's first-draft Priority.

#### Output requirements

The "Priority" column in the Stage 4 scenario table must fill the already-adjudicated first-draft Priority; do not fill a candidate value, a conflict value, or "pending confirmation". Also add a "Priority basis" column and record the source:

- `Test-focus raise: {source-file}, {scenario-type}=focus verification, Priority floor=P1`
- `Regression-strategy raise: {source-file}, {scenario-name}=core-chain must-regress, Priority floor=P0`
- `Stage 2 risk Priority: {risk-item-ID/chapter}=P2`
- `Fusion take-high: sub-scenario A=P1, sub-scenario B=P0, final P0`

If the Priority of an existing case recalled in Stage 3 differs from the Stage 4 first-draft Priority, record it only as a read-only note in "Priority basis", e.g. `existing case caseId=123 original Priority=P0, keep original value when reused`; it does not participate in this stage's new-scenario Priority adjudication.

---

## Part 1: Type identification and characteristic analysis

### 10 major type classes

| ID | Type | Core traits | Identification marks |
|------|------|---------|---------|
| T01 | Input form | Many fields, complex rules, clear boundaries | Large number of input fields, validation rules |
| T02 | Business process | Many steps, state transitions, role collaboration | Multi-step chaining, state changes |
| T03 | Data calculation | Complex formulas, precision-sensitive, multi-source aggregation | Calculation logic, precision requirements |
| T04 | API service | Parameter combinations, protocol norms, exception handling | Inter-service calls, parameter passing |
| T05 | Configuration rule | Condition combinations, rule conflicts, Priority | Rule engine, condition judgments |
| T06 | Interaction experience | Multi-end adaptation, response feedback, exception guidance | UI interaction, multi-end differences |
| T07 | Data persistence | State save, concurrency control, consistency | Data storage, read/write operations |
| T08 | Analytics-event tracking | Event definitions, parameter norms, reporting chain | Analytics-event IDs, report timing |
| T09 | File / multimedia | Format support, size limits, processing logic | File types, compress/transcode |
| T10 | Task scheduling | Timing policy, execution logic, failure retry | Cron expressions, schedule period |

Note: one test object may belong to multiple types; classify by the primary trait and supplement analysis for secondary types.

### Type-identification decision tree

```
Start
├─ Data reporting / behavior tracking? ──► T08 Analytics-event tracking
├─ File upload / download / processing? ──► T09 File / multimedia
├─ Timed / delayed / batch?   ──► T10 Task scheduling
├─ Input validation is primary?       ──► T01 Input form
├─ Multi-step state transition?     ──► T02 Business process
├─ Complex calculation / statistics?      ──► T03 Data calculation
├─ Inter-service call / API?     ──► T04 API service
├─ Condition-rule judgment?       ──► T05 Configuration rule
├─ UI interaction / multi-end adaptation?    ──► T06 Interaction experience
└─ Data storage / cache?      ──► T07 Data persistence
```

### Four-dimension characteristic analysis per type

Analyze each test object on the static / dynamic / association / exception four dimensions. The following are the analysis points and test focuses of each type:

**T01 Input form**: static (field type, length, value range, validation rules, default value) → boundary value + equivalence class; dynamic (real-time validation, linked display, duplicate submit) → validation timing + linkage accuracy; association (dictionary dependency, cascaded selection) → dependency consistency; exception (error prompt, XSS/SQL-injection protection, sensitive-field encryption) → security testing.

**T02 Business process**: static (process steps, role permissions, state definitions) → step completeness + state completeness; dynamic (state transition, event trigger, parallel / serial, subprocess) → transition correctness + concurrency safety; association (upstream/downstream join, message notification) → join completeness; exception (rollback, compensation, timeout, Saga/TCC orchestration) → rollback feasibility + transaction consistency.

**T03 Data calculation**: static (calculation formula, precision requirement, rounding rule) → formula correctness; dynamic (real-time / offline calculation, trigger timing, concurrent calculation) → trigger accuracy; association (multi-source aggregation, FX / tax-rate dependency) → data consistency; exception (divide-by-zero, null, oversized number, float / Decimal precision) → boundary protection + precision testing.

**T04 API service**: static (protocol, parameter structure, return value, error code) → contract compliance; dynamic (call timing, timeout-return semantics, result after retry) → timing correctness; association (service dependency, call chain, gateway routing) → dependency-return semantics; exception (dependency exception, business fallback, idempotency) → fallback result + idempotent result.

**T05 Configuration rule**: static (rule condition, action, Priority, effective time) → condition completeness; dynamic (rule match, execution order, hot update) → match accuracy; association (inter-rule dependency, multi-rule overlay, switch / experiment hit rule) → overlay expectedness; exception (conflict arbitration, default rule, fallback business result) → conflict resolution + default result.

**T06 Interaction experience**: static (page layout, components, style, copy) → layout adaptation; dynamic (page load, async render, animation, response time) → load performance; association (multi-end adaptation iOS/Android/Web/mini program, resolution) → multi-end consistency; exception (weak / disconnected network, empty state, debounce / throttle, first screen / memory / frame rate) → weak-network experience + performance metrics.

**T07 Data persistence**: static (storage medium, table structure, indexes, sharding) → structure reasonableness; dynamic (read/write ratio, concurrent access, connection pool, slow query) → concurrency safety; association (primary-replica sync, shard strategy, heterogeneous sync) → sync consistency; exception (transaction isolation, deadlock, failure recovery, distributed transaction) → consistency guarantee.

**T08 Analytics-event tracking**: static (analytics-event ID, event type, parameter list) → parameter completeness; dynamic (trigger timing, report order, sample rate) → timing accuracy; association (related page, user journey, attribution) → chain completeness; exception (network retry, local cache, dedup) → weak-network guarantee.

**T09 File / multimedia**: static (file format, size limit, resolution / bitrate) → format support + boundary size; dynamic (upload / download, compress/transcode, resumable transfer) → flow completeness; association (OSS/CDN, content review) → storage consistency; exception (format exception, over-limit, network interrupt) → exception prompt.

**T10 Task scheduling**: static (task type, Cron period, execution window) → Cron accuracy; dynamic (trigger execution, concurrency control, failure retry) → trigger accuracy; association (dependent tasks, task shards) → dependency completeness; exception (failure retry, dead-task detection, human-operation concurrency conflict, impact on the dependency chain after a task is skipped) → concurrency safety + dependency completeness.

### UI / visibility standard scenario library

See [ui-visible-scenarios.md](ui-visible-scenarios.md) for T08 analytics-event standard scenarios and LIST/CLICK/SHOW generic-interaction standard scenarios. Whether to read that file is decided by the "Standard-scenario-library conditional-load rules" above.

### All-type characteristic comparison matrix

| Type | Core concerns | Key test data | High-risk scenarios |
|------|-----------|-------------|-----------|
| T01 | Boundary values, rule coverage | Boundary values, illegal characters, overlong data | Security injection, boundary overflow |
| T02 | State transition, flow completeness | State combinations, exception interrupt points | State disorder, flow deadlock |
| T03 | Precision, formula correctness | Extremes, divide-by-zero, precision boundaries | Amount errors, statistics distortion |
| T04 | Contract, timeout semantics, fault tolerance | Parameter combinations, batch boundaries, dependency exceptions | Contract break, wrong fallback result |
| T05 | Rule conflict, Priority | Rule combinations, boundary conditions | Rule failure, misjudgment |
| T06 | Multi-end consistency, performance | Multi-resolution, weak-network environment | Adaptation disorder, performance stutter |
| T07 | Consistency, concurrency safety | Concurrent data, large transactions, fault injection | Dirty / phantom reads, data loss |
| T08 | Completeness, accuracy | Event sequences, sampled data | Missed reports, attribution errors |
| T09 | Format compatibility, completeness | Boundary sizes, exception formats | Transcode failure, transfer interrupt |
| T10 | Schedule accuracy, fault tolerance | Cron boundaries, dependency chains | Missed schedule, retry storm |

### Priority × type cross analysis

| Priority | Types to focus on | Analysis depth |
|-------|-------------|---------|
| P0 | T02 Business process, T03 Data calculation, T04 API service | Deep analysis of all characteristic dimensions |
| P1 | T01 Input form, T05 Configuration rule, T07 Data persistence | Core characteristics + risk characteristics |
| P2 | T06 Interaction experience, T04 API service (non-core) | Main-characteristic analysis |
| P3 | All types (edge functions) | Basic characteristic identification |

---

## Part 1.5: Scenario classification and coverage principles (mandatory)

### Three-way scenario classification principles

Each test object's test scenarios must be designed in the following three classes, **with a target ratio of normal:boundary:exception = 5:3:2**:

#### 1. Normal scenarios (Happy Path)
- Standard business flow, no exception input
- Typical user operation sequences
- In-expectation data combinations
- Normal use paths for multiple roles / multiple ends

#### 2. Boundary scenarios (Boundary Cases)

**Numeric boundary**: min, max, critical values (min-1, min, min+1, max-1, max, max+1)

**Length boundary**: empty, single character, max length, overlong (max+1)

**Time boundary**: start time, end time, cross-day / cross-month / cross-year, timezone boundary

**Count boundary**: zero items, single item, batch upper limit, over-batch

**Special boundaries**:
- Numeric types: 0, negative, extreme, decimal precision (e.g. amount precision)
- String types: empty string, all spaces, special characters (`<>'"&`), emoji, Chinese-English mix
- Date types: leap-year Feb 29, last day of month, cross-timezone, historical date, future date
- File types: empty file, oversized file, special format, filename containing special characters

#### 3. Exception scenarios (Exception Cases)

**Input-layer exceptions**:
- Invalid input: type error (string passed to a numeric field), format error (date format mismatch), illegal characters (SQL injection, XSS script)
- Missing parameter: required field empty, required field missing
- Extra parameter: pass extra fields not defined by the API

**Permission / identity exceptions**:
- Unauthenticated access to a function that requires login
- No-permission action (privilege escalation, cross-tenant access)
- Permission expired (Token expired, session timeout)
- Permission revoked during the action

**Business-layer exceptions**:
- Business-rule violation (e.g. insufficient balance, insufficient inventory, over limit)
- Wrong state transition (perform a disallowed action on a completed / cancelled order)
- Duplicate action (duplicate submit, duplicate payment, duplicate create)
- Concurrency conflict (multiple people modifying the same resource at the same time)

**Resource / dependency-layer exceptions**:
- Network interrupt / timeout (API request timeout, weak-network environment)
- Third-party service unavailable (payment service, SMS service, map-service exception)
- Database connection failure, cache invalidation
- Insufficient storage (disk full during file upload)

### Boundary-value analysis norms

For every input field with a numeric / length / range constraint, determine boundary-value coverage depth by the field's risk level, concentrate effort on high-risk fields, and avoid case bloat on low-risk fields:

#### Field-risk layering (analysis guidance)

| Risk level | Applicable fields | Suggested coverage depth |
|---------|---------|--------------|
| High risk | Funds / calculation-critical fields (amount, quantity, discount, rate, points, inventory, etc.) | Full coverage: 0, negative, min, max, extremes, precision boundaries |
| Medium risk | Business-rule-critical fields (status, type, enum, category, etc.) | Full set (all legal values) + 1 superset (illegal value) + empty |
| Low risk | Ordinary display / auxiliary fields (name, description, remark, address, etc.) | Empty + max length + overlong |

> Field risk level is driven by the test object's type and Priority: fields involved in T03 Data calculation default to high risk; fields of P0 scenarios default to medium risk or above; the rest are low risk. During analysis you may mark field risk level in the "four-dimension characteristic analysis".

#### Boundary-value reference-point set (exhaustive reference for high-risk fields)

| Boundary type | Reference values | Notes |
|---------|-------|------|
| Numeric range [min, max] | min-1, min, min+1, max-1, max, max+1 | 6 boundary points |
| String length [0, maxLen] | 0 (empty), 1, maxLen-1, maxLen, maxLen+1 | 5 boundary points |
| Set / enum | Empty set, single element, full set, superset (value outside the enum range) | 4 boundary points |
| Time range | start-time-1s, start time, end time, end-time+1s | 4 boundary points |

> The above is an exhaustive reference for high-risk fields; low-risk fields only need to cover empty + max length + overlong. Actual coverage depth is decided by the test object's risk level and business importance; attention should go first to deep verification of business-interaction logic.

### Exception-scenario design norms (mandatory)

Generate exception test points from the following four dimensions; **each functional module must cover at least 2 of them**:

**Dimension 1: Input-layer exceptions**
- Missing parameter (required field empty)
- Parameter type error (string passed to a numeric field)
- Data-format error (date format, phone-number format)
- Injection attacks (SQL injection, XSS script injection)

**Dimension 2: Business-layer exceptions**
- Business-rule violation (insufficient balance, over limit)
- Wrong state transition (perform an action on a disallowed state)
- Insufficient permission (no permission to access / operate)
- Concurrency conflict (duplicate submit, concurrent modify)

**Dimension 3: Dependency-layer exceptions (output a scenario only when it changes the business result)**
- Database connection failure
- Third-party service unavailable (timeout / return error)
- Cache invalidation (cache penetration / breakdown)
- Message-queue blockage

**Dimension 4: Resource-layer exceptions (output a scenario only when it changes the business result)**
- Network interrupt / weak network (request timeout, reconnect after disconnect)
- Insufficient storage
- Concurrency over limit (rate-limit triggered)

### Scenario-coverage self-check list (confirm every item before Stage 4 output)

- [ ] Every functional module has corresponding test points (normal + boundary + exception)
- [ ] Every key input field has covered boundary values by field risk level (do not do meaningless exhaustive coverage on low-risk fields)
- [ ] Every business process has exception scenarios (failure / timeout / insufficient permission)
- [ ] Every API that involves write / create has an idempotency test (duplicate submit / duplicate message consume)
- [ ] Every business rule has at least 1 positive + 1 negative test
- [ ] Test-point descriptions are concrete and executable, with no ambiguity (avoid "test login function"; write "log in successfully with the correct phone number and verification code")
- [ ] Expected results are verifiable; avoid vague descriptions (avoid "the page displays normally"; write "navigate to the home page; the upper-right shows the user nickname")
- [ ] No duplicate or redundant test points
- [ ] Priority marks are reasonable; core functions are P0
- [ ] Normal:boundary:exception scenario ratio is close to 5:3:2
- [ ] Server-side technical objects that Stage 1-B identified as InScope and that have a verifiable behavior / constraint each have at least one corresponding model product or test scenario
- [ ] States / enums / decision tables / Priority rules in the technical design have been expanded into a state matrix or decision table, and not only a final-state list has been kept
- [ ] Downstream dependencies in the technical design have covered the applicable branches among success-nonempty, success-empty, failure, timeout, illegal response, and partial success
- [ ] Server-side business-result constraints in the technical design such as short-circuit, fallback, API compatibility, data consistency, idempotency, and dependency exceptions have been covered by scenarios or marked pending clarification; specialized content such as capacity load-test, release rollback, and monitoring alerts has not entered the main scenarios

---

## Part 2: Test-design method matching

### Four major test-design models

**1. Input-output model (IN)**: applies to T01/T04. Identify every input item and its constraints → define equivalence classes and boundary values → build the mapping between input combinations and outputs. Artifact: input-output matrix.

**2. State-machine model (ST)**: applies to T02/T06/T10. Identify every state and trigger event → define transition rules (including condition guards) → mark illegal transitions → define transition side actions. Artifact: state-transition table + state-machine diagram.

**3. Cause-effect graph model (LG)**: applies to T03/T05/complex business rules. Extract cause and effect nodes → analyze logical relations (AND/OR/NOT/XOR) → add constraint relations → convert to a decision table and optimize. Artifact: decision table + test-rule set.

**4. Sequence / call-chain model (SEQ)**: applies to T04 distributed calls / T07 / T08. Identify call-chain participants → draw the normal sequence → mark data inputs and outputs → add exception branches (timeout / failure / retry / degrade) → analyze concurrency-timing issues. Artifact: sequence diagram + call-chain data-mapping table.

### Server-side technical-branch expansion rules (prefer business functions; mandatory)

When Stage 4 faces a server-side test object, do not write only the final return state as one scenario. You must reuse the technical-object types and key branches extracted in Stage 1-B, first expand the rules, states, APIs, data, and dependency branches that affect business-function implementation into a verifiable server-side test matrix, then merge them into final scenarios per the scenario-fusion rules. This section only defines the expansion method; it does not redefine Stage 1-B object classification.

| Technical-object signal | Main-scenario expansion condition | Typical artifacts |
|-------------|---------------|-----------|
| API contract | Required / optional, legal / illegal, boundary values, compatible fields, error codes, response wrapping affect the API result | Input-output matrix, equivalence classes, boundary-value table |
| Business orchestration | Precondition not met, main flow, short-circuit, post-processing, repeat call, exception interrupt affect the business result | Flow-branch table, call-chain scenarios |
| Rule adjudication | State, state combination, Priority conflict, default / unknown branch, mutually exclusive rules affect the business decision | State-transition table, decision table |
| Dependency interaction | Success-nonempty, success-empty, failure, timeout, illegal response, partial success change this API's return or persist result | Sequence diagram, exception-branch table |
| Data transformation | Field mapping, default value, precision / unit, null, enum mapping, field loss affect business semantics | Transformation mapping table, field-validation scenarios |
| Data read/write | Consistency, idempotency, duplicate consume, concurrency conflict, compensation affect the final data state | Data-consistency scenarios, idempotency scenarios |
| Batch / rate-limit / degrade semantics | deadline, batch, rate-limit, degrade directly define the API return semantics or the business fallback result | Server-side behavior scenarios; otherwise do not output test scenarios this period |
| Switch / experiment / compatibility semantics | Switch off, gray miss, old version directly define the new-vs-old business-logic difference | Compatibility / switch business scenarios; do not output test scenarios for release-rollback operations this period |

**Expansion requirements**:
- Expand first, then fuse. For the same technical object, first list every key branch, then dedup per the scenario-fusion rules; do not first compress to a single state.
- One test scenario may fuse multiple conditions, but must not swallow key branch semantics; any branch the technical design explicitly distinguishes must be kept in the Stage 4 model product or scenario description.
- If the technical design shows signals such as "state / enum / Priority / fallback / short-circuit / timeout / failure / empty response / partial success / compatibility / gray", first judge whether they change the server-side business result; if they change it, enter the main scenarios; if they do not, do not output test scenarios this period.
- For server-side APIs, Stage 4 output should first form a three-layer structure of "business-state matrix + dependency-return semantics + data consistency / idempotency", then enter scenario fusion.

### Type-to-model matching guide

| Type | Preferred model | Auxiliary model | Selection reason |
|------|---------|---------|---------|
| T01 Input form | IN | LG | Many fields and complex rules; need equivalence classes and boundary values |
| T02 Business process | ST | SEQ | State transition is the core |
| T03 Data calculation | LG | IN | Multi-condition combinations; need decision-table coverage |
| T04 API service | IN | SEQ | Parameter combinations are primary; distributed needs sequence analysis |
| T05 Configuration rule | LG | ST | Rule conflicts need cause-effect analysis |
| T06 Interaction experience | ST | IN | Page-state transition is the core |
| T07 Data persistence | SEQ | ST | Concurrent read/write timing is the core |
| T08 Analytics-event tracking | SEQ | IN | Event-report timing is the core |
| T09 File / multimedia | IN | ST | Format / size input is primary |
| T10 Task scheduling | ST | SEQ | Task-state transition is the core |

---

## Output format

Write the complete report into the single file `{run_dir}/testcase/testdocs/stage4-test-design-report.md` (produce only this one file).

Output Markdown containing the following chapters:

### [project-name] Test-object type analysis and test design

#### 1. Type-identification results

For each test object list: TO ID, object name, owning module, type (may be multi-type), Priority, four-dimension characteristic analysis, test focus, related risks.

The owning module must be inherited from the matching Stage 1 object list (function, technical implementation, data, API, dependency, or analytics event); do not summarize it yourself. Each test object may belong to only one module; if a Stage 1 source object involves multiple modules, it must be split in Stage 1 into independent objects owned by module before entering Stage 4.

Output format: test-object list table + per-object four-dimension characteristic analysis (sectioned text).

#### 2. Type-distribution statistics and Priority-type matrix

Count of each type; which types of test objects P0-P3 each contain. Output as a statistics table + a matrix table.

#### 3. Method matching and model products

Each test object's preferred / auxiliary model and selection reason.

**Model-product production rules**: produce a model product only when the test conditions in it will convert directly into test scenarios. You do not need to draw a model for every object — parameter-validation classes can list boundary values directly; simple field-mapping classes do not need a decision table. Produced model products (state-transition table / input-output matrix / decision table / sequence diagram) immediately follow that object's matching notes.

**Self-check constraint**: every test condition in a model product must have a corresponding scenario in the Chapter 4 scenario table. If any is missing, add the scenario.

#### 4. Test-scenario summary

Based on the type analysis and model products, summarize every test scenario. **Group by test object**, one scenario table per test object; the group title must include that TO's owning module (e.g. `Module: activity config｜TO-01: activity-type validation`). The scenario table is Stage 4's core output.

##### Scenario-table column definitions

| Column | Notes | Fill requirements |
|------|------|---------|
| **Test-scenario ID** | Unique scenario identifier | Format S-01, S-02...; continuous numbering across the whole document; do not reset per object |
| **Test point** | Fused scenario description | In one sentence, say clearly what is verified; summarize fused sub-points in parentheses (e.g. "Full state-matrix coverage (6 states × 7 input combinations)"); do not end vaguely with "etc." |
| **Priority** | P0/P1/P2/P3 | First-draft Priority after Stage 4 adjudication. Combine Stage 2 `risk_priority` and requirements / local-pack "test focus" "regression strategy", take the highest Priority; for a fused scenario take the highest |
| **Priority basis** | Stage 2 / requirements or local-pack raise / fusion take-high / existing-case note | Record the first-draft Priority source and basis; existing-case Priority is a read-only note and does not participate in new-scenario adjudication |
| **Scenario type** | normal / boundary / exception | For a fused scenario fill primary type + attached (e.g. "normal+boundary"); for a pure single type fill one |
| **Coverage status** | new / reuse / change | Comes from Stage 3 existing-case recall results; fill all as "new" if Stage 3 did not run |
| **Preconditions** | Data preparation | See the fill norms below |
| **Verification point** | Sub-verification-point description | See the fill norms below |
| **Related test object (TO)** | Related test-object IDs | Fill the Chapter 1 test-object ID (TO ID, e.g. TO-01); when relating multiple TOs, all TOs must belong to the same module. If a business chain crosses modules, split into each module's own verification scenarios; do not relate across modules in a single scenario; owning module is obtained by looking up the Chapter 1 TO list via this field; do not repeat it in the scenario table |

##### Preconditions fill norms

Preconditions describe only data preparation, numbered with 1）2）3）, corresponding one-to-one with the verification-point ①②③ numbers:

```
1）[sub-point 1 data preparation] 2）[sub-point 2 data preparation] 3）[sub-point 3 data preparation]...
```

**Numbering rules**:
- Number the data preparation each sub-verification point needs with 1）2）3）, corresponding one-to-one with the verification-point ①②③ numbers
- If every sub-verification point's data preparation is the same, write only one item and do not number
- Test environment / environment ID is not extracted in Stage 4; Stage 6 Preconditions placeholder it, and Incremental `test_env` then backfills it

**Data-preparation quality requirements**:

1. **State business constraints clearly**: in natural language write what the object is, what state it is in, and what business conditions it meets
   - ✅ Product A is listed, sellable, inventory sufficient; order O1 is paid and not yet fulfilled
   - ❌ Product A status is normal; order O1 is fully ready and can be tested normally

2. **Reject vague words; write until it is "decidable"**: "normal, available, has a coupon, configured" must be replaced with: object type + key state + amount / quantity / boundary value. Do not chase field-level precision
   - ✅ User U1 has claimed one platform coupon C1 of spend-100-off-20; the coupon is currently valid and applies to product A; product A price is 100 yuan, buy 1
   - ❌ User U1 has a coupon; product price is normal; the spend-threshold is met

3. **Multi-object scenarios must explicitly write inter-object relations** (ownership, applicability, association)
   - ✅ Coupon C1 applies only to product A, not to product B; product A and product B both belong to store S1; account M1 is bound to store S1 and has manage permission
   - ❌ Prepare coupon C1; prepare two sellable products A and B; prepare one merchant account M1

4. **Write data together in Preconditions; steps write only actions**: advance dependent prior-state data with "construct a ZZ in YY state through the default XX flow"; do not mix the test-data setup process into the operation steps
   - ✅ Preconditions: through the default place-order-and-pay flow, construct an order O1 that belongs to store S1 and is in paid-not-yet-fulfilled state (the ordered product may be a default sellable product; it does not affect this case)
   - ❌ Steps: 1. Create order 2. Pay order 3. Query order status 4. Cancel order

##### Verification-point fill norms

Number verification points with ①②③, corresponding one-to-one with Preconditions 1）2）3）:

```
①[sub-verification-point 1 description + expected value]
②[sub-verification-point 2 description + expected value]
③[sub-verification-point 3 description + expected value]
```

- Each verification point must contain a **concrete verifiable expected value** (field name, return value, status code, etc.); ban vague descriptions such as "returns normally" "operation succeeded"
- One test point may have only one verification point (no numbering), or multiple sub-verification points (numbering aligned)
- The numbers strictly align with Preconditions 1）2）3）

##### Scenario-table example

**TO-01: statusQuery state matrix (T04 API service, P0)**
| Test-scenario ID | Test point | Priority | Priority basis | Scenario type | Coverage status | Preconditions | Verification point | Related test object (TO) |
|------|--------|--------|------------|---------|---------|---------|--------|--------|
| S-01 | Full state-matrix coverage (condition combination → result matrix) | P0 | Stage 2 risk Priority: RA-RISK-01=P0 | normal+boundary+exception | new | 1）Resource A does not meet the preconditions 2）Resource B meets the preconditions but subject U1 is ineligible 3）Resource C meets the preconditions + subject U1 is eligible, but candidate data is empty 4）Resource D meets the preconditions + subject U1 is eligible, candidate data is available 5）Resource E meets the preconditions + subject U1 is eligible, no new candidates but there is existing valid data 6）Resource F meets the preconditions + subject U1 is eligible, candidates exist but all are unavailable 7）Resource G meets the preconditions + subject U1 is eligible, the dependency service times out or returns an illegal response | ①Return NOT_APPLICABLE, result data empty ②Return NOT_APPLICABLE, result data empty ③Return NO_DATA, result data empty ④Return AVAILABLE, result data contains available items ⑤Return EXISTING_VALID, result data contains existing valid items ⑥Return UNAVAILABLE, result data empty ⑦Return UNKNOWN, result data empty | TO-01 |

##### Scenario statistics and self-check

After the scenario table is output, you must run the following self-check:

**Scenario-ratio self-check**:
| Class | Count | Share |
|------|------|------|
| Normal scenarios | | |
| Boundary scenarios | | |
| Exception scenarios | | |
| **Total** | | |

Target ratio normal:boundary:exception = 5:3:2; exception-scenario share not below 15%.

**Fusion self-check**:
- [ ] Difference sink-down: have enum values and condition branches been sunk into verification points or made implicit?
- [ ] Decision-tree check: does each scenario pass the 3-condition judgment (business goal / processing flow / verification result)?
- [ ] Verification-point integration: have multiple verification points of the same action been integrated into 1 scenario?
- [ ] Chain completeness: have steps with dependency been merged into 1 complete-flow scenario?

**Expected-results self-check**:
- [ ] No vague descriptions such as "displays normally" "operation succeeded"
- [ ] Every verification point contains a concrete verifiable expected value
- [ ] Preconditions numbers correspond one-to-one with verification-point numbers

After Stage 4 persist, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 4` (redirect stdout only). If `ok` is false, do not enter Stage 4-1.
