# Enterprise HTTP slots

These five systems sit **beside** the detection platform (`docs/platform-api.md`). Local mode reads `enterprise/`. Set `providers.<name>.kind: http` to call the reserved JSON slots below. Missing files / empty HTTP responses still degrade (see `SKILL-PHASE1.md`); they do not abort the task.

Envelope: `{ "code": 0, "msg": "success", "data": ... }`. Auth headers come from `providers.auth` (`bearer` / `api_key` / `none`).

Shared gateway (optional): `enterprise_http_base_url` or `DETECTION_ENTERPRISE_BASE_URL`. A provider that omits `options.base_url` uses this host.

Path remap without code changes:

```yaml
providers:
  plan:
    kind: http
    options:
      base_url: https://qa.example.com
      paths:
        get_plan: /api/test-apply/{plan_id}
```

Path variables: `{plan_id}` `{id}` `{case_id}` `{issue_id}` `{doc_id}`.

---

## Plan — test / delivery plan

Local seed: `enterprise/plans/{id}.json`, submitted defects `enterprise/plans/{id}.defects.json`.

| Slot | Method | Default path | Query |
|---|---|---|---|
| `get_plan` | GET | `/v1/plans/{plan_id}` | `planType` (2=test, 4=delivery) |
| `list_submitted_defects` | GET | `/v1/plans/{plan_id}/defects` | `planType`, `pageNo`, `pageSize` |

`get_plan` `data`:

```json
{
  "planId": 1001,
  "planType": 2,
  "planName": "Order checkout validation",
  "services": [{"git": "git@github.com:acme/order-service.git", "branch": "feature/x", "serviceKey": "acme.order", "language": "java"}],
  "testCaseIds": ["TC-1001"],
  "issueList": ["42"],
  "requirementDocs": ["checkout-rules.md"],
  "technicalDocs": ["checkout-api.md"]
}
```

`list_submitted_defects` `data`: `{ "list": [...], "total": 1, "pageNo": 1, "pageSize": 100 }`.

Env: `DETECTION_PLAN_KIND=http`, `DETECTION_PLAN_BASE_URL=...`.

---

## Testcase — case platform

Local seed: `enterprise/test-cases/`.

| Slot | Method | Default path | Query |
|---|---|---|---|
| `list_groups` | GET | `/v1/test-case-groups` | `issueId`, `planId` |
| `list_cases` | GET | `/v1/test-cases` | `groupId`, `planId`, `issueId` |
| `get_case` | GET | `/v1/test-cases/{case_id}` | — |

`get_case` `data`: `{ "id", "title", "preCondition", "steps", "expectedResult" }`. Transport failure → `{ "id", "fetchStatus": "failed" }` (no exception).

Env: `DETECTION_TESTCASE_KIND`, `DETECTION_TESTCASE_BASE_URL`.

---

## Docs — wiki / requirement / tech notes

Local seed: `enterprise/docs/`, or a public URL, or an in-repo file via `add-document`.

| Slot | Method | Default path |
|---|---|---|
| `fetch` | GET | `/v1/documents/{doc_id}` |

`data`: `{ "contentId", "title", "url", "content" }`. Failure → `fetchStatus=failed`.

Env: `DETECTION_DOCS_KIND`, `DETECTION_DOCS_BASE_URL`.

---

## Issues — defect / requirement tickets

Local seed: `enterprise/issues/`. Alternative: `kind: github`.

| Slot | Method | Default path |
|---|---|---|
| `get_issue` | GET | `/v1/issues/{issue_id}` |
| `create_issue` | POST | `/v1/issues` |

`get_issue` `data`: `{ "id", "title", "description", "url" }`.

`create_issue` body: `{ "planId", "title", "description", "assignedTo", "severity", "serviceKey" }`.  
`data`: `{ "issueId", "defectUrl", "assignedTo" }`.

Env: `DETECTION_ISSUES_KIND`, `DETECTION_ISSUES_BASE_URL`.

---

## Traces — optional exception traffic

Local seed: `enterprise/traces/{planId}.json`. Empty is fine.

| Slot | Method | Default path | Query |
|---|---|---|---|
| `list_traces` | GET | `/v1/plans/{plan_id}/traces` | `planType`, `serviceKey` |

`data`: a list, or `{ "traces": [...] }`.

Env: `DETECTION_TRACES_KIND`, `DETECTION_TRACES_BASE_URL`.

---

## Switch one system at a time

Keep unused providers on `kind: local`. Only the systems you have an HTTP gateway for need `kind: http`. Slot names live in `providers/http_slots.py` (`ENTERPRISE_HTTP_SLOTS`).
