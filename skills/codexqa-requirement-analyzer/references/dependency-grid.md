# Dependency Grid

Fold plan-class material into five cells. If owner or ready date is missing, **do not** mark dependencies aligned and do not set that item `aligned`.

| Cell | Must answer | Register |
| --- | --- | --- |
| Upstream | Which teams / systems / APIs are required? | Unnamed → `Trace=dep`, `missing` |
| Downstream | Which downstream businesses or contracts change? | External contract exists but unstated → P1 |
| Data and tracking | New events or warehouse work? Who owns it? | Has a KPI but no event → merge with the `metric` topic |
| Sequence | Must features ship in a fixed order? | Order without a gate → `project-schedule` |
| Owner + ready date | Owner and expected ready date per dependency | Either missing → not “aligned” |

If it blocks test start or integration → `RiskClass=project-dependency` in section 6. If it does not block release → P2, still write the grid. “Needs coordination” is not an identified dependency.
