# lint-verdict-spec

> Verdict rules for `lint_manifest.ts`.
> Threshold constants are in `confidence-policy.md`.

## Three Verdicts

| Verdict | Meaning | User options |
|---|---|---|
| `PASS` | All checks passed | Proceed to writeback |
| `FAIL` | Problems exist, with failingIds + details | Rerun specified ids / force-pass / abort |
| `ROUND_EXCEEDED` | Maximum round reached (no problems, but retries are exhausted) | force-pass / abort |

## Internal detection rules (hits are collected into details; no short-circuit)

| Check | Trigger condition | suggestedAction |
|---|---|---|
| missing-dependency | entity.entityStatus=="missing-dependency" (including expansion along dependencies) | `rerun-data-pipeline` |
| invalid-action-ref | The action's paramsFromEntities/paramsFromPriorActions references a missing object, a forward reference, or an undeclared output | `rerun-action-pipeline` |
| low-confidence | avg(scorable_entities.dataConfidence) < THRESH_DATA_CONF_MIN. **Exclude**: entities with `constructionStrategy ∈ {"config", "runtime"}` do not participate | `rerun-data-pipeline` |
| tool-failed | toolBinding.toolStatus=="failed" (entity or action) | `rerun-data-pipeline` or `rerun-action-pipeline` |
| missing-param | action.cmdStatus=="missing-param" and dependent entities are ready | `rerun-action-pipeline` |
| gen-failed-fixable | action.cmdStatus=="gen-failed" and failReason is a bind-fixable type | `rerun-action-pipeline` |
| verify-unreachable | **Action side only**: the share of action.verifyNote "verification tool unreachable" exceeds THRESH_VERIFY_FAIL_RATIO. Entity side is no longer checked | `rerun-action-pipeline` |
| incomplete-pipeline | entity.toolBinding.toolStatus=="available" but entityStatus==null (invoke was skipped) | `rerun-data-pipeline` |

Every check is scanned independently. The same object may hit multiple rules, but details are de-duplicated (the first-hit reason is kept).

## RESCAN_ENTITY transitive expansion rules

On trigger:
1. Take every entity with `entityStatus=="missing-dependency"` as the **seed set**
2. Recurse upward along `dependencies[].entityId`, merging upstream entities whose `entityStatus ∈ {null, "failed", "missing-dependency"}` into the set
3. Do not expand to `unverified` / `verified` (their fields were already produced by a real build)

## Verdict logic

```python
details = _detect_issues(manifest)  # run all 8 checks

if details:
    return FAIL + failingIds + details

if round >= THRESH_MAX_ROUND:
    return ROUND_EXCEEDED

return PASS
```

## failingIds construction

Group details by type:
- `entities`: every id whose type=="entity"
- `actions`: every id whose type=="action"

## details structure

```jsonc
[
  {
    "id": "E01",
    "type": "entity",
    "reason": "missing-dependency (transitive rescan)",
    "suggestedAction": "rerun-data-pipeline"
  },
  {
    "id": "A02",
    "type": "action",
    "reason": "cmdStatus=missing-param (deps ready)",
    "suggestedAction": "rerun-action-pipeline"
  }
]
```

## Contract with rollback.ts

`rollback.ts` reads `pipelines.lint-gate.failingIds` and performs a **uniform clear** on every failing object:
- entity → reset to initial state (toolBinding/fields/entityStatus/dataConfidence/verifyNote/failReason)
- action → reset to initial state (toolBinding/filledCmd/cmdStatus/cmdConfidence/verifyNote/failReason)

Clearing is no longer branched by verdict type. The Agent will rerun in full, starting from search.

round increment is owned by `lint_manifest.ts --write-back`; `rollback.ts` does not change round.

## ROUND_EXCEEDED rules

When `pipelines.lint-gate.round >= THRESH_MAX_ROUND` and details is empty:
- return `ROUND_EXCEEDED`
- if details is non-empty, still return `FAIL` (even if the maximum round has been reached)
- After receiving this, `pipeline.ts` exits 20 and the host enters C3 forced decision (force-pass / abort)

## suggestedAction notes

`suggestedAction` is a suggestion, not a command. The host shows it to the user; the user decides. Enum strings stay `rerun-data-pipeline` / `rerun-action-pipeline` (lint JSON contract):
- `"rerun-data-pipeline"` → `pipeline.ts` re-runs `select_tool.ts` + `invoke_entity.ts` for the specified entityId
- `"rerun-action-pipeline"` → `pipeline.ts` re-runs `select_tool.ts` + `bind_action.ts` for the specified actionId
