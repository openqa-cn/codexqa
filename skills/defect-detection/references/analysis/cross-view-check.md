# Step 2.7c: Triangular cross-view check

**Purpose**: run a **keyword first pass** among cases ↔ code ↔ requirements. This is a screen, not a close gate. It exists so the Agent has a candidate list to semantically verify — it must not invent "missing work" from a substring miss, and it must not block Phase 3.

**Preconditions**: `$HAS_CASES=true` and `$HAS_DOC=true`. If only one is true, run the available subset (see degrade rules below). If both are false, skip.

## One-shot programmatic reconcile

```bash
node "$SKILL_SCRIPT" cross-view-check --task-id $TASK_ID
```

This command **runs the available directions at once**. Internally it:
1. Reads `extractedRules`, `testCases`, the changed-method list, and already-written analysis conclusions
2. Decides which directions to run by the degrade rules (HAS_CASES/HAS_DOC auto-detected)
3. Emits keyword-match candidates
4. Records them via `register-finding --category cross-view`
5. Returns `{ findings, directions_executed, role: "first_pass", blocking: false, gate_passed: true, needsSemanticVerify }`

`gate_passed` stays `true` after a successful run so older agents that still treated it as a Phase 3 gate do not loop. **Do not** wait for insight traces or a green keyword match before entering Phase 3.

**How to handle the return value**:
- Command ran (`firstPassComplete=true` or `skipped=true`) → go to semantic verification, then Phase 3
- Completely empty with an `issues` / error field → fix the data problem and retry
- `needsSemanticVerify=true` → verify candidates; **do not** re-analyze every method or invent bugStatus=6 from a keyword miss

## Semantic verification [MUST — do not dump the first pass into the user summary]

> Programmatic matching is a **first pass**. Cases and docs often cover a rule via abbreviation / synonym / a path-style className the matcher never sees.

**For every `doc_to_case` / `doc_to_code` candidate:**

1. Open the case `steps` / `expectedResult`, or the actual method body — not the tokenized title
2. Judge **semantically**: is the rule already verified or implemented?
3. Covered / synonym miss → **drop from the final summary**
4. Truly uncovered → keep and expand in "[Risks]" only after that confirmation

Orphan `code_to_case_doc` notes (`actionRequired=review_orphan_change`) are almost always helpers or path-style names. Do not list them item-by-item in the user summary.

**Only after verification** may leftover real gaps appear in the summary. Phase 3 does not wait on this command's keyword score.

## Cross-validation model (four directions)

```
           Requirements (DOC_SUMMARY.md / BIZ_RULES)
          /                                    \
    Direction ②                              Direction ③
   Requirement→Case                         Requirement→Code
        /                                        \
   Test cases ———————Direction ①————————————→ Code implementation
              ←——————Direction ④———————————
```

| Direction | Meaning | Data source |
|------|------|----------|
| ① Case→code | Whether the case scenario is correctly implemented in code | testCases + changed-method code |
| ② Requirement→case | Whether the requirement scenario has case coverage | extractedRules + testCases |
| ③ Requirement→code | Whether the required feature is implemented in code | extractedRules + diff methods |
| ④ Code→case→requirement | Whether the implementation has case verification and requirement support | Plan methods + testCases + extractedRules |

## Degrade rules

| Condition | Directions to run |
|------|------|
| HAS_CASES=true + HAS_DOC=true | ①②③④ all |
| HAS_CASES=true + HAS_DOC=false | ①④ (case↔code) |
| HAS_CASES=false + HAS_DOC=true | ③④ (requirement↔code; ④ case side auto-passes) |
| Both false | Skip this step |

## Output requirements

1. Candidates are recorded via `register-finding --category cross-view` (done inside the command)
2. An inconsistency **does not** produce a bugStatus write-back by itself
3. `actionRequired=true` on a candidate means "semantically verify", **not** "fall back to STEP C and file a defect"

## Not a gate

`complete-task` must not block because this command was skipped or because keyword matches remain. Missing a first-pass record is a warning only. The close gates stay coverage, rank integrity, summary format, and `reconcile-report`.
