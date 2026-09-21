# Global rules

This file defines the global rules that all stages obey. Read it once when the pipeline starts; it stays in effect for the whole run.

## Entry routing and source boundaries

- First complete the entry-routing gate in `SKILL.md`, then read business materials or initialize the workspace.
- Handle post-submit incremental inside this Skill; do not reconstruct or rewrite the user's original words.
- If an explicit case source exists but is illegal, fail immediately; do not fall back to a fixed directory or trigger bootstrap.
- Write Stage 0 through 4-1 input materials and analysis reports, plus userConfig.json, uniformly to `{run_dir}/testcase/testdocs/`; write Stage 5's only formal test plan to `{run_dir}/testdesign/test_design.md`, and write the changelog to `{run_dir}/testdesign/testdesign_changelog.md`. Do not write outside `{run_dir}`.
- Stage 6 initial generation and pre-submit update directories still follow their dedicated rules; the Incremental process area writes `{run_dir}/testcase/.case-enhance/{executionId}/`, and publish writes `{run_dir}/testcase/cases/` (on the first diff enhancement, if `procase` is empty, also write `procase` at the same time). Incremental does not rewrite the formal test plan.
- Use the same `userConfig.json` initialization and reuse logic throughout; Stages 0 through 5 and Incremental all reuse the already-determined path context. This Skill creates or reuses `run_dir` from the user interaction; do not guess `runid` from a directory name.
- When post-submit is missing initial-version cases, first backfill Plan per user intent, then ask whether to Exec; after the initial version is on disk, stay in this Skill and continue incremental.
- Pre-submit update must keep unmatched cases and their order unchanged; do not write back to the explicit source or to baseline files in `run_dir`.
- Incremental must keep `KEEP` content unchanged, preserve the baseline format per end, and read back after publish.
- Stage 0 may fetch `http(s)://` document URLs the user **explicitly gave this turn**, persist them as testdocs body, and must not crawl page-internal links. Incremental + `DIFF_ENHANCEMENT` is a separate exception: when the target end already has a valid baseline and the user this turn gives a PR / MR / Code-platform PR page or a custom git repo URL, use git to land the code in `{run_dir}/testcase/.pr-cache/`, then archive per GIT. Do not fetch code without a baseline. On failure, explain by `error.code`: only `PR_PERMISSION_DENIED` means permission is insufficient; `PR_HEAD_REF_MISSING` asks for a local repo, branch name, or head SHA; otherwise report that error code. Do not auto-extract URLs from the requirement body, and do not install `gh` / `glab`.
- This Skill does not connect to a case-platform HTTP API, does not connect to a doc platform, and does not install or call external doc/identity CLI tools. Do not create or update remote document bodies or comments.

## Script long-output handling spec

Results from `ingest_local_docs.py`, `bootstrap_knowledge.py`, `extract_svg_text.py`, `fetch_knowledge_git.py`, `check_run_gate.py`, `close_stage.py`, scripts under `scripts/incremental/`, and similar may be very long; printing them directly in the terminal is truncated and loses information. **Every script's stdout is a single JSON object** and at least contains `ok`; put the human-readable summary in `msg`. Write diagnostics only to stderr; do not mix them with stdout. stdout of `ingest_local_docs.py` and `ingest-manifest.json` also contain `gapStats` (`unresolvedRemoteCount`, `missingLocalCount`, `strikethroughSegmentsRemoved`, and title excerpts). `check_run_gate.py` also returns `gate`, `runDir`, and `failures[]`; if `ok` is false the `error.code` is `GATE_FAILED`. `close_stage.py` also returns `currentStage`, `completed`, and `execAllowed`.

1. **When executing a script, redirect stdout only** (do not use `2>&1`, or stderr will break the JSON):
```bash
<skill_dir>/scripts/tcg-python <script> <args> > /tmp/script-output-<random-id>.json
```

2. **If the `msg` field in the script's returned JSON contains newline text (for example a directory tree), expand it with `tcg-python` and write a readable file**:
```bash
cat /tmp/script-output-xxx.json | <skill_dir>/scripts/tcg-python -c "import sys,json; d=json.load(sys.stdin); print(d.get('msg',''))" > /tmp/script-output-xxx-readable.txt
```

3. **Use a segmented-read strategy to read the full file content**, so you get complete data and are not limited by terminal output length. **Force the following segmented-read flow (do not skip any step):**

   **Step A**: First get the file's total line count with a terminal command:
   ```bash
   wc -l /tmp/script-output-xxx.txt
   ```

   **Step B**: Read in segments of no more than 200 lines, using the `read_file` tool's line-range mode (`start_line_one_indexed` / `end_line_one_indexed_inclusive`), **covering every line strictly in order**:
   - Segment 1: 1 ~ 200
   - Segment 2: 201 ~ 400
   - Segment 3: 401 ~ 600
   - ...and so on, until the last line of the file is covered

   **Step C**: After each segment is read, check the returned content and confirm there is **no** `[...N lines omitted...]` omission marker. If an omission appears, you must shrink that segment's range and reread.

   **Step D**: After all segments are read, confirm you have covered all content from line 1 through line N (N = the total line count from Step A).

   **Do not use `should_read_entire_file: true`**—that parameter silently omits middle content when a file exceeds a few hundred lines, causing node omissions; this is a known tool limit.
   **Do not skip Step A**—without the total line count you cannot verify a complete read.

4. **Delete the temporary files after reading is complete**.

**Do not** read long output results directly in the terminal; you must transfer them through a file.
**Do not** use `should_read_entire_file: true` to read script output files; you must use the segmented-read flow above.

## No-invention rules

**It is strictly forbidden to invent content that does not exist in the requirement document and the technical design.** Follow the principle "write what exists; leave empty what does not":

- Fields, APIs, rules, and flows not mentioned in the requirement document: leave the corresponding section empty or mark "not mentioned in the requirement document"
- API object list: if the requirement document does not give concrete API paths, request parameters, or response structures, do not infer or invent them; leave the corresponding fields empty
- Technical architecture and data models: if there is no technical-design document, leave the related content empty; do not infer from nothing
- Technical risks: if there is no technical-design document, leave technical-risk content empty; do not infer from nothing
- Impact-scope analysis: analyze only the impact scope explicitly mentioned in the requirement document; do not infer unmentioned upstream/downstream systems; if a dimension has no related information in the requirement document, leave that dimension empty or mark "not mentioned in the requirement document"
- Risk assessment: address only actual risk points already identified; do not assume risks from nothing
- Analytics-event IDs: do not invent them when the document does not list them
- Keep placeholders for information not provided in the requirement-materials table; do not invent person names, links, version numbers, and the like
- When `serviceId` or environment ID is not written in the input, fill `---` or "TBD"; inventing is forbidden
- Remote or missing sub-documents marked `unresolved-remote` / `missing` in Stage 0 **are not fact sources**; do not guess APIs, chains, or config from their titles or URLs
- Text inside strikethrough (`~~` / `<del>` / `<s>` / `text-decoration: line-through`) must not enter functions, APIs, or scope; extract adjacent unstruck body text as usual
- Empty sections, "add APIs" only, and tables with headers but no data rows must not be treated as already-extracted API contracts

## Current field names and read-time normalization (mandatory)

On-disk artifacts, the plan, test cases, and contracts **write only current names**. When reading user materials, prior artifacts, or existing cases, normalize historical synonym labels to the current names; do not write historical labels into new artifacts again.

| Current name | Meaning | Treat as synonyms when reading | Write location |
|--------|------|----------------|----------|
| **environment ID** | Test isolation environment or namespace | lane name, lane name, lane, env, testEnv | Case Preconditions "environment dependency / execution-environment description"; Incremental `test_env` corresponding field |
| **serviceId** | Service or application identifier | Appkey, AppKey, appkey, service identifier, application identifier | Stage 1 API object list, trigger source, contract minimum identification info, server case steps |

Execution discipline:

1. **Stage 1** must persist `serviceId` when extracting APIs (fill `---` if the source text does not state it). Do not extract environment ID in Stage 1.
2. **Stage 2** close reading, completion, and merging of APIs must align by `serviceId`; do not introduce another set of service-identifier fields.
3. **Stage 4** does not extract environment ID.
4. **Stage 4-1 / Stage 5** trigger source and contract minimum identification info use `serviceId`; both HTTP and RPC include this field.
5. **Stage 6** server steps write `serviceId:`; Preconditions write "environment ID". Use "TBD" when the generation stage cannot obtain a value.
6. **Incremental** environment review maps `test_env` to "environment ID" and its historical synonym labels, treating them as the same field. On `APPLY`, change the label to the current name and write the value; `SKIP` if an equivalent current field already exists. Change historical service-identifier labels in existing steps to `serviceId` on `MODIFY` / `ADD`.
7. **Knowledge expansion search** may use `serviceId` and the service short name; whatever the key name in the hit source text, the close-reading conclusion records only `serviceId`.

## Stage entry check (mandatory)

**Before** Stages 0 through 6 and Incremental start any read/write action, first confirm `run_dir` is usable. Acquisition priority is as follows:

1. **userConfig.runDir**: based on a run directory already present in the conversation, read `{run_dir}/testcase/testdocs/userConfig.json` and take `runDir` (already written during initialization). If the field is missing or empty, do not keep using it; handle it at the next level.
2. **Path specified by the user in this turn**: when userConfig does not exist or reading fails, use the local directory the user gave; after a successful acquisition, write `userConfig.runDir` and then continue. If the file does not yet exist, write only `runDir` first; the remaining fields are completed by initialization.
3. **This Skill's initialization default directory**: when the first two levels are both absent, create `$HOME/codexqa-testdata-generator/runs/{runid}` per [run-workspace.md](run-workspace.md), and write the same expanded absolute path into `userConfig.runDir`. Do not write business artifacts before `run_dir` is confirmed.

> Run this check once at the start of each stage (Stages 0 through 6) and Incremental; do not repeat the check inside a stage (`run_dir` does not change within the same stage). `run_dir` comes only from this Skill's userConfig / user-specified / default-created path.

After `run_dir` is confirmed, read `{run_dir}/testcase/testdocs/run-status.json` and continue from `currentStage`. If the file is missing, run `scripts/close_stage.py --init`. After each Plan/Exec persist, run `scripts/close_stage.py --stage <N>`. Do not infer `completed[]` from reports. Automatic does not allow loading later-stage references or writing several stage reports in one persist.

**Stage 5 / Stage 6 artifact gate (mandatory):** after `run_dir` is confirmed and before any Stage 5 or Stage 6 business write, run `scripts/check_run_gate.py` with `--gate stage5` or `--gate stage6`. Redirect stdout only. If `ok` is false, do not write `test_design.md` or cases; resume from `currentStage` or the first item in `failures`. Stage 5 requires `currentStage` `5` and `4-1` in `completed`. Stage 6 requires `currentStage` `6` and `execAllowed` after `close_stage.py --allow-exec`. The script only proves prior files and status exist; it does not replace reading that stage's reference.

---

## Five-way parameter classification note rules (global)

The five-way classification is used to annotate the "classification note" column of the contract summary. Table-style outputs of every stage of this skill do not write any field business values (except determined values of common parameters in the trigger-source JSON template; see 04-1 write-back requirements).

| Classification | Judgment criteria |
|------|---------|
| stable common parameter | A technical parameter unrelated to test data, with the same value in all scenarios (for example clientType, version, source, and other channel/version/client identifiers), and the judgment basis has already made its value explicit |
| fixed technical parameter | A parameter the API contract agrees has a fixed value (for example a hard-coded flag or enum switch), and the judgment basis is already explicit |
| business-semantic parameter | A parameter whose value depends on a concrete business object or scenario semantics (for example business IDs such as user/item/order, amount, quantity) |
| test-data parameter | An input parameter whose value is decided by test design (for example boundary values, invalid values, switch combinations) |
| dependency backfill parameter | A parameter whose value depends on backfill from a prior step's execution result (for example a token produced by login, an spuId produced by item creation) |

There is only 1 verbatim copy of the judgment-criteria table: the "five-way parameter classification" table in the contract-summary section of s04a-design-audit.md (plan-md-template.md has been changed to an inherit instruction and does not copy this table). The copy's content must be verbatim-identical to this table; when changing a classification definition you must sync the copy; the copy must not be rewritten unilaterally.

**Judgment-basis priority** (high to low; on conflict the higher level wins):

1. Explicit clauses in the technical design / Spec / Stage 1 / 2 artifacts
2. Field-level descriptions in the optional local pack (if the user has already provided one)
3. Sample examples — a single sample is reference only and does not constitute a judgment basis; when a sample value conflicts with a higher-level basis, the higher level wins

**Judgment discipline**:

- **Do not infer classification from field-name semantics**: "the field name looks like a common parameter / business parameter" does not constitute a judgment basis; when there is no basis at all, fill the note column with `undetermined (no basis)` and do not guess a classification
- **Composite fields**: for a field whose value is concatenated from a fixed-format template and dependency segments (for example `itemKey = -1_{spuId}_{selectNum}_`), annotate `composite field (format: <template>; dependency segments: <each segment and its classification>)`; do not assign a single overall classification
- **Conditional classification**: when the same field belongs to different classifications under different scenario conditions (for example dealId is a fixed value in a pure instant-pickup item scenario and a business-semantic value in a fused-item scenario), annotate `conditional classification: <condition A>→<classification A>; <condition B>→<classification B>`; take condition dimensions from scenario splits already made explicit in the field meaning / enums; do not invent conditions yourself
- **The note column writes only the classification name and a judgment-basis citation, and writes no concrete values** (the only carrier of determined values of common parameters is the trigger-source JSON template); do not use decision-style wording such as "needs prefill" or "should fill a certain value"

Division of labor between `---` and type default values (applies only to the trigger-source JSON template): `---` appears only in table cells to express "field-level missing/unknown"; inside JSON object bodies always use type default values as placeholders (int/long→`0`, string→`""`, boolean→`false`, object→`{}`, array→`[]`); do not write `---` into a JSON value position.

## Quality self-check

Self-check after each stage completes:

- **Step 0 (workspace initialization)** Is the workspace directory structure fully created? Has userConfig.json already written runDir/runid? Has `{run_dir}/testcase/testdocs/` already been created? Not connected to a case platform, not bound to a remote space?
- **Document ingest**: Used local files/directories/pasted body text, or persisted user-given HTTPS this turn as testdocs body without crawling? Did the content-completeness precheck pass? Are there missing chapter contents? Has the cleaned version already been saved to `{run_dir}/testcase/testdocs/`? For local A/C, if `ingest_local_docs.py` ran, were first-level child docs merged (📄 markers)? Have all images/flowcharts been processed (local SVG/drawio via structured extraction, local raster images via visual transcription, 📊/📷 markers inserted back in place, remote/missing already marked TBD)? (See s00-req-ingest.md)
- **Stage 1**: Does source-text extraction satisfy the six prohibitions? Did the function-point completeness check pass (document chapters vs function-list coverage)? Are condition branches exhaustively enumerated? Are risk signals omitted? Do function names follow the compression rules? Are user paths closed loops? (For analytics-event completeness check see s01-req-analysis.md)
- **Stage 2**: Were all six-dimension impacts analyzed? Is priority assignment reasonable? Does the fallback plan cover all ambiguous points? Have change-chain verification scenarios already been identified (changed API → downstream verification API)?
- **Stage 3**: Has it already been declared that the case platform is not connected? Are the reuse/change lists empty? Do blank scenarios align with the Stage 2 impact scope and are they all new?
- **Stage 4**: Is type identification accurate? Is characteristic analysis complete? Is model matching reasonable? Are test scenarios covered? Are Stage 3 reuse/change lists correctly marked? **Did the scene-fusion self-check pass** (difference sink-down, decision-tree validation, verification-point integration, path completeness, user-path coverage)? **Scenario-ratio self-check**: is normal:boundary:abnormal close to 5:3:2? Is the abnormal-scenario ratio ≥15%? **Branch-logic self-check**: does every condition judgment have a corresponding else branch? Have implicit branches (empty list / operation failure / concurrency conflict / idempotent resubmit) already been identified? **Expected-results self-check**: are there vague descriptions such as "displays normally" / "operation succeeded"? Have they already been replaced with concrete, verifiable descriptions?
- **Case generation (local)**: Does the Markdown file contain a complete directory structure and case details? Do case titles follow the naming rules? Is case merging reasonable? Is local directory ownership correct? Did not call a case-platform upload?
- **Incremental**: Enhanced only on an existing baseline, did not rewrite the formal test plan, and stayed in this Skill throughout? Did `KEEP` keep the original text? Did new targets land in the correct containers? Did publish read-back pass? Does the process area have decisions and a report?
- **Knowledge interaction**: Has `{run_dir}/knowledge/index.md` already been bootstrapped (an empty index is allowed)? Did not call an external knowledge-retrieval Skill? Has a Git URL the user explicitly gave already been shallow-cloned (on failure, `FAIL` and do not interrupt)? Do facts come only from requirements / technical design / prior reports / the optional local pack? Are gaps marked pending clarification rather than invented? Across stages, are prior reports and index.json read first? Have `knowledge-audit.md` and decision records already been persisted?

---

## Inter-stage context compression spec (mandatory; prevent exceeding Token limits)

**Background**: The test-plan generation flow is a multi-stage long chain. If Stage 1–4 analysis reports are kept in full in the conversation context, Stage 5 easily hits the Token ceiling. This spec uses the strategy "write full content to files + keep only summaries in the conversation" to cut conversation Token consumption by 50%–70%.

### Core principles

**After each stage completes, you must perform the following two operations; neither may be omitted:**

1. **Write the full report to a local file**: save the full analysis results of Stages 1 through 4-1 to the corresponding unique file under `{run_dir}/testcase/testdocs/`; save Stage 5's only formal test plan to `{run_dir}/testdesign/test_design.md`.
2. **Show only a summary in the conversation**: content shown in the conversation strictly follows each stage's summary spec (see below); do not output the full report in the conversation.

**When later stages cite prior results, read from local files, rather than extracting from conversation history.**

### Knowledge work-receipt output spec

In every stage from Stage 0 through Stage 6, first output short receipts in the order actions actually complete, per the "per-stage knowledge work receipt" spec in [knowledge-adapter.md](knowledge-adapter.md), then output the business summary this section requires. A receipt is not a planned checklist at the end of the stage; it is evidence of actual execution; it must include a `SUCCESS`, `SKIP`, `MISS`, or `FAIL` status, and give a hit count, entry IDs (at most 10), adoption location, or degradation reason. When a stage has no knowledge consumption, still output `SKIP` and the reason. With an empty index, write `MISS`/`SKIP` on the receipt and continue; do not ask for a knowledge directory.

Append all receipts to `{run_dir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md`; when there is an independent close-reading stage index, also write `index.json.knowledge_work_receipt`. The business summary shows only the review entry point and key stats; do not repeat knowledge body text.

After forming a knowledge-related judgment, immediately after the work receipt output an "analysis basis and conclusions" summary of no more than 3 items: state the key evidence/criteria adopted, the conclusion, and the target artifact location. Persist the full candidate trade-offs, limitations, and traceable fields only to `{run_dir}/testcase/knowledge-biz/decision-records/{project-name}/stage{N}-{scenario}.md`; do not write them into `knowledge-audit.md`, `{project-name}/stage*/` close-reading files, or the stage `index.json`, and do not output the model's original step-by-step internal thinking or trial-and-error drafts.

### Per-stage summary specs

#### Stage 1 summary spec

Save the full report to: `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`

Show only the following summary in the conversation (do not show the full report):

```
## Stage 1 analysis complete ✅

**Function-module list** (X modules total, Y function points):
| Module name | Function count | Has analytics events | Risk signals |
|--------|--------|--------|---------|
| Module A  | 3      | Yes (2)| R03     |
| Module B  | 5      | No     | -       |
...

**Key data**: X APIs | X analytics events | X technical risks | X business ambiguities

**Pending-clarification items** (titles only):
- [B03] Rule is ambiguous: xxx
- [B07] Timeliness is undefined: xxx

Full report saved to: {run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md
```

#### Stage 2 summary spec

Save the full report to: `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md`

Show only the following summary in the conversation (do not show the full report):

```
## Stage 2 analysis complete ✅

**Priority distribution**: P0 X items | P1 X items | P2 X items | P3 X items

**P0/P1 high-risk items** (show at most 10):
| Priority | Test object | Risk type | Test strategy |
|--------|---------|---------|---------|
| P0     | xxx     | R03 concurrency  | Load test + conflict injection |
...

**Six-dimension impact summary**: function chain X impact points | interface surface X changes | compatibility X risks

Full report saved to: {run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md
```

#### Stage 3 summary spec

Save the full report to: `{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md`

Show only the following summary in the conversation (do not show the full report):

```
## Stage 3 coverage judgment complete ✅

Did not connect to a case platform; existing-case recall was skipped.

**Result stats**:
- Direct reuse: 0
- Need change: 0
- Need add: X scenarios (against Stage 2 impact points)

Full report saved to: {run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md
```

#### Stage 4 summary spec

Save the full report to: `{run_dir}/testcase/testdocs/stage4-test-design-report.md`

Show only the following summary in the conversation (do not show the full report):

```
## Stage 4 design complete ✅

**Test-scenario stats** (X total):
| Module | Normal | Boundary | Abnormal | Total | Priority distribution |
|------|------|------|------|------|-----------|
| Module A | 5   | 3    | 2    | 10   | P0×3 P1×4 P2×3 |
...

**Type distribution**: T01×X T02×X T04×X T06×X T08×X (X analytics-event cases)

**Scenario-ratio self-check**: normal:boundary:abnormal = X:X:X (target 5:3:2) ✅/⚠️

Full test design saved to: {run_dir}/testcase/testdocs/stage4-test-design-report.md
```

### Spec for later stages reading prior results

When Stage 5 generates the test plan, it needs to cite prior analysis results and **must read from local files; do not rely on conversation history**:

```bash
# Before Stage 5 starts, read the prior files needed
# Each time read only the content the current chapter needs; do not load everything at once

# When generating the "test analysis" chapter, read:
read_file: {run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md  (function list, API list, analytics-event list sections)
read_file: {run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md  (impact scope, risk-priority sections)

# When generating the "test plan detailed design" chapter, read:
read_file: {run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md  (reuse/change/add lists)
read_file: {run_dir}/testcase/testdocs/stage4-test-design-report.md  (test-scenario summary after audit completion)
```

**Segmented-read rule**: prior files may be long; when reading, use `start_line_one_indexed` / `end_line_one_indexed_inclusive` to read in segments as needed; each time read only the chapter content currently needed; do not read the entire file at once.
