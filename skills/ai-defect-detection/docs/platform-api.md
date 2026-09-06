# Detection platform HTTP contract

`providers.platform.kind: http` expects a JSON API under `options.base_url`. Responses use `{ "code": 0, "msg": "success", "data": ... }`. Non-zero `code` or transport failure is an error.

Auth headers come from the configured auth provider.

| Method | Path | Role |
|---|---|---|
| POST | `/v1/tasks` | create detection task |
| GET | `/v1/tasks` | list tasks (`submitUser`, `limit`) |
| GET | `/v1/tasks/{id}` | task status |
| POST | `/v1/tasks/{id}/complete` | close task |
| POST | `/v1/tasks/{id}/abort` | abort |
| POST | `/v1/tasks/{id}/retry` | new task from an old one |
| POST | `/v1/tasks/{id}/summary` | store summary |
| POST | `/v1/tasks/{id}/progress` | progress snapshot |
| GET | `/v1/tasks/{id}/report` | report payload |
| POST | `/v1/tasks/{id}/dismiss-classes` | bulk no-defect by class |
| GET | `/v1/batches/{id}/pending` | pending processes |
| GET | `/v1/batches/{id}/coverage` | process coverage |
| GET | `/v1/batches/{id}/rank-integrity` | rank vs process |
| POST | `/v1/batches/{id}/skip` | skip or fail one service |
| POST | `/v1/processes` | create/update process |
| POST | `/v1/processes/dismiss-by-strategy` | bulk no-defect by strategy |
| GET | `/v1/processes/{id}` | process detail |
| POST | `/v1/ranks` | finalize rank |
| POST | `/v1/ranks/{id}/content` | update rank text |
| GET | `/v1/ranks/{id}/flow` | rank + related processes |
| POST | `/v1/ranks/{id}/mark` | user confirm / reject |
| POST | `/v1/ranks/{id}/invalidate` | mark rank invalid |
| GET | `/v1/rules` | AST / custom / exclusion rules |
| GET | `/v1/tags` | tag catalog |
| GET | `/v1/history/confirmed` | confirmed defect history |
| GET | `/v1/history/by-commit` | history by commit |
| GET | `/v1/records` | past detection records |

Companion contracts (optional providers) are reserved HTTP slots; remap via `options.paths`. Full request/response shapes: [enterprise-http-api.md](enterprise-http-api.md).

| Provider | Slots (default paths) |
|---|---|
| plan | `GET /v1/plans/{plan_id}`, `GET /v1/plans/{plan_id}/defects` |
| testcase | `GET /v1/test-case-groups`, `GET /v1/test-cases`, `GET /v1/test-cases/{case_id}` |
| issues | `GET /v1/issues/{issue_id}`, `POST /v1/issues` |
| docs | `GET /v1/documents/{doc_id}` |
| traces | `GET /v1/plans/{plan_id}/traces` |

Task create body (minimum):

```json
{
  "detectType": "GIT_BRANCH",
  "git": "git@github.com:acme/order-service.git",
  "developBranch": "feature/demo",
  "submitUser": "alice",
  "strategyCodes": [8, 11]
}
```

`detectType` values: `TEST_PLAN`, `GIT_BRANCH`, `SKILL_DIRECT`.
