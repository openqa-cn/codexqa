# Residual read pass

Run after the four existing channels and before merge. This pass does not
replace them. SAST `disposition: report` rows stay baseline findings. Do not
re-find those SAST classes. `disposition: drop` stays discarded.

## Queue

When `29-judgment-packet.json` exists, `pending`, `read_groups`, and `skip_notes` come from that file. `read_groups[].text` is the one read of `paths[0]` when the file fits. When `slices` is present, each `slices[].text` is that symbol from `start_line` to `end_line` and `text` may be empty. Do not open `paths` after the first, and do not open the source file again. Otherwise read `28-symbol-bundle.json` when it exists: `pending`, `read_groups`, and `skip_notes`. Otherwise read `24-coverage-ledger.json`.

- When `read_groups` is present, open each group once. The `paths` in a group are byte-identical copies; read the first path and apply that text to every `symbol_ids` entry. Still write one `coverage_closure` row per pending symbol. Do not copy `span_hash`; `seal-conclusion.py` computes it at render. Do not recompute the digest. Callers for sampled symbols are `neighbor_groups` in the judgment packet, or `impacts[].callers` in the bundle; do not open `impact/` unless that symbol is absent from both. `neighbor_groups[].text` is already inlined. Read it with the symbol. Do not open those paths again.
- A group with `truncated: true` is the whole read. Do not open the source file to fill lines past the truncation note.
- Groups with `independent: true` share no path and no caller edge. When `judgment-work/group-*.json` has two or more files, judge those files concurrently. The business-rule list was already used on the first pass: do not paste it again. Each such group gets only that symbol's diff and the findings already confirmed. The open question applies only when `risk_tier.tier` is `T0` from an auth, pay, migration, or IaC path. `plan_required` does not turn a short config or example into that question. Do not copy `coverage_closure`; `seal-conclusion.py` writes one row per pending symbol.
- Visit every symbol whose `status` is `pending`, including `kind: file_scope` on a source file. Grouping does not drop a symbol. Symbols with `review_scope: branch_drift` are excluded and are not given the business-rule list.
- When `applicable` or `rule_plan` is present, answer only those `applicable` rules in [business-logic-pass.md](business-logic-pass.md). Skipped ids use the plan note. Do not re-read a skipped rule record and do not copy the full rule list into the notes.
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

1. When the packet or bundle lists `applicable` rules, answer only those.
   When `applicable` is absent, answer the fixed business-rule list in
   [business-logic-pass.md](business-logic-pass.md) for this method. Do not
   re-file a relation already present in `hits`. Do not paste the rule list
   into the finding.
2. Open question, only when `risk_tier.tier` is `T0` and a driver names an
   auth, pay, migration, or IaC path. `plan_required` is the checklist flag,
   not this question. A keyword hit in csv, markdown, or txt does not open it.
   When the question is closed, record `open_result: none`. When it is open:
   what failure is still present that neither those rules nor `hits` name?
   Do not re-read the rule catalog for this question. A guard on the forward
   method that is missing on a batch, retry, reverse, or callback is one
   failure each. A compile-time value that changes behavior and cannot be
   changed per environment is one failure for the whole set of such values,
   not one card per number. Do not file a claim that one line of the diff
   literally contradicts. Do not file a file whose bytes match the base tip.

No open finding is allowed. Record `open_result: none` and still mark the
symbol `reviewed`.

## Output

Put novel business defects in `judgment.json` `findings`, not as copies of `disposition: report` rows. Also add them to `llm-candidates.json` with `source: llm_judgment`,
`symbol_id`, `line`, `existing_code` (a short snippet that appears in the
diff or the symbol text), and `lines` inside this symbol's span. Do not set
`pattern_class` or `suspect_id` unless the row is already a SAST suspect from
the suspect pass.

Write `coverage_closure` on the conclusion, one row per original `pending`
symbol:

```json
{"symbol_id": "", "status": "reviewed", "open_result": "none"}
```

Do not copy `span_hash`. `seal-conclusion.py` hashes the ledger ranges against the source at render, or writes `span_check: unverified` when the source file is absent.

`status` is `reviewed` or `failed`. `failed` requires `reason`. There is no
status for "not in the materials".
