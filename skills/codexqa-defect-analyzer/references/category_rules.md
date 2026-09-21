# Defect Categories — judgment points and examples

> **Canonical LLM policies** live in [`references/policies/`](policies/manifest.yaml) (pack v1.1.0).
> This file is a short category index. SAST-coverable issues are NOT duplicated here.

## security — SEC-* / AUTH-* / TEN-*
- Residual authz (IDOR, client-trusted role, missing tenant predicate), not pattern SSRF/SQLi.
- Policies: `SEC-001`, `AUTH-001`, `AUTH-002`, `TEN-002`, `TEN-004`, `TEN-005`, `TEN-006`

## null_safety — NULL-*
- Policy: `NULL-001`

## resource_leak — RES-*
- Policy: `RES-001`

## concurrency / transaction — CONC-* / TXN-* / PAY-*
- Check-then-act, lock order, shared mutable state; payment idempotency/ledger atomicity.
- Policies: `CONC-001`–`003`, `TXN-001`, `PAY-001`, `PAY-002`, `PAY-004`–`006`

## logic — LOGIC-* / BIZ-*
- Off-by-one; missing idempotency; illegal state; business bounds.
- Policies: `LOGIC-001`, `BIZ-001`, `BIZ-002`, `BIZ-003`

## architecture — ARCH-* / API-* / PERF-*
- Layering + auth bypass paths (`ARCH-001`; no separate AUTH-003); breaking API; N+1.
- Policies: `ARCH-001`, `API-001`, `PERF-001`

## secret / hygiene — HYG-* / ERR-*
- Policies: `HYG-001`, `ERR-001`

## Negative examples (do NOT report)
- Auto-promoted dismissed pattern: `eval() executes dynamic input — RCE risk` (dismissed ≥3×)
- TODO comments older than the diff; style-only issues; patterns explicitly listed in data/auto_rules.json.
- Patterns rejected via feedback vector store (similarity ≥ 0.9).
- Policy fixture **negative** cases under each `references/policies/<RULE_ID>.yaml`.
- Clear SAST hits (SSRF, path traversal, pickle, weak hash, float money) — deterministic layer owns those.
