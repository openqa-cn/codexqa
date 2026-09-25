# HTML report (default: English)

Read this file before writing the report. Entry resolution is [analysis.md](analysis.md). Test recall is [test-recall.md](test-recall.md). Routing is [SKILL.md](../SKILL.md).
The template is [../assets/report-template.html](../assets/report-template.html), shipped with the skill.

This file covers only the **report half** of the deliverable: one self-contained HTML file at the root of the analyzed repo. (The other half is the **new case files** in the repo; see [generate-cases.md](generate-cases.md).) Markdown in the chat only points at those files. It is not the report.

The look follows the Claude Code session-report: ivory page `#FAF9F5`, dark terminal `#1a1918`, clay `#D97757`, numbers and commands in JetBrains Mono. **Do not** invent a card board, a light SaaS theme, or an Archify canvas.

**The default language is English.** Titles, metrics, findings, tables, and diagram captions are English. Keep symbol names, commands, and `file:line` as written. If the user did not ask for another language, do not retitle the sections.

The reader is **someone reviewing this change** (the author, a reviewer, a tester). Every section answers: which methods changed, which entry can reach them, what to test, and which cases in the repo can be reused as-is.

## Iron rule: the report is a result, not an analysis log

**The reader wants "what this change affects, and what to test", not the analysis process.** The report has **no process appendix**. Do not write any of the following:

- Analysis criteria such as "N true entries" (write "this change can reach N entries")
- Missing-edge fix counts, `to_count == 0`, stub / collision ratios, `actual_depth`, whether something was truncated
- Self-proving verdicts such as "false entry → corrected" (the table says only "entry / intermediate method", plus the **real** call chain)
- Command names and query fields (`reach --direction in`, `tested_count`, `edge-kinds`, and so on)

Test: **is this sentence a conclusion the reviewer needs, or something I did in order to reach a conclusion?** The second kind is not written.
**There is no exception:** no process appendix, and no "confidence / analysis scope" paragraph under "Risks and unknowns". How the analysis was done, whether graph edges are complete, whether tests edges exist, and which verdicts were corrected all stay in the analysis. They do not enter the deliverable.

## Section order (fixed; do not reorder)

```
Key findings → Risks and unknowns → Affected entries → Change list → Test plan → Coverage verdict → Sensitive paths
```

The order is the priority: conclusion and risk first, then checkable facts (entries / changes / regression / cases), then the test plan. **Risk sits immediately after key findings** — after the conclusion, the reviewer needs to know where the traps are. The template is already in this order. **Fill slots. Do not move sections.**

## Diagrams must be static (measured: the CDN may be unreachable)

**Do not render the diagram from a runtime CDN.** Measured: CDNs can all be unreachable (which hosts, and the timeouts, are KNOWN_LIMITATIONS item 7).

Recipe (local mermaid → static SVG → inline):

1. First write `<pre class="mermaid">…</pre>` as the template does (keep the template's `%%{init}%%` and the three `classDef` lines verbatim). **Read that source with an HTML parse or by line number. Do not regex-match `<pre class="mermaid">`.** The comment at the top of the template contains the same literal, and a regex runs from the comment through the real `</pre>` (measured: 11KB of CSS, which neither errors nor draws).
2. Find a **local** mermaid UMD build, for example `mermaid/dist/mermaid.min.js` in any `node_modules` (about 3.5 MB, loadable as a classic script, which avoids module/CORS limits).
3. **If no local mermaid is found:** do not stall. **Do not draw the diagram.** Describe the "entry → changed method" layers in text, and note "This report has no diagram" on `#meta-line` (one of the allowed `#meta-line` exceptions). You may also look for another mermaid UMD in a local `node_modules` or package cache (used only to produce a local SVG; it does not enter the deliverable).
4. Build a temporary page, render, and extract the `<svg>` from the DOM:
   ```bash
   cat > /tmp/render.html <<'EOF'
   <!doctype html><meta charset="utf-8">
   <pre class="mermaid">…paste the diagram source as-is…</pre>
   <script src="file:///abs/path/to/mermaid/dist/mermaid.min.js"></script>
   <script>mermaid.initialize({startOnLoad:true, theme:'base'});</script>
   EOF
   # Background: once --dump-dom finishes it writes /tmp/out.html, then Chrome stays up because of the open connection
   "<CHROME>" --headless=new --disable-gpu --no-sandbox \
     --allow-file-access-from-files --virtual-time-budget=6000 --dump-dom \
     file:///tmp/render.html > /tmp/out.html 2>/dev/null &
   CPID=$!
   for i in $(seq 1 40); do grep -q '<svg' /tmp/out.html 2>/dev/null && break; sleep 0.5; done
   kill $CPID 2>/dev/null          # stop as soon as you have it; it will not exit on its own
   grep -q 'data-processed="true"' /tmp/out.html && echo rendered
   # then extract <svg id="mermaid-…">…</svg> from /tmp/out.html
   ```
   **Kill as soon as `<svg` appears.** Chrome will not exit. A fixed timeout measured 40s; polling is usually 3–8s. Treat it as a failure only if `<svg` is still missing after 20s (usually a syntax error in the diagram source). **Windows, or a machine without bash job control:** use `timeout 20 <chrome ...>`, or run in the foreground and interrupt once output appears. `data-processed="true"` plus `<svg` means the render succeeded.
5. Replace `<pre class="mermaid">` with `<div class="mermaid-svg">…svg…</div>`, and **delete the mermaid loader at the end of the file.** Keep the original diagram source so it can be redrawn, but **do not store it in an HTML comment** (why: KNOWN_LIMITATIONS item 7). Store it as `<script type="text/plain" class="diagram-source">…source…</script>`. The template already has `.mermaid-svg svg { max-width:100%; height:auto }`. After the replacement, **confirm the archived source is complete** (every edge; a cut that also stops at `-->` keeps only the first half).
6. Check: open the report headless. Confirm `class="mermaid-svg"` and `<svg` are both in the DOM, and **no** `class="mermaid"` remains.

## Steps

1. **Evidence first.** Finish the index trust gate in [SKILL.md](../SKILL.md) and collect §1–§4 plus test recall (recall ends up in the test-plan "case file" column and the coverage-verdict section, not in a section of its own). Do not start filling the template without a trusted diff index.
2. **Copy the template** (shipped with the skill) to the **root of the analyzed repo**:
   ```bash
   cp <skill-dir>/assets/report-template.html <repo>/change-impact-$(basename <repo>)-$(date +%Y%m%d-%H%M).html
   ```
   When the repo name is clearer, use `change-impact-<repo-slug>-YYYYMMDD-HHMM.html`.
3. **Fill the copy.** By default **Edit one id at a time**. When there are many slots (large tables) you may **fill with a script**. Both paths must pass the delivery self-check in step 5. Do not rewrite the file with Write. **Do not change `<style>`.** Delete the trailing mermaid loader as step 5 of "Diagrams must be static". Do not touch it otherwise.
   Four traps measured when filling by script: a multiline match that forgot `re.S`; the host of `<tbody id="…-rows">` is `<tbody>`, not `<div>`; **`\g<1>` is not expanded when the replacement is a function** (template ids get written as the literal); extracting diagram source by regex-matching `<pre class="mermaid">` (the comment at the top of the template contains the same literal, so the match runs from the comment through the real element and eats half the document). Locate by id:
   - `<title>`, `#title-path`, `#cmd-repo`, `#cmd-flags`, `#meta-line`
   - `#hero-total` / `#hero-split` (the hero number is **how many entries this change can reach**, with the unit "entries" — count **distinct** values in the "reachable entry" column of `#entry-rows`: one entry reached by several changed methods counts once)
   - `#howto` may be rewritten for this repo, but it must still say "read findings first → then entries → then which cases can be reused"
   - `#overall-grid` (changed files / changed methods / affected entries / cases you can reuse / uncovered test points / coverage verdict). **How the two details split:** "affected entries" splits by the shape of the reachable-entry column — a route or page counts as "page routes", everything else as "APIs". "Uncovered test points" = the count of `#coverage` item 3 "still cannot cover" plus test-plan rows whose assertion is not strong enough to prove the new behavior (those are the same points as "partially covered" in the coverage verdict).
   - **One classification runs through the whole report: added / changed / deleted.** The category column of `#change-rows` is the only authority. Its values are exactly those three (the same axis as `symbols --change add,change,delete`). `#change-count`, `#hero-split`, and "changed methods" in `#overall-grid` all count **that same classification**, and the three counts sum to the change-list row count. **Do not invent another classification** (for example "signature/contract / behavior change / test"). Whether the change touches an external contract, and whether it is a test function, goes in "what changed". The category column has only those three values. A made-up category will not add up against the headings. Test functions count in the "changed" total, and the detail or "what changed" notes "1 of them is in a test file".
   - **Summary numbers are counted from table rows. Do not estimate, and do not add from memory.** Before writing a number, count the table it comes from. **Do not mix the two entry counts:** rows with `tag entry` = how many **changed methods are themselves entries**. `#hero-*` and "affected entries" = the **distinct** reachable-entry column (the two counts often differ; write the difference into the detail). Cases named as "already covered" in the coverage verdict = cases you can reuse. Grouped counts of the `#change-rows` category column = the changed-method split. **When the same number differs under two criteria, the detail must name the criterion.** An unnamed criterion is a trap for the reader.
   - **Count only `<tr>` inside `<tbody>`. Exclude header rows.** Measured miss: counting the `<thead>` `<tr>` inflated the changed-method count by 1, and because the other numbers still "agreed" the error was invisible.
   - `#takeaways` — **3 to 5** items. Each item = a fact plus what it means for the reader. Exact markup:
     ```html
     <div class="take bad"><div class="fig">Gap</div><div class="txt"><b>The same bug in <code>some panel</code> is completely untested.</b> The fix is a crash after <code>await</code> invalidates the event object, and <code>POST /api/xxx</code> has zero hits in every test file.</div></div>
     ```
     Classes: `.take bad` (uncovered test point / contract blast / sensitive path with zero coverage), `.take good` (the line that is well covered), `.take info` (neutral facts such as the nature of the change). `.fig` is a short label (`Gap`, `Blast`, `Covered`, `Nature`). The subject of the conclusion is inside `<b>`. **Write facts in business / API language only.** Do not write analysis criteria or process data ("8 true entries", "4 missing-edge fixes", "43 stubs", "`to_count=0`"). The report does not contain those.
   - `#entry-rows` — one row per changed method. Columns are fixed: # / changed method / call chain (real callers) / reachable entry (`file:line`) / shape / verdict. The verdict uses only two badges: `<span class="tag entry">entry</span>` (this changed method is itself an entry), `<span class="tag mid">intermediate</span>` (it has an upstream; it is not an entry). **The call chain must name the real callers** (already cross-checked). Which places the graph got wrong is process data. Do not write it.
   - `#entry-extra` — entries that **were not themselves changed but are hit by a contract change** (for example a caller that now takes the new default after a signature change). **List only entries that do not already appear in the reachable-entry column.** Do not repeat a row from the table. If there are none, write "none".
   - `#change-count` / `#change-rows` — **list methods only, not a file inventory** (each method already has `file:line`; listing files again is duplicate). The category column is exactly **added / changed / deleted**. **The table has only four columns: category / method / file:line / what changed.** Do not add a "contract change" verdict column. Whether an external contract moved is shown by the actual difference in "what changed" (signature, return value, default). A separate column invents a vocabulary for a judgment the neighboring columns already imply. At file level, keep only the "changed files" count, and put the criterion in the detail (for example "6 production + 2 test + 1 doc"). If the file list had a fact the method list does not (a test file changed but has no changed method, a doc was left out of the analysis), fold that into one sentence in `#coverage` or "Risks and unknowns". Do not keep a whole table for it.
   - `#coverage` — **coverage verdict (its own section, a sibling of the test plan).** A summary is enough. The verdict is exactly one of already covered / partially covered / not covered, then three paragraphs: (1) how many points existing cases cover (a count per file is enough; per-case locations are in the "case file" column — do not copy the case names again); (2) **which original gaps the new cases now cover** (name each one, including "weak assertion → strengthened"); (3) **which points still cannot be covered, and why** (for example browser behavior, or a two-account isolation check). Do not list the cases again here, and do not add a recall row for a gap.
   - `#testplan-artifact` — **one sentence only:** the new case files (**name every file that was generated**, API layer and end-to-end separately) plus each file's case count and pass / skip result. Example: `API layer N cases (X passed / Y skipped), end-to-end M cases (all passed), N+M cases all passed`. **Do not** write how to run, column-value notes, whether the old assertion is still there, or whether the file is wired into the repo's test entry. Those are process notes. They do not enter the report. If no case code was generated, write "not generated".
   - `#sensitive` — **sensitive paths (its own section, a sibling of the test plan):** auth / password / payment / stock / user data. Each item says "previous coverage → what is covered now (with the case location) → what still cannot be covered, and why". If there are none, write "none".
   - `#testplan-entries` / `#testplan-new-rows` / `#testplan-regression-rows` — the test plan **must be two groups. One group is a rewrite.** `#testplan-new-rows` "points this change must newly cover" = behavior this change **introduced or altered**. `#testplan-regression-rows` "points to regression-test" = existing behavior this change **might break**. The regression group must name three kinds in particular: callers that take a default or an empty branch, inputs rewritten by a side effect, and return values reused after a signature change. Both groups connect to existing cases cited in the "case file" column. Do not recreate a case that already exists.

**Split source info into three columns. Do not pack it into one cell:** `disposition` / `kind` / `case file`.

| Column | Values | Notes |
|---|---|---|
| **Disposition** | `reuse` / `extend` / `add` / `uncovered` | Closed vocabulary. **Do not invent a parenthetical suffix** (measured miss: the same fact was written "add", "add (gap)", and "add regression", and the reader could not tell them apart) |
| **Kind** | Follow the repo's test-layer names (for example `API smoke` / `API test` / `UI end-to-end` / `UI render smoke`) | The layer the case lives in. When one row spans two layers, write both (for example "API regression + UI end-to-end") |
| **Case file** | `<file:line>`, joined with `, ` when there are several | `reuse` / `extend` give the existing case location (a case name is better). `add` gives the location in the generated file. `extend` is written `existing <file:line> → new <generated:line> covers` |

- `extend` is a **diagnosis** (the existing assertion is weak). Under the add-only hard rule **the existing file is not edited**. A new case covers the same assertion point.
- An `uncovered` row **must state the reason** (in the "case file" column).
- Background such as "previously zero coverage" goes in the **scenario** column (for example "change-password button state (previously zero coverage)"). Do not hang it on the disposition word.

   - `#risks` — **only risks of this change itself:** contract compatibility, uncovered sensitive paths, boundary behavior that still needs confirmation.
   - `#foot-left` / `#foot-right` — repo, base, and generation time (**only those three**; index size and the consistency-check result are process data and do not enter the report).
   - The `.diagram` block under "Affected entries" — **at least one Mermaid diagram.** Keep `%%{init:...}%%` and the three `classDef` lines verbatim. Change only nodes and edges. The three lines under the diagram say `Basis`, `Cut off`, and `What this shows`, in English. Escape `<` and `&` in node labels. **Before delivery, render the diagram to an inlined static SVG. See "Diagrams must be static" above.** Leaving `<pre class="mermaid">` plus a CDN loader means the report is not done.
4. **Do not delete a section.** If this change truly has nothing for a section, write "none" or keep the empty-state prompt. Do not drop the heading to make the page look cleaner.
5. **Delivery self-check (5 checks; run each one; do not rely on a glance):**
   - **No template id is missing:** list the template's 23 ids and **grep each one** (inlined SVG also has `id="…"`, so counting `id="` false-fails). The four `<tbody id="…-rows">`, `#overall-grid`, and `#coverage` must all be present.
   - **No replacement residue:** a search for `\g<` across the file must be 0.
   - **Structure was not eaten:** exactly 7 `<section>` and exactly 7 `<h2>`, in the iron-rule order.
   - **No unfilled slot:** a search for `>—<` must be 0.
   - **Summaries equal table rows:** every number in `#hero-*` and `#overall-grid` matches the `<tbody>` row counts of `#entry-rows` / `#change-rows` / `#testplan-*` (count `<tbody>` only; exclude header rows).
6. **Tell the user the file path.** Do not paste the whole HTML into the chat.

## Where each slot's data comes from (do not fill from memory)

| Slot | Taken from |
|---|---|
| `#meta-line` | The change base, plus the set comparison of `git diff --name-only <base>...HEAD` against `files --change add,change,delete`. **The only allowed exception:** degraded mode / incomplete graph (`truncated` or many stubs) / no change baseline / no diagram / untrusted index. Append one statement here ("Degraded: no symbol graph", "Degraded: graph incomplete", "Degraded: index untrusted", "No change baseline", "This report has no diagram"). **That sentence is written only here.** Nowhere else |
| `#change-rows` category and summary | `symbols --change` + `symbol-diff --id` (the patch is the only authority for "what changed") |
| Every `file:line` | **Always 1-based:** CodexQA `start_line` is 0-based, so add 1 before writing it into the report. Use `grep -n` results as-is. Mixing them sends the reader to the wrong line |
| `#entry-rows` call chain | Layered `hops` from `reach --direction in --depth 10` plus `edges --direction in`, **then cross-checked with `grep -rn`** |
| `#entry-rows` verdict | Whether this changed method itself has an upstream. If the graph says `to_count=0` but text has a call site, write the real call chain from the text |
| `#coverage` | `tested_count` and `reach --edge-kinds tests` (if empty, text-recall the test files). Only "strong" counts as coverage. Gaps and "now covered / still not" follow the generated file's actual `check`s |
| Existing cases in the "case file" column | Recall keys are field names / paths / error-code literals from the patch (**not** symbol names). After a hit, read the case name and kind from the test file |
| `#testplan-new-rows` | Fields, defaults, states, and error codes the patch added or changed. Each row is one observable point that can be asserted |
| The three `#testplan-*` columns | Disposition comes from the diagnosis. Kind comes from the layer the case lives in. Existing `file:line` + case name come from recall. An `add` location is the line of the actual `check` in the generated file |
| `#testplan-regression-rows` | Callers from the regression-scope analysis (§4), plus signature changes / side effects / default-argument branches in the patch |
| `#risks` | Patch meaning (contract change, parameter defaults, side effects) and uncovered sensitive paths |

## How to write each section so it is useful

| Section | The reader should leave with | Do not write |
|---|---|---|
| Key findings | The test that most needs to be added, who a contract change hits, which line is best covered | A pile of field names, a recitation of change-group numbers, **analysis criteria and process data**, a fact with no "so what" |
| Risks and unknowns | Compatibility of this change, sensitive paths, behavior that still needs confirmation | Limits of the method, criterion notes, a confidence statement (never written; degraded / no baseline / no diagram is one sentence on `#meta-line` only) |
| Affected entries | Which APIs or pages can trigger this change, and what the call chain is | Analysis vocabulary (true entry / false entry); treating `to_count == 0` as an entry without a cross-check |
| Change list | What was added, changed, and deleted, with before/after in "what changed" | Only `change_status`, with no "what changed" |
| Test plan | "What is newly covered" is distinct from "what must not break". Every row has an assertable field / state / error code. The "case file" column can be opened directly | Only one group of cases, regression mixed into new coverage, only test file names, assertion-free lines such as "test the list API" |
| Coverage verdict | How much existing cases cover, which gaps the new cases closed, which points still cannot be covered and why | Copying the case list again; filling the coverage conclusion with medium / weak |
| Sensitive paths | For each sensitive surface: previous coverage → what is covered now → what still cannot be covered | Only the keywords auth / password, with no coverage statement |

## Rewrite the whole report if any of these happen

- The skin palette was changed (ivory / term-bg / clay / JetBrains Mono is missing)
- The template was not copied and a new layout was invented, or a full Write rewrite changed the CSS (deleting the trailing mermaid loader as "Diagrams must be static" says is not "changed")
- Mermaid is missing `%%{init:...}%%`, missing the three `classDef` lines, or the diagram does not mark the changed nodes
- **The diagram depends on a runtime CDN:** the deliverable still has `<pre class="mermaid">` plus a loader, and no inlined static SVG (measured: the CDN may be entirely unreachable, and the diagram will not render)
- **Mermaid source text is visible on the page:** the visible body shows `:::changed`, `flowchart TD`, `classDef`, or `-->` (the source was cut short by an HTML comment, or a leftover fragment was left during replacement)
- The entry table has a row judged "entry" whose call chain was not text-cross-checked
- The coverage verdict is a conclusion with no evidence: it does not name an existing case's name + `file:line`, or it treats "weak" as coverage
- **A recall row was listed for a case that does not exist yet** (location `—`, disposition "add"): new cases appear only in `#testplan-new-rows`
- The coverage verdict is missing, or medium / weak was used to fill the coverage conclusion
- **The report contains process data or criterion notes:** headline numbers / key findings / any table / "Risks and unknowns" contain "N true entries", "N missing-edge fixes", a stub ratio, `to_count`, a command name, or an "analysis scope and confidence" paragraph. None of that is written. (**Exception:** the one sentence for degraded / no baseline / no diagram is written only on `#meta-line`. See "Where each slot's data comes from")
- **A whole section "analysis confidence and criteria" or "reproduce commands" was kept, or an "analysis scope and confidence" paragraph was added:** the report has exactly 7 sections. Process data and criterion notes do not enter the deliverable
- **"Coverage verdict" or "Sensitive paths" was stuffed back into the test plan as a callout:** they are their own sections, siblings of the test plan
- **Summary numbers do not match table rows:** numbers in `#hero-*` / `#overall-grid` / key findings disagree with the row counts of `#entry-rows`, `#change-rows`, `#testplan-new-rows` / `#testplan-regression-rows` (measured miss: the body table was correct row by row, but the summary said "5 missing edges" while the table had 4 rows, and "13 strong links" while the table had 14 — the summary was not recounted from the table)
- **Classifications were mixed:** the `#change-rows` category column is not the same classification as the section heading / hero line / stat grid, or the category column contains made-up values such as "signature/contract / behavior change / test" (measured miss: the table used a qualitative axis and the heading used added/changed/deleted, and the two axes did not add up). The category can only be **added / changed / deleted**. Contract and test facts go in the column or the "what changed" cell where they belong
- Evidence is not from this run of `change-groups` / `symbol-diff` / `edges` / `reach` / `files`
- `to_count` / `tested_count` / `change-groups` are used as reader language
- Case files were generated but **never run**: `#testplan-artifact` has no pass / skip counts, or a failing run was delivered anyway; or that sentence contains run details and other process notes; or several files were generated but only one is named
- Generating cases edited an existing test file or `package.json`
- **Test-plan source info cannot be located:** the disposition column invented a parenthetical suffix such as "add (gap)" or "add regression"; an `add` row has no `file:line` in the generated file; an `uncovered` row has no reason
