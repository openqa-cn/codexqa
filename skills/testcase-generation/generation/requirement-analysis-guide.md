# Requirement Analysis Spec

**Output**: `usecases/testdocs/analysis.md` (requirement analysis report)

**Input materials** (read once in phase 1 only; later phases do not reread source documents):

| Material | Required | Purpose |
| -------- | -------- | ------- |
| PRD / requirement docs | Required | Requirement change analysis (§1.2) |
| Technical design | Recommended | Technical implementation analysis (§1.3), call-chain analysis (§1.4), risk identification (§1.5) |
| Knowledge base | Optional | Retrieve engineering info to calibrate the §1.3 engineering-info submodule (Database, Cache, etc.) |

> ⚠️ **Global rule · strikethrough content must not be extracted**: In all input materials (PRD / technical design / requirement docs, etc.), strikethrough-marked content (Markdown `~~text~~`, or `:[del]...[/del]`) means obsolete or deleted requirements. **Do not include it in change analysis, and do not generate any feature points, business rules, or test scenarios from strikethrough content.** This rule applies to the full §1.1~§1.6 flow; skip strikethrough content and do not process it.

**Execution flow**:

```
§1.1 Analysis boundary
§1.2 Requirement change analysis (input basis: PRD / requirement docs)
§1.3 Technical implementation analysis (input basis: technical design / Spec)
§1.4 Call-chain analysis
§1.5 Risk points
§1.6 Technical design vs PRD consistency check (generate only when inconsistencies exist; otherwise delete the whole section)
```

---

### 1.1 Analysis boundary

**Pre-generation actions (must run first, then fill the template below)**:

Step 1 **Domain identification and scope filter**: First identify the **business domain** of this change from the technical design (e.g. coupon platform, order, store, campaign calculation), then use that domain as the scope baseline to filter PRD content: PRD feature points in this domain are in scope; feature points in other domains (e.g. technical design is coupon-platform oriented, while a PRD store minimum-order-price check belongs to the store domain) are excluded in "out of scope" after noting their domain, without expanding feature points or use cases.

Step 2 **Responsibility ownership**: For each capability this change touches (business decisions, persistence, state guarantees, etc.), decide whether it is **implemented at the system under test (this layer)** or **depends on external (downstream service / middleware)**. Rule of thumb: expand verification only for capabilities implemented at this layer; for external capabilities, verify only this layer's interaction with them (correct invocation, degrade on failure), and do not add tests for their internal logic. This avoids indiscriminately testing capabilities that are not this layer's responsibility.

> These conclusions are consumed by later phases: they are the basis for the technical-attribute change-relevance gate in `case-authoring-rules.md §2.3` — capabilities owned externally are not extra-tested for technical attributes at this layer. When ownership is unclear, mark the related judgment `TBD` and register it in the §1.6 consistency check.

**Technical design vs PRD consistency check (runs throughout the analysis phase)**:

While extracting information in §1.2~§1.5, if PRD and technical design contradict each other on the same feature point / business rule / condition branch / numeric value, handle as follows:

1. **Confirm follow PRD**: In analysis.md, adopt the PRD description as official content; do not include the contradictory technical-design description as a feature point or business rule
2. **Mark the inconsistency**: After analysis.md §1.5, generate §1.6 and record each conflict (format in the §1.6 template); the "Impact scope" field must precisely mark the sections and item IDs in the current step that were affected by adopting PRD (e.g. §1.2 C-3, a §1.3 API), so later user adjudication can correct them precisely
3. **Do not self-adjudicate**: Do not override PRD because "the technical design looks more reasonable"; even if the technical design seems more accurate, still Confirm follow PRD and mark it, and let the user adjudicate in the human-confirm step

```
## Analysis boundary
- This change's business domain: {identified from technical design, e.g. "coupon platform", used as the baseline to filter later feature points}
- Responsibility ownership: {list each capability this change touches, marked "implemented at this layer" or "depends on external (name the downstream/middleware)"; for external ones this layer only verifies interaction and degrade, and does not add internal-logic tests}
- In scope: involved services / APIs / ends (server / client / H5), covered test types
- Out of scope: systems not involved and why, items not done now but possibly later; note PRD feature points that are not in this business direction
- Dependency assumptions: whether external dependencies are Mocked, test-env state, base-data prerequisites
```

---

### 1.2 Requirement change analysis

> **Input basis**: PRD / requirement docs.
>
> **Positioning**: This section is the PRD-view **change-backbone index**. It splits PRD-described changes into minimum-granularity change points; later sections expand around those change points so every change has test coverage. This chapter only describes user/business-perceivable changes and constraints (changed features, expected behavior, and the business rules they follow). It does not describe technical implementation (APIs, fields, middleware, etc. go to §1.3).

**Extraction principles**:

- Do not compress paragraphs, do not replace original text with summaries, write numbers and conditions in full, keep if/else in pairs, keep terms consistent with the source
- When materials describe multiple objects, combined conditions, overall state, or daily/expiry time semantics, do not invent new rule types; still record them under existing types, but you must write the full "condition combination → observable result". Only when different conditions lead to different results should later design split scenarios. When time semantics do not state the result after a period switch, mark `TBD (period boundary unspecified)`; do not assume cross-day reset, expiry flip, or period refresh. Register §1.6 only when PRD and technical design conflict on that result
- When this change adds or extends an enum value, and the technical design, API definition, or existing knowledge shows the field already has other values that share the same decision entry this change reaches, acceptance rules must record both: the target behavior of the new value, and the keep-or-isolate behavior of at least one evidenced existing value. If existing values or expected results cannot be determined, mark `TBD`; do not invent a full business-line enumeration
- Concrete copy in the PRD (Toast, dialog copy, error tips, status copy, etc.) and error codes must be kept verbatim; do not replace them with summaries such as "show success" / "show failure"
- **Extract only feature points inside the §1.1 business-direction scope; content outside that scope must not be listed**

**Split method**: Split by feature point — one feature point may yield multiple change points (e.g. "support batch issueCoupon" can split into: support issuing multiple coupons at once, a per-call quantity cap, and a tip when the cap is exceeded).

**Split granularity**: Each change point should be a **independently verifiable** minimum change unit. Criterion: can you write at least one explicit test assertion for this change point? If not, the grain is too coarse and you must keep splitting.

**Output format**: Group by owning module; one table per module; each row is one change point.

**Template** (one table per module, output in this structure):

```
#### {module name}

| Change point ID | Change content | Acceptance rules |
| --------------- | -------------- | ---------------- |
| C-{n} | {what feature this change point changed} | {1. acceptance rule 1<br>2. acceptance rule 2<br>...} |
```

**Example**:

#### Module A: member-discount flag configuration (ops console)

| Change point ID | Change content | Acceptance rules |
| --------------- | -------------- | ---------------- |
| C-1 | Ops-console coupon config adds a "member discount" ops scene; a coupon can be tagged with the member-discount flag | 1. Only accounts with the "member-discount ops" permission can set ops scene = member discount; otherwise save fails and shows "Only "member-discount ops" can configure member-discount coupons; contact an admin to grant permission"<br>2. When creating a coupon, the "ops scene" field defaults to empty<br>3. This release only allows a specified coupon type (coupon type id=66) to configure member discount; configuring member discount on other coupon types fails save and shows "Member-discount coupons must be limited to the specified coupon type; please change!"<br>4. Bonus channel and points channel do not support ops scene = member discount; configuring it fails save and shows "This channel type cannot set ops scene = member discount; please change" |
| C-2 | Member-discount flag inheritance rules in the coupon-upgrade scene | 1. When the pre-upgrade coupon ops scene = member discount, the post-upgrade coupon inherits the member-discount flag (no distinction between base coupon / discount coupon)<br>2. When ops scene = member discount, upgrade logic is inherit; the specified-campaign scene is retired; third-party viral entry is mutually exclusive with coupon upgrade |

#### Module B: store available-coupon recall

| Change point ID | Change content | Acceptance rules |
| --------------- | -------------- | ---------------- |
| C-3 | Return the user's available account coupons by store storeId (exclude bonus coupons, exclude pre-issue coupons); after filtering unavailable coupons, expose the full remaining set | 1. Service-area limit: filter coupons whose service area is not included; merchant 0-stock coupons are filtered by the merchant<br>2. Use-channel limit: when a coupon limits use channel, recall only if the upstream channel matches the coupon config; when the coupon does not limit channel, recall directly; do not recall when the channel mismatches or is omitted<br>3. Coupon-city / customization conditions: do not recall the coupon when the current location mismatches the coupon city or location cannot be obtained<br>4. Target audience and first-order limits: do not recall the coupon when the current user does not satisfy them<br>5. Coupon synergy: do not recall the coupon when the user's same-day synergy coupon count has reached the cap<br>6. Return an empty list when the user ID does not exist; return empty when the store/SKU has no available specified coupons |
| C-4 | Client display rules for the member-discount badge | 1. When coupon ops scene = member discount and the user is gold/silver, show the "Gold exclusive" or "Silver exclusive" badge; copy follows the membership-tier mapping<br>2. Do not show the exclusive badge when coupon ops scene ≠ member discount<br>3. When the user has not reached the matching membership tier, or after a downgrade no longer satisfies gold/silver, do not show the discount-coupon badge |

**Acceptance-rule type reference** (prompt card; check each change point to avoid writing only happy-path rules and missing boundary/state/exception rules):

| Rule type | Extraction focus |
| --------- | ---------------- |
| Condition branch | What behavior is triggered and what result is given under different conditions |
| Effective scope | When "only effective for X business line/type/scene" appears, record the target value and the other known enum values, and make clear that the target value takes the new logic while the rest take existing/exclude logic |
| State machine | All states of the business object, legal transitions, and irreversible constraints |
| Calculation logic | Amount/quantity calculation basis, precision, rounding rules |
| Input limits | Requiredness, value range, and validity constraints of user inputs |
| Display content | New or changed display info on pages/lists, empty-value display, copy / tips / dialogs / badges / display count / sort display, etc. |
| Permission control | Visibility or operability scope of roles / allowlists / gray release / experiment groups |
| Quantity limits | Frequency / quota / cap / time window |
| Cross-layer constraints | When the same business rule affects UI, API contract, or server execution constraints at the same time, record each layer's observable acceptance rules separately; page display, API fields/error codes, and server persistence/intercept cannot substitute for each other |

> **Completeness check**:
> - A change point's "Acceptance rules" must not be empty — if the PRD truly has no explicit rule for that change, fill `TBD (PRD unspecified)` and register it in the §1.6 consistency check
> - User-visible copy and error codes in acceptance rules must be recorded in quotes verbatim; that verbatim text is the assertion basis for case expected results

---

### 1.3 Technical implementation analysis

> **Input basis**: Technical design / Spec.
>
> **Positioning**: Extract the technical-implementation view of this change from the technical design, including which APIs implement the change, how request/response change, how implementation logic is adjusted, and which middleware is involved. This chapter only describes how the change is implemented, complementary to §1.2: §1.2 defines the business content of the change; §1.3 defines the technical implementation.

**Pre-generation action — impact-surface inference (must run first, then fill API info)**:

> ⚠️ **This step is a generation-process instruction, not output content.** Inference results only guide filling the "Server APIs" and other submodules below. The final `analysis.md` **must not contain** an "impact-surface inference" heading, the inference process, or a listing of the four inference conclusions; affected APIs should appear directly in the "Server APIs" table.

This step avoids identifying only the surface APIs the change directly touches while missing implicitly affected APIs. For each change point in §1.2, run the following inference:

1. **Forward spread**: Which APIs does this change point directly involve? (Not only new APIs, but also existing APIs whose request/response/logic must change because of this change)
2. **Upstream/downstream propagation**: Do callers and callees of these APIs need coordinated changes because of request-structure, response-field, or semantic changes?
3. **Data-model cascade**: Does this change point cause table-structure changes, field-semantic changes, or state-machine extensions? If yes, every API that reads/writes that table/field may be affected
4. **Config/switch cascade**: Is a new Config service or Experiment grouping introduced? If yes, every API affected by that config must be included

**Output format**:

```
1.3 Technical implementation analysis
├─ env: {env}
├─ lane: {lane}
├─ Server APIs
│   ├─ Module A
│   │   ├─ API 1 (per-interface vertical table)
│   │   ├─ API 2 (per-interface vertical table)
│   │   └─ ...
│   ├─ Module B
│   │   └─ ...
├─ Engineering info (Database, Cache, MQ, Config/switch, Experiment, etc.)
└─ Client (pages, tracking)
```

> Test-env info must call the adapter; do not guess fields:
> ```bash
> node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability env_info
> ```
> Use returned `data.env` / `data.lane`. If `status=skipped` or empty, then read `testPlan` from `.project/context.json`; if still none, use an empty string.

> ⚠️ **Global constraint: read `usecases/testdocs/integrations-resolved.json` first.** Engineering subtables render only components and fields declared by `profile.components` (default one table each: Database / Cache / MQ / Config service / Experiment). API types may only be `profile.protocols` (default `http` / `grpc`). All field values must come from explicit source-material records or adapter backfill; inference is forbidden; fields not mentioned in source materials are always `TBD`. Do not use middleware fields not declared by the profile (including hard-coded Redis / KV store / Thrift split tables). If an enterprise needs Thrift, it must add it to `protocols` itself.

#### Server APIs

Group by module; one vertical table per API (dimension | Content). **Output every dimension row; do not add or delete rows.** When a dimension has no change this time, fill the Content column with `none`; do not omit the row.

**Template** (output each API in this fixed structure, all seven dimension rows present):

```
**`{Service}.{method}` ({API name/description})**

| Dimension | Content |
| --------- | ------- |
| serviceId | {serviceId of the service that owns this API} |
| Protocol type | {from profile.protocols, default http / grpc} |
| Change type | {new / modified / deprecated / cascade / existing} |
| Related change points | {change-point IDs this API carries, e.g. C-1, C-3; separate multiple with commas; fill `none` when there is no corresponding change point (e.g. an existing API registered only for call-chain completeness). Only APIs whose "Related change points" is not `none` and whose change type is new/modified/cascade are current-change APIs and enter the local knowledge-base `changed-interface-knowledge` recall set; existing APIs do not enter} |
| Request change | {fields added/removed/type-changed/validation-changed, plus notes; fill `none` when there is no request change} |
| Response change | {fields added/removed/structure-changed/field-semantics-changed, plus notes; fill `none` when there is no response change} |
| Implementation logic | {notes on branch-condition / calculation-rule / state-transition / middleware-interaction changes; fill `none` when there is no logic change} |
```

> **Allowed values for "Change type"**: new / modified / deprecated / cascade (needs coordinated adjustment because another API changed) / existing (no change this time; registered only for call-chain completeness).

**Fill requirements**:

- **Write each dimension as items; do not summarize in one sentence**: request / response / implementation-logic must each state the changed fields/logic and the post-change expected state; do not replace them with vague phrases such as "adjusted" or "optimized".
- **"Related change points" is the source of "change point → API" traceability**: this field builds an explicit bidirectional mapping between §1.2 change points and this API, for design.md §1 "Covered APIs" and phase-2 case expansion to read directly, so downstream does not infer by reverse-looking up §1.2/§1.3. Fill requirements:
  - Register each C-x because of which this API was added or modified; one API may relate to multiple change points, and one change point may be carried by multiple APIs (record the many-to-many relation as fact).
  - For existing APIs registered only for call-chain completeness with no change this time, fill `none`; such APIs are not current-change APIs, do not enter the local knowledge-base `changed-interface-knowledge` recall set, and must not be included just because the name, module, or call path is similar.
  - **Closed-loop check**: every §1.2 change point that has an API carrier (i.e. not a pure engineering change point) must appear in some API's "Related change points"; if missing, go back to §1.3 and complete that field on the corresponding API.
- **New APIs**: change type is `new`; request / response / implementation logic still need key points (core request fields, key returns, main-flow logic); do not only write "new API".
- **Cascade**: change type is `cascade`, and the corresponding dimension must state "because of YY change on XX API, this API must cascade-change ZZ", naming the upstream trigger; "Related change points" registers the change-point IDs that triggered this cascade. Cascade APIs are current-change APIs and must enter the local knowledge-base `changed-interface-knowledge` recall set.
- **Do not fabricate API rows for pure engineering change points**: if a change point is implemented only by adjusting engineering components such as Config service / Database / Cache / MQ / Experiment, and does not change any API signature, request, response, or implementation logic (i.e. no real API carries the change), **do not** create a vertical table for it in "Server APIs" (a fake API such as "Protocol type = none (Config service change)" is a violation). Register that change point directly in the matching "Engineering info" submodule below (Config/switch, Database, etc.); its "change point → API" trace may be empty (the engineering-info submodule carries the trace).

**Example**:

##### Module A: store coupon query

**`CouponQueryService.queryStoreCoupons` (query store available coupons, reuse generic query API)**

| Dimension | Content |
| --------- | ------- |
| serviceId | coupon-query |
| Protocol type | grpc |
| Change type | modified (reuse and extend) |
| Related change points | C-3, C-4 |
| Request change | `CouponQueryRequest` adds enum values `MEMBER_ONLINE_COUPON = 7` (member coupon-online), `MEMBER_STORE_COUPON = 8` (member coupon-in person); request: user id, store id, clientType, scene value |
| Response change | `CouponInfo.offerAttrs` exposes offer-attribute JSON, including `offerAttrs["scene"]="member_discount"` → ops scene = member discount; returns coupon name, threshold, face value, validity, fulfillment channel |
| Implementation logic | 1. Add strategy classes `OnlineMemberCouponStrategy`, `StorefrontMemberCouponStrategy`<br>2. Reuse parent `queryInventoryServices` (service-area + inventory RPC) and `filterAvailableCoupons` (availability check)<br>3. Recall the full set of valid specified coupons (coupon template = partnership campaign, unused, not expired, paid); no sort, no truncate; caller sorts |

#### Engineering info (fill when present)

> Submodules marked "always fill" must be filled every time; submodules marked "fill when present" are filled only when this change involves them; delete unused submodules entirely.

> **Render rule**: one table per `profile.components[]`, header = that component's `fields` (default profile below). When an enterprise adds/removes components or renames fields, change headers per the resolution file; do not reuse this section's example column names. If `experiment` is not enabled (the component is absent from the resolution, or `experiment_lookup` is not enabled and source materials do not mention Experiment), the whole section does not appear.

**Database (fill when present)**:

> **Fill decision**: fill this submodule when source materials contain Database-related description, including but not limited to: explicit table names (e.g. `coupon_config`), natural-language operation descriptions (e.g. "write coupon-instance records", "update config status", "query user coupon list"). Skip if there is no Database-related description at all.
>
> Each table needs a purpose note (e.g. "order master table", "coupon instance table", "operation journal table") so later case design can understand each table's duty and relations. If sharding is not involved, `shardingRule` is `none`. If source materials only give a table name and no datasource, you may call `middleware_lookup` (`--arg kind=database`) to backfill; if not enabled, fill `TBD`.

| datasource | table | shardingRule |
|------------|-------|--------------|
| `{datasource_name}` | `{table_name}` ({purpose note}), key fields: `{field}` | `{rule_name}` or `none` |

**Cache (fill when present)**:

> Write **one** "Cache" table only (do not split into Redis / KV store). Note the cache purpose and which API/table it relates to. Column names come from profile `cache.fields`.

| cluster | key | command |
|---------|-----|---------|
| `{cluster}` | `{key}` ({purpose note}) | get / set / delete |

**MQ (fill when present)**:

> Write **one** "MQ" table only. Note the message purpose and what scene triggers send. Column names come from profile `mq.fields`.

| cluster | topic | producer |
|---------|-------|----------|
| `{cluster}` | `{topic}` ({purpose note}) | `{producer}` |

**Config/switch (fill when present)**:

> Note the switch purpose (e.g. "new-path gray-release switch", "degrade fallback switch") and the behavior when on vs off. Column names come from profile `config.fields`. If source materials already wrote the key, you may call `config_lookup` to backfill value; do not actively discover new switches when no key was written.

| serviceId | key | value |
|-----------|-----|-------|
| `{config_service_id}` | `{config_key}` ({purpose note}) | `{config_value}` (on: {behavior}; off: {behavior}) |

> ⚠️ **Ownership check**: Config service serviceId must match the serviceId of the "Server APIs" on this row. Switches of other services mentioned in the technical design (e.g. upstream gray-release switches, downstream degrade switches) must not be filled into this table; note the dependency in §1.4 call-chain analysis.

**Experiment (fill when present)**:

> Fill when the profile contains `experiment` and this change involves gray release / AB; otherwise the whole section does not appear. Column names come from profile `experiment.fields`. If source materials already wrote experimentKey, you may call `experiment_lookup` to backfill groups.

| experimentKey | groups |
|---------------|--------|
| `{experiment_key}` ({experiment purpose}) | Control group: `{control-group config}` ({behavior}); experiment group: `{experiment-group config}` ({behavior}) |

#### Client

**Pages (always fill; for pure server changes note "no client change")**:

| Page name | Entry path | Core interaction points | Related change points | Related Server APIs |
| --------- | ---------- | ----------------------- | --------------------- | ------------------- |
| (example) Cart checkout page | Home → Cart → Checkout | Coupon list display, select | C-1, C-2 | queryRecommendCoupons |

> The following also count as client changes and must register a corresponding page row: error-tip copy changes, new list-field display, new dialog / Toast — such descriptions are often scattered in the PRD body and do not appear as a "new page".

**Tracking info (fill when present)**:

| Field | Content |
| ----- | ------- |
| Trigger condition | `{e.g.: fire after the page main content finishes rendering}` |
| Trigger count | `{e.g.: fire once per page enter; do not re-report during the same stay}` |
| Latency requirement | `{e.g.: report within ≤ 500ms after the page becomes visible}` |
| Replay mechanism | `{e.g.: cache locally when offline, auto-replay after network recovers}` |
| Report params | `event`(String, required): `{event_name}`<br>`{param}`({type}, required/optional): {expected value} |

---

> ⚠️ **The following is a generation-process instruction (engineering-info calibration), not an output chapter.** Calibration results must be written back directly into the matching submodule tables above (Database/Cache/MQ/Config). The final `analysis.md` **must not contain** an "engineering-info calibration" chapter, heading, or any calibration-process notes.

**Engineering-info calibration** (run when a knowledge-base path was passed in, or the matching lookup is enabled in the resolution; skip if neither):

> **Prefer the adapter**; do not hand-write curl:
> ```bash
> node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability knowledge_search --arg "query={keyword}" --arg "knowledgePath={knowledgePath}"
> node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability middleware_lookup --arg "kind=database|cache|mq" --arg "serviceId={serviceId}" --arg "hint={existing identifier or natural language}"
> node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability config_lookup --arg "serviceId={serviceId}" --arg "key={existing key}"
> node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability experiment_lookup --arg "experimentKey={existing key}"
> ```
> When `status=skipped` / `error` and `fallback=local`, then use `knowledge_search` local hits or grep `cachePath`. `config_lookup` / `middleware_lookup` / `experiment_lookup` **backfill only when source materials already wrote the key / component**; do not actively discover new components.
>
> **Search across all passed-in knowledge bases**: the input is the full set of knowledge bases available this time; filter relevant ones per library, do not read whole documents, and take only **engineering info** (fields declared by `profile.components[].fields`).
> - **Take keywords**: use already-registered §1.3 engineering operations/components as keywords — if a concrete identifier already exists, use that identifier; if there is only a natural-language description (e.g. "write coupon-instance records"), match by operation semantics.
> - **Search per library**: call `knowledge_search` or grep `cachePath` with this keyword set; a hit library is relevant — read the hit paragraphs to complete engineering identifiers; a library with no hits is irrelevant — skip and do not read. Fields that may be completed follow that component's `fields` in the resolution.

> **When to run**: after the initial fill of all §1.3 submodules, run this calibration once to complete `TBD` items and missing details in each submodule.

**Calibration scope** (default profile; if the enterprise changed fields, follow the resolution):

| Submodule | Match method | Fields that may be completed |
|-----------|--------------|------------------------------|
| Database | Search table name when a concrete table name exists; otherwise match by operation semantics | datasource, table, shardingRule |
| Cache | Search cluster / key, or match by business-operation semantics | cluster, key, command |
| MQ | Search topic / cluster / producer, or match by message-scene semantics | cluster, topic, producer |
| Config/switch | Search config key (the key must already appear in source materials) | serviceId, key, value |
| Experiment | Search experimentKey (must already appear in source materials) | experimentKey, groups |

**Calibration rules**:
1. **Completion scope**: only complete info for engineering operations already described in source materials; do not "discover" operations or components that source materials did not involve from the knowledge base
2. **Conflict handling**: if knowledge-base info contradicts the technical design, follow the technical design and do not overwrite
3. **Multi-file handling**: multiple passed-in knowledge-base files may each contain engineering info (e.g. DB and Cache recorded separately); search each file and merge results
4. **Write back / update in the original format**: calibrated info must be written back or updated in the original table format of the matching §1.3 submodule — keep submodule table structure, field names, and placeholder writing conventions unchanged; only replace missing or `TBD` field values with calibration results; do not add extra-table fields or change headers
5. **Remove TBD after successful completion**: after a §1.3 submodule field is successfully completed to a definite value, replace the original `TBD` in that cell with the calibration result; keep `TBD` only for fields still undetermined after calibration

> ⛔ **No-divergence principle**: do not actively introduce engineering components that source materials did not involve (e.g. do not complete Cache if no cache operation was mentioned; do not complete MQ if MQ was not mentioned). The knowledge base is only for "source-described operation → complete engineering details", not for "discover new engineering interactions".

---

### 1.4 Call-chain analysis

**API call chain**:

| Step | Caller | Caller API | Callee | Callee API | Change type | Key params | Failure impact |
| ---- | ------ | ---------- | ------ | ---------- | ----------- | ---------- | -------------- |
| 1    | Client | (if any, fill the caller API) | Gateway | POST /api/xxx | new | userId | Whole-chain blocked |

> **Change type**: `new` (a call relation added this time) / `modified` (an existing call that changed this time, e.g. a new request field or a changed call condition) / `existing` (unchanged; registered for call-chain completeness). The API-lookup phase extracts downstreams whose change type is "new" or "modified" and whose protocol type belongs to `profile.mockableProtocols` as APIs to look up. `existing` call relations are only for call-chain completeness display; they are not current-change APIs and do not enter the local knowledge-base `changed-interface-knowledge` recall set. The recall set is based on §1.3 APIs whose "Related change points" is not `none` and whose change type is new/modified/cascade.

**New downstream services (fill when this change adds downstream calls)**:

> Record only downstream calls that are **new** in this change and whose protocol type belongs to `profile.mockableProtocols` (default e.g. `grpc`). Existing downstreams are not registered in this table. Downstreams not in `mockableProtocols` are not Mocked and need not be registered. This table is used in phase 2 when designing downstream-exception cases (Mock construction basis).

| Caller service (serviceId) | Caller API | Downstream service name (serviceId) | Downstream protocol type | Downstream API info | Call-scene notes |
| -------------------------- | ---------- | ----------------------------------- | ------------------------ | ------------------- | ---------------- |
| `{this service serviceId}` | `{this service methodName}` | `{downstream serviceId}` | {from mockableProtocols} | `{qualified name or method path}` | {under what scene it is called, e.g. "query user coupon list"} |

**Data flow**: request source → processing logic → persisted fields → later consumers (MQ / downstream services). When the same business field appears in both the write stage and the read / fulfill / validate stage of the chain, register its cross-stage consistency constraints: behavior when consistent, behavior when inconsistent, and whether it is affected by degrade/gray-release switches.

**Exception chains** (for high risk, design an independent case for each exception type):

| Exception type | Scene description | Expected behavior |
| -------------- | ----------------- | ----------------- |
| Downstream timeout | Depended service response times out | Circuit break / degrade / alert |
| Concurrency conflict | The same resource is written concurrently | Optimistic-lock retry or reject |
| Distributed transaction | Cross-service operation partly succeeds and partly fails | Transaction rollback or compensation task fires |
| Message consume exception | MQ message format exception / duplicate consume | Idempotent handling / dead-letter queue |
| Multi-effective-point switch inconsistency | The same business semantics are controlled by multiple serviceId or config switches, and state combinations are inconsistent | Explicit fallback, whole-chain degrade, or each API's actual behavior |

---

### 1.5 Risk points

| #  | Risk description | Impact scope | Risk API/logic | Risk level |
| -- | ---------------- | ------------ | -------------- | ---------- |
| R1 | Distributed-transaction consistency | Order+asset | `createOrder` → `deductAsset` cross-service call | High |

> **"Risk API/logic" fill rule**: must be precise to a concrete API name or code-logic location (e.g. the transaction-commit logic of the `createOrder` API); do not write only a module name. This column helps case design quickly locate the concrete API that needs exception construction.

> Prefer identifying these risk types: concurrency conflict, distributed transaction, idempotency, unauthorized state transition, gray-release / Experiment group boundary, degrade behavior, MQ message reliability.

---

### 1.6 Technical design vs PRD consistency check

> ⚠️ This is a conditional section: if no technical-design vs PRD inconsistency is found, delete the whole section.

| #  | Inconsistency description | PRD original/semantics | Technical-design original/semantics | Adopted conclusion (default Confirm follow PRD) | Impact scope (affected sections + item IDs) |
| -- | ------------------------- | ---------------------- | ----------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| D1 | (example) refund window | Refundable within 48h | Refundable within 24h | Confirm follow PRD: 48h | §1.2 C-3, a §1.3 API implementation logic |

- **§1.2 ↔ §1.3 bidirectional trace check**: every §1.2 business change point should have a corresponding technical-implementation landing in §1.3; business-related implementation changes in §1.3 should also trace back to a corresponding §1.2 change point. When the two sides cannot correspond, first rule out extraction omission, then decide whether it is an inconsistency, in this order:
  1. **Check source materials**: inability to correspond is not the same as inconsistency; it may also come from omission in the §1.2 / §1.3 extraction phase. Go back to PRD / technical design and check whether the corresponding content actually exists.
  2. **If it is an extraction omission, complete the corresponding section**: if the source materials do contain the corresponding content and only the current section failed to record it (e.g. §1.3 did not add the API for a change point, or §1.2 did not extract the business change point for an API), complete the corresponding section and do not register it in this table.
  3. **If still unable to correspond after ruling out omission, register as inconsistency**: only when it is confirmed that the source materials themselves are missing (PRD has a business ask but technical design has no corresponding implementation, or technical design has a change but PRD has no corresponding business source) should it be registered in this table. "Impact scope" must mark the concrete items that cannot correspond (e.g. §1.2 C-3 has no corresponding implementation in the technical design; a §1.3 API has no corresponding business source in the PRD).
- **Output rule**: record the adopted conclusion Confirm follow PRD; the "Impact scope" field must precisely mark which items in which sections of analysis.md / design.md this inconsistency affects, so the user can correct them precisely after adjudication.
- **Back-correction rule**: when the user adjudicates "Item N follow technical design", you must walk "Impact scope" and back-correct every affected section in analysis.md / design.md (change content, acceptance rules, API implementation logic, chain params, risk judgment, test points, etc.) so they match the technical design. Do not only update the §1.6 table and miss upstream linked corrections.
- **Delete rule**: if the user confirms all inconsistencies are resolved (i.e. the table is empty), delete the entire §1.6 section.
