# Test data construction: principles

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`testdata-generation`](README.md) does not ship a model. It is routing plus scripts on the host agent: the model chooses a path and extracts parameters you already gave; what lands in the backend is an executor / published tool / generated script calling that backend.

**Inputs are not application source.** You bring a construct request, written cases, and/or an API source (OpenAPI / `planId` / `serviceId`). The skill does not read `code/` to invent table names or IDs. See [README — What you give it](README.md#what-you-give-it).

Agents read [`SKILL.md`](SKILL.md), not this page. Command-level detail is in the [operator appendix](#operator-appendix) below. Gaps: [Known limitations](KNOWN_LIMITATIONS.md). Sample write-back: [preview](https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testdata-writeback.html).

## Problem

Asking a model to “create a catalog order” typically fails in three ways:

| Failure | Symptom | Constraint |
|---|---|---|
| Invent IDs in chat | The reply writes `productId=p_99`; the backend never created it | Success = an ID the backend returned; core IDs the user already gave must not be rewritten |
| Guess endpoints | No OpenAPI / `planId`, yet a script that “looks runnable” appears | Missing an API source: stop and ask for materials; do not invent endpoints |
| Commands in the case | `case-executable.md` contains `node`, ports, or `skillRoot` | Write-back is business fields only; call details stay in `manifest.json` |

The model routes and extracts. Persist, bind, and write-back stay in scripts so a later run can produce the same manifest.

## Evaluation status

No public fixture, no answer key, no recorded number comparable to the defect-detection inventory-service 7/7. Local checks cover search, the mock executor, packing, and pipeline scenario scripts — **not** a full host-agent evaluation. Treat “a demo ID came back” as the intended design, not as proof that a production gateway was exercised. See [Known limitations](KNOWN_LIMITATIONS.md).

## What you will see

| When | Shown | Your reply |
|---|---|---|
| Missing prerequisite (case pack / OpenAPI / cross-domain upstream ID) | Ask only for that one item, not defaultable fields such as `quantity` or `rate` | Supply the material; the run continues |
| One local slot matches | Construct immediately and name the skill used | Usually nothing |
| Several plausible matches, or a new skill must be installed | Candidate list | Pick one, or say none of them |
| Construct succeeded | Business fields + which path ran + mock called out when it was used | Optional: pin the skill, publish the script as a tool |
| Case-material job finished | `case-executable.md` (business fields only) | Check which `DATA_BUILD_API_BASE` those IDs came from |

Default backend is the local mock (`http://127.0.0.1:8765`). Mock `p_1` and a staging-gateway ID can look the same. Confirm the base URL before trusting write-back.

## Mechanisms

### 1. Route first, then fall back

Case-material requests (prepare test data, write back preconditions) go through `pipeline.ts` and **do not** run the four generic steps. Everything else, in order: pinned / proven methods → domain slot → tool registry → API catalog → write a script from the template. The first hit stops.

### 2. The model does not write data

The decision tree only chooses a path. HTTP is sent by an executor or `callHttp`. Without a backend response, the reply must not “generate” a business primary key.

### 3. Slots are pluggable domain packs

`slots/catalog` and `slots/distribution` are examples, not hardcoded company knowledge. New domain: OpenAPI → `slot-scaffolder` → implement stubs → `scenes` in `slot.yaml`. Search, OpenAPI index, and case-pipeline bind share `slots/` + `workspace.slot_roots`. There is no second registry.

### 4. Keywords must be business nouns

`--keywords` takes 1–2 domain nouns from the request (the bundled demo uses `catalog`). Verb phrases such as “help me construct” degrade to a full scan. Put those nouns in the `slot.yaml` `description`; do not lead with boilerplate.

## Pipeline

```text
Natural language / cases / OpenAPI
        │
        ▼
  Case materials? ──yes──► pipeline.ts (parse → construct → write-back)
        │no
        ▼
  Search slot / proven method / tool
        │none
        ▼
  API catalog (planId / serviceId / keyword)
        │still none
        ▼
  Have an API source → write ./testdata/<name>.ts and run it locally
  Do not → stop, ask for materials
```

One-shot construct prints IDs in the chat. Case materials write `testdata/case-materials/{case-id}/case-executable.md`.

## Further reading

| Topic | Doc |
|---|---|
| What to bring, install, quick start | [README](README.md) |
| Observed failures and boundaries | [Known limitations](KNOWN_LIMITATIONS.md) |
| Agent runtime contract | [`SKILL.md`](SKILL.md) |
| Commands, report payloads, install, troubleshooting | [Operator appendix](#operator-appendix) below |
| What each published skill takes | [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md) |

---

# Operator appendix

Install paths, commands, adapter tables, and troubleshooting. Agents still should not load this file — use [`SKILL.md`](SKILL.md) and, when that file says so, [references/workflow.md](references/workflow.md).

| Name | Meaning |
|---|---|
| Source directory | `testdata-generation/` |
| Install directory / skill name | `testdata-generation/` (must match the `name` in `SKILL.md`) |
| `SKILL_DIR` | Directory that contains this skill’s `SKILL.md` (source tree or `~/.cursor/skills/testdata-generation`) |
| Runtime | Node 22+ (`node script.ts`). No runtime npm dependencies |

## Appendix: architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Decision layer  SKILL.md                                  │
│    Case materials? → else search → tool → API → script      │
├─────────────────────────────────────────────────────────────┤
│ 2. Orchestration (case materials only)                       │
│    pipeline.ts state machine                                 │
│    LLM whitelist: parse-case / knowledge-build / select-tool │
│    Scripts do construct + bind + slot_render writeback       │
├─────────────────────────────────────────────────────────────┤
│ 3. Capability layer  unified slot discovery                  │
│    pack slots/ + skill slots/ + workspace.slot_roots         │
│    (+ optional marketplace.paths union)                      │
│    Each slot: slot.yaml (or inferred) + executors + OpenAPI  │
├─────────────────────────────────────────────────────────────┤
│ 4. Adapter layer  scripts/adapters/                          │
│    Local files by default; type: http hits the enterprise    │
│    gateway. Decision tree does not change.                   │
├─────────────────────────────────────────────────────────────┤
│ 5. Persist layer  mock or DATA_BUILD_API_BASE                │
│    demo: testdata/mock-store.json                            │
└─────────────────────────────────────────────────────────────┘
```

Config lookup order: `$DATA_BUILD_CONFIG` → `./testdata/config.yaml` → `~/.testdata/config.yaml`.
Example: [assets/config.example.yaml](assets/config.example.yaml).

After install, pin the paths first:

```bash
SKILL_DIR="<directory of this SKILL.md>"
```

### Unified slot discovery

Marketplace search, OpenAPI indexing, case-pipeline binding, and executor allowlists all read the same list (`scripts/adapters/slot_roots.ts`):

1. Pack `slots/`
2. Skill `slots/`
3. `workspace.slot_roots` (the only extra knob for company skills outside the pack)
4. Optional `adapters.skill_marketplace.paths` (union; not required for a new scene)

Drop a folder that has `slot.yaml` and/or `SKILL.md` into one of those roots. There is **no second registration list**. Do not edit `select_tool.ts` and do not add `api_catalog.paths` just to index a slot’s OpenAPI — `assets/openapi/` is picked up automatically.

If `slot.yaml` is missing, entities are inferred from `scripts/executors/*` and `assets/openapi` operationIds. Add `slot.yaml` when you need scenes or aliases. List more specific entities **before** generic ones.

## Appendix: decision tree

After receiving a request, **first** decide whether it is a case-material job. On a hit, load [references/case-data-material-planner/SKILL.md](references/case-data-material-planner/SKILL.md), run `scripts/pipeline.ts`, and **do not run the generic four steps**. Construction, binding, and writeback are stages inside that script, not Agents.

Example trigger phrases: case data / case materials / write back test data / test material list / prepare test data.

All other requests:

```
Step 1  search_data_build.ts
       pinned (favorites; Agent judges relevance from description)
         → proven (verified methods: semantic alignment + tool reachable + params satisfiable)
         → skill (one local clear match: load; several / weak / needs install: ask)
       On a hit, delegate execution and stop

Step 2  tool_registry: search existing tools from at least two natural-language angles
       One clear tool (or a user-supplied id) → query inputs → fill params → execute
       Several or weak matches → ask first

Step 3  api_catalog
       Method A: when planId exists, query test-plan change APIs
       Method B: if serviceId exists, list APIs by service; otherwise search by a single keyword
       Slot OpenAPI under assets/openapi/ is already indexed via slot_roots

Step 4  Write ./testdata/<name>.ts from references/script-template.ts
       After a successful local run, ask whether to publish to the tool registry
```

Success follow-up (non-blocking; a failure must not hide data that was already constructed):

| Path | Follow-up |
|---|---|
| Step 1 proven ran successfully | **feedback only; do not report again** |
| Step 1 skill delegate succeeded | report; may also ask whether to pin as a favorite |
| Step 2 tool / Step 4 script succeeded | report |
| Step 4 publish succeeded | report (include the published resource id) |

Ask to pin a favorite **only after a Step 1 skill success and only if it is not already pinned**. Pinning and experience reporting are independent.

### Case-material path (pipeline.ts)

Host protocol: [references/case-data-material-planner/planner.md](references/case-data-material-planner/planner.md).

```bash
node "$SKILL_DIR/references/case-data-material-planner/scripts/pipeline.ts" \
  --case-id <id> \
  --source <case.md> \
  [--prd <requirement.md>] \
  [--context <business-context.json>] \
  [--resume]
```

| Exit | Host does |
|---|---|
| 0 | Done. Report `case-executable.md` (business fields only) |
| 10 | Launch `select-tool` Agent, merge patch, `--resume` |
| 11 | Launch `parse-case` Agent, merge patch, `--resume` |
| 12 | Path A only: launch `knowledge-build`, merge, `--resume`. Without cases, wait (do not invoke) |
| 20 | Blocking C3. User: `retry` / `force-pass` / `abort` |
| 2 | Bad args |

`invoke_entity.ts` dispatches only on `toolBinding.toolType`: `skill` | `tool` | `script` | `reuse` | `api-setup`.
Writeback is `slot_render.ts`: business fields and `入参` / `产出` go into `case-executable.md`. Do **not** write `node` commands, ports, cwd, or `skillRoot` into the case document.

Path A without cases: `--case-id` + `--prd` (no `--source`) → exit 12 → after context `{ ok: true, waiting: "cases" }` exit 0 → later `--source` + `--resume` → parse (exit 11).

### Material gates (ask only for prerequisite materials)

Stop and ask the user only when the items below are missing; after they answer, **continue and finish the remaining steps**:

| Scenario | Ask only for what is missing |
|---|---|
| One-shot construct | Usually ask nothing; use the four-step fallback |
| Multi-step scene | Upstream artifacts this domain cannot create (e.g. distribution inventory bind needs `productId`) |
| Ad-hoc script | At least one of: OpenAPI directory / `planId` / `serviceId` |
| Case materials | A case source (file, paste, `planId`, URL) |
| New domain slot | The scene skill folder, or `domain` + a non-empty OpenAPI directory to scaffold |

Do not interrupt the flow for defaultable fields such as `fulfillOn`, `quantity`, `credits`, or `rate`.

## Appendix: adapters

Platform-replaceable; the decision tree does not change.

| Adapter | Local default | After switching to HTTP |
|---|---|---|
| `skill_marketplace` | Scan discovered slot dirs (`slots/` + `slot_roots`) | Skill-marketplace search / install |
| `tool_registry` | `./testdata/tools` | Query / execute / publish |
| `api_catalog` | Slot `assets/openapi/` plus optional extra dirs | Service / operation catalog |
| `experience_store` | Local JSON + text similarity | Experience pull / report / feedback |
| `auth` | `$DATA_BUILD_TOKEN` | OAuth2 client credentials |
| `data_store` | Optional `DATABASE_DSN` (SELECT only) | Read-only SQL gateway |
| `feature_flags` | `noop` | Experiment drafts / whitelist |
| `case_writeback` | Write `testdata/case-materials/` | Case-platform writeback |
| `workspace_context` | `testdata/context.json` or `.biz/context.json` | Test-plan service |

Common environment variables:

| Variable | Role |
|---|---|
| `DATA_GENERATE_SKILL_DIR` | Skill install root (contains `SKILL.md`) |
| `DATA_GENERATE_SKILLS_ROOT` | Package root that contains `slots/` (usually the same as the row above after install) |
| `DATA_BUILD_CONFIG` | Config file path |
| `DATA_BUILD_API_BASE` | HTTP base URL for executors; default `http://127.0.0.1:8765` |
| `DATA_BUILD_TOKEN` | Optional Bearer token |
| `DATA_BUILD_FAVORITES_PATH` | Override the favorites file |
| `DATA_BUILD_SCRIPT_ROOTS` | Extra colon-separated roots allowed for executor scripts |

The Step 1 search script does two things in parallel: scan the skill marketplace and query the experience store, then inject favorites. Keywords should be only 1–2 business nouns (for example `catalog`); do not use verb phrases such as “help me construct”. If nothing matches, it automatically falls back to a full scan.

```bash
node "$SKILL_DIR/scripts/search_data_build.ts" \
  --keywords catalog \
  --query "create a catalog product" \
  --registry-key "catalog-product::create" \
  --entry-type entity \
  --domain catalog \
  --json
```

Return shape: `{ pinned_matches, proven_matches, skill_matches }`.

## Appendix: how demo data is written

Example domains in the package:

- `slots/catalog`: catalog products, orders, account credit
- `slots/distribution`: distributors, inventory bind, commission, quote

Each domain is a delegable Agent Skill (`SKILL.md` + `slot.yaml` + `scripts/executors/*.ts`).
`slot.yaml` is the single scene config. `scenes[].steps` are dependency edges: IDs from the previous step’s `data` are passed to the next step.

### Single step: the executor only assembles the request; it does not generate IDs

Creating a standard product as an example: the only required field is `name`; `city` defaults to `demo-city`. The script POSTs `/v1/products` and **does not invent `productId` itself**.

```bash
node "$SKILL_DIR/slots/catalog/scripts/executors/create_product.ts" \
  --json '{"name":"Northwind Standard","city":"demo-city"}'
```

HTTP is sent by `slots/common/client.ts` to `$DATA_BUILD_API_BASE`.

### Persist: the default is a local mock

```bash
node "$SKILL_DIR/slots/mock_server.ts" --port 8765
```

On `POST /v1/products`, the mock auto-increments and generates `p_1`, `p_2`, …, then writes:

`<current working directory>/testdata/mock-store.json`

(Relative to the **cwd when the mock was started**, not the SKILL directory.)

| API | Writes | ID rule |
|---|---|---|
| `POST /v1/products` | products | `p_<n>` |
| `POST /v1/orders` | orders (the product must already exist) | `o_<n>` |
| `POST /v1/credits/enroll` | credits | key is `productId:userId` |
| `POST /v1/distributors` | distributors | `d_<n>` |
| `POST /v1/distributors/{id}/inventory` | bindings | `b_<n>` |
| `POST /v1/distributors/{id}/commission` | updates distributor `commissionRate` | — |
| `POST /v1/distributors/{id}/quote` | read-only quote (must already be bound) | — |

Point `DATA_BUILD_API_BASE` at a real gateway and the same executors write real data; the decision tree does not need to change.

### Multi-step scenes pass IDs

| Scene | Steps | Must pass |
|---|---|---|
| `credit-ready-product` | create product → enable credit | `productId` + the `userId` the user supplied |
| `bookable-order` | create product → place order | same as above |
| `ready-to-sell` | create distributor → bind inventory → set commission | `distributorId` + **the catalog-domain `productId`** |

`ready-to-sell` cannot invent a product from nothing. When there is no `productId`: go through catalog first, or ask the user for an existing product, then continue bind-inventory and set-commission. **Do not skip steps**.

## Appendix: install and environment

### From the GitHub repository

```bash
npx skills add openqa-cn/codexqa --skill testdata-generation
```

Then start a new Agent conversation. Host flags: [INSTALL.md](INSTALL.md) and [docs/GETTING_STARTED.md](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md).

### Pack and unzip (local checkout)

From the source directory:

```bash
cd testdata-generation
node scripts/pack_skills.ts --output ./dist
unzip dist/testdata-generation.zip -d ~/.cursor/skills
```

Artifact: `dist/testdata-generation.zip` (the zip root must be `testdata-generation/SKILL.md`). The result should be `~/.cursor/skills/testdata-generation/SKILL.md`.
If the zip was created by compressing the source directory directly, keep the `testdata-generation` folder name and remove `__MACOSX`, `dist/`, and `testdata/`.

Project-level: unzip into `<project>/.cursor/skills/`.
For Claude Code / Codex unzip paths, see [INSTALL.md](INSTALL.md).

### Local development setup

```bash
cd testdata-generation
mkdir -p testdata
cp assets/config.example.yaml testdata/config.yaml
node slots/mock_server.ts --port 8765
```

Workspace context can live in `testdata/context.json`. Common fields: `testPlan.id` / `planId`, `business_line`, `operator`, `targetRepositories[].serviceId`.

## Appendix: constructing demo data

Start the mock first (see [how demo data is written](#appendix-how-demo-data-is-written)), then run the following in **another terminal**. Paths below are relative to `$SKILL_DIR`.

### Catalog single steps

| Intent | Command |
|---|---|
| Standard product | `node "$SKILL_DIR/slots/catalog/scripts/executors/create_product.ts" --json '{"name":"Northwind Standard"}'` |
| Limited product | `.../create_limited_product.ts --json '{"name":"Limited SKU","validHours":4}'` |
| Order | `.../create_order.ts --json '{"productId":"p_1","userId":"u_1001"}'` |
| Account credit | `.../setup_account_credit.ts --json '{"productId":"p_1","userId":"u_1001"}'` |

Defaults: `city=demo-city`, `validHours=4`, `fulfillOn=today+2days`, `quantity=1`, `credits=1000`.

### Distribution single steps

| Intent | Command |
|---|---|
| Distributor | `.../create_distributor.ts --json '{"name":"North Channel"}'` |
| Bind inventory | `.../bind_inventory.ts --json '{"distributorId":"d_1","productId":"p_1"}'` |
| Commission | `.../set_commission.ts --json '{"distributorId":"d_1","rate":0.1}'` |
| Quote | `.../browse_and_quote.ts --json '{"distributorId":"d_1","productId":"p_1"}'` |

Defaults: `region=domestic`, `rate=0.1`.

### Recommended integration order

1. Create a standard catalog product → obtain `productId`
2. Place an order for `u_1001` → obtain `orderId`
3. Create a distributor → bind the previous `productId` → set commission
4. Browse and quote

### Check that search discovers the domain skill

```bash
node "$SKILL_DIR/scripts/search_data_build.ts" --keywords catalog --json
# catalog should appear in skill_matches
```

### Favorites

```bash
node "$SKILL_DIR/scripts/favorites.ts" add \
  --name "catalog" \
  --desc "Catalog product, order, and credit construction" \
  --path "$SKILL_DIR/slots/catalog"
node "$SKILL_DIR/scripts/favorites.ts" list
```

Writes `~/.testdata/favorites.json` by default; `--scope project` writes `./testdata/data-build-favorites.json`.

## Appendix: requests you can say to the Agent

**Catalog single steps**

- Help me create a standard catalog product named Northwind Standard
- Construct a limited product with a 4-hour validity window
- Place a catalog order for user `u_1001`, using the product ID from just now
- Enable account credit for this catalog product and user

**Catalog scenes**

- Make a catalog product that can use account credit
- Prepare a bookable catalog order

**Distribution / cross-domain**

- Create a distributor account named North Channel
- Bind the catalog product from just now to this distributor and set 10% commission
- Make this catalog product ready to sell via distribution (if there is no productId, construct the product first)

**Case materials (goes to the sub-skill; does not run the executors above)**

- Prepare test data for this batch of cases
- Write the test data back into the cases

**Generic fallback**

- Write a data-construction script from the test-plan change APIs
- Publish the script that just ran successfully as a tool

**New scene**

- Scaffold a new invoice / wallet domain slot from this OpenAPI directory
- Add our company slot root and construct a payable invoice

Note: put existing IDs directly in the request. If no enterprise gateway is configured, have the Agent use the local mock first.

## Appendix: add a new scene

Contract: [slots/SLOT_SPEC.md](slots/SLOT_SPEC.md). Two things:

1. **A scene skill folder** with executors plus `slot.yaml` and/or `SKILL.md`
2. **One config line, only if the folder is not under the default `slots/`**

```yaml
# testdata/config.yaml
workspace:
  slot_roots:
    - /opt/company/data-slots
```

Do **not** add `skill_marketplace.paths` or `api_catalog.paths` just for the new scene. Do **not** edit `select_tool.ts`.

Optional helper: OpenAPI → `slot.yaml` + executor stubs + generated docs:

```bash
node "$SKILL_DIR/slot-scaffolder/scripts/scaffold_slot.ts" \
  --domain invoice \
  --openapi ./openapi \
  --output /opt/company/data-slots/invoice
```

Then:

1. Implement each stub `main(params)` against `DATA_BUILD_API_BASE` (timeouts; never `shell: true`; missing required IDs must fail)
2. Add `scenes` (and optional `aliases` / `invokeParams`) in `slot.yaml` only
3. Refresh generated docs: `node "$SKILL_DIR/scripts/sync_slot.ts" --dir /opt/company/data-slots/invoice`
   Hand-written `SKILL.md` is left alone unless it is `generated-from: slot.yaml` or you pass `--force`
4. Smoke-test search: `node "$SKILL_DIR/scripts/search_data_build.ts" --keywords invoice --json`
5. Case pipeline binds `resourceId` from `slot.yaml` without an LLM when the match is unique

`slot.yaml` example:

```yaml
name: invoice
domain: invoice
entities:
  - id: invoice-draft
    executor: scripts/executors/createinvoice.ts
    aliases: [invoice, 发票]
    invokeParams: [name]
actions:
  - id: pay-invoice
    executor: scripts/executors/payinvoice.ts
    aliases: [pay, 支付]
    params: [invoiceId]
scenes:
  - id: payable-invoice
    steps: [invoice-draft::create, pay-invoice]
```

### Operating notes for steps 2–4

**Step 2 tools**: the query must be a complete natural-language sentence. Do not stack space-separated words or use internal abbreviations as the only query. Use at least two angles (“create a catalog test product” / “customer places a standard-product order”). A unique clear match (or a user-supplied id) proceeds; several or weak matches ask first. Then: `query_input_list` → fill params → `execute`.

**Step 3 APIs**: if there is a `planId` and the request relates to a change → call `search_plan_changes` first; otherwise use `list_by_service` with `serviceId`, then `search` with a single token. If none of the three API sources exist **and** no slot OpenAPI is indexed, stop and ask for materials; do not invent endpoints.

**Step 4 scripts**: write to `./testdata/<name>.ts` from `references/script-template.ts`. The structure must be shebang + constants block + `main(params) -> {success, data, error}`. Access external systems only through `callHttp` / `callSql` / `getConfig` / `callFeatureFlag`. Child-process calls must use a list of arguments; never `shell: true`. After success, ask whether to `tool_registry.publish`.

Experiments / whitelist only when the user explicitly asks and `feature_flags.type` is not `noop`: confirm the environment first; production writes need a second confirmation; one subject per call.

## Appendix: common issues

| Symptom | What to do |
|---|---|
| Cannot find `catalog` | Confirm the unzipped directory is named `testdata-generation` and `slots/catalog/SKILL.md` exists; invoke scripts with `node "$SKILL_DIR/scripts/<name>.ts"` |
| New company scene is not searched | Put the skill under pack `slots/` **or** add that parent to `workspace.slot_roots`. A folder needs `slot.yaml` or `SKILL.md` |
| OpenAPI of the new scene is missing | Confirm `assets/openapi/` exists under the slot; do not add `api_catalog.paths` just for that |
| Executor cannot connect | Start `mock_server.ts` first, or set `DATA_BUILD_API_BASE` |
| Place order / bind inventory 404 | `productId` or `distributorId` is not in mock-store; create it first, then reference it |
| Case writeback shows `node` / ports | Regression: writeback must be `slot_render.ts` business fields only |
| Pipeline exit 11 / 12 / 10 | Host must run the matching LLM Agent, merge the patch, then `--resume`. Construct and writeback stay inside `pipeline.ts` |
| Path A waits | Expected when `--prd` is given without `--source`; supply cases and `--resume` |
| No workspace context | Look for `testdata/context.json` or `.biz/context.json`; if neither exists, ask for `planId` or continue in no-plan mode |
| HTTP 401 | Configure `$DATA_BUILD_TOKEN` or OAuth; never write the token into a script |
| No proven_matches | Normal for the first request of that kind; report after success so it can be reused next time |
| proven is not applicable | Skip that row and continue to skill or Step 2 |

## Appendix: related files

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | Agent entry and decision tree |
| [references/workflow.md](references/workflow.md) | Search examples, report payloads, FAQ |
| [references/adapters.md](references/adapters.md) | HTTP adapter contracts + `slot_roots` |
| [references/script-template.ts](references/script-template.ts) | Step 4 script template |
| [slots/SLOT_SPEC.md](slots/SLOT_SPEC.md) | Domain slot spec (two-step enterprise extension) |
| [slot-scaffolder/SKILL.md](slot-scaffolder/SKILL.md) | OpenAPI → slot scaffold |
| [slots/catalog/SKILL.md](slots/catalog/SKILL.md) | Catalog routing and scenes |
| [slots/distribution/SKILL.md](slots/distribution/SKILL.md) | Distribution routing and scenes |
| [references/case-data-material-planner/SKILL.md](references/case-data-material-planner/SKILL.md) | Case-material routing |
| [references/case-data-material-planner/planner.md](references/case-data-material-planner/planner.md) | `pipeline.ts` host protocol |
| [INSTALL.md](INSTALL.md) | `npx skills add`, plus optional zip unpack |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Observed failure cases and boundaries |
