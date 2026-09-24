# Dimension card: Concurrency / consistency

Races, lock order, and shared mutable state. Retry/MQ idempotency and payment
TOCTOU stay on Correctness (`BIZ-001`, `PAY-001`) and Resilience so the same
locus is not filed twice.

| Field | Value |
|---|---|
| id | `concurrency` |
| title | Concurrency / consistency |
| order | 10 |
| modes | pr, full |
| finding_category | `concurrency` |
| algorithm | reuse (diffs + edges-in) + these rules |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Check-then-act** — Is shared stock, balance, or a flag read and then written with no atomic guard?
2. **Lock order** — Can two locks be taken in opposite orders?
3. **Shared mutables** — Is a module-level dict, list, or counter written from request handlers or workers with no lock?

Apply when the language or the domain implies threads, coroutines, or concurrent requests. A purely single-threaded local helper with no shared state → `none`.

## Detection rules

Index: [dimension-registry.md](../dimension-registry.md). Set optional `rule_id`.
These three rules are business rules. Judge them only in [prompts/business-logic-pass.md](../../prompts/business-logic-pass.md) using the records in [business-rule-records.md](../business-rule-records.md). Do not judge them while filing SAST rows.

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `CONC-001` | concurrency | P1 | Read stock, balance, or a flag into a local, compare it, then write a new value. No compare-and-swap and no `UPDATE … WHERE qty >= n`. File this even when `TXN-001` also applies to a second write: the race and the missing transaction are different. | Atomic `UPDATE` with a WHERE guard; a properly locked critical section that covers the read and the write; immutable values. `narrowed_by` skips this id only for the same write. |
| `CONC-002` | concurrency | P1 | Two or more locks acquired in different orders across functions (A then B vs B then A); nested locks with no global order. | A single lock; a documented hierarchy that the acquisitions follow; lock-free immutable snapshots. |
| `CONC-003` | concurrency | P1 | Two shapes. A module-level dict, list, or counter mutated from handlers or workers with no lock. A static or long-lived mutable that is not thread-safe (formatter, calendar, generator, plain map) used from those paths with no lock. A log line that prints through it does not close this row. | `Lock` / mutex / concurrent map / copy-on-write; thread-local or request-scoped objects. |

## Split vs siblings

| Sibling | Owns | This card owns |
|---|---|---|
| Correctness | `PAY-001` TOCTOU, `TXN-001` transaction boundary, illegal states | Generic shared-state check-then-act and lock bugs |
| Resilience | Idempotency key missing on retry/MQ (`BIZ-001` if it is the business mutation) | Memory visibility and lock correctness |
| Performance | Unbounded caches as alloc cost | Unbounded caches that are also racy — file `CONC-003` when the defect is missing synchronization; mention the bound in `fix` |

## Evidence map

| Signal | Source |
|---|---|
| What changed | `diffs/*.diff.json` |
| Shared callers | `impact/*/edges-in.json` |
| Language focus | `09-language-profile.json` |

## Severity

Default P1. P0 only when the race is a reproducible double charge or lost update on a money/stock path **and** `PAY-001` does not already cover that line.

## Output

- Always evaluate Concurrency (findings **or** `ok`/`none`).
- `category: concurrency` plus `rule_id`.
- Include `concurrency` in `dimensions_covered`.

## Non-goals

- No thread-schedule proof and no invented deadlock trace.
- No extra CodexQA calls.

## skip_when

- Blocked pack / missing CodexQA engine.
- No shared mutable state and no locks in the change → explicit `none`.
