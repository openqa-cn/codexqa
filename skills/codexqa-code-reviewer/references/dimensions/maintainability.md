# Dimension card: Maintainability (P2 pass)

| Field | Value |
|---|---|
| id | `maintainability` |
| title | Maintainability |
| order | 14 |
| modes | pr, full |
| finding_category | `maintainability` |
| algorithm | derive (`18-maintainability-signals.json`) + Complexity xref |
| max_extra_codexqa | **0** |

## Questions

1. TODO/FIXME/HACK density in changed sources?
2. Magic numbers without named constants (non-port/timeout/status)?
3. Very long files (≥800 LOC in scanned window), or a file that mixes several types or several roles (`mixed_responsibility`) even when it is under that line count?

## Soft thresholds

| Signal | Default |
|---|---|
| Many TODO/FIXME in change set | P2 |
| Magic number clusters | P2 hard gate: one finding cites every `magic_numbers` `path:line` |
| `unused_accumulators` (collection only add/put, never read) | P2 hard gate: one finding per row |
| Long file ≥800 LOC | P2 |

Keep short; do not re-litigate Complexity nesting/YAGNI here — xref `11-complexity-signals.json`.

## Output

- Optional `maintainability` on conclusion; include in `dimensions_covered` when covered.
- Non-blocking P2 pass after observability.

## Non-goals

- No perf benchmarks; **N+1 / hot-path / unbounded allocation →** [performance.md](performance.md) (`21-performance-signals.json`).
- Missing `18-` → WARN only.
