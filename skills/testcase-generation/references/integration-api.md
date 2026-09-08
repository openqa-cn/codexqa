# Integration HTTP API

Enterprises implement these endpoints behind their own gateway. The skill never calls a vendor SDK; it only sends the mapped request and reads the mapped DTO via `scripts/call_integration.ts`.

Copy [`config/integrations.example.yaml`](../config/integrations.example.yaml) to `{workspace}/.ai-testcase/integrations.yaml`. Put secrets in environment variables referenced as `${NAME}`.

All successful bodies should be JSON. `responseMap` uses a small JSONPath subset: `$.a.b`, `$.a[0].b`.

## Auth, query, and TLS

Configured on each capability under `http`. The adapter runs the handshake, then calls the business endpoint. Tokens stay in process memory (short TTL cache). They are never written to cases or `integrations-resolved.json`.

### `http.query`

Static query parameters. Values may be `${ENV_VAR}`.

```yaml
query:
  access_token: ${KNOWLEDGE_QUERY_TOKEN}
```

### `http.auth.kind`

| kind | When to use | Required fields |
|---|---|---|
| `none` | No extra handshake (optional static `headers` / `query` only) | — |
| `header` | Inject an env token into a request header | `token`, optional `inject.header` / `inject.prefix` |
| `query` | Inject an env token into the query string | `token`, `queryParam` (or `inject.query`) |
| `oauth2_client_credentials` | Client credentials grant | `tokenUrl`, `clientId`, `clientSecret` |
| `token_exchange` | Enterprise SSO / ticket exchange over HTTP | `tokenUrl`, `tokenResponse` |
| `session` | API login that sets `Set-Cookie` | `loginUrl` |

OAuth example:

```yaml
auth:
  kind: oauth2_client_credentials
  tokenUrl: https://sso.example.com/oauth/token
  clientId: ${OAUTH_CLIENT_ID}
  clientSecret: ${OAUTH_CLIENT_SECRET}
  clientAuth: body          # body | basic
  scope: spec.read
  tokenResponse: $.access_token
  inject:
    header: Authorization
    prefix: "Bearer "
```

`token_exchange` posts `auth.body` (plus `auth.requestMap` from `--arg`) to `tokenUrl`, reads `tokenResponse`, then injects like OAuth. Do not embed a vendor SSO SDK; expose one HTTP exchange endpoint.

`session` posts `loginUrl` and replays cookies. Only API-style login works (no captcha / interactive SSO). Optional `cookieNames` keeps a subset.

`inject.query` puts the obtained token on the business URL instead of (or in addition to) a header.

### `http.tls` (mTLS)

```yaml
tls:
  certFile: ${MTLS_CERT_PATH}
  keyFile: ${MTLS_KEY_PATH}
  caFile: ${MTLS_CA_PATH}
```

Paths only — never paste PEM into YAML. Applied to both the handshake and the business request.

## Endpoints

## Endpoints

### Spec lookup

`POST /v1/spec/lookup`

```json
{ "serviceId": "coupon-query", "method": "queryStoreCoupons" }
```

```json
{
  "data": {
    "qualifiedName": "com.example.coupon.api.CouponQueryService",
    "protocol": "http",
    "request": { "storeId": "1001" },
    "response": { "code": 0, "data": {} },
    "source": "enterprise-spec-service"
  }
}
```

### Knowledge search

`POST /v1/knowledge/search`

```json
{ "query": "coupon-query queryStoreCoupons", "scope": "interface" }
```

```json
{
  "data": {
    "hits": [
      { "title": "Store coupon query", "uri": "knowledge/coupon.md", "snippet": "..." }
    ]
  }
}
```

### Environment

`GET /v1/env`

```json
{ "data": { "env": "staging", "lane": "qa-1" } }
```

### Config lookup

`POST /v1/config/lookup`

```json
{ "serviceId": "coupon-query", "key": "coupon.new-path.enabled" }
```

```json
{
  "data": {
    "key": "coupon.new-path.enabled",
    "value": "true",
    "description": "New query path feature flag"
  }
}
```

### Middleware lookup

`POST /v1/middleware/lookup`

```json
{ "kind": "cache", "serviceId": "coupon-query", "hint": "store coupon list" }
```

`kind` is one of `database`, `cache`, `mq`. `fields` keys must match the enabled component in `profile.components`.

```json
{
  "data": {
    "kind": "cache",
    "fields": { "cluster": "coupon-cache", "key": "coupon:{storeId}", "command": "get" }
  }
}
```

### Experiment lookup

`POST /v1/experiment/lookup`

```json
{ "experimentKey": "coupon-rank-v2" }
```

```json
{
  "data": {
    "experimentKey": "coupon-rank-v2",
    "groups": { "control": "old rank", "treatment": "new rank" }
  }
}
```

## Errors

Non-2xx, timeout, or unmapped fields: adapter returns `{ "ok": false, "status": "error", "error": "..." }`. If the capability sets `fallback: local`, the skill then uses local files. Otherwise the case field is `TBD` and the main flow continues.
