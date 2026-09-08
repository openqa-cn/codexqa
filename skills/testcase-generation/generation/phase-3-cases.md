# Phase 3: Case design + generation

> Load this file only when the resume table in `generate-skill.md` says Phase 3 is current (Step One, R3, Step Two, or the overview diagram). The case-generation subagent duty is in `subagent-gen-duty.md` — quote that file verbatim into the subagent prompt; do not paraphrase it.

**Entry condition**: Phase 2 complete (human confirmation passed).

### Step One: Case design and registry init


**Part 1: Case design (one-shot parallel dispatch of subagents by design.md module → expand+aggregate inside the module → main-agent global second-pass dedup)**

> 🧭 **`design.md` `#### […]` modules are the sole authority for module granularity**: this step splits strictly by module (one block = one subagent). The main agent does not expand+aggregate design.md globally on a single thread. Dispatch, lens isolation, and dedup rules are in 1.1~1.2 below.

**1.1 Main agent splits modules + parallel-dispatches case-design subagents**

Read all `####` module titles in `design.md` — including §1 ordinary feature modules (their points tables may contain `Category=regression scenario` rows), §1 `#### [Chain-XXX end-to-end]` chain modules, and same-name `#### [Module name]` blocks newly created at the §3 location (modules with no same-name module in §1 whose points table contains only `Category=regression scenario` rows) — and count the module total M. The main agent must start all M case-design subagents in **the same round of tool calls**, each responsible for one module; ⛔ do not dispatch modules serially or wait for any module to finish before dispatching the next. Only after all M reports return may you enter 1.2 global second-pass dedup.

> ⛔ **Required dispatch-prompt contents (item-by-item checklist; do not dispatch if any is missing)**:
> - [ ] **Module name** this subagent owns (e.g. `[Coupon config management]`, `#### [Chain-coupon lifecycle end-to-end]`)
> - [ ] **Lens isolation constraint (written explicitly in the prompt)**: rows whose Category column is `regression scenario` expand by the **regression lens** — expected results come only from the existing knowledge-base behavior stated in that row's "Verification summary", produce `category: "regression"` cases, and must not apply this PRD's added/modified logic; other Category rows (normal/boundary/exception/chain scenario) expand by the **new-feature lens**, producing `category: "new_feature"` cases. The two lenses must not be applied to each other. (Chain modules usually have no `regression scenario` rows.)
> - [ ] `design.md` file path (the subagent reads and expands **only the points-table rows of the one module it owns**, and does not read other modules)
> - [ ] `analysis.md` file path (the subagent needs: §1.2 acceptance-rule wording/error codes/values, §1.3 interfaces and engineering info, §1.4 interface call chains)
> - [ ] `case-authoring-rules.md` path (the subagent reads §0 expand+in-module aggregate rules, §1.5~§1.9 design principles)
> - [ ] **Global user-feedback rules path** (when the file exists): `.ai-testcase/feedback-rules.md`; the subagent reads only the "Case generation" chapter and uses it as auxiliary constraints on expansion, aggregation, and wording; do not treat it as requirement fact, coverage evidence, or a case source.
> - [ ] **Explicitly state "expand+aggregate only inside this module's scope; no cross-module work; do not write files, generate UUIDs, or write the registry; only report this module's case list"**
>
> ⛔ **Do not inline file contents**: the prompt may contain only file paths and the module-name string; do not write any design.md/analysis.md body into the prompt; the subagent must `read_file` the originals itself.

**Case-design subagent duty (single-module scope)**:

1. Receive from the main agent: owned module name, lens isolation constraint, paths to `design.md`/`analysis.md`/`case-authoring-rules.md`; after start, `read_file` all rows of **this module's** points table in `design.md`, `analysis.md` §1.2~§1.4, and `case-authoring-rules.md` §0 + §1.5~§1.9.
2. **Expand verification points row by row by Category (the two lenses must not be applied to each other)**:
   - **Non-regression rows (Category is normal/boundary/exception/chain scenario; new-feature lens)**: for each point, first read the general design principles in `case-authoring-rules.md §1.5~§1.9`, then look up `§0 coverage direction → expand-spec mapping table`, match the chapter number and expand points by the point name, read the expand details, expand all verification points that should be covered under that point, and mark `category: "new_feature"`; do not skip any listed point, and do not expand points not listed in this module; **interface sequences prefer the row's "Covered interfaces" column** (a chain is an interface sequence with ` → `, a single interface is one interface, a client-only case is `Page: {page name}`); only when "Covered interfaces" is empty or untraceable, fall back to inferring from `analysis.md`.
   - **`Category=regression scenario` rows (regression lens, per the dedicated handling rule for regression-scenario rows in `case-authoring-rules.md §0`)**: trigger = a normal call of the existing business scenario described by the knowledge base (normal input, normal preconditions), annotated with the interface name (**read the row's "Covered interfaces" column directly**); expected = the concrete expected behavior extracted from that row's "Verification summary" (from existing knowledge-base behavior), filled by the DB/cache/MQ degradation rules below; do not use vague wording such as "behavior unchanged"; each row expands 1~2 verification points (normal main path + key boundary; do not expand the full exception set), marked `category: "regression"`. ⚠️ Regression-row expected results come only from existing knowledge-base behavior; do not apply non-regression rows' PRD new-behavior logic.
3. **In-module aggregate + in-module dedup (rules 1~4 of `case-authoring-rules.md §0` Part 2 "In-module aggregate")**:
   - **new_feature cases**: aggregate by rules 1~3 (chain merge applies only to chain modules → in-module positive-path dedup → in-module single-interface exception merge). ⛔ Do not aggregate across this module.
   - **regression cases**: by rule 4, each regression direction is an independent case and **does not participate in rules 1~3 aggregation**; also eliminate inside the module — if a regression case and a new_feature case in this block cover the same interface and the same positive verification goal → keep the new-feature case and delete the duplicate regression case (regression value is covering existing scenarios that the new feature does not involve).
4. **Determine caseType**: judge `caseType` for each case in this module per `case-authoring-rules.md §1.3`.
5. **Fill `trigger` / `expected`**: any operation in a verification point's `trigger` that involves a Server APIs call must annotate the interface name (see `analysis.md §1.3`); pure front-end interactions are not annotated; any `expected` that involves a Server APIs call must include an API-response assertion (interface name + expected values of key return fields); write operations include DB/cache/MQ assertion expectations as needed; wording/toasts/error codes/status values already explicit in `analysis.md` must be quoted verbatim; forbid vague words such as "success/failure/as expected"; fill DB/cache/MQ by the unified degradation rules below.
6. **Report to the main agent**: this module's case list (new_feature + regression mixed), each with `caseName` (regression caseNames must have the `[Regression]` prefix, e.g. `[Regression][coupon-query] list query-existing output fields pass through`), `coverage` (structured verification-point array `{ "trigger": "...", "expected": "..." }`, without full input JSON construction), `caseType`, `category` (new_feature / regression), `owning module name`. ⛔ **The subagent does not write files, generate UUIDs, or write case-registry.json**.

**Unified DB/cache/MQ degradation rules (obeyed when the subagent fills `expected`)**:
  - **DB**: if the `analysis.md §1.3` Database submodule has datasource/table/key fields filled → write to table + key-field expected-value level; if the submodule is `TBD` or unfilled → write "DB assertion: TBD (engineering info missing; complete after datasource/table/key fields are supplied)"; ⛔ do not infer table or field names; do not write unexecutable vague descriptions such as "related records updated in DB"
  - **Cache**: fill by the cache component fields in `integrations-resolved.json`; already filled → write to field+expected-value level; `TBD` or unfilled → write "Cache assertion: TBD (engineering info missing)"; ⛔ do not infer field values; do not write unexecutable vague descriptions such as "cache updated"
  - **MQ**: fill by the mq component fields in `integrations-resolved.json`; already filled → write to field + message-body key-field expected-value level; `TBD` or unfilled → write "MQ assertion: TBD (engineering info missing)"; ⛔ do not infer field values; do not write unexecutable vague descriptions such as "message sent"

**1.2 Main-agent global second-pass dedup (after all module-subagent reports are collected)**

After collecting case lists from all M module subagents (feature blocks and chain blocks), the main agent finishes cross-module dedup per `case-authoring-rules.md §0` "Global second-pass dedup" (in-module dedup of regression vs new_feature cases was already done by subagents; here only leftover cross-module residue is handled):
  - **Overlapping positive verification of chain vs single-interface**: when a feature module's positive single-interface case and a chain-scenario case share the same verification goal, delete from the single-interface case's coverage the verification points already covered by the chain; keep the single-interface case if other verification points remain, and delete it only when remaining verification points are empty; the chain case's coverage is not rewritten because a single-interface case exists
  - **Leftover cross-module duplicates**: semantically equivalent cases produced by different module subagents due to boundary differences (same interface, same verification goal) → keep one, and merge missing verification points from the deleted entry into the kept entry
  - **Cross-module restatement of the same switch / same-dimension two-state**: the same two-state of the same switch, shared judgment, or config dimension repeated only because the interface/module differs → merge into one primary verification + a list of involved interfaces/modules; do not merge when verification goals differ
  - ⛔ **Do not over-merge**: only delete "duplicates"; do not forcibly merge cases that belong to different business modules with different verification goals (e.g. "coupon-config status check" and "coupon-redeem status check" are two cases); ⛔ also do not merge a regression case into a new_feature case (different categories; each stays an independent case)

After global dedup, you have the **final case list** (new_feature + regression mixed). Each case's `coverage` is what is written into the registry. Step Two subagents format output from this directly and **do not re-expand**.

**Part 2: Batch-pregenerate UUIDs**
After the final case list is determined, count the case total N and pregenerate all N UUIDs in **one** command, then pair them with the final case list in order:

```bash
node -e 'for (let i = 0; i < Number(process.argv[1]); i++) console.log(crypto.randomUUID())' N
```

Node is already required by this skill, so this avoids depending on `uuidgen` being installed. ⛔ Do not generate UUIDs one at a time inside the write loop: allocating them up front is what lets the registry declare its final entry count before any file exists, which is the check that catches a shrunken case set.

**Part 3: Initialize and write case-registry.json**

Before writing, output a declaration (case total + UUID count + case-name list), then write the `cases` array of `case-registry.json` in one shot. The entry count must strictly equal the declared N. Field spec:

| Field | When written | Constraint |
|------|----------|------|
| `caseId` | Step One | UUID pregenerated in Part 2 (paired in order), consistent with the .md frontmatter, **immutable**; registry records must not be deleted; `case-registry.json` is the sole authority for IDs |
| `caseName` | Step One | Aggregated case name, generated per `case-authoring-rules.md §1.2`, identical to the .md H1 title (without `#`); ⛔ **must be a business-semantic scenario name (e.g. "[coupon-issue API] downstream timeout-fallback return default"); never fill a UUID, TC number, or any non-business-semantic string**; regression cases (`category: "regression"`) must add the `[Regression]` prefix at the front, e.g. `[Regression][coupon-query] list query-existing output fields pass through` |
| `filePath` | Step One | `usecases/cases/{module}/` + caseName + `.md`; the file name must be identical to caseName; **do not name with UUID or TC number**; **immutable**; ⛔ **the `{module}` directory name must be semantically consistent with the domain in caseName's `[domain-flow/page]`; both must describe the same business module and must not mismatch after independent judgment**; when extracting `{module}` for a regression case, skip the `[Regression]` prefix and extract the domain from the immediately following `[domain-...]` |
| `caseType` | Step One | Result of Part 1 "Determine caseType", annotated `UI`/`SERVER` per `case-authoring-rules.md §1.3` |
| `category` | Step One | Case category must be decided by the source points row kept before aggregation: source is normal scenario / boundary scenario / exception scenario / chain scenario → `"new_feature"`; only when the source is `Category=regression scenario` and "Verification summary" / "Covered interfaces" can correspond to coverage → `"regression"`. ⛔ Do not infer category from interface name, module name, caseName, or coverage wording similarity; without a precise regression source it must be `"new_feature"` |
| `source_design_ref` | Step One | Design-source reference; must include `module`, `category`, `verificationPoint`, `verificationSummary`, `coveredInterfaces`, used to precisely locate the corresponding design.md design point; kept as-is from the module-subagent product. Required for all cases; when `category: "regression"`, its `category` must be `regression scenario` and is the sole design basis for R3/R4 — do not omit, guess, or rebuild |
| `coverage` | Step One | Full verification-point array after expand and aggregate; each item is a structured object `{ "trigger": "trigger condition (with interface name annotation)", "expected": "expected result (with API response/DB/cache/MQ assertion expectations)" }`, without assertion details or parameter construction; Step Two formats output from this directly, does not re-expand, and does not read case-authoring-rules.md |
| `change_reason` | Step One | Fixed initial value `"initial generation"` |
| `status` | written in Step One, updated in Step Two | Step One initializes as `pending`; Step Two updates to `done` only after all files and fields of that case are fully written; do not set `done` early |
| `created_at` | Step One | Format `YYYY-MM-DD HH:MM:SS`; must run `date "+%Y-%m-%d %H:%M:%S"`; do not fill from memory or reuse the last time; **immutable** |
| `last_updated` | completed in Step Two | Last update time, format `YYYY-MM-DD HH:MM:SS`, from the `date` command |
| `business_rules_digest` | completed in Step Two | Extracted from the .md content after each case is written; shape: `{ "module": "owning module (e.g. coupon_issue)", "rules": [{ "id": "BR-001", "desc": "each user may claim 3 coupons per campaign" }, ...] }` |

> ⛔ **Do not shrink the registered entry count**: you must write **all** case entries after Part 1 aggregation in one shot. Do not write only some entries for any reason such as "example", "demo", "core cases first", "token limit", or "time limit". The written entry count must strictly equal the UUID count pregenerated in Part 2.

**Post-write entry-count check**: run `node -e "const d=JSON.parse(require('fs').readFileSync('case-registry.json','utf8')); console.log(d.cases.length)"` to count actual entries; it must strictly equal the declared N. If inconsistent, fix in place and rewrite.

#### R3 review (triggered immediately after Step One, before Step Two starts)

**Dispatch 1 subagent** to run R3 review. The main agent does not read the review-rules file and does not execute review logic.

```
Dispatch subagent (R3 review):
  Pass in: absolute paths of gate-coverage-review.md, analysis.md (read only §1.x), design.md (read only §1), case-registry.json
  Duty: read gate-coverage-review.md and review per its rules; fix P0 in place on case-registry.json (add entries + field corrections); category review must check each `source_design_ref` against the corresponding design.md points row; do not infer from name or interface similarity
  Report: newly added pending entry count + corrected field count + remaining P1 list + total entry count after fix
```

**Main-agent handling of the report**: After the report, if there are P1 issues, ask the user to confirm; read the fixed `case-registry.json`, aggregate pending entries by `usecases/cases/{module}/` in `filePath`, and confirm the set of modules to generate. New entries supplemented by R3 have status "pending" and are automatically included in Step Two by their owning module.


### Step Two: Parallel case generation (subagents write files + main agent updates the registry from reports)


**Main-agent dispatch (aggregate pending entries by module → parallel dispatch by module)**:

Filter all `status: "pending"` entries in the `cases` array of `case-registry.json` (on resume, already-completed entries are skipped automatically), read each entry's `caseName`, `filePath`, `caseType`, `category`, `source_design_ref`, and `coverage`; extract the owning module from `usecases/cases/{module}/` in `filePath`, and group pending entries by module. Count the to-generate module total M, and **dispatch all M subagents in parallel in one shot**, each responsible for all pending entries under one module. ⛔ Do not split the same module by a fixed entry count, and do not wait for any module to finish before dispatching the next; on resume, if a module has only some pending entries, pass only that module's pending entries.

> ⛔ **Required dispatch-prompt contents (item-by-item checklist; do not dispatch if any is missing)**:
> - [ ] Owned module name, plus `caseId`, `caseName`, `filePath`, `caseType`, `category`, `source_design_ref`, `coverage` of all pending entries in that module
> - [ ] `analysis.md` file path (the subagent needs: §1.3 system-under-test info)
> - [ ] `design.md` file path (the subagent needs: §2 test data inventory)
> - [ ] `api-details.md` file path (the subagent needs: each interface's full class name and request/response `<details>` blocks)
> - [ ] `manual-case-template.md` path (case `.md` template)
> - [ ] `case-authoring-rules.md` path (the subagent reads §1.4 case-generation constraints)
> - [ ] Full path to `quality-gates/gate-case-quality.md` (R4 semantic self-check rule source)
> - [ ] Absolute `{skillRoot}` path, so the subagent can invoke `generation/quality-gates/lint_case_documents.ts` for the deterministic pass
> - [ ] **Explicitly state "after finishing all pending case files in this module, run R4 full self-check on all generated files in this module — linter first (7a), then the semantic pass (7b); do not skip"**
>
> The subagent **`read_file`s all of the above files itself**. The main agent passes paths only and must not paraphrase or condense contents.


**Subagent duty**: Read `{skillRoot}/generation/subagent-gen-duty.md` and quote that file **verbatim** as the duty section of the prompt. Do not summarise, re-step, add section titles, or rewrite constraint wording. Fill only path variables (absolute paths) and the pending-entry list (`caseId`, `caseName`, `filePath`, `caseType`, `category`, `source_design_ref`, `coverage`).

**After the main agent receives each subagent report**: update `case-registry.json` serially per entry (complete `last_updated`/`business_rules_digest`, status → `done`). If any entry fails self-check, require the owning-module subagent to regenerate that entry (at most 2 retries; after 3 consecutive failures, mark that entry as blocking and notify the user); other already-passed entries in the same module may still be updated to `done`.

**Execution constraints**:

- ⚡ **Parallel**: all module subagents must start at the same time; do not wait serially one by one; ⛔ **do not split a module into multiple rounds, or split the same module's entries across multiple subagents, for any reason such as "too long", "too complex", or "generate the first N first"; all module subagents must start together in one shot; violating this is a violation**
- ⚠️ **Registry writes**: registry updates are executed serially by the main agent; subagents must not write `case-registry.json` directly; `.md` files are written independently by each subagent with different paths and can safely run in parallel
- ⛔ **No fragmentation**: do not split cases already aggregated in the registry; do not generate fragmented cases or unit-test cases
- ⛔ **Do not shrink the case count**: do not generate only some cases for any reason such as "demo flow", "example cases", "core cases first", "token limit", "time limit", or "too many cases".
- ⛔ All `status: "pending"` entries must be generated in full, with no exceptions

**Final case overview (must be shown after all entries are `status: "done"` and before the execution checklist)**: the main agent reads the "Diagram display" chapter of `.ai-testcase/feedback-rules.md` on demand (skip if the file is missing), using it only as layout and wording constraints, then generates Mermaid `flowchart TD` on the fly from the final `case-registry.json` and renders it directly in the conversation for the user. Rules:

1. **Structure**: root node "Final test cases: {requirement/business theme}"; the first layer groups by design.md module titles, in the same order as the test-design diagram; under each module, group by `new_feature` (new-feature verification) and `regression` (regression verification); omit a group when it has no cases.
2. **Node wording**: leaf nodes show a user-facing condensed scenario description plus the `UI` / `SERVER` mark, using "business object/scenario + action + result" phrases; do not stack interface names, codes, or internal terms.
3. **Data definition**: category must be read from the registry `category` field; do not infer from caseName, interface name, or coverage; do not show UUIDs, absolute file paths, full coverage, or case steps.
4. **Aggregation**: when one category under a module has more than 6 cases, they may be aggregated into a third layer by verification theme; the node annotates the case count and keeps a traceable mapping for each `caseId`; do not press all modules into a radial mind map or mix them on the same branch.
5. **Color**: new-feature groups and leaves blue-green, regression groups and leaves orange, module nodes dark blue.
6. **Fallback**: the diagram is only for user reading; `case-registry.json` and case `.md` files remain the final authoritative artifacts; when Mermaid cannot render, fall back to an equivalent modular indented tree and explain why.

> ⛔ **Overview-diagram display is a hard exit condition; do not omit it for any reason**: do not skip or delay the overview diagram because of "too many cases", "diagram too large", "token/time limit", "already summarized in a table", or "the user did not ask"; do not output only a text list or a link as a substitute for rendering. When the diagram is large, you must still layer it per the aggregation rules and render it in full. If the overview diagram has not been rendered, this phase is unfinished and you must not run the execution checklist.

**User feedback on the final cases or overview diagram**: if the user continues to add, delete, correct, merge, or split cases/verification points, first revise the current `design.md`, registry, affected cases, and overview diagram per the feedback; when modules, sources, data entities, or regression scope are involved, check them in sync. Only when the feedback embodies a cross-requirement reusable test method or diagram-display method, merge-update `.ai-testcase/feedback-rules.md` in the "Rule / Applies / Exception" form; concrete business conclusions, case contents, and one-off scope adjustments are not written into that file.

**Exit condition**: all case `.md` files have been generated; fields in the engineering-info summary that depend on data entities keep `{placeholder}`; fields determined by scenario semantics have real values; the `.md` test-data table keeps the template structure, entity identifiers are the corresponding §2 placeholders, the Content column fully expresses textual conditions, and Construction is empty; all initial and completed fields of every `case-registry.json` entry have been written, and every `status` is `"done"`; **the final case-overview diagram (flowchart TD) has been rendered to the user per the rules above — if this item is unfinished, the exit condition is not met**.

### Data-construction handoff (after the exit condition is met)

Cases leave this flow with `{placeholder}`s intact. This skill decides what data a case needs; **`testdata-generation`** constructs it against real backends and writes values back.

- **Do not invent a value to fill a placeholder.** A fabricated order or coupon ID makes the case look finished and fail at execution.
- **Hand off, do not reimplement.** If the user also wants the data prepared, pass the `caseId` list plus each case's `.md` absolute path to `testdata-generation`. If that skill is unavailable, report which cases still carry placeholders. Do not treat leftover placeholders as done.

