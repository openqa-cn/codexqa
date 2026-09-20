# Input processing: requirement-document ingest and preprocessing

## Minimum persist (this stage)

- File: `{run_dir}/testcase/testdocs/userConfig.json`
- File: `{run_dir}/testcase/testdocs/run-status.json`
- File: `{run_dir}/testcase/testdocs/requirement-[title].md` and `tech-spec-[title].md` as applicable
- File: `{run_dir}/testcase/testdocs/stage0-input-processing-report.md`
- Required headings: `gapStats` | `input form`

> Before this stage starts, first follow [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" to confirm `run_dir` is available (userConfig.runDir → user-specified path → this Skill's initialized default directory); do not perform any reads or writes before that confirmation.

## Requirement-document content ingest rules (mandatory)

This Skill **does not connect to a doc platform** and does not install or call any doc-platform / identity CLI. Stage 0 consumes local files, directories, pasted body text, or `http(s)://` document URLs the user **explicitly gave this turn**. Host does not matter. Fetch those URLs with host-available HTTP/read tools, persist the body under `testcase/testdocs/`, and do not crawl. `ingest_local_docs.py` is optional for local files and is **not required** after an HTTPS fetch.

### Input-form classification (mandatory; judge before any later processing)

For each input document, judge the input form before any processing:

| Input form | Judgment features | Ingest action |
| --- | --- | --- |
| **A Local file/directory** | User provides a local path (a single `.md/.txt/.html`, or a directory containing a main document and attachments) | May run the "local ingest flow" below; `ingest_local_docs.py` is optional, not a Stage 0 gate |
| **B Upstream archive / already-cleaned local file** | Input is already persisted in this run under `testcase/testdocs/` (same run_dir resume/rerun), or the user directly provides already-cleaned body text | **Skip ingest-flow steps 1–3 and 5–6** (do not scan the directory again for child docs); in step 4 precheck, **image-marker scan is mandatory for form B**; other precheck items follow the current local-file state |
| **C Pasted body text** | User pastes requirement / technical-design body text directly in the conversation, with no file path | First write the body to `{run_dir}/testcase/testdocs/_ingest/pasted-<id>.md` or persist it as `requirement-[title].md` / `tech-spec-[title].md`; ingest script optional |
| **D HTTPS / HTTP document URL** | User this turn gives one or more `https://` or `http://` document URLs, with no corresponding local file. Host does not matter | Follow "Form D HTTPS persist" below. Do **not** install or call a doc-platform / identity CLI. A PR / MR / custom git repo URL is not a Stage 0 input; only when Incremental is in effect and the user explicitly asks to increment from that URL, follow [incremental/code-fetch-spec.md](incremental/code-fetch-spec.md) |
| **E Mixed input** | Local files, pasted body text, or user-given document URLs appear together | Take the A/B/C/D branch per document |

**Form B exemption conditions (skip multimedia transcription and cleaning only when all are met)**:

1. The input file is a cleaned version persisted earlier in this run under `testcase/testdocs/` (same run_dir resume/rerun; judgment criterion = the file path is under the current `run_dir`'s `testcase/testdocs/` directory and is not an `_ingest/` intermediate artifact), and
2. Image markers in the file have already been replaced by 📊/📷 transcription annotation blocks (regex scan of `!\[.*\]\(` and `<img ` marker count is 0); a zero-image document (image-marker count is 0 and transcription-annotation-block count is 0) naturally satisfies this condition

Form B files that do not meet the exemption conditions: **per file, execute image-marker scan → multimedia transcription → cleaning → persist**, using the same rules as form A. An upstream archive only exempts "rescan the directory"; it does not exempt "multimedia processing and cleaning".

**Boundary of the prior-artifact reuse principle**: the object of a reuse exemption is "content ingest" (avoid repeat ingest); it does not include multimedia transcription — whether transcription annotation blocks exist is the only hard evidence; an upstream claim of "already processed" is not evidence (the upstream may have only copied text).

> ❗ Regardless of form A/B/C/D/E, **every already-persisted input document must be scanned for image markers and processed per the "Multimedia content processing" section**. Before persist, treat image-marker count = 0 as a hard gate (see the "image-marker scan" row in the precheck table). Form D persists the fetched body first, then runs the same scan; remote images and page-internal links the user did not give this turn stay TBD.

### Form D HTTPS persist (no ingest script)

1. Fetch **only** `http(s)://` URLs the user explicitly gave this turn, using host-available HTTP/read tools. Do not install or call a doc-platform / identity CLI.
2. Persist the fetched text as `{run_dir}/testcase/testdocs/requirement-[title].md` and/or `tech-spec-[title].md`. An optional scratch file `{run_dir}/testcase/testdocs/_ingest/fetched-<id>.md` is allowed. **Do not run `ingest_local_docs.py` on this path.**
3. Do not crawl. Page-internal / child / related links that the user did not give this turn are TBD. Remote images stay TBD.
4. Fetch failure, login wall, or empty body: ask the user to paste or export a local file. Do not invent content.
5. Continue from image-marker scan, local multimedia rules, cleaning, and the Stage 0 report (`gapStats` | `input form`), then `close_stage.py --stage 0`.

### Local ingest flow

**Step 1: Optionally use the local ingest script to collect the main document, first-level child docs, and local images**

Optional for each form A/C input (`<skill_dir>` is this Skill's root directory). Form D skips this script:

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/ingest_local_docs.py \
  --input <local file or directory> \
  --output-dir {run_dir}/testcase/testdocs/_ingest
```

Repeat `--input` for multiple inputs. The script only reads the local disk and does not access the network. stdout is a single JSON (`ok`, `msg`, `manifestPath`); follow the "script long-output handling rules" and parse only after redirecting stdout. Treat `_ingest/ingest-manifest.json` and `merged/` as authoritative artifacts.

The script will:

1. Read the main-document body (for a directory input, ingest first-level `.md/.txt/.html` under that directory)
2. Read only first-level child docs: relative-path document links in the main document, plus documents inside a first-level subdirectory with the same name as the main document; do not follow deeper subdirectories; when found, annotate at the merge point "📎 Child doc \"xxx\" still has nested child docs; not expanded; confirm whether needed"
3. Parse image / flowchart markers and locate local files for the relative paths
4. Call `extract_svg_text.py` for local `.svg` / `.drawio` / `.dio` to do structured extraction
5. Write `{run_dir}/testcase/testdocs/_ingest/ingest-manifest.json` and `merged/<main-document>.md`

**Do not** switch to remote document scraping, `curl` with a login session, or browser scraping to fill remote items the script marked `unresolved` / `missing`.

**Step 2: Save content into the ingest directory**

The ingest script has already written the merged draft to `_ingest/merged/`. Follow the "script long-output handling rules" to read `ingest-manifest.json` and each merged draft, and avoid terminal truncation.

**Step 3: Segmented read and completeness check**

Follow the segmented-read strategy in the "script long-output handling rules" and fully read the merged draft:

1. Get the file line count: `wc -l {run_dir}/testcase/testdocs/_ingest/merged/<file>.md`
2. Read in segments of no more than 200 lines each, strictly covering every line
3. After each segment, check that there is no omission marker

**Step 4: Content-completeness precheck (mandatory)**

After the full document content is obtained, the following precheck items must be executed; **if any item fails, the user must supply local files, paste supplements, or another URL they give this turn. Do not crawl URLs the user did not give this turn**:

| Precheck item | Check method | Handling on failure |
|--------|---------|---------------|
| **Section completeness** | Check whether the document has an obvious section-number break (for example 1, 2, 4 exist but 3 is missing) | Compare against the manifest child-doc list; if missing, ask the user to supply the local file and re-ingest |
| **Image-marker scan** | Run a regex scan of `!\[.*\]\(` and `<img ` tags over the full text and count image markers; form B exemption requires the count to be 0 | Count >0 and multimedia transcription not yet executed → **do not persist**; return to the "Multimedia content processing" section, complete transcription, then persist; on transcription failure, register via the fallback and do not silently drop image markers |
| **Analytics-event ID scan** | Run a regex scan of `[bc]_[a-z]+_[a-z0-9]+(_[a-z]+)?` over the full text and count matches | If the document title/TOC mentions "analytics event" but the scan result is 0, the analytics-event section or child doc is missing; the user must supply local analytics-event materials |
| **Table completeness** | Check whether tables in the document are obviously truncated (for example a header exists but data rows are missing) | Ask the user to verify the export is complete and provide the local file again |
| **Content-length reasonableness** | Compare title complexity with content length; a PRD is usually at least several thousand characters | When content is too short (<1000 characters), warn and ask the user to confirm whether only a TOC page was exported |
| **Remote residue** | Read stdout / manifest `gapStats` (`unresolvedRemoteCount`, `missingLocalCount`) and `unresolved` / `unresolved-remote` / `missing` items | List them in the Stage 0 report under "TBD": title and count are mandatory. **Do not block persist because page-internal links were not fetched**; before the user gives those URLs this turn, do not treat those pages as already-read facts; do not invent; do not crawl |

> Image-marker scan is a two-way gate: form A/C governs "what must be transcribed must be transcribed before persist"; form B governs "an exemption claim must have zero-marker evidence". This precheck applies to **every already-persisted input form**, not only link input.

**Step 5: Child-doc read and merge (mandatory; required for every form A/C main document)**

> ❗ Child docs of a technical design are especially critical: interface design, sequence diagrams, gray-release plans, and database changes are often split into child pages or same-name subdirectories. The main document often has only a relative link or a title; not following it means missing functions — lost child docs are a high-frequency root cause of missed functions in requirement analysis.

1. **Treat the manifest as authoritative**: `ingest_local_docs.py` has already completed "read first-level only" discovery and merge; verify its `children` list and the `merged/` merged draft
2. **Read first-level only**: do not follow child docs of child docs; when deeper child docs are found, annotate at the merge point "📎 Child doc \"xxx\" still has nested child docs; not expanded; confirm whether needed"
3. **Merge into the main document**: child-doc content **must be merged into the corresponding section of the main document** (where the child-doc title/link sits in the main document) and must not become a separate cleaned file; annotate the merge point "📄 Child-doc merge: <child-doc title>". Do not delete annotations the script already inserted
4. **Clean as a whole**: after merge, run the document-cleaning rules on the complete document (schedules / staffing / strikethrough in child docs are also deleted)
5. **Register**: record child-doc count and titles in the materials inventory of stage0-input-processing-report.md (the main document records the attached child-doc list)

**Child-doc fetch failure** (relative path does not exist, or a page-internal HTTPS link the user did not give this turn): annotate the corresponding place in the main document "📄 Child doc \"xxx\" failed to fetch, TBD"; do not invent content; do not crawl; do not switch to a doc-platform CLI.

**Step 6: Analytics-event special supplement ingest**

If the step 4 analytics-event ID scan finds a count of 0, but the document TOC or title mentions "analytics event" related content, execute the following supplement ingest:

1. In the child-doc list already discovered in step 5, confirm whether there is an independent analytics-event child doc
2. If there is, confirm its content was already merged with step 5 (do not ingest again); if the analytics-event child doc was not discovered before step 5, ask the user to provide a local analytics-event file or directory and re-run `ingest_local_docs.py`
3. If it still cannot be obtained, ask the user to paste analytics-event information, provide a local file, or give that document's URL this turn; **do not** crawl a page-internal link they did not give

### Multi-document scenarios

If the user provides multiple inputs (local files, pasted text, and/or document URLs given this turn), take the A/B/C/D branch per document and merge them into complete input content.

### Supported input document types

| Document type | Description | Role in the pipeline |
|---------|------|----------------|
| PRD / requirement document | Product requirement document describing business functions, user stories, and acceptance criteria | Primary input for Stage 1 business-function analysis |
| Technical design | Technical design document describing architecture, interfaces, and data models | Primary input for the Stage 1 interface-object inventory and technical-implementation-object inventory |
| Spec document | Contract documents from the engineering process (interface spec, data spec, and so on), describing interface contracts, data structures, and protocol definitions | Supplemental input for the Stage 1 interface-object inventory and technical-implementation-object inventory, with the same standing as the technical design |
| Analytics-event document | Analytics-event definition document | Input for analytics-event test scenarios |
| Other local documents | Design notes, test strategy, historical experience, and so on | Assign to the matching analysis stage by content type |

**Core principle: do not restrict input document types; accept anything whose content can aid analysis. Accept local files, directories, pasted body text, or `http(s)://` document URLs the user gave this turn.**

### Multimedia content processing (mandatory; images/flowcharts must be checked)

`![](path)` in local Markdown is only a placeholder; business logic in the image (flow branches, interface calls, table data) does not enter the text automatically. **Every document (including child docs) must be scanned for image markers and processed per this section** — lost image content = a high-frequency root cause of missed functions.

**Execution order**: finish multimedia transcription **before** document cleaning — first parse/transcribe per this section and insert results back at the corresponding place in the original (replace the image placeholder and delete the original `![](path)` marker), then run the "Document cleaning rules" below on the complete document that contains the transcribed text. That is: multimedia transcription is a prerequisite input to cleaning, not a post-cleaning patch. `ingest_local_docs.py` first inserts flowchart summaries and "pending visual transcription" placeholders; Stage 0 must complete raster-image visual transcription before cleaning and persist.

#### Image identification and classification

Before cleaning, scan all `![...](...)` image markers and `<img src="...">` tags in the Markdown, and compare them with `assets` in `ingest-manifest.json`:

| Type | Identification features | Handling |
|------|---------|---------|
| Flowchart | Local `.svg` / `.drawio` / `.dio`, or a filename containing `drawio` | Use flowchart structured extraction (the script already did this) |
| Ordinary image | Local `.png/.jpg/.jpeg/.gif/.webp` and so on | Use image visual transcription |
| Remote/missing | `http(s):` URL that is not a user-given Stage 0 document this turn, or the relative-path file does not exist | Annotate TBD and ask the user to provide a local file or that URL this turn; do not crawl; do not use a doc-platform CLI |

#### drawio / SVG flowcharts: structured extraction (mandatory when present)

Flowcharts are the main carrier of interface call chains and branch judgments in a technical design; leaving only a placeholder equals dropping an entire block of logic:

1. **Scan and identify**: treat manifest `assets` with `type=flow` as authoritative; register the local path and the containing section
2. **Structured extraction**: `ingest_local_docs.py` has already called `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/extract_svg_text.py <local.svg|.drawio>`; on extraction failure, one retry of that single local file is allowed; if it still fails, use the fallback. Do not switch to remote scraping
3. **Insert in place**: replace the image placeholder in the original with the extracted text as a blockquote (delete the original marker) and annotate "📊 Flowchart summary: <figure title or containing-section context>"; the cleaning rules then run on the replaced full text

```text
> 📊 Flowchart summary: <figure title/context> (source: <local absolute path>, extraction method: extract_svg_text)
> (structured text of nodes and edges; do not truncate)
```

#### Ordinary images: visual transcription

1. **Locate the local file**: treat `localPath` of manifest `assets` with `status=local-ready` as authoritative. Do not download a remote URL that has no local file; go directly to the fallback
2. **Visual transcription**: use a vision model to parse each local image into text — tables: transcribe every cell completely and keep row/column structure; flowcharts: list all nodes and edge relations; architecture diagrams: list modules and dependency relations; purely decorative images: annotate "decorative image, no business information". **Batch constraint**: when a single document has more than 10 images, transcription must be batched, each batch ≤10 images sent to the vision model one batch at a time (too many images in one batch causes vision-model timeout; 20 images/batch is known to time out)
3. **Insert in place**: replace the original "📷 Pending visual transcription" placeholder or image marker with the transcribed text (delete the original marker) and annotate "📷 Image-content transcription: <one-sentence summary>"; the cleaning rules then run on the replaced full text

```text
> 📷 Image-content transcription: <one-sentence summary> (source: <local absolute path>, vision-model parse)
> (transcribed text; tables keep rows and columns; flowcharts list nodes and edges; do not truncate)
```

**Do not resolve prototype links**: interactive-draft / prototype links in the body (`proto.example.com`, i.e. MasterGo-hosted drafts) are not image markers and are not included in visual transcription — MasterGo depends on WebGL hardware-accelerated rendering, and a headless browser environment cannot extract the content (hard conclusion, empirically verified); keep the link as-is in the body. NoCode (`*.mynocode.host`) interactive drafts are pure frontend SPAs and can be rendered and parsed, but they are likewise not mandatory; keep the link as-is.

**Transcription fidelity requirements**: transcribe tables cell by cell; do not omit rows or columns; do not fuzz numeric values; annotate uncertain content "❓ Visual parse uncertain"; do not invent.

#### Fallback: fetch/parse failure

When a local file is missing, SVG parse fails, or the vision model fails:

1. At the image placeholder in the to-be-cleaned original, annotate "📷 Image fetch failed: {path or URL}, TBD" (this annotation enters the cleaned version with document cleaning and is kept at the corresponding place; this annotation is counted in the Stage 0 report transcription-block count, so downstream can distinguish "no image" from "has an image but fetch failed")
2. Register it in stage0-input-processing-report.md (issue: image content missing; source: document title + section)
3. **Do not invent image content** — prefer a TBD gap over inventing a flow from context
4. **Do not switch to a doc-platform CLI to pull supplements** — accept a local file, pasted text, or another URL the user gives this turn

> By this skill's design, multimedia parse results are **merged directly into the corresponding place in the cleaned document**; do not separately copy original images as formal artifacts. `_ingest/` is only an intermediate directory; later stages must not consume it as a cleaned version.

### Fallback when ingest fails

If local materials are incomplete:

1. Tell the user which parts are missing (for example "analytics-event section was not provided as a local file", "relative path `./api.md` does not exist", "HTTPS fetch returned empty")
2. Ask the user to resubmit a local file, directory, pasted body text, or an explicit document URL this turn
3. In later analysis, annotate unobtained parts "content ingest failed, TBD"; **do not invent content**

## Input-type judgment (mandatory)

Before starting analysis, first judge whether the user-provided input **contains a technical design or a Spec document**:

- **Has a technical design / Spec document**: the user explicitly provided local files, directories, or pasted content of technical documents such as a technical design, architecture design, interface design, interface spec, or data spec. These materials are read only in Stage 1-B; they are not read in Stage 1-A.
- **No technical design and no Spec document (PRD only)**: the user provided only a PRD / requirement document and no technical documents. Skip Stage 1-B and execute only 1-A.

**When the judgment is "no technical design and no Spec document", the following rules must be followed:**

1. **Omit entirely** the following sections (because there is no technical design, Stage 1-B cannot run); do not output them, do not leave them blank, and do not annotate "not mentioned":
   - Interface-object inventory (3.2.2)
   - Technical-architecture and data-model analysis
   - Technical-risk-signal (R01-R12) check results
   - Technical-implementation-object inventory (internal APIs, message queues, scheduled jobs, state machines, cache objects, database objects)
   - Data-object inventory
   - Dependency-object inventory
   - Business-to-technical mapping analysis
2. **Remove the "technical risk" column entirely** from the function-object inventory
3. **Risk assessment** does only the business-risk dimension, not the technical-risk dimension
4. **Impact-scope analysis** analyzes only function impact and compatibility impact explicitly stated in the documents; do not speculate.
5. **High-risk items** list only business risks

**Core principle: without a technical design, do not analyze technical-layer content; prefer less output over inventing.**

## Document cleaning rules (mandatory)

After the completeness precheck passes, perform structured cleaning of the document content; **only the cleaned content is the final version saved to `{run_dir}/testcase/testdocs/`**. Later stages consume only the cleaned version and no longer touch the original or the `_ingest/` intermediate draft.

### Cleaning goal

Delete content unrelated to test analysis; keep business / technical / data-related information so the context later stages consume is more concise and precise.

### Deletion rules (deterministic match; do not rely on subjective judgment)

The following content features are explicit; delete them once identified:

| Deletion type | Identification rule | Notes |
|---------|---------|------|
| Schedule and estimates | Section title contains "schedule", "estimate", "duration", "milestone", or "iteration plan" | Pure project-management information; later stages have no consumption scenario |
| Staffing | Section title contains "staffing", "work split", "owner", or "R&R" | Pure project-management information |
| Repo branches and baselines | Section title contains "branch", "baseline", "code repo", or "CR" / "MR" / "PR" link lists | Pure engineering-process information |
| Strikethrough content | Text with `<del>`, `~~text~~`, `<s>` markers, or `text-decoration: line-through` / `text-decoration-line: line-through` styles on `span`/`div`/`p`/`font`/`td`/`th`/`li` | Abandoned content; do not extract it as valid information. `ingest_local_docs.py` already removed strikethrough **fragments** when writing merged; unstruck text in the same cell/paragraph must be kept. The cleaned version must not still contain `~~` / `<del>` / `<s>` / `line-through` fragments. Remote links inside strikethrough segments are not TBD child docs |
| Pure process descriptions | Section title contains "review record", "meeting minutes", or "review minutes" | Process information with no business-rule value |

**Identification rules are based on section-title keywords and format markers; they do not involve content-relevance judgment and will not accidentally delete business content.**

### Retention rules (fidelity constraints)

For retained content, apply the following fidelity constraints:

**6 bans on source-text extraction**:

| Ban | ❌ Wrong | ✅ Right |
|------|--------|--------|
| Do not trim paragraphs | Keep only 3 of 5 paragraphs | Keep all 5 paragraphs |
| Do not summarize | "Mainly includes A, B, C" | Keep the full original text |
| Do not omit parameters | "Pass in the related parameters" | "Pass in shopId, spuId, skuId" |
| Do not fuzz numeric values | "When the threshold is exceeded" | "When 15 minutes is exceeded" |
| Do not drop branches | Keep only if and lose else | Keep the complete if-else |
| Do not rewrite wording | Source "if" rewritten as "when" | Keep the source "if" |

**Cleaning only deletes; it does not rewrite.** Retained content must match the original word for word. If a passage is neither a deletion type nor can be kept in full (for example it is too long but contains key information), keep the original without truncating — prefer keeping more over losing information.

### Conflict-annotation rules

When multiple input documents (for example a PRD and a technical design) disagree on the same description:

1. **Do not decide on your own which is correct** — keep both sides
2. Annotate the conflict "⚠️ Inter-document conflict, to be confirmed"
3. Keep the PRD description and the technical-design description as original text, separately
4. Record them in the later analysis stage's "issues to be confirmed" list

## Local storage of test materials

The only formal artifact directory for this stage is `{run_dir}/testcase/testdocs/` (except `_ingest/`). Save cleaned document content to that directory, **do not keep an original copy**, and later stages consume this version directly:

- Requirement document → `{run_dir}/testcase/testdocs/requirement-[title].md`
- Technical design → `{run_dir}/testcase/testdocs/tech-spec-[title].md`
- Spec document → `{run_dir}/testcase/testdocs/Spec-[title].md`
- Analytics-event document → `{run_dir}/testcase/testdocs/analytics-event-[title].md`
- Other documents → `{run_dir}/testcase/testdocs/[material-type]-[title].md`

File content is plain text ingested from a local file/directory/pasted body and then cleaned.

After Stage 0 finishes document processing, an input-processing receipt must also be written: `{run_dir}/testcase/testdocs/stage0-input-processing-report.md`. That report records each input document's type, **input form (A local file/directory, B upstream archive, C pasted body text, D remote link only; B must register the exemption-judgment basis and the image-marker count)**, source local path, cleaned-file absolute path, completeness-precheck results (including **image-marker scan dual counts: original image-marker count (`!\[.*\]\(` and `<img `) + transcription-annotation-block count (📊 Flowchart summary + 📷 Image-content transcription + 📷 Image fetch failed, three types totaled)** — original>0 = has images not yet transcribed; original=0 and transcription>0 = all images already processed; both zero = the document has no images; downstream uses this to distinguish empty-judgment nature), attached child-doc list (count and titles), **`gapStats` (`unresolvedRemoteCount` / `missingLocalCount` / `strikethroughSegmentsRemoved`) and remote/missing item titles**; later stages treat only this report and the cleaned materials in the same directory as authoritative, must not guess or scan other directories, and **must not cite body text of remote child docs that were not retrieved**.

## Optional local knowledge-pack check

Stage 0 only records whether the optional local knowledge directory has already been bootstrapped; it does not do business close reading, and it does not trim later Plan because the index is empty. The common flow and receipts follow only [knowledge-adapter.md](knowledge-adapter.md).

After requirement materials are persisted and before entering Stage 1, check whether `{run_dir}/knowledge/index.md` exists and is readable, and append `K0-xx` to `knowledge-audit.md`. When the index is missing, rerun bootstrap per [run-workspace.md](run-workspace.md) step 1b: if the user this turn explicitly gave a knowledge-repo Git URL, shallow-clone then build the index; otherwise write an empty index. When the entry count is 0, record `MISS` (an empty index is valid; do not mid-run ask for a knowledge source). Do not call a knowledge-retrieval Skill. Do not bind a remote case space. Do not connect to a doc platform. Do not automatically treat a URL in the requirement body as a knowledge-repo address.

After Stage 0 persist, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 0` (redirect stdout only). If `ok` is false, do not enter Stage 1.
