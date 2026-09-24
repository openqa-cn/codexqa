# Dimension card: Performance (hot path / N+1 / unbounded alloc)

**Pathology signatures only** — not profiler verdicts or invented SLOs.
Complements Maintainability (TODO/magic/long-file); does not re-litigate
Complexity nesting/YAGNI or Resilience timeout/retry.

## Why this bar (industry best practice — not “exists ⇒ best”)

Selected path: **PR-gate static signatures** for known pathologies
(loop-hosted queries, unbounded list reads, hot-path allocation), with
`max_extra_codexqa: 0` polyglot heuristics.

| Criterion | Why this wins |
|---|---|
| N+1 is highest-ROI static perf gate | [n1detect](https://github.com/renaldid/n1detect), [Roslyn CI0011](https://blog.rogatnev.net/posts/en/2026/08/N-Plus-One-Problem.html), [QueryPerf](https://github.com/NetizenLabs/queryperf) — missed batch beats micro-alloc wins |
| Known pathologies: fix on sight | [sota-performance](https://github.com/martinholovsky/sota-skills/blob/main/skills/sota-performance/SKILL.md) — N+1 / unbounded cache need no profiler first |
| AI review gap | Loop-in-query often caught by stronger bots, missed by shallow review — deterministic derive fills the gap |

**Rejected:** stuffing into maintainability; inventing p99/SLO; language-only AST CI deps; LLM-only perf claims without `21-`.

| Field | Value |
|---|---|
| id | `performance` |
| title | Performance |
| order | 15 |
| modes | pr, full |
| finding_category | `performance` |
| algorithm | derive (`21-performance-signals.json`) + reuse `04` + `07-tags` + bounded on-disk scan |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **N+1** — DB/ORM/HTTP call inside loop / forEach / map without batch clue?
2. **Hot path** — Entry/handler path with N+1, sync blocking IO, or loop-heavy alloc?
3. **Unbounded allocation** — Loop string/collection growth; list query without LIMIT/take/page; cache growth without TTL/evict?

## Detection rules

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `PERF-001` | architecture | P2 | Per-item DB/RPC inside a loop, including a call hidden behind a repository or service helper, that could be one batched query. | Prefetch / `select_related` / `IN` query; a bounded tiny list with a documented reason; a cache path that does not hit the DB. |

`PERF-001` is the `n_plus_one_risks` hard gate. File those signal rows and do not judge this id again in the business-logic pass.

`unpooled_connections` (`DriverManager.getConnection` and the same direct-connect shape) is a separate hard gate. File each row even when `signals_thin` is true. Do not fold it into `n_plus_one_risks`.

`n_plus_one_risks` is the hard gate for a DB/RPC call inside a loop. A hit is a known client (`getConnection`, `db.Query` / `Exec`, `SaveChanges`, `mysqli_query`, `.objects.get`) or a persistence-shaped call: verb `find|load|save|persist|update|delete|get` plus an entity name (`Account`, `Balance`, `User`, …) in camelCase or snake_case, or a bare `save(` / `persist(`. `findAccount`, `updateBalance`, and `find_account` count. A SQL literal in the loop body is not required. One finding per site.

## Soft thresholds

| Signal | Default | Escalate |
|---|---|---|
| N+1 signature in changed source | P2 | Entry/hot path intersection → P1 |
| Hot-path expensive pattern | P1 | — |
| Unbounded alloc / unpaginated list / cache without bound | P2 | Entry-reachable unpaginated list → may P1. An expiry symbol that the decision never reads is `BND-001` on Correctness, not this row. |
| Residual / thin | residual | Never automatic P1 |

Confidence default `medium`. Never invent measured latency/QPS. Comments do not waive gaps.

## Split vs siblings

| Sibling | Owns | This card owns |
|---|---|---|
| Maintainability | TODO/FIXME, magic numbers, long files | N+1 / hot-path / unbounded alloc |
| Complexity | Nesting / method LOC / YAGNI | Loop+IO pathology, not cognitive load alone |
| Resilience | Timeout / retry / swallow / degrade | Perf cost of loops, not failure policy |
| Observability | Catch without log/metric | Not “missing metric = slow” |

## Evidence map

| Signal | Source |
|---|---|
| Changed files | `04-changed-files.json` (full: sample) |
| Entry tags | `07-tags.json` |
| Bodies | `--repo` / `manifest.repo` bounded read |

## Output

- Always evaluate Performance into `review-conclusion.json` (findings **or** `ok`/`none`
  + signal summary from `21-`).
- **Hard gate:** family F2 in [rule-construction.md](../rule-construction.md). Non-empty `n_plus_one_risks` / `hot_path_risks` / `unbounded_allocation` → a visible finding only for each row whose `disposition` is `report`, with `path:line`. A row with no `disposition` is unstamped: re-run `scripts/lib/derive_triage.py` before review. Do not treat it as report and do not drop it. `disposition: suspect` is only [prompts/derive-suspect-pass.md](../../prompts/derive-suspect-pass.md). `disposition: drop` is not a finding. Never Performance `None` while report rows remain. `residual_performance` stays residual.
- **Hard gate:** non-empty `weak_perf_tests` → a `test_gaps` finding (not a performance hotspot). This is one illustration of family F5 in [rule-construction.md](../rule-construction.md): an assertion is true without exercising the claimed cost (a duration threshold ≥ 1000 and no JDBC, HTTP, or other IO in the body). Walk the rest of F5 even when this array is empty. Do not file this row again as N+1.
- **Report/HTML:** include only when `verdict` is `concern`/`unknown` (omit clean).
  Concern cards **must** include `risk`（具体代码风险说明）.
- Optional `performance` on `review-conclusion.json`; include in `dimensions_covered`.

## Non-goals

- No profiler / load test / inventing p99.
- No go/types, Roslyn, or Prisma schema service.
- No extra CodexQA; do not raise `TOP_N` / `REACH_DEPTH`.
- Missing `21-` → thin review or None; validate WARN only.
