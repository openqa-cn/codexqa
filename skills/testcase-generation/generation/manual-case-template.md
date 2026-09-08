---
caseId: {UUID batch-pre-generated in Phase 3 Step One}
caseType: UI | SERVER
---

# Generic Test Case Template

> Scope: server APIs / client (APP, mini-program) / end-to-end scenarios
> Fill each module as needed from the requirements analysis report; delete unused modules entirely.

---

## Usage Notes

### Title Format

The H1 title must match the filename (without `.md`) exactly. See `case-authoring-rules.md` § 1.2 for the full format.

### H1 and Body Separator (optional)

> Optional: if a local script needs to split the title from the body, insert a line `<!-- case-body-start -->` between the H1 and `### 1. Prerequisites`. Omitting it does not affect case validity; review and lint do not require it.
> **Optional form**:
> ```markdown
> # [domain-flow/page] scenario-goal
>
> <!-- case-body-start -->
>
> ### 1. Prerequisites
> ```
### Generation Rules

Each case contains: 1. Prerequisites; 2. Steps and Expected Results; 3. Request and Assertions; 4. Engineering Info; 5. Teardown.
All dependency information involved in Prerequisites must be filled in the template format; unused submodules must be **deleted entirely, with no "(N/A for this case)" placeholder** (especially Experiment and Mock).
Steps and expected results are presented as a Markdown table with 3 columns: `#` (sequence), `Step`, `Expected`.

**Chapter numbering rules**:
- 3. Request and Assertions: delete the entire chapter when no server API calls are involved (pure frontend UI cases).
- 4. Engineering Info: delete the entire chapter when no server API calls are involved; when involved, keep only the used submodules (e.g. delete the MQ section if there is no MQ).
- 5. Teardown: delete the entire chapter when none of the three submodules apply.
- Step-table reference text must match the actual chapter numbers (do not reference a deleted chapter).

---

## Template Content

### 1. Prerequisites

> For each submodule below: fill in the format when applicable; delete the entire section when not applicable (leave no placeholder).
>
> ⛔ **Do not infer engineering config**: identifiers such as Config service serviceId/key/value and Entity field names must come from explicit records in `analysis.md` / `api-details.md` / source materials; do not infer or invent them from business semantics; when source materials are unclear, always fill `TBD`.

#### Client Environment (UI cases only)

> ⛔ **Version-range row must not be omitted**: UI cases must keep the version-range row; fill a concrete value when source materials specify a version requirement; fill `TBD` when unspecified; do not delete this row.

| Field | Content |
|------|------|
| **Terminal** | iOS / Android / WeChat mini-program / Alipay mini-program |
| **Version range** | e.g. App ≥ v12.5.0; WeChat base library ≥ 3.0 (fill `TBD` when source materials are unclear; do not omit this row) |
| **Business scope** | e.g. retail line only / all users / specific cities (Beijing, Shanghai) |
| **Page entry** | e.g. Home recommendation slot → Product list → Product detail |

#### Entity

> ⚠️ UI case check: if the case involves operations after entering a store (e.g. add to cart, place order, view product detail), the Entity must provide store id and store URL for a direct page entry.
>
> 🚫 **Hard constraint**: when generating cases, the **Construction column must be left empty**; do not fill any content. Construction is backfilled after data construction runs; do not prefill it during case generation.

| Entity                      | Content                                           | Construction |
|---------------------------|----------------------------------------------|----------|
| {entityName}                  | `{field1}`: {value1}<br>`{field2}`: {value2} | |
| Store id (required for UI cases that involve store operations)     | `storeId`: {store id}                            | |
| Store URL (required for UI cases that involve store operations) | `storeUrl`: {store deep-link}                           | |

#### Config service

> ⛔ **Headers come from** `config.fields` in `integrations-resolved.json` (defaults: serviceId / key / value). Fill `TBD` when unspecified; do not infer.

| serviceId | key | value |
|--------|-----|-------|
| `{config_service_id}` | `{config_key}` | `{config_value}` |

#### Experiment

> Fill when the profile includes `experiment` and the case involves gray release / AB / grouping; delete the entire section with no placeholder when not involved or when the profile has no such component. Headers come from `experiment.fields`.

| experimentKey | groups |
|---------------|--------|
| `{experiment_key}` | Control group: {control group config}<br>Experiment group: {experiment group config} |

#### Mock

> Fill only when the downstream API type is in `profile.mockableProtocols` (default e.g. `grpc`); delete the entire section with no placeholder when not involved. Protocols not in that list, as well as DB / Cache / MQ / Config service, are never mocked.
> Fill `TBD` when service name or API info is unspecified. **Mock result must be concrete data (JSON or a TIMEOUT description); do not write references such as "use baseline template" or "see Mock analysis"**.

| Field              | Content |
|-----------------|------|
| **Service name (serviceId)** | `{downstream serviceId}` |
| **API type**        | {from mockableProtocols} |
| **API info**        | `{qualified name or method path}` |
| **Mock result**     | {concrete Mock return JSON / TIMEOUT description} |

#### Tracking (fill for tracking cases only)

| Field | Content |
|------|------|
| **Trigger condition** | {e.g. fire after the page main content has rendered} |
| **Trigger count** | {e.g. fire once per page entry; do not report again during the same stay} |
| **Latency requirement** | {e.g. report within ≤ 500ms after the page becomes visible} |
| **Retry mechanism** | {e.g. cache locally when offline; auto-retry after network recovers} |
| **Report params** | `event`(String, required): `{event_name}`<br>`{param}`({type}, required/optional): {expected value} |

---

### 2. Steps and Expected Results

> **Writing rules**
> - Each step must correspond 1:1 to an expected result; do not merge or leave blank; use `<br>` for line breaks inside table cells
> - **UI cases**: Steps write only user-perspective operations (enter a page, tap a button, input content, etc.); ⛔ do not write `→ trigger call` or a method name; expected results follow the **dimension ownership rules** (see summary rules below) — **page-behavior assertions** (Toast, navigation, element display, tracking report) use `▸ Page behavior: ...` / `▸ Tracking: ...` directly in this table's Expected column; **when backend assertions are involved** (API return / DB / Cache / MQ, etc.), write the full jsonc assertions in the expected collapse blocks of "3. Request and Assertions", and this table uses a `▸ {dimension} {locator}: {key value}` summary + a trailing `See chapter 3`. Pure frontend interaction cases (no backend calls) do not need chapters 3 and 4.
> - **SERVER cases**: Steps write `→ trigger call `{methodName}`, see chapter 3 Request and Assertions for request/expected`; **write the method name only** (short form); full class name / serviceId / API type and other basic info are listed uniformly in the "Server APIs" table of "4. Engineering Info"; the two places must correspond 1:1; request JSON and full expected (API return/DB/Cache/MQ) are listed in pairs of `<details>` collapse blocks in "3. Request and Assertions"; **this table's "Expected" column only writes assertion summaries** (see summary rules below)
> - **Concretize expected results**: copy, toast text, error codes, and status values already specified in analysis.md must be quoted verbatim (e.g. if analysis.md records `toast "out of stock"`, the expected result must write `Toast shows "out of stock"`, not "toast failed" or "toast inventory-related info"); do not replace concrete assertions with vague words such as "normal" / "success" / "failed" / "as expected"
>
> **Assertion summary rules (Expected column, shared by UI / SERVER)**: the Expected column is split by verification dimension — ① each dimension uses `▸ {dimension} {locator}: {key value}` on its **own line** (separate with `<br>` inside the table cell); ⛔ do not squeeze different dimensions onto the same line; ② the API return line must include the method name + status/error code (e.g. `▸ API return \`createActivity\`: code=1`); ③ a write-operation line must include the table name + core result (e.g. `▸ DB active_info: insert 1 row, version=0`); a Cache line must include the Key; an MQ line must include the topic; ④ a page-behavior line uses `▸ Page behavior: {Toast/navigation/element display, etc.}` to record UI assertions (quote the original copy from `analysis.md`); ⑤ cases that involve backend assertions (API/DB/Cache/MQ) end with a separate line `See chapter 3`; write the full jsonc assertions in chapter 3 expected collapse blocks; pure frontend cases with no backend calls do not need `See chapter 3`. ⛔ Do not degrade to valueless descriptions such as "as expected/success/normal/failed".
>
> **Summary Example:**
> - Pure SERVER: `▸ API return \`createActivity\`: code=1, activeId non-empty<br>▸ DB active_info: insert 1 row, version=0<br>▸ Cache active_info: Key=coupon:{activeId} synced<br>See chapter 3`
> - UI (with backend calls): `▸ Page behavior: Toast shows "added to cart", cart badge +1<br>▸ API return \`addCartItem\`: code=0, cartId non-empty<br>▸ DB cart_item: insert 1 row, goods_id persisted<br>See chapter 3`
> - Pure frontend UI (no backend calls): `▸ Page behavior: {Toast/navigation/display}<br>▸ Tracking: event={name}, {param}={value}`

**Step table (UI case example)**:

| # | Step | Expected |
|---|----------|----------|
| 1 | Open the product detail page and tap the "Add to cart" button | ▸ Page behavior: Toast shows "added to cart", cart badge +1<br>▸ API return `addCartItem`: `code`=0, `cartId` non-empty<br>▸ DB `cart_item`: insert 1 row, `goods_id` persisted<br>▸ Cache `cart:{userId}`: updated, value matches DB<br>See chapter 3 |
| 2 | {subsequent user action} | ▸ Page behavior: {expected UI behavior}<br>▸ API return `{methodName}`: {key field=expected value}<br>▸ DB `{table}`: {expected data state}<br>See chapter 3 |

**Step table (SERVER case example)**:

| # | Step | Expected |
|---|----------|----------|
| 1 | → trigger call `addCartItem`, see chapter 3 Request and Assertions for request/expected | ▸ API return `addCartItem`: `code`=0, `cartId` non-empty<br>▸ DB `cart_item`: insert 1 row, `goods_id` persisted<br>See chapter 3 |

**Expected result writing rules**: organize by verification dimension; shared by UI / SERVER —

- **Page-behavior class** (Toast / page navigation / element display / data echo / tracking report, etc.): record directly in this table's Expected column with `▸ Page behavior: ...` / `▸ Tracking: ...` on separate lines (quote the original copy from `analysis.md`; do not fuzz it).
- **Backend-assertion class** (API return / DB / Cache / MQ / exception handling / degradation / gray release, etc.): write the full jsonc assertions in the expected collapse block of the corresponding step in "3. Request and Assertions" (list every API-return field from the response structure; see chapter 3 rules); this table's Expected column only writes a `▸ {dimension} {locator}: {key value}` summary + a trailing `See chapter 3`.
- For UI cases that involve backend assertions, both dimension classes **appear together** in this table (page behavior first, then backend summaries); the full assertions remain in chapter 3.

Refer to the table below for each dimension (`▸` prefix + colon-separated key values; fill according to the rules above):

| Dimension | Applicable scenario | Expected writing (summary) |
|---------|----------|-------------|
| **Page behavior** | Involves client UI | `▸ Page behavior: {Toast text / page navigation / element display state}` |
| **API return** | Involves backend call | `` ▸ API return `{methodName}`: `code`=0, `{key field}`={expected value} `` |
| **DB** | Write ops; or read ops that can map "return field → DB table field" | `` ▸ DB `{table}`: insert/update N rows, `{key field}`={expected value} `` |
| **Cache** | Involves cache | `` ▸ Cache `{cluster}`: Key=`{key}` updated/invalidated `` |
| **MQ** | Involves message queue | `` ▸ MQ `{topic}`: message sent, `{key field}`={expected value} `` |
| **Exception handling** | Param validation / downstream exception / internal exception | `` ▸ Exception handling: `code`={error_code}, `msg`="{error_msg}", no dirty data `` |
| **Concurrency** | Concurrent write / deduction / lock contention | `▸ Concurrency: unique key persists only one row / total deduction ≤ initial value` |
| **Degradation** | Config degradation / circuit break | `▸ Degradation: take the degradation branch, API returns {concrete degraded value}` |
| **Gray release** | Gray rollout / AB experiment | `▸ Gray release: hit/miss, returns {response of the corresponding version}` |
| **Tracking** | Tracking tests | `` ▸ Tracking: `event`={event_name}, {param}={expected value} `` |

---

### 3. Request and Assertions

> List the **request** and **expected** for every API call in the steps: for each step that involves a server API call, give two collapse blocks in a pair — "Step N · {methodName} request" and "Step N · {methodName} expected"; titles use the **simple method name** (consistent with chapter 2 step-table references; full class name, serviceId, and other basic info are listed in the "Server APIs" table of 4. Engineering Info; the two places correspond 1:1). Delete the entire chapter for pure frontend UI cases (no backend calls).
>
> ⚠️ **Placeholder rules**: keep `{placeholder}` form for JSON field values that must be backfilled by `testdata-generation`; write real values for fields unrelated to data construction. Placeholder check: if the field value depends on an Entity (system-generated identifiers such as user/order/coupon), keep `{placeholder}`; if it is determined directly by scenario semantics (enum values / operation types / engineering locator fields / fixed flags), write the real value. Placeholders are backfilled by **`testdata-generation`**, not by a later phase of this skill. **Do not write the judgment-criteria explanation into the actual case document**.
>
> **Request source**: the request JSON structure must come from the corresponding API's `<details>` request/response details in `api-details.md`; do not construct it yourself.
>
> ⛔ **Request comment rules (must mark key fields)**: request JSON uses commented `jsonc` (not `json`). **Key fields must be annotated with inline `//` comments** — meaning + legality basis + expected branch:
> - **Business enums / status switches**: mark the value meaning + which branch this case takes (e.g. `"business": 2  // retail line; this case takes the retail branch`)
> - **Valid/invalid construction fields** (positive/negative distinguisher): mark "valid/invalid" and the basis (e.g. `"filterId": "{filterId_s1}"  // valid: filter_rule exists and status=0, expect persist`)
> - **Boundary-value fields**: mark upper bound / lower bound / over limit (e.g. `"quantity": 999  // upper bound: exactly at max_limit`)
> - **Scenario-differentiating fields** (values differ across cases to distinguish scenarios): mark this case's scenario semantics for that value
> - **Array elements**: if one array mixes valid/invalid elements (branch-coverage scenario), annotate each element
> - **Simple basic fields** (constants, path parameters, etc. with no scenario difference): comments may be omitted to avoid noise

#### Request collapse blocks

<details>
<summary>Step 1 · addCartItem request</summary>

```jsonc
{
  "userId": "{userId}",       // valid user, construct from Entity
  "goodsId": "{goodsId}",     // target goods, construct from Entity
  "quantity": 1,              // quantity: use 1 in the normal scenario; boundary scenarios may use max_limit
  "channel": "web"            // sales channel from the spec (example: web / app / api); this case takes web
}
```

</details>

<details>
<summary>Step 1 · batchCreateFilterRule request (branch coverage example)</summary>

```jsonc
// Request construction note: filterIds mixes valid + invalid items to cover the "partial success" branch
{
  "request": {
    "activeType": 2,
    "activeId": "{activeId}",
    "dimensionType": 1,
    "refItems": [
      {
        "filterIds": [
          "{filterId_s1}",   // valid: filter_rule exists and status=0, expect persist
          "{filterId_s2}",   // invalid: filter_rule does not exist, expect to go into invalidFilterIds
          "{filterId_s3}"    // valid: filter_rule exists and status=0, expect persist
        ],
        "listType": 1       // association dimension type: 1=associate by business activity
      }
    ]
  }
}
```

</details>

#### Expected collapse blocks

> **Format**: use commented `jsonc`, segmented by verification dimension. Mark the dimension and engineering locator at the start of each segment: `// ① API return`, `// ② DB {table} ({datasource/shardingRule})`, `// ③ Cache {cluster} ({key})`, `// ④ MQ {topic}` — field names align with `profile.components`; include only dimensions the case actually involves; delete unused ones. The JSON body writes field=value; comparison (`>`/`<`), negation (no insert / not modified), range (only field X changed, others unchanged), existence (non-empty / current millis), degradation (TBD), and other assertions that cannot be expressed as values are carried by inline or section-leading `//` comments.
>
> ⛔ **API-return field-by-field coverage**: the `// ① API return` segment must follow the corresponding API response structure in `api-details.md` and **list every business field** inside `data` — write a value when the expected value can be determined; write a placeholder comment when it cannot (e.g. `"activeId": "<non-empty, same as request>"`, `"gmtCreate": "<type:Long>"`); **do not stop after only code/msg**.
>
> ⛔ **Do not infer engineering identifiers**: locator info in DB/Cache/MQ segments must come from `analysis.md` or the 4. Engineering Info tables; when missing, mark the section header as `TBD (engineering info missing, need to supplement {missing fields})`; do not invent values.

<details>
<summary>Step 1 · createActivity expected</summary>

```jsonc
// ① API return
{
  "code": 1,
  "msg": "success",
  "data": {
    "activeId": "{activeId}",   // non-empty, same as request
    "version": 0,
    "business": [1],
    "status": 0
  }
}
// ② DB active_info (shardingRule=coupon_shard_rule · shard key active_id={activeId})
// assertion: insert 1 row; only the following fields persist, others unchanged
{
  "business": 1,
  "active_type": 2,
  "status": 0,
  "version": 0,
  "extend_info": "{request extendInfo JSON}",
  "ctime": "<current millis · non-empty>",
  "utime": "<current millis · non-empty>"
}
// ③ Cache active_info (cluster=coupon-cache · key=coupon:{activeId} · command=set)
{
  "activeType": 2,
  "activeId": "{activeId}",
  "version": 0,
  "extension": "<same as request extendInfo>"
}
```

</details>

<details>
<summary>Step N · {methodName} expected</summary>

```jsonc
// ① API return
{
  "code": {expected code},
  "msg": "{expected copy}",
  "data": { "{field1}": "{value1}", "{field2}": "<non-empty>" }
}
// ② DB {table} ({datasource/shardingRule · shard key})
// assertion: {insert/update/no new records, etc.}
{ "{col1}": "{value1}", "{col2}": "<current millis · non-empty>" }
```

</details>

---

### 4. Engineering Info

> Record the basic info of engineering components involved in this case (APIs + database / cache / mq in `profile.components`). Short method names used in the chapter 2 step table, and table / cluster / key / topic used in chapter 3 expected blocks, have their full locator info listed here — the two places correspond 1:1.
> Delete the entire chapter when no server API calls are involved (pure frontend UI cases); when involved, keep only the used submodules (e.g. delete the MQ section if there is no MQ). Headers must match `fields` in `integrations-resolved.json`; do not write split tables such as "Cache · Redis / Cache · KV store".
>
> ⛔ **Do not infer**: all identifier fields must come from explicit records in `analysis.md` / `api-details.md` / source materials; fill `TBD` when missing; do not infer or invent them from business semantics.

#### Server APIs

> Required fields: **serviceId · API type · API name**. API type comes from `profile.protocols` (defaults `http` / `grpc`). HTTP API name uses `{HTTP method} {path}`; gRPC API name uses the qualified name. One service per row; when multiple services are involved, list them in call order, one per row; do not pile multiple serviceIds or API info into the same cell.

| serviceId | API type | API name |
|--------|----------|--------|
| `{serviceId}` | http / grpc | http: `{HTTP method} {path}`<br>grpc: `{qualified name}` |

#### Database

> Column names come from profile `database.fields` (defaults datasource / table / shardingRule). When sharding is not involved, fill shardingRule with `none`.

| datasource | table | shardingRule |
|------------|-------|--------------|
| `{datasource}` | `{table_name}` | `{rule_name}` or `none` |

#### Cache

> Write only one "Cache" table. Column names come from profile `cache.fields` (defaults cluster / key / command).

| cluster | key | command |
|---------|-----|---------|
| `{cluster}` | `{key}` | get / set / delete |

#### MQ

> Write only one "MQ" table. Column names come from profile `mq.fields` (defaults cluster / topic / producer).

| cluster | topic | producer |
|---------|-------|----------|
| `{cluster}` | `{topic}` | `{producer}` |

---

### 5. Teardown

> For each submodule below: fill when applicable; delete the entire section when not applicable. Delete this chapter when none of the three submodules apply.

#### Restore Mock (required for Mock scenarios)

> Fill this section only when the case's "1. Prerequisites → Mock" block has content.

| Field | Content |
|------|------|
| **Service name (serviceId)** | `{downstream serviceId}` |
| **API info** | `{qualified name or methodName}` |
| **Restore action** | Pause Mock and restore normal responses |

#### Restore Config service (required when config was changed)

| Field | Content |
|------|------|
| **Config service serviceId** | `{config_service_id}` |
| **Config key** | `{config_key}` |
| **Restore to** | `{original_value}` |

#### Restore test data (required when Steps modified an Entity)

> Identification rule: cases whose Steps cause Entity attribute changes (e.g. status transitions, basic-info updates) must fill this submodule. Pure query cases do not need it.

| Entity | Restore content |
|----------|----------|
| {entityName} | `{field1}`: restore from `{after_value}` to `{original_value}`<br>`{field2}`: restore from `{after_value}` to `{original_value}` |
