# Phase 4: User feedback + query and Q&A

> **When to load**: after detection completes (final summary already output), when the user starts feedback or a query.
>
> **How to get rankId**: the user refers to a defect by number (e.g. "item 2"). The Agent gets the full defect list (including rankId) via `get-findings --task-id $TASK_ID` and maps the user's number to rankId by display order in the summary. rankId is an internal field and must not be exposed to the user.

---

## bugStatus semantics (unified value domain)

`bugStatus` meanings are globally consistent. See `references/writeback.md` → bugStatus semantics (unified value domain, globally consistent).

---

## Feedback recognition

| User says | Action |
|---|---|
| "item 2 is a real defect" / "confirm" | `mark-bug --bug-status 3` (bugStatus=3: needs fix; user confirmed) |
| "false positive" / "invalid" / "not a defect" | `mark-bug --bug-status 4` (bugStatus=4: invalid defect) |
| "later" / "do not handle for now" | `mark-bug --bug-status 5` (bugStatus=5: later improvement) |
| "duplicates item 1" | `mark-bug --bug-status 8` (bugStatus=8: duplicate defect) |
| "re-analyze" / "the conclusion is wrong; it should be XX" | Overlay write-back `update-process` → `finalize-rank` |
| "write this defect into the report" | Append write-back `update-process` → `finalize-rank` |
| "you slacked off" / "you did not look carefully" / "detect again" / "how did you miss this" (preconditions unchanged) | **Recheck current task (branch A)** re-analyze → overlay write-back → refresh the original report (**do not create a new task**) |
| "the requirement changed / code was resubmitted; test again" (preconditions changed) | **New-task retest (branch B)** `invalid-record` → `retry` |

---

## mark-bug confirm defect (bugStatus=3)

```bash
node "$SKILL_SCRIPT" mark-bug --rank-id <rankId> --bug-status 3 --task-id <taskId>

# Confirm only; do not create a Bug
node "$SKILL_SCRIPT" mark-bug --rank-id <rankId> --bug-status 3 --no-create-bug
```

---

## mark-bug false-positive attribution (bugStatus=4)

```bash
# First call (no --extra) → the script returns the detection flow for analysis
node "$SKILL_SCRIPT" mark-bug --rank-id 12345 --bug-status 4

# After the Agent analyzes, call again with attribution
node "$SKILL_SCRIPT" mark-bug --rank-id 12345 --bug-status 4 \
  --extra "OrderService#cancelOrder does not trigger refund in the test environment; not a real production issue"
```

> Note: after false-positive attribution (invalid conclusion + extra) is submitted, exclusion rules are extracted automatically by a platform-side background job. No manual trigger is needed.

---

## mark-bug other statuses

```bash
node "$SKILL_SCRIPT" mark-bug --rank-id <rankId> --bug-status 5  # later improvement (user decision)
node "$SKILL_SCRIPT" mark-bug --rank-id <rankId> --bug-status 8  # duplicate defect (user decision)
```

---

## Overlay write-back (change an existing conclusion)

**Scenario**: the user is unhappy with an existing detection conclusion and wants it changed (difference from mark-bug: overlay write-back changes the AI detection conclusion itself).

**⚠️ Auto write-back rule (MUST):** when the Agent re-analyzes from user feedback and confirms the conclusion must change, it must **automatically complete the full write-back flow** (update-process → finalize-rank / update-rank-content). Do not wait for extra user instructions about write-back steps. Write-back is a natural extension of the analysis conclusion, not an operation that needs separate authorization.

**Auto-trigger conditions:**

| Scenario | Triggered action |
|---|---|
| User says "this is a real defect" / "confirm item X" + Agent finds current bugStatus≠6 | Auto update-process(bugStatus=6) → finalize-rank |
| User says "the conclusion is wrong; it should be XX" + Agent changes the conclusion after re-analysis | Auto update-process(new conclusion) → finalize-rank / update-rank-content |
| User says "write this defect into the report" | Auto update-process → finalize-rank |
| Agent finds a new defect during detection (including one pointed out by the user) | Auto update-process → finalize-rank |

**Forbidden**: after finishing update-process, stop and ask the user "do we need finalize-rank" — the answer is always "yes".

```bash
# Step 1: write back again (idempotent overlay)
node "$SKILL_SCRIPT" update-process \
  --batch-id <parentBatchId> \
  --class-name "com.example.xxx.Service" \
  --method-name "targetMethod" \
  --bug-status <new bugStatus> \
  --strategy-code <strategyCode> \
  --thinking "Re-analyzed from user feedback:..." \
  --content "<fill from the full references/writeback.md template>" \
  --tag-id <tagId> \
  --file-codes '[...]' \
  --process-steps '[...]'

# Step 2: update rank (must immediately follow Step 1; do not pause for user confirmation)
# rank already exists → update-rank-content
node "$SKILL_SCRIPT" update-rank-content --rank-id <rankId> --content "<new description>"

# rank does not exist (changed from no defect to has a defect) → finalize-rank
node "$SKILL_SCRIPT" finalize-rank \
  --batch-id <parentBatchId> --class-name "..." --method-name "..." \
  --content "<defect summary>" --bug-status 6 --process-ids "<processId>"
```

- From "has a defect" to "no defect" → `mark-bug --bug-status 4`
- content format requirements stay the same (prefix, line numbers, field-completeness checks still run)
- **After write-back you must run one report ↔ actual-result compare**: run `reconcile-report --task-id $TASK_ID`; `ok=true` means this change is accurately reflected in the report (no omissions / no extras from nowhere / counts reconcile). If it fails, fix from `blockers` and re-run until it passes, then tell the user. See `SKILL.md` → detection-complete standard section B.
- **After all write-backs finish and the compare passes**, confirm to the user: "The report has been updated; you can view it on the report page."

---

## Append a defect (after complete-task has already been called)

`update-process` appends a process to a completed task (idempotent). After appending you must `finalize-rank` or it will not show on the report. You do not need to call complete-task again.

**⚠️ Appending a defect also follows the auto write-back rule**: after the Agent finishes analysis, it must automatically run `update-process` → `finalize-rank` → **`reconcile-report` compare** (`ok=true` confirms the appended defect appears in the report defect list), then tell the user "appended to the report". The whole flow should not pause waiting for user instructions.

---

## Create a defect ticket

```bash
node "$SKILL_SCRIPT" create-issue \
  --plan-id <planId> \
  --title "OrderService#createOrder amount calculation does not handle negatives" \
  --description "Service: com.example.order\nLocation: OrderService.java:createOrder()\nIssue:..." \
  [--assigned-to <assignee>] [--severity 2] [--service-key com.example.order]
```

---

## Defect-fix recheck

When the user asks "which defects are still unfixed":

```bash
node "$SKILL_SCRIPT" get-confirmed-defect-history \
  --git "git@github.com:xxx/yyy.git" --fix-status "0,2"
```

Pull the latest code one by one to judge whether it is already fixed. If fixed, update the rank with `mark-bug --task-id $TASK_ID --rank-id <rankId> --bug-status 3` (confirmed fixed); if it still reproduces, leave bugStatus as is and say so in the reply.

---

## Query operations

### Query the detection process

```bash
node "$SKILL_SCRIPT" get-detection-flow --process-id <processId>
node "$SKILL_SCRIPT" get-detection-flow-by-rank --rank-id <rankId>
```

### View historical tasks

```bash
node "$SKILL_SCRIPT" list-my-tasks --submit-user <userId> \
  [--start-time "2026-04-01 00:00:00"] [--end-time "2026-04-30 23:59:59"]
```

Report link: local HTML `file://.../data/platform/reports/<taskId>.html` (if the chat link does not open, open that file in a browser). Remote platforms use `report_base_url`.

### Re-detect

> ⚠️ **First distinguish the two kinds of "re-detect". Default to A (recheck current task). Do not casually create a new task.**

| Branch | Trigger | Correct action | Create a new task? |
|---|---|---|---|
| **A. Recheck current task (default)** | The user finds the **Agent slacked / analysis was insufficient**: perfunctory thinking, missed call chain, misjudgment, missed detection; requirement and code **did not change**; only detection **quality is poor** | On the **current taskId/batchId**, do real analysis again → idempotent overlay `update-process` → `finalize-rank` → refresh the report | **No; reuse the original task** |
| **B. New-task retest** | The user **explicitly asks for a new task** (requirement changed, code was resubmitted, environment description changed), so the original detection **input preconditions changed** | `retry` creates a new task from the original | **Yes** |

> 🚩 **Judgment principle**: the user says "you slacked off / you did not look carefully / detect again / this is clearly wrong, how did you miss it" —
> input preconditions did not change; this is **A (recheck current task)**. Then **do not use `retry` to create a new task**. You must re-run analysis on the current task, overlay write-back, and finally refresh the same report.

> 🔴 **Prerequisite for `retry` creating a new task**: only when the user **explicitly says** "create a new task and detect again" / "submit a new task" or similar intent may you run `retry`. The Agent must not decide by itself that a new task is needed. Before running, confirm with the user: "About to create a new detection task based on the original; the original task record is kept. Continue?" — run only after the user agrees.

---

#### Branch A: recheck current task (standard flow when the user finds the Agent slacked)

**Prerequisite**: reuse the current `taskId` and each `parentBatchId`. Do not create a new task and do not lose existing context.

**Step A1: locate the recheck scope**

- The user names an item (e.g. "item 3 conclusion is wrong / too perfunctory") → recheck only the matching `className+methodName+strategyCode`.
- The user speaks generally ("overall slacking / detect carefully again") → re-analyze pending / already-written methods on every batch of the current task (see Phase 2 full inventory).

**Step A2: do real analysis again (not a format tweak; redo the analysis)**

- Re-read code (`register-code-read`); for strategy=11 expand the call chain again (`register-context-read`≥2); walk STEP A→B→C→C.5→D for real.
- thinking must include concrete method names, line numbers, and analysis logic (do not reuse old perfunctory content).

**Step A3: overlay write-back (idempotent; same key overwrites the original conclusion)**

```bash
# update-process idempotently overlays (parentBatchId, className, methodName, strategyCode)
node "$SKILL_SCRIPT" update-process \
  --task-id <original taskId> --batch-id <original parentBatchId> \
  --class-name "com.example.xxx.Service" --method-name "targetMethod" \
  --strategy-code <strategyCode> --bug-status <new bugStatus> \
  --thinking "Recheck: based on re-analysis..." \
  --content "<full references/writeback.md template>" \
  --tag-id <tagId> --file-codes '[...]' --process-steps '[...]'
```

> Prefer `batch-update-process` to aggregate when rechecking multiple methods.

**Step A4: refresh Rank + report**

```bash
node "$SKILL_SCRIPT" finalize-rank --task-id <original taskId> --batch-id <original parentBatchId> ...
```

- When the conclusion goes from "has a defect → no defect", invalidate the old rank with `invalid-record --rank-ids <rankId>`.
- After all overlay write-backs + finalize finish, the final summary still points to **the same taskId report link**, and states "re-detected on the original task and refreshed the conclusions".

> ⛔ **Forbidden**: calling `retry` to create a new task in branch A; stopping after update-process to ask "should we finalize" (the answer is always yes).

---

#### Branch B: new-task retest (only when input preconditions really changed)

**Scenario**: the user supplies new information (requirement changed, code was resubmitted, environment description changed), so the original detection input preconditions no longer hold.

**Step B1: clean old records that no longer hold**

```bash
node "$SKILL_SCRIPT" invalid-record --rank-ids <rankId>           # single
node "$SKILL_SCRIPT" invalid-record --rank-ids "101,102,103"      # batch
```

> Judge from the user's new information which old ranks no longer hold, then invalidate those — do not wipe everything.

**Step B2: create a retest from the original task**

```bash
node "$SKILL_SCRIPT" retry --task-id <taskId> [--submit-user <userId>]
```

Create a new task. After the new taskId is returned, run the normal detection flow and adjust judgment with the user's new information.

### Detection-record query

```bash
node "$SKILL_SCRIPT" get-detection-records --git "ssh://..." \
  [--develop-branch feature/xxx] [--start-time "2026-01-01 00:00:00"]

node "$SKILL_SCRIPT" get-detection-records --plan-id <planId> --plan-type 2
```

### Natural-language defect analysis

When the user asks an open-ended analysis ("defect distribution in the last month", "is the false-positive rate high"), determine the dimensions → call query APIs → aggregate stats → present as a table + natural language.

### Exception-traffic analysis

```bash
node "$SKILL_SCRIPT" get-exception-traces --plan-id <planId> --plan-type 2 --service-key <serviceKey>
```
