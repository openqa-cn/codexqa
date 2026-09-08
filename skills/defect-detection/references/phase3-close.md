# Phase 3: Validation and close

> **When to load**: after every method in every batch has been written back and the Phase 2 self-review (`references/phase2-detection.md` Step 2.6–2.7) passed.
> **One-shot alternative**: `finalize-all --task-id $TASK_ID --summary-file summary.txt` runs Steps 3.1–3.4 in one command; read this file when a gate fails or you need the manual sequence.

---

## Step 3.1: Completeness check

```bash
node "$SKILL_SCRIPT" check-coverage --batch-id $BATCH_ID
```

`allCompleted=false` → supplement detection for missedItems, then check again.

## Step 3.2: Rank integrity

```bash
node "$SKILL_SCRIPT" check-rank-integrity --batch-id $BATCH_ID
```

If `missingRankItems` is non-empty → finalize-rank each item.

## Step 3.3: Report ↔ actual analysis compare [GATE; specifically for report vs actual mismatch]

> **Purpose**: prevent "report status / defect list" from drifting away from "what the Agent actually analyzed". Earlier gates only check whether counts are complete (local self-check). This step is a **line-by-line reconcile of both sides** — DoD section B, and the real mark of "done".
>
> **Relation to Phase 2 immediate check**: Phase 2 already did a lightweight per-batch check after each `batch-update-process` (`check-coverage --batch-id` + `show-local-progress --task-id`, this-batch landing consistency).
> By Step 3.3, most drift has already been caught and fixed. `reconcile-report` here is the **full final reconcile** —
> it pulls a complete platform-report snapshot and diffs it against the full local result, catching edge cases immediate check cannot cover (e.g. cross-batch rank-state inconsistency, platform async delay).
> In the normal case (every immediate check was CONSISTENT), reconcile-report passes on the first round.

**One-click reconcile (programmatic diff; no hand line-by-line compare)**

```bash
node "$SKILL_SCRIPT" reconcile-report --task-id $TASK_ID
```

This command automatically pulls the platform-report defect list and the local actual analysis result, diffs them, and outputs three reconciles:

| Compare item | Command return field | Fix when inconsistent |
|---|---|---|
| ① No omitted defects | `missingInReport` (local has, report does not) | Re-run `batch-update-process` for that method (correct bugStatus) → `finalize-rank` |
| ② No extras from nowhere | `extraInReport` (report has, local does not; rewritten / wrong object) | Correct the report object or complete local analysis; `update-rank-content` to align the conclusion |
| ③ Counts can be reconciled | `localDefectCount` vs `reportDefectCount` | If the delta is same-root-cause dedup, say so explicitly in the summary "Impact scope"; otherwise fill it in |

- Exit code `0` (`ok=true`) → compare passed.
- Exit code `1` (`ok=false`) → locate methods from `blockers`, fix, then **re-run `reconcile-report`** until it passes.

**Basic pass line** (kept): task status=2, defect counts reconcile, each content ≥80 characters.

**>>> GATE**: the compare passes only when `reconcile-report` returns `ok=true`. **Do not output "detection complete" to the user until it passes** (see `SKILL.md` → detection-complete standard section B).

> When you need a human check that conclusion semantics were not rewritten off-track, you may also compare `get-report` + `get-findings` by eye; but the hard reconcile of counts / omissions / extras is authoritative from `reconcile-report`.

## Step 3.3b: Multi-batch close inventory (when $BATCH_IDS[] >1)

Run `get-pending` again for every batch, diff against content.json, and if anything is missing, supplement write-back and re-check.

## Step 3.4: complete-task [must run]

**Before writing the summary, first pull every finding accumulated this run**:

```bash
node "$SKILL_SCRIPT" get-findings --task-id $TASK_ID
```

Returned `summaryText` lists all findings grouped by category. Write `--summary` from this content, not from memory.

```bash
node "$SKILL_SCRIPT" complete-task --task-id $TASK_ID --batch-ids "$BATCH_IDS" --summary "$DETECTION_SUMMARY"
```

- Pass every parentBatchId (comma-separated)
- **`--summary` must be written back**. Detailed format / section requirements / forbidden items / examples: `references/output/summary-spec.md`

> 🟢 **You can still write back after complete-task**: `complete-task` is a close action (write summary + mark complete), **not a lock**. You may still call `update-process` / `batch-update-process` / `finalize-rank` / `update-summary` at any time to supplement or correct. When you find a missed defect or user feedback requires a corrected conclusion, write it back directly; you do not need to complete-task again.

> **Gate and `--force`/`--failed` mechanism**: `references/analysis/phase2-scripts.md#step-3.4` (single source of truth). complete-task automatically rechecks check-coverage + check-rank-integrity; if they fail it refuses, lists blockers, and you go back to 3.1/3.2 to fill in and retry.

### `--force` scope

`--force` **only skips consistency gates** (process/rank integrity checks) and **does not skip summary format validation** (section markers / forbidden-word detection always run). That is, `--force` only affects whether you may close the task when write-back is incomplete; it does not relax detection-summary content-quality requirements.

### Summary submit and correction

> 🔴 **Read the spec before writing/changing a summary**: before every `complete-task --summary` or `update-summary`, **you must first read `references/output/summary-spec.md`**, confirm format requirements, section structure, and forbidden items, then write. Do not write from memory — the spec may have been updated, and long conversations make details easy to forget.

> Details: `references/output/summary-spec.md` (full usage of validate-summary / --preview / update-summary).

- Before submit, prefer `validate-summary` or `complete-task --preview` for a format self-check
- When `_summary_status=FAILED`, rewrite with `update-summary --task-id $TASK_ID --summary "$FIXED_SUMMARY"`
- `update-summary` may be called independently at any time after complete-task

## Step 3.4b: Mid-detection exception (skip-service-batch)

When a service detection is abnormal and cannot be recovered, call `skip-service-batch --parent-batch-id $ID --failed` to mark failure.
You must tell the user before calling. Other services are unaffected.

## Step 3.4c: Post-close final check — report ↔ actual result compare [GATE; must pass before output]

> After a successful `complete-task` (not `--force`) close, it **automatically runs `reconcile-report` once** and returns `_reconcile_status`: `CONSISTENT` = pass; `DRIFT` = fail.
> On `DRIFT` you must fix write-backs and manually re-run `reconcile-report` until it passes. Reconcile rules are the same as Step 3.3; see `references/rules/definition-of-done.md` section B.

- **Do not enter Step 3.5 and output "detection complete" until the compare is cleared.**

## Step 3.5: Output the final summary

> **Hard prerequisite**: the Step 3.4c final compare has passed (DoD A+B+C all satisfied). Otherwise you must not output.

**The user-facing final summary = detection summary + defect-list digest**. Generation flow:

1. First generate the detection summary (the `--summary` written back in Step 3.4: requirement-change points, analysis scope, risk points)
2. Then append the defect-list digest (suspected-defect table, improvement table, requirement compare, etc.)
3. Combine and output to the user

Templates: `references/output/output-templates.md`. Only part 1 (detection summary) is written back to the platform. What the user sees is the full version (1+2).

---

## Step 3.6: Post-summary self-check [MUST — cannot skip]

> Details: `references/output/summary-spec.md#post-summary-self-check` (five checks: content consistency / readability / authenticity traceability / purpose purity / report link).

After writing the summary back you must immediately self-check: compare `get-findings` and confirm every defect and cross-view finding is shown one by one (no lumping), risk points include the four elements, and the end includes a report link. **Extra checks**: ① items with no problem should not appear in the summary (only talk about what has problems); ② the summary should not contain isolated codes/terms unexplained in context (do not write identifiers the user cannot understand); ③ possible false positives should not be output (only output real findings the user should care about); ④ **every piece of information must be traceable** — verify one by one that line numbers / class names / defect descriptions / stats in the summary come from real detection data; do not invent or guess; delete anything without a source. If it fails, `update-summary` rewrite until it passes.

---

## Step 3.7: Proactively output the report link [MUST]

> **After detection completes, the Agent must proactively give the user a report link**, without waiting to be asked.

When the final summary is output to the user, **the end must include**:

```
> View full report: [Open]({reportUrl})
```

`reportUrl` uses the current platform provider return value. Locally it is written as openable HTML (`file://` link to `data/platform/reports/{taskId}.html`); if the chat link does not open, open that file in the system browser. Remote platforms use the configured `report_base_url`.

This is the user's entry to the full report page. **Missing report link = incomplete summary = detection not complete**.
