# Success-Metrics Grid

Orthogonal to ISO 25010 NFR: NFR asks system quality (speed, stability); this grid asks whether the product succeeded. A missing KPI is `Trace=metric` + `QualityChar=Verifiable`, not NFR `functional_suitability`. Do not add a second “completeness lacks KPI” row for the same topic.

Conclude each cell (measurable / written-but-untestable / missing / not-applicable):

| Cell | Passing question | On failure |
| --- | --- | --- |
| North-star | Which one core metric will decide “it worked”? | `Trace=metric`, `missing` |
| Quantified target | Is there a number (e.g. 30-day conversion ≥ X%)? | Direction words only → `untestable` / `no-oracle` |
| Data source | Which table, event, or owner produces the number? | No source → not an executable P0 |
| Time window | How long after launch, against what baseline? | Missing time → gap, usually P1 |
| Negative / guardrail | Which current core metric must not get worse? | Missing on money/main path → raise P1 |

If a release decision depends on success and the north-star or data source is missing → P1. Do not invent metric names or thresholds.
