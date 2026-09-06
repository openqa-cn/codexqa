# Step 2.7c: Triangular cross-view check

**Purpose**: run **four-way cross-validation** among cases ↔ code ↔ requirements to find inconsistencies and gaps that single-view detection cannot expose. This is the key step that lifts defect detection from "method-level analysis" to "requirement-level assurance".

**Preconditions**: `$HAS_CASES=true` and `$HAS_DOC=true`. If only one is true, run the available subset (see degrade rules below).

## One-shot programmatic reconcile (recommended; replaces per-direction manual compare)

```bash
node "$SKILL_SCRIPT" cross-view-check --task-id $TASK_ID
```

This command **runs all four directions at once**. Internally it automatically:
1. Reads `extractedRules`, `testCases`, the changed-method list, and already-written analysis conclusions from content.json
2. Decides which directions to run by the degrade rules (HAS_CASES/HAS_DOC auto-detected)
3. Compares the four directions **in parallel** and emits findings one by one
4. Automatically calls `register-finding --category cross-view` for each finding
5. Returns a rollup: `{ findings: [...], directions_executed: [1,2,3,4], gate_passed: true/false }`

**How to handle the return value**:
- `gate_passed=true` → go to the "semantic verification" step below
- `gate_passed=false` and `findings` contains items that point to a code defect (`actionRequired=true`) → Agent falls back to STEP C, re-analyzes the method, decides whether to append bugStatus=6, then re-runs `cross-view-check`
- `gate_passed=false` and completely empty (no findings) → command error or missing data; fix per `issues` and retry

## ⚠️ Cross-view result semantic verification [MUST — do not skip]

> **Core principle**: programmatic matching in `cross-view-check` is a **first pass**, not the final conclusion. The Agent must semantically verify every "uncovered" finding so keyword-mismatch false positives are filtered (cases often cover a rule via abbreviation / synonym; substring match cannot see that).

**For every direction2 (requirement→case) finding returned by `cross-view-check`, the Agent must**:

1. Open the `steps` and `expectedResult` fields of every case in `$CASES[]`
2. Judge **semantically**, one by one: is the rule's core meaning already verified by some step / expected result of some case?
3. Judgment criteria:
   - ✅ Covered: the case step is semantically equivalent to the rule (abbreviations, synonyms, and merged wording allowed)
   - ❌ Uncovered: no step in any case actually verifies the rule's core logic
4. Covered findings → **remove from the final summary**; do not show them to the user (avoids misleading)
5. Uncovered findings → keep and expand in the summary "[Risks]" section

**The same applies to direction3 (requirement→code) findings**: the program may misjudge "not implemented" because the implementation wording differs from the rule. The Agent must go back to the code and confirm semantic equivalence.

**Only after verification** may you enter Phase 3.

> **Performance gain**: the old version ran four directions one by one; the Agent had to walk CASES/BIZ_RULES manually,
> and each direction was an independent tool-call loop. After programming, one command finishes all compares,
> cutting Agent↔tool round trips from a typical 4–8 tool-call rounds down to 1.

## Cross-validation model (four directions)

```
           Requirements (DOC_SUMMARY.md / BIZ_RULES)
          /                                    \
    Direction ②                              Direction ③
   Requirement→Case                         Requirement→Code
        /                                        \
   Test cases ————————Direction ①————————————→ Code implementation
              ←——————Direction ④———————————
```

| Direction | Meaning | Data source |
|------|------|----------|
| ① Case→code | Whether the case scenario is correctly implemented in code | testCases + changed-method code |
| ② Requirement→case | Whether the requirement scenario has case coverage | extractedRules + testCases (reuses Step 2.7b caseCoverage) |
| ③ Requirement→code | Whether the required feature is implemented in code | extractedRules + diff methods (reuses Step 2.7 results) |
| ④ Code→case→requirement | Whether the implementation has case verification and requirement support | Core methods (bugStatus=6/7 + caseRelevance=direct) + testCases + extractedRules |

## Degrade rules

| Condition | Directions to run |
|------|----------|
| HAS_CASES=true + HAS_DOC=true | ①②③④ all |
| HAS_CASES=true + HAS_DOC=false | ①④ (case↔code) |
| HAS_CASES=false + HAS_DOC=true | ③ (already covered by Step 2.7; skip this step) |
| Both false | Skip this step |

## Output requirements

1. All findings are recorded via `register-finding --category cross-view` (done automatically inside the command)
2. Each finding states "which view" + "concrete inconsistency" + "impact assessment" + "whether the Agent must fall back (actionRequired)"
3. An inconsistency **does not directly produce a bugStatus writeback**, but items with `actionRequired=true` must fall back to STEP C and re-analyze the method

## Quality gate

The `gate_passed` field returned by `cross-view-check` is the gate result (internally it already checks that cross-view findings are non-empty).

**>>> GATE**: enter Phase 3 only when `gate_passed=true`. When `gate_passed=false`, fix per returned `issues` and retry.
