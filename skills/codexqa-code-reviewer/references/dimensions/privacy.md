# Dimension card: Privacy / compliance

Source: OWASP-oriented checklists; privacy compliance review practices (GDPR-context
lifecycle: minimize, redact, retain/erase/export, consent & cross-border). Heuristics
only — not a legal opinion.

| Field | Value |
|---|---|
| id | `privacy` |
| title | Privacy / compliance |
| order | 6 |
| modes | pr, full |
| finding_category | `privacy` |
| algorithm | derive (`13-privacy-signals.json`) + reuse `04-changed-files` + optional `06-sensitive-hits` reclass + on-disk bounded read |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Minimization** — Are new APIs/DTOs/telemetry collecting more PII than needed?
2. **Logging** — Do logs/metrics print phone/email/id/precise location without redaction?
3. **Retention / erase / export** — Ask once per sink (log, mail, file, database). A delete on one sink does not close the others. On a log or receipt line, list every identifier, amount, and name in `fields`; the first match does not close the rest.
4. **Consent / cross-border** — Marketing/analytics SDK or third-party/overseas transfer without consent/purpose clues?
5. **Split vs Security** — password, token, and API-key literals stay on Security (`hardcoded_secret` or `HYG-001`). A personal identifier in a human-visible sink is family F1: file Privacy for the lifecycle and still file `HYG-001` for the sink. See the alias table in [rule-construction.md](../rule-construction.md). Do not drop either card because the other already exists.

## Split vs Security

| Security (existing) | Privacy (this card) |
|---|---|
| Auth, secrets, injection, pay | Personal data lifecycle & identifiable information |
| `06-sensitive-hits` password/token/auth/pay | PII fields, log exposure, retention gaps, consent/transfer |
| `category: security` | `category: privacy` |

Do **not** re-litigate auth/token/pay/injection here.

## Soft thresholds (auditable heuristics)

| Signal | Attention | Elevated |
|---|---|---|
| Log/print neighborhood (≤3 lines) hits email/phone/id/GPS patterns, or PII-named vars without `mask`/`redact`/`encrypt` | P2 | Entry-reachable → P1 |
| ≥ **5** new PII identifier fields in same PR without purpose/minimize clues | P2 | — |
| PII persist/save/insert and **no** delete/erase/forget/export/dsar/retention clue in change set | P2 | Account/payment master data → may raise P1 |
| Analytics/marketing SDK or cross-border/third-party transfer without consent/opt-in/purpose clue | P2 (clue only) | — |
| Hit is clearly `password`/`token`/`secret`/`api_key` | — | **Skip** — Security owns |

Confidence default `medium`. No network legal-database calls. Never invent “GDPR compliant”.

## Evidence map

| Signal | Source |
|---|---|
| Changed source files | `04-changed-files.json` (full: sample / bounded enum) |
| File bodies | `manifest.repo` or `--repo` bounded read |
| Optional reuse | `06-sensitive-hits.json` non-auth hits → `sensitive_reuse[]` only |

## Severity

| Default | Escalate | Almost never P0 |
|---|---|---|
| P2 | Clear log PII on entry path; account erase gap on master data | P0 left to confirmed regulatory breach / Security exploit path |

## Output

- Always evaluate Privacy into `review-conclusion.json` (findings **or** `ok`/`none`
  + short signal summary from `13-privacy-signals.json`).
- **Report/HTML:** include only when `verdict` is `concern`/`unknown` (omit clean).
  Concern cards **must** include `risk`（具体代码风险说明）.
- Optional `privacy` object on `review-conclusion.json` (see template).
- Include `privacy` in `dimensions_covered`.

## Non-goals

- No online GDPR/条文 lookup; no inventing compliance certificates.
- No OCR / binary / full-tree PII extraction; no `node_modules` walk.
- No extra CodexQA; do **not** expand `SENSITIVE_NAMES` / `06-sensitive` query list.
- Missing `13-…` → thin review or None; validate WARN only.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
- No PII/log/retention hits → explicit None (not a failure).
