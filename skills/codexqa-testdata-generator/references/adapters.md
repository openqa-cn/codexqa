# Enterprise adapter contracts

Every company-specific system is reached through one adapter. Defaults are local files. Set `type: http` and a `base_url` to point at your gateway.

`workspace.slot_roots` is the only extra knob for company scene skills that do not live under the pack `slots/` directory. Marketplace search, OpenAPI indexing, and case-pipeline binding all read that list.

Authentication: the `auth` adapter injects an `Authorization` header. Gateways must not require hardcoded tokens in skill code.

Unless noted, HTTP methods are `POST` and bodies are JSON. Successful responses use:

```json
{ "ok": true, "data": { } }
```

Failures use `{ "ok": false, "error": "message" }` or a non-2xx status.

## skill_marketplace

`POST /v1/skills/search`

```json
{ "keywords": ["catalog"], "limit": 20 }
```

Response `data.items[]`: `id`, `name`, `uuid`, `description`, `installCmd`, optional `skillPath`.

`POST /v1/skills/install`

```json
{ "name": "catalog", "targetDir": "/path/to/skills" }
```

## tool_registry

`POST /v1/tools/query` — `{ "query": "create catalog product", "limit": 10 }`

`POST /v1/tools/get` — `{ "resourceId": "create-catalog-product" }`

`POST /v1/tools/inputs` — `{ "resourceId": "create-catalog-product" }`

`POST /v1/tools/execute` — `{ "resourceId": "create-catalog-product", "params": {} }`

`POST /v1/tools/publish` — `{ "name": "...", "description": "...", "scriptPath": "...", "inputs": [] }`

## api_catalog

`POST /v1/apis/search` — `{ "query": "create order", "limit": 20 }`

`POST /v1/apis/detail` — `{ "operationId": "createCatalogProduct" }`

`POST /v1/apis/plan-changes` — `{ "planId": "..." }` (method A: APIs in a test-plan change scope)

`POST /v1/apis/list` — `{ "serviceId": "...", "name": "optional-filter" }` (method B: list by known service)

Local mode reads OpenAPI 3 files (`paths`, `operationId`, `summary`, `servers[0].url`).
Plan-change fallback reads `changedApis` from workspace context.

## experience_store

`POST /v1/experience/fetch`

```json
{
  "queries": [{ "key": "catalog-product::create", "type": "entity", "query_text": "create catalog product" }],
  "domain": "catalog",
  "top_k": 3,
  "min_similarity": 0.15
}
```

`POST /v1/experience/report` — proven invocation payload (`registry_key`, `tool_binding`, `proven_invocation`, `contributor`, `domain`).

`POST /v1/experience/feedback` — `{ "experience_id": "...", "outcome": "success|failure", "contributor": "...", "fail_reason": "" }`

## auth

- `type: env` reads `DATA_BUILD_TOKEN` (or `token_env`) and sends `{header}: {prefix}{token}`.
- `type: oauth` posts client credentials to `oauth.token_url` and uses `access_token`.

Never log the token.

## data_store

Local `type: dsn` uses `DATABASE_DSN`. Only `SELECT` is accepted. `sqlite:///path` is supported out of the box.

An HTTP SQL gateway is optional; keep it read-only on the server.

## config_store

`POST /v1/config/get` — `{ "key": "...", "namespace": "optional" }`

`POST /v1/config/set` — `{ "key": "...", "value": "...", "namespace": "optional" }`

## feature_flags

Disabled when `type: noop`. HTTP operations:

- `POST /v1/flags/detail`
- `POST /v1/flags/whitelist` with `action: add|remove`
- `POST /v1/flags/evaluate`

Always send `environment`. Do not auto-write production flags.

## doc_source

Local files and public `http(s)` URLs work without a gateway.

`POST /v1/docs/get` — `{ "ref": "document-id-or-url" }` returns `{ "content": "..." }`.

## case_writeback

Local mode writes `testdata/case-materials/{caseId}/case-executable.md`.

`POST /v1/cases/update` — `{ "caseId": "...", "markdown": "..." }`.

## workspace_context

Local files, first match wins: configured `path`, `testdata/context.json`, then `.biz/context.json`.

Expected fields: `testPlan.id` / `planId`, `business_line`, `operator`,
`targetRepositories[].serviceId`, `relatedJobs[].serviceId`, `changedApis`.

`GET /v1/test-plans/{id}` returns plan metadata (`id`, `title`, `services`, `changedApis`).
