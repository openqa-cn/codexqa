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

## Output

- Cover Observability: findings or None from `16-observability-signals.json`.
- Silent swallow without any signal → prefer `resilience`; missing log on handled catch → here.

## Non-goals

No live APM queries; no extra CodexQA. Missing `16-` → WARN only.
