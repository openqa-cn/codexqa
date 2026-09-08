# Configurable integrations

This skill does not call any external host, package registry, installer, or middleware by default.

A reviewed repository can opt in by dropping a JSON file into **that repository** (not into this skill tree, unless you are reviewing the skill itself).

## Lookup order

1. `CODE_REVIEWER_CONFIG` (absolute path)
2. `code-reviewer.config.local.json` (local override, do not commit secrets)
3. `code-reviewer.config.json`
4. `.code-reviewer.json`
5. `.code-reviewer/config.json`

If none of those exist, built-in defaults apply: prefer `main` as the compare branch then fall back to `master`, common `src/*` layer prefixes, and **all HTTP integrations off**.

Copy [code-reviewer.config.example.json](code-reviewer.config.example.json) to the project root and edit it. Schema: [code-reviewer.schema.json](code-reviewer.schema.json).

## What you can configure

| Block | Purpose |
|-------|---------|
| `git.defaultBaseBranch` | Preferred compare base when the user does not name one. If that ref is missing, the review tries `main` then `master`. |
| `git.codeBrowseUrlTemplate` | Clickable file links. GitHub / GitLab / Bitbucket / self-hosted all work if you set the template |
| `layers.*` | UI / store / API / backend prefixes and exclude globs (defaults also drop `__MACOSX` / `.DS_Store` / `._*`) |
| `conventions.stateLibrary` | Only enforce that library's rules (`mobx`, `redux`, …). Empty = infer from the diff |
| `conventions.backendLanguage` | `java` / `kotlin` / `go` / `python` / `c` / `cpp`. Empty = infer from the diff |
| `conventions.httpWrapper` | Module that new HTTP calls should use. Empty = do not require one |
| `conventions.generatedGlobs` / `generatedMarkers` | When G8 (do not hand-edit generated files) applies |
| `integrations.*` | Optional HTTP APIs you own |

## Integration contract

Each integration is the same shape:

```json
{
  "enabled": false,
  "method": "GET",
  "url": "https://api.example.com/path?branch={branch}",
  "headers": { "Accept": "application/json" },
  "auth": {
    "type": "bearer",
    "tokenEnv": "CODE_REVIEWER_TOKEN",
    "required": true
  },
  "timeoutMs": 8000
}
```

## Authentication

Each integration can declare `auth`. The skill reads credentials from the environment at request time. `load-config.js` never prints secret values.

| `auth.type` | How it is sent | Env vars |
|-------------|----------------|----------|
| `none` | No extra credentials. You may still put `${ENV}` in `headers` or `url` | — |
| `bearer` | `Authorization: Bearer <token>` | `tokenEnv` (default `CODE_REVIEWER_TOKEN`) |
| `basic` | `Authorization: Basic base64(user:pass)` | `usernameEnv` / `passwordEnv` (default `CODE_REVIEWER_USER` / `CODE_REVIEWER_PASSWORD`) |
| `header` | Custom header, default `X-Api-Key` | `tokenEnv` + `headerName` |
| `query` | Query string, default `access_token` | `tokenEnv` + `queryParam` |

`required` defaults to true when `type` is not `none`. If the env var is missing, the call is skipped and the review continues — the skill will not send an unauthenticated request.

Examples:

```json
"auth": { "type": "bearer", "tokenEnv": "CODE_REVIEWER_TOKEN" }
"auth": { "type": "basic", "usernameEnv": "CODE_REVIEWER_USER", "passwordEnv": "CODE_REVIEWER_PASSWORD" }
"auth": { "type": "header", "headerName": "X-Gateway-Key", "tokenEnv": "GATEWAY_KEY" }
"auth": { "type": "query", "queryParam": "access_token", "tokenEnv": "CODE_REVIEWER_TOKEN" }
```

Do not commit tokens. Use `code-reviewer.config.local.json` only for non-secret overrides; keep secrets in the process environment.

| Name | When the skill calls it | Suggested response |
|------|-------------------------|--------------------|
| `prMetadata` | After git log, if commit messages are not enough | JSON with `title` and `body` (or `description`) |
| `notify` | After a finished report | HTTP 2xx; body ignored |
| `telemetry` | After cleanup, counts only | HTTP 2xx; body ignored |
| `extraKnowledge` | During knowledge load | Markdown text appended as optional extra rules |

URL placeholders: `{org}` `{repo}` `{branch}` `{path}` `{line}` `{baseBranch}` `{sha}`.

Secrets belong in environment variables, referenced as `${NAME}`. Do not put tokens in the committed JSON.

The agent only calls URLs that already appear in the loaded config. Missing, disabled, or failed integrations are skipped; the review continues.

## Helpers

```bash
node tooling/load-config.js
node tooling/invoke-integration.js prMetadata --repo my-app --branch feat/checkout
node tooling/invoke-integration.js notify --body-file .cr-notify-payload.json
```
