# Generic data-build workflow details

Read this file only after the main `SKILL.md` decision tree.

`SKILL_DIR` is the folder that contains this pack's `SKILL.md`. Prefix every
`scripts/*.ts` call with `$SKILL_DIR/`.

## Search input design

Keywords: one or two domain nouns (`catalog`, `distributor`. Never use verb phrases.
If keywords miss, `search_data_build.ts` falls back to a full marketplace scan.

Structured query:

- `registry-key`: `{entity}::{action}` such as `catalog-product::create`
- `query`: one natural-language sentence
- `entry-type`: `entity` or `action`
- `domain`: from workspace context `business_line` (`testdata/context.json` or `.biz/context.json`), or infer from the request

| User request | --keywords | --registry-key | --query | --entry-type |
|---|---|---|---|---|
| create a standard catalog product | `catalog` | `catalog-product::create` | `create a standard catalog product` | entity |
| construct a catalog order with a license | `catalog` | `catalog-order::create` | `construct a catalog order with a license` | entity |
| create a bulk catalog order | `catalog` | `catalog-order::create` | `create a bulk catalog order` | entity |
| call a distribution quote API | `distribution` | `distribution-quote::verify` | `call a distribution quote API to verify price` | action |

```bash
node scripts/search_data_build.ts \
  --keywords catalog \
  --query "create a catalog product" \
  --registry-key "catalog-product::create" \
  --entry-type entity \
  --domain catalog \
  --json
```

## Result priority

1. `pinned_matches` — user favorites, returned unconditionally. Agent judges relevance from `description`. Prefer `skillPath` when `SKILL.md` exists. A relevant pinned hit ends step 1.
2. `proven_matches` — reuse only when registry key matches, the bound tool is reachable, and required params are available. Keep `experience_id` for feedback. Skip a row that fails any of the three checks.
3. `skill_matches` — drop rows that do not cover the request, then: one
   remaining local slot → load it and say which skill you used. Ask only when
   install is required, two remaining rows could both be right, or the match
   is weak.

If search is empty and the user wants a reusable domain pack, read `$SKILL_DIR/slot-scaffolder/SKILL.md` (a bundled folder, not a separately installed skill) and follow it. One-off work continues at step 2.

## Tool registry fallback

Write two natural-language queries (construct vs business-flow). Do not space-separate keywords. Do not use internal abbreviations as the only query.

```bash
node "$SKILL_DIR/scripts/adapters/cli.ts" tool_registry.query "create a catalog test product"
```

Exact lookup when the user already has a resource id:

```bash
node "$SKILL_DIR/scripts/adapters/cli.ts" tool_registry.get "<resource-id>"
```

A unique result that clearly matches (or a user-supplied id) proceeds.
Several or weak matches: show them and ask first.
Execute only after `query_input_list` and confirmed business IDs.

Publish only after a successful local run:

```bash
node "$SKILL_DIR/scripts/adapters/cli.ts" tool_registry.publish 'catalog-product-create' 'Create a catalog product via the configured HTTP API' './testdata/create_product.ts' '[{"name":"name","type":"string","required":true}]'
```

`--desc` describes what the tool does, not the file name. Always pass an explicit input list.

## API catalog fallback

Method A (plan change APIs) when `planId` exists and the request matches the change:

```bash
node "$SKILL_DIR/scripts/adapters/cli.ts" api_catalog.search_plan_changes "<planId>"
```

Method B first checks workspace context `targetRepositories[].serviceId` / `relatedJobs[].serviceId`, then keyword search. Use one precise token.

```bash
node "$SKILL_DIR/scripts/adapters/cli.ts" api_catalog.list_by_service "<serviceId>"
node "$SKILL_DIR/scripts/adapters/cli.ts" api_catalog.search "create catalog product"
```

| Situation | Strategy |
|---|---|
| Has `planId`, request matches the change | A first |
| Has `planId`, change is weakly related | A + B |
| No `planId` | B |
| User already named a service / API | B: `list_by_service` or `search` + `detail` |

Generate a script from `references/script-template.ts` into `./testdata/`. Use `callHttp`, `callSql`, `getConfig`, `callFeatureFlag` only. `main(params)` must return `{success, data, error}`.

Script rules:

- Child-process calls use argument lists, never `shell: true`
- Timeouts on every network call
- Coerce `object`/`array`/`bool`/`number` inputs with `typeof` / `Array.isArray`
- Do not invent order IDs, user IDs, or amounts
- Chain APIs as separate functions; stop on the first `success=false`

## Experience report

Non-blocking. Failure must not hide a successful construct.

**Trigger:**

- Step 1 proven hit → **feedback only**, do not report again
- Step 1 skill success → report (`toolType=skill`)
- Step 2 tool success → report (`toolType=tool`)
- Step 4 script success → report (`toolType=script`)
- Step 4 feature-flag script success → report (`toolType=feature_flag`)
- Step 4 published after a successful run → report (`toolType=tool`, published resource id)

```bash
node scripts/experience_client.ts report --body '{
  "registry_key": "catalog-product::create",
  "entry_type": "entity",
  "tool_binding": {
    "toolType": "skill",
    "resourceId": "catalog",
    "invokeCmd": "node slots/catalog/scripts/executors/create_product.ts",
    "toolStatus": "available"
  },
  "proven_invocation": {
    "invokeCmdTemplate": "node slots/catalog/scripts/executors/create_product.ts --json '\''{\"name\":\"${name}\"}'\''",
    "paramMapping": [],
    "outputFields": ["productId"],
    "successSignal": "success=true",
    "provenExample": {"args": {"name": "demo"}, "outputSnapshot": {"productId": "p_1"}}
  },
  "confidence": 0.85,
  "contributor": "<contributor>",
  "domain": "catalog",
  "aliases": ["create catalog product", "create catalog listing"]
}'
```

`DOMAIN` comes from workspace context `business_line`, or is inferred.
`CONTRIBUTOR` comes from workspace context `operator`, or the current OS user.
Do not store tokens, cookies, personal identifiers, or local absolute `skillRoot` paths.

| Successful path | toolType | resourceId |
|---|---|---|
| Step 1 domain skill | `skill` | skill name / uuid |
| Step 2 registry tool | `tool` | tool resource id |
| Step 4 generated script | `script` | `./testdata/<name>.ts` |
| Step 4 feature-flag script | `feature_flag` | logical operation, e.g. `add_whitelist` |
| Step 4 after publish | `tool` | publish result resource id |

Feature-flag reports may keep a real experiment key, environment, and team/scene id.
They must not keep access tokens, cookies, client secrets, real subject IDs, phone numbers, or full payloads.
Reuse a flag experience only when operation + environment + experiment key all match.
A historical experiment key is a candidate only; never auto-write it unless the user supplied it.

Feedback after reusing a proven match:

```bash
node scripts/experience_client.ts feedback --body '{
  "experience_id": "<id>",
  "outcome": "success",
  "contributor": "<contributor>"
}'
```

On failure include `"fail_reason"`. Report/feedback errors print to stderr and are ignored after a 15s timeout.

## Favorites

| User says | Command |
|---|---|
| pin this skill | `node scripts/favorites.ts add --name "<name>" --desc "<when to use>" --path "<dir with SKILL.md>"` |
| show pinned | `node scripts/favorites.ts list` |
| unpin | `node scripts/favorites.ts rm --name "<name>"` |
| verify pinned | `node scripts/favorites.ts verify` |

Ask to pin **only after a step-1 skill success**, and only if that skill is not already pinned.

## Feature flags

Only when the user asks for experiments, drafts, or whitelists and `feature_flags.type` is not `noop`.

- Confirm environment before writes
- Production writes need a second confirmation
- One subject per call
- Do not fall back to raw HTTP if the adapter is `noop`

## Material gates (high-level only)

Do not add field-level confirmation for executor params. Optional fields use defaults. Core IDs that the user already gave must not be invented.

Ask only for missing **materials**:

- Case pack (file / paste / `planId` / URL) before parse or construct
- API source (OpenAPI / `planId` / `serviceId`) before generating a script from scratch
- Cross-domain artifact a scene cannot create (e.g. catalog product before distribution bind)
- A scene skill folder (or `domain` + OpenAPI to scaffold) before adding a new domain. Put it under `slots/` or `workspace.slot_roots`

After the user provides the material, finish the remaining steps. Do not skip them.

## FAQ

**Q1: Missing workspace context?**
Look for `testdata/context.json` then `.biz/context.json`. If both are absent, ask for `planId` or continue without a plan.

**Q2: Auth / HTTP 401?**
The `auth` adapter reads `$DATA_BUILD_TOKEN` or an OAuth client-credentials flow. Configure `testdata/config.yaml`. Do not hardcode tokens.

**Q3: API params are unclear?**
Call `api_catalog.detail(<operationId>)`. If the catalog exposes recent traffic samples, use those as examples only — never copy secrets.

**Q4: The API needs extra auth?**
Put tokens in the auth adapter or environment. Scripts must call `callHttp`, not ad-hoc curl with pasted cookies.

**Q5: Need to chain APIs (create then query)?**
Wrap each call in its own function. In `main()`, continue only when `success` is true; otherwise return `{success: false, error: "..."}`.

**Q6: SQL / config?**
`callSql` is SELECT-only. `getConfig` reads the file or HTTP config store. Do not guess connection strings.

**Q7: No proven matches?**
Expected on the first use of a pattern. Report after success so the next similar request can reuse it.

**Q8: Agent judged a proven match inapplicable?**
Skip that row and continue to `skill_matches` or step 2. Semantic match is an accelerator, not a mandatory path.

**Q9: How to build a reusable domain pack?**
Read `$SKILL_DIR/slot-scaffolder/SKILL.md` and generate a slot from OpenAPI. Implement executor stubs, add `scenes` in `slot.yaml` only, then `node scripts/sync_slot.ts --dir <slot>`. Drop the folder under `slots/` or add one `workspace.slot_roots` line — do not register it again in `marketplace.paths` / `api_catalog.paths`. Example slots live in `$SKILL_DIR/slots/catalog` and `$SKILL_DIR/slots/distribution`. Contract: [../slots/SLOT_SPEC.md](../slots/SLOT_SPEC.md).

**Q10: Case pipeline stopped with exit 11 / 12 / 10?**
Host launches only the matching Agent (`parse-case` / `knowledge-build` / `select-tool`), merges the patch, then `--resume`. Construction, binding, and writeback are stages inside `pipeline.ts`, not Agents. `case-executable.md` must contain business fields only (no `node` / ports).
