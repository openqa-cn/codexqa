# API Request/Response Lookup Spec

**Output**: `usecases/testdocs/api-details.md` (aggregated document of all APIs' fully qualified names and request/response)

**When to run**: After `analysis.md` (§1.1~§1.6) is written, a subagent may start, in parallel with generating `design.md` (§1, §2).

**Input dependencies**:

| Input | Purpose |
|------|------|
| `usecases/testdocs/analysis.md` §1.3 Server APIs table | Extract this service's API list to look up |
| `usecases/testdocs/analysis.md` §1.4 call-chain analysis | Extract new-downstream API list to look up |
| `usecases/testdocs/integrations-resolved.json` | Whether `spec_lookup` uses HTTP; `profile.mockableProtocols` decides the downstream Mock set; `profile.protocols` is the protocol-type enum |
| `.project/context.json` | Determine the code branch under test (optional) |
| `prd/specs/` | Local-contract fallback source |
| `prd/techDocs/` | Fallback source when the contract is missing |
| `code/` | Fallback source for grepping fully qualified names (new downstreams only) |

> ⛔ **Do not hand-write curl / bind a vendor product SDK**. Look up contracts only via:
> ```bash
> node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability spec_lookup --arg "serviceId={serviceId}" --arg "method={methodName}"
> ```
> stdout is a single JSON object. `status=skipped` means the capability is not enabled; go directly to the local path below.

---

## Execution flow

```
Step 0  Read resolution + determine the code branch under test
  ↓
Step 1  Extract the API list to look up (this service + Mockable new downstreams)
  ↓
Step 2  Look up each API in parallel (adapter → local contract → fallback)
  ↓
Step 3  Write api-details.md
```

---

## Step 0: Read resolution + determine the code branch under test

1. Read `usecases/testdocs/integrations-resolved.json`. Note:
   - `capabilities.spec_lookup.enabled` / `provider`
   - `profile.protocols` (legal protocol-type values)
   - `profile.mockableProtocols` (protocols that may enter "New downstream services" and be Mocked; default e.g. `grpc`. Protocols not declared by the enterprise are not Mocked)
2. Read workspace `.project/context.json` and take `targetRepositories[].developBranch`, used to match the corresponding branch under `code/`.
   - If the file is missing, the field is empty, or parse fails → default to the branch already checked out in the current workspace, then fall back to `master`.
   - If `targetRepositories` contains multiple repos, match `developBranch` by the API's owning serviceId; if no match, take the first repo's value.

---

## Step 1: Extract the API list to look up (including new downstreams)

Read the already-written `usecases/testdocs/analysis.md` and assemble the lookup list:

1. **This-service APIs**: extract every row from the §1.3 Server APIs table; each record includes serviceId + API name (methodName) + protocol type (must belong to `profile.protocols`)
2. **New downstream services**: extract new downstream calls from §1.4 call-chain analysis, **only when their protocol type belongs to `profile.mockableProtocols`**. Each record includes: downstream serviceId + downstream API name (methodName) + protocol type. Downstreams not in `mockableProtocols` (commonly a pure HTTP gateway) are not Mocked and are not added to the lookup list.

---

## Step 2: Look up each API in parallel

> APIs have no inter-dependency and may be looked up in parallel; each API independently finishes the flow below and then merges into Step 3. This-service APIs and new downstream services use the same lookup flow; the only difference is output format:
> - **This-service APIs**: record fully qualified name + request example + response example
> - **New downstream services**: record fully qualified name + normal response structure; take the success response from the contract/example; if the contract has no example, construct from field definitions; if still unavailable, extract from the technical design; if still not possible, mark `TBD` and do not block the main flow

### ① Prefer: `call_integration.ts --capability spec_lookup`

Call the adapter for each API to look up (concurrent in the same batch of tool calls; do not wait serially one by one):

```bash
node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability spec_lookup --arg "serviceId={serviceId}" --arg "method={methodName}"
```

Interpret stdout JSON:

| `status` | Handling |
|----------|------|
| `http` | Use `data.qualifiedName` / `data.protocol` / `data.requestExample` / `data.responseExample`; source is `data.source` or "API docs" |
| `local` | `data.paths` gives `prd/specs/` candidate files; open the matching file and extract request/response. If no paths, go to ② |
| `skipped` | Capability not enabled; go directly to ② local contract |
| `error` | If the resolution `fallback` is `local` (default), go to ②; otherwise mark this API `TBD` and do not block the other APIs |

HTTP hit with a complete example → go to Step 3. HTTP hit but missing example → construct a minimal example from the returned field definitions, source "IDL construct". `local` with paths → extract from files per the next section.

### ② Local contract (OpenAPI / IDL / enterprise-owned contract files)

**Step 1: Locate fully qualified name and method**

In `prd/specs/` (and `paths` returned by the adapter), find the contract definition matching serviceId and API name. Prefer exact match (methodName fully equal); if none, then fuzzy match (methodName contains the keyword).

If no match → go to ③ fallback path.

**Step 2: Extract request/response examples**

If the contract file or same-directory examples (`.json` / `.http` / request/response samples in docs) contain a success request and response:

- Take the success request as the request example and the success response as the response example, go to Step 3, source marked "API docs"

**Step 3: Construct from field definitions when no ready example exists**

Use field descriptions in the contract to extract key fields (required fields, enum values, type constraints), construct a minimal usable example, go to Step 3, and mark source as "IDL construct".

### ③ Fallback: when the contract has no result, degrade level by level

When neither the adapter nor `prd/specs/` returned a usable example, try in this priority order:

1. **Scan technical-design documents**: if both a complete fully qualified name (e.g. `com.example.xxx.service.XxxService`) and a request/response demo (JSON example or parameter-description table) are present → go directly to Step 3
2. **Technical design references an API sub-document**: the body contains a reference to a sub-document (local path, "see xxx API docs", or a public URL, etc.); read the sub-document locally or via `web_fetch`, find the complete fully qualified name and request/response demo in the sub-document → go to Step 3
3. **Grep the fully qualified name from the service-under-test code repo** (new downstream APIs only): when all of the above cannot obtain the downstream fully qualified name, grep the downstream methodName in the caller's code repo, locate the import or API reference, and extract the complete fully qualified name; also infer the normal response structure and exception-response scenes from how the caller handles the downstream response (e.g. check code, read the data field); mark source as "code-repo analysis"
4. **None of the above can provide it** → mark source as "TBD (API docs not found, technical design has no complete info)", skip later steps for this API, and do not block the other APIs. **Do not infer a complete fully qualified name and API request/response yourself; you must mark it truthfully and stop filling request/response for this API.**

---

## Step 3: Write api-details.md

After all API lookups finish, write results to `usecases/testdocs/api-details.md` with this document structure:

### Document structure and format

The output file `api-details.md` has two major parts, **Service under test** and **New downstream services**; inside each part, aggregate by serviceId and split sub-sections by API name:

- H1 title: `# API Request/Response Details`
- File header: generation time + lookup branch
- H2 section 1: `## Service under test`
  - One H3 per serviceId (format `### {serviceId}`)
  - One H4 per API (format `#### {methodName}`)
- H2 section 2: `## New downstream services` (omit the whole chapter when there is no new Mockable downstream)
  - One H3 per downstream serviceId (format `### {serviceId}`)
  - One H4 per downstream API (format `#### {methodName}`)
- Separate H2 / H3 with `---`

### Service-under-test API — per-API format (H4)

Each API has its own H4 title (title text is the API methodName), containing:

1. Meta-info list (fully qualified name, source)
2. Request-example `<details>` fold (contains a json code block)
3. Response-example `<details>` fold (contains a json code block)

Separate APIs under the same serviceId with `---`.

**Field notes**:

| Field | Value |
|------|------|
| H4 title | API methodName (e.g. `useCouponSubmit`) |
| Fully qualified name | Complete qualified name; write `TBD` when API docs were not found |
| Source | `API docs` / `IDL construct` / `technical design` / `TBD` |
| Request example | `<details><summary>Request example</summary>` with an embedded json code block |
| Response example | `<details><summary>Response example</summary>` with an embedded json code block |

### New-downstream API — per-API format (H4)

Each downstream API has its own H4 title (title text is the methodName), containing:

1. Meta-info list (caller API, API fully qualified name, call scene, source)
2. Normal-response example `<details>` fold (contains a json code block)

**Field notes**:

| Field | Value |
|------|------|
| H4 title | methodName (e.g. `checkOrderRisk`) |
| Caller API | methodName in this service that initiates the call |
| API fully qualified name | Downstream API complete qualified name; write `TBD` when not found |
| Call scene | Under what business scene this downstream is called |
| Source | `API docs` / `IDL construct` / `technical design` / `code-repo analysis` / `TBD` |
| Normal response example | `<details><summary>Normal response example</summary>` with an embedded json code block |

### Write constraints

- **Keep contract examples complete**: request/response found from API docs or IDL examples must be output as-is and complete; do not omit fields, trim nesting, or simplify in any way
- Request/response content is only engineering-info supplement and **does not replace** business-semantic descriptions already explicit in PRD / technical design; if it conflicts with PRD, Confirm follow PRD and note it in the corresponding API block
- Inside `## Service under test`, order serviceId by appearance in the `analysis.md §1.3` API table; inside the same serviceId, order APIs by appearance
- Inside `## New downstream services`, order serviceId by call order in `analysis.md §1.4` call-chain analysis; inside the same serviceId, order APIs by call order
- APIs with no lookup result must still occupy a slot in the document (mark `TBD`) so downstream consumers can discover the gap

---

## Exit conditions

`usecases/testdocs/api-details.md` has been generated and satisfies:

1. `## Service under test`: every API in the `analysis.md §1.3` Server APIs table has a corresponding H4 section (including fully qualified name + request/response examples, or marked `TBD`)
2. `## New downstream services`: every new downstream identified in `analysis.md §1.4` whose protocol type belongs to `profile.mockableProtocols` has a corresponding H4 section (including fully qualified name + normal response example, or marked `TBD`)
3. Every API has a source marked (API docs / IDL construct / technical design / code-repo analysis / TBD)

---

## Appendix: complete api-details.md example

> The following four-backtick block shows the raw markdown of the output file `api-details.md`. The subagent writes this format directly when generating.

````markdown
# API Request/Response Details

> Generated at: 2024-07-10 14:30
> Lookup branch: feature/coupon-api

---

## Service under test

### com.example.coupon.trade.api

#### useCouponSubmit

- **Fully qualified name**: `com.example.coupon.api.CouponAdminService`
- **Source**: API docs

<details>
<summary>Request example</summary>

```json
[
  {
    "user_id": 10001,
    "uuid": "demo-device-uuid",
    "store_id": 20001,
    "min_order_price": 2000,
    "discount_order_price": 3450,
    "coupon_id": 30001,
    "actCouponSource": "RETAIL",
    "orderPaymentType": "ONLINE",
    "channelType": 2,
    "recipientPhone": "13800000000",
    "bindPhone": "13800000000",
    "totalPrice": 0.0,
    "realPrice": 0.0,
    "firstOrderUser": true,
    "order_view_id": "9000100010001",
    "couponViewId": "demo-coupon-view-id",
    "clientInfo": {
      "clientType": "android",
      "version": "2.4.0",
      "bindPhone": "13800000000"
    },
    "deliveryType": 1,
    "buyMemberOffer": false,
    "delivery_discount_price": 0,
    "delivery_price": 0
  }
]
```

</details>

<details>
<summary>Response example</summary>

```json
{
  "code": 1,
  "msg": "ok",
  "coupon_amount": 100,
  "is_first_order_coupon": false,
  "coupon_display_name": "-¥1",
  "charge_list": [
    {
      "side": 1,
      "actual_amount": 1.0,
      "newSide": 1
    }
  ],
  "real_coupon_id": 4000100010001,
  "coupon_view_id": "demo-coupon-view-id",
  "couponTypeName": "",
  "mutexRule": "",
  "source": "retail",
  "channelId": 10,
  "selected": false,
  "mutexType": 0
}
```

</details>

---

## New downstream services

### com.example.risk.api

#### checkOrderRisk

- **Caller API**: `useCouponSubmit`
- **API fully qualified name**: `com.example.risk.api.OrderRiskService`
- **Call scene**: Before redeeming a coupon, call the risk service to check order risk
- **Source**: API docs

<details>
<summary>Normal response example</summary>

```json
{
  "code": 0,
  "msg": "success",
  "riskLevel": "LOW",
  "pass": true,
  "riskTags": []
}
```

</details>
````
