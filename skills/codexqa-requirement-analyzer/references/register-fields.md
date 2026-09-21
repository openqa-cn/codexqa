# Register Field Notes

Use one field set for every high-priority item. Do not open a second gap table.

| Field | Required | Meaning |
| --- | --- | --- |
| ID | Yes | Sequential `RA-01` |
| Topic | Yes | One decidable topic; do not dump a whole chapter into one row |
| Sources | Yes | Material names; role reports must include `source_role` |
| Status | Yes | `aligned` / `conflict` / `missing` / `stale` / `untestable` |
| Impact | Yes | Delivery / quality / testability: High / Med / Low |
| Priority | Yes | P0–P3, explained in section 4 with impact / likelihood / detectability |
| Question | Yes | Closable: decision criterion and suggested decider |
| Suggested owner | Yes | Role is enough |
| Suggested next action | Yes | Concrete action; ban “improve communication” |
| Preconditions / Stimulus / Expected / Evidence | Required on P0/P1 | Used to falsify, not to restate the question |
| QualityChar | P0/P1 or scan hit | Unambiguous / Singular / Complete / Verifiable / Necessary / Consistent |
| Smell | P0/P1 or scan hit | vague / optional / subjective / loophole / unbounded / compound / tbd; else `none` |
| Trace | P0/P1 or scan hit | `goal` / `rule` / `ac` / `orphan` / `metric` / `dep` |
| VerifyMethod | Required on P0/P1 | `test` / `analysis` / `demonstration` / `inspection` |
| RiskClass | Required on P0/P1 | `product-functional` / `product-security` / `product-reliability` / `product-data` / `product-ux` / `project-schedule` / `project-scope` / `project-dependency` |
| FailureMode | Required on P0 | `misinterpret` / `missed-rule` / `no-oracle` / `conflict-escape` |

## Status usage

- `aligned`: sources are comparable and agree. Do not use when stale or incomparable.
- `conflict`: at least two sources (or two places in one source) disagree.
- `missing`: a required rule is absent.
- `stale`: the material is outdated or not comparable with a newer source.
- `untestable`: a requirement is written but has no observable failure condition.
