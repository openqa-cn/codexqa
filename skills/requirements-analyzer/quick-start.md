# Requirements Analyzer: Quick Start

Use `requirements-analyzer` to fold requirement materials into one gap register with verification items.

## 1. Prepare the Minimum Context

Provide what you have:

- requirements / stories / acceptance criteria
- API or data constraints
- scope, version, environment, timebox
- known failures or stakeholder concerns
- optional role reports with `source_role`

If a class is missing, still ship a first draft and mark the gap.

## 2. Invoke

```text
/requirements-analyzer
Source A (PRD): submit is allowed when stock is insufficient; reserve later in the backend.
Source B (API): insufficient stock returns 400 and must not create an order.
Run the full 7-section pipeline. P0 items must include verification fields.
```

## 3. Execution Order (do not skip)

1. Five-class intake: scope → behavior → constraint → plan → risk
2. Input audit (completeness / credibility / recency / comparability)
3. Single register (`RA-xx` + Status)
4. Risks and testability
5. P0/P1 verification column
6. Blockers and next actions

## 4. Check

- [ ] Exactly one register
- [ ] Conflicts include source pairs and are not marked aligned
- [ ] P0 items include preconditions / stimulus / expected / evidence
- [ ] Section 6 is present
- [ ] Assumptions and gaps are marked
