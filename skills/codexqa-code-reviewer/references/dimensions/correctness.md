# Dimension card: Correctness / state

Logic, null, resource, business-rule, and transaction defects that symbol-diff
plus callers can show. Language-family rows live in
[correctness-family-checks.md](correctness-family-checks.md). Failure-path
**policy** (timeout, retry, swallow) stays on Resilience.

| Field | Value |
|---|---|
| id | `correctness` |
| title | Correctness / state |
| order | 4 |
| modes | pr, full |
| finding_category | `correctness` |
| algorithm | reuse (`diffs/*.diff.json`, `05-changed-symbols`, edges-in) + these rules |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Changed logic** — Does the diff invert a condition, use the wrong variable, or move a bound (`<` vs `<=`)?
2. **Null / absence** — Is a map, Optional, or JSON field used after a guard was removed?
3. **Resources** — Is a file, socket, cursor, client, or listener left open on the error path?
4. **State machine** — Can capture/refund/ship/cancel run from a terminal or illegal status?
5. **Money and transactions** — Are multi-step writes, charges, and refunds atomic and recomputed on the server?

Also apply the family checklist (equality, money decimal, CME, overflow, half-open ranges) when `review_language_focus` matches.

## Detection rules

Index: [dimension-registry.md](../dimension-registry.md). Set optional `rule_id`.
Skip do-not-report cases. One finding per file:line. New or edited rows follow
[rule-construction.md](../rule-construction.md). Scanner rows are a subset of
the look-for shapes. A hit on one shape does not close the rule.

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `NULL-001` | null_safety | P1 | Family F1. A value that may be absent (map/query/JSON/Optional/parse/find result) flows into a strict consumer (constructor, call, unbox, field read, arithmetic) with no absence check. Illustrations: `new BigDecimal(map.get(...))`, `Integer.valueOf`, `getBalance` on a load result. File every such line, not only load-then-dereference rows. | An explicit null/Optional check already wraps the use. |
| `RES-001` | resource_leak | P1 | File, socket, DB cursor, or HTTP client opened and not closed on the error path; missing `with` / `try-finally` / `defer`; listener registered with no unregister. Also: this type creates an owned worker pool (`Executors.new*`, `ThreadPoolExecutor`, `ForkJoinPool`, Python `ThreadPoolExecutor` / `ProcessPoolExecutor` / `multiprocessing.Pool`, `new Worker(`, `cluster.fork`, Rust `ThreadPoolBuilder` / `tokio::runtime::Builder`) and the same file never shuts it down. | `with open`, `defer Close`, or try-with-resources already covers every path. A pool closed in the same file (`shutdown` / `shutdownNow` / `close` / `terminate` / `Join` / `with Pool` / `using`) or injected from outside. |
| `LOGIC-001` | logic | P2 | Off-by-one loop bound after the edit; inverted `if`; copy-paste of the wrong variable; `<` vs `<=` on a boundary. A slice that asks for N items but returns N+1, or a start index that goes negative. | Style-only rename; inclusive/exclusive range documented in a comment next to the code. |
| `BIZ-001` | logic | P1 | The mutating handler itself has no idempotency key or unique business id, so submitting the same transfer/order/charge again repeats the debit or credit. A gateway retry with no key is this rule when the write is not keyed. Do not stop at “the retry loop has no sleep”. | GET/list; unique constraint already on `payment_id` / `request_id` / `transferId`; documented one-shot internal job. |
| `BIZ-002` | logic | P1 | Family F4. A status-changing write (reverse, refund, void, cancel, settle, capture, or a second post) does not read the previous status and does not repeat the forward path’s limit and permission checks. | Explicit allowed-transition map; `WHERE status IN (...)`; the forward authz and limit checks run again. `narrowed_by` skips this id only when that id already describes the same write. |
| `BND-001` | logic | P1 | Family F3. A named bound, expiry, timeout, flag, or rounding mode is declared and the decision does not read it, so a stale or default value is still used. A stored fetch time that is never compared to the expiry is this row. | The decision reads the symbol. Host and URL literals stay on `env_config_gaps`. Cache growth with no expiry symbol stays on the performance unbounded-allocation row. |
| `BIZ-003` | logic | P2 | Money or quantity has no explicit reject for null, negative, and zero, or a cutoff uses the server default timezone. A null that throws and becomes a generic error is still this row. | An explicit check rejects null and `<= 0`. A throw is not that check. Documented zone on the clock. A record `sast_class` stays on that SAST class. |
| `BIZ-004` | logic | P1 | Either the loop writes an item with no per-item precondition, or a failure does not stop later items. A callee catch that returns normally means the caller continues. | Each item is checked, and the loop stops or records the failure. No catch in the loop is not itself a stop. |
| `BIZ-005` | logic | P1 | A `@Deprecated` or legacy balance/amount getter is still used to decide a debit or credit. Ask whether that legacy value includes holds or frozen funds, so the posted amount is not the spendable balance. | The posting path reads the current available balance, and holds are subtracted before the check. “The method is deprecated” with no money consequence is not this rule. |
| `TXN-001` | transaction | P1 | Several DB writes that must succeed or fail together, with no begin/commit; partial update on error; read of uncommitted state across services treated as atomic. | Single-statement write; an explicit transaction already wraps the unit of work. Do not use this id for a check-then-act race (`CONC-001`) or a missing idempotency key (`PAY-001`). |
| `PAY-001` | transaction | P0 | The business id (`transferId`, `payment_id`, idempotency key) is only logged or is not unique, so submitting the same payment again debits or credits again. Includes SELECT-then-INSERT without a unique constraint. | `INSERT … ON CONFLICT`; unique `(merchant, key)`; an in-progress/completed state machine rejects the second submit. A retry loop with no backoff is not this rule by itself. |
| `PAY-002` | transaction | P0 | Request `amount` / `currency` / `fxRate` is used to post value with no server-side recompute from cart, order, or price list. | Amount taken from a server-side order snapshot; client amount or rate compared and rejected on mismatch. |
| `PAY-004` | transaction | P1 | Webhook trusts the body with no provider signature check, or credits the ledger on every delivery with no idempotent event id. | HMAC/signature checked against the provider secret; `event_id` unique before credit. |
| `PAY-005` | transaction | P1 | Two shapes, filed separately. An irreversible local post happens before the external acknowledgement and no pending or held state exists. Compensation uses a different account or amount from the post. | Per shape: a pending or held state is recorded before the call; compensation reverses the account and amount that were posted. |
| `PAY-006` | transaction | P1 | Refund, void, or reverse does not check the original payment state (can reverse a transfer that never succeeded) and does not reuse the forward path’s limit and authz checks. | `WHERE status IN` the allowed set; `remaining_refundable` tracked; the forward checks run again. |
| `PAY-007` | transaction | P1 | FX or money multiply/divide uses a truncating mode (`DOWN`, `FLOOR`, cast to int) and the dropped remainder is not posted to a suspense or rounding account. | The mode is documented and the remainder is stored; `HALF_UP` / bankers rounding with no lost cent. |

`CONC-001` is the balance/stock check-then-act. File it even when `TXN-001` is also filed for the two writes. When the missing guard is “same business id submitted twice”, file `PAY-001` or `BIZ-001`, not `CONC-001`.

`14-resilience-signals.json` also carries correctness rows that are not resilience policy: every `charset_gaps` row (`getBytes()` with no charset), every `null_deref_gaps` row (`NULL-001`), and every `resource_leaks` row including `close_not_in_finally` (`RES-001`, stream closed only on the success path or not closed). One finding does not cover a second row. These arrays do not replace the existing swallow/timeout gates.

Before finishing Correctness, `NULL-001` and `RES-001` signal rows are `hit` or `skip` from `null_deref_gaps` and `resource_leaks`. Shapes those arrays did not emit are judged only in [prompts/business-logic-pass.md](../../prompts/business-logic-pass.md) using [business-rule-records.md](../business-rule-records.md). Business ids in this table (`LOGIC-001`, `BND-001`, `BIZ-*`, `TXN-001`, `PAY-*`) use that same pass. A record’s `sast_class` stays on SAST. A record’s `narrowed_by` skips only the same write.

Family rows **Null unboxing** and **Resources** are the language-shaped forms of `NULL-001` and `RES-001`. File the policy id, not a second finding.

## Split vs siblings

| Sibling | Owns | This card owns |
|---|---|---|
| Resilience | Timeout, retry, swallow, degrade (`ERR-001`) | Business idempotency and transaction boundaries (`BIZ-001`, `TXN-001`, `PAY-*`) |
| Concurrency | Lock order, unsynchronized shared mutables (`CONC-002`, `CONC-003`) | Payment TOCTOU and illegal payment states |
| Security | IDOR, tenant predicate, injection | Server-side amount and webhook signature (`PAY-002`, `PAY-004`) |
| Performance | N+1 / allocation | Not query-shape cost |
| Contract | Public field/enum removal (`API-001`) | Behavior bugs that are not a versioned API break |

## Evidence map

| Signal | Source |
|---|---|
| What changed | `diffs/*.diff.json` |
| Symbols | `05-changed-symbols.json`, `08-hot-but-thin.json` |
| Callers | `impact/*/edges-in.json` |
| Dense small methods | `11-complexity-signals.json` (`decisions >= 10` or `nest_max >= 5`) |

## Severity

Use the rule default. Raise `PAY-*` / `TXN-001` / `BIZ-002` when the path is entry-reachable or a money write. `LOGIC-001` stays P2 unless the boundary is a money or auth decision (then P1).

## Output

- Always evaluate Correctness (findings **or** `ok`/`none`).
- Concern cards need plain-language `risk`.
- `category: correctness` plus `rule_id` when a row matches.
- Include `correctness` in `dimensions_covered`.

## Non-goals

- Do not re-badge timeout/retry/swallow as correctness.
- No extra CodexQA calls. Missing graph support → cite the diff and set confidence.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
