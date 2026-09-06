# Output spec and templates

> This file is cited by name from the `SKILL.md` "Output spec" section. The Agent reads it when it needs to emit a progress card or the final summary, and organizes user-facing content from the templates here. All output follows core constraint 1 (zero leak): do not expose any internal field names, rule IDs, command/script execution details, or **detection-strategy names** (strategy numbers, method-level detection / chain-level detection / AST scan, and other internal strategy terms must not appear in the user-facing summary).

## Progress cards (3 timings)

1. **Start**: emit the start card after prerequisites are ready
2. **Milestones**: one card each at 25% / 50% / 75%
3. **End**: final summary

## Start card

```markdown
📋 **Detection started** — {planName}

| Item | Status |
|---|---|
| Services | {N} ({pending service list}) |
| Changes | {M} files / {K} methods |
| Requirement docs | ✅ {N} read / ❌ not obtained |
| Test cases | ✅ {N} / ❌ not linked |
| Document summary | ✅ DOC_SUMMARY.md generated ({N} business rules) / ❌ generation failed |
| Historical defects | {N} (unfixed {M}) |
| Exception traffic | {N} |
```

## Final summary

**Structure**: the user-facing final summary has two parts:

- **Part A — Detection summary** (also written back to the platform via `--summary`): Requirement changes, analysis scope, Risks
- **Part B — Defect-list summary** (user-facing only): defect stats table, concrete defect/improvement list, requirement compare, etc.

```markdown
---
## 🔍 Detection complete — {planName}

**Detection duration**: {duration}

### 📝 Detection summary

**Requirement changes**: {overview of the requirements/changes this detection covers, e.g. "XX requirement: added YY feature, involving ZZ module refactor"}

**Analysis scope**: {N} services ({service list}), {M} files / {K} methods in total

**Risks**:
- {risk 1: overview only; no concrete defect details}
- {risk 2}

### 📌 Notes

> Extra items to watch during test verification, release, and runtime:

**Test suggestions**:
- {business scenes that need focused regression}
- {boundary / exception scenes that need to be constructed}

**Release notes**:
- {canary strategy / config items that must be on or off in advance}
- {required deploy order of dependent services}

**Compatibility**:
- {whether old and new versions can coexist safely / interface-contract change notes}

**Monitoring**:
- {metrics / logs / alerts to watch after release}

**Prerequisite limits** (if any):
- {e.g.: this plan has no linked cases, so case-coverage compare cannot run}
- {e.g.: related tech docs are inaccessible with the current account; degraded to PRD + code analysis only}

---

| Detection result | Count |
|---|---|
| ✅ No defect | {N} |
| ⚠️ Suspected defects | {N} (after dedup) |
| 💡 Improvement | {N} (after dedup) |
| 📋 Historical defects | {N} |
| 🚧 In-development code | {N} |
| **Total** | {N} |

### ⚠️ Suspected defects

| # | Method | Problem description | Impact scope |
|---|---|---|---|
| 1 | {Class}#{method} | {description} | Same issue also involves: {ClassB}#{methodB}, {ClassC}#{methodC} |

### 💡 Improvement

| # | Method | Suggestion | Impact scope |
|---|---|---|---|
| 1 | {Class}#{method} | {description} | Same issue also involves: {ClassB}#{methodB} |

### 📄 Requirement-implementation compare

> Compare implementation item by item against the business rules extracted in DOC_SUMMARY.md.

| # | Requirement / business rule | Source | Code implementation | Status |
|---|---|---|---|---|
| R1 | {rule extracted from the doc} | {tech_doc/prd_doc ID} | {code location + brief how it is implemented} | ✅ Implemented / ⚠️ Implemented with deviation / ❌ Not implemented |
| R2 | {rule description} | {source} | {implementation brief} | {status} |

**Status notes**:
- ✅ Implemented: code logic matches the document
- ⚠️ Implemented with deviation: implemented but details do not fully match the document (watch)
- ❌ Not implemented: the documented logic has no matching implementation in the changed code

### 📊 Document-coverage analysis

| Dimension | Value | Notes |
|---|---|---|
| Total document business rules | {N} | Rules extracted from tech/requirement docs |
| Covered by code | {M} | Rules that have a matching implementation in the changed code |
| Code coverage | {M/N * 100}% | Document rules → code implementation coverage |
| Covered by test cases | {X}/{N} | Rules covered by test cases (from check-req-coverage `caseCoverage`) |
| Test-case coverage | {X/N * 100}% | Document rules → test-case coverage (hide this row when HAS_CASES=false) |

### ⚡ Risk hints

> Potential risks found during detection (not confirmed defects, but worth watching):

- **Missed case scenes**: {code branches/paths found during detection that existing cases do not cover}
- **Suggest adding/revising cases**: {a requirement or code branch has no matching coverage in existing cases, or the case description disagrees with the requirement/implementation; suggest adding or revising cases: concrete scenes}
- **Implementation disagrees with requirement**: {implementation differs from the requirement but is not a clear defect}
- **Suspected missed development**: {features described in the requirement with no matching implementation in code}
- **Release risk**: {issues that may appear while old and new versions coexist, during canary, or from interface compatibility}

### 🔎 Extra observations

> Extra information the Agent found while reading code (not defects), to help testers understand the change:

- **Degrade / fallback strategy**: {degrade switches, defaults, and degrade behavior implemented in code}
- **Config dependencies**: {new config-center items and their defaults}
- **Upstream/downstream impact**: {whether this change affects other callers; whether there are new RPC calls}
- **Test suggestions**: {test scenes that should be covered, based on boundary-condition analysis}

> View full report: [Open]({reportUrl})
---
```

**`--summary` writeback content**: extract the "📝 Detection summary" block from the template above (Requirement changes + Analysis scope + Risks + Notes + Conclusion). Do not include the defect stats table or anything below it.

**`--summary` format (important)**: the platform provider may submit a JSON body and keep newlines, but **Markdown tables are forbidden** (some report renderers collapse tables into an unreadable single line). Correct writing: mark sections with emoji+[bracket] titles (`📋[Requirement changes]`, `🔍[Analysis scope]`, `⚠️[Risks]`, `📌[Notes]`, `✅[Conclusion]`), separate sections with **4 spaces**, and use segmented lists inside a section (▸ number + pipe-separated fields). **Never use `|---|---|` table syntax**.

**Readability (even a single flattened line must let people spot the key info — three levels: section / item / field)**:
- **Between sections**: emoji+[] title + 4-space separator (already specified)
- **Between items**: number with `▸(1)` `▸(2)` `▸(3)` (▸ is a visual anchor, more visible than bare parentheses)
- **Between fields**: inside each risk item, use `｜` (full-width pipe) to separate location, Trigger conditions, and impact
- **Severity**: immediately after the number, `❗/⚡/💡` (high/medium/low)
- **Notes**: group by dimension; each group starts with `►Test:` `►Release:` `►Compatibility:` `►Monitoring:`; multiple items inside a group are semicolon-separated
- End each item with a period before the next number, so sentences break naturally

**Format examples**:
- Risks: `▸(1)❗ OrderValidator.validate() line 87｜Trigger conditions: call get(0) when the list is empty｜Impact: redemption flow throws IOOBE.▸(2)⚡ TransferService line 45｜Trigger conditions: downstream >3s with no timeout｜Impact: main thread blocked.`
- Notes: `►Test: construct an empty list and verify no exception; simulate timeout and verify degrade.►Release: depends on a new downstream API; confirm it is deployed first.►Monitoring: watch timeout alert volume.`

**Report link**: use the `reportUrl` returned by the current platform provider (local default generates `data/platform/reports/{taskId}.html` with a `file://` link; remote uses the configured `report_base_url`). If the chat cannot open it, open the HTML in the system browser.

**⚠️ Report link (MUST)**: the final summary **must** include a report link at the end. That is the user's entry to the full report. A missing report link means the summary is incomplete. Format: `> View full report: [Open]({reportUrl})`

**Category notes**: ⚠️ Suspected defect = the code has a real defect; 💡 Improvement = the feature works but code quality can be improved; 📋 Historical defect = an existing-code issue, not introduced by this change; 🚧 In-development code = TODO/Mock/self-test code, written back as no defect but shown in the summary.

**Same-root-cause dedup**: when emitting the final summary, the Agent must group all already-written suspected defects / improvements by root cause. Treat as the same issue if any of these hold: same Problem tags + essentially the same Fix suggestion (e.g. the same wrong condition used in multiple places); the same logic copied/inherited across classes causing the same defect. After grouping, the summary shows only one item (pick the most complete conclusion as the representative) and notes the other locations in the "Impact scope" column. If an item has no duplicates, leave Impact scope empty. This only affects summary display; it does not change independent conclusions already stored on the platform. The user can still confirm item by item.

**Risks internal-dedup (avoid repetitive descriptions)**:
- When a case gap (a rule not covered by cases) is essentially the same issue as an already-listed confirmed defect (e.g. the defect already points out NPE risk, and the case gap also says "null defense not covered"), **do not list it as a separate case-gap item**. Append to the confirmed-defect item: "also covers rule RX; suggest extra scene:..."
- Criterion: if the case-gap "test scene to add" highly overlaps the confirmed defect's "Reproduction path / Trigger conditions", treat as the same issue
- Purpose: avoid the user seeing the same problem twice in Risks (once as a defect, once as a case gap), which is redundant and confusing

**Requirement-implementation compare generation**:
- Data source: the "Business-rule list" in `DOC_SUMMARY.md` generated in Phase 1 Step 1.7
- Every rule must be located in the changed code (file name + method name + line range)
- If the doc has a rule but the changed code has no implementation → mark ❌ and suggest confirming whether it was missed
- If there is no doc (`$ISSUE_LIST[]` empty) → do not emit this section

**Risk-hint generation**:
- This section presents risk information that cannot be written back as a confirmed defect but is valuable for test and release decisions
- ⛔ **Absolutely forbidden to vaguely describe issues that are not in the defect list**: risk hints are not shown in the defect list. If they are also summarized here, the user gets nothing. Every risk-hint item must be **expanded in detail**: the original requirement-rule text, where it is implemented, case-coverage status, and the concrete test scenes to add. Do not write empty lines such as "some requirement rules are not covered by test cases" — list which rule, where the code is, and what the cases lack. Every risk must have enough detail for the user to act (add cases, add verification, watch monitoring, etc.).
- Missed case scenes: code branches/paths found during detection that existing test cases do not cover
- **Suggest adding/revising cases**: three-way compare of cases, requirement docs, and implementation. You must tell the user and suggest adding or revising cases when any of these happen: (a) the requirement doc has a business rule/feature with no matching case (missing case); (b) a branch or boundary added/changed in this code has no case coverage; (c) an existing case description disagrees with the requirement or the actual implementation (case needs revision). Each item must point to the concrete requirement/code location and the case scene to add. **Data source**: Step 2.7b `caseCoverage.caseUncoveredRules` (findings with source=case-coverage-check) + uncovered branches found in Phase 2 method analysis
- **Detail-expansion format (every risk must include these four elements)**:
  - ① Original requirement-rule text (the concrete rule from DOC_SUMMARY.md)
  - ② Code-implementation status (implemented / not implemented / partial + concrete Class#method + line numbers)
  - ③ Test-case coverage status (covered / uncovered + concrete case ID or "no matching case")
  - ④ Concrete test scene to add (specific enough to write a case: what to input, what to expect, which branch to verify)
- Implementation disagrees with requirement: code behavior differs from the requirement, but information is insufficient to call it a bug (the requirement change may not have been synced to the doc)
- Suspected missed development: a feature the requirement doc clearly describes with no matching implementation in the changed code
- Release risk: interface compatibility while old and new versions coexist, old and new logic in parallel during canary, data migration / config dependencies, and other release-stage risks
- Omit an item if it has no content; omit the whole section if all items are empty

**Extra-observation generation**:
- Must be based on actually reading the code; do not speculate
- Degrade strategy: list every new degrade switch and its config-read call
- Config dependencies: list every new config-item key
- Test suggestions: give concrete, actionable case suggestions based on boundary conditions (null checks, size thresholds, defaults)

**Analysis-scope generation (hard constraint; no boilerplate)**:
- 🚫 **No empty talk**: never write sentences that are true of every detection and carry no concrete information about this run, such as "analyzed all changed methods from method logic, Call chain, business scenes, and static rules, covering every changed method" — that says nothing.
- ✅ **Must write substantive facts**, covering at least the following, all taken from this detection's real data:
  - **Which services were detected**: name the services included this time (from content.json services), e.g. "checkout_server, catalog_server, checkout_client — three services"
  - **Scale**: how many changed classes and changed methods (from the detection plan / per-service change lists)
  - **Core change points and key Call chains**: which business chains / key methods this run focused on, e.g. "focused on the fee-calculation chain X.foo() → Y.bar()"
- **Data source**: service names, class counts, method counts, and Call chains all come from this run's real detection data (content.json, per-service diffs, already-written conclusions, detection counts in the report). 🚫 If you cannot get the data, omit it; do not invent it.
- **Example (substantive)**: `🔍[Analysis scope] This run covered checkout_server, catalog_server, checkout_client — three services, 12 changed classes and 28 changed methods; focused on the coupon-redemption chain CouponTransferService.transfer() → OrderCouponValidator.validate(), plus order-fee split methods.`
- If this run truly produced no method-level detection conclusions (e.g. detection count is 0), say so honestly: "this run produced no method-level detection conclusions". Do not hide it with boilerplate.

**Notes generation**:
- This section is for **release operations and test verification**. Tell testers/developers what extra to watch during test and release. **Even if detection found no defect, Notes cannot be empty** — at least include "scenes suggested for regression"
- **Four dimensions** (by priority):
  - **(1) Test suggestions**: from code-change analysis, list scenes that need focused regression and boundary/exception inputs to construct. Data source: branch paths found during analysis, and logic not covered by cases in the cross-view check
  - **(2) Release notes**: canary strategy, config items that must be on/off in advance, whether dependent services must be deployed first, data-migration notes
  - **(3) Compatibility**: whether old and new versions can coexist safely, whether interface-contract changes are backward compatible, whether old and new logic in parallel during canary is risky
  - **(4) Monitoring**: which metrics/logs/alerts to watch after release, plus suggested alert thresholds
- **Prerequisite-limit supplement** (if any): put "missing or limited prerequisites" at the end of Notes and explain the impact on detection:
  - No test cases linked → "this plan has no linked cases, so case-coverage compare cannot run"
  - Document fetch failed → "related tech docs have no permission; degraded to code-only analysis"
  - Service source unreachable → "{service name} was not included in this detection"
- Each item is one sentence: "what to watch + why". Neutral wording; no internal field names or commands
- Omit a dimension if it has no content, but the whole section must not be empty
