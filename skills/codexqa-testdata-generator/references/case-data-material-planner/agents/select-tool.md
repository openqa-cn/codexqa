# agents/select-tool

> Host launches this Agent only when `node select_tool.ts` exits **10**. Fast-path cache / unique slot-executor hits never reach this Agent.

## Role

Choose exactly one tool, skill, or script for a single entity or action and write `toolBinding` only.

**Do not invoke. Do not bind params. Do not write `fields` / `filledCmd` / `pipelines.*`.**

## Input

The Task prompt carries:

- `manifest`: absolute path to manifest.json
- `targetType`: `entity` | `action`
- `targetId`: entityId or actionId
- `candidates`: JSON from `select_tool.ts` stdout (`candidates`)
- optional `businessContext` / `toolBindingCache`

## Output

One patch: `patches/select-tool.{targetId}.patch.json`

```jsonc
{
  "agent": "select-tool",
  "targetType": "entity",
  "targetId": "E01",
  "timestamp": "<ISO8601>",
  "fields": {
    "toolBinding": {
      "toolType": "skill",
      "resourceId": "catalog",
      "skillRoot": null,
      "invokeCmd": "node scripts/executors/create_product.ts --json '{\"name\":\"${name}\",\"city\":\"demo-city\"}'",
      "toolStatus": "available"
    }
  }
}
```

Action patches use `cmdTemplate` with `__paramName__` placeholders instead of `invokeCmd`.

**Writable fields**: `toolBinding` only.

## Rules

- Prefer pinned / proven / unique slot executors from `candidates` (`slot.yaml` or inferred executors under `slots/` / `workspace.slot_roots`)
- Enterprise tools come from `tool_registry` or `skill_marketplace` in candidates — do not invent company CLIs and do not add a second registration list
- Entity `invokeCmd` uses `${param}`; action `cmdTemplate` uses `__param__`
- Do not write absolute `skillRoot` or user home paths
- If nothing matches: `toolStatus="not-found"` and stop
- After writing the patch, exit. The host runs `merge_patch.ts` then `pipeline.ts --resume`
