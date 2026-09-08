# Phase 1: Preparation

> Execute steps in numbered order. When you hit a GATE, the condition must be met before continuing.
> Detailed scripts/templates: `references/analysis/phase1-scripts.md`.

---

## Contents

- [Performance discipline (applies to the full flow; target: ≤15 minutes per service)](#performance-discipline-applies-to-the-full-flow-target-15-minutes-per-service)
- [Variable table](#variable-table)
- [Step 1.0: Clean stale data](#step-10-clean-stale-data)
- [Step 1.1: Locate the script + confirm identity](#step-11-locate-the-script-confirm-identity)
- [Step 1.2: Parse user input](#step-12-parse-user-input)
- [Step 1.3: Fetch plan details](#step-13-fetch-plan-details)
- [Step 1.3a: Fallback when a client plan has empty services](#step-13a-fallback-when-a-client-plan-has-empty-services)
- [Step 1.3c: Test-case DAG workflow [required for client plans]](#step-13c-test-case-dag-workflow-required-for-client-plans)
- [Step 1.3b: Code clone + Diff + register [one command; register as you go]](#step-13b-code-clone-diff-register-one-command-register-as-you-go)
- [Step 1.4: Submit the detection task](#step-14-submit-the-detection-task)
- [Step 1.5: Try to get batchIds](#step-15-try-to-get-batchids)
- [Step 1.6: Aggregate prerequisite data [atomic commands in parallel]](#step-16-aggregate-prerequisite-data-atomic-commands-in-parallel)
- [Step 1.2b: Build the call graph [Java services only; run immediately after clone]](#step-12b-build-the-call-graph-java-services-only-run-immediately-after-clone)
- [Step 1.6c: Call-chain analysis capability [Java services only]](#step-16c-call-chain-analysis-capability-java-services-only)
- [Step 1.7.0: Scan in-repo documents (Repo-Internal Docs)](#step-170-scan-in-repo-documents-repo-internal-docs)
- [Step 1.7: Mandatory deep document reading [GATE — cannot skip]](#step-17-mandatory-deep-document-reading-gate-cannot-skip)
- [Step 1.8: Build the detection plan](#step-18-build-the-detection-plan)
- [Step 1.8a: Method pre-filter [trivial-method-filter]](#step-18a-method-pre-filter-trivial-method-filter)
- [Step 1.8b: Record prep findings (register-finding)](#step-18b-record-prep-findings-register-finding)
- [Step 1.9: Output the start card](#step-19-output-the-start-card)
- [Multi-service orchestration (when $SERVICES[] ≥ 2)](#multi-service-orchestration-when-services-2)
- [Resume from a breakpoint](#resume-from-a-breakpoint)

---

## Performance discipline (applies to the full flow; target: ≤15 minutes per service)

1. **Parallel first**: commands in the same stage with no dependency must be issued in one tool-call batch
2. **Batch first (batch write-back gate)**: aggregate write-backs with `batch-update-process`
3. **Build once, submit once**: write-back commands (`update-process` / `batch-update-process`) already include auto pre-fix + validation; submit directly; do not trial-and-error format errors
4. **Read enough and stop**: read each file only once per task and reuse
5. **Degrade without looping**: optional fetches that fail degrade silently; do not retry repeatedly
6. **No idle spinning**: once a GATE is met, move on
7. **Load each Phase doc once**: do not re-read this file or `references/phase2-detection.md` / `references/feedback.md` after the first load unless a gate cites an unread section. After filter / `prep-and-plan`, enter Phase 2 without reloading `references/phase2-detection.md`.
8. **Do not browse the PR page** for source/target branch. Use gitUrl+branch from the user / plan / work-item ticket. `clone-and-diff` computes the merge-base. Confirm git access with `clone-and-diff`, not a browser.
9. **One-shot prep**: after `phase1-init`, prefer `clone-and-diff --with-plan` (or `prep-and-plan` if already cloned). Do not spend extra turns on `get-changed-methods` + `build-detection-plan` + `trivial-method-filter` as three separate commands.

---

## Variable table

| Variable | Source | Description |
|---|---|---|
| `$SKILL_SCRIPT` | 1.1 | Absolute path to scripts/detect.ts (`node "$SKILL_SCRIPT"`) |
| `$USER_ID` | 1.1 | Current user account |
| `$TEST_PLAN_ID` | 1.2 | Test plan ID |
| `$PLAN_NAME` | 1.3 | Plan name |
| `$SERVICES[]` | 1.3 | Service list (git/branch/serviceKey) |
| `$CASE_IDS[]` | 1.3 | Test case ID list |
| `$ISSUE_LIST[]` | 1.3 | Requirement ticket list |
| `$TASK_ID` | 1.4 | Detection task ID |
| `$CONTENT_STORE` | 1.4 | `<SKILL_DIR>/data/<taskId>/content.json` |
| `$BATCH_IDS[]` | 1.5 | All parentBatchId values |
| `$ALL_PENDING_MAP` | 1.8 | Full pending process map |
| `$VALID_TAG_IDS[]` | 1.6 | Valid tag IDs |
| `$RULES[]` | 1.6 | AST / custom rules |
| `$DIFF_FILES[]` | 1.3b | Changed file list (from clone-and-diff) |
| `$CHANGED_METHODS[]` | 1.8 | Changed method list (extracted from the diff when building the detection plan) |
| `$COMMIT_ID` | 1.3b | HEAD commit hash (from clone-and-diff) |
| `$HISTORY_DEFECTS[]` | 1.6 | Historical defects |
| `$DELIVERY_DEFECTS[]` | 1.6h | Already-filed defects (registered on the test plan; used for cross-check) |
| `$DOC_SUMMARY_PATH` | 1.7 | Path to DOC_SUMMARY.md |
| `$BIZ_RULES[]` | 1.7 | Business-rule list |
| `$DETECTION_PLAN[]` | 1.8 | Detection plan |

---

## Step 1.0: Clean stale data

Before starting a task, automatically clean historical taskId data directories that have been inactive for more than 48 hours:

```bash
node $SKILL_SCRIPT cleanup-stale-data
```

This step is non-blocking; cleanup failure does not stop later steps. Use `--dry-run` to preview and `--max-age-hours N` to change the threshold.

**A new task must not wipe the previous `data/<taskId>/`.** `submit-plan` / `submit-git` / `phase1-init` skip occupied directories and allocate a new taskId. If `init-content` / `clone-and-diff` find the directory belongs to another run, they keep the old directory and switch to a new taskId (return `remappedFrom`). Later commands must use the returned new `$TASK_ID`. Reuse an old directory only when the user explicitly says to continue the same taskId.

---

## Step 1.1: Locate the script + confirm identity

Locate `scripts/detect.ts` (prefer a path relative to the skill directory → common install directories → find as fallback). Invoke with `node "$SKILL_SCRIPT"`.

**Output**: `$SKILL_SCRIPT`, `$USER_ID` (`DETECTION_USER` or the auth provider `user_id`, default `local-user`)

**>>> GATE**: `$SKILL_SCRIPT` is non-empty and the file exists. If empty, report "skill not installed" and stop.

---

## Step 1.2: Parse user input

| Input form | Output |
|---|---|
| Test-plan link containing `planId=<number>` | `$TEST_PLAN_ID` |
| Delivery link containing `delivery/<number>` | Extract deliveryId → `get-plan-info --plan-id <id> --plan-type 4` → `$TEST_PLAN_ID` |
| Platform link containing a report ID | Extract the planId parameter |
| Git SSH + branch (no test plan) | Take the submit-git path (Step 1.4b) |
| Code PR URL (`.../pr/<id>/...`) plus ticket ID / branch in the user message | Extract the ticket ID + source branch from the message; `submit-git` / `clone-and-diff`. **Do not open the PR in a browser** |
| taskId (continue the same task) | Jump to Step 1.5; do not reuse an unrelated previous taskId |

**>>> GATE**: `$TEST_PLAN_ID` extracted successfully, or the Git / continue path is confirmed.

---

## Step 1.3: Fetch plan details

```bash
node "$SKILL_SCRIPT" get-plan-info --plan-id $TEST_PLAN_ID --plan-type 2
# When the user already provided materials in chat, pass them too (works without local enterprise files):
node "$SKILL_SCRIPT" get-plan-info --plan-id $TEST_PLAN_ID --plan-type 2 \
  --task-id $TASK_ID \
  --git "$GIT_URL" --branch "$BRANCH" \
  --user-materials-json "$USER_MATERIALS_JSON"
```

Plan details merge by priority: **plan provider** (`enterprise/plans/` or HTTP) → **content store** (`add-test-case` / `add-document` already under `--task-id`) → **user chat materials** (`--git` / `--user-materials-json`).

`degraded=true` is not a failure. Do not stop just because local `enterprise/plans/{id}.json` is missing.

**Materials have no hard chain dependency** (you do not need "a plan before a repo"). The only hard gate is **Git repository + branch**. Requirements / tech design / cases / historical defects / plan ID are independent of each other.

| Level | Material | If missing |
|---|---|---|
| Blocking | git + branch (`blocking` contains `services`) | Send `askUser[].prompt` **verbatim** to the user and wait. Do not clone until complete |
| Recommended | Requirement PRD, tech design, test cases | Ask once; if the user says "none / skip", continue |
| Optional | Historical defects, already-filed tickets, Trace, test plan ID | Do not chase; leave empty if they cannot be fetched |

```bash
node "$SKILL_SCRIPT" check-materials --plan-id $TEST_PLAN_ID --task-id $TASK_ID
```

When `canStart=false`, ask the user only for `blocking` items. Do not expose internal command names.

| Return field | Meaning |
|---|---|
| `source=provider` | Read a plan file / API |
| `source` contains `user_input` / `content_store` | User materials already filled the gap |
| `source=empty` + `missing` | Still missing services / cases / docs; ask the user per `nextActions`, or `add-test-case` / `add-document` |
| `hasUserMaterials=true` and `--task-id` was passed | Materials written to `data/<taskId>/` |

**Extract**: `$PLAN_NAME`, `$SERVICES[]`, `$CASE_IDS[]`, `$ISSUE_LIST[]`

**Conditional branches**:
- `$CASE_IDS[]` is non-empty **or** the user pasted cases and `add-test-case` ran → `HAS_CASES=true`
- Empty and the user provided none → `HAS_CASES=false`, continue
- `$SERVICES[]` is non-empty → normal flow, go to Step 1.3b
- **`$SERVICES[]` is empty** → first ask the user for git+branch or use a repo URL from chat; only if still empty go to Step 1.3a

**>>> GATE**: `$SERVICES[]` is finally non-empty (provider / user materials / Step 1.3a). If the user only gave a plan ID with no repo and no materials, ask for git+branch. Do not stop after reporting "plan does not exist".

---

## Step 1.3a: Fallback when a client plan has empty services

> **Trigger conditions**: `$SERVICES[]` from Step 1.3 is empty, usually meaning this is a **client (frontend) project plan**.

### Auto-detect and extract

When `$SERVICES[]` is empty, **the model decides** this is a client plan and automatically extracts the following from plan info:

```bash
# Method: call the built-in command to auto-extract client plan info
node "$SKILL_SCRIPT" extract-client-plan-info --task-id $TASK_ID --plan-id $TEST_PLAN_ID
```

**This command automatically**:
1. Judges the plan type as a client plan (based on plan_type / plan metadata flags)
2. Auto-extracts `$GIT_URL` (repo URL) from plan info
3. Auto-extracts `$BRANCH` (branch name to analyze) from plan info
4. Writes the result into content.json as a single virtual service (serviceKey marked `client_plan`)

**Return values include**: `gitUrl`, `branch`, `isClientPlan=true`, `autoExtracted=true`

### Degrade handling

- Plan info cannot fully extract the repo URL or branch name → ask the user to fill in:
  - Is there a repo SSH URL?
  - Is there a specified branch to analyze?
- If the user provides info → inject it into content.json dynamically
- If the user cannot provide it → stop the task with "client plan info is incomplete, cannot continue"

### Handoff to later steps

After a successful extract:
- `$SERVICES[]` is treated as obtained (contains the auto-extracted single virtual service)
- Go directly to Step 1.4 (submit the detection task)
- `clone-and-diff` still runs after Step 1.5, but only for that virtual service

**>>> GATE**: `extract-client-plan-info` successfully returns `$GIT_URL` and `$BRANCH`, or the user manually supplies complete info.

---

## Step 1.3c: Test-case DAG workflow [required for client plans]

> **Trigger conditions**: `$CASE_IDS[]` from Step 1.3 is empty, and this is judged to be a client (frontend) project plan (services empty or language is JS/TS).

### Design idea

Do not let the Agent orchestrate multi-step precise operations itself (get IDs → check empty content → refill details). Use a DAG workflow engine: Node 1 and Node 2 are forcibly chained by deterministic code; the Agent only does Node 3 semantic analysis.

The LLM does what it is good at (understanding semantics). What it is not good at (precise multi-step orchestration) is left to deterministic code.

### DAG workflow

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  Node 1 (fallback)  │────▶│  Node 2 (ensure)    │────▶│  Node 3 (Agent)     │
│  Deterministic code │     │  Deterministic code │     │  LLM semantic analysis│
│                     │     │                     │     │                     │
│  Fetch Test case ID │     │  Check if preCondition/│     │  Call skill:         │
│  Pull initial details│     │  steps are empty    │     │  test-case-         │
│  Write content store│     │  Empty → force test-case provider │     │  semantic-defect-   │
│  Fetch PRD info     │     │  Refetch details    │     │  review             │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

### Execution command (Node 1 + Node 2 in one command)

```bash
node "$SKILL_SCRIPT" testcase-pipeline \
  --task-id $TASK_ID \
  --plan-id $TEST_PLAN_ID
```

**This command automatically completes (Node 1 + Node 2 are all deterministic code, no LLM)**:

Node 1 (fallback):
1. Read existing `issueList` from content store meta; if empty, get `issueIds` via `get-plan-info --plan-id <planId>`
2. For each requirement ticket ID, find test-case groups via `test-case provider list_groups`
3. For each group, get case ID lists via `test-case provider list_case_ids`
4. If Steps 2–3 find no cases, get them directly by test plan ID via `test-case provider list_case_ids(plan_id)`
5. For each case, get details via `test-case provider get_case`
6. Write case details into the content store (upsert by id). Fields: id, title, preCondition, steps, expectedResult, fetchStatus, pipelineStatus, pipelineRetried
7. Also try `issue provider get_issue` for PRD info and write it into content store `prdDocs`

Node 2 (ensure) — code-level implementation of the empty-content forced-refetch gate:
8. Walk all test cases in the content store and check whether `preCondition` and `steps` are empty
9. For any case with an empty field, **force-call** `test-case provider get_case` to refetch details
10. Write the refetched full content back via `upsert_test_case` (upsert by caseId; do not overwrite existing semantic fields)
11. Cases still empty after refetch are marked `fetchStatus=failed`, but this does not block the flow
12. Output `node3Inputs[]`: structured input for each ready case

**Return values include**: a `dag` object (summaries for node1_fallback / node2_ensure / node3_ready), `hasCases`, `node3Inputs[]` (for the Agent to process one by one), `nextStep`

### Node 3: Agent semantic analysis (Agent executes)

After receiving `testcase-pipeline` output, for each case in `node3Inputs[]`:

1. Call skill `test-case-semantic-defect-review` and treat that test case as a compiled business contract
2. Run only that skill's "case semantic parse → atomic verification obligations" phase here
3. Input to the skill must at least include: `caseId`, `title`, `preCondition`, `steps`, `expectedResult`
4. Require a traceable structure back:

```json
{
  "semanticContract": {
    "scenario": {},
    "preconditions": [],
    "trigger": {},
    "stateTransitions": [],
    "postconditions": [],
    "invariants": [],
    "prohibitions": [],
    "sideEffects": [],
    "observations": []
  },
  "verificationObligations": [
    {
      "id": "TC-{caseId}-VO-1",
      "source": {"caseId": "...", "step": "...", "text": "..."},
      "ruleType": "guard|filtering|calculation|authorization|idempotency|state_transition|transaction|compensation|retry|timeout|fallback|concurrency|response_mapping|side_effect_absence",
      "when": [],
      "must": [],
      "mustNot": [],
      "criticalSinks": [],
      "observables": []
    }
  ],
  "ambiguities": []
}
```

5. Write results back via `add-test-case --case-json` (upsert by id), merging these fields into `test_cases.json`:

```bash
node "$SKILL_SCRIPT" add-test-case --task-id $TASK_ID --case-json '{
  "id": 123,
  "rawPreCondition": "original preconditions",
  "rawSteps": "original steps",
  "rawExpectedResult": "original expected result",
  "semanticContract": {...},
  "verificationObligations": [...],
  "ambiguities": [...],
  "semanticReviewStatus": "success",
  "semanticReviewSkill": "test-case-semantic-defect-review",
  "pipelineStatus": "reviewed"
}'
```

Do not overwrite or drop the original `preCondition`, `steps`, `expectedResult`. Phase 2 "test case input" is defined as: `semanticContract + verificationObligations + original source`.

### Failure and ambiguity handling

- Semantic-analysis skill unavailable or call failed: retry once; if it still fails, write the case as `semanticReviewStatus=failed`, record with `register-finding --category gap`, and block client Phase 2
- `verificationObligations` empty: treat as parse failure and block, unless the case clearly has no assertions; then mark `semanticReviewStatus=no_assertion`
- `ambiguities` non-empty but still has verifiable obligations: allow continue; Phase 2 treats ambiguities as evidence boundaries

### Degrade handling (Node 1+2 code layer)

- `get-plan-info` returns `degraded` / `source=empty` (no local plan file, insufficient permission, etc.) → record a warning; if the user already pasted cases/docs, use `add-test-case` / `add-document`; do not retry get-plan-info repeatedly
- `test-case provider list_groups` fails → record a warning, skip that issue ID
- `test-case provider get_case` fails (tried in both Node 1 and Node 2) → record a warning, mark `fetchStatus=failed`
- issue provider fails → record a warning (non-blocking), skip PRD fetch
- All degrades do not block the main flow; when final `hasCases=false`, set `HAS_CASES=false` and continue

### Handoff to later steps

- `hasCases=true` → set `HAS_CASES=true`; Agent runs Node 3 semantic compile
- `hasCases=false` → set `HAS_CASES=false`; continue later steps (do not block)
- PRD info is already in `prdDocs` and can be reused when reading docs in Step 1.7

**>>> GATE**: When client `HAS_CASES=true`, every test case sent for analysis must have `semanticReviewStatus=success` and non-empty `verificationObligations`; otherwise do not build a client detection plan.

---

## Step 1.3b: Code clone + Diff + register [one command; register as you go]

> ⚠️ **Execution-order note**: Although numbered 1.3b, this step depends on Step 1.4 `$TASK_ID` and Step 1.5 `$BATCH_ID`.
> Actual timing is **after Step 1.5** (run immediately after you have taskId + batchId). The 1.3b number is kept because it logically belongs to the "get code" stage.

For each service in `$SERVICES[]`, run `clone-and-diff` (**recommended**; clone + diff + register in one step):

```bash
node "$SKILL_SCRIPT" clone-and-diff \
  --task-id $TASK_ID --batch-id $BATCH_ID \
  --git-url "$GIT_URL" --branch "$BRANCH" \
  --service-key "$SERVICE_KEY" \
  --with-plan --submit-trivial
  # Base selection, pick one, priority high to low:
  #   --contrast-commit <contrast commit from the platform>   ← required for frontend (base is "foundation commit / branch fork point")
  #   --base-branch <contrast branch name>                   ← pass when the contrast branch is known
  #   (neither passed)                                       ← auto-detect the repo's real default branch (backend default)
```

`--with-plan` also runs get-changed-methods + build-detection-plan + trivial-method-filter in the same process. `--submit-trivial` batch-writes GETTER/SETTER (real `bodyLineCount≤3`) as bugStatus=2. If clone already finished without these flags, run `prep-and-plan --task-id $TASK_ID --submit-trivial` once.

> 🔴 **Base selection (critical; frontend and backend differ!)**:
>
> The platform underneath is a **two-dot diff** `commit ↔ contrast commit`. This command defaults to `--diff-mode two-dot` to match.
>
> - **Backend**: the diff is based on the repo **default branch** (**not necessarily master**; may be develop/main). Omit `--base-branch` and the command auto-detects `origin/HEAD`. Pass `--base-branch` only when detection fails or you must pin it.
> - **Frontend**: the diff is based on the **foundation commit (branch fork point)**, **not** the current HEAD of the default branch. You must pass the platform contrast commit as `--contrast-commit`; otherwise later merges on the default branch from other people get counted and changed-file counts explode.
>
> ⚠️ **Do not hard-code `--base-branch master`**: that miscomputes diffs for backend repos whose default branch is not master, and for frontend repos that need a foundation commit (root cause of a historical bug).
>
> If the diff base cannot be resolved (contrast-commit/base-branch wrong or unreachable), the command returns `code=1` with a clear error. If the diff succeeds but `diffFileCount=0`, the return includes a `warning` to check the base — **do not** treat that as "no changes" immediately; check whether frontend omitted `--contrast-commit` and whether the backend default branch was detected correctly.

> ⚠️ **Local directories are reused by `git_url + branch`, not by service identity**: internally the directory is named `repoHash = md5(git_url@branch)[:12]`.
> The same repo + same branch, even under multiple services/batches, is cloned once and shares one local tree (`--service-key` is now optional, used only for logs/return info).
> This avoids "same repo cloned and analyzed repeatedly" (see lessons-learned LL-PHASE1-005).

**This command automatically**:
1. git clone (depth 200, so diff does not fail from insufficient history); if the same `repoHash` directory already exists, reuse it and incremental-fetch
2. Resolve the diff base: `--contrast-commit` > `--base-branch` > auto-detect default branch, and explicitly fetch base history locally
3. git diff (default two-dot `base..HEAD`, aligned with the platform two-dot diff; on failure degrade stepwise to three-dot / merge-base; if all fail, error clearly)
4. register-repo-clone (code-clone gate; credentials still recorded on the current batch)

**Return values include**: `localDir`, `repoHash`, `commitId`, `diffFiles[]`, `diffFileCount`, `baseSource` (base origin), `baseRev`, `diffMode`; extra `warning` when the diff is empty

- **Success** → you directly get `$LOCAL_DIR`, `$COMMIT_ID`, `$DIFF_FILES[]`; no separate git diff needed
- **Failure** → ask the user (ignore / request access / abort)
  - Ignore + task already submitted → must call `skip-service-batch`

**>>> GATE**: Services that participate in detection must succeed at clone-and-diff (return code=0).

> ⚠️ **Code-clone gate is front-loaded**: clone registration must finish in Phase 1. If you delay registration until Phase 2 write-back,
> the Agent may not have analyzed real code (fabricate conclusions first, then clone), which violates core constraint 2 (real detection).
> Phase 2 entry `check-phase2-readiness` checks this programmatically.

> Script details: `references/analysis/phase1-scripts.md#step-1.3b`

---

## Step 1.4: Submit the detection task

### Method A: one-shot command (recommended)

Merge Steps 1.4–1.6 into a single command to reduce Agent orchestration:

```bash
node "$SKILL_SCRIPT" phase1-init \
  --plan-id $TEST_PLAN_ID --plan-type 2 --submit-user $USER_ID \
  --services-json '$SERVICES_JSON'
```

**This command automatically**: submit-plan → init-content → add-service → phase1-fetch-all (tags + rules + historical defects in parallel)

**Tag cache**: tag data is shared across tasks for 24 hours and is not re-fetched. Return `tagsFromCache=true` means a cache hit.

**Extract**: `$TASK_ID`, `$BATCH_IDS[]`, `$VALID_TAG_IDS[]` (in the return value).

### Method B: step by step

```bash
node "$SKILL_SCRIPT" submit-plan --plan-id $TEST_PLAN_ID --plan-type 2 --submit-user $USER_ID
```

**Extract**: `$TASK_ID`. `submit-plan` / `submit-git` already initialize content.json and register the service, so `init-content` is only needed when continuing a task whose `data/{taskId}` was removed. If `init-content` / `phase1-init` returns `remappedFrom`, overwrite `$TASK_ID` with the new `taskId` and leave the old directory untouched.

**>>> GATE**: `$TASK_ID` is a positive integer. On failure, silently retry once.

---

## Step 1.5: Try to get batchIds

```bash
node "$SKILL_SCRIPT" status --task-id $TASK_ID
```

**Extract**: `$BATCH_IDS[]` (all batchIds; do not take only the first)

**Strategy**: call once; if `batchIds` is non-empty, store in `$BATCH_IDS[]` for Step 1.8 `get-pending`; if empty, skip — **do not block; go straight to Step 1.6**.

> **Note**: the `status` field is not used for any progress decision. `status=1(RUNNING)` is the normal state after submit; `status=2(COMPLETED)` is the terminal state written by the platform only after the Agent has finished all write-backs. Do not wait for status=2.

**Before write-back**: if `$BATCH_IDS[]` is still empty, poll once more before Phase 3 write-back (until `batchIds` is non-empty, up to 5 minutes; stop on status=3).

**Multi-batchId rule**: you must write back for every batchId (`update-process` / `complete-task`). Missing any one fails the gate.

---

## Step 1.6: Aggregate prerequisite data [atomic commands in parallel]

> `$DIFF_FILES[]`, `$COMMIT_ID`, `$LOCAL_DIR` were already obtained in Step 1.3b `clone-and-diff`; do not repeat them here.

### Method A: one-shot command (recommended; skip if Step 1.4 already used phase1-init)

```bash
node "$SKILL_SCRIPT" phase1-fetch-all --task-id $TASK_ID --git-url "$GIT_URL" --user-id "$USER_ID" --plan-id $TEST_PLAN_ID
```

**Tag cache**: tag data is shared across tasks for 24 hours; `tagsFromCache=true` means a cache hit and no extra API pull.

### Method B: parallel atomic commands

Issue the following atomic commands in **the same tool-call batch**, each fetching one prerequisite:

```bash
# Issue in parallel (same tool-call batch)
node "$SKILL_SCRIPT" get-tag-list
node "$SKILL_SCRIPT" get-rules --git "$GIT_URL" --user-id "$USER_ID"
node "$SKILL_SCRIPT" get-confirmed-defect-history --git "$GIT_URL"
node "$SKILL_SCRIPT" get-exception-traces --plan-id $TEST_PLAN_ID --plan-type 2 --task-id $TASK_ID
node "$SKILL_SCRIPT" get-delivery-defects --plan-id $TEST_PLAN_ID --plan-type 2 --task-id $TASK_ID
```

**Data-item notes**:

| Data item | Command | Required |
|---|---|---|
| Tag list | get-tag-list | ✅ | Local provider returns the `seed_catalog` tree tags (with id/tagId and children) |
| AST / custom rules | get-rules | ✅ | Local provider returns scannable category=1 Semgrep rules and 2/3/4 natural-language rules |
| Historically confirmed defects | get-confirmed-defect-history | Optional | Narrow with `--class-name` / `--method-name`; `get-defect-history-by-commit --git ... --dev-commit <sha>` queries by the commit that introduced the change |
| Exception-traffic traces | get-exception-traces | Optional |
| Already-filed defects | get-delivery-defects | ✅ recommended |

**Each command succeeds or fails independently**: the Agent decides whether to degrade from each return. Required items (tags, rules) get one extra retry on failure.

### Fetch test cases (required when HAS_CASES=true)

```bash
test-case provider get_case   # pull case body one by one
```

On pull failure, record with `register-finding --category gap --text "Test case [ID] fetch failed"` and degrade to `HAS_CASES=false`.

### Extra notes on already-filed defects

`get-delivery-defects` / `get-exception-traces` return `degraded=true` and an empty list (exit code still 0) when local `enterprise/plans/{id}.defects.json` or traces files are missing. You may write historical defects/traces from chat into the content store, or read them with `--task-id`. Do not stop because of this.

**>>> GATE**: `$DIFF_FILES[]` + `$VALID_TAG_IDS[]` (tagMap non-empty and tagSuccess=true) + `$COMMIT_ID` are all non-empty. When `HAS_CASES=true`, `$CASES[]` is non-empty.

**Code-clone gate**: already completed by `clone-and-diff`. If you clone manually, you must immediately call `register-repo-clone`.

**Code-read gate**: register-code-read is a **mandatory action, not an optional optimization**. The unified rule is "register as soon as you finish reading" — **after finishing the source of each className, immediately `register-code-read` once**. Phase 2 STEP A implements this (see references/phase2-detection.md "STEP A: read code → register-code-read").

> ⚠️ Do not batch-register just before write-back: that can still pass the gate, but it breaks the "read one, register one" causality and easily misses registrations across processes, triggering a false code-read-gate block. Phase 1 may **optionally** do a one-shot warmup batch register for known classNames to speed up, but that **does not replace** STEP A's mandatory "register as soon as you finish reading".

> Command details: `references/analysis/phase1-scripts.md#step-1.6`

---

## Step 1.2b: Build the call graph [Java services only; run immediately after clone]

> **Trigger conditions**: after `clone-and-diff` succeeds, run once for each Java service `$LOCAL_DIR`.
> **Prerequisite**: `clone-and-diff` is done (`$LOCAL_DIR` exists).
> **Default tool**: local call-graph analyzer GitNexus (CLI `gitnexus` + MCP). Does not depend on any remote quality platform.

```bash
# clone-and-diff already does this for non-JS/TS services. Skip unless gitnexus.ready=false:
node "$SKILL_SCRIPT" ensure-gitnexus --task-id $TASK_ID --local-dir "$LOCAL_DIR"
```

If the same `<data dir>/repos/<repoHash>` clone (override root with `DETECTION_CLONE_DIR`) is reused and HEAD has not changed, `ensure-gitnexus` skips `gitnexus analyze`. Do not run a second install probe after a successful clone-and-diff.

`ensure-gitnexus` order:

1. Probe whether `gitnexus` is already on PATH (`gitnexus --version`)
2. **Not installed → force-install once**: `npm install -g gitnexus@latest` (if no npm, `pnpm add -g gitnexus@latest`; needs Node ≥ 18)
3. Install succeeds → run `gitnexus analyze` in `$LOCAL_DIR` (typically 5–15 seconds)
4. Phase 2 graph query: prefer GitNexus MCP; if the host has no such MCP, use `gitnexus-impact` / `gitnexus-context` CLI. An empty Cursor `mcp.json` does not mean the graph was not built. Optional `gitnexus setup` to register MCP.
4. Install fails → the Agent may retry once with `--force-install` (after fixing Node/npm)
5. Still fails, or analyze times out/fails → **then** degrade to grep/find; do not block the task

By default the machine auto-installs only once (failure is stamped). Do not degrade directly when it is not installed.

**Multiple services**: run `ensure-gitnexus --local-dir ...` once per Java `$LOCAL_DIR` (can be parallel; install happens only once).

**>>> GATE**: no hard GATE. content store `meta.gitnexus.ready` / `callGraph` tells Phase 2 whether to use MCP or grep.

---

## Step 1.6c: Call-chain analysis capability [Java services only]

> **Role**: GitNexus is the **default call-chain analysis method** for Phase 2 business detection (strategy=11).
> **Graph query entry**: if the host has GitNexus MCP, call MCP directly; otherwise use `$SKILL_SCRIPT gitnexus-impact` / `gitnexus-context` / `gitnexus-query`.
> **Prerequisite**: after clone, run `gitnexus analyze` to build the graph (Step 1.2b). The tool runs locally and does not upload source to an external platform.

### Default MCP tools

| Tool | Capability |
|------|------|
| `impact({target, direction:"upstream"})` | Query callers of a method (upstream), layered by depth (d=1 / d=2 / d=3) |
| `impact({target, direction:"downstream"})` | Query callees of a method (downstream) |
| `context({name, kind, content:true})` | Get a method/class context view (callers / callees / owning execution flow / source) |
| `detect_changes({scope:"all"})` | Map git diff onto affected symbols and execution flows |
| `query({query})` | Auxiliary search by symbol / execution flow |

Output is a structured call-chain path (with depth layers and confidence). After reading it, the Agent decides which files to read and concatenates the chain description in content. There is no directly walkable `$CALL_CHAINS` field.

### Usage scenarios

- strategy=11 chain analysis: use `impact({direction:"upstream"})` + `impact({direction:"downstream"})` to get upstream/downstream and concatenate the call-chain path
- strategy=11 business + chain: use `context()` for an end-to-end view, plus `impact()` for cross-service dependency analysis
- Cross-repo locate: use `impact({direction:"downstream"})` / `context()` to locate downstream service identities
- Change impact: use `detect_changes()` to map the diff onto affected symbols

### Degrade handling

- `ensure-gitnexus` returns `ready=false` (install did not succeed and the Agent cannot fix it, or analyze failed) → degrade to grep/find, **do not block** the main flow. Do not degrade directly without first running install probe.
- MCP returns incomplete results (e.g. cross-repo unreachable) → supplement with grep

### Relation to Phase 2

Call-chain analysis is **used immediately after the Agent reads it** in Phase 2 STEP B (concatenate content call-chain paths, help cross-repo locate, etc.). It **does not** go through structured fields in the content store.

---

## Step 1.7.0: Scan in-repo documents (Repo-Internal Docs)

> **Trigger conditions**: run automatically after `clone-and-diff` completes (`$LOCAL_DIR` already exists).

### Background

Some repos store technical docs (API notes, architecture, changelogs, etc.) directly in Git (e.g. `docs/`, `README.md`, `CHANGELOG.md`). These docs share history with the code and are often more accurate and closer to the current branch than external docs. Step 1.7.0 scans and extracts relevant docs from the local repo before remote doc fetch (Step 1.7).

### What to run

```bash
node "$SKILL_SCRIPT" scan-repo-docs --task-id $TASK_ID
```

This command automatically:

1. **Walk every registered service `localDir`** and scan these path patterns:
   - `docs/**/*.md`, `doc/**/*.md`
   - `README.md`, `README_*.md`
   - `CHANGELOG.md`, `CHANGES.md`
   - `**/package-info.java` (Java package-level docs)

2. **Relevance filter**: keep only docs related to `$DIFF_FILES[]`:
   - Doc path is under the same module/directory tree as a changed file
   - Doc content mentions a changed class name or method name
   - `README.md` / `CHANGELOG.md` are always kept (global docs)

3. **Read and truncate**: each doc is read up to the first **8000 characters** (avoid huge docs filling context)

4. **Write content store**: call `add-document` for each matching doc:
   ```bash
   node "$SKILL_SCRIPT" add-document --task-id $TASK_ID \
     --doc-type techDocs \
     --doc-json '{"title":"docs/api-design.md","filePath":"docs/api-design.md","repoSource":"local_repo","fetchMethod":"local_repo","fetchStatus":"success"}'
   ```

### New field notes

| Field | Type | Description |
|------|------|------|
| `filePath` | string | Relative path of the doc in the repo |
| `repoSource` | string | Fixed value `"local_repo"`, marks the source as an in-repo document |

### Relation to Step 1.7

- Step 1.7.0 scans in-repo docs → writes `static.json` `documents.techDocs[]`
- Step 1.7 continues fetching requirement docs and extra tech docs from outside (configured docs provider → host agent's doc tool → web_fetch)
- The two complement each other; Phase 2 `extractedRules` extraction covers both sources

### Degrade handling

- `localDir` missing or empty → skip that service, output `[SKIP] no localDir`
- Scan finds 0 docs → finish normally, do not block (the repo may simply have no docs)

---

## Step 1.7: Mandatory deep document reading [GATE — cannot skip]

> **Trigger conditions**: `$ISSUE_LIST[]` or `$CASE_IDS[]` is non-empty.

### What to run

1. **1.7.1**: Read tech docs & requirement docs. Docs registered by id / URL are fetched automatically through the configured docs provider (`enterprise/docs/` locally, `DETECTION_DOCS_KIND=http` remotely); check each record's `fetchStatus`. On `failed`, degrade to the host agent's own document tool, then `web_fetch`, and register the body with `add-document`.
2. **1.7.2**: Write test-case bodies already pulled in Step 1.6g into the content store (`add-test-case`)
3. **1.7.3**: Write `<SKILL_DIR>/data/<TASK_ID>/DOC_SUMMARY.md`
4. **1.7.4**: **[Critical] Parse docs and extract extractedRules into content.json**

### Extract from each document

Core APIs, business rules, degrade strategies, data flow, boundary conditions, config dependencies

### 1.7.4 extractedRules extraction and persistence (programmatic check; cannot skip)

After reading docs, the Agent **must** write extracted business rules into content.json in structured form:

#### Method A: one-shot command (recommended)

```bash
node "$SKILL_SCRIPT" extract-rules-from-docs --task-id $TASK_ID
```

**This command automatically**: read DOC_SUMMARY.md → parse business rules from tables/lists → fill businessRules on techDocs/prdDocs in the content store → auto-number extractedRules → write the content store. The Agent only checks returned rule count and quality, and supplements manually if insufficient.

#### Method B: extract and write manually

```bash
node "$SKILL_SCRIPT" set-meta-field --task-id $TASK_ID \
  --key extractedRules \
  --value '[{"id":"R1","text":"under xxx conditions should xxx","source":"tech doc/requirement doc/test case"},...]'
```

**Extraction requirements**:
- Each rule has `id` (number such as R1/R2), `text` (business-rule description), `source` (source document)
- Rules should cover: API contracts, data-validation rules, business-flow constraints, boundary conditions, config dependencies
- Quantity: a typical iteration should extract **3 or more** business rules (fewer than 2 means parsing was insufficient)

**Why persistence is required**:
- Phase 2 `minDetectLevel` calculation depends on extractedRules for docRelevance labels
- Phase 2 Step 2.7 requirement-coverage check (`check-req-coverage`) reads extractedRules
- Phase 2 Step 2.7c triangle cross-check depends on extractedRules as the "requirement view" input
- `check-phase2-readiness` **programmatically checks** that extractedRules is non-empty; empty blocks entry to Phase 2

**If you skip this**: the Agent reads docs but extracts no rules → content.json has extractedRules=[] → Phase 2 doc-relevance analysis and cross-validation are all skipped for "no data" → the docs were wasted.

### Degrade handling

docs provider `fetchStatus: failed` → host agent's doc tool → web_fetch → record `[FAILED]`; Phase 2 marks `[DOC_FETCH_FAILED]`

**>>> GATE** (dual check):
1. `DOC_SUMMARY.md` written successfully and non-empty
2. `extractedRules` written into content.json via `set-meta-field` with count ≥ 2 (`check-phase2-readiness` intercepts programmatically)

> Templates/scripts: `references/analysis/phase1-scripts.md#step-1.7`

---

## Step 1.8: Build the detection plan

> Full spec: `references/analysis/detection-plan-spec.md`

### Method A: one-shot command (recommended)

If `clone-and-diff --with-plan` already ran, skip this step. Otherwise one command:

```bash
node "$SKILL_SCRIPT" prep-and-plan --task-id $TASK_ID --submit-trivial
# optional: --local-dir $LOCAL_DIR  (defaults to the registered clone)
```

`prep-and-plan` automatically: get-changed-methods → build-detection-plan (marks trivial getters immediately) → trivial-method-filter. `--submit-trivial` batch-writes those getters/setters as bugStatus=2 so you do not compose thinking blobs.

Split form (only if you must debug a step):

```bash
node "$SKILL_SCRIPT" get-changed-methods --task-id $TASK_ID --local-dir $LOCAL_DIR
node "$SKILL_SCRIPT" build-detection-plan --task-id $TASK_ID
node "$SKILL_SCRIPT" trivial-method-filter --task-id "$TASK_ID" --submit
```

**`get-changed-methods` automatically**: parse git diff → extract method signatures/line numbers/bodyLineCount → call `set-diff-files` + `set-changed-methods` to persist.

**`build-detection-plan` automatically**: call `get-pending` for platform pending → union with changedMethods → assign strategyCode/minDetectLevel/detectTier from docRelevance/caseRelevance → call `add_detection_plan_items` in batch.

### Method B: manual steps

### Core flow

```
Stage 1: extract changed methods from git diff + label docRelevance/caseRelevance
          ↳ also compute bodyLineCount (method-body line count) from diff-hunk method boundaries,
            write className/methodName/params together into plan items for Step 1.8a local pre-filter reuse (zero extra source reads)
    ↓
Stage 2: get-pending (when $BATCH_IDS[] is non-empty) → build $ALL_PENDING_MAP
          If $BATCH_IDS[] is empty, skip and build the detection plan from diff results only
          Local platform: the first build-detection-plan seeds a pending process per diff item,
            so a later get-pending returns them (still source=diff for tier purposes)
    ↓
Stage 3: merge (union) → $DETECTION_PLAN[]
    - source=pending: platform-mandated, cannot omit (when $BATCH_IDS[] exists)
    - source=diff: Agent supplement; the only source when $BATCH_IDS[] is empty
    - each item gets minDetectLevel (lower bound on Phase 2 analysis depth)
    ↓
Stage 4: chain clustering → assign chainGroupId to each item
    - Default: cluster via GitNexus MCP (`impact({direction:"upstream"})` / `impact({direction:"downstream"})`) call relations
    - If GitNexus is unavailable, degrade to grep/find static clustering
    - If clustering is unreliable (cross-repo unreachable / dynamic dispatch), chainGroupId=null and group by className as usual
    - This is analysis-orchestration only; it does not change any write-back credential requirement; failure must never skip pending
```

### Strategy assignment (diff-only methods)

| Condition | Strategy |
|------|------|
| Business detection (includes call chain + business-knowledge compare) | strategy=11 (business detection strategy; Agent chooses analysis depth from method difficulty) |
| AST hit | strategy=8 |

> The Agent chooses analysis depth from the method's detectTier and case/doc relevance.

### minDetectLevel quick reference

| caseRelevance=direct | → L2+TC |
|---|---|
| caseRelevance=indirect or docRelevance=direct | → L2 |
| docRelevance=indirect | → L1+doc |
| Other | → L1 |

---

## Step 1.8a: Method pre-filter [trivial-method-filter]

> Run after the detection plan is built and before entering Phase 2. **Pure local command, zero network.**

Based on method-signature features + body line count, quickly identify getter/setter/delegate/toString/hashCode and other simple methods so the Agent does not run the full STEP A→D analysis on them.

**Input reuse**: `get-changed-methods` persists `bodyLineCount` / `params` on `diff.changedMethods`. `build-detection-plan` copies them onto plan items. `trivial-method-filter --task-id` reads those stored counts — do not invent a substitute such as 5. If `bodyLineCount` is still missing: categories that depend on line count (GETTER/SETTER/BUILDER, etc.) are conservatively treated as non-trivial (analyze extra rather than miss), while `toString`/`hashCode`/`equals` can still be recognized.

```bash
# Recommended: classify + stamp plan + CLI write-back of getters/setters (do not compose thinking blobs)
node "$SKILL_SCRIPT" trivial-method-filter --task-id "$TASK_ID" --submit

# Inline JSON (few methods; classify only)
node "$SKILL_SCRIPT" trivial-method-filter \
  --methods '[{"className":"OrderDTO","methodName":"getOrderId","bodyLineCount":1,"params":""}]'

# Read from a plan file (many methods)
node "$SKILL_SCRIPT" trivial-method-filter --methods-file plan_methods.json --task-id "$TASK_ID" --submit
```

`--task-id` fills missing `bodyLineCount` / `params` from `get-changed-methods` (content-store `diff.changedMethods`). Do not invent a default line count such as 5 — that makes real getters look non-trivial.

`build-detection-plan` / `prep-and-plan` already stamp `trivial` / `trivialReason` on plan items. Prefer `--submit` so the CLI writes bugStatus=2. Do **not** spend turns composing one thinking blob per getter.

**Return**: `trivial=true` → already written as bugStatus=2 when `--submit` was used; skip STEP A→D. `trivial=false` → run the full analysis, with `suggestedTier` (T0→T3) guiding depth. Final analysis depth is the deeper of `suggestedTier` and `minDetectLevel` (the Step 1.8 lower bound from doc/case relevance). Only `deepAnalysis[]` needs Phase 2.

**Degrade**: missing `bodyLineCount` automatically falls back to signature-only judgment and does not block; if the whole command fails, skip pre-filter and analyze every method per the original plan.

---

## Step 1.8b: Record prep findings (register-finding)

Information gaps and requirement-change points found during Phase 1 are recorded into content.json with `register-finding` for the final summary.

**Must-record moments** (call as soon as they happen; do not wait until the end):

| Moment | phase | category | Example text |
|------|-------|----------|-----------|
| Doc fetch failed / no permission | prep | gap | Tech doc contentId=xxx has no permission; degrade to code-only analysis |
| No test cases associated | prep | gap | This plan has no associated test cases; cannot compare case coverage |
| Clone failed, service skipped | prep | gap | order-service skipped due to insufficient git permission |
| Requirement-change point extracted from issue tracker/docs | prep | change | Added discount-code migration logic involving DiscountTransferService |
| Core change seen in git diff | prep | change | Changed validation logic in OrderValidator.validate() |

```bash
node "$SKILL_SCRIPT" register-finding --task-id $TASK_ID \
  --phase prep --category <gap|change> \
  --text "<concrete fact>" \
  --source "<source, e.g. contentId/service name>"
```

> Do not batch these at the end; record each as you find it. Findings during Phase 2 analysis use `--phase analysis`.

---

## Step 1.9: Output the start card

Output using the "start card" template in `references/output/output-templates.md`.

**>>> GATE**: the card must be output before entering Phase 2.

---

## Multi-service orchestration (when $SERVICES[] ≥ 2)

Main Agent orchestrates → child Agents detect each service in parallel → main Agent converges. Degrade: single service does not orchestrate; clone failure is not analyzed; after 30min timeout, take over.

> Detailed hierarchy: `references/analysis/phase1-scripts.md#multi-service-orchestration-model`

---

## Resume from a breakpoint

When user input contains a taskId or says "resume": `show-local-progress` + `get-pending --skip-local-done` → continue on the remainder.

> Full commands: `references/analysis/phase1-scripts.md#resume-from-breakpoint`

---

**After Phase 1 completes → if you have not loaded `references/phase2-detection.md` yet, load it once and enter detection. Do not reload it after the filter.**
