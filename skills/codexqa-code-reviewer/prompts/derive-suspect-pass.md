# Derive suspect pass

Separate from the SAST suspect pass and from the business-logic pass.
When `29-judgment-packet.json` exists, read `suspects.packets` and `suspects.policies` there and do not open this queue. Otherwise read only `27-suspect-queue.json` when that file is in the pack. `packets` are
the derive suspects in the three-dot PR patch. `policies` is keyed by `kind`.
`omitted_branch_drift` counts suspects that sit on files the PR commits did
not touch; do not open the signal files to judge those. A legacy pack without
the queue still uses `derive_suspects[]` on the signal files (`13` through
`18` and `21`). Do not re-scan the repository for these kinds.

## Input for each row

- `derive_suspect_id`, `file`, `line`, `kind`
- `slice` (already cut)
- `policy`: `look_for`, `do_not_report`, `fix`, `noncompliant`, `compliant`

Rows with `disposition: report` are already findings. Rows with
`disposition: drop` are not findings. A `triage_reason` of `residual_clue`
belongs in `residual_risks`, not in this pass.

## Decision

True positive only when the slice matches `look_for` and not `do_not_report`.
Otherwise false positive.

A row with `close: per_line` is its own decision. A nearby finding, including a float or limit card, does not close the next line. A hit lists that line. A skip says why that line is not the defect. A file-level absence whose line is 1, or whose slice is only a package declaration, does not close the family; judge the `anchors` lines (deprecated field, flag, delete, log sink) instead.

For `magic_number`, `rate_literal`, and `decision_literal`, use `bound_read` when the packet has it. A display truncation, animation duration, formula coefficient, or minimum token length is a false positive. A true `decision_literal` sets a fee, timeout, or account limit. Confirmed magic numbers are conventions, not P0/P1/P2 findings.
`false` means the named symbol is not read on any other line: the constraint
is declared and the decision does not use it. That is a true positive. A
named constant with `bound_read: true` matches do-not-report only when its
value is not `0`, `-1`, `false`, or an unbounded sentinel. An inline literal
that decides a timeout, rate, limit, or comparison is a true positive even
when `bound_read` is absent. A number that an assertion requires is a true
positive. A port, or a literal that does not decide a result, is a false
positive. For `test_oracle`, answer the policy for that test method. A skip
must say which F5 shapes are absent. One test does not close the next.

## Output

True positives go into `llm-candidates.json` with `source: llm_judgment`,
`derive_suspect_id`, `file`, `line`, and the owner `category` for that kind.
Do not set `pattern_class` or `suspect_id`. Do not apply business rule ids here.
