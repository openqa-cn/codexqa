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
5. **Partial failure** — Batch / fan-out (`Promise.all`, `WaitGroup`, multi-call) without per-item / `allSettled` / aggregate error handling? (`errgroup` is a handling pattern, not a gap by itself)
6. **Idempotency & compensation** — Retry / MQ / payment paths without idempotent key / dedup / compensate / saga clues?

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
| Degradation / circuit-breaker libraries present (`CircuitBreaker` / hystrix / resilience4j / `@Fallback` / `FallbackFactory` — **not** bare `fallback=` params) | Positive note (not a finding) | Absence alone is residual, not automatic P1 |
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
- **Hard gate (signal → finding):** if any of `silent_swallows`, `timeout_gaps`, `retry_risks`, `partial_failure_gaps`, `idempotency_gaps` is non-empty, you **must not** emit Resilience `None`. Each hit becomes a P0/P1/P2 finding **or** an explicit deferred residual that cites `path:line` (and why deferred). `residual_hardening` stays residual (not automatic P1) but must still appear in the report residual section when non-empty.
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
