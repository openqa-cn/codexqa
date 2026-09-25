# Agent LLM judgment pass (order 16)

When `29-judgment-packet.json` exists, read it once for counts, `rules`, and report rows. When `judgment-work/group-*.json` exists, read `shared.json` once and each group once for source. Do not read a group's source again from the packet. A group file contains that group's `rules` and `skip_notes`. Read that file only. Do not open `shared.json`, another `judgment-work` file, or `judgment-groups`. `open_question` false means do not hunt for an extra defect. Then stop. Suspect rows are `suspects.packets` and `suspects.sast_packets`, and their policies are already on those packets. A row with `slice_ref` does not repeat source; the matching `symbol_id` slice is the source. Semantic rows are `semantic_candidates`. Pending source is `read_groups`. Applicable business rules are `rules[id].look_for` and `rules[id].do_not_report`. A skipped id uses `skip_notes`. Do not open `01`–`28`, `references/business-rule-records.md`, the channel prompts, or `seal-conclusion.py`. Do not run a second prompt per channel. Write one `<OUT_DIR>/judgment.json` from [templates/judgment.json](../templates/judgment.json). `findings` are business defects the scanners did not report, plus a SAST or semantic true positive with its `suspect_id` when the row has one. `suspect_hits` are `derive_suspect_id` values judged true. `test_oracle` answers only `test_oracle_hits`. Write `title`, `risk`, and `fix` once; leave the English fields empty. Do not draw a Mermaid diagram. Dimension sections are not part of `judgment.json`: `seal-conclusion.py` fills `risk_tier`, `design_fit`, `complexity`, `dependencies`, `resilience`, `privacy`, `rollout`, `performance`, and `llm_judgment` from the signal files when `review-conclusion.json` leaves them empty, so the HTML still shows them.

Card fields, same voice as `seal-conclusion.py` scanner cards:

- `title` is the SARIF `shortDescription`: the rule name, such as `SQL 注入` or `硬编码凭证`. Do not write `这一行不是…`, a rule id, or a scanner name.
- `risk` is the Semgrep / SARIF `message`: `在第 N 行检测到 \`代码\`。` plus the impact. Example: `在第 80 行检测到 \`credit(payee, amount)\`。同一次写入会再执行一遍。` Do not add `不会…`, `不是…`, `而不是…`, or how the scanner matched.
- `fix` is the SARIF recommendation: `将第 N 行 \`旧文本\` 改为：` plus the safe control. Example: `将第 12 行 \`Persistence (Master + Overrides pattern):\` 改为：Persistence: Master + Overrides pattern`. Do not write `不用…`, `不要…`, `而不是…`, or a speed-up tip that is not the edit.
- `call_chain.title` is `谁会走到这一行`, and `paths` names the entry then this line. If the graph has no caller, omit `call_chain`. The report then says `未记录调用方`. Do not write `没有入边` or call it a dead function.

When `judgment-work/` contains two or more `group-*.json` files, judge those files concurrently. Write each result to `judgment-groups/` with the same file name. The group file's `read_this` is the file list: do not open `shared.json`, another `judgment-work` file, or `judgment-groups`. Place every `required_suspect_ids` id and write this group's JSON before drafting more findings. Put shared suspects and semantic decisions in `judgment-groups/shared.json`. Each group file has its own `plan_required`: it is true only when that group contains a method of at least 50 lines, and only that group gets a checklist. `plan_required` false on a group means skip the checklist for that group. The packet-level `plan_required` applies only when `judgment-work/` is absent. Short methods share a group until 12 methods or 10 suspect lines. A method longer than 60 lines is cut into 40-line windows. A method with more than 10 suspect lines is also cut into line windows. A finding line must fall inside that group's slice ranges, which for a window is only that window. Do not describe a different method. A suspect with `slice_ref` has no source text; the read-group slice with the same `symbol_id` and a range that contains the line is the source. Every id in `required_suspect_ids` is either in `suspect_hits` or in `suspect_skips`; leaving it out is not a skip. Read an `uncovered_fields` slice: it holds declarations between methods. `shared.json` `cross_method` is judged once with the shared pass, not again inside each group. Ask the open question only when `risk_tier.tier` is `T0` because a driver names an auth, pay, migration, or IaC path. A keyword hit in a csv, markdown, or txt file is not that driver. `identical_to_base` matches the current base tip: do not file it. A confirmed `magic_number` stays out of `findings`; the seal writes it as a convention. A `decision_literal` is a finding only when the literal sets a fee, timeout, or account limit.

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
