# agents/parse-case

> Host launches this Agent only when `pipeline.ts` exits **11**. After the patch is written, the host runs `merge_patch.ts` then `pipeline.ts --resume`. This file is the Agent's sole execution spec.

## Role

Parse the original case text and produce structured **entities** (data needs) and **actions** (operation needs), then write them into the manifest. Each entity/action carries `targetLocation` pointing to the writeback location.

## Input

The Task prompt carries:
- `manifest`: absolute path to manifest.json
- `businessContext`: absolute path to business-context.json (may be null; skip §2.0 disambiguation when null)
- Original case text is in the file pointed to by `manifest.caseSource.original`, or pasted into the prompt by the host

## Output spec

**Write only these fields**:
- `manifest.entities[]` (including targetLocation / writeStatus)
- `manifest.actions[]` (including targetLocation / writeStatus)

**Must not write**:
- `pipelines.*` (`pipeline.ts` owns these)
- `confirmations[]` (host / C3 only)
- `caseConfidence / generatedAt / lintRounds` (finalize / lint scripts only)

## Task details

### 1. Read the original case text

- Use the Read tool to read the file pointed to by `caseSource.original`
- Identify document structure: precondition / steps / (possibly also description / teardown)

### 2. Extract data needs → entities

> **Prerequisite**: if businessContext is not null, run §2.0 disambiguation first; otherwise extract directly from the original text.

#### 2.0 Business-noun disambiguation (run only when businessContext is not null)

Read business-context.json and disambiguate text in precondition and steps as follows:

**Step 2.0.1: glossary scan**

Scan each precondition item against the `glossary` key list:
- Exact match (the precondition text contains the glossary key verbatim)
- Semantic match (the precondition meaning matches some glossary entry's definition)

**Step 2.0.2: prerequisites expansion**

For each matched glossary entry, expand `prerequisites[]` into multiple entities:
- If a prerequisite describes a data entity that must exist → generate an entity
- If a prerequisite describes a config item (matches `relatedConfigs`) → generate a config-class entity (`entityType="config item"`, constraints contain key=value)
- When expanding, auto-fill dependencies using the `entityGraph` `upstream` chain

**Step 2.0.3: entityGraph normalization and supplementation**

For every produced entity (both extracted from the original text and expanded), look up `entityGraph`:

- **Normalize entityType** (mandatory): if the data entity described by the entity semantically matches an entityGraph key, `entity.entityType` must use that entityGraph key's exact text. Example: original text says "catalog product", entityGraph has "product" → entityType is forced to `"product"`.
- From `fields[]`, supplement the key list of `entity.fields` (do not overwrite existing keys)
- From `states[]`, check whether status descriptions in constraints are valid

**Normalization rule**: entityGraph keys are the authoritative entity-type names in this requirement domain. parse-case must not invent entity-type names — whenever an entityGraph key is semantically equivalent, it must be used. Only when no entityGraph key matches semantically may the original wording be kept as entityType.

**Step 2.0.4: systemDependencies assistance**

For operation descriptions in steps, look up `systemDependencies`:
- Matched operations → use the `type` field to assist actionType judgment in §3
- Operations with `type == "offline-task"` → append that entry's description to action.queries as context

**Disambiguation principles**:
- Expansion is **supplementary**, not a replacement — do not regenerate entities already explicit in the original case
- Expanded entities are numbered after entities extracted directly from the original text
- If glossary matches but the expanded prerequisites duplicate an entity already in the original text → skip (dedupe)
- When businessContext is null this entire section is skipped and does not affect later logic

---

#### 2.1 constructionStrategy judgment

Every entity must be assigned a `constructionStrategy` at extraction time; it decides which later pipeline handles the entity:

| constructionStrategy | Judgment condition | Later handling |
|---|---|---|
| `tool-build` | Entity whose data must be constructed via a tool (skill / tool) | handled by `invoke_entity.ts` |
| `static-value` | Value is already given in the original case; no tool construction needed | parse-case fills fields directly + entityStatus="verified" |
| `config` | Config-item entity (matching key exists in configMap) | generate_config_commands.ts generates deterministically |
| `runtime` | Value is produced when an action step executes (e.g. orderId returned by placing an order) | marked runtime-deferred; does not enter invoke |

**Judgment rules in detail**:

1. **static-value**: the original text already gives a concrete value (e.g. "member ID=12345", "amount=100"), or there is only one legal value in the business context (e.g. "type=product")
2. **config**: the entity describes a system config item (switch, threshold, allowlist, etc.), and entityType contains "config" or a matching key exists in businessContext.configMap
3. **runtime**: the value the entity needs can only be obtained after some action step executes (e.g. "orderId returned after order creation"); the entity is then a "consumer" of action.outputs
4. **tool-build**: entities that do not match the 3 cases above; must be created via a data-construction tool

---

For every "must exist / prepare / construct" data entity in precondition:

```jsonc
{
  "entityId": "E01",                   // E + two-digit sequence
  "entityType": "product",              // entity type name
  "constructionStrategy": "tool-build", // tool-build | static-value | config | runtime
  "constraints": "domestic, open for business",    // positive constraints
  "reverseConstraints": null,          // reverse constraints (attributes that must not appear, e.g. "no unused license on the account")
  "targetValues": null,                // config-class entity only: {key: {value, serviceId?}}
  "runtimeSource": null,               // runtime-class entity only: {sourceActionId, sourceOutputField}
  "executionBatch": 1,                 // initial estimate; pipeline.ts overwrites via topo_sort_batch.ts
  "dependencies": [],                  // [{entityId, field, asParam}]
  "queries": {                         // query terms for tool retrieval
    "angleA": "from the entity-type angle",
    "angleB": "from the business-scenario angle"
  },
  "toolBinding": {
    "toolType": null, "resourceId": null,
    "skillRoot": null,                  // filled by select_tool.ts: discovered slot directory (do not invent)
    "invokeCmd": null, "toolStatus": null
  },
  "fields": { "productId": null, "kind": null, "name": null },
  // Minimum key contract: every business attribute the case mentions or the tool will return.
  // invoke_entity.ts MUST merge extra keys from the live response; do not treat this list as a ceiling.
  "entityStatus": null,
  "dataConfidence": null,
  "verifyNote": null,
  "failReason": null
}
```

#### 2.2 Output spec per constructionStrategy

**static-value entity**:
- Fill fields directly with known values (extracted from the original text)
- entityStatus = "verified"
- dataConfidence = 0.85
- Leave queries / toolBinding empty (no tool needed)

**config entity**:
- Set entityType to `"config item"` (English name for the original Chinese config-item entity type) or keep the original description
- Fill targetValues as `{key: {value: "<target value>", serviceId: null}}` (serviceId is filled from configMap by generate_config_commands.ts)
- entityStatus = null (handed to generate_config_commands.ts)
- Leave queries / toolBinding empty

**runtime entity**:
- Fill runtimeSource as `{sourceActionId: "A01", sourceOutputField: "orderId"}`
- entityStatus = "runtime-deferred"
- dataConfidence = null
- Leave queries / toolBinding empty

**tool-build entity** (default; existing logic unchanged):
- Must fill queries (angleA + angleB)
- Leave entityStatus / toolBinding empty; handed to `select_tool.ts` / `invoke_entity.ts`

**executionBatch judgment rules**:
- parse-case only needs to fill `dependencies[]` correctly; `executionBatch` can be a reasonable estimate
- After parse completes, `pipeline.ts` calls `topo_sort_batch.ts` to compute all executionBatch values deterministically from the dependencies DAG and overwrite them
- If dependencies contain a cycle, topo_sort_batch.ts errors and the host stops the flow

**reverseConstraints handling rules**:
- Write reverse constraints (e.g. "no unused license on the account", "phone number not bound") into the `reverseConstraints` field; **no data construction is needed — only query during invoke to confirm they do not exist**
- The construction tool for a reverse-constraint entity matches its carrier type (same tool group); the verify command is specified separately
- If the reverse constraint itself is a state that must be created then deleted (e.g. "expired license"), construction is still required, but note the state in `constraints`

**queries writing requirements**:

`select_tool.ts` uses marketplace / experience search. Tool names in the catalog are full natural-language phrases, so query terms must be natural-language sentences describing "what data you want to construct".

> ⚠️ **Two hard bans**:
> - **Do not concatenate words with spaces** (e.g. `"store create"`) — space-separated isolated words break the semantic vector and cause recall drift
> - **Do not use pure technical terms** (e.g. `"ext_ref"`, `"sku_code"`) — internal abbreviations are semantically empty in vector space and return 0 results

angleA and angleB must describe the same data need from **different angles**, so the two query sentences are not too close semantically:

| Angle | Construction direction | Example |
|---|---|---|
| angleA | **Active-construction angle**: what I will construct/create | `"create a test product and open it"` |
| angleB | **Business-scenario angle**: what happens naturally in the business | `"full catalog supply-chain listing flow"` |

Data-need and operation-need queries emphasize **different** semantics:
- `entity.queries`: emphasize "**construct/create** a data entity"
- `action.queries`: emphasize "**execute/trigger** a business action" (see next section)

### 3. Extract operation needs → actions

For every "operation that needs tool-assisted execution" in steps (e.g. trigger a backend event, courier accepts the order, simulate a push, data mutation, etc.):

> **Operation-need recognition rules** (recognize as an action if any one holds):
> - **Backend/system-side operation**: describes a system/backend role's behavior, not a frontend user action (e.g. "worker accepts the order", "trigger settlement", "supplier confirms the order")
> - **State-transition trigger**: needs to trigger a business-state change that cannot be done via frontend UI (e.g. "set the order status to completed")
> - **Data mutation/write**: needs to modify a data record (e.g. "issue a license to the user", "change the product price")
> - **External action outside this system**: depends on an external system or third-party service (e.g. "simulate a payment callback", "trigger a shipment status update")
>
> **Reverse exclusion — these are not actions**: ordinary frontend UI interactions ("click a button" / "enter a page" / "view a card"); operations that only need human confirmation ("check whether the display is correct").

```jsonc
{
  "actionId": "A01",                   // A + two-digit sequence
  "stepIdx": 3,                        // line number of the step in the original text, starting at 1
  "actionDesc": "use courier accepts a delivery order",
  "actionType": "backend-trigger | state-transition | data-mutation | external-event",
  "queries": { "angleA": "...", "angleB": "..." },
  "toolBinding": {
    "toolType": null, "resourceId": null,
    "skillRoot": null,                  // filled by select_tool.ts: discovered slot directory (do not invent)
    "cmdTemplate": null,               // contains __paramName__ placeholders
    "toolStatus": null
  },
  "paramsFromEntities": [
    { "paramName": "orderId", "sourceEntityId": "E05", "sourceField": "orderId" }
  ],
  "paramsFromGenerators": [           // runtime-generated values
    { "paramName": "distributorOrderId", "generator": "RANDOM_ID", "args": {"length": 15} }
  ],
  "paramsFromPriorActions": [         // produced at runtime by an upstream action
    { "paramName": "prePaidOrderId", "sourceActionId": "A02", "sourceOutputField": "orderId" }
  ],
  "outputs": {                        // output contract declared by this action (for downstream references)
    "orderId": { "description": "order ID returned by placing the order", "hint": "usually at .data.orderId (human hint, not a hard constraint)" }
  },
  "filledCmd": null,
  "cmdStatus": null,
  "cmdConfidence": null,
  "verifyNote": null,
  "failReason": null
}
```

**actionType judgment**:
- `backend-trigger`: needs to send a backend request (e.g. trigger settlement, push a message)
- `state-transition`: change a business state (e.g. "courier accepts the order", "order cancelled")
- `data-mutation`: directly mutate a data record
- `external-event`: simulate an external-system event (e.g. payment callback)

**action.queries writing requirements**:

Same as entity.queries: also ban space-concatenated words and pure technical terms; the semantic emphasis differs — action.queries emphasize "execute/trigger a business action":

| Angle | Construction direction | Example |
|---|---|---|
| angleA | **Execute-action angle**: what operation I will trigger/complete | `"courier accepts a delivery order"` |
| angleB | **Business-flow angle**: how the action occurs naturally in the business | `"courier accept order flow"` |

**paramsFromEntities rules**:
- Fill only when the action needs an entity field as a parameter
- `paramName` is the name of the `__paramName__` placeholder in cmdTemplate
- `sourceEntityId` must be an entityId that already exists in entities; otherwise lint-gate returns RESCAN_ACTION
- `sourceField` is a key name pre-declared in entity.fields

**paramsFromGenerators rules**:

Recognize this field when the original text has "runtime-generated" semantics; authoritative list: `references/param-source-spec.md`.

| Original-text signal | generator | args |
|---|---|---|
| random / unique / serial number / order number (must be fresh each time) | `RANDOM_ID` | `{length: 15}` (default) |
| UUID / GUID / unique identifier | `UUID` | — |
| current timestamp (ms) / now / timestamp | `TIMESTAMP_MS` | — |
| tomorrow / today / N days later / N days ago / relative date | `DATE_OFFSET` | `{offsetDays: <N>}` (today=0, tomorrow=1, three days later=3, yesterday=-1) |

**Only the 4 generators above are legal**; other values (e.g. "CURRENT_USER", "RANDOM_PHONE", `SEQ`) must not be written — they should land in `paramsFromEntities` or `paramsFromPriorActions`. `SEQ` is revoked under the inline scheme (cannot stay monotonic across cells); when a sequence number is needed, use `RANDOM_ID` or an explicit entity.

**paramsFromPriorActions rules**:

Recognize this field when the original text has cross-step data-flow semantics such as "use XX generated in step N", "take the previous step's order number", "use the token returned earlier as ...":

- `sourceActionId` must point to an action that already exists in the same manifest, and its `stepIdx` must be strictly less than the current action
- Also declare `sourceOutputField` under the source action's `outputs` (add it immediately if missing)
- `outputs[<field>]` only needs `description` (required; field semantics) + optional `hint` (human hint, e.g. "usually at .data.orderId"); **no longer fill extractJq** — planner cannot reliably generate a response-extraction expression; the execution side sees the placeholder `<<A02.orderId>>` and the hint line and substitutes from context

**Priority conflict**: one `paramName` may belong to only one of the three classes; when parse-case recognizes it, priority is entity > priorAction > generator (prefer an existing entity or upstream action over a generator).

### 3.5 action.outputs declaration rules

- Any field referenced by a downstream action's `paramsFromPriorActions` must be declared in the source action.outputs
- Unreferenced fields may be omitted (`outputs: {}` or omitted entirely)
- Field shape: `{"orderId": {"description": "order ID returned by placing the order", "hint": "usually at .data.orderId"}}`
- `description` is required (slot_render concatenates it into the execution-side hint line); `hint` is optional and only a reference for the execution side

### 4. Fill targetLocation

Every entity and action must carry a `targetLocation` field that tells writeback where to write into the case document.

**entity targetLocation** — points to the precondition region:

```jsonc
{
  "entityId": "E01",
  "targetLocation": "precondition.list[0]",
  "writeStatus": "pending",
  "renderPreview": null,
  // ...other fields
}
```

**action targetLocation** — points to the corresponding steps-table row:

```jsonc
{
  "actionId": "A01",
  "targetLocation": "steps.table.row[2].op-cell",
  "writeStatus": "pending",
  "renderPreview": null,
  // ...other fields
}
```

**location rules**:
- precondition: number each item in original order as `precondition.list[N]`, N starting at 0
- One precondition item contains multiple entities → `.entity[M]` sub-index
- steps: by steps-table row number `steps.table.row[N].op-cell`, N is `stepIdx - 1`

### 5. Write to disk and exit

- Use the Write tool to write the result to `patches/parse-case.all.patch.json` (patches/ subdirectory next to the manifest)
- Patch format: `{"agent": "parse-case", "targetType": "bulk", "targetId": "all", "timestamp": "<ISO>", "fields": {"entities": [...], "actions": [...]}}`
- **Do not modify manifest.json directly**; the host calls merge_patch.ts to merge
- Exit immediately after Write; **response text only needs to report "wrote N entities / M actions"**; the host reads disk and does not depend on the response

## Common pitfalls

- Do not mistake "an operation in a step" for an entity — that is an action
- Do not omit the key lists of `entity.fields` or `action.paramsFromEntities`, even if all values are null; downstream Agents depend on those keys as placeholder contracts
- `entity.fields` is a **minimum** contract. List every business attribute named in the case (not only the ID). `invoke_entity.ts` will add further keys from the tool response; `slot_render.ts` renders all non-null fields onto the case
- Zero entities with all actions is fine, and vice versa — one of the two being non-empty is enough; if both are 0, the host treats parse as failed and reports an error to the user
- action.stepIdx must match the original steps line number; otherwise writeback writes the command to the wrong row
