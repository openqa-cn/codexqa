# planner.md — Pipeline runner spec

> Authoritative host protocol for `scripts/pipeline.ts`. The host Agent must not advance `pipelines.*` itself; construction, binding, and writeback are stages inside the script, not Agents to spawn.

`SUBSKILL_DIR` is the directory that contains this file.

## Role

**Host (you)**

- Collect the case source and optional `business-context.json`
- Run `node "$SUBSKILL_DIR/scripts/pipeline.ts" …`
- On exit 11 / 12 / 10, launch **only** the matching LLM Agent, merge the patch, then `--resume`
- On exit 20, show the C3 checklist and wait for the user

**Runner (`pipeline.ts`)**

- Init manifest, preprocess, select-tool fast path, invoke, bind, lint, `slot_render`, finalize
- Writes `pipelines.*`

## Command

```bash
node "$SUBSKILL_DIR/scripts/pipeline.ts" \
  --case-id <id> \
  --source <absolute path of the case document> \
  [--context <business-context.json>] \
  [--prd <requirement.md>] \
  [--cache <tool-binding-cache.json>] \
  [--scope full|parse-only|execution|writeback-only] \
  [--resume]
```

Existing manifest:

```bash
node "$SUBSKILL_DIR/scripts/pipeline.ts" --manifest <absolute path> --resume
```

## Exit codes

| Code | stdout `need` | Host action |
|---|---|---|
| 0 | — | Done or parse-only complete. Report `case-executable.md` + constructed fields |
| 10 | `select-tool` | Launch `agents/select-tool.md`. Merge `patches/select-tool.{id}.patch.json`. `--resume` |
| 11 | `parse-case` | Launch `agents/parse-case.md`. Merge `patches/parse-case.all.patch.json`. `--resume` |
| 12 | `knowledge-build` | Launch `agents/knowledge-build.md` (Path A only). Merge meta patch. `--resume` |
| 20 | `c3` | Blocking C3. User: `retry` / `force-pass` / `abort`. Then rollback or `--resume` |
| 2 | — | Bad args |

## LLM whitelist

| Agent | When | Writes |
|---|---|---|
| knowledge-build | Path A, no `business-context.json` | `businessContext` |
| parse-case | entities/actions empty | `entities[]` / `actions[]` |
| select-tool | `select_tool.ts` cannot uniquely bind | `toolBinding` only |

Nothing else is an Agent. Construction, binding, and writeback are scripts
(`invoke_entity.ts`, `bind_action.ts`, `slot_render.ts`) so that a re-run
reproduces the same manifest; earlier revisions launched those as Tasks and the
results drifted between runs.

## Script field contracts

Who writes what on the manifest. `toolBinding` is written only by
`select_tool.ts` or the select-tool Agent — no other stage may touch it.

`invoke_entity.ts` writes on an entity:

- `fields` — every non-envelope business scalar from the tool response
- `entityStatus` — `verified` / `unverified` / `failed` / `missing-dependency`
- `dataConfidence` / `verifyNote` / `failReason`

It dispatches on `toolBinding.toolType` alone:

| toolType | Implementation |
|---|---|
| `skill` / `script` | `spawn(['node', executor, '--json', json])` |
| `tool` | `tool_registry.execute` (local or HTTP adapter) |
| `reuse` | copy source entity fields |
| `api-setup` | deferred, not submitted |

`bind_action.ts` writes on an action `filledCmd` / `cmdStatus` /
`cmdConfidence` / `verifyNote` / `failReason`. Placeholder forms come from
`references/param-source-spec.md`:

| Source | `filledCmd` form |
|---|---|
| `paramsFromEntities` | literal |
| `paramsFromGenerators` | `$(...)` |
| `paramsFromPriorActions` | `<<A01.field>>` |

## Stage map (implemented in `pipeline.ts`)

1. `init_manifest.ts` — create `testdata/case-materials/{caseId}/manifest.json`
2. knowledge-build — skip when no PRD; else exit 12
3. parse — exit 11 until entities/actions exist
4. preprocess — `generate_config_commands` + `topo_sort_batch.ts`
5. data-track — `select_tool.ts` + `invoke_entity.ts` (all response fields)
6. action-track — `select_tool.ts` + `bind_action.ts`
7. lint-gate — `lint_manifest.ts` judge; FAIL → exit 20
8. writeback — `slot_render.ts` preview + commit (business fields only, no `node` commands)
9. finalize — `caseConfidence` / `generatedAt`

## C3

On exit 20, print `failingIds` from stdout JSON. After the user replies:

- `retry` / `retry E01,A02` → `rollback.ts` then `--resume`
- `force-pass` → append confirmation `decision=force-pass` then `--scope writeback-only`
- `abort` → stop

Do not skip C3.

## Enterprise extension

`invoke_entity.ts` dispatches on `toolBinding.toolType` only (`skill` / `tool` / `script` / `reuse` / `api-setup`). Company tools are added via adapters (`type: http`) or a new slot under `slots/` / `workspace.slot_roots`. `select_tool.ts` binds from discovered `slot.yaml` (or inferred executors). Do not hard-code private CLIs and do not edit the selector for a new scene.
