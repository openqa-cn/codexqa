# case-dispatcher.md — Multi-case batch

> SKILL.md Path C (2+ cases). One `pipeline.ts` process per case. Construction, binding, and writeback are stages inside that script; the only Agents are `parse-case`, `knowledge-build`, and `select-tool`.

`SUBSKILL_DIR` is the directory that contains this file.

## Role

| Role | Does | Does not |
|---|---|---|
| **Dispatcher (you)** | Shared knowledge-build once; start one `pipeline.ts` per case; handle exit 10/11/20; barrier | Mutate manifests by hand; cross-copy entity fields |
| **`pipeline.ts`** | Single-case state machine | Talk to the user |

## Flow

```
pending
  → knowledge-build once (exit 12 on the first case that needs it, or a dedicated --context)
  → parallel: pipeline.ts --scope parse-only   (exit 11 → parse-case Agent per case)
  → parallel: pipeline.ts --resume             (construct + lint + writeback)
  → checkpoint
  → done
```

Per case:

```bash
node "$SUBSKILL_DIR/scripts/pipeline.ts" \
  --case-id <id> \
  --source <path> \
  [--context "$SHARED/business-context.json"] \
  [--cache "$SHARED/tool-binding-cache.json"] \
  [--scope parse-only|full] \
  [--resume]
```

`SHARED` = `./testdata/case-materials/`.

Track cases in `dispatcher-state.json` (copy `templates/dispatcher-state-template.json`).

## Exit handling (same as planner.md)

| Code | Action |
|---|---|
| 0 | Mark case done / parse-only ready |
| 10 | select-tool Agent for that case only, merge, `--resume` |
| 11 | parse-case Agent for that case only, merge, `--resume` |
| 12 | knowledge-build once for the batch |
| 20 | Collect C3 per failing case; other cases continue |

A failure on case A does not roll back case B.

## Isolation

- Separate `manifest.json` per case
- Shared `business-context.json` and `tool-binding-cache.json` only
- Do not merge entities across cases
