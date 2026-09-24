# Residual read pass

Run after the four existing channels and before merge. This pass does not
replace them. SAST `disposition: report` rows stay baseline findings. Do not
re-find those SAST classes. `disposition: drop` stays discarded.

## Queue

When `29-judgment-packet.json` exists, `pending`, `read_groups`, and `skip_notes` come from that file. `read_groups[].text` is the one read of `paths[0]`. Do not open `paths` after the first, and do not open the source file again. Otherwise read `28-symbol-bundle.json` when it exists: `pending`, `read_groups`, and `skip_notes`. Otherwise read `24-coverage-ledger.json`.

- When `read_groups` is present, open each group once. The `paths` in a group are byte-identical copies; read the first path and apply that text to every `symbol_ids` entry. Still write one `coverage_closure` row per pending symbol. Copy that symbol's `span_hash`, or `span_check` when the source is absent. Do not recompute the digest. Callers for sampled symbols are `impacts[].callers` in the bundle; do not open `impact/` unless that symbol is absent from `impacts`.
- Visit every symbol whose `status` is `pending`, including `kind: file_scope` on a source file. Grouping does not drop a symbol. Symbols with `review_scope: branch_drift` are excluded and are not given the business-rule list.
- When `rule_plan` is present, answer only `applicable` rules in [business-logic-pass.md](business-logic-pass.md). Skipped ids use the plan note. Do not re-read a skipped rule record.
- A `file_scope` unit is the changed lines in that source file that no function or method span covers. Read `ranges` only.
- A symbol with `hits` stays in this queue. Hits are context, not a reason to skip. A report line is still cited on a finding even when its file is not a residual symbol.
- `excluded` symbols are not read. Non-source changed files (CSV, Markdown, JSON, config) are not pending symbols. Their class and one-line sample are `history.non_source_preview` in `26-review-digest.json`. Do not open those files for the business-rule list.
- If the ledger file is missing, record that the pack is legacy and do not
  invent symbols. Recollect when a fresh pack is required.
- A legacy ledger without `read_groups` is read one symbol at a time.

## Input for each pending symbol

- Function text from the group's opened file at `start_line`–`end_line`, or only `ranges` for
  `file_scope`. Truncate past 400 lines and say so.
- `callers` only when `callers_status` is `present`. `unknown` means the pack
  has no edges-in file. Do not invent callers. An empty present list means no
  direct caller was recorded.
- `hits` already filed for this symbol.

## Questions

1. Answer the fixed business-rule list in
   [business-logic-pass.md](business-logic-pass.md) for this method. Do not
   re-file a relation already present in `hits`.
2. Open question: what failure is still present that neither those rules nor
   `hits` name? A guard on the forward method that is missing on a batch,
   retry, reverse, or callback is one failure each. A compile-time value that
   changes behavior and cannot be changed per environment is one failure for
   the whole set of such values, not one card per number.

No open finding is allowed. Record `open_result: none` and still mark the
symbol `reviewed`.

## Output

Add novel findings to `llm-candidates.json` with `source: llm_judgment`,
`symbol_id`, `line`, and `lines` inside this symbol's span. Do not set
`pattern_class` or `suspect_id` unless the row is already a SAST suspect from
the suspect pass.

Write `coverage_closure` on the conclusion, one row per original `pending`
symbol:

```json
{"symbol_id": "", "status": "reviewed", "open_result": "none", "span_hash": "<copy from the symbol>"}
```

Copy `span_hash` from the pending symbol in `24-coverage-ledger.json`. It is the SHA-256 of that symbol's own lines: drop each line's newline, then join the selected lines with `\n`. Methods use `start_line` through `end_line`. A `file_scope` unit uses only its `ranges`. When the symbol has `span_check: unverified` instead, copy that and omit `span_hash`. A legacy symbol with neither field still needs the digest computed the same way.

`status` is `reviewed` or `failed`. `failed` requires `reason`. There is no
status for "not in the materials".
