# Dimension card: Error handling / resilience

Source: Codacy Error Handling; DEV Correctness (resilience subset). Heuristics
only — not a runtime chaos verdict.

| Field | Value |
|---|---|
| id | `resilience` |
| title | Error handling / resilience |
| order | 5 |
| modes | pr, full |
| finding_category | `resilience` |
| algorithm | derive (`14-resilience-signals.json`) + reuse `04-changed-files` + on-disk bounded read |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Silent swallow** — Empty / bare catch, ignored errors, or `pass`/`continue` with no log/rethrow/metric?
2. **Timeouts** — Remote/IO/client calls without nearby timeout / deadline / `context` cancel clues?
3. **Retries** — Retry loops without max attempts / backoff / jitter (unbounded or tight spin)?
4. **Degradation / circuit break** — Critical remote paths with neither fallback/degrade nor breaker clues? (residual when thin; see `residual_hardening[]`)
5. **Partial failure** — A batch or fan-out continues after one item fails (no break, no collected error, no batch compensation). Sequential `for` loops count, not only `Promise.all`. The “no per-item balance check” form is `BIZ-004` on Correctness; do not file both for the same loop.
6. **Idempotency & compensation** — Retry / MQ / payment paths without idempotent key / dedup / compensate / saga clues?

## Detection rules

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `ERR-001` | hygiene | P2 | Bare `except`/`pass` or catch-and-ignore on a path that persists money, auth, or messages, then returns OK or commits. Also: exception `getMessage` / stack trace returned to the caller. Also: a new exception built only from the message (`new RuntimeException(e.getMessage())`, `new Error(err.message)`, `raise Foo(str(e))` without `from`, `fmt.Errorf("%s", err)` / `errors.New(err.Error())`, PHP `new Exception($e->getMessage())`, Ruby `raise e.message`) so the original type and stack are dropped. | Logged and re-raised with the original exception as the cause (`initCause`, cause argument, `%w`, `raise ... from`, JS `cause:`). An expected probe error with an explicit fallback. Generic client error code with server-side log only. |

`charset_gaps`, `null_deref_gaps`, and `authz_audit_gaps` are extra arrays on this file. They do not change swallow/timeout matching. File them on Correctness or Security as the rule id says. A legacy pack without the keys is a WARN to re-derive, not proof the shape is absent.

`silent_swallows` is the hard gate for the empty-catch signature. `exception_unwraps` is the hard gate for message-only rethrow and is a separate finding from an empty catch on another line. Escalate `ERR-001` to P1 when that path then commits money, auth, or a message. Business idempotency (`BIZ-001`) and payment TOCTOU (`PAY-001`) stay on Correctness — do not file them again as Resilience. `resource_leaks` in the same file are `RES-001` on Correctness, not a second resilience card.

## Split vs Correctness / Concurrency / Observability

| Sibling | Owns | This card owns |
|---|---|---|
| Correctness | Logic bugs, edge cases, wrong state transitions | Failure-path *policy*: timeout, retry, swallow, degrade, partial fail |
| Concurrency | Races, locks, memory visibility | Idempotency/compensation under retry/MQ (not lock correctness) |
| Observability | Missing logs/metrics/traces on new failure paths | Silent swallow (no handle *and* no signal) — escalate once, prefer `resilience` when swallow is the defect |
| Security | Auth / injection / secrets | Do not re-litigate here |

Do **not** re-open Design fit / Complexity / Dependencies / Privacy findings as resilience.

## Soft thresholds (auditable heuristics)

| Signal | Attention | Elevated |
|---|---|---|
| Empty / bare catch; catch-all with only `pass`/`continue`/empty body; Go ignored `err` without check | P2 | Entry-reachable or pay/MQ surface → P1 |
| Remote/HTTP/**JDBC**/SQL/Redis/gRPC/client call neighborhood (≤4 lines, comments stripped) lacks timeout/deadline/`WithTimeout`/`setQueryTimeout`/`context.WithDeadline` — includes `DriverManager` / `PreparedStatement` / `createStatement` / `JdbcTemplate` | P2 | Entry or money path → P1 |
| `retry` without `max`/`attempts`/`backoff`/`jitter`/`sleep` clue in neighborhood (comments stripped) | P2 | Unbounded + pay/MQ → P1 |
| `Promise.all` / multi-fan-out without `allSettled` / per-item catch / partial-result handling | P2 | — |
| Retry or MQ consumer / payment write without `idempot` / `dedup` / `compensate` / `saga` / `exactly.?once` clue in change set | P2 | Payment / wallet / inventory → may raise P1 |
| Degradation / circuit-breaker libraries present (`CircuitBreaker` / hystrix / resilience4j / `@Fallback` / `FallbackFactory` — **not** bare `fallback=` params) | Positive note (not a finding) | On a path that already retries, writes a batch, or moves money, absence is `protection_gaps` (`visible_absence`) and must be a finding or a `line_skips` note. A lone remote call with none of those stays `residual_hardening`. A max attempt count does not close a retry that has no backoff (`retry_without_backoff`). |
| Hit is clearly auth/token/secret/injection | — | **Skip** — Security owns |

Confidence default `medium`. No network chaos / SLO probes. Never invent “production-proven resilience”.

## Evidence map

| Signal | Source |
|---|---|
| Changed source files | `04-changed-files.json` (full: sample / bounded enum) |
| File bodies | `manifest.repo` or `--repo` bounded read |
| Optional context | `05-changed-symbols` / diffs for high-risk symbols (reviewer reuse; derive does not call CodexQA) |

## Severity

| Default | Escalate | Almost never P0 |
|---|---|---|
| P2 | Silent swallow or unbounded retry on entry/pay/MQ; missing idempotency on money retry | P0 left to confirmed data corruption / double-charge with graph + domain evidence |

## Output

- Always evaluate Resilience into `review-conclusion.json` (findings **or** `ok`/`none`
  + short signal summary from `14-resilience-signals.json`).
- **Report/HTML:** include only when `verdict` is `concern`/`unknown` (omit clean).
  Concern cards **must** include `risk`（具体代码风险说明）.
- **Hard gate (signal → finding):** family F2 in [rule-construction.md](../rule-construction.md). If any of `silent_swallows`, `timeout_gaps`, `retry_risks`, `partial_failure_gaps`, `idempotency_gaps`, `exception_unwraps` has a row with `disposition: report`, you **must not** emit Resilience `None`. Only an explicit `report` row is a visible P0/P1/P2 finding. A row with no `disposition` is unstamped: re-run `scripts/lib/derive_triage.py` on that file before review. Do not treat it as report and do not drop it. `disposition: suspect` is reviewed only via `derive_suspects` and [prompts/derive-suspect-pass.md](../../prompts/derive-suspect-pass.md). `disposition: drop` is not a finding; `triage_reason: residual_clue` belongs in `residual_risks`. `exception_unwraps` is `ERR-001`. `resource_leaks` is `RES-001` (`category: correctness`) and must be filed even when Resilience is otherwise clean when the row is `report`. `disabled_bounds` is `BND-001`: a deadline or switch set to zero, negative, an unbounded sentinel, or a fixed boolean is a finding, not a residual, even when the setter is called. `retry_side_effects` is `BIZ-001`: a max attempt count does not clear a retried write or notify that has no idempotency key. `shared_mutables` is `CONC-003` and is not absorbed by a log-sink card. `process_defaults` is `GLOB-001`. `residual_hardening` stays residual (not automatic P1) but must still appear in the report residual section when non-empty. A disabling literal must not be parked only in `residual_risks`.
- Optional `resilience` object on `review-conclusion.json` (see template).
- Include `resilience` in `dimensions_covered`.

## Heuristic hygiene

- Go `_, err` / ignored-error scan applies to **`.go` files only**.
- Skip `import` / `using` / `require(` lines for REMOTE_CALL and RETRY_HINT (type imports must not flood the 20-hit cap).
- Detect spin loops `for (;;)` / `while (true)` without bound clues as `spin_loop_unbounded`.
- `residual_hardening` is **per remote call site** (neighborhood lacks degrade), not whole-file: one `@CircuitBreaker` elsewhere must not wipe other remote gaps.

## Non-goals

- No live load / chaos / SLO measurement; no inventing latency budgets.
- No full-tree AST; no `node_modules` walk; no extra CodexQA; do **not** raise `TOP_N` / `REACH_DEPTH`.
- Missing `14-…` → thin review or None; validate WARN only.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
- No resilience heuristics hit → explicit None (not a failure).
