# Semantic candidate pass

Separate from the SAST suspect pass and from the business-logic pass. Do not
apply `BIZ-*`, `PAY-*`, `SEC-*`, or other rule ids here. Do not re-read the
repository.

## Input

Only these arrays, one row at a time. Each row already has `decision: llm`.

- `17-contract-signals.json` → `error_payload_candidates`
- `15-rollout-signals.json` → `opaque_status_candidates`

Use the File / Skip table on the contract card for the first array and the
rollout card for the second. The row’s `path` and `line` are the slice. Do
not open the rest of the file.

## Output

Record `semantic_coverage` for every row: `hit` or `skip`, plus one line.
A `hit` is a finding in `llm-candidates.json` with `source: llm_judgment`
and `category` `contract` or `rollout`. Do not set `rule_id`, `pattern_class`,
or `suspect_id`. A `skip` is not a finding. Empty arrays need no rows.

These arrays are not hard gates and do not change `signals_thin`.
Unused configuration constraints stay on `env_config_gaps`. Tests that lock
in a defect stay on the test-gap step and on `weak_perf_tests`.
