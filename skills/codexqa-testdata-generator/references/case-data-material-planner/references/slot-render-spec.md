# slot-render-spec

> Rendering rules for `scripts/slot_render.ts`.
> Rendering walks the `targetLocation` fields of entities and actions directly.

## targetLocation addressing syntax

```
<section>.<container>[index].<sub-field>
```

- section: first-level structure name of the case document (precondition / steps / custom)
- container: container type such as list / table / block
- index: 0-based integer
- sub-field: optional sub-field (e.g. a table cell name)

Heading-match aliases when locating a section in the case document:
- `precondition` — also matches Chinese headings: `前置`
- `steps` — also matches Chinese headings: `操作步骤`, `步骤`

Cell-name aliases when locating a table column:
- `op-cell` — also matches Chinese headings: `操作`, `命令`
- `expected-cell` — also matches Chinese headings: `预期`, `期望`

Examples:
- `precondition.list[0]` — first item in the precondition list
- `precondition.list[2]` — third item in the precondition list
- `steps.table.row[3].op-cell` — the "operation" column of the 4th step-table row

## Render modes

### `--preview-only`
- Walk every entity and action that has a `targetLocation` and generate a `renderPreview` field
- **Does not modify** `case-executable.md`
- Used in the writeback phase as a dry-run check before `--commit`

### `--commit`
- Read existing `renderPreview` values and write them to the corresponding location in `case-executable.md`
- After each entity/action is processed → `writeStatus = "done"`
- Missing `renderPreview` → `writeStatus = "skipped"`
- After all items are processed → `pipelines.writeback.status = "done"`

## Render rules

`case-executable.md` is a **business case document**. `filledCmd` / `invokeCmd` stay in the manifest. Renderers must not write `node` / `python` / `bash` fences, skill paths, cwd, hosts, or ports into the case.

### entity (precondition location)
```
renderPreview =
  "- {entity.entityType}（{field}={value}，{field}={value}，…），{constraint summary}"
```
- Render **every** non-null, non-empty `entity.fields` key (not only the primary ID)
- Skip envelope keys (`success` / `ok` / `error` / `code` / `message` / `traceId` / `requestId`) and implementation command strings
- Constraint summary is the first 40 characters of `entity.constraints` (truncated with `…`)
- `config` entities: `配置项（{field}={business value}）`. If a field value is a command (`node` / `python` / `config-store` / a fence), write the field name only.
- `runtime` entities: `{entityType}（由步骤 {sourceActionId} 执行时产出 {sourceOutputField}）` — do not invent an ID that does not exist yet

### action (step operation location)

```
renderPreview =
  "（入参：{param}={value}，...；产出：{outputField}、...）"
```

- `入参` from `paramsFromEntities` (resolved field values), `paramsFromPriorActions` (`第{stepIdx}步产出的 {field}`), `paramsFromGenerators` (`运行时生成`)
- `产出` from `outputs` keys
- If both sides are empty: `（已绑定）`
- Do **not** paste `filledCmd`, resolve `skillRoot` into absolute script paths, or emit `<<A01.orderId>>` / `$(...)` into the case
- `<<A01.orderId>>` in `filledCmd` is rewritten as `第N步产出的 orderId` on the 入参 side

If `cmdStatus != "filled"` → renderPreview stays null, writeback skips the item, and the host must list each skipped item's failReason when reporting to the user for manual review.

### Flattening into a table cell

`apply_slot` appends the parenthetical on the same line as the existing cell text. Do not insert `<br>` + fenced commands.

## Idempotency

`slot_render.ts --commit` may be run repeatedly:
- Items already at `writeStatus="done"` are skipped
- Re-rendering is allowed by clearing writeStatus (triggered indirectly by rollback.ts: after an entity/action is cleared, writeStatus is reset with it)

## Failure handling

- location parse failure → recorded in `failReason`, writeStatus="skipped", other items are not interrupted
- file does not exist → the whole script exits with failure (the host decides whether to create a fallback)
