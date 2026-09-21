# FAQ

## How does this relate to the three older skills?

- Full quality-and-risk analysis: use this skill.
- Quick single-source scope read: `requirements-analysis` is still fine.
- Gap execution items without a cross-check register: `requirement-gap-analysis` is still fine.
- Multi-source cross-check without verification columns: `requirements-analysis-plus` is still fine.

This skill does not read those skills' internal files.

## Does a single source still need a register?

Yes. Internal contradictions are `conflict` or `missing`. The cross-check layer can be thinner, but the section set must not change.

## Are role reports required?

No. Direct materials are enough. When present, keep `source_role` on every used item.

## Can the script output replace the analysis?

No. `scripts/run_analysis.ts` is a rule-based pre-pass. The final result must follow the 7-section prompt pipeline.
