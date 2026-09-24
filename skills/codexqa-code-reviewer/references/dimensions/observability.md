# Dimension card: Observability

| Field | Value |
|---|---|
| id | `observability` |
| title | Observability |
| order | 13 |
| modes | pr, full |
| finding_category | `observability` |
| algorithm | derive (`16-observability-signals.json`) + patch/diff reuse |
| max_extra_codexqa | **0** |

## Questions

1. Do new/changed `catch` / `except` paths log or emit metrics/traces?
2. Are failure paths visible without relying on silent swallows (see Resilience)?

## Soft thresholds

| Signal | Default |
|---|---|
| Catch/except neighborhood without log/metric/trace/Sentry clues | P2 (P1 if entry/pay) |
| `uncontrolled_log_sinks`: a `Logger` / `AuditLog` method (`info`/`warn`/`error`/`debug`/`trace`/`fatal`/`audit`/`log`) whose body is only stdout (`System.out`/`System.err`, `console.*`, `fmt.Print`, `print`/`puts`/`echo`/`NSLog`/`Console.WriteLine`) | P2 (P1 on a payment or audit path) |

## Output

- Cover Observability: findings or None from `16-observability-signals.json`.
- Silent swallow without any signal → prefer `resilience`; missing log on handled catch → here.
- **Hard gate:** non-empty `uncontrolled_log_sinks` must become an observability finding with `path:line`. Do not re-file plaintext PII that Privacy already owns; this hit is the sink, not the field. A static formatter or other shared mutable used by that sink stays `CONC-003` (`shared_mutables`). Do not fold it into the sink card.

## Non-goals

No live APM queries; no extra CodexQA. Missing `16-` → WARN only.
