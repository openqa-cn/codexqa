# Agent LLM judgment pass (order 16)

When `29-judgment-packet.json` exists, suspect slices, pending symbols, skip notes, and source text come from that file. Do not open `23-sast-signals.json`, `27-suspect-queue.json`, `28-symbol-bundle.json`, or `24-coverage-ledger.json`. Do not hand-copy `span_hash`, drift `line_skips`, or the untested-symbol list; `seal-conclusion.py` fills those from `30-conclusion-skeleton.json` during render and sets `open_result` to `hit` when a finding's `symbol_id` matches.

Four separate prompts, then one merge. Do not combine them.

1. **Certain SAST hits** (`disposition: report` in `23-sast-signals.json`) go
   straight into `baseline-findings.json`. Do not send them to a model.
   `disposition: drop` is discarded. `allow` in `llm_report_policy` means the
   scanner did not finish: record that gap, and do not rescan the class.
   In this step, `rule_coverage` covers only SAST classes and hard-gate ids
   whose signal rows you filed (`NULL-001`, `RES-001`, `ERR-001`, `PERF-001`).
2. **Derive suspect channel:** follow [derive-suspect-pass.md](derive-suspect-pass.md).
   Read `27-suspect-queue.json` `packets` when it exists. Otherwise read only
   `derive_suspects[]` on the derive signal files. `disposition: report`
   rows are already findings. `disposition: drop` is not.
3. **SAST suspect channel:** follow [sast-suspect-pass.md](sast-suspect-pass.md).
   Read `27-suspect-queue.json` `sast_packets` when the queue exists. Otherwise
   read only `suspects[]` (slice plus that row’s short policy).
4. **Business-logic channel:** follow [business-logic-pass.md](business-logic-pass.md).
   Changed-method slices and that file’s rule list only. It writes
   `rule_coverage` for those ids. It does not re-find SAST classes, semantic
   candidate rows, derive suspects, or test-oracle gaps.
5. **Semantic candidate channel:** follow [semantic-candidate-pass.md](semantic-candidate-pass.md).
   Only `error_payload_candidates` and `opaque_status_candidates`.
5b. **Residual read:** follow [residual-read-pass.md](residual-read-pass.md).
   Read every `pending` symbol in `28-symbol-bundle.json` when that file exists;
   otherwise use `24-coverage-ledger.json`, including `file_scope` ranges outside
   functions. Scanner hits on that symbol stay
   attached and do not remove it from the queue. The open question covers
   failures the listed rules and hits do not name. Copy each symbol's
   `span_hash` into the closure row. Use `span_check: unverified` only when
   the symbol already has that field because the source file is absent.
6. Write the channels’ true positives into `llm-candidates.json`:
   ```json
   { "p0": [], "p1": [...], "p2": [...] }
   ```
   Suspect rows must include `suspect_id`. Derive suspects must include
   `derive_suspect_id`. Business rows must include neither.
7. Write `baseline-findings.json` from heuristic findings plus SAST `report`
   rows and derive rows whose `disposition` is `report` (pre-LLM `p0`/`p1`/`p2` only).
8. **Merge** (unchanged contract, stricter SAST gate):
   ```bash
   ./scripts/acr-python ./scripts/lib/merge-llm-findings.py \
     --baseline <OUT_DIR>/baseline-findings.json \
     --candidates <OUT_DIR>/llm-candidates.json \
     --sast-signals <OUT_DIR>/23-sast-signals.json \
     --ledger <OUT_DIR>/24-coverage-ledger.json \
     --out <OUT_DIR>/merged-findings.json \
     --report <OUT_DIR>/22-llm-judgment.json \
     --mode pr
   ```
   Pass `--ledger` when `24-coverage-ledger.json` exists. Omit it on a legacy
   pack that has no ledger. An owned SAST candidate is kept only when its
   `suspect_id` is listed in `suspects[]`. See [references/rule-construction.md](../references/rule-construction.md).
   A candidate whose line is outside every pending symbol span is dropped.
9. Copy merged `p0`/`p1`/`p2` into `review-conclusion.json`. Fill
   `coverage_closure` from the residual read. Fill
   `llm_judgment` from `22-llm-judgment.json`, including `triage` when present.
   Before render, close three ledgers or `render-review-html.sh` refuses the HTML:
   - Put every `disposition: report` line on a finding (`line` / `lines` or
     `第 N 行` in that finding's text). Do not write that another card covers
     a line unless that card lists the line.
   - For each test in `test_oracle_inventory`, set `oracle.unsafe_pass`,
     `oracle.boundary_missed`, and `oracle.branch_uncovered`. `skip` only when
     all three are false. A true assertion on one branch does not answer the
     other two questions.
   - `test_gaps` is the set of production symbols with no accepted test edge,
     minus explicit waivers. For a rule whose look-for has more than one
     shape, `rule_coverage.shapes` has one hit-or-skip entry per shape, and a
     hit lists its lines. The first shape does not close the next.
   - When `24-coverage-ledger.json` exists, every `pending` symbol has a
     `coverage_closure` row whose status is `reviewed` or `failed`.
10. If every channel adds nothing, `llm_judgment.verdict` is `ok` (or `none`
   when the pack is too thin) and `llm_judgment` stays in `dimensions_covered`.

## Rules

- Never invent callers, `tested_count`, CVEs, or compliance certifications.
- Never skip CodexQA pack validation to save time for this pass.
- Duplicates must be dropped or enriched, not emitted as a second finding.
- HTML shows the merged lists only.
- Bilingual prose is required (`title_en`, `risk_en`, …) for novel findings.
- Derive rows are findings only when `disposition` is `report`. A missing `disposition` is unstamped: re-run `scripts/lib/derive_triage.py` and do not file or drop those rows yet. `disposition: suspect` is only the derive-suspect pass. `disposition: drop` is not a finding. The same rule applies to SAST rows: re-run `derive-sast.sh` before treating an unstamped hit as report.

## Card

See [references/dimensions/llm-judgment.md](../references/dimensions/llm-judgment.md).
