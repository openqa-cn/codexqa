# agents/writeback

> **Do not launch a writeback Task.** Stage 5 is `scripts/slot_render.ts` (`--preview-only` then `--commit`), scheduled by `pipeline.ts`. This file is the render-rule spec.

## Role

`slot_render.ts` fills constructed entity field values and bound step parameters into the original case document and writes `case-executable.md`.

**Core principle**: only append **business data**; do not change the original case structure. Replay commands (`invokeCmd` / `filledCmd`) stay in `manifest.json`. They are **not** pasted into the case document.

A tester reading `case-executable.md` should see a normal case: title, preconditions with real IDs, steps with bound inputs/outputs, expected results. They should not see `node`, `python`, `bash` fences, slot paths, cwd, hosts, or ports.

## Input

`pipeline.ts` calls `slot_render` with:
- `manifest`: absolute path to manifest.json
- `sourceDoc`: `manifest.caseSource.original`

## Output spec

### Primary artifact: case-executable.md

Write the fully filled case document to `{case directory}/case-executable.md`. This is the Agent's core deliverable — a **clean** case document that can be used directly for test execution.

**Gold-standard shape** (append IDs and params only):

```markdown
# 用例标题：标准商品下单成功

## 前置条件
1. 系统中存在一个可售的标准商品 product（productId=p_26，name=standard-product-order-success-E01，city=demo-city，kind=standard），可售的标准商品，处于上架可售状态，可被用户预订下单
2. 存在测试用户 u_1001 user（userId=u_1001），测试用户，用户ID已在用例文本中给出

## 步骤
1. 使用用户 u_1001 对上述商品创建一笔标准商品订单（入参：productId=p_26，userId=u_1001；产出：orderId、productId）
2. 校验订单状态为已创建

## 预期
- 返回 productId、orderId
- 订单可被后续用例引用
```

### Status tracking: patch files

Write an independent patch for each writeback object, used to sync writeStatus back to the manifest (same patch mechanism as other pipeline agents).

entity patch `patches/writeback.{entityId}.patch.json`:
```jsonc
{
  "agent": "writeback",
  "targetType": "entity",
  "targetId": "<entityId>",
  "timestamp": "<ISO8601>",
  "fields": {
    "writeStatus": "done",       // or "skipped"
    "failReason": "..."          // only when skipped
  }
}
```

action patch `patches/writeback.{actionId}.patch.json`:
```jsonc
{
  "agent": "writeback",
  "targetType": "action",
  "targetId": "<actionId>",
  "timestamp": "<ISO8601>",
  "fields": {
    "writeStatus": "done",
    "failReason": "..."
  }
}
```

**Writable fields**: `writeStatus` / `failReason`

**Must not write**: other fields, pipelines.*, confirmations[]. Do not modify manifest.json directly.

---

## Inviolable rules

### R0 — Case document stays business-only (cleanliness)

`case-executable.md` is a test case, not a runbook. **Forbidden** in the written-back document (including notes, blockquotes, HTML, and table cells):

- `node` / `python` / `python3` / `bash` / `npx` invoke lines
- markdown ` ```bash ` / ` ```sh ` fences
- `scripts/executors/` paths, `skillRoot`, install cwd, user home paths
- host / port / mock-server notes (`127.0.0.1`, `:8765`, `DATA_BUILD_API_BASE`)
- “在 xx 目录下执行 / 改用绝对路径 / 依赖本地数据构建服务” and similar implementation footnotes

Those details belong in:

| Where | What |
|---|---|
| `manifest.entities[].toolBinding.invokeCmd` | How the precondition entity was constructed |
| `manifest.actions[].filledCmd` | Bound replay command for the step |
| Host chat report | Optional: constructed IDs + “replay commands are in the manifest” |

If the user asks how to replay a construct, point them at the manifest fields above. Do **not** “complete” the case by pasting those commands into it.

### R1 — Append only; do not modify

- **Do not delete** any original content (headings, paragraphs, list items, table rows, blank lines)
- **Do not change** existing original wording (test-step descriptions, expected-result text, etc.)
- **Do not reorder** sections or add/remove section headings
- **Do not change** the original formatting style (ordered lists stay ordered, unordered stay unordered, tables stay tables, indentation stays consistent)

Typical R1 violations:
- Changing `1. 2. 3.` into `- - -`
- Deleting "manual" hint text from the original
- Adjusting table column widths or alignment
- Merging two original list items into one

### R2 — Location strategy (targetLocation hint + semantic fallback)

Each entity/action's `targetLocation` field describes where it is filled in the document.

**targetLocation format**: `{section}.{container}[{index}].{qualifier}`

| Part | Meaning | Example |
|------|------|------|
| section | Section keyword | `precondition` (matches a heading containing "precondition"), `steps` (matches a heading containing "steps") |
| container | Container type | `list` (list), `table` (table) |
| index | Index inside the container (0-based) | `list[0]` = 1st list item, `table.row[0]` = 1st data row |
| qualifier | Finer location | `entity[N]` = Nth entity in the same list item, `.op-cell` = table operation column, `.expected-cell` = expected-result column |

**Location flow**:
1. Find the matching section heading by section keyword
2. Within that section, find the matching container (list or table)
3. Locate the specific item by index
4. Determine the insertion point by qualifier

**Semantic fallback when location fails**:
- Section heading text does not match → scan all headings and pick the closest semantically (e.g. "data preparation" ≈ "preconditions and data preparation")
- Index out of range (e.g. `list[3]` but only 2 items) → based on the entity/action description, find the best-matching list item or table row in that section
- Completely unlocatable → `writeStatus="skipped"`, explain in `failReason`, **do not force-insert**

### R3 — entity render rules

Render only entities with `entityStatus ∈ {"verified", "unverified"}` and a non-null `targetLocation`.

Other entities → do not render, do not write a patch.

Render by `constructionStrategy`:

**tool-build / static-value** (data entities):

```
{entityType}（{field}={value}，{field}={value}，…），{constraints summary}
```

- Render **every** non-null, non-empty `fields` key — not only the primary ID
- Skip envelope / implementation values (`success`, `ok`, `error`, `node` / `python` / `config-store` command strings)
- `constraints summary`: first 40 characters of constraints; truncate with `...` if longer
- Example: `product（productId=p_26，name=Northwind Standard，city=demo-city，kind=standard），可售的标准商品，处于上架可售状态`
- Do **not** append `invokeCmd` or a construction script
- If `fields` only has the primary ID, that is an `invoke_entity.ts` defect — do not invent missing attributes during writeback

**config** (config items):

```
配置项（{field}={business value}）
```

- Prefer the field name plus a short business value (`flag=1`, `whitelist=on`)
- If a field value is itself a command (`node` / `python` / `config-store` / a code fence), write **only the field name** — never the command
- Multiple fields: join with `，` inside the same parentheses

**runtime** (runtime-produced):

```
{entityType}（由步骤 {runtimeSource.sourceActionId} 执行时产出 {runtimeSource.sourceOutputField}）
```

### R4 — action render rules

Render only actions with `cmdStatus == "filled"` and a non-null `targetLocation`.

Other actions → do not render, do not write a patch.

Append a **business binding**, not `filledCmd`:

```
（入参：{param}={value}，...；产出：{outputField}、...）
```

- `入参` from `paramsFromEntities` (resolved `fields` values), `paramsFromPriorActions` (`第{stepIdx}步产出的 {field}`), `paramsFromGenerators` (`运行时生成`)
- `产出` from `outputs` keys
- Omit an empty side (`（入参：…）` or `（产出：…）` is fine)
- If no structured params exist, append `（已绑定）` — still do **not** dump `filledCmd`

**priorAction** (no `<<A01.orderId>>` in the case document):

```
（入参：orderId=第1步产出的 orderId；产出：…）
```

Do not add a blockquote footnote unless the 入参 line cannot name the source step.

**In-table / in-list**: append the same parenthetical on the same list item or in the target cell. If a table cell cannot wrap, keep it on one line (no `<br>` fences).

### R5 — Fill method

**List-item fill**:
- Append rendered text in the text region of the target list item (same line when it fits)
- Keep the original marker format (`- ` / `1. ` / `* ` / `+ ` etc. unchanged)
- When one list item has multiple entities (`entity[0]`, `entity[1]`...), join them in sub-index order with `；`
- Do not create a new list item
- Do not insert a nested code block under the list item

**Table fill**:
- Append rendered text in the target cell, same line
- Do not create a new table row
- Write only the column specified by targetLocation (usually the operation column); leave other columns alone

### R6 — Exception handling

- Original text is empty or the markdown structure is completely unrecognizable → all items `writeStatus="skipped"`
- A single entity/action fill fails → that item is skipped; **does not affect filling other items**
- All exceptions are passed via the patch file's failReason; do not modify the manifest directly
- failReason must start with the `[write-failed]` prefix, followed by a concrete reason
  - Example: `[write-failed] targetLocation precondition.list[3] out of range; section has only 2 items`
  - Example: `[write-failed] cannot locate section "precondition"; document has no matching heading`

---

## Render flow (`slot_render.ts`)

`pipeline.ts` Stage 5 calls `preview()` then `commit()`:

1. Collect entities with `entityStatus ∈ {verified,unverified}` and a `targetLocation`, plus actions with `cmdStatus=filled`
2. Render each item (R3 / R4) into `renderPreview`
3. Copy `caseSource.original` to `{case directory}/case-executable.md` if needed
4. Apply slots (R5). Skip items that fail location lookup; do not abort the rest
5. Persist `writeStatus` on the entity/action rows in the manifest (no writeback Agent, no patch files)

ASSERT: `case-executable.md` has no `node` / `python` / `bash` invoke line, no ` ```bash ` fence, no skillRoot/cwd/home path, and no host:port / mock-server note.

---

## EC remote case writeback (optional)

> After local `case-executable.md` exists, the host may run the `case_writeback` adapter. This is not a Task Agent. The host still asks the user for `ecCaseId` / login when the adapter requires it.

### Goal

**Incrementally merge** the constructed precondition data back into the remote case, instead of overwriting the remote file with the local `case-executable.md`.

### Style-loss prevention (most important)

- ⛔ **Do not** call `case_writeback.write <ecCaseId> --file case-executable.md` to overwrite the remote case with the whole file — remote cases are often rich text/HTML, and overwrite would wipe all original HTML styles.
- ✅ Must first `case get` the current remote content, judge the format, then choose a merge strategy.

### Input

- `ecCaseId`: remote case ID (the host gets it from context or asks the user)
- `case-executable.md`: locally generated executable case
- `manifest.json`: take entities to write back from it (precondition data)

### Flow

1. **Check case_writeback install and version**
   ```bash
   npm list -g case-writeback --depth=0 2>/dev/null | grep case_writeback
   # When not installed or the version is too old:
   npm install -g case-writeback --registry=https://registry.npmjs.org
   ```

2. **Check login state and fetch current remote content**
   ```bash
   case_writeback <ecCaseId> 2>&1
   # Empty output / contains "401" / contains "not logged in" → case_writeback login (wait for the user to finish browser sign-in, then continue)
   ```

3. **Judge remote content format**
   - Remote content is empty → first write; go to step 5 whole-file overwrite
   - Remote content contains HTML tags (e.g. `<div>` / `<p>` / `<table>` / `<br>` / `<ol>` / `<li>`) → rich text; go to step 4 incremental merge
   - Remote content is plain text / markdown → go to step 5 whole-file overwrite

4. **Incrementally merge rich text into the "Preconditions" module**
   1. Locate the "Preconditions" module in the remote content
   2. From the manifest, take entities to write back: `entityStatus ∈ {"verified","unverified"}` and `targetLocation` section is `precondition`
   3. Render those entities per R3 in this file
   4. Wrap the rendered result in HTML that matches the remote content and **append** it to the end of the "Preconditions" module
   5. Keep the remote original HTML structure, tags, and styles; do not rearrange, convert, or delete
   6. Write the merged full content to a standalone file (e.g. `{case directory}/case-executable.ec-merged.html`) and write back:
      ```bash
      case_writeback.write <ecCaseId> --file <absolute path of the merged file>
      ```

5. **Whole-file overwrite (only when remote is empty or plain text)**
   ```bash
   case_writeback.write <ecCaseId> --file <absolute path of case-executable.md>
   ```

6. **Result report**
   - Success (`code=0` in the output JSON) → tell the user "remote case <ecCaseId> content has been updated"
   - Failure (`code≠0` or empty output) → show the full output and give a command that can be retried manually:
     ```bash
     case_writeback.write <ecCaseId> --file <merged file or absolute path of case-executable.md>
     ```

---

## Common pitfalls

- Do not modify the table's "expected result" column — write only the column specified by targetLocation (usually the operation column)
- Do not paste `filledCmd` / `invokeCmd` / `skillRoot` into the case — R0
- Do not add “run this under the slot directory / mock server :8765” footnotes — R0
- When the same `list[N]` has multiple `entity[0]`, `entity[1]`..., join them on the same line with `；` in sub-index order; do not split across lines
- Do not abandon writeback of the whole document because one item's targetLocation failed — skip that item and continue with others
- An entity/action without targetLocation is out of writeback scope; ignore it and do not write a patch
- Do not "prettify" the original (adjust blank-line count, align table column widths, unify list-marker style, etc.) — keep the original as-is
- Do not dump the full entity constraints — truncate beyond 40 characters
- Do not write back only the primary ID when `fields` has more constructed attributes — render every non-null field
- Do not execute `filledCmd` during writeback; construction already happened on the data track
