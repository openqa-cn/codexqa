# Severity Levels

| Level | Definition | Action |
|---|---|---|
| P0 | Can cause financial loss, data corruption, or security breach | Fix immediately (advisory; human decides gate) |
| P1 | High risk of production defect | Fix before merge |
| P2 | Potential risk or clear code smell | Should fix |
| P3 | Advisory / suggestion | Optional |

Grading hints:
- P0: RCE/SQLi/auth bypass/data loss paths, unguarded concurrent money/stock mutation.
- P1: NPE on reachable paths, resource leaks in loops / hot paths, transaction boundary violations.
- P2: logic edge cases, fragile error handling, layering violations, occasional resource mishandling.
- P3: naming, minor duplication, TODO/FIXME in touched code.
