# Detection Definition of Done (MUST)

> **The single close-out standard**: all three sections A/B/C below must **all be satisfied** before you may tell the user "detection complete" and give a report link. Any unmet item means **not done**. You must backfill and re-check. Do not close early.
>
> This section is the unified close-out of the full-flow GATE. The core is **section B — the report must match the actual analysis results**. It exists to stop "report status / defect list disagreeing with the actual analysis".

## A. Flow complete (existing GATEs; do not re-validate here)

- Phase 2 exit: all 14 self-review items OK (per-method writeback, Call chain expansion, full coverage of chain groups, etc.; see `SKILL-PHASE2.md`).
- When `HAS_CASES=true` or `HAS_DOC=true`, `cross-view-check` returns `gate_passed=true` (cross-view GATE).
- `check-coverage` (every detection item written back) → `check-rank-integrity` (every conclusion written, consistent with detection items) → gaps compensated via `finalize-rank`.
- `complete-task` consistency gate passed (**do not** claim completion after using `--force` to bypass integrity).

## B. Report ↔ actual analysis reconcile (core, MUST)

After `complete-task` converges, you **must** pull the platform report and the local real analysis and reconcile item by item. All three diffs must be zero.

**This step is already programmed; no manual item-by-item compare is needed** — just run:

```
reconcile-report --task-id $TASK_ID
```

The command automatically pulls the "platform-report defect list" and the "local content store actual analysis results", diffs them, and returns three reconcile conclusions:

1. **No missing defects** (`missingInReport`): every method locally judged as a suspected defect / improvement has a matching report entry. Local has it, report does not = drift.
2. **No extras invented** (`extraInReport`): every report defect is backed by a local actual analysis. Report has it, local does not = drift (report rewritten or written against the wrong object).
3. **Counts reconcile** (`localDefectCount` vs `reportDefectCount`): both sides have the same count. If same-root-cause dedup makes the report shorter than local, the delta **must** be explained explicitly in the final summary "Impact scope".

- `reconcile-report` exit code `0` (`ok=true`) → section B passed; continue to section C.
- Exit code `1` (`ok=false`) → **do not tell the user "detection complete"**. Use `blockers` to locate the method, re-run `batch-update-process` / `finalize-rank` / `update-rank-content` to fix, then **run `reconcile-report` again** until it passes.

> ℹ️ After a successful `complete-task` (not `--force`) converge, it **automatically runs `reconcile-report` once** and writes `_reconcile_status` (`CONSISTENT` / `DRIFT`) into the returned JSON. `DRIFT` means section B has not passed. You must fix writeback and re-check with `reconcile-report`. Do not close early. See `SKILL-PHASE2.md` → Step 3.3 / Step 3.4c.

## C. Delivery complete

- The final summary contains the 5 required sections (Requirement changes / Analysis scope / Risks / Notes / Conclusion) plus a report link at the end (missing link = incomplete summary). The report link uses the current platform provider's `reportUrl`.
- Follow core constraint 1 (zero leak): do not expose any internal field names, commands, or validation process to the user.

> ⛔ **Absolutely forbidden**: every command in section A returns success, but you skip section B reconcile and tell the user "detection complete". Command success ≠ report matching actual results. **Passing section B reconcile is the real "done" signal**.
