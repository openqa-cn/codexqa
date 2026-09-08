# Change Comparison Spec

> This file guides analysis of PRD/technical-design changes, and, together with the latest code under test, locates affected cases, updates cases in parallel, and updates post-change data construction.

---

## Flow overview

```
Change detection (see "Phase 0: Initialization")
  User already stated the change type → enter Phase 1 directly by type
  User did not state it → detect in parallel PRD (local/public-doc update + git diff) + code (git diff; when baseline is empty, take the empty-tree hash for a full diff)
  No change → tell the user and end
        │
        ▼
Phase 1: Extract change points
  PRD diff → change points (text/semantic); code diff → change points (search_key)
        │
        ▼
Phase 2: Change impact analysis
  text grep + semantic match → dual judgment (needs update / needs create; both may be marked)
        │
        ▼
Phase 3: Incremental design
  Judge whether data must be reconstructed
  If there is "needs create" → Step0 analysis.md incremental update → Step1 expand → Step2 UUID → Step3 R3 review
  → output change-impact-analysis.md → human confirmation (wait for user confirm or edit)
        │
        ▼
Phase 4: Case generation and update
  Redundant delete → ⚡ parallel dispatch subagent-update + subagent-gen
  → registry write → _meta + prd baseline commit → data construction (if any)
```


---

## ⛔ Execution constraints

### Work-completion judgment and resume recovery

> ⛔ **Resume recovery (mandatory)**: if the current conversation is a resume after the previous-round context was compressed (symptoms: todolist is empty, or you cannot recall which step is current), **before doing anything else** run the following recovery steps; do not output an empty response or "task already complete":
> 1. Read `usecases/testdocs/case-registry.json` and check whether any entries have `status: "updating"` (means the last run interrupted)
> 2. If there are `updating` entries → those cases must re-run subagent-update (the last write crashed halfway)
> 3. Check whether any entries have `status: "pending"` (incremental generation unfinished)
> 4. Check whether a data-backfill is still running (by checking whether case `.md` files still have unreplaced `{placeholder}`s)
> 5. Rebuild the todolist from the detection results and continue
> 6. If every case has `status: "done"` and there are no unreplaced placeholders, enter the final summary output

> ⛔ **Sole exit condition**: `.md` of all affected cases has been updated, all new cases have been generated, `case-registry.json` has been batch-written, and data-backfill (if any) is complete. On a technical block, explain the cause and attempt recovery; if unrecoverable, explain the cause and stop, but do not output a progress summary.

### Context management

> ⚠️ **Do not inline large files**: the following files **must not** have their full text inlined in any main-agent output or subagent dispatch prompt: full `case-registry.json` contents, PRD originals, code-file originals. Pass file paths only; the receiver reads them.

> ⚠️ **PRD chapter passing**: subagent-update and subagent-gen need the full content of related PRD chapters (not only the diff) to get complete context of the current rules. Pass as: PRD file path + related chapter titles; the subagent reads itself.

> ⚠️ **Discard after read**: after Phase 1, the diff original is treated as discarded. The Phase 2 (change impact analysis) *Change Impact Analysis* is the core input to Phase 3, but when executing, subagents must still read related PRD chapters themselves for full context.

> ⚠️ **Skip macOS metadata**: when listing, copying, or reading files under `prd/` or `knowledge/`, skip `__MACOSX/` directories, `._*` AppleDouble files, and `.DS_Store`. Do not treat them as source materials and do not commit them into the `prd/` baseline.

---

## Phase 0: Initialization

### Load external-system config

Same as generate-skill Phase 0: first validate and dump the resolution; later change-point `search_key` and engineering fields use only field names declared in the profile.

```bash
node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/validate_integrations.ts" --workspace "{workspace}" --resolve-out usecases/testdocs/integrations-resolved.json
```

Workspace `{workspace}/.ai-testcase/integrations.yaml` takes priority; otherwise use the skill's `config/integrations.default.yaml`. On validation failure, stop. Later read only `integrations-resolved.json` (no secrets). Looking up contracts / searching knowledge / reading environments / filling engineering identifiers all go through `scripts/call_integration.ts`; do not hand-write curl.

### PRD change detection

Contents of the `prd/` directory do not update automatically after initialization. update-skill **overwrites local files with the latest local files or public URLs provided by the user**, then gets line-level changes via git diff:

```bash
# 0. Confirm the prd workspace is clean
#    git -C prd/ status --porcelain
#    ├─ output empty → continue
#    └─ output non-empty → git -C prd/ checkout -- . && git -C prd/ clean -fd to restore the baseline
#
# 1. From .project/context.json read url + localPath of requirementDocs[] and techDocs[]
#
# 2. For each document, check whether the localPath file already exists
#    ├─ exists → both steps are required:
#    │   a) the new local file provided by the user, or web_fetch the latest markdown from the public url
#    │   b) write_file to localPath (overwrite the original)
#    └─ does not exist → skip, record in the "skip list"
#
# 3. Run git -C prd/ add -A + git -C prd/ diff --cached to get line-level changes
#    diff content = "latest documents vs last baseline commit"
#
# 4. Do not commit yet; leave it until the end of the flow (see "Baseline update")
```

> ⚠️ **Must actually write the file**: a remote fetch only gets content into memory; you must immediately `write_file` it to localPath. If you only read and do not write, later git diff will be based on wrong data.

> ⚠️ **Do not create new files**: if `context.json` contains document entries added after generate-skill (localPath does not exist), skip and tell the user "The following documents have no baseline files; re-run generate-skill to establish the baseline: {document list}".

> ⚠️ **Fetch-failure handling**: when a public URL read fails, record the failed documents and tell the user, and continue for documents that updated successfully. If all fail, tell the user "Unable to fetch the latest PRD" and stop.

### code change detection

After PRD fetch completes (or when the user says there is only a code change), run an incremental diff on each sub-repo under `code/`:

```bash
ROOT_DIR=$(pwd)
REGISTRY="$ROOT_DIR/usecases/testdocs/case-registry.json"

for dir in code/*/; do
  dirName=$(basename "$dir")

  # Read the last baseline commit from the registry.
  # Uses node rather than jq: node is already a hard dependency of this skill, jq is not.
  BASELINE=$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))._meta||{};process.stdout.write((m.last_code_commits||{})[process.argv[2]]||"")' "$REGISTRY" "$dirName")

  if [ -z "$BASELINE" ]; then
    # gen phase did not record a code baseline (code may not have existed yet) → take the empty-tree hash, equivalent to a full diff
    BASELINE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
  fi

  cd "$dir"
  # Take only files changed by this branch's own commits; exclude content brought in by merging other branches
  git log --first-parent --no-merges "$BASELINE"..HEAD --name-only --pretty=format:"" \
    | sort -u | grep -v "^$"
  # → produce the changed-file list, pass it to Phase 1 code change-point extraction
  cd "$ROOT_DIR"
done
```

> ⚠️ **Degradation when `last_code_commits` is empty**: generate-skill may have run before code existed; an empty `_meta.last_code_commits` is normal. Then the baseline is the git empty-tree hash (`4b825dc...`), a full diff is run on the whole repo, and all code is treated as added content for change-point extraction. Later flow is identical to a normal incremental diff; no special branch is needed.

> ⚠️ **code/ directory missing or empty**: skip code change detection and analyze only PRD changes.

### Change-detection result judgment

```
PRD diff result + code diff result:
├── neither has changes → tell the user "Neither PRD nor code has changes" and end
├── only PRD has changes → enter Phase 1, run only PRD change-point extraction
├── only code has changes → enter Phase 1, run only code change-point extraction
└── both have changes → enter Phase 1, run both parts
```


### Baseline update

> This section runs **after the update-skill flow ends** (all subagents finished + registry write finished), not inside Phase 0.

```bash
# 1. prd/ baseline update
git -C prd/ add -A
git -C prd/ diff --cached --quiet || git -C prd/ commit -m "baseline: post-update $(date +%Y-%m-%d)"
PRD_HASH=$(git -C prd/ rev-parse HEAD)
# → update case-registry.json _meta.last_prd_commit

# 2. Record HEAD of each code/ repo
for dir in code/*/; do
  dirName=$(basename "$dir")
  CODE_HASH=$(git -C "$dir" rev-parse HEAD 2>/dev/null)
  # → update case-registry.json _meta.last_code_commits[dirName]
done
```

> ⚠️ **Timing**: `_meta.last_prd_commit` and `_meta.last_code_commits` must be written into the registry in the same step to stay consistent. If the prd commit fails (no changes), keep `_meta.last_prd_commit` unchanged; code repos always record the current HEAD.

---

## Phase 1: Extract change points


> ⛔ **Entry checklist (must confirm before entering Phase 1)**:
> - [ ] PRD diff has been produced (`git -C prd/ diff --cached` has output), or PRD has been confirmed to have no changes
> - [ ] code diff has been produced (Phase 0 code change detection has output), or code has been confirmed to have no changes / the `code/` directory does not exist
> - [ ] At least one side has changes (otherwise stop at Phase 0 "Change-detection result judgment"; do not enter Phase 1)

Extract a structured change-point list from the PRD diff and code diff. Each change point must be annotated with a **match type**, used by Phase 2 (change impact analysis) to choose a match strategy.

> ⚡ **Execution method**: if PRD and code both have changes, change-point extraction for both parts **is completed serially by the main agent** (the extraction logic is simple; no subagent is needed). If a diff is too large (a single diff exceeds 500 lines), you may dispatch subagents to process in parallel.

### PRD change-point extraction

**Input**: line-level changes from `git -C prd/ diff --cached`

From changed lines in the diff, identify **verifiable business-rule** changes (those with a clear judgment condition and expected result). Ignore pure formatting, background-description edits, and UI-description changes.

> ⚠️ **Full-extraction principle**: every independently verifiable rule introduced in a PRD chapter should be extracted as an independent change point, including positive rules and reverse/boundary scenarios. For example, "display scope changed from 'issued' to 'issued and unused'" should be extracted as two change points: ① positive — unused coupons are displayed (update existing cases); ② reverse — used coupons are not displayed (may need new cases). Do not merge multiple independently verifiable rules into one change point.

For each change point, judge the match type:

- **text**: the change involves a searchable old value or a same-class value (version number, platform name, error code, threshold, etc.) → extract `search_key` (old-value text, or for an added class take an existing same-class value, e.g. adding HarmonyOS → key is "Android")
- **semantic**: rule-logic adjustment with no clear searchable value (e.g. "issued" → "issued and unused") → extract `semantic_desc` (semantic description of the change)

**Output format**:

```
Change ID | Change description                              | Match type | search_key / semantic_desc                    | PRD section path
R-001     | Supported platforms: HarmonyOS removed          | text       | HarmonyOS                                     | prd/requirement.md#Client environment
R-002     | App min version: >=2.5.0 → >=2.4.0              | text       | 2.5.0                                         | prd/requirement.md#Client environment
R-003     | Click coupon to jump to usable merchant list (new) | semantic | New interaction: click coupon card to jump to merchant list | prd/requirement.md#Coupon page interaction
R-004     | Display scope: issued → issued and unused       | semantic   | Coupon display adds unused-status filter      | prd/requirement.md#Coupon display logic
```

> ⚠️ **One change point may have both match types**: if a change has both a searchable old value and a logic adjustment, mark it `text+semantic` and run both match methods.

### code change-point extraction

**Extraction flow**: take the changed-file list from Phase 0 code change detection (merge-brought files already excluded via `--first-parent --no-merges`). For each changed file run `git -C code/{dirName}/ diff {BASELINE}..HEAD -- {file}` to get the line-level diff (the file is confirmed as this branch's own change; two-point syntax is safe). From added/deleted lines, identify engineering-identifier changes by the four dimensions below. Extract each change that can independently affect cases as an independent change point and fill `search_key`. Do not full-scan the code/ directory.

> ⛔ **No degradation (mandatory)**: you must run `git diff` and analyze line-level changes for **every file** in the Phase 0 changed-file list. Do not replace per-file diff analysis with coarse methods such as grep/find/filename scan. Even when the changed-file count is large (50+), you must diff each one and extract change points from added/deleted lines. If one conversation's tokens are not enough for all files, finish across multiple rounds, but do not skip any file.

> ⚠️ **Full-extraction principle**: when one file's diff contains multiple independent changes, they must be split into independent change points. For example, one commit that added a field, changed a condition, and changed a config key should be extracted as 3 independent change points. Do not merge multiple changes that can independently affect cases into one change point.

**Change identification and search_key rules**:

Scan engineering-identifier changes in the diff by the following dimensions, always using text match (engineering identifiers in cases are all grep-able originals). Extract each change that can independently affect cases as an independent change point. The change-description format is `{object} {operation}: {old} → {new}` (added/deleted classes omit the arrow) and must include the concrete identifier.

| Dimension | Objects of interest | search_key value rule |
| ---- | -------- | ------------------- |
| **Interface protocol** | Method signatures, request/response DTOs (protocol name from `profile.protocols`) | Added class → parent interface name; rename → old name; delete → deleted identifier; field-type change → field name |
| **Data storage** | Fields declared under database / cache in `profile.components` (defaults datasource / table / shardingRule / cluster / key / command) | Added column → table name; column rename → old column name; cache key change → old key. Do not use middleware fields not declared in the profile as search_key |
| **Config and messaging** | Fields declared under config / mq / experiment (defaults serviceId / key / value, cluster / topic / producer, experimentKey / groups) | Added → parent key/topic; rename → old name; value change → owning key name |
| **Downstream dependency** | Downstream calls in `profile.protocols` (whether to include in Mock depends on `mockableProtocols`) | Added downstream call → caller-owned interface name |
| **Identifiers and error codes** | Error codes, class/package names, enum values | Error-code change → old error-code value; rename → old name |

> ⚠️ **Exclusions** (do not extract as change points): pure formatting (import sort, blank lines), log-content edits, unit-test file changes, pure refactors with no external behavior change (e.g. extracting a private method, renaming an internal variable with no external reference), pure business-logic changes (if/switch condition adjustments, formula changes, etc. — covered by PRD change points).

**Output format** (example):

```
Change ID | Change description                                                  | search_key      | PRD section path (if related)
E-001     | issueCoupon added required input field userLevel                    | issueCoupon     | —
E-002     | Config service key renamed: issue.max_count → coupon.issue.max_count | issue.max_count | —
E-003     | Error code change: 40001(coupon expired) → 40010(coupon unavailable) | 40001           | —
```

### ⛔ Phase 1 exit gate (hard, cannot skip)

After all Phase 1 extraction finishes, the following checks must run; **all must pass** before entering Phase 2:

```
Check 1: changed-file/chapter coverage
  (a) code: Phase 0 detected changed-file count = N, Phase 1 actually git-diffed and analyzed file count = M
      ├── M == N → ✅ pass
      └── M < N → ❌ block, list unanalyzed files, continue analysis until M == N
  (b) PRD: Phase 0 git diff --cached involved file/chapter count = P, Phase 1 actually analyzed chapter count = Q
      ├── Q == P → ✅ pass
      └── Q < P → ❌ block, list unanalyzed PRD chapters, continue extraction until Q == P

Check 2: change-point completeness
  For each analyzed code file, check whether every added/deleted line in its diff was assigned to some change point or explicitly marked as an exclusion
  For each analyzed PRD chapter, check whether every verifiable business rule in the diff was extracted as a change point
  ├── all assigned/excluded/extracted → ✅ pass
  └── omissions exist → ❌ block, supplement extraction

Check 3: output-format compliance
  Every change point includes: Change ID, change description, search_key/semantic_desc, source path
  ├── all compliant → ✅ pass
  └── missing fields → ❌ block, complete them
```

> ⚠️ **Gate execution method**: the main agent runs the above checks itself at the end of Phase 1 (compare the Phase 0 file list with the actually analyzed list); it does not depend on the user triggering them. If a check fails, do not enter Phase 2; complete first.


---

## Phase 2: Change impact analysis


For the change-point list from Phase 1, run matching by match type and locate affected cases. The main agent executes directly (no subagent).

### Match execution

**text match**: for each text-class change point, run `grep -rl "{search_key}" usecases/cases/`; hit files are affected cases. `search_key` should be specific enough to avoid false hits (e.g. use `2.5.0` not `2.5`, use `issue.max_count` not `max_count`).
**semantic match**: for each semantic-class change point, read `caseName` + `business_rules_digest` + `coverage[]` of every case in `case-registry.json` and semantically compare `semantic_desc` with them. Judgment: the rule the case verifies is the same as or depends on the change point, or trigger/expected in coverage will need adjustment because of the change → affected; same module but verifying a completely different rule → not affected.

### Dual judgment (needs update / needs create)

After taking the union of text + semantic match results, make both judgments for each change point:

```
For each change point:
  │
  ├─ Judgment 1: are there related cases?
  │   ├─ yes → mark those cases "needs update"
  │   └─ no → skip (Judgment 2 will cover)
  │
  └─ Judgment 2: does this change point introduce a new independently testable scenario?
      │  Criterion: can the behavior/scenario described by the change point be covered by some verification point in the hit cases' coverage[] via "edit trigger/expected"?
      ├─ yes → "needs update" only; no create
      └─ no (it introduces an entirely new scenario, e.g. a new degradation path, a new interaction entry, a new exception branch)
          → also mark "needs create"
```

> ⚠️ **One change point may appear in both the "needs update" and "needs create" lists**. For example: `issueCoupon added degradation logic` will hit existing normal issue-coupon cases (needs update of their trigger description), and "downstream timeout degradation returns a default" is an independent scenario (needs a new degradation case).

> ⚠️ **Simplified rules for Judgment 2**: the following change types usually need update only, not create — value replacement (version, threshold, error code), identifier rename, parameter-type change. The following change types usually need create — new degradation/circuit-break path, new exception handling for a downstream call, new business branch/interaction entry, new state-transition path.

> ⚠️ **Suspected-redundancy judgment**: all rules related to a case have been deleted from the PRD diff, and semantic check confirms they are all obsolete → mark "suggested delete".


---

## Phase 3: Incremental design


The main agent completes incremental-design preparation.

**0. Judge whether data must be reconstructed**

For each affected case, judge by the change types that hit it. **Core criterion**: whether the change alters "the conditions test data must satisfy" — if a data entity needs a new state, attribute, or quantity to trigger the logic under test, reconstruction is required.

| Change type         | Reconstruct? | Basis |
| ---------------- | :--------------: | -------- |
| Quantity/threshold change    |       **Yes**       | Precondition data volume depends on the threshold; when the threshold changes, precondition data must be rebuilt |
| Status/condition change (filter added/tightened/loosened) |  **Yes**  | Must construct data that satisfies / does not satisfy the new condition |
| DB added table/column (carries a new business entity) |  **Yes**  | The data entity carried by the new table/column must be constructed before the test |
| Error-code/return-value change |        No        | Only assertion values in expected results change; precondition data stays |
| Interface param add/remove     |        No        | Precondition data entities stay; only adjust case request params |
| Engineering-identifier rename / cache-policy change / version or platform change | No | Only text or expected values in the case need replacement; precondition data stays |

> ⚠️ **Special judgment for a newly added DB column**: reconstruct only when that column is used as a query/filter condition; if it is only for write recording, reconstruction is not needed.

> ⚠️ **Easy-to-confuse scenario**: "issued → issued and not expired" is a "status/condition change" (a filter was added), not a simple semantic-description update — you must construct both expired and not-expired data.

**1. Incremental-generation prep** (if the *Change Impact Analysis* has "cases that need create")

```
Check the "cases that need create" list in the *Change Impact Analysis*
├── empty → skip; dispatch only subagent-update
└── not empty → run the following prep steps:
        │
        ▼
Step0: analysis.md incremental update
        Input: description, source, and related PRD chapter/code file of each change point in the *Change Impact Analysis* "needs create" list
        │
        For each change point, judge the owning module:
        ├─ cannot be placed into an existing §2.1 module → create a module:
        │     per requirement-analysis-guide.md §2.1 output format, fully fill the coverage-direction table (judge ✓/✗ per row + evidence)
        │     record: "New module [{moduleName}]"
        └─ can be placed into an existing §2.1 module → check that module's coverage-direction table:
              the change point introduced a new capability (e.g. new downstream call, new MQ, new concurrency logic)
              so a former ✗ direction should now be ✓ → change to ✓ and update evidence
              record: "Existing module [{moduleName}] {direction} ✗→✓"
              no expansion needed (all related directions are already ✓) → do not change analysis.md,
                move this change point from the "needs create" list back to the "needs update" list (append to subagent-update input)
                reason: this change point's test need is already covered by existing coverage directions; only update verification points of existing cases
        │
        §1.3 supplement: if the change point involves a new interface or new downstream → append to the §1.3 interface table;
              also query request/response per the interface-contract-lookup.md flow and append to api-details.md
        §1.4 supplement: if the PRD/technical design explicitly describes the call relationship between the new interface and an existing §1.3 interface
              (e.g. "interface A newly calls interface C internally", "new interface C is a precondition of interface B"),
              append that call relationship to the §1.4 chain analysis
              basis: depend only on PRD/technical-design wording; do not infer via static code analysis
        §2.2 supplement: if the change point involves a new data entity (new table/new field as a precondition dependency) → append to §2.2
        │
        Output:
        ├─ analysis.md updated
        └─ "Coverage-decision change record" (passed to Step1 to control expand scope):
              ├─ New module: [{moduleName}] → all ✓ directions pending expand
              └─ Existing module: [{moduleName}] → list only ✗→✓ directions pending expand
        │
        ▼
Step1: turn new change points into case designs
        Expand scope is driven by the Step0 "Coverage-decision change record" (do not expand directions that were already ✓ in existing modules):
        ├─ New module → read all ✓ directions of that module in §2.1, expand per case-authoring-rules.md §0
        └─ Existing module → read only the ✗→✓ directions recorded in Step0, expand per case-authoring-rules.md §0
        │
        Aggregate expanded verification points (the three aggregate rules in case-authoring-rules.md §0), then:
        ├─ Determine caseName (per case-authoring-rules.md §1.2 naming rules)
        ├─ Determine caseType (per case-authoring-rules.md §1.3 judgment rules)
        └─ Determine filePath (per the existing module directory structure)
        │
        ▼
Step2: batch-pregenerate UUIDs + write the registry
        Pregenerate all new-case UUIDs in one command:
          node -e 'for (let i = 0; i < Number(process.argv[1]); i++) console.log(crypto.randomUUID())' K
        append-write case-registry.json (status: "pending", change_reason: "change point has no coverage, incremental generation")
        │
        ▼
Step3: R3 review (read gate-coverage-review.md and execute)
        Run case-design review on new entries: coverage matrix + gap/redundancy/granularity detection + field compliance + coverage quality
        P0 fixed in place (gap entries added, fields corrected); P1 asked of the user
```

> ⚠️ **Step0 expand-scope control**: Step1 expands only coverage decisions actually added/changed in Step0; it does not re-expand directions that were already ✓ in existing modules (those directions already have case coverage). R3 review is the safety net, detecting redundancy between new entries and existing cases.

> ⚠️ **R3 review scope**: review only this run's new entries, not existing cases again; when reviewing, merge new entries with the existing registry to build the coverage matrix, ensuring new cases are not redundant with existing ones.

### Output the *Change Impact Analysis*

> After Phase 3 is fully complete, write `testdocs/change-impact-analysis.md` and show it to the user. Incremental design is already done, so "cases to create" can show concrete case names, verification points, and coverage directions. Use natural-language field names; do not expose internal concepts (source, subagent, search_key, etc.). Omit empty chapters.

```markdown
## Change impact analysis

### Change-point list
| Change ID | Source | Change type | Change content |
| ------ | ---- | -------- | -------- |
| R-001  | PRD  | Business-rule modification | Supported platforms: was Android/iOS/HarmonyOS → now Android/iOS only |
| R-003  | PRD  | Business-rule addition | New interaction: click a coupon card to jump to the usable-merchant list page |
| E-001  | Code | Interface-param addition | issueCoupon added required field userLevel(Integer), values 1-5 |

### Cases to update

| Case ID | Case name | Related change points | Reconstruct data? |
| ------ | -------- | ---------- | -------------- |
| TC-WALLET-0001 | Coupon page-My page entry end-to-end | R-001, E-001 | No |

#### TC-WALLET-0001 - Coupon page-My page entry end-to-end
- **Related change points**: R-001, E-001
- **Current content summary**: verify Android/iOS/HarmonyOS three-platform entry display; issueCoupon was called without userLevel
- **Update plan**:
  - Preconditions: remove "HarmonyOS platform" descriptions; platform scope becomes Android/iOS only
  - Verification points: delete HarmonyOS-platform display verification steps
  - Interface request: issueCoupon request body adds required `userLevel` and corresponding values
- **Reconstruct data**: No (request-param adjustment only; precondition data stays)

### Cases to create

| Case ID | Case name | Related change points | Create reason | Construct data? |
| ------ | -------- | ---------- | -------- | ---------- |
| TC-WALLET-0003 | Coupon page-click coupon card jump to merchant list | R-003 | Entirely new interaction path; existing cases have no coverage | Yes |

#### TC-WALLET-0003 - Coupon page-click coupon card jump to merchant list
- **Related change points**: R-003
- **Create reason**: this change introduces an entirely new interaction path; existing cases have no "click coupon card → page jump" verification point
- **Case design**:
  - Preconditions: the user has claimed a coupon; coupon status is usable
  - Verification points:
    1. Click the coupon card → jump to the usable-merchant list page; list content matches the coupon's applicable scope
    2. Click when the coupon is expired → toast "coupon expired", no jump
- **Construct data**: Yes (must construct two precondition groups: "claimed usable coupon" and "expired coupon")

### Cases to delete

| Case ID | Case name | Delete reason | Impact confirmation |
| ------ | -------- | -------- | -------- |
| TC-CPN-0099 | Example-retired scenario | All business rules have been removed from the PRD; the feature is retired | No other case depends on this case's precondition data |
```

### Human confirmation (required after Phase 3, before entering Phase 4)

After writing `change-impact-analysis.md`, **the flow must pause** and show the core output to the user for confirmation:

1. Show the following for user review:
   - Change-point list (all Change IDs + change content)
   - Cases to update (case ID, name, update summary)
   - Cases to create (case ID, name, create reason)
   - Cases to delete (if any)
2. At the end, give the full absolute path of `change-impact-analysis.md` and ask: "Please confirm whether the change impact analysis above is accurate and whether the update/create plans are reasonable, or edit the file and tell us. Analysis report path: `{absolute path}`. After confirmation we will enter the case generation and update phase."
3. **Wait for the user's explicit confirmation** (affirmative replies such as "confirm", "looks good", "continue") before entering Phase 4
4. If the user requests changes → correct the report per the feedback → re-show the changed parts → wait for confirmation again

**Skip-confirmation conditions** (any one triggers automatic execution): the user explicitly says "update directly without confirmation" / "auto execute".


---

## Phase 4: Case generation and update


**Redundant-case deletion** (if the *Change Impact Analysis* has "suggested-delete cases" and the user confirmed execution)

```
Check the "suggested-delete cases" list in the *Change Impact Analysis*
├── empty → skip
└── not empty → delete:
        ├─ delete the case .md files
        └─ remove the corresponding caseId entries from case-registry.json
```

> ⚠️ **Delete timing**: must finish before dispatching subagents, so subagents do not read retired cases.

**Parallel dispatch** (⚡ start all subagents in one shot)

After Phase 3 finishes and redundant deletion runs, the main agent **starts both of the following subagent types at the same time in one shot** (skip a type if it is empty):

```
⚡ Start together:
├── subagent-update × ⌈N/5⌉ (update existing cases; each owns at most 5)
└── subagent-gen × ⌈K/5⌉ (generate new cases; each owns at most 5)
    │
    ↓ After all subagents finish file writes
    Main agent batch-writes case-registry.json (updated entries + new entries status→done)
    │
    ↓ Write _meta + prd baseline commit
    │
    ↓ Collect the caseId list with "Reconstruct data? = Yes" (end if none)
    Main agent hands that caseId list to the `testdata-generation` skill (see "Data-construction handoff")
```

> ⚠️ **Parallel strategy**: subagent-update and subagent-gen must start together in one shot; do not batch, do not run serially. Each subagent owns at most 5 cases and processes them serially inside.

> ⚠️ **case-registry.json write timing**: after all subagents (update + gen) finish file writes, batch-write the registry in one shot; do not write entry by entry.

> ⚠️ **Data-construction handoff**: data construction is **not implemented in this skill**. After registry write + _meta write + prd baseline commit all finish, collect every caseId with "Reconstruct data? = Yes" and hand them to the sibling **`testdata-generation`** skill, whose case-material route backfills `{placeholder}`s from real backends. Pass the caseId list plus each case's `.md` absolute path; that skill reads placeholders, constructs the data, and writes real values back into the `.md`. Do not reimplement construction here and do not invent values to fill placeholders — an invented identifier makes the case unexecutable while looking complete. If `testdata-generation` is unavailable, leave the placeholders intact and tell the user which cases still need data. If no case needs data construction, skip this step.

**Cases follow the PRD**: assertion points are updated per the current PRD/technical design/spec. Even if code disagrees with the PRD, do not overwrite assertion points with code values.

---

### subagent-update execution spec

> After subagent-update starts, it `read_file`s `incremental-update-rules.md` (same directory as this file) and executes per those rules. The main agent does not need to know its internal steps.

**Dispatch input** (each subagent-update receives a list of at most 5 cases, each with dedicated context):

> ⛔ **Required dispatch-prompt contents (item-by-item checklist; do not dispatch if any is missing)**:
> - [ ] Full path to `incremental-update-rules.md` (the subagent's sole execution spec)
> - [ ] `manual-case-template.md` path (format spec referenced when updating)
> - [ ] Full path to `gate-case-quality.md` (L1 semantic self-check rule source)
> - [ ] Absolute `{skillRoot}` path, so the subagent can run `generation/quality-gates/lint_case_documents.ts`
> - [ ] File path of each case
> - [ ] Change-point list related to each case (Change ID + change description + **whether it is also marked "needs create"**)
> - [ ] Related PRD chapter paths for each case (file path + chapter title)
> - [ ] "Whether data must be reconstructed" conclusion for each case
> - [ ] **Explicitly state "after writing files run the linter first, then the gate-case-quality.md semantic pass; do not skip"**
>
> The subagent **`read_file`s all of the above files itself**. The main agent passes paths only and must not paraphrase or condense contents.

> ⛔ **Do not reorganize subagent duties**: the duty description in the subagent prompt must be "read `incremental-update-rules.md` and execute per its rules"; the main agent must not summarize steps, re-step, add section titles, inline format examples, or rewrite constraint wording. The main agent only fills paths and the entry list, and must not edit or "translate" the execution spec.

The subagent processes cases serially in list order. After reading the case `.md` and related PRD chapters, the subagent **decides itself** how to handle:
- Change concrete values (text replacement such as version numbers, config-item names)
- Add/edit verification points (rule-logic changes that require verification-point adjustment)

> ⚠️ **Verification-point update boundary**: when a change point appears in both the "needs update" and "needs create" lists, subagent-update only updates trigger/expected of existing verification points (so they reflect the post-change rule) and **must not add verification points for an independent scenario of that change point** (independent scenarios such as a new degradation path or a new exception branch are owned by subagent-gen). Criterion: if a verification point needs entirely new preconditions and a trigger path (rather than changing expected values on an existing path), it is an "independent scenario" and should be generated by subagent-gen.

**Return output** (after subagent-update finishes, return the following to the main agent for each case):

- `caseId`, `caseName`
- `last_updated` (real time)
- `change_reason` (description of this change reason)
- `business_rules_digest` (re-extracted from the current PRD)
- `coverage[]` (updated verification-point list)
- Self-check result (pass / fail finding details)
- Reconstruct data (Yes/No)

---

### subagent-gen execution spec

> Reuse the Step Two dispatch checklist in `generation/phase-3-cases.md`. Quote `generation/subagent-gen-duty.md` verbatim as the duty — do not copy duty text out of `generate-skill.md`.

**Dispatch input** (each subagent-gen receives at most 5 new-case registry entries):

> ⛔ **Required dispatch-prompt contents (item-by-item checklist; do not dispatch if any is missing)**:
> - [ ] `analysis.md` file path (the subagent needs: §1.3 system-under-test info, §2.2 data-entity inventory)
> - [ ] `api-details.md` file path (the subagent needs: each interface's full class name and request/response `<details>` blocks)
> - [ ] `manual-case-template.md` path (case `.md` template)
> - [ ] `case-authoring-rules.md` path (the subagent reads §1.4 case-generation constraints)
> - [ ] Full path to `gate-case-quality.md` (R4 semantic self-check rule source)
> - [ ] Absolute `{skillRoot}` path, so the subagent can invoke `generation/quality-gates/lint_case_documents.ts`
> - [ ] Full path to `generation/subagent-gen-duty.md` (quote it verbatim as the duty)
> - [ ] Related PRD chapter paths (PRD chapters where the change points live)
> - [ ] Each case's `caseId`, `caseName`, `filePath`, `caseType`, `coverage`
> - [ ] **Explicitly state "after writing files run R4 in two passes: linter first (7a), then the semantic pass (7b); do not skip"**
>
> The subagent **`read_file`s all of the above files itself**. The main agent passes paths only and must not paraphrase or condense contents.

> ⛔ **Do not inline file contents / format examples**: the subagent prompt may contain only file-path strings; do not write any file contents such as `analysis.md`, template structure, or format examples directly into the prompt. Inlined simplified examples would make the subagent treat the simplified version as authoritative and ignore template details.

> ⛔ **Do not reorganize subagent duties**: the duty description in the subagent prompt must be the verbatim text of `generation/subagent-gen-duty.md`; the main agent must not summarize, re-step, or rewrite constraint wording.

**Return output**:

- Each case's `caseId`, `last_updated`, `business_rules_digest`, self-check result

### Constraints

- ⛔ **Do not re-expand existing cases**: incremental generation only handles new cases for new rules; it does not modify any existing case
- ⚠️ **Registry writes**: new entries are appended to the existing `case-registry.json`; existing entries are not overwritten


---

## Referenced-file index

| File | Purpose                                        | When read |
|------|-------------------------------------------|----------|
| `incremental-update-rules.md` | **subagent-update execution spec** (main flow, self-check rules, field linkage, registry update, forbidden operations) | After subagent-update starts |
| `generation/subagent-gen-duty.md` | Verbatim duty for incremental `subagent-gen` (same file generate Phase 3 Step Two quotes) | When dispatching subagent-gen |
| `quality-gates/lint_case_documents.ts` | Deterministic R4 structure checks | After subagent-gen (and update) writes case `.md` files; run with `--resolved` |
| `quality-gates/gate-case-quality.md` | **Single source of truth for L1 semantic / template-structure self-check** | subagent-update Step2a; subagent-gen item 7b |
| `manual-case-template.md` | Case skeleton template (read by subagent-gen during incremental generation) | After subagent-gen starts |
| `case-authoring-rules.md` | §0 expand rules + §1.2/§1.3 naming/type judgment (incremental-generation prep + subagent-gen) | Prep Step1 expand + after subagent-gen starts |
| `requirement-analysis-guide.md` | §2.1 test-design-direction output format (referenced when Step0 creates a module) | Prep Step0 |
| `analysis.md` | §1.3 interface table, §1.4 chain analysis, §2.1 coverage decisions, §2.2 data-entity inventory (Step0 incremental update + subagent-gen read) | Prep Step0 + Step1 + after subagent-gen starts |
| `api-details.md` | Interface full class names and request/response details (Step0 new-interface lookup append + subagent-gen read) | Prep Step0 + after subagent-gen starts |
| `case-registry.json` | Case metadata management (status, digest, _meta baseline info); Phase 2 (change impact analysis) reads digests during semantic match | Phase 2 semantic match + Phase 4 wrap-up write |
