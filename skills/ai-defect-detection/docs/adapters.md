# Adapting the skill to another company

The skill never calls a hard-coded internal host. It only talks to **providers**.

## 1. Start local

```bash
cp config.example.yaml config.yaml
node open_detect.ts submit-git \
  --git git@github.com:acme/order-service.git \
  --branch feature/demo \
  --submit-user alice
```

Put sample plans, cases, and docs under `enterprise/` (see the shipped fixtures).

## 2. Point at your systems

Detection lifecycle → `platform-api.md`. Plan / cases / wiki / tickets / traces → `enterprise-http-api.md` (reserved HTTP slots; remap with `options.paths`).

```yaml
enterprise_http_base_url: https://gateway.example.com   # optional shared host
providers:
  auth:
    kind: bearer
    options:
      token: ${DETECTION_TOKEN}
  platform:
    kind: http
    options:
      base_url: https://quality.example.com
      report_base_url: https://quality.example.com/ui/report
  plan:
    kind: http
    options:
      base_url: https://plans.example.com
      # paths:
      #   get_plan: /api/test-apply/{plan_id}
  testcase:
    kind: http
    options:
      base_url: https://cases.example.com
  issues:
    kind: github          # or http
    options:
      repo: acme/order-service
  docs:
    kind: http
    options:
      base_url: https://wiki.example.com
  traces:
    kind: http
    options:
      base_url: https://observe.example.com
```

Environment variables override YAML: `DETECTION_PLATFORM_KIND`, `DETECTION_PLATFORM_BASE_URL`, `DETECTION_ENTERPRISE_BASE_URL`, `DETECTION_PLAN_KIND`, `DETECTION_PLAN_BASE_URL`, `DETECTION_TESTCASE_KIND`, `DETECTION_ISSUES_KIND`, `DETECTION_DOCS_KIND`, `DETECTION_TRACES_KIND`, `DETECTION_TOKEN`, `DETECTION_API_KEY`, `DETECTION_GITHUB_REPO`, `DETECTION_USER`.

## 3. Auth options

| kind | Header |
|---|---|
| `none` | none (local / CI) |
| `bearer` | `Authorization: Bearer <token>` |
| `api_key` | `X-API-Key: <key>` (header name configurable) |

OIDC / SAML companies should exchange a token outside the skill and pass it as `DETECTION_TOKEN`.

## 4. What must stay working

A complete adapter set must support: create task, list pending processes, write process + rank, tags, rules, coverage / rank integrity, complete / abort / retry, report, confirm / reject, and optional plan / case / issue / doc / trace reads. The local platform implements all of these so you can develop against a real lifecycle before wiring HTTP.
