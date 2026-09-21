# Example: inventory-hold multi-source conflict + P0 verification

Materials: PRD (behavior), API note (constraint), scope sheet (scope). No role report.

## 1. Requirement Understanding and Scope

- Goal: ship inventory hold at checkout in this iteration.
- In scope: the scope sheet lists only the “successful reserve path”.
- Out of scope: failure path and delayed reserve are conflicted, not decided.
- Traceable facts: PRD allows submit when stock is short; API returns 400 and forbids order creation.

## 2. Input and Source Audit

- Sources: PRD=behavior; API note=constraint; scope sheet=scope. Plan and risk classes are missing.
- Completeness: no failure-path AC, no idempotency or restock rule.
- Credibility: all three are user-supplied text with no version IDs.
- Recency: no dates; treated as contemporaneous; cannot prove which is newer.
- Comparability: all three speak to “can an order be created when stock is short”.
- Confirmed facts: all three mention inventory hold.
- Working assumptions: “successful path” excludes insufficient stock.
- Information gaps: which source is authoritative; whether failure path is in scope.
- Quality-characteristic hits: Consistent (PRD vs API); Verifiable (“as needed”); no compound Singular hit.
- Smell hits: `loophole` “as needed” restock (sample wording).
- NFR grid: functional suitability=specified-vague; reliability=missing; performance efficiency=not-applicable; usability=not-applicable; security=missing; compatibility=not-applicable; maintainability=missing; portability=not-applicable.
- Structure inventory: background=thin; goal=present; stories=absent; features=present; NFR=absent; boundary=thin; AC=thin; KPI=absent; dependencies=thin; timeline=absent; prototype=absent.
- Success-metrics grid: north-star=missing; numeric target=missing; data source=missing; time window=missing; negative metric=missing.
- Dependency grid: upstream=thin (API has no owner); downstream=absent; data-and-tracking=absent; sequence=absent; owner+ready date=absent.

## 3. Gap and Conflict Register

**RA-01**
- Topic: Can an order be created when stock is insufficient?
- Sources: PRD; API note
- Status: `conflict`
- Impact: High (delivery / quality / testability)
- Priority: P0
- Question: Allow submit then reserve later, or return 400 and create no order?
- Suggested owner: Product
- Suggested next action: Freeze one observable rule and sync PRD with the API
- QualityChar: Consistent
- Smell: none
- Trace: rule
- VerifyMethod: test
- RiskClass: product-data
- FailureMode: conflict-escape
- Preconditions: available stock < requested quantity; other order fields valid
- Stimulus: submit create-order
- Expected: either an order plus a later reserve task, or HTTP 400 with no order row
- Evidence required: response code, order persistence, stock ledger

**RA-02**
- Topic: Is the failure path in this iteration?
- Sources: scope sheet; PRD
- Status: `missing`
- Impact: High (testability)
- Priority: P0
- Question: Does “successful path only” exclude insufficient stock?
- Suggested owner: Product
- Suggested next action: Confirm scope in writing before case design
- QualityChar: Complete
- Smell: none
- Trace: orphan
- VerifyMethod: inspection
- RiskClass: project-scope
- FailureMode: missed-rule
- Preconditions: signed scope note
- Stimulus: design failure-path cases from the scope sheet
- Expected: failure path is explicitly out or given AC
- Evidence required: scope note or revised sheet

**RA-03**
- Topic: “As needed” restock
- Sources: vague PRD wording
- Status: `untestable`
- Impact: Medium
- Priority: P2
- Question: What trigger, deadline, and idempotency apply?
- Suggested owner: Dev
- Suggested next action: Add an observable condition or drop from the iteration
- QualityChar: Verifiable
- Smell: loophole
- Trace: rule
- VerifyMethod: inspection
- RiskClass: product-functional
- FailureMode: no-oracle

## 4. Risks and Priorities

- Product risk: the wrong create-order rule breaks stock/money. Project risk: unfrozen scope blocks failure-path design; the API has no owner.
- Do not open a second table for metrics or dependencies: missing KPI is `Trace=metric` (not raised to P0 in this sample); API without owner is `project-dependency`.
- P0: S High / O High / D Med; `FailureMode=conflict-escape`.
- P1: S Med / O High / D High; failure path `missed-rule`.
- P2: S Med; “as needed” is `no-oracle` and does not block release alone.

## 5. Testability and Delivery Impact

- Insufficient-stock path cannot become a stable case until the rule is frozen.
- Release gates cannot assert either “forbid create” or “allow delayed reserve”.
- Oracle type: specification (status code + order persistence); RA-03 has no oracle and must not be an executable P0.

## 6. Blockers and Residual Risk

- Blocker: do not start `testcase-writer-plus` until RA-01 is decided.
- Residual risk: even a success-path-only test set can still hit insufficient stock in production unless Product accepts that or expands scope.

## 7. Questions and Next Actions

- Blocking P0: 400-and-forbid vs allow-then-reserve? Close when one written sentence exists and the API contract matches.
- Next: after Product decides RA-01, call `test-strategy` to split success vs failure scope.
