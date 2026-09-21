# Exec stage: case-generation rules

## Minimum persist (this stage)

- File: `{run_dir}/testcase/initialcase/` and dual-write `{run_dir}/testcase/cases/`
- Aggregated HTML report: `{run_dir}/testdesign/testcase_generation_report.html` (Web + Server + APP panels)
- Fields: matching `case-tpl-server.md` / `case-tpl-web.md` / `case-tpl-app.md` only
- Gate: case files exist and `execAllowed` is true; do not invent a third field table. HTML report is Agent-mandatory after dual-write; gate does not require it.

> Stage 6 is the only **Exec** stage. It only expands the formal test plan from the completed Plan into executable cases; it must not backfill, simplify, redo, or skip Stages 0–5. When the formal test plan is missing or unavailable, return to Plan to fill it rather than generating guessed cases.

## Input artifacts

> Before this stage starts, first confirm `run_dir` is available per [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" (userConfig.runDir → user-specified path → this Skill's initialized default directory). Do not call `--allow-exec` unless this turn's user message confirmed Exec. If `execAllowed` is false, do not write cases. Then run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/check_run_gate.py --run-dir <userConfig.runDir> --gate stage6` (redirect stdout only). If `ok` is false, do not write cases; finish Plan first. Do not perform any other Stage 6 read or write before the gate passes.

The only formal test plan Stage 6 reads: `{run_dir}/testdesign/test_design.md` (Stage 5 output, unique filename, containing the final client-type decision and the test-scenario table).

If the plan file does not exist, is unreadable, or is missing the final client-type decision, treat the upstream artifact as incomplete, return to Stage 5 to fill it, and do not guess in Stage 6.

## Flow overview
```
Section 1: Choose mode
↓ Server / WEB / APP; each involved end independently generates cases, independently persists local Markdown, and independently uses its own template

Section 2: Knowledge consumption
↓ Generic layer (already loaded at startup) + on-demand-layer close reading (test-data setup flow / sample format / tag strategy)

Section 3: Execution flow (run in order)
│
├─ Step 1: Case generation
│   ├─ Pre-step: scenario fusion (scene-fusion.md)
│   ├─ 1. Extract scenarios → 2. Write all as new (no remote reuse / change)
│   ├─ 3. Local directory planning (node-outline.md)
│   ├─ 4. Write case details from the matching template → 5. Self-check → 6. Integrate output
│   ├─ Quality requirements (5:3:2 ratio / Expected results verifiable / exception-coverage dimensions)
│   └─ Coverage check (mandatory; fill if not met)
│
└─ Step 2: Save cases
    └─ Save local Markdown (the only edit source; do not write a doc platform)

Section 4: Continuous modification
└─ Edit local Markdown → update statistics (do not upload to a case platform; do not write a doc platform)
```

## 1. Choose mode

Auto-route from the final client-type decision in the test plan (server/web/app/unknown), then generate cases.

| Option | Output file | Template |
|------|---------|------|
| 1. Server | `testcase_srv.md` (large table) | case-tpl-server.md |
| 2. WEB | `testcase_web_index.md` + `testcases/*.md` (index + standalone files) | case-tpl-web.md |
| 3. APP | `testcase_app_index.md` + `testcases/*.md` (index + standalone files) | case-tpl-app.md |
| 4. Full set | Generate all three above | Matching templates |

Each end independently uses its template to generate, independently saves, and independently counts. Do not upload to a case platform.


---


## 2. Knowledge consumption

> Knowledge-interaction adaptation is unified in [knowledge-adapter.md](knowledge-adapter.md); output templates are in [knowledge-receipt-templates.md](knowledge-receipt-templates.md). The generic-layer case-writing, assertion, step, test-data, and Meta norms are statically loaded by the adapter; this section does not redefine them.

### Consumption timing and reuse order

After Exec starts, and before scenario merge and case-detail writing, first read the formal test plan, Stage 4 `stage4-test-design/index.json`, and its close-reading conclusions; when available, also refer to the traceable information in the Stage 5 plan. First form a "covered / pending-gap" list. When the Stage 4 index is unreadable, record `MISS` and identify case-constructability gaps from the formal test plan; do not rerun Plan because of this.

### Targeted fetch only for gaps

Only when the case-generation knowledge listed in the table below is not covered by Stage 4/5 conclusions, and the user already provided a local knowledge directory at initialization, filter `{run_dir}/knowledge/index.md` with the `case-generation` dimension and the current gap keywords. If the index is empty, continue with the built-in three-end templates; do not ask the user to submit a knowledge directory.

| Filter dimension | Value |
|---------|------|
| stage | `case-generation` |
| Knowledge dimension | Built-in three-end templates; optional local-pack custom rules / test-data setup guidance |

### On-demand-layer close reading

| Knowledge type | Layer | Priority | Use                                              |
|---------|------|--------|-------------------------------------------------|
| Sample case-detail format | Built-in template; local pack may optionally override | Important | Align the concrete writing of Preconditions / operation steps / Expected results                           |
| Tag strategy | Built-in template; local pack may optionally override | Important | How to write case type, regression mark, execution type, and other tags; do not rewrite P0-P3 Priority              |
| Test-data setup flow (related modules) | On-demand layer | Optional | Land test-data description norms: write test data in Preconditions in a format constructible from the test-data setup flow             |
| Case-writing norms (business-custom) | On-demand layer | Important | Business-custom case-generation rules, special format requirements, etc.; when they conflict with the template, prefer the custom norms |

**Keyword combination**: use only for pending-gap items: "formal test-plan scenario + directory ownership path + gap type (sample / tag / test-data setup / business format)"; do not use generic norms or strategies already covered by Stage 4 as retrieval targets again.

**Close-reading rules**:

| Item | Spec |
|------|------|
| Close-reading objects | Test-data setup flow, sample format (generic norms belong to generic-layer static load), tag strategy, case-writing norms (business-custom) |
| Close-reading products | Executable-case support: data constructible, steps operable, assertions verifiable, Meta complete |
| TopN · budget | Small TopN; focus on test-data setup, sample-format, and tag entries |
| Stop condition | Cases can be ingested directly, with no implicit condition dependency |

**Output**: output per the Stage 6 template in [knowledge-receipt-templates.md](knowledge-receipt-templates.md), and persist to `{run_dir}/testcase/knowledge-biz/{project-name}/stage6-case-generation/`. Directly reuse sample format, tag strategy, or business rules already covered in Stage 4; do not retrieve again; write only newly added gap conclusions into the Stage 6 index. You must follow the adapter's per-stage receipt rules and record reuse, targeted retrieval, knowledge adoption to case IDs, and persist results.

### Knowledge use

When generating each case, enforce spec-compliance constraints (assertions verifiable, steps atomic, data constructible, Meta complete).
P0-P3 by default inherit the scenario Priority in the Stage 5 test plan (this Skill has no remote existing cases, so there is no reuse / change Priority);
**If the local pack already has case-writing norms (business-custom), execute by the custom rules** (e.g. raise financial-loss risk to P0, lower boundary to P2), and do not guess or recalculate in this stage. If there is no local pack, only inherit Stage 5 Priority.

### Priority inheritance rules (mandatory)

| Case source | Priority rule |
|---------|------------|
| New case (this Skill treats all as new) | Inherit the Priority of the corresponding test scenario in the Stage 5 test plan |
| One new case merges multiple Stage 5 scenarios | Take the highest Priority by `P0 > P1 > P2 > P3` |

If the Stage 5 test plan is missing Priority, treat the upstream artifact as incomplete, return to Stage 4/5 to fill it, and do not guess in Stage 6.

### Custom-strategy fusion (highest Priority)
If the local pack already has md files of the **custom generation rules / custom case-format strategy / case-writing norms (business-custom)** class, **fuse and reference** that strategy with the current skill's built-in templates; on conflict, **prefer the custom strategy**. If there is no local pack, use only the built-in three-end templates.

---

## 3. Case generation
Flow: extract / classify → directory planning → write strictly from the template → case fusion → self-check → integrate output → quality check → coverage check
Norm priority:
- If the local pack has special business-custom strategy, generate cases by combining it with the current skill template; on conflict, the custom strategy wins.  
- Always use this repo's three-end templates as the generic layer; when there is no custom strategy, generate directly from the templates

### 3.1 Generation steps (mandatory, strictly follow)
Extract scenarios from the test-plan test scenarios, combine them with the original feature-point descriptions, and generate cases per this file's merge principles and directory-ownership rules. Route by the final client-type decision in the test plan: server scenarios enter the server template, web scenarios enter the WEB template, app scenarios enter the APP template; unknown scenarios are not auto-generated and go to human clarification.
1. **Extract scenarios**: extract every test scenario from the test plan's "Test scenarios"
    - And read the final client-type decision, trigger-source information, page-ownership information, and diagram links in them
    - Server scenarios must read `serviceId` from the trigger source and write it into the matching template step as `serviceId:`; if missing, fill "TBD". Write the Preconditions environment field as "environment ID"; if it cannot be obtained at generation time, write "TBD". Field names follow [shared-rules.md](shared-rules.md) "Current field names and read normalization"; do not output historical synonym labels
    - web/app scenarios must also parse page ownership in the trigger-source information (page name, page path / route, entry, action controls, etc.); keep `---` when missing; write Preconditions as "environment ID: {environment-ID value}"; if it cannot be obtained, write "TBD"
    - The diagram link is a provenance link: the "UI image" field of app/web cases directly inherits that column's URL (no processing); it does not apply to server scenarios; except for the "UI image" field, cases must not reference the diagram URL
2. **Classify**:
   - Write coverage status always as "new" (Stage 3 does not connect to a remote space)
   - Client type is `server/web/app` → output from the matching template
   - Client type is `unknown` → do not auto-generate; enter pending-clarification items
3. **Directory planning**: determine the **local** directory structure from functional-module ownership, the final client-type decision, and app/web page ownership (all newly created)
   - Group server scenarios by functional module and write the expected directory path
   - Prefer grouping web/app scenarios by "page-module"; when page ownership is missing, fall back to functional-module grouping and mark page-ownership missing in pending-clarification items
   - Mark the operation type: `Create`
   - Do not create a directory for a single case; place it under the nearest parent
   - See [node-outline.md](node-outline.md) for the detailed strategy
4. **Write case details (mandatory, strictly follow)**: you must decompose and write cases per "1. Overall norms" and "3. Fill rules (Meta basic-information norms)" in the matching template. Decompose cases by feature point, verification point, and exception point; the case count must be greater than the scenario count. **Do not merge across types or across exception points**
5. **Case-detail self-check (mandatory, strictly follow)**: read "4. Standard case Demo" in the matching template; cases must match the Demo.
6. **Integrate output** (by end; mandatory, strictly follow):
   - **Server**: read "2. Markdown template structure" in the matching template, integrate into a Markdown large-table file, save to `{run_dir}/testcase/initialcase/testcase_srv.md`, and dual-write to `{run_dir}/testcase/cases/testcase_srv.md`; keep the two directories consistent.
   - **WEB** (index + standalone-file format, same structure as APP):
     - Directly generate standalone case files: create one `.md` file per case and save to `{run_dir}/testcase/initialcase/testcase_web/testcases/`
     - File naming: `{case-ID}-{case-name}.md` (the case name may be truncated to the first 50 characters)
     - Field norms: strictly follow the "3.2 Field norms" chapter of `case-tpl-web.md`
     - Generate the index file: also generate `{run_dir}/testcase/initialcase/testcase_web/testcase_web_index.md` (contains statistics, directory, existing-case associations, case index)
     - Dual-write backup: also copy cases to `{run_dir}/testcase/cases/testcase_web/` and copy the index to `{run_dir}/testcase/cases/testcase_web/testcase_web_index.md`
   - **APP** (special format; one table per file, one case per table):
     - Directly generate standalone case files: create one `.md` file per case and save to `{run_dir}/testcase/initialcase/testcase_app/testcases/`
     - File naming: `{case-ID}-{case-name}.md` (the case name may be truncated to the first 50 characters)
     - Field norms: strictly follow the "3.2 Field norms" chapter of `case-tpl-app.md`
     - Generate the index file: also generate `{run_dir}/testcase/initialcase/testcase_app/testcase_app_index.md` (contains statistics, directory, existing-case associations, case index)
     - Dual-write backup: also copy cases to `{run_dir}/testcase/cases/testcase_app/` and copy the index to `{run_dir}/testcase/cases/testcase_app/testcase_app_index.md`
7. **Mandatory**: `<br>` means a line break.
> **Field list (9)**: case ID, functional module, case name, Preconditions, operation steps, Expected results, Priority, case type, provenance
>
> **Norm source**: strictly follow the matching template chosen in Section 1 (server / WEB / APP); that is the only standard.

### 3.2 Case fusion
First fuse by the following rules (mandatory):
- Positive / exception / boundary **must not be merged across types**
- The judgment standard for Preconditions being "the same": object type, key attributes, and existence state are all fully identical. If only the operation action is the same but the input objects differ (e.g. upload files of different formats / different states), the Preconditions are not the same and must not be merged.
- Judgment Priority a → c → b
| Rule | Judgment condition | Handling |
|:-----|:---------|:-----|
| **a. Three elements fully duplicate** | Preconditions + operation steps + Expected results are fully identical | Keep only one |
| **c. Inclusion-relationship duplicate** | A's three elements fully contain B | B is a duplicate; keep only A |
| **b. Mergeable cases** | Preconditions + operation steps are the same; Expected results differ | Merge into one |


### 3.3 Quality requirements
**Scenario ratio**: normal:boundary:exception = 5:3:2; if exception < 15%, you must fill. Case count > scenario count
**Expected results**:
- Ban vague words ("normal" "correct" "no exception" "as expected")
- Expectations must be verifiable (concrete values, copy, status, field values)

**Exception-coverage dimensions** (choose as needed):
- Input exception: required empty, overlong, format error, special characters
- Permission exception: not logged in, no permission, login expired
- Business-rule exception: rule violation, state conflict, duplicate action
- Network / system exception: weak / disconnected network, timeout, error code

### 3.4 Coverage check (mandatory)

After generation you must run a coverage check:

| Check dimension | Standard |
|---------|------|
| Function-scenario coverage | Every "new" scenario has a corresponding case |
| Analytics-event scenario coverage | Every analytics-event ID has a corresponding case |
| Priority coverage | P0/P1 = 100%, P2 ≥ 90% |
| Scenario-type coverage | Positive / exception / boundary are all covered |
| Current field names | Server steps contain `serviceId` (or TBD); each end's Preconditions contain "environment ID" (or TBD); no historical synonym labels |

If not met, generate more and re-check until the bar is met.

---

## 4. Save cases (local only)

After case generation, the only artifact is the local Markdown already persisted in step 3.1:

- Server: `{run_dir}/testcase/initialcase/testcase_srv.md`, and dual-write `{run_dir}/testcase/cases/testcase_srv.md`
- WEB: `{run_dir}/testcase/initialcase/testcase_web/`, and dual-write `{run_dir}/testcase/cases/testcase_web/`
- APP: `{run_dir}/testcase/initialcase/testcase_app/`, and dual-write `{run_dir}/testcase/cases/testcase_app/`

Do not call any doc-platform API or remote upload. Each end saves independently and counts independently.

### 4.0 Aggregated HTML case report (mandatory after dual-write)

After `initialcase/` and `cases/` are consistent, generate the local HTML report that aggregates **Web / Server / APP** case sets (empty ends still appear as empty-state panels):

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/generate_case_report.py --run-dir <userConfig.runDir>
```

- Default output: `{run_dir}/testdesign/testcase_generation_report.html`
- Sources (prefer `cases/`, fall back to `initialcase/`): `testcase_web/`, `testcase_srv.md`, `testcase_app/`
- Optional: `--out <path.html>`
- Smoke: `generate_case_report.py --self-check`

Do not treat the HTML as an edit source; Markdown under `cases/` remains the only edit source. Regenerate the HTML after any Markdown case change.

After case persist **and** the HTML report is written, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 6` (redirect stdout only). Stage 6 gate still checks dual-write only; the HTML report is a required Agent deliverable, not a gate artifact.

## 4.1 Case-platform upload (removed)

This Skill does not upload to a case platform. See [case-export-notes.md](case-export-notes.md).
---
