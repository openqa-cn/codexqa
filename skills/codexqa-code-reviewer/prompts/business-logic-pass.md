# Business-logic pass

Separate from the SAST suspect pass. Do not judge injection, traversal, weak
hash, float money, secrets, insecure TLS, XSS, or SSRF here. Those classes
come only from `23-sast-signals.json` rows with `disposition: report` or
`suspects[]`.

Do not apply these rules while filing SAST rows. This pass is the only place
they are judged.

## Scope

One in-scope method at a time, plus the fields of its enclosing type. Do not
read other types. Truncate a method body past 400 lines and say so. When the
record says `interprocedural`, a callee in that same type is in scope.

When `24-coverage-ledger.json` marks a symbol `excluded` with reason
`branch_drift`, do not apply this list. That path is not in the three-dot PR
patch. The digest counts are the evidence for the branch-behind finding.

When a pending symbol has `rule_plan`, judge only `rule_plan.applicable`.
Each `rule_plan.skips` entry is already the skip: copy its `note` into
`rule_coverage`. Do not open the rule record again for that id. A rule that
is applicable on one symbol and skipped on another is judged only on the
applicable symbols. Identical `span_hash` values may share one judgment, but
every pending symbol still gets its own `coverage_closure` row.

## How to judge

Use only [references/business-rule-records.md](../references/business-rule-records.md).
For each changed method, apply each record below as its own question. Read
that record’s `look_for`, `do_not_report`, `fix`, `noncompliant`, and
`compliant`. Do not replace them with a paraphrase of the whole dimension card.

- `LOGIC-001`
- `BND-001`
- `BIZ-001` `BIZ-002` `BIZ-003` `BIZ-004` `BIZ-005`
- `TXN-001`
- `PAY-001` `PAY-002` `PAY-004` `PAY-005` `PAY-006` `PAY-007`
- `CONC-001` `CONC-002` `CONC-003`
- `NULL-001` `RES-001`
- `SEC-001` `AUTH-001` `AUTH-002`
- `TEN-002` `TEN-004` `TEN-005` `TEN-006`
- `HYG-001` `ARCH-001` `API-001` `GLOB-001` `DES-001`

`PERF-001` is not in this list. Rows in `n_plus_one_risks` are that rule.
Do not judge it again here.

Do not re-file the same relation already emitted as a hard-gate row
(`null_deref_gaps` including `unguarded_parse`, `resource_leaks`,
`authz_audit_gaps`, `n_plus_one_risks`, `disabled_bounds`, `retry_side_effects`,
`shared_mutables`, `process_defaults`, `prod_test_coupling`, `test_oracle_hits`).
A different `rule_id` on that line is still a finding. A skip names the
relation, not only the line number. `rule_coverage.note` lists every matching
line. One shape's line does not cover the next shape.

A hit on one object or one shape does not close that rule. File every
matching object and every matching line. A nearby finding does not close the
next line. For a signed amount with no lower bound, state how a negative value
changes which side is debited and which side is credited. If the record sets `sast_class`,
that shape stays on SAST and this id is not used. If the record sets
`narrowed_by` and that id already describes the same write on this method,
skip this id. A different write on the same method still matches.

For a batch, read the callee before deciding that failure stops the loop. A
catch that returns normally means later items still run.

Do not judge contract or rollout semantic rows, or host and URL rows in
`env_config_gaps`. Judge `BND-001` here when a declared bound is not read, and
also when the decision reads a compile-time value that disables it (zero,
negative, an unbounded sentinel, or a fixed true or false). Calling a setter
does not clear that. Tests that lock in a defect stay on the test-gap step.
`test_oracle_inventory` is answered there, one row per test method.

## Output

Add findings to `llm-candidates.json` with `source: llm_judgment`, the owner
`category`, and the `rule_id`. Do not set `pattern_class` or `suspect_id`.
Write `rule_coverage` for every id in the list above (`hit` or `skip`) in
this pass, not while filing SAST rows.
