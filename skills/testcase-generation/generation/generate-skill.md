# Case Generation Flow

> Execution spec for the **generate** capability, loaded from `SKILL.md` capability routing.
> This is a reference document, not a skill entry point: triggering is owned by `SKILL.md`.
> Phase bodies live in sibling files. Load **only the current phase** from the table below; do not open later phase files until this one has met its exit condition.

## Execution flow overview

```
Phase 0  Create directories / initialize registry / read global config and user feedback rules / preload knowledge bases / save source materials / establish baseline + _meta
  ↓
Phase 1  Requirement analysis + changed-interface knowledge recall
        ├ Dispatch requirement-analysis subagent (read source materials directly → analysis.md §1.1~§1.6)
        │   ≤5000 lines: read in full; >5000 lines: internal chunking (2000~3000-line window, 200-line overlap) + global cross-reference check
        ├ Parallel dispatch (after requirement-analysis first draft):
        │   ▸ [R1] review subagent validates analysis.md structural completeness
        │   ▸ When a local knowledge base is configured, dispatch a new changed-interface knowledge-recall subagent
        │     Recall by analysis.md §1.3 current changed interfaces → changed-interface-knowledge.json
        ├ On R1 fix, a P1 that impacts downstream input, or a §1.6 ruling that changes interfaces/anchors: dispatch a new same-role fix subagent → R1 targeted re-review → dispatch a new knowledge-recall subagent to refresh only affected records → validate ready
        └ Human confirmation of §1.6 inconsistencies (pause when present; correct after user ruling)
  ↓
Phase 2  Test design + interface lookup + regression recall
        ├ Changed-interface knowledge not ready, parallel dispatch (two-way):
        │   ▸ Test-design subagent → design.md §1~§2
        │   ▸ Interface-lookup subagent → api-details.md
        ├ Changed-interface knowledge ready, parallel dispatch (three-way):
        │   ▸ Test-design subagent → design.md §1~§2
        │   ▸ Interface-lookup subagent → api-details.md
        │   ▸ Regression-recall subagent → report regression design entries to the main agent
        ├ Test design + regression recall complete → main agent immediately writes regression entries into the matching module tables
        │   If §1 has no matching module, create a module/audit list in §3; do not wait for interface lookup
        ├ After all three subagents finish → [R2] dispatch R2 subagent to review design.md + api-details.md
        └ Human confirmation of design.md (render the test-design diagram + data-entity relationship diagram)
  ↓
Phase 3  Case design + generation
        ├ Step One:
        │   ▸ ⚡ Parallel-dispatch case-design subagents by design.md module
        │     (expand and aggregate inside the module, report candidate cases, do not write files)
        │   ▸ Main agent global second-pass dedup → batch UUIDs
        │     → case-registry.json (all entries initialized as pending)
        ├ [R3] Dispatch R3 subagent to review and fix/supplement pending registry entries
        └ Step Two:
            ▸ ⚡ Aggregate pending entries by module, generate all case .md files for that module in parallel (including R4 self-check)
            ▸ Main agent updates completed entries to done
            └ Render the final case-overview mind map
  ↓
Execution checklist  All [x] complete
```

## Load the current phase only

Match the resume table in Entry Conditions, then Read **one** file. After that file's exit condition, come back here and load the next — do not keep finished phase files in working context.

| Current phase | File |
|---|---|
| Phase 0 (first-time init, or directories / baseline / `_meta` missing) | `generation/phase-0-init.md` |
| Phase 1 (analysis, R1, §1.6 confirmation, changed-interface knowledge) | `generation/phase-1-analysis.md` |
| Phase 2 (design, interface lookup, regression, R2, human confirmation) | `generation/phase-2-design.md` |
| Phase 3 (case design, registry, R3, file generation, overview diagram) | `generation/phase-3-cases.md` |
| Dispatching a case-generation subagent (Phase 3 Step Two or update-skill `subagent-gen`) | quote `generation/subagent-gen-duty.md` verbatim |

---

## Global rules

The following rules apply across all phases.

**Step numbering convention**: Phase 1 has no step numbers (only the requirement-analysis subagent + review). Phase 2 uses Arabic numerals (Step 1/2/3). Phase 3 uses spelled-out numbers (Step One / Step Two). "Step 1" means the Phase 2 test-design subagent that generates design.md. "Step 2" means interface lookup. "Step 3" means regression recall. "Step One" means Phase 3 case design.

These three constraints match observed failure modes:

- **Do not shrink output.** A partial case set looks finished. The registry entry count, committed before any `.md` exists, is the only mechanical check that thirty cases were not quietly dropped for "token limit" or "core cases first". Every `pending` entry must produce a complete case file.
- **Do not inline source files.** An excerpt pasted into a subagent prompt becomes the authority; the subagent then skips the original and loses chapters that did not fit. Pass paths; the receiver reads.
- **Do not infer engineering identifiers.** A guessed table or cache key is unexecutable and looks precise. Field names come from `integrations-resolved.json` `profile.components[].fields` (plus Server APIs serviceId / interface type / interface name). Values come from `analysis.md §1.3` or the source material. Otherwise write `TBD (engineering info missing)`.

**Execution discipline**:
- During execution, only tool calls and necessary execution notes are allowed; progress summaries, phase reports, asking whether to continue, and suggesting a new session are all violations
- **Sole exit condition**: the execution checklist is entirely `[x]`. On a technical block, explain the cause and attempt recovery; if unrecoverable, explain the cause and stop

**Path convention**: All `quality-gates/gate-*.md` paths are joined as absolute paths from the skill root (this skill's root). `gate-requirement-review.md`, `gate-design-review.md`, and `gate-coverage-review.md` are read and executed by review subagents; the main agent does not read their contents. `gate-case-quality.md` is read by the case-generation subagent. Do not infer locations from relative paths.

**Human-facing confirmation**: when a phase pauses for the user, show the necessary summaries and openable links. Do not only ask the user to read files themselves. After each phase, do not re-`read_file` upstream spec files already distilled (the information is already in the artifacts).

**External system calls**: Looking up interface contracts, searching knowledge bases, reading environments, or filling config / middleware / experiment identifiers must go through the skill-root `scripts/call_integration.ts`. Do not hand-write curl or bind to a vendor SDK. For a capability that is not enabled, take the script return `status=skipped` as authoritative, then use local files or fill `TBD`.

**Skip macOS metadata**: When listing, copying, or reading files under `prd/`, `knowledge/`, or any user-provided zip extract, skip `__MACOSX/` directories, `._*` AppleDouble files, and `.DS_Store`. Do not pass those paths to subagents, do not treat them as source materials, and do not commit them into the `prd/` baseline.

**Safe JSON writes**: `case-registry.json` must be written via `JSON.stringify`. Do not use the Write tool to write hand-concatenated JSON.

```bash
node -e "const fs=require('fs'); const p=process.argv[1]; const data=JSON.parse(fs.readFileSync(0,'utf8')); fs.writeFileSync(p, JSON.stringify(data,null,2)+'\n');" target_path <<< '${JSON_CONTENT}'
```

---

## ⚠️ Work-completion judgment

**Immediately after reading this file, add the following items to the todolist:**

```
[ ] [Resume state self-check] Confirm the current phase from the resume table in Entry Conditions (skip if this is not a resume scenario)
[ ] Phase 0 environment init (directories + source-material save + baseline + _meta)
[ ] Phase 1 requirement-analysis subagent generates analysis.md + R1 review + §1.6 inconsistency confirmation (if any)
[ ] Phase 2 Step 1 test-design subagent generates design.md + Step 2 interface lookup + Step 3 regression recall (dispatch when changed-interface knowledge is ready)
[ ] Phase 2 R2 review (dispatch a subagent)
[ ] Phase 2 human confirmation (after R2, render the test-design diagram and data-entity relationship diagram, show a summary, wait for user confirmation)
[ ] Phase 3 Step One case design + registry init
[ ] Phase 3 R3 case-design review (dispatch a subagent)
[ ] Phase 3 Step Two case generation (including subagent R4 self-check) + render the final case-overview mind map
[ ] Execution checklist verification (must be the last completed todo)
```

> **Resume recovery**: When the todolist is empty or the current phase cannot be recalled, match the resume table in Entry Conditions from top to bottom. The first matching row is the current state; jump to its "Resume from" column and load only that phase file.

---

## Entry conditions

**Normal entry**: The user provided at least one of PRD / technical design, and there are no historical cases. When any of the following is detected, skip completed phases and continue from the unfinished point (resume table):

| Detection condition | Skip | Resume from |
|---------|---------|-----------|
| `analysis.md` does not exist | — | Phase 1 — `phase-1-analysis.md` (dispatch the requirement-analysis subagent to generate analysis.md). Run Phase 0 first if directories / baseline / `_meta` are missing (`phase-0-init.md`) |
| `analysis.md` exists, and changed-interface knowledge is not ready or is inconsistent with the current changed interfaces | Phase 1 analysis body | Phase 1 — `phase-1-analysis.md`: complete changed-interface knowledge |
| `analysis.md` exists, and changed-interface knowledge is ready or was not generated this time, but `design.md` does not exist or does not contain `## 1` | Phase 1 | Phase 2 — `phase-2-design.md` (by the parallel dispatch strategy, dispatch Step 1+2+3 or Step 1+2 together) |
| `design.md` contains `## 1`, but `api-details.md` does not exist | Phase 1~Phase 2 Step 1 | Phase 2 — `phase-2-design.md` Step 2 (interface lookup); if changed-interface knowledge is ready and `design.md` does not contain `## 3`, also dispatch Step 3 |
| `api-details.md` already exists, but `case-registry.json` does not exist or `cases` is empty | All of Phase 1~2 | Phase 3 Step One — `phase-3-cases.md` |
| `case-registry.json` already exists and has entries, and there are entries with `status: "pending"` | Phase 3 Step One | Phase 3 Step Two — `phase-3-cases.md` (process only entries with `status: "pending"`) |
| All `case-registry.json` entries have `status: "done"` | Phase 3 Step One~Step Two | Execution checklist |

> **Changed-interface knowledge ready check**: Run only when Phase 0 has a `type: "knowledge"` config. Current changed interfaces are only those in `analysis.md §1.3` whose change type is "added / modified / cascading-modified" and whose "related change points" is not `none`; "existing" interfaces registered only for chain completeness are excluded. The file `usecases/testdocs/changed-interface-knowledge.json` must exist and be parseable; the `{serviceId, interfaceName}` set in its `interfaces` must match the current changed-interface set; each interface record's `changeAnchors` must cover that interface's currently recorded change anchors. If any condition fails, it is "not ready or inconsistent": dispatch a new changed-interface knowledge-recall subagent, passing the current `analysis.md`, `requirement-analysis-guide.md`, `changed-interface-knowledge.json`, `knowledgePath`, all `prd/` source-material paths, and available knowledge-base paths; that subagent refreshes only missing, changed, or extra interface records, does not rerun the analysis body or unaffected records, and reports the current interface count, knowledge-record count, missing interfaces, redundant interfaces, uncovered anchors, and the final `ready / blocked` status. When no local knowledge base is configured, treat this as "this run did not generate that evidence".
>
> On resume, first read the existing `analysis.md` and `case-registry.json`, inspect actual artifact state, then decide where to continue. Do not decide from memory.

---

## Directory structure

```
{workspace}/
├── prd/
│   ├── .gitignore              # Ignore __MACOSX/, .DS_Store, ._*
│   ├── requirementDocs/        # PRD and requirement docs
│   ├── techDocs/               # Technical design
│   └── specs/                  # spec interface definitions
├── code/                       # Code repos of services under test (directory name is serviceId)
└── usecases/
    ├── cases/
    │   └── {module}/           # Case files (.md)
    └── testdocs/
        ├── analysis.md         # Requirement-analysis report (§1.1~§1.6, Phase 1 requirement-analysis subagent output)
        ├── integrations-resolved.json # Phase 0 on-disk external-system resolution (no secrets)
        ├── changed-interface-knowledge.json # Changed-interface knowledge (Phase 1 local knowledge-base recall output; absent when no local knowledge base is configured)
        ├── design.md           # Test-design plan (§1~§2, plus §3 regression directions if any; §1/§2 from the test-design subagent, §3 appended by the main agent from Step 3 report content)
        ├── api-details.md      # Interface full class names and request/response details (Phase 2 Step 2 output)
        ├── regression-checklist.json  # Regression-case recall list (Phase 2 Step 3 output, if any)
        ├── case-registry.json  # Case registry
        └── snapshots/          # Initial/final snapshots of the design inventory (optional, for local comparison)
```

---

## Referenced-file index

| File | Purpose | When read |
|---|---|---|
| `phase-0-init.md` | Environment init, integrations, knowledge preload, `prd/` baseline, `_meta` | Current phase is 0 |
| `phase-1-analysis.md` | Requirement-analysis subagent, R1, §1.6 confirmation, changed-interface knowledge | Current phase is 1 |
| `phase-2-design.md` | Test design, interface lookup, regression recall, R2, human confirmation | Current phase is 2 |
| `phase-3-cases.md` | Case design, registry, R3, parallel generation, overview diagram, testdata handoff | Current phase is 3 |
| `subagent-gen-duty.md` | Verbatim duty for a case-generation subagent | Dispatching Phase 3 Step Two or update-skill `subagent-gen` |
| `requirement-analysis-guide.md` | Requirement-analysis spec (produces analysis.md §1.1~§1.6) | After the Phase 1 requirement-analysis subagent starts |
| `test-design-guide.md` | Test-design spec (format and content of design.md §1~§3) | After the Phase 2 Step 1 test-design subagent starts; Step 3 produces per the §3 format |
| `interface-contract-lookup.md` | Interface request/response lookup spec (produces api-details.md; `spec_lookup` first) | After the Phase 2 Step 2 subagent starts |
| `usecases/testdocs/integrations-resolved.json` | Phase 0 on-disk external-system resolution (profile + enabled capabilities, no secrets) | Phase 1/2/3 and R1/R4/lint; do not guess field names |
| `references/integration-api.md` | Enterprise HTTP adapter contract | Configuring `.ai-testcase/integrations.yaml` |
| `case-authoring-rules.md` | §0 expand/aggregate; §1.2/§1.3 naming and caseType; §1.4 write-file constraints; §1.5–1.9 design principles | Before Phase 3 Step One (§1.4 after the Step Two subagent starts) |
| `manual-case-template.md` | Case skeleton template (with placeholders) | Phase 3 Step Two; the subagent `read_file`s the original |
| `quality-gates/gate-requirement-review.md` | R1 review | After Phase 1 analysis; dispatch a subagent (the main agent does not read) |
| `quality-gates/gate-design-review.md` | R2 review | After Phase 2 Step 1+2+3; dispatch a subagent (the main agent does not read) |
| `quality-gates/gate-coverage-review.md` | R3 case-design review | After Phase 3 Step One, before Step Two; dispatch a subagent (the main agent does not read) |
| `quality-gates/gate-case-quality.md` | R4 semantic / template-structure checks | Phase 3 Step Two item 7b; the subagent `read_file`s after the linter |
| `quality-gates/lint_case_documents.ts` | Deterministic R4 structure checks | Phase 3 Step Two item 7a; run with `--resolved` |
| `.ai-testcase/knowledge-cache/*.md` | Knowledge-base cache; paths from each entry's `cache_path` | Phase 0 preload; Phase 1/2 subagents `read_file` on demand |

---

## Execution checklist

> **Mandatory execution node**: every time you are jumped here, check every `[ ]` below item by item, change `[ ]` to `[x]` after it passes, and **only after every item is `[x]` may you return a completion summary**. Do not skip any item, and do not substitute memory for actual checks.

**Phase 0 (environment init + baseline + `_meta`)**
- [ ] **External-system resolution**: `usecases/testdocs/integrations-resolved.json` has been written by `validate_integrations.ts` (no secrets), containing `profile.protocols` / `mockableProtocols` / `components` and each capability's enabled state
- [ ] **Knowledge-base preload** (when `type: "docs"` is configured): each entry's `cache_path` has hit or been initialized under `.ai-testcase/knowledge-cache/` and written back to `.project/context.json`; the `knowledgeDocs` variable has been stashed (only `{ name, cachePath }`); when there is no knowledge-base config, confirm it was skipped
- [ ] **prd/ baseline**: the `prd/.git` directory exists (`git init` + `git add -A` + `git commit` already run)
- [ ] **`_meta` fields**: `_meta` of `case-registry.json` contains `last_prd_commit` (prd/ repo HEAD) and `last_update_time` (ISO timestamp); if code/ exists it also contains `last_code_commits`

**Phase 1 (requirement analysis)**
- [ ] **Requirement-analysis subagent**: `analysis.md` has been generated, containing 5 required chapters (§1.1~§1.5) in the correct order; §1.6 is a conditional chapter (present when there are PRD/technical-design inconsistencies; must not appear otherwise)
- [ ] **R1 review**: a subagent has been dispatched to validate analysis.md structural completeness, and the report confirms pass (all 5 required chapters exist, §1.6 condition is correct, §1.5 has a risk-point table)
- [ ] **§1.6 inconsistency confirmation** (when §1.6 exists): inconsistencies have been shown and user confirmation obtained; if the user ruled "follow technical design", affected chapters in analysis.md have been walked back and corrected per the impact scope

**Phase 2 (test design + interface lookup + regression recall)**
- [ ] **Step 1 test-design subagent**: `design.md` has been generated, containing 2 required chapters (§1, §2); the §2 test data inventory has at least 1 entity row; the `{snapshotDir}/init_design_data.md` snapshot is on disk (§2 markdown original, read-only baseline; later flow must not modify it)
- [ ] **Step 2 interface lookup**: `api-details.md` has been generated, containing full class names and request/response `<details>` blocks for all interfaces of this service; interfaces whose docs were not found are annotated; if there are new downstream calls that belong to `profile.mockableProtocols`, downstream interface info and the normal response structure are included
- [ ] **Step 3 regression recall** (when a local knowledge base is configured): `regression-checklist.json` has been generated (reuse entries included for `reusable` and `partially_reusable` interfaces; empty array when there are no reusable scripts); every changed interface in §1.3 has a per-interface report containing `scriptReuseStatus`, `knowledgeReviewStatus`, and `regressionDesignStatus`; `reusable` interfaces cover all impact points via the checklist and are marked `not_required/designed`; `partially_reusable` / `not_reusable` interfaces have finished body-text judgment and formed regression design entries or an evidenced no-plan conclusion; no interface is `pending`; the main agent has written regression entries or §3 audit summaries into `design.md` per the rules
- [ ] **R2 review**: a subagent has been dispatched to execute per `gate-design-review.md`, and the report confirms P0 has been fixed; design.md §1 has module test-point output; if §3 exists, regression-direction reasonableness has been reviewed
- [ ] **Human confirmation**: a summary has been shown and user confirmation obtained

**Phase 3 Step One (case design + registry init)**

- [ ] **Case design and registry**: verification points have been expanded per category via the case-authoring-rules.md §0 mapping table and merged by the three aggregate rules; each coverage item is a structured object `{ "trigger": "...", "expected": "..." }`; UUIDs have been batch-pregenerated (count matches the aggregated case total); case-registry.json has all initial fields written
- [ ] **R3 review**: a subagent has been dispatched to execute the `gate-coverage-review.md` R3-1 ~ R3-9 flow; the report confirms coverage is complete (every ✓ direction has a corresponding case; key exception paths and business-rule branches are covered); verification units are carried by locatable coverage paths; interface steps are all necessary to construct state, trigger logic, provide assertions, or reach a terminal state; case partitioning has no should-merge-but-didn't or should-split-but-didn't; fields are compliant (caseName/filePath/caseType/coverage); coverage quality meets the bar (interface names annotated, expected-result assertion dimensions complete); P0 has been fixed (gaps supplemented, field issues corrected); P1 has been handled or skipped; the registry entry total is finally determined

**Phase 3 Step Two (case-file generation)**

- [ ] **Parallel generation**: all case `.md` files have been generated in parallel by module (each subagent owns all pending entries under one module)
- [ ] **R4 self-check**: every subagent has run both passes on every file it generated — `lint_case_documents.ts` with `--resolved` for the deterministic rules (or a stated fallback if the script is missing), plus the `gate-case-quality.md` template-structure and semantic-quality checks; P0 has been fixed in place and the linter re-run until clean; P1 has been fixed or handled
- [ ] **Final registry check**: every `case-registry.json` entry has `status` `done` (spot-check 1 entry to verify last_updated/business_rules_digest are filled); the entry total matches the aggregated case total after Step One; the `.md` file total under each module directory in `usecases/cases/` matches the registry entry count
