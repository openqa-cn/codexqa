# Dimension card: Security / sensitive

Graph-backed security review. Detection rules below are the residual authz,
tenant, and secret-hygiene checks. Pattern-class defects (SSRF, path traversal,
pickle, weak hash, float money, SQLi, command injection, XSS, hardcoded secrets)
come from the deterministic SAST pass (`23-sast-signals.json`), not from the LLM.

| Field | Value |
|---|---|
| id | `security` |
| title | Security / sensitive |
| order | 6 |
| modes | pr, full |
| finding_category | `security` |
| algorithm | reuse (`06-sensitive-hits.json` + `07-tags.json` + edges-in) + derive `23-sast-signals.json` |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Sensitive intersection** — Do `06-sensitive-hits.json` hits meet changed symbols or edges-in callers? Escalate when an entry tag or reach path exists.
2. **Authz on new routes** — Does every new HTTP/RPC handler (except documented health) check a server-side principal?
3. **Object and tenant scope** — Can a caller address another user’s or another tenant’s id?
4. **SAST pattern hits** — Read `23-sast-signals.json`. File each `disposition: report` row once. Ignore `drop`. Send only `suspects[]` to the SAST suspect pass. Do not ask the LLM to rediscover a reported class.
5. **Secrets** — gitleaks / `hardcoded_secret` rows in that file; residual logging of tokens stays `HYG-001` only when no SAST row exists for the same line.

If new auth/pay/secret hits contradict a T2/T3 lock, re-tier upward per the risk-tier card.

## Detection rules

Index: [dimension-registry.md](../dimension-registry.md). Set optional `rule_id`.
Skip the rule’s do-not-report cases. One finding per file:line and vulnerability class.
New or edited rows follow [rule-construction.md](../rule-construction.md). A hit on
one shape does not close the rule. Judge `SEC-001`, `AUTH-*`, `TEN-*`, and
`HYG-001` only in [prompts/business-logic-pass.md](../../prompts/business-logic-pass.md)
using [business-rule-records.md](../business-rule-records.md). Do not judge them
while filing SAST rows. A line already in `authz_audit_gaps` is the `TEN-006`
relation; do not file that relation again. A different id on the same line,
including `AUTH-002`, is still a finding. `process_defaults` rows are `GLOB-001`: replacing a process-scoped default is its own finding. An insecure certificate check filed by SAST stays that class; do not drop the process-wide assignment because the certificate card exists.

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `SEC-001` | security | P0 | Residual authz only: new HTTP/RPC route with no authz; client-supplied role flags; middleware that skips auth on OPTIONS, a debug flag, or an internal header without a strict allowlist. | Documented public health/readiness. CORS preflight that still authenticates the real method. Scanner-shaped defects are not this rule: `report` rows are already cards, `suspect` rows use the SAST suspect pass, and `allow` does not rescan the class. |
| `AUTH-001` | security | P0 | Fetch/update/delete by a request id with no ownership check, a check on the wrong object, or a check skipped on the error path. Every object the write touches is its own hit. A two-party transfer that authorizes only one party leaves the other party open. An `OR` that treats “not restricted” as enough allows another branch or tenant. | The check covers every mutated object. One party's check does not close the other. Documented public resource. |
| `AUTH-002` | security | P0 | Role, user id, `isAdmin`, or tenant is taken from the header, body, or query and used as the principal. A role check uses `contains` / `includes` / `indexOf` / substring, so a name that merely contains the admin token is treated as admin. Same line as `TEN-006` is still this finding. | Value taken from a verified token/session and compared with equality; client value used only as a selector then re-checked against membership. |
| `TEN-002` | security | P0 | The type has a tenant/org field, but get/filter/update/delete by id does not use `tenant_id` / `org_id`. | Query always ANDs tenant from server context; RLS for the request role; a truly global catalog. |
| `TEN-004` | security | P1 | An executor, callback, or message carries a business id and does not carry tenant, actor, and trace. The worker does not need to load a row. A log of that id is enough. | Payload carries tenant, actor, and trace, and the worker rebinds them. |
| `TEN-005` | security | P0 | Reverse, refund, or fetch by `transferId` / object id with no tenant check, so one tenant can act on another tenant’s row. | Composite `(tenant_id, id)` enforced; mismatch returns 404. |
| `TEN-006` | security | P1 | An admin or impersonation branch returns success for any tenant and writes no audit of who, which tenant, and which objects. `authz_audit_gaps` in `14-resilience-signals.json` is this row. Same line as `AUTH-002` is still this finding. | Every cross-tenant path writes an audit record before data access; break-glass requires a ticket id. |
| `HYG-001` | hygiene | P2 | Family F1. A secret, token, or personal identifier reaches a human-visible sink (log, receipt, message, stdout) or a shell command is built from caller input. Illustrations: hardcoded key material, `subprocess`/`shell=True` with interpolation, plaintext card or account data in an audit line. | Redacted logging helpers; empty or placeholder literals (`""`, `"changeme"`, `"TODO"`). Privacy may file the same line for lifecycle. Do not drop this finding because privacy already filed. Scanner `hardcoded_secret` on the same line stays the secret card; do not add a second hygiene card for that same literal. |

`PAY-004` (webhook signature / duplicate credit) and `PAY-002` (client amount) are transaction rules on the [correctness](correctness.md) card. Do not re-file them here unless the defect is a different class (for example a missing authz check, which is `SEC-001` / `AUTH-*`).

## Split vs siblings

| Sibling | Owns | This card owns |
|---|---|---|
| Privacy | PII lifecycle, redacted logs of personal data | Secrets, authz, injection, tenant isolation |
| Correctness | Payment amount recompute, webhook credit idempotency, state machines (`PAY-*`, `TXN-001`, `BIZ-*`) | Auth bypass and cross-tenant access on those paths |
| Design fit | Layering / cross-layer imports (`ARCH-001`) | Auth skip via debug flag, internal header, or OPTIONS (`SEC-001` / `ARCH-001` authz half — file **here** when the defect is missing authz) |
| Resilience | Swallow / timeout / retry policy (`ERR-001`) | Not failure-policy smells |

## Evidence map

| Signal | Source |
|---|---|
| Sensitive names | `06-sensitive-hits.json` |
| Entry | `07-tags.json`, `impact/*/paths/` |
| Callers | `impact/*/edges-in.json` |
| What changed | `diffs/*.diff.json`, bounded source under `manifest.repo` |

## Severity

| Default | Escalate | Cap |
|---|---|---|
| Rule `severity_default` | Entry-reachable IDOR, injection, or missing authz stays P0 | `stubs>=20` → blast-radius confidence `UNKNOWN`; the local defect can still be filed from the diff |

Confidence default `medium` for a cited diff, `high` when edges-in shows an entry caller.

## Output

- Always evaluate Security into `review-conclusion.json` (findings **or** `ok`/`none`).
- **Report/HTML:** only when `verdict` is `concern`/`unknown`.
- Each finding sets `category: security` and `rule_id` when a row above matches.
- Include `security` in `dimensions_covered`.

## Deterministic SAST (secondary)

`scripts/lib/derive-sast.sh` writes `23-sast-signals.json` during collect.
Before the scan it **must** run `scripts/lib/install-sast-tools.sh` for every
missing binary among Semgrep, Bandit, gosec, gitleaks, osv-scanner, ruff, and
eslint. A real review does not leave `tools.<name>.status=missing` without
that install attempt. CodexQA remains the primary engine.

| Owns (do not re-file from the LLM) | Examples |
|---|---|
| `ssrf` | User-controlled URL fetched server-side |
| `path_traversal` | `../` or `new File` / `os.path.join` with request input |
| `pickle` | `pickle.loads`, `ObjectInputStream` |
| `weak_hash` | MD5 / SHA-1 |
| `float_money` | `float` / `double` used as amount, price, or balance |
| `sqli`, `command_injection`, `xss`, `hardcoded_secret` | Clear pattern hits from the tools or the local pattern scan |

ruff/eslint style hits stay in `lint_notes` (not P0/P1). ruff `S*` and eslint security rules are findings. OSV rows use `category: dependencies`, `triage_channel: sca`, and `disposition: report`. They are not SAST suspects. A Semgrep or Bandit hit with low confidence, or a name-only match with no sink, is `suspect`. A recorded dataflow trace is `report`.

## Non-goals

- Do not treat SAST as the primary backend. A missing CodexQA pack is still blocked.
- No invented CVEs. OSV rows must come from `osv-scanner` output in `23-sast-signals.json`.
- No extra CodexQA calls.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
