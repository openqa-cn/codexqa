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

## Soft thresholds

| Signal | Default | Escalate |
|---|---|---|
| N+1 signature in changed source | P2 | Entry/hot path intersection → P1 |
| Hot-path expensive pattern | P1 | — |
| Unbounded alloc / unpaginated list / cache without bound | P2 | Entry-reachable unpaginated list → may P1 |
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
- **Hard gate:** non-empty `n_plus_one_risks` / `hot_path_risks` / `unbounded_allocation` → findings or deferred residuals with `path:line` — never Performance `None` while those arrays have hits.
- **Report/HTML:** include only when `verdict` is `concern`/`unknown` (omit clean).
  Concern cards **must** include `risk`（具体代码风险说明）.
- Optional `performance` on `review-conclusion.json`; include in `dimensions_covered`.

## Non-goals

- No profiler / load test / inventing p99.
- No go/types, Roslyn, or Prisma schema service.
- No extra CodexQA; do not raise `TOP_N` / `REACH_DEPTH`.
- Missing `21-` → thin review or None; validate WARN only.
