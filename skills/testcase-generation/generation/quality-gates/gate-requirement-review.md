# R1: Requirement analysis review (Analysis Structure Review)

> **Role**: Review the structural completeness and content quality of `analysis.md`, ensuring chapters are complete, change tracing is complete, engineering info is reliable, and risk identification is sufficient — phase 2 generation of design.md depends directly on analysis.md §1.2~§1.5, so any gap or distortion systematically propagates into the test design and every case.
> **Trigger timing**: Run immediately after generate-skill phase 1 finishes generating `analysis.md`; only after this passes may the flow enter phase 2.
> **Token strategy**: analysis.md is usually ≤ 300 lines and can be read in full. Source materials (files under `prd/`) and the passed-in knowledge bases are not loaded in full; grep on demand.

---

## Input

| Input | Description |
|------|------|
| `usecases/testdocs/analysis.md` | The requirement-analysis report under review (read in full) |
| Source material files under `prd/` | Used for comparison (read-only, not loaded in full, grep on demand) |
| `usecases/testdocs/integrations-resolved.json` | The single resolution for engineering subsections and field names; R1-6 checks against `profile.components` and must not require Redis / KV store / Thrift split tables |
| Knowledge bases (all cachePath values available this run; empty if none) | One of the legal provenance sources for R1-6 engineering-info reliability checks; grep yourself to see which bases contain engineering identifiers and use them on demand (read-only); when none are passed in, R1-6 degrades to `prd/`-only provenance |

---

## Execution flow

```
Step R1-1  Structural completeness check (deterministic, script-level)
  ↓ pass
Step R1-2  Requirement-boundary statement extraction (prerequisite; later review depends on it)
  ↓
Step R1-3  Risk identification + change tracing + engineering-info review
  ↓
Step R1-4  Aggregation + disposition
```

---

## Step R1-1: Structural completeness check

Deterministic check, must not be skipped:

| Check item | How to judge | Fail disposition |
|--------|---------|-----------|
| All 5 required chapters exist + §1.6 conditional check | grep that `§1.1`~`§1.5` headings exist; §1.6 is a conditional chapter — if it exists, its table must have content rows (not an empty table / header-only) | Missing a required chapter → block; §1.6 exists but is an empty / header-only table → P2 finding (`INCONSISTENCY_FORMAT_INCOMPLETE`). Whether §1.6 content is a real inconsistency is judged by R1-8 semantic review; R1-1 does not make that conclusion |
| §1.1 responsibility assignment is filled | §1.1 "Responsibility assignment" must list each capability involved in this change and mark it "Implemented at this layer" or "Depends on external", not leftover placeholder text and not left blank | Missing or blank → P1 finding (`DOMAIN_BOUNDARY_MISSING`): if responsibility assignment is undecided, the downstream §2.3 technical-attribute threshold loses its basis, and capabilities that depend on external layers also get extra tests, causing over-expansion |
| §1.5 Risk points table exists | grep `Risk points` | None → block |

**Exit condition**: All pass, enter R1-2.

---

## Step R1-2: Requirement-boundary statement extraction (prerequisite)

Extract and build the boundary statement from analysis.md for use by R1-3:

```
[This requirement scope statement]
- Core changes: extracted from §1.2 Requirement change analysis (each module's change points C-x)
- Involved modules: extracted from the §1.3 Server APIs table (modules/interfaces with changes)
- Out of scope (NOT IN scope): extracted from §1.1 analysis boundary "what not to do"
- Review rule: do not emit findings outside the scope
```

---

## Step R1-3: Risk identification + change tracing + engineering-info review

**Review target**: `analysis.md §1.2 Requirement change analysis` + `§1.3 Technical implementation analysis` + `§1.4 Link analysis` + `§1.5 Risk points`

### Rule R1-1: Business-rule coverage completeness

> R1-1 compares against the "Acceptance rules" of each change point in §1.2, and §1.2 comes from **PRD business documents**. Therefore this rule **only greps PRD business documents** (business-requirement descriptions) and **does not compare against the technical design** — checking technical fields (jdbc/config service/topic, etc.) belongs to R1-6. Grep patterns use natural-language signals of business rules and check, class by class per the 7 types in requirement-analysis-guide.md §1.2 "Acceptance rule type reference", whether §1.2 omitted the matching type of acceptance rule.

| Source pattern (PRD business-language signals) | Acceptance rule type | Finding type |
|-----------|-----------------|-------------|
| `if\|when.*then\|otherwise\|in.*case\|distinguish` | Conditional branch | `BRANCH_MISSING` |
| `status\|become\|transition\|from.*to\|effective\|expire\|already.*not` | State machine | `STATE_MISSING` |
| `full.*off\|discount\|compute\|amount\|price\|allocate\|accumulate\|ratio` | Calculation logic | `CALC_RULE_MISSING` |
| `cannot\|must not\|forbid\|required\|format\|length\|range\|limit.*char` | Input constraint | `INPUT_LIMIT_MISSING` |
| `display\|show\|copy\|prompt\|hide\|gray out\|label\|style` | Display content | `DISPLAY_MISSING` |
| `only.*may\|not logged in\|member\|permission\|identity\|whitelist\|visible` | Access control | `AUTH_MISSING` |
| `at most\|at least\|upper limit\|not exceed\|count\|times\|servings` | Quantity limit | `QUANTITY_LIMIT_MISSING` |

**How to judge**: A PRD business document grep hits a pattern class → check whether any change point's "Acceptance rules" in §1.2 cover that class; no matching acceptance rule → emit the corresponding finding.

> ⚠️ Boundary constraint: a finding must be inside the requirement-boundary statement; grep hits outside the scope do not emit a finding.

### Rule R1-2: Risk-point reasonableness

Review `§1.5 Risk points`:

| Check item | Judgment | Finding type |
|--------|---------|-------------|
| Funds / data-security risks are registered | When source materials contain changes related to "funds" / "amount" / "privilege escalation" / "data leak", whether §1.5 registered the matching risk point | `RISK_MISSING` |
| Each risk point has a response | Whether each risk point in §1.5 has a response such as "test strategy" or "coverage method", rather than only listing the risk | `RISK_NO_STRATEGY` |
| Concurrency / idempotency risks must not be omitted | If §1.2 acceptance rules involve concurrency / idempotency, whether §1.5 has a matching risk point | `CONCURRENCY_RISK_MISSING` |

### Rule R1-3: Interface-contract risk identification

Review `§1.3 Server APIs` (at this point `api-details.md` has not been generated; judge only from information already in §1.3):

| Check item | Judgment | Finding type |
|--------|---------|-------------|
| An interface with required request params should have a matching exception risk | For an interface whose §1.3 vertical table "Input change" dimension involves a required / validation-rule change, whether §1.5 has a "required param missing / validation failed" risk | `REQUIRED_PARAM_RISK_MISSING` |

### Rule R1-4: Change-point tracing completeness

> Corresponds to requirement-analysis-guide.md §1.2 "Requirement change analysis". §1.2 is the change-spine index — every change point C-x must have "Acceptance rules" and an implementing interface in §1.3; otherwise that change point becomes a coverage blind spot in later case design (§1.2/§1.3 do not carry cross-reference columns; tracing uses semantic matching: serviceId / methodName / business-logic keywords).

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Change point has acceptance rules | The "Acceptance rules" column of every §1.2 change point (C-x) is non-empty; if the PRD truly has no explicit rule, fill `TBD (PRD unspecified)` and register it in §1.6 rather than leaving it blank | `CHANGE_RULE_MISSING` | P0 |
| Change point → implementation tracing complete | Every §1.2 change point (C-x) can find an implementation landing in §1.3 (by business-semantic matching): most change points land in §1.3 Server APIs; pure-client change points land in the §1.3 client table; **pure engineering change points** (only Config service / Database / Cache / MQ / Experiment adjustments, with no interface change) land in the matching §1.3 engineering-info subsection (config/switch, Database, etc.); only if none of the three can be found is tracing broken | `CHANGE_IMPL_LINK_BROKEN` | P0 |
| Interface → change-point reverse tracing | Every §1.3 Server APIs interface whose change type is "add/modify" can find a matching change point in §1.2 (avoid interface changes with no business-change source); if a Server APIs row's "protocol" is filled as `none (config service change)` or another pseudo-interface (it should land in an engineering-info subsection and must not occupy the interface table), report it here as well | `INTERFACE_CHANGE_NO_SOURCE` | P1 |
| No omitted change points (source-material comparison) | Grep explicit change descriptions in source materials (files under `prd/`) ("add/modify/delete/adjust/change") and check whether §1.2 registered a matching change point | `CHANGE_POINT_OMITTED` | P0 |

### Rule R1-5: Interface-change description completeness

> Corresponds to requirement-analysis-guide.md §1.3 "Impact-surface inference" and "Fill-in requirements" (one item per dimension; do not summarize in one sentence).

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Change point has no implementation landing | A §1.2 change point (not pure-client, not pure-engineering) is not mentioned in any §1.3 Server APIs "Input/Output/Implementation logic" dimension related to that change point, and no §1.3 engineering-info subsection carries the change either (a pure-engineering change point already registered in an engineering-info subsection is not a violation) | `CHANGE_NO_INTERFACE` | P0 |
| Interface dimension empty or one-sentence summary | In the §1.3 interface vertical table, an "Input change / Output change / Implementation logic" dimension only says "new interface" / "optimized" or another summary with no dimension information, and does not state the changed fields/logic and the expected post-change state (a dimension with no change this time should be `none`, which is not a violation) | `CHANGE_DIMENSION_TOO_VAGUE` | P0 |
| Linked change not identified | An interface in §1.3 had its request/response structure changed, but its caller/callee (see the §1.4 link) was not registered with change type "linked change" | `RIPPLE_EFFECT_MISSING` | P1 |
| Technical-design change not reflected | A change described in the technical design (DB schema change, new downstream call, new config, etc.) has no matching record in §1.3 Server APIs or an engineering-info subsection | `TECH_CHANGE_NOT_REFLECTED` | P1 |

### Rule R1-6: Engineering-info reliability

> Corresponds to the requirement-analysis-guide.md §1.3 global constraint "Every engineering-info field must come from an explicit record in the source materials; do not infer or fill in; fields not mentioned in the source materials are always `TBD`".
>
> ⚠️ **Provenance scope = `prd/` source materials + passed-in knowledge bases (union)**. requirement-analysis-guide.md already lists "knowledge base" as a legal source for §1.3 engineering-info subsections (Database, Cache, etc.). The requirement-analysis phase may extract engineering identifiers such as datasource / table name / cache Key from the knowledge base. Therefore, when judging whether an identifier is traceable, search **both** `prd/` source materials **and** all passed-in knowledge bases (grep yourself); a hit in either place counts as traceable. **Do not** judge fabrication or clear it to `TBD` merely because `prd/` does not mention it. Only when no knowledge base is passed in does this degrade to `prd/`-only provenance.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| §1.3 engineering identifiers are traceable | Spot-check field values in §1.3 engineering-info subsections that belong to `profile.components[].fields` (defaults: datasource / table / cluster / key / topic / producer / config key, etc.) and grep them in **files under `prd/` and passed-in knowledge bases (union)**; only if neither place hits is it fabrication. An undeclared profile field (e.g. redisCluster / kvNamespace), if present, also records this finding | `ENGINEERING_FIELD_FABRICATED` | P0 |
| §1.3 "fill if present" subsections are not omitted | Check against `profile.components`: when source materials hit that component's semantics (database→`jdbc\|database\|DB\|table name`; cache→`cache`; mq→`MQ\|topic\|message`; config→`config service\|switch\|config`; experiment→`experiment\|AB`), §1.3 must have the matching **one** subtable. Do not require dual `Cache · Redis / KV store` tables | `ENGINEERING_MODULE_MISSING` | P1 |
| Unfilled §1.3 engineering-info fields are marked `TBD` | Whether field values in §1.3 that the source materials did not specify are filled as `TBD`, rather than left blank or filled with an inferred value | `ENGINEERING_FIELD_UNCONFIRMED` | P1 |
| A §1.3 field contains both a confirmed value and TBD | In a §1.3 subsection table, the same field cell has both a concrete value and leftover `TBD` (e.g. `coupon_db (TBD)`, `TBD; topic=xxx`), which is leftover placeholder format after a calibration backfill | `ENGINEERING_FIELD_RESIDUAL_UNCONFIRMED` | P2 |

### Rule R1-7: Link analysis vs interface-table consistency

> Interfaces that appear in the §1.4 interface call chain should be registered in the §1.3 Server APIs table.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Every interface in the §1.4 link is registered in §1.3 | Extract every "callee interface" from the §1.4 call-chain table and check one by one whether the §1.3 interface table has a matching row | `INTERFACE_NOT_REGISTERED` | P1 |

### Rule R1-8: Technical design vs PRD consistency check

> Corresponds to the requirement-analysis-guide.md §1.6 "Technical design vs PRD consistency check" rule.

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Adopted content matches the PRD | Check every description in §1.2 change points and their acceptance rules (conditional branches, numeric values, state transitions) by grepping PRD source materials for consistency; if analysis.md adopted the technical-design description instead of the PRD description → emit a finding | `PRD_OVERRIDE_BY_TECH` | P0 |
| Inconsistencies are marked | If source materials show a clear contradiction between the technical design and the PRD on the same change point / acceptance rule (different conditions, different numbers, opposite branch logic), check whether analysis.md §1.6 exists and that contradiction is registered | `INCONSISTENCY_NOT_MARKED` | P1 |
| §1.6 inconsistency items are truly valid (no false positives) | Recheck each registered §1.6 record: go back to the source materials and compare that row's "PRD original/semantics" vs "technical design original/semantics" and confirm they truly contradict; if they actually agree (different wording but same semantics, or different dimensions that do not conflict), the row is a false positive → emit a finding and remove that record from §1.6 | `INCONSISTENCY_FALSE_POSITIVE` | P1 |
| Each §1.6 record has all six columns | If §1.6 exists, whether each record has the complete six columns (#, inconsistency description, PRD original/semantics, technical design original/semantics, adoption conclusion, impact scope); a missing or blank column → emit a finding (existence of an empty / header-only table is owned by R1-1; this item only judges column completeness of existing records) | `INCONSISTENCY_FORMAT_INCOMPLETE` | P2 |
| Impact scope is traceable | Whether each §1.6 record's "impact scope" field precisely marks the affected chapter + item id (e.g. §1.2 C-3, a §1.3 interface), and the referenced item actually exists in that chapter | `INCONSISTENCY_IMPACT_UNTRACEABLE` | P1 |

---

## Step R1-4: Aggregation + disposition

### Finding confidence and self-check

Every finding must carry `confidence`:

| Confidence | Definition |
|--------|------|
| `HIGH` | Has a concrete analysis.md chapter number or source-material line number as evidence |
| `MEDIUM` | Has indirect evidence; needs human confirmation |
| `LOW` | Inferred from testing experience; no direct evidence |

After producing each finding, run a rebuttal check:

| Check item | Fail disposition |
|--------|-----------|
| Is the finding inside the boundary statement? | Out of scope → delete |
| Is there a concrete chapter number or line number as evidence? | None → downgrade to LOW |
| Does a P0 finding have HIGH confidence? | P0 + not HIGH → downgrade to P1 |
| Does the P1 affect downstream input? | It would change the §1.3 current-change interface set or change anchors, the §1.4 call chain, or phase 2 coverage → mark `DOWNSTREAM_INPUT_IMPACTED` and write the impact scope; otherwise mark "no" |

> `DOWNSTREAM_INPUT_IMPACTED` is a P1 disposition marker, not a standalone finding type. It requires a minimal-scope fix plus a targeted R1 re-review before entering phase 2, and a refresh of affected knowledge records when configuring the local knowledge base; it does not change the finding's original severity.

### Disposition rules

**Has P0 finding**:
- Fix analysis.md in place (fill missing chapters/content, delete inferred engineering identifiers and mark `TBD`, change wrongly adopted technical-design descriptions back to PRD descriptions and add the inconsistency record in §1.6)
- ⛔ **Provenance check is required before deleting an engineering identifier**: for an identifier hit by `ENGINEERING_FIELD_FABRICATED`, before deleting it or clearing it to `TBD`, grep **both `prd/` source materials and passed-in knowledge bases (union)**; a hit in either place means it has a source — **keep the original value**. Only when neither place has a source may you delete it and mark `TBD`. Do not clear engineering info correctly extracted from a knowledge base merely because `prd/` did not hit.
- After the fix, re-run the R1-1 structure check to confirm the fix is effective

**Has `INCONSISTENCY_FALSE_POSITIVE` finding (false-positive cleanup)**:
- Delete the inconsistency record judged as a false positive from analysis.md §1.6 in place (that PRD vs technical-design pair is actually semantically consistent or non-conflicting)
- After deletion, if §1.6 has no remaining records (the table is empty), delete the entire §1.6 section per the requirement-analysis-guide.md §1.6 "Deletion rule"
- This action does not depend on the overall P0/P1 disposition band; execute the cleanup whenever this finding hits

**Has a P1 marked `DOWNSTREAM_INPUT_IMPACTED`**:
- Must not enter phase 2, and must not declare phase 1 complete
- The main agent must dispatch a new same-role requirement-analysis fix subagent, passing the current `analysis.md`, `requirement-analysis-guide.md`, `gate-requirement-review.md`, all `prd/` source materials, available knowledge-base paths, the finding text, and an explicit fix scope; the main agent must not modify the artifact directly
- After the fix subagent finishes the minimal-scope fix, the main agent dispatches a new R1 subagent for a targeted re-review of §1.3/§1.4 and the affected coverage; if the interface set or change anchors changed, dispatch a new changed-interface knowledge-recall subagent to refresh the affected records and pass the ready check

**Only unmarked-downstream-impact P1/P2 findings, or no findings**:
- Output the review summary and mark pass

**Output format**:

```
✅ R1 requirement analysis review complete
Structural completeness: pass
P0: {x}  P1: {y}  P2: {z}
Downstream-input-impacted P1: {N}

{if there are P0 or P1:}
| Finding | Chapter | Evidence | Downstream impact | Fix action |
|---------|------|---------|---------|---------|
| BRANCH_MISSING: missing "userLevel=0" branch | §1.2 C-2 | source material line 42 if-branch has no else | no | already added the matching branch to that change point's acceptance rules |
| INTERFACE_NOT_REGISTERED: entry interface omitted | §1.3/§1.4 | call-chain table row xx | yes: changed-interface set, interface query, and regression-recall scope | pending dispatch of a same-role fix subagent |
```

---

## Forbidden actions

- Loading source-material files in full (only grep key patterns)
- Emitting findings outside the requirement-boundary statement
- Forcing a challenge on every change point (no evidence → no finding)
- Skipping the R1-1 structure check and going straight to semantic review
- Labeling a LOW confidence finding as P0
- When inferring/validating §1.3 engineering identifiers, introducing information that exists in neither `prd/` source materials nor passed-in knowledge bases (union)
- Judging an engineering identifier correctly extracted from a knowledge base as fabricated, or clearing it to `TBD`, merely because `prd/` source materials did not hit (must check the knowledge base first)
