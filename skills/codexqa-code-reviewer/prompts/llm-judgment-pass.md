# Agent LLM judgment pass (order 16)

When `31-model-brief.json` exists, read that file once and stop opening the pack. It already folded counts, closed report rows, seed hits, one-line getters, and the file-scope copy. `methods[].source` is the source. An `open_suspects` row with empty `source` and `source_ref.where` of `methods` keeps that body on the `methods` entry named by `source_ref` (`name`, `path`, `start_line`, `end_line`). Read that entry. Empty `source` plus `source_ref` means the body was moved, not lost; do not open the repository file. `source_ref.where` of `judgment-work` means the body is in the listed group file. `judgment.json` findings are already copied from `candidate_hits`. Do not rewrite them. If `still_open` is empty, do not add a finding. Read only methods that own a `test_oracle_open` line. An id already listed in `judgment.json` `suspect_hits` is closed. Append `test_oracle` only. When `still_open`, `open_suspects`, and `test_oracle_open` are all empty, do not read methods or `judgment-work` groups. `chain_dimensions.chains` is every call chain CodexQA recorded. Judge each chain once against `chain_dimensions.rules`. File a hit on that step's line and leave `source` empty. Do not invent a caller or a chain. An empty `chains` list closes this channel. A line already in `closed_shapes` or `candidate_hits` stays closed. `still_open` is one row per shape. Judge each shape once and read only its hosts. Do not list the same shape twice. Do not restate `look_for`, `do_not_report`, or `closed_lines`. `closed_lines` are already cards. Do not open `review-conclusion.json` or rule-construction. A different shape is its own finding. Do not decide whether it is the same defect as a closed line. When any of those lists is non-empty and `groups` is non-empty, source is in `judgment-work/`; read `shared.json` once and each listed group once, at most four. Write `judgment.json` from `output`, then run `render-review-html.sh`. `output` in that brief is the schema. Do not open templates, examples, dimension docs, `29-judgment-packet.json`, `judgment-seed.json`, `01`–`30`, `seal-conclusion.py`, `validate-conclusion.py`, or the channel prompts. `review-conclusion.json` is already in the pack. Run render and do not edit that file. Follow `read_this`, `candidate_hits`, `still_open`, `closed_shapes`, and `oracle_flags` in that brief. Confirm each candidate once, then file only still-open shapes. A listed shape is closed for the file, including `same_shape_lines`. A method with `callee_of` true contains the short callee body. Judge each `test_oracle_open` line once. Do not reopen a flag. A true flag cannot fail validation. Copy `preset` onto `oracle` and do not change those keys. Judge only `questions`. `boundary_missed` stays false unless `preset` is true. A name that claims a reject code, gateway failover, or acceptance, while the assertion reads a different result, is `branch_uncovered`. Omit an oracle row when every flag is false. Write the seven flags only under `oracle`, once. Do not narrate flags and do not revisit a line. `title`, `risk`, and `fix` are Chinese. Leave the English fields empty. Write each finding once.

When `31-model-brief.json` is absent and `question_fanout` is true, `29-judgment-packet.json` has no source text. Read `judgment-work/shared.json` once and each `group-*.json` once, at most four groups at the same time. Union the findings. Question fan-out exists only when the source left for the model exceeds 2000 lines. A shorter file is one pass over this packet. Do not write one conclusion file per group. Do not re-file `report.pr_delta` rows; seal already writes those cards. `judgment-seed.json` confirms `magic_number` and `rate_literal` as conventions and also the scripted hits, skips, findings, and test oracles: `decision_literal`, remote `missing_timeout`, `insecure_tls`, `log_exposure`, `retention_or_dsar_gap`, `compat_window_gap`, empty `catch_without_obs`, absence rows whose line has no dual-write, flag, announcement, or rollback token, opposite `lock_order` pairs, and a `test_oracle` line that already has `test_no_join`, `test_tautology`, or `test_unreachable`. Do not spend a pass on those ids. Remaining `test_oracle` rows and business, auth, and concurrency rules stay in this pass. A one-line getter that is absent from the groups is closed. A business, auth, concurrency, or multi-line method is in a group. After `judgment.json` has only those novel findings, run `render-review-html.sh --dir <OUT_DIR>`. That script seals `review-conclusion.json` and writes the HTML. Do not hand-write the four group files or the report body.

When `31-model-brief.json` is absent and `29-judgment-packet.json` exists, read it once for counts, `rules`, and report rows. When `judgment-work/group-*.json` exists, read `shared.json` once and each group once for source. Do not read a group's source again from the packet. When `judgment-work/` is absent, read this packet once and write one `judgment.json`. A review of at most 2000 pending lines, including one file of about 800 lines, has no `judgment-work/` directory. `open_question` false means do not hunt for an extra defect. Then stop. Suspect rows are `suspects.packets` and `suspects.sast_packets`, and their policies are already on those packets. A row with `slice_ref` does not repeat source; the matching `symbol_id` slice is the source. Semantic rows are `semantic_candidates`. Pending source is `read_groups`. Applicable business rules are `rules[id].look_for` and `rules[id].do_not_report`. `applicable` is the first list, not an exclusion list. A `look_for` that matches the method body is filed even when that `rule_id` is absent from `applicable`. Do not open the rule router and do not retract the match. Different `rule_id`s on the same line stay separate findings. A skipped id uses `skip_notes`. A failed render names the sentence to edit. Do not grep `seal-conclusion.py` or `validate-conclusion.py` for fields. Answer every `test_oracle_open` row from that test body. A test absent from `test_oracle_open` is closed. Do not investigate why. A `closed_report` row does not close a `test_oracle_open` line. Judge each `test_oracle_open` line once. Do not reopen a flag. Set a flag only when that test shows it. Leave the other flags false and do not restate them. Write the seven flags only under `oracle`. `unsafe_pass` is true only when an assertion requires a sensitive value in HTML, a response body, or a log. A getter round-trip of a value the test just set is false. `observability_asserted` is true only when the test asserts a log, metric, or trace. `locks_private` is true only when the test calls a private production member. A callee missing from `methods` stays on the call line already chosen. Do not open the repository file for its body. Write each finding into `judgment.json` once. Do not re-list the set or re-plan severity. The same fix for the same `rule_id` on several lines is one finding with `same_fix` true and `also_lines` for the other lines. Do not file those lines and then delete them. Do not compute `shape_count`. Do not open `business-rule-records.md`. Copy `test_oracle` flags already decided. Do not re-derive them. Do not open `01`–`28`, `references/business-rule-records.md`, the channel prompts, or `seal-conclusion.py`. Do not run a second prompt per channel. Write one `<OUT_DIR>/judgment.json` from [templates/judgment.json](../templates/judgment.json). `findings` are business defects the scanners did not report, plus a SAST or semantic true positive with its `suspect_id` when the row has one. `suspect_hits` are `derive_suspect_id` values judged true. `test_oracle` answers only `test_oracle_hits`. Write `title`, `risk`, and `fix` once; leave the English fields empty. Do not draw a Mermaid diagram. Dimension sections are not part of `judgment.json`: `seal-conclusion.py` fills `risk_tier`, `design_fit`, `complexity`, `dependencies`, `resilience`, `privacy`, `rollout`, `performance`, and `llm_judgment` from the signal files when `review-conclusion.json` leaves them empty, so the HTML still shows them.

Card fields, same voice as `seal-conclusion.py` scanner cards:

- `title` is the SARIF `shortDescription`: the rule name, such as `SQL 注入` or `硬编码凭证`. Do not write `这一行不是…`, a rule id, or a scanner name.
- `risk` is the Semgrep / SARIF `message`: `在第 N 行检测到 \`代码\`。` plus the impact. Example: `在第 80 行检测到 \`credit(payee, amount)\`。同一次写入会再执行一遍。` Do not add `不会…`, `不是…`, `而不是…`, or how the scanner matched.
- `fix` is the SARIF recommendation: `将第 N 行 \`旧文本\` 改为：` plus the safe control. Example: `将第 12 行 \`Persistence (Master + Overrides pattern):\` 改为：Persistence: Master + Overrides pattern`. Do not write `不用…`, `不要…`, `而不是…`, or a speed-up tip that is not the edit.
- `call_chain.title` is `谁会走到这一行`, and `paths` names the entry then this line. If the graph has no caller, omit `call_chain`. The report then says `未记录调用方`. Do not write `没有入边` or call it a dead function.

When `judgment-work/` contains two to four `group-*.json` files, judge those files concurrently. Never launch more than four. Write each result to `judgment-groups/` with the same file name. Read `shared.json` once for `rules` and `skip_notes`; each group lists `rule_ids` and does not repeat that text. Do not open another group's file or `judgment-groups`. Place every `required_suspect_ids` id and write this group's JSON before drafting more findings. A finding line must fall inside that chunk's slice ranges. Do not cut a method that fits in the chunk, and do not describe a different method. A suspect with `slice_ref` has no source text; the slice with the same `symbol_id` and a range that contains the line is the source. Every id in `required_suspect_ids` is either in `suspect_hits` or in `suspect_skips`; leaving it out is not a skip. Read `uncovered_fields` and `cross_method` on the chunk: fields between methods and lock orders are already on every chunk. Extra agents, when used on one change, are three passes over the full change — security, correctness, and quality — not line windows, and they are not added on top of coarse chunks. The packet does not emit those three files. Ask the open question only when `risk_tier.tier` is `T0` because a driver names an auth, pay, migration, or IaC path. A keyword hit in a csv, markdown, or txt file is not that driver. `identical_to_base` matches the current base tip: do not file it. A confirmed `magic_number` stays out of `findings`; the seal writes it as a convention. A `decision_literal` is already closed by the script: a fee, timeout, or account-limit literal is a seed hit, and any other literal is a seed skip.

When the packet has `rules`, that object is the business-rule pass. Suspect policies on the packet are the suspect pass. Do not open the channel prompt files for a second copy of those questions. `seal-conclusion.py` merges the fragments, builds report-row cards, hashes, skips, English mirrors, and caller chains at render. Do not read it.

When `29-judgment-packet.json` is absent, run those five as separate prompts, then one merge. Do not combine them on that legacy path.

1. **Certain SAST hits** (`disposition: report` in `23-sast-signals.json`) are
   not a model turn. `seal-conclusion.py` writes one card per rule and file,
   and copies `existing_code` from that file's cited line. Do not merge those
   lines across files, and do not send the rows to a model.
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
   failures the listed rules and hits do not name. Do not copy `span_hash`.
   `seal-conclusion.py` computes it at render.
6. Write the channels’ true positives into `llm-candidates.json`:
   ```json
   { "p0": [], "p1": [...], "p2": [...] }
   ```
   Suspect rows must include `suspect_id`. Derive suspects must include
   `derive_suspect_id`. Business rows must include neither.
7. On the legacy path without `29-judgment-packet.json`, write `baseline-findings.json` from heuristic findings plus SAST `report`
   rows and derive rows whose `disposition` is `report` (pre-LLM `p0`/`p1`/`p2` only).
   On the packet path, do not build those cards; seal writes one per rule and file.
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
9. Copy novel business findings into `judgment.json` `findings`. Do not copy
   `disposition: report` rows, `span_hash`, `test_gaps`, or `rule_coverage`
   into the conclusion; `seal-conclusion.py` fills those at render.
   `test_oracle` in `judgment.json` answers only `test_oracle_hits`.
   `suspect_hits` lists `derive_suspect_id` values judged true. Other
   inventory rows and unconfirmed per-line suspects are default skips.
   Fill `llm_judgment` from `22-llm-judgment.json`, including `triage` when present.
10. If every channel adds nothing, `llm_judgment.verdict` is `ok` (or `none`
   when the pack is too thin) and `llm_judgment` stays in `dimensions_covered`.

## Rules

- Never invent callers, `tested_count`, CVEs, or compliance certifications.
- Never skip CodexQA pack validation to save time for this pass.
- Duplicates must be dropped or enriched, not emitted as a second finding.
- HTML shows the merged lists only.
- Write each novel sentence once. `seal-conclusion.py` copies it into the English field when that field is empty.
- Derive rows are findings only when `disposition` is `report`. A missing `disposition` is unstamped: re-run `scripts/lib/derive_triage.py` and do not file or drop those rows yet. `disposition: suspect` is only the derive-suspect pass. `disposition: drop` is not a finding. The same rule applies to SAST rows: re-run `derive-sast.sh` before treating an unstamped hit as report.

## Card

See [references/dimensions/llm-judgment.md](../references/dimensions/llm-judgment.md).
