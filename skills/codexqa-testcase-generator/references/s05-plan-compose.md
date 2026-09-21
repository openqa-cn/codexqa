# Stage 5: Output the complete test plan

## Minimum persist (this stage)

- File: `{run_dir}/testdesign/test_design.md`
- Required headings: `Requirement materials` | `Test analysis` | `Test-plan detailed design` | `Test-scenario ID` | `Client type`
- Columns: open [plan-md-template.md](plan-md-template.md) §1.1 only; do not invent a second plan table

This file defines the complete execution rules for the last Plan stage (Stage 5), including plan-content generation, format requirements, and how to save. When Stage 5 ends, Plan is complete; case generation must be a later independent Exec call to Stage 6, and must not auto-continue in this stage.

---

> Before this stage starts, first confirm `run_dir` is available per [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" (userConfig.runDir → user-specified path → this Skill's initialized default directory). Then run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/check_run_gate.py --run-dir <userConfig.runDir> --gate stage5` (redirect stdout only). If `ok` is false, do not write `testdesign/test_design.md`; resume from the first missing Stage 0–4-1 artifact. Do not perform any other Stage 5 read or write before the gate passes.

> Knowledge handling only reuses Stages 1–4-1 already-persisted reports, `index.json`, and decision records, and records receipts uniformly per [knowledge-adapter.md](knowledge-adapter.md); Stage 5 does not run new business retrieval, close reading, or priority recalculation. When prior content is insufficient, fall back to the matching Plan stage to fill it.

## Core principle: plan content must be strongly tied to prior analysis results

**The test plan Stage 5 outputs is not an independently authored document; it is a structured integration of the Stage 1–4-1 analysis results.** Every chapter and every test scenario in the plan must be traceable to a prior-stage analysis conclusion. Stage 5 only integrates and outputs; it is not responsible for adding, splitting, merging, or correcting test scenarios.

### Strong-tie requirements (mandatory)

#### 1. Test-analysis chapter ← Stage 1 + Stage 2

- **"2.1 Test focuses and difficulties"** must fully cover every function object, API object, and data object identified in Stage 1, plus the high-risk items identified in Stage 2. Do not omit any test object from Stage 1.
- **"2.2 Impact scope"** must fully map the Stage 2 impact-scope analysis results, including directly impacted modules and indirectly impacted modules. Every impact point analyzed in Stage 2 must have a corresponding test strategy in this chapter.
- **"2.3 Effective scope"** must extract effective channel, version, tech stack, experiment, and configuration information from the Stage 1 requirement analysis and the Stage 2 technical analysis.
- **"2.4 Pending clarifications and fallback plan"** must summarize every pending-confirmation item and risk item marked in Stages 1–2, plus known gaps in Stage 4-1 TBD items marked "pending clarification, information does not exist" (unfixable items already judged when Stage 4-1 audit terminated; this stage only presents them and does not re-fill).

#### 2. Test-plan detailed-design chapter ← Stage 1 + Stage 2 + Stage 3 + Stage 4-1 (including server trigger-source write-back)

- **Module and function partitioning** must match the function list identified in Stage 1; do not add or remove modules on your own.
- **Test scenarios** are the core output of the plan and must satisfy the following:

  **a) Source is traceable**: every test scenario must be traceable to the Stage 4-1 audit-corrected test-design report (type analysis, model matching, audit fill-in results, final client-type decision, verification surface, final Priority and Priority basis) and to the server trigger-source information or app/web page-ownership information already written back in the same report. Change-chain verification scenarios identified in Stage 2 must land as scenario chains in the Stage 4-1 audit-corrected report, and the trigger source must be filled in the same report.

  **a-1) Preconditions and Expected results inherit losslessly**: Stage 5 is not a summary draft; do not compress the "Preconditions" and "Verification point" in the Stage 4-1 audit-corrected report into a wrap-up sentence. If the Stage 4-1 audit-corrected scenario has multiple sub-verification points, the Stage 5 plan table must keep the one-to-one correspondence between `1）2）3）` precondition numbering and `①②③` verification-point numbering, and must losslessly map the audit-corrected verification points to the Stage 5 "Expected results" column. Only when the Stage 4-1 audit-corrected scenario itself has only one shared precondition or one verification point may Stage 5 omit numbering.

  **a-2) Server-side contract-information inheritance**: inherit the whole "Server-side contract information summary" from the Stage 4-1 audit-corrected report as specified in [plan-md-template.md](plan-md-template.md) and [s04a-design-audit.md](s04a-design-audit.md). Do not add or delete columns, rewrite headers, re-infer field semantics, or rewrite classification notes into a concrete value.

  **a-3) Diagram-link inheritance (provenance link, no processing)**: the Stage 5 plan-table "diagram link" column may only inherit, character for character, the diagram links already written back after the Stage 4-1 audit correction; do not rematch; do not re-search the Stage 1 business-diagram list; fill `---` for server / unknown scenarios; fill `---` for app/web scenarios that Stage 4-1 did not hit (the gap was already registered as a TBD item by Stage 4-1; Stage 5 does not re-register). Do not concatenate, rewrite, or truncate URLs; do not crop a new link from an aggregated design-draft image; do not invent any URL not registered in the Stage 1 business-diagram list — this column is a provenance link so a person can see the latest diagram of the page that corresponds to the scenario.

  **b) Inherit Stage 4-1 coverage-audit results**: the direct impact, indirect impact, and high-risk items identified in Stage 2 should already have been covered or marked pending clarification in the Stage 4-1 audit; Stage 5 only presents the Stage 4-1 final conclusions and does not add test scenarios.

  **b-1) Data-consistency checkpoint presentation**: the "consistency-checkpoint list" output from the Stage 2 data-impact-domain analysis should already have been covered or marked pending clarification in the Stage 4-1 audit-corrected report; Stage 5 only presents the Stage 4-1 audit-corrected result.

  **c) Integrate Stage 3 existing-case status**: if Stage 3 (existing-case recall) ran, the test-scenario "coverage status" column must be marked accurately:
  - "reuse": an existing case recalled in Stage 3 already fully covers this scenario
  - "change": an existing case recalled in Stage 3 partially covers it and needs modification
  - "new": Stage 3 did not recall a related existing case; a new one is needed

  **d) Follow the scenario-fusion spec**: test-scenario granularity must follow the fusion rules in [scene-fusion.md](scene-fusion.md); avoid over-splitting or missed merges.

  **e) Priority inherits the Stage 4-1 audit-corrected result**: the test-scenario Priority (P0/P1/P2/P3) must directly inherit the final Priority in the Stage 4-1 audit-corrected scenario table; do not re-retrieve, recalculate, or rewrite Priority in this stage.

### Completeness self-check list (check every item before outputting the plan)

Before outputting the plan, you must check the following list item by item and ensure the plan is not detached from prior analysis results:

- [ ] **Function-coverage conclusion inheritance**: InScope function objects identified in Stage 1 have been covered or marked pending clarification by the Stage 4-1 audit; the plan presents the Stage 4-1 audit-corrected result
- [ ] **API-coverage conclusion inheritance**: API objects identified in Stage 1 have been covered or marked pending clarification by the Stage 4-1 audit; the plan presents the Stage 4-1 audit-corrected result
- [ ] **Impact-scope coverage-conclusion inheritance**: impact points analyzed in Stage 2 (direct + indirect) have been covered or marked pending clarification by the Stage 4-1 audit; the plan presents the Stage 4-1 audit-corrected result
- [ ] **Risk-coverage conclusion inheritance**: high-risk items marked in Stage 2 have been covered or marked pending clarification by the Stage 4-1 audit; the plan presents the Stage 4-1 audit-corrected result
- [ ] **Existing-case status**: existing cases recalled in Stage 3 have coverage status correctly marked in the plan's test scenarios (reuse / change / new)
- [ ] **Test-design coverage**: every test scenario in the Stage 4-1 audit-corrected test-design report appears in the plan test scenarios
- [ ] **Technical-branch coverage**: key business branches, exception semantics, dependency semantics, API compatibility, data consistency, and idempotency constraints in the Stage 4-1 audit-corrected report all have a corresponding scenario or an explicit pending-clarification item in the plan; do not keep only a final-state list
- [ ] **Client type is consistent**: every test scenario in the plan inherits the Stage 4-1 audit-corrected final client-type decision (server/web/app/unknown); do not re-decide in Stage 5
- [ ] **Trigger-source / page-ownership information is complete**: the trigger-source information column for server scenarios and the page-ownership information column for web/app scenarios in the Stage 4-1 audit-corrected report are filled completely (fill only information already present in Stage 1/2 / Stage 4-1 audit-corrected results and the optional local pack)
- [ ] **Diagram column is legal**: the diagram column for app/web scenarios is the provenance link written back by Stage 4-1 (the URL comes character for character from the Stage 1 business-diagram list registration); server / unknown scenarios are `---`; there is no concatenated, rewritten, truncated, or invented URL, no design-draft crop link, and no pasted original image
- [ ] **Server trigger-source parameter format is legal**: request parameters are a legal JSON object template; confirmed stable common parameters or fixed technical values have been written; business-semantic parameters, test-data parameters, and dependency-result backfill parameters keep only empty placeholders; `---` does not enter a JSON value position; it is not a `{field-name:type}` summary format
- [ ] **Server-side contract-information inheritance**: the contract-information summary in the Stage 4-1 audit-corrected report has been kept at the end of the plan, including field meaning, constraint notes, enum values and meanings, and classification notes; classification notes contain only the class name and the judgment-basis citation and have not been rewritten into a concrete value; Stage 5 did not recalculate field semantics, parameter classification, or parameter source
- [ ] **web/app retained**: scenarios whose client type is web/app in the Stage 4-1 audit-corrected report have been kept with the plan body, and will be auto-routed by client type in later Stage 6; do not output a separate visibility side-list
- [ ] **Analytics-event coverage**: every analytics-event ID involved in the requirements has formed an analytics-event test scenario in the Stage 4-1 audit-corrected report and has been kept with the plan body; later Stage 6 routes by client type
- [ ] **Priority is consistent**: the Priority of test scenarios in the plan matches the final Priority in the Stage 4-1 audit-corrected scenario table; "Priority basis" has been kept with the scenario
- [ ] **Scenario IDs are consistent**: test-scenario IDs in the plan directly inherit the Stage 4-1 audit-corrected IDs; do not use Stage 4 original IDs, derived IDs, or re-number
- [ ] **Scenario fusion**: test-scenario granularity follows the fusion rules in scene-fusion.md
- [ ] **Data-consistency checkpoint inheritance**: the consistency-checkpoint list output from the Stage 2 data-impact-domain analysis has been covered or marked pending clarification by the Stage 4-1 audit; the plan presents the Stage 4-1 audit-corrected result
- [ ] **Placeholder summary statistics**: all `---` placeholders in the plan have been summarized (total + distribution by module), and a "TBD item list" is output at the end of the plan to remind humans to intervene

> **If the self-check finds omissions**: Stage 5 must not add test scenarios on its own. If scenario design, the final client-type decision, visibility scenarios, app/web page-ownership information, or server trigger-source information is missing, or if a composite scenario's Preconditions / Expected results numbering cannot correspond one-to-one, fall back to Stage 4-1 to re-audit and write back the fill-in. Fall back at most 2 rounds; if it still fails after the 2nd round, stop automatic fallback and output items pending human handling (problem item, related scenario IDs, attempted correction actions, missing reason).

---

## Execution flow

### Stage 5A: Stream the plan

Strictly follow the content and format requirements in [plan-md-template.md](plan-md-template.md), **and use streaming output to display the plan content on screen directly**, so the user sees the generation process in real time.

**Content-fill rules when generating the plan:**

1. **Chapter 1 "Requirement materials"**: extract roles, member assignments, and document links from the information the user provided and the Stage 1 requirement analysis. Keep placeholders for information that was not provided; do not invent.

2. **Chapter 2 "Test analysis"**:
   - "2.1 Test focuses and difficulties": integrate from the Stage 1 function list and the Stage 2 risk analysis; organize by function category and logic category.
   - "2.2 Impact scope": directly map the Stage 2 impact-scope analysis results and convert each item into a test strategy.
   - "2.3 Effective scope": extract configuration-item information from Stage 1 and Stage 2.
   - "2.4 Pending clarifications and fallback plan": summarize every pending-confirmation item from Stages 1–2.

3. **Chapter 3 "Test-plan detailed design"**:
   - Organize by the functional modules identified in Stage 1 (`{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`); each module contains a function description and a test-scenario table.
   - Sources for the test-scenario table content: `{run_dir}/testcase/testdocs/stage4-test-design-report.md` (type analysis + model-matching results + audit fill-in results + final client-type decision + verification surface + final Priority + Priority basis; server trigger-source information and app/web page-ownership information have been written back to the same report, including Stage 2 change-chain verification scenarios), integrate the Stage 2 impact-scope summary (`{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md`), and mark Stage 3 existing-case coverage status (`{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md`).
   - **Module-aggregation rule**: look up "owning module" in the Chapter 1 TO list of the report from the "related test object (TO)" of the Stage 4-1 audit-corrected scenario table, and aggregate the scenario into that module; do not infer module ownership from the test point or API name. Stage 4-1 audit already guarantees that every TO related by a single scenario belongs to the same module, so each scenario may be aggregated only once and must not be cross-module referenced repeatedly.
   - **ID-inheritance rule**: test-scenario IDs directly inherit the Stage 4-1 audit-corrected IDs; Stage 5 must not re-number.
   - **Granularity gate rule**: if a server-side business-function scenario produced after the Stage 4-1 audit correction still only covers the final state and has not expanded the technical object's key business branches (e.g. precondition short-circuit, dependency exception, partial success, state conflict, API compatibility, data consistency, idempotent result), Stage 5 must not output the plan directly and must fall back to Stage 4-1 to re-audit and correct; fall back at most 2 rounds for the same problem; if it still fails, stop automatic fallback and output items pending human handling.
   - **Include all scenarios**: server/web/app/unknown scenarios in the Stage 4-1 audit-corrected report all enter the plan body; server-scenario trigger-source information has been written back in the same report; web/app scenario page-ownership information and diagram links have been written back in the same report; unknown scenarios keep client type, verification surface, and pending-clarification information, for Stage 6 to auto-route by client type or for human handling.
   - **Preconditions / Expected results inheritance rule**: the Stage 5 plan-table "Preconditions" column directly inherits the Stage 4-1 audit-corrected scenario-table "Preconditions" column; the "Expected results" column directly inherits the Stage 4-1 audit-corrected scenario-table "Verification point" column. You may add contextual notes from Stage 1/2, but you must not delete, merge, or rewrite the numbering relationship. A composite scenario must keep the `1）` to `①`, `2）` to `②`, `3）` to `③` structure so Stage 6 can expand cases by sub-verification point.
   - **Server-side contract-information inheritance rule**: the end of the plan directly inherits the "Server-side contract information summary" of the Stage 4-1 audit-corrected report, covering Thrift, InternalRPC, HTTP, MQ, JobScheduler, and ConfigCenter; field meaning, constraints, enums, and classification notes follow the audit-corrected report; Stage 5 must not guess, rewrite classification, or add values.
   - **Key**: do not copy the Stage 4 original scenario list; instead, combine the Stage 1 function descriptions (`{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`), the Stage 2 impact-analysis summary (`{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md`, including information filled from the optional local pack), Stage 3 existing-case status (`{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md`), the Stage 4-1 audit-corrected final client-type decision and Priority basis, and the server trigger-source information and app/web page-ownership information written back in the same report, and generate complete, contextualized test scenarios. Every scenario must contain clear Preconditions and Expected results.

### Stage 5B: Save the plan

After the plan is output, run the following save flow:

#### 5B-1. How to save

The plan is saved only as local Markdown. This Skill does not connect to a doc platform and does not read or write `planSaveMode` / `docsParentId`.

#### 5B-2. Execute the save

The only formal test-plan file is `{run_dir}/testdesign/test_design.md`; append this generation time, input reports, and a change summary to `{run_dir}/testdesign/testdesign_changelog.md`. **The local Markdown file is the only edit source**. After the save completes, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 5` (redirect stdout only). That sets `planPersistedAt` and keeps `execAllowed=false`. Do not run `--allow-exec` in this stage.

### Stage 5C: End Plan and ask whether to Exec

After the local formal test plan is on disk, Stage 5 ends Plan and returns the formal test-plan path, the save result, pending-clarification items, and the knowledge work receipt.

You must confirm with the user whether to continue generating cases, then stop this turn. Do not enter Stage 6, do not run `--allow-exec` in this stage or this turn, and do not dispatch a sub-Agent to write cases. Even if the user originally asked for "plan + cases", confirm once after the plan is on disk. `--allow-exec` is legal only in a later user message that confirms Exec. Stage 6 only generates local cases; it does not upload to a case platform and does not write remote docs.

## 5D. Plan-platform / doc-platform upload (removed)

This Skill does not upload the formal test plan to a case platform or a doc platform. See [plan-export-notes.md](plan-export-notes.md). Local path only: `{run_dir}/testdesign/test_design.md`.


## Continuous conversation to modify the plan

**Modify the plan** — edit the local Markdown. Do not write back to a doc platform. Do not write back to a case platform.
