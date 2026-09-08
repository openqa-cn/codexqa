# Phase 2: Test design + interface lookup + regression recall

> Load this file only when the resume table in `generate-skill.md` says Phase 2 is current. After human confirmation and the final snapshot dump, discard this file from working context and load `phase-3-cases.md`.

**Entry condition**: Phase 1 complete (`analysis.md` generated and structural review passed).

### Parallel dispatch strategy (Step 1 + Step 2 + Step 3)

**After Phase 1**, the main agent chooses the parallel dispatch strategy by whether changed-interface knowledge is ready:

- **`changed-interface-knowledge.json` does not exist** (no knowledge files) → dispatch Step 1 + Step 2 together (2 subagents, two-way)
- **`changed-interface-knowledge.json` is ready** (knowledge ready) → dispatch Step 1 + Step 2 + Step 3 together (3 subagents, three-way parallel); Step 1 and Step 3 reuse that evidence and do not re-query the interface business knowledge base

> ⚠️ **Parallel execution**: The Step 3 subagent only reads `analysis.md` and cannot see the final `design.md §1` module names, so it does not write files or name modules — it only reports regression design entries. After Step 1 and Step 3 finish, the main agent can write entries into the matching module tables; Step 2 interface lookup has no dependency on that merge and continues in parallel. See "Main-agent merge" for the rules; R2 must still wait until Step 1, Step 2, and Step 3 have all finished.

### Step 1: Generate design.md (test-design subagent)

**Dispatch 1 subagent (test-design subagent)** to read `analysis.md` and serially generate §1→§2 per `test-design-guide.md`, appending each section into `usecases/testdocs/design.md`. The test-design subagent writes only §1/§2, not §3. After §2 is on disk, follow `test-design-guide.md` §2.4 "snapshot dump": use the Write tool to copy the §2 markdown original to `{snapshotDir}/init_design_data.md` as the subagent's mandatory exit action.

**Required contents of the main-agent dispatch prompt**:
- Full path to `test-design-guide.md` (the subagent `read_file`s it after start, as the generation spec)
- Full path to `analysis.md` (the subagent reads requirement-analysis results from it as input)
- Output file path: `usecases/testdocs/design.md`
- Absolute `snapshotDir` path (the workspace-root `usecases/testdocs/snapshots/` directory, used to dump the `init_design_data.md` snapshot; see `test-design-guide.md` §2.4; main-agent derivation: `usecases/testdocs/snapshots/` under the workspace root that contains `usecases/`; create it if missing)
- **Mandatory exit action (required)**: after §2 is on disk, the subagent must immediately Write the §2 "Test data inventory" markdown original verbatim to `{snapshotDir}/init_design_data.md` as a mandatory exit action; both are required (see `test-design-guide.md` §2.4). This is an action reminder, not a spec paraphrase; the subagent must still read §2.4 itself for the extract range and read-only constraints.
- **Knowledge-base paths** (conditional): pass the `cachePath` list of **all** entries in the Phase 0 stashed `knowledgeDocs` (omit if none), and state "these are available knowledge bases; based on §1 scenario identification + §2 data-entity dependency completion, decide which are relevant, read on demand, and ignore the rest". Rules are in `test-design-guide.md`
- **Global user-feedback rules path** (pass when the file exists): `.ai-testcase/feedback-rules.md`; the subagent reads only the "Module organization, verification-point design, regression design" chapters and uses them as organization and wording constraints for test design. Do not treat that content as requirement fact, engineering info, coverage evidence, or regression evidence; when it conflicts with `test-design-guide.md` or source materials, the latter wins.
- **Changed-interface knowledge path** (required when knowledge is ready): `usecases/testdocs/changed-interface-knowledge.json`; this step uses it only to supplement observation locations, assertion dimensions, covered interfaces, and data dependencies of existing points; do not add new-feature points from it

> ⛔ The main agent passes paths only and must not paraphrase `test-design-guide.md` or `analysis.md` contents. The subagent `read_file`s itself.

**Test-design subagent exit condition**: `usecases/testdocs/design.md` has been generated, containing §1 (test-design points) + §2 (data-entity inventory); the `{snapshotDir}/init_design_data.md` snapshot is on disk.

### Step 2: Interface-info lookup (subagent dispatch)

**Start timing**: after Phase 1, dispatch together with Step 1 and Step 3 (if any). The subagent extracts the to-query interface list from `analysis.md` §1.3 interface table + §1.4 chains.

**Dispatch method**: start one subagent to query all interface request/response params per `interface-contract-lookup.md` (interfaces have no inter-dependency; that subagent **concurrently queries multiple interface contracts in the same batch of tool calls**, without waiting serially one by one; no script is needed), and produce the standalone file `usecases/testdocs/api-details.md`.

**Required contents of the main-agent dispatch prompt**:
- Full path to `interface-contract-lookup.md` (the subagent `read_file`s it after start, as the execution spec)
- Full path to `analysis.md` (the subagent extracts the to-query interface list from it)
- Path to `usecases/testdocs/integrations-resolved.json` (`profile.mockableProtocols` decides the downstream Mock set; whether `spec_lookup` goes over HTTP)
- Output file path: `usecases/testdocs/api-details.md`
- Contract lookup must call `scripts/call_integration.ts --capability spec_lookup`; do not hand-write curl

> ⛔ The main agent passes paths only and must not paraphrase `interface-contract-lookup.md` or `analysis.md` contents. The subagent `read_file`s itself.

**Subagent duty**: read `interface-contract-lookup.md` and execute strictly per its flow — extract the to-query interface list from `analysis.md`; interfaces are independent; in the same batch of tool calls **concurrently** start multiple interface-doc/IDL queries (not serial waits, and no concurrency script is needed); when multiple contracts hit, when examples are missing, or when lookup fails, the subagent decides the fallback per interface and writes all results into `api-details.md`.

**Exit condition**: `api-details.md` has been generated, containing full class names and request/response `<details>` blocks for all interfaces of this service; if there are new downstream calls that belong to `profile.mockableProtocols`, downstream interface info and the normal response structure are included in the file.

### Step 3: Regression-case recall (subagent dispatch, when changed-interface knowledge is ready)

**Start timing**: after Phase 1, when `changed-interface-knowledge.json` is ready, dispatch together with Step 1 and Step 2; skip this step when that file is absent.

**Required contents of the main-agent dispatch prompt**:
- Full path to `analysis.md` (the subagent extracts change paths from the §1.2 change list + §1.3 interface table)
- Full path to `changed-interface-knowledge.json` (this step uses it only to judge associations between change paths and existing scenarios)
- `knowledgePath` (taken from Phase 0 stashed `knowledgeBases` entries with `type: "knowledge"`; used only for script-library recall and one supplement search when the body text has an explicit material gap)
- Output file path: `usecases/testdocs/regression-checklist.json`
- Report requirements: write no files other than `regression-checklist.json`; do not generate `§3` or custom modules; report per interface via messages only: `changeAnchors`, script-reuse status/reason, knowledge-review status/documents read/existing evidence, regression-design status and design entries or no-plan reason. Status values and exit conditions are in steps 5, 8, and 9. An empty script library, no `case_id`, or inability to assert the change may only be marked `not_reusable`; that is not the same as no regression plan or processing complete. `partially_reusable` / `not_reusable` must finish body-text judgment and form regression design entries or an evidenced no-plan conclusion; entry fields, no-plan summaries, and full audit-evidence requirements are in steps 8 and 9. The main agent then writes them into `design.md` per "Main-agent merge".

**Subagent duty**:

1. **Read changed-interface knowledge and confirm changed interfaces**: read `analysis.md §1.3` and `changed-interface-knowledge.json`, using the change anchors as path-judgment input. If a current changed-interface record is missing, return to Phase 1 to complete the evidence before continuing; do not re-issue the interface business-knowledge primary query, and do not treat the interface name itself as the change path.
2. **Get the knowledge-base path**: use the `knowledgePath` value passed by the main agent; it is used only for script knowledge-base recall and one supplement search in step 6 when the body text has an explicit material gap.
3. **Recall the script library per interface (full script-library recall)**: for **every** changed interface confirmed in step 1, independently recall its existing scripts from the script knowledge base; do not pick only some interfaces. Document naming inside the knowledge base is fixed. (This step only recalls the script library for step 4 coverage judgment; the interface business-knowledge primary query was already completed in Phase 1; regression cases are redesigned in step 8.)

      Call `call_integration.ts --capability knowledge_search --arg "query={interfaceName} automation scripts" --arg "knowledgePath={knowledgePath}"` and take the returned hits.

   Each recalled script has three fields: `case_id` (case identifier), `scenario type` (normal/exception/boundary, etc.), `verification scenario` (business-scenario description, example: "Verify that after the issue-coupon interface runs the full chain of pre-issue query, issue, and asset recheck, member discount coupons correctly expose memberOfferId/memberDiscountFlag, and non-member coupons do not carry the flags").

4. **Judge coverage per interface (required, cannot skip)**: the iteration unit is **each changed interface extracted in step 1** (interfaces in §1.3 whose change type is added/modified/cascading-modified), not the recalled scripts. For each changed interface:

   1. **Break down this interface's change**: from the three dimensions of that interface's vertical table in §1.3 — `input change`, `output change`, `implementation logic` (the parts that are not `none`) — extract what changed this time: involved methods/fields, changed logic branches, affected return structure, and analyze what those changes will affect.
   2. **Match each script**: for each recalled script of that interface:
      - **Break down the verification scenario**: from the script's `verification scenario` description, extract key elements — involved interfaces/flow nodes, asserted fields/flags, asserted business behavior.
      - **Judge intersection**: judge whether this interface's change this time (input/output/implementation logic) intersects those key elements — i.e. the change may affect that scenario's assertion result.
   3. **Summarize into one of three states**: first split this interface's change into impact points (concrete fields/methods/branches under input/output/logic dimensions), then see whether each impact point has a script assertion on it, yielding one of:
      - **Full coverage**: **all** impact points of this change have ≥1 script whose verification scenario asserts them.
      - **Partial coverage**: **some** impact points have script assertions, **and some do not**.
      - **No coverage**: no script can assert this change; **and** cases where recall info is insufficient, the scenario description is vague, or coverage cannot be confirmed (conservatively put here). Interfaces with an empty script-library recall also go here and must later enter step 6 interface business-knowledge judgment.

   When judging coverage, obey:
   - Must finish every changed interface from step 1; do not pick only some.
   - "Full coverage" requires verifying script assertions on every impact point; if any impact point is unasserted, it is "partial coverage".
   - Do not judge coverage merely because a script "called the same interface" — the script assertion must land on this change's input/output/logic impact points.
   - When coverage cannot be confirmed (insufficient info, vague scenario), conservatively put it in "no coverage" and redesign; do not force it into "full/partial coverage".

5. **Determine script-reuse conclusion and regression-design conclusion separately (the two status sets must not be mixed)**: Step 4's "full coverage / partial coverage / no coverage" describes **script-reuse capability** only and must not directly conclude "no regression needed".

   | Script coverage conclusion | `scriptReuseStatus` | checklist reuse entries | Regression-design follow-up |
   |---|---|---|---|
   | Full coverage | `reusable` | Write: include all scripts that cover each impact point | `knowledgeReviewStatus=not_required`; `regressionDesignStatus=designed` (reused scripts already carry all regression); no extra design entries |
   | Partial coverage | `partially_reusable` | Write: include the scripts that cover those impact points | **Must** run step 6; finish body-text judgment only for uncovered changes, forming a `designed` entry, or `no_plan_with_evidence` when full evidence is insufficient |
   | No coverage | `not_reusable` | Do not write | **Must** run step 6; finish body-text judgment for this interface's change as a whole, forming a `designed` entry, or `no_plan_with_evidence` when full evidence is insufficient |

   An empty script library, no `case_id`, a script scenario that cannot assert the change, or insufficient recall info can only yield `not_reusable`; **must not** skip step 6, must not write a no-regression-plan list, must not end regression recall. Reuse entries come from the **script knowledge base** in step 3; newly designed regression directions come from Phase 1 **changed-interface knowledge**, with a supplement search in step 6 only when the body text has an explicit material gap, and are produced in step 8.

6. **Cross-check changed-interface knowledge (per interface, no omissions)**: for each "partial coverage" or "no coverage" interface, read the corresponding evidence already generated in Phase 1 and cross-match it item-by-item with that interface's change path: which existing scenarios, branches, callers, or resources call, pass through, read, or assert that anchor. Business actions and core anchors here are **evidence-judgment and filter conditions**, not a new primary query. Keep only scenarios that can show a concrete path association; same interface, same service, similar title, or similar business name is not enough to include for regression.

   **Exception supplement search.** Only when the changed-interface knowledge original text explicitly mentions some external interface, shared call, handler, config, or resource, but current evidence cannot show how that object associates with the change path, do one supplement query using that original-text clue. When the original text has that material gap, the supplement search is required; when the original text has no clue, do not supplement proactively. The query must keep the service under test, the changed interface, and that clue, for example:

      Call `call_integration.ts --capability knowledge_search --arg "query={serviceId} {interfaceName} {shared clue found in body}" --arg "knowledgePath={knowledgePath}"`.

   **Cross-check body text.** For every candidate document cited by changed-interface knowledge and every document hit by the supplement search above, the full `content` must be read; do not look only at title, abstract, or document name. Around each change point, check the following three kinds of information:

   | Evidence | Question that must be answered |
   |---|---|
   | Change-anchor evidence | Does the document explicitly record the changed method, field, branch, config, or its data flow? |
   | Existing-scenario evidence | Which existing interfaces, callers, business branches, or config scenarios use that anchor? |
   | Path-association evidence | Why would that existing scenario call, pass through, read, or assert that anchor? |

   When the three kinds of evidence form a closed loop of "this change → shared path/resource → existing scenario", design a regression entry; same serviceId, same interface title, or similar business name alone does not form a loop. After finishing interface business-knowledge body-text judgment, necessary supplement search, and full-text cross-check, if the relationship still cannot be shown, register a "no-regression-plan interface"; the report must keep all audit evidence; design.md writes only a condensed conclusion summary.

7. **Produce reuse-script entries (write `regression-checklist.json`)**: for "full coverage" and "partial coverage" interfaces, write each covered script into the checklist. `regressionReason` must state the concrete impact path of which change impact point that script's assertion lands on (for partial coverage, only state which impact point it covers). ⛔ Do not write generic descriptions that cannot distinguish a concrete impact (e.g. "logic change may affect"). ⛔ Do not skip per-interface breakdown and matching and dump the entire recall result into the checklist.

   Example:
   ```json
   {
     "caseId": "a87e801a-67af-4238-b4c0-522ccb84bec5",
     "interfaceName": "grantUserBenefits",
     "scenarioType": "normal scenario",
     "description": "Verify that after the issue-coupon interface runs the full chain of pre-issue query, issue, and asset recheck, member discount coupons correctly expose memberOfferId/memberDiscountFlag, and non-member coupons do not carry the flags",
     "regressionReason": "grantUserBenefits this time changed the assignment condition of memberDiscountFlag; this case asserts that member discount coupons correctly expose that flag"
   }
   ```

8. **Design regression entries or an evidenced no-plan conclusion**: for every `partially_reusable` or `not_reusable` interface, after step 6 you must reach one of two regression-design conclusions: form a `designed` regression entry, or form a `no_plan_with_evidence` no-plan conclusion; `pending` means regression processing is unfinished — do not end the subagent. For `designed` interfaces, design regression entries one by one from step 6 changed-interface knowledge, for the main agent to write into the matching module after §1 is generated.
   1. Entry fields: `Category` (fixed as `regression scenario`), `Verification point`, `Design rationale`, `Verification summary`, `Covered interfaces`, `Source` (fixed as `Regression impact: {knowledge-base source summary}`), plus `Related change points` and `Ownership clue` for main-agent placement only. "Ownership clue" only explains functional-ownership basis; it is not a module name.
   2. **Evidence requirements**: Design rationale and Source must state the change anchor, the existing scenario, and the relationship between them; do not write data flows without evidence. Only after finishing step 6 body-text judgment, necessary supplement search, and body-text cross-check with still no evidence, omit output.
   3. **Self-check before reporting**: for each entry, verify in the KB original text the method names, field names, class names, or cache keys in the design rationale; delete the entry if a core identifier has no hit.
9. **Produce and report**: after all changed interfaces are processed, there is only one file artifact and one structured report message:
   - **File artifact**: write `usecases/testdocs/regression-checklist.json`. It contains only reusable historical-script entries for `reusable` and `partially_reusable` interfaces; write empty array `[]` when there are no reusable scripts.
   - **Report message**: deliver a per-interface regression-processing report. `reusable` interfaces must show `knowledgeReviewStatus=not_required` and `regressionDesignStatus=designed`, and prove via checklist entries that all impact points are carried; `partially_reusable` / `not_reusable` interfaces must show `knowledgeReviewStatus=completed`, and `regressionDesignStatus` may only be `designed` or `no_plan_with_evidence`, never `pending`. No-regression-plan interfaces must keep full audit evidence per interface in the report; the main agent writes only their condensed conclusion summaries into `design.md`. The regression-processing report is not written to disk separately.

**Exit condition**: every current changed interface has a per-interface report; all `reusable` interfaces have reuse scripts written into the checklist covering all impact points, marked `knowledgeReviewStatus=not_required` and `regressionDesignStatus=designed`; all `partially_reusable` / `not_reusable` interfaces have finished body-text judgment and each has formed a regression design entry or an evidenced no-plan conclusion; there is no `knowledgeReviewStatus=pending` or `regressionDesignStatus=pending`. If any condition fails, regression recall is unfinished; do not enter later phases.

#### Main-agent merge (run immediately after test design + regression recall finish)

After Step 1's `design.md §1~§2` is on disk and the Step 3 regression-recall subagent report is received, the main agent immediately writes the regression design entries and no-regression-plan interfaces into `design.md`; **do not wait for Step 2 interface lookup to finish**. `regression-checklist.json` stays as a standalone reuse-script list and is not written into `design.md`. Do not append regression content as a whole to the end of `design.md`. Interface lookup continues in parallel; only R2 review must wait until Step 1, Step 2, Step 3, and this merge have all finished. Steps:

1. Read the final `design.md`, build an index of §1 `#### [Module name]` blocks, and read each block's module overview, covered interfaces, and points table.
2. For each regression design entry, match a §1 module using "Covered interfaces" first and "Ownership clue" as supplement.
3. On a §1 module hit, append the entry's `Category`, `Verification point`, `Design rationale`, `Verification summary`, `Covered interfaces`, and `Source` as-is to its original points table. Do not create a same-name block or a duplicate table.
4. Only when §1 truly has no matching module, create a same-name block for the actual business module in §3; multiple rows that belong to the same new module share one table.
5. When the module cannot be determined, write a "TBD-ownership regression rows" list with reasons; do not enter Phase 3.
6. Write no-regression-plan interfaces into the §3 "No-regression-plan interfaces" audit list; do not mix them into the regression-scenario table; write only the condensed summary "change path + number of body texts checked + no associated existing scenario found"; full audit evidence stays in the regression subagent report.
7. Self-check: regression rows of modules already in §1 must be in the original table; §3 keeps only newly added business modules, the no-plan list, and the TBD-ownership list. If a summary table, interface-clustered block, or duplicate module is found, move it before entering R2.

If the report message has neither regression design entries nor no-regression-plan interfaces, do not modify `design.md`.

#### R2 review (triggered after Step 1, Step 2, Step 3, and the merge have all finished)

**Dispatch 1 subagent** to run R2 review. The main agent does not read the review-rules file and does not execute review logic.

```
Dispatch subagent (R2 review):
Pass in: absolute paths of gate-design-review.md, analysis.md, design.md, api-details.md + comparison sources (all source-material paths under prd/) + the regression-recall subagent's full per-interface regression-processing report (required when Step 3 was triggered)
Duty: read gate-design-review.md and review per its rules (test-point reasonableness + data-entity completeness + interface info + regression-direction reasonableness); for each not-fully-reusable interface, the full report must be used to verify body-text judgment and the regression-design conclusion; no-plan interfaces must use full audit evidence to verify the registration preconditions. `REGRESSION_KB_REVIEW_SKIPPED` / `REGRESSION_DESIGN_MISSING` / `REGRESSION_NOPLAN_MISUSED` are fixed by a new regression-recall subagent; R2 must not fabricate regression rows
Report: review pass/block + P0 fix summary + P1/P2 list
```

**Main-agent handling of the report**: After the report, check for blocking issues. If it is `REGRESSION_KB_REVIEW_SKIPPED`, `REGRESSION_DESIGN_MISSING`, or `REGRESSION_NOPLAN_MISUSED`, dispatch a new regression-recall subagent to finish per-interface body-text judgment and design, merge, then re-dispatch R2; for other test-point / interface-info blocking issues, dispatch a new same-role test-design fix subagent to complete them, then dispatch R2 re-review. P1/P2 are recorded only and do not block later flow.

#### Human confirmation (required after R2 review fixes, before entering Phase 3)

After R2 review and fixes, **the flow must pause** and present test design as "diagram overview + structured summary cards and tables"; do not throw design.md original text, consecutive bullets, or only module names/entry counts at the user. `design.md` remains the textual authority for AI review and Phase 3 consumption and is not written into diagrams; diagrams are generated on the fly only from `design.md` that has passed R2. The conversation shows only Mermaid **render results**; do not output `flowchart`/`erDiagram` source, node IDs, `classDef`, style statements, or code explanations.

**Display template (content must be extracted from design.md):**

```markdown
## Test design confirmation

| Design overview | Content |
|---|---|
| Covered modules | {module count}: {module names, comma-separated} |
| New-feature verification points | {count} |
| Regression verification points | {count} |
| Data entities | {count} kinds |

### 1. Modules and verification scope

| Module | Verification point | Core scenarios (normal, boundary, exception, chain) | Covered interfaces / observation points |
|---|---|---|---|
| {module name} | {verification point} | {condensed from design points, keep key conditions and expectations} | {interface name, page, DB/cache/MQ, etc.} |
| … | … | … | … |

### 2. Data entities and dependencies

| Data entity | Purpose | Construction/acquisition | Dependencies or key constraints |
|---|---|---|---|
| {entity name} | {test purpose} | {how to construct or acquire} | {dependent entities, states, thresholds, etc.} |
| … | … | … | … |

### 3. Regression verification scope (omit this section when there are no regression items)

| Regression module | Regression verification point | Impact analysis / verification boundary |
|---|---|---|
| {module name} | {existing capability / original behavior to verify} | {why regression is needed and which existing behaviors only} |
| … | … | … |

Please confirm whether the test scope, scenarios, and data entities are reasonable and complete; if adjustments are needed, specify the module or table row number.

[View test design]({design.md absolute path})
```

**Diagram display (must render directly before the text summary above)**: the main agent first reads the "Diagram display" chapter of `.ai-testcase/feedback-rules.md` on demand (skip if the file is missing), using it only as layout and wording constraints; it must not replace design.md content or R2 review.

1. **Test-design diagram**: generate Mermaid `flowchart LR` from design.md §1 and §3.

   - **Structure**: root node "Test design: {requirement/business theme}". Each business module keeps its module overview and expands in the fixed group order "normal → exception → boundary → regression"; omit groups with no verification points; do not replace them with mixed "new-feature verification point" nodes; each group shows "verification point + key condition/expected result" item by item; when rules, states, thresholds, error codes, switches, or similar conditions are involved, they must be kept; the regression group presents only existing verification points with `Category=regression scenario` and must not mix in new logic.
   - **Node wording**: use "business object/scenario + action + result" phrases so a user who does not know the interfaces can read them; do not stack interface names or encoded abbreviations; location info such as interface, page, DB/cache/MQ must not become independent observation nodes — parenthesize only when necessary.
   - **Chain modules**: split into short nodes as "entry scenario → key pass-through/check → result"; intercept and similar branches are split out separately; do not compress into one sentence of interface-chain text; exception, boundary, and regression verification stay in their own business modules and are not stuffed into the chain diagram.
   - **Color and aggregation**: new-feature nodes blue-green, regression nodes orange, scenario-category nodes dark blue; when there are more than 8 modules, group by business domain; when one category has more than 6 verification points, they may be aggregated by theme but must annotate entry count and key conditions; do not drop items.
2. **Test-data entity relationship diagram**: generate Mermaid `erDiagram` only from legal business entities in design.md §2 that passed R2. Each entity shows the entity name and at most 3 key attributes; draw strictly per §2 "dependencies"; do not invent links; relationship labels use "depends on / construct first". Preconditions such as Config service/gray config, Mock, environment variables, rule config, and cache switches must not be entities or links; if they need explanation, show them only as "precondition config/environment prep" comments on the test-design diagram. When there are more than 12 entities they may be grouped by dependency chain; do not delete entities or reverse dependency direction.
3. Diagrams are only for fast human understanding and must not replace R2 review, design.md, or the table summaries; if a node cannot be traced back to design.md, fix design.md first and then generate the diagram. On render failure, fall back to an equivalent layered text tree and explain why; whether success or failure, do not show Mermaid source.

Display constraints: the module table covers all §1 modules; the scenario column is condensed by normal/exception/boundary/regression groups and must not be only keywords; the data-entity table covers all §2 entities; when §3 exists the regression table must be shown. The link area shows only this run's `design.md` address. The user-visible area presents only the two rendered diagrams and the summary tables.

Enter Phase 3 only after the user explicitly confirms. If the user requests changes, first correct `design.md` and check affected data entities, regression scenarios, and case ownership, then re-render the affected diagrams and text summary, show the change diff, and wait for confirmation again. Only when the feedback embodies a cross-requirement reusable method for module organization, regression design, or diagram display, merge-update `.ai-testcase/feedback-rules.md` in the "Rule / Applies / Exception" form; do not save business facts, user quotes, engineering identifiers, or one-off requirement rulings.

> ⛔ Do not skip human confirmation and enter Phase 3. Even if the user query contains "one-click generate", "fully automatic", or similar wording, you must still pause here for confirmation — a directional error in case design costs far more than waiting for one confirmation.

**Final snapshot dump (mandatory exit action after confirmation)**: after the user explicitly confirms and before entering Phase 3, the main agent immediately uses the Write tool to copy the current markdown original of design.md §2 "Test data inventory" (from the `## §2 Test data inventory` heading to the end of §2) verbatim to `{snapshotDir}/final_design_data.md` as the final design baseline (paired with `init_design_data.md` for later "entity consistency before vs after design"). Dump only after the first confirmation; later edits do not overwrite. See `test-design-guide.md` §2.5.
