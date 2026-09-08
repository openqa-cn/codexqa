# Lessons Learned

> Consumed internally by the Agent; never exposed to the user. `scripts/lessons.ts` matches silently after detection.

---

## LL-PHASE1-001 [P0] — Insufficient plan permission ≠ task blocker

- **Problem**: Agent aborted the task when `get-plan-info` had no permission
- **Correct action**: Log a warning and continue (swap token / take the Git path / ask the user to supplement plan info). Do not abort the task

---

## LL-PHASE1-002 [P0] — Do not degrade test cases because the test-case provider errors

- **Problem**: test-case provider reported no permission; Agent degraded HAS_CASES to false and skipped s11 business comparison
- **Correct action**: HAS_CASES only depends on whether plan info `testCaseIds` is empty. When the tool errors, fetch by ID one by one

---

## LL-PHASE1-003 [P1] — Missing multi-batch inventory causes converge failure

- **Problem**: Only took batchIds[0]; other batches never wrote process back
- **Correct action**: Step 3.3b aggregates pending process from all batches

---

## LL-PHASE1-004 [P2] — getPending-driven efficiency is low

- **Problem**: Over-relied on the server-side inventory; returned data has no method body
- **Correct action**: Agent drives the detection plan from git diff; getPending is only a validation fallback

---

## LL-PHASE1-005 [P1] — Same repo cloned repeatedly

- **Problem**: Same git+branch attached to multiple service keys used the service key in the directory name, causing repeated clones
- **Correct action**: Name directories by `repoHash = md5(git_url@branch)[:12]`, reuse the same repo; use the `clone-and-diff` all-in-one command

---

## LL-PHASE2-002 [P1] — Call-chain context rebuilt per method

- **Problem**: The same Call chain A→B→C was independently analyzed per method, reading code N times
- **Correct action**: Group by chainGroupId; read the full chain once per group, then run STEP C/C.5/D in parallel. Credentials are still registered per process

---

## LL-PHASE3-005 [P0] — Summary must not use vague descriptions

- **Problem**: Risks were summarized in one sentence (e.g. "some rules are not covered"); the user cannot get concrete information
- **Correct action**: Expand each item with four elements: original rule text + code status + case-coverage status + extra test scenarios

---

## LL-PHASE3-006 [P1] — Summary must not use Markdown tables

- **Problem**: The report page does not render tables; `|---|---|` collapses into one line
- **Correct action**: Use segmented lists (▸ number + ｜ full-width pipe to separate fields)

---

## LL-PHASE3-007 [P1] — Must self-check after writing the summary back

- **Problem**: After writeback, no self-check against get-findings; method names wrong / content missing
- **Correct action**: Step 3.6 self-check: content consistency + readability + complete report link

---

## LL-PHASE3-008 [P2] — Must proactively give the report link

- **Problem**: After detection, the user had to ask for the link
- **Correct action**: The final summary must end with a report link. Missing = incomplete summary

---

## How to consume

```bash
# Silent analysis after detection
node scripts/lessons.ts detect --task-id <id>

# Periodic rollup
node scripts/lessons.ts report --days 7

# Inject into Agent context (internal only; never expose to the user)
node scripts/lessons.ts peek --category phase1 --limit 3
```

## Maintenance conventions

1. Append new lessons in the format above
2. If N versions no longer trigger it → mark `status: resolved`
3. Annotate each item with `source_version`
