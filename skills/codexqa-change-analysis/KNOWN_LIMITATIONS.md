# Known limitations (measured)

These limits change how reliable a conclusion is. **Treat every item that applies as a constraint during analysis.** Do not skip one silently.

> **What "measured" means:** every measurement below was run on one **JS sample repo** (Node backend, plain frontend, two test scripts).
> Paths and symbol names in that repo (`server.js`, `catalog.js`, `listBooks`, `favorited`, and so on) are **examples only**.
> They make the failure concrete. Take the **mechanism and the workaround**, not the names.
> Another repo or language may be milder or worse (Rust / Java cross-file call edges are usually more complete than JS).

**Read only the item that matches the symptom. Do not read the whole file:** tags unchanged after a new base → 1; `to_count==0` false entry → 2; `tested_count` all 0 → 3; `tagged` empty → 4; depth or line cap hit → 5; `search` misses call sites → 6; diagram does not render → 7; line numbers off by 1 → 8; side effects of generated cases → 9; command errors or hangs → 10.

## 1. Incremental index does not refresh diff tags (largest impact)

`codexqa index . --diff-base <base>` prints `mode: incremental (no changes)` and returns when files are unchanged. **It keeps the change tags from the previous diff index.**

Measured: index with `--diff-base HEAD~1` (3 change groups / 11 symbols), then `codexqa index . --diff-base HEAD` (incremental) → `change-groups` still returns those 3 groups. Only `codexqa index . --diff-base HEAD --full` correctly returns zero.

**Workaround:** SKILL.md hard rule 1 and the index trust gate (`--full` plus a set comparison against `git diff`).

## 2. Cross-file call edges can be missing in dynamic languages → `to_count == 0` reports non-entries as entries

Measured (sample repo): `server.js:87` clearly calls `listBooks(...)`, but `listBooks.to_count == 0`, and `reach --direction in` only returns the same-file `homeFeed`. The call to `markFavorites` at `server.js:91` is also missing from the graph. **Same-file call edges are usually complete** (both in-file calls to `markFavorites` inside `catalog.js` were indexed). The gap is concentrated on **cross-file** calls, so "this file has edges" does not imply "cross-file edges exist".

**Workaround:** SKILL.md hard rule 2 and analysis.md §3.2 (text cross-check is mandatory). When graph edges are incomplete, the report only marks `#meta-line` with "Degraded: graph incomplete".

## 3. `tests` edges depend on language support; JS measured as empty

Measured: all 406 nodes in that JS repo have `source=local`, `tested_count` is always 0, and `reach --edge-kinds tests` is empty, while the sample repo has a full API smoke script (`scripts/smoke-test.mjs`) and a UI end-to-end script (`scripts/e2e-ui.mjs`).

**Workaround:** when layer A is empty, **you must** run layer B text recall ([test-recall.md](references/test-recall.md)). Do not write "`tested_count` is all 0" as "the repo has no tests".

Extra measurement (sample repo): searching test files for **changed symbol names** also misses everything (`markFavorites` / `listBooks` / `homeFeed` had zero hits). Recall keys must be **field names / paths / error codes introduced by the patch** (`favorited`, `/api/books` hit 4 or more cases). See [test-recall.md](references/test-recall.md) §B2.

## 4. Framework tags cover only some languages

`codexqa tag . keys --json` currently registers taggers only for Spring / Rust (`framework.http`, `framework.http.method`, `framework.http.client`, `framework.mq_consumer`). A JS/TS/Python repo's `tagged --key framework.http` is empty, and its `repo_count` is 0.

**Workaround:** when `tagged` is empty, find entries from text shapes of route registration / `main` / event registration (§3.3). Do not treat an empty result as "there are no entries".

## 5. Hard caps

| Item | Cap | Effect |
|---|---|---|
| `reach --depth` | 10 | A longer chain does not reach the top: continue in layers and judge conservatively. **Do not write "did not reach the top" as process notes.** The report only marks `#meta-line` with "Degraded: graph incomplete" |
| `symbol-diff --max-lines` | 500 | The patch is truncated; fall back to `file-source` / `file-base` |
| `repos --limit` | 200 (default 20) | Overflow is silently truncated; use `--filter` and pages |
| `change-groups` | `truncated: true` | Change groups are incomplete; treat risk order and blast radius conservatively. The report only marks `#meta-line` with "Degraded: graph incomplete" |

## 6. Other

- A deleted symbol may have no patch (the node is gone from the after-file). Fill it from `file-base` or `git show <base>:<file>`.
- `path` returning `hops=-1` only means "not connected within the given depth". Missing edges produce the same result. Do not conclude "unreachable" from it.
- **`search` is file-chunk retrieval. It cannot enumerate call sites or line numbers.** Measured: `search --query <function name> --limit 50` returns about one hit per file in the repo, and the hit is an import chunk, **missing the real call line**. Find call sites with `edges` / `reach` (when the graph has the edge) or `grep` (when it does not).
- **`search --tests-only` measured as always empty:** the sample repo's test files are in the index (they are found without the flag), but both the simple and whitespace tokenizers return 0 hits with `--tests-only`. Filter test files by name yourself.
- Pick the tokenizer by query type: behavior keys (field names / paths / error codes) use the default **simple** tokenizer. `--tokenizer whitespace` fits whole symbol names, but misses behavior keys such as `.fieldName` that sit inside a larger token. Switching tokenizers needs `--force` to rebuild the index.
- The first full index of a large repo is slow. `--full` re-parses the whole tree. That cost is expected. Do not interrupt it and conclude from a half-built index.

## 7. HTML report rendering (measured)

- **Fonts and diagrams both depend on the network, and the network may be allow-listed.** Measured on one machine: `cdn.jsdelivr.net`, `unpkg.com`, `esm.sh`, `cdnjs.cloudflare.com`, and `registry.npmjs.org` **all timed out (HTTP 000, 12–15s)**. Only `fonts.googleapis.com` returned 200. **Do not render the diagram from a runtime CDN.**
- **Render the diagram to an inlined static SVG** (recipe in [references/report.md](references/report.md), "Diagrams must be static"). After inlining, the diagram shows offline and the report no longer needs a mermaid runtime.
- Check: open the report headless. The DOM should contain `class="mermaid-svg"` and `<svg`, and **no** leftover `class="mermaid"`. If you only see the raw `<pre class="mermaid">`, the diagram was not rendered.
- Missing fonts only affect looks (fallback to system fonts). Body and tables are unaffected. Readability does not depend on a CDN.
- Do not **wait out** a headless `--dump-dom`. The connection keeps Chrome from exiting. **Run it in the background and kill it as soon as the target appears** (poll the DOM for `<svg` or `class="mermaid-svg"`; a fixed wait measured 40s, polling is usually 3–8s). Only then fall back to a hard timeout such as `perl -e 'alarm 25; exec @ARGV'`.
- The same failure hits any report that uses "template + CDN loader" (including code-wiki output). Check CDN reachability first.
- **Do not store Mermaid source in an HTML comment.** Edges are `-->`. A comment ends at the first `-->`, and the rest of the source becomes page text (measured: the first of 21 `:::` and 20 `-->` closed the comment, and about 1KB of source rendered on the diagram). Archive with `<script type="text/plain" class="diagram-source">…</script>`. Script contents are not rendered.
- **After archiving, check that the source is complete.** The same trap happens if the cut also stops at `-->`: the archive keeps only the first half (measured: 18 lines stored, every edge missing). The archive must contain `flowchart TD`, every `classDef`, both `subgraph`s, and the last edge.
- When checking the whole report, visible text should have a count of 0 for `:::`, `flowchart`, `classDef`, and `-->` (count after removing `<svg>`, `<script>`, and comments).
- Escape `<` and `&` in node labels, or Mermaid fails to parse or breaks the HTML.

## 8. CodexQA line numbers are 0-based (measured; affects every `file:line`)

CodexQA `start_line` / `end_line` and `search` lines are **0-based**. `grep -n` and editors are 1-based.

Measured (JS sample repo): all 11 method locations in the report were **off by one line**. CodexQA reported `xxx.js:48`; the editor has `export function ...` on line 49. The same shift appeared as 95→96, 5→6, and 8→9.

**Workaround:** SKILL.md hard rule 8. Before delivery, spot-check: `sed -n "<line>p" <file>` should be the method definition, not the previous line or a JSDoc line.

- Related trap: `symbol-diff` hunk headers are git-style (1-based) and come from a different source than node lines. Do not use them to "correct" node lines.

## 9. Two side effects of "add only" (measured)

The hard rule says generated cases **only add files and do not edit existing test files or `package.json`**. That has two costs. **Both are notes for the analysis. Do not write them into the report.** `#testplan-artifact` only states case counts and pass / skip results (wording in [references/generate-cases.md](references/generate-cases.md)):

1. **The old weak assertion stays in the repo.** A case marked "extend" is not strengthened. It still passes. The strong assertion exists only in the generated file. Writing the locations is enough: the case-file column is `existing <file:line> → new <generated:line> covers`. **Do not** add a note such as "existing case was not edited". Writing "extend" without a location is what makes the reader think the old case must be edited (measured).
2. **The generated file is not wired into the repo's own test entry.** Because `package.json` / `Makefile` cannot be edited, the repo's normal test command does not run it. Run the generated file explicitly. Otherwise it looks as if the repo's own tests covered this change.

Also: destructive cases (password changes and similar) use a temporary account and **may leave test data** (many repos have no self-service delete). Clean up when you can. If you cannot, say so **in the chat** (not in the report). Do not leave it silently.

## 10. Blockers (symptom → action)

| Symptom | Action |
|---|---|
| `command not found: codexqa` | `npm i -g @openqa-cn/codexqa`, or `export PATH="$(npm prefix -g)/bin:$PATH"`. If it cannot be installed, use degraded mode |
| Repo not indexed / `query` says `repo not indexed` | Run the gate: `codexqa index . --diff-base <base> --full`. The first run builds a full index. Confirm with `codexqa repos --filter <substr> --limit 200`. Do not run bare `repos` |
| Not a git repo (`fatal: not a git repository`, and similar) | Without a base there is no "change". Do not invent one. Ask the user for a baseline repo or a patch. If there truly is no base, do a static analysis and mark `#meta-line` "No change baseline" |
| `change-groups` is empty, or tags look like the previous run | The base changed without `--full`. Re-run `index . --diff-base <base> --full` |
| Every `change_status` in the repo is `default` | This is not a diff index. Re-run with `--diff-base` |
| `file-base` is empty | Not a diff index, or this file did not change |
| `tagged --key framework.http` is empty | This language has no tagger → find entries with route-registration text such as `grep -n "router\.\(get\|post\|put\|delete\)"` |
| `tested_count` is all 0 and `reach --edge-kinds tests` is empty | This language emits no tests edges → run layer B text recall. Do not write "no tests" |
| `stats` shows many stubs / collisions | Edges may be incomplete: judge blast radius conservatively, and mark `#meta-line` "Degraded: graph incomplete" |
| Diff or symbol count is huge | Read the top 5–8 `change-groups` by fan-in in detail. List the rest and say they were truncated |
