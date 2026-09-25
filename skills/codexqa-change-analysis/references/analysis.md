# Change-analysis workflow

[SKILL.md](../SKILL.md) is the routing and delivery contract. This file is the step-by-step detail. Test recall is [test-recall.md](test-recall.md).
Prefer a local path for `<repo>`. `<base>` is what the user named, or what the trust gate infers. Finish the index trust gate in [SKILL.md](../SKILL.md) before entering here.

---

## §1 Change list

Goal: a checkable list of added / changed / deleted methods and files. **The index must already have been built with `--diff-base <base> --full`.**

```bash
codexqa query --repo . files   --change add,change,delete
codexqa query --repo . symbols --change add,change --kind function,method
codexqa query --repo . symbols --change add --kind function,method,class   # added only
codexqa query --repo . symbols --change change --kind function,method      # changed only
codexqa query --repo . symbols --change delete
codexqa query --repo . symbols --change add,change --kind function,method  # then filter file_path for test/spec: did tests change too?
```

Read these fields: `id` (primary key for every later query), `name`, `file_path`, `start_line`, `end_line`, `change_status` (`add` / `change` / `delete`), `to_count` (in-degree), `from_count` (out-degree), `tested_count` (tests-edge count), `source`, `tags`.

> **`start_line` / `end_line` are 0-based** (CodexQA is 0-based everywhere; `search` output says so). `grep -n` and editors are 1-based. **Every `file:line` in the report uses the editor line**: add 1 to a CodexQA line; use a grep line as-is. Do not mix 0-based and 1-based for the same method.

Notes:

- `--kind function,method` is the default cut. `add` is not always a "new feature": it may only be logic extracted into a function. Judge "new method" together with the §2 patch. Do not stop at `change_status`.
- When there are many symbols, walk `change-groups` in risk order. **Between groups**, order by max fan-in descending (the CLI says "Groups are ordered by max fan-in (highest risk first)"). **Symbols inside a group are ordered by file / position, not by risk.** Read high-risk groups in detail and list the rest.
- `change-groups` clusters changed symbols that share a file, a call, or an import. Use the group for blast radius. Do not write each symbol in isolation.
- `truncated: true`, or a high stub/collision count in `stats`, means the graph is incomplete. Judge blast radius conservatively. **In the report, only mark `#meta-line` with "Degraded: graph incomplete"** (the criterion itself does not enter the deliverable).
- Say separately whether this diff also changed tests. A changed test file is not coverage of this change.
- **`--include-tests` is not the switch for "did tests change".** It only includes nodes the indexer marked `source=test`. Measured on the sample repo that count was 0 (test files were also `file_source=local`), so the flag changed nothing. Judge "is this a test" from `file_path` only.

```bash
codexqa query --repo . change-groups
codexqa stats .
```

---

## §2 Read the patch and classify the change

**`symbol-diff` is the only authority for "what changed".** Everything else is a guess.

```bash
codexqa query --repo . symbol-diff --id <id>
codexqa query --repo . symbol-diff --id <id> --max-lines 200      # hard cap 500
codexqa query --repo . file-source --file <path>                  # whole file after the change
codexqa query --repo . file-base   --file <path>                  # whole file at diff-base
```

`symbol-diff` is the intersection of the node's line range and the diff hunks. It includes `diff` (unified diff text), `diff_lines`, and `truncated`. When the patch is truncated, raise `--max-lines` or fall back to comparing `file-source` and `file-base`. An empty `file-base` means this is not a diff index, or this file did not change.

Classify each method. **This classification is evidence, not a report column.** The change-list category column is fixed to **added / changed / deleted** (the same axis as `symbols --change`). Put the qualitative conclusion in **what changed** (for example "added an optional parameter; the return value gained a field" already says the contract changed). Do not add a separate "contract change" column:

| Kind | How to decide |
|---|---|
| Added method | `change_status=add` and the patch is a pure addition. Separate "extract a function" from "new capability" |
| Behavior change | Logic, defaults, branches, or queries inside an existing symbol changed; the signature did not (write "internal behavior only" in the summary) |
| Signature / contract change | Parameters, return value, export name, error code, route path, or event name changed (callers are affected; highest risk). The summary must show the signature before and after |
| Deleted | `change_status=delete`. List the call sites that still reference it after de-duplication |
| Comment / format only | No logic difference. Write "no behavior change" in the summary |

**Extract recall keys** from the patch for step 6: added or renamed symbol names, changed file paths, new HTTP path literals, error-code literals, event names, SQL table or column names, config keys.

---

## §3 Entry resolution (core: methods with no upstream caller)

Definition: **an entry is a method on this change's impact chain that has no upstream caller** (in-degree 0, after false zeros caused by missing graph edges have been removed). Typical shapes: HTTP route handler, `main`, MQ consumer, scheduled task, CLI command, exported function consumed directly from outside.

### 3.1 Walk up the graph

```bash
codexqa query --repo . edges --id <changed-id> --direction in            # first-hop direct callers
codexqa query --repo . reach --id <changed-id> --direction in --depth 10 # walk up layer by layer (hard cap 10)
codexqa query --repo . imports --file <changed-file> --direction in      # file-level dependents
```

**Batch per-symbol queries into one script.** §3 and §4 need `edges` + `reach` (and `imports`) for every changed method. Eleven methods are 20+ calls. Those queries themselves measured about 3s, but one round-trip per method is more than 10× the wait. Run one script, collect a table, then judge.

`reach` returns `hops` grouped by hop. Read `to_count` on each layer:

- A node with `to_count == 0` → **entry candidate**
- Nodes that still have `to_count > 0` → start a new `reach` from them until the last layer is all zeros
- `actual_depth` stops at 10 and the last layer still has in-degree → the chain is longer. Treat it conservatively. **In the report, only mark `#meta-line` with "Degraded: graph incomplete".** Do not write process notes such as "did not reach the top"

### 3.2 Mandatory cross-check (skipping this step mis-reports entries)

Cross-file call edges are missing in dynamic-language repos. `to_count == 0` is not an entry (hard rule 2; measured case in KNOWN_LIMITATIONS item 2). For every entry candidate:

```bash
# 0) Graph first: confirm whether the graph has any edge (if it does, do not drop to text)
codexqa query --repo . edges --id <candidate-id> --direction in
codexqa query --repo . imports --file <candidate-file> --direction in   # file-level dependents

# 1) Text fill-in: only when the step above returned 0 rows, enumerate call sites of the symbol (exclude the definition)
grep -rn "<symbol>" --include=*.<ext> <repo>
# 2) Check whether those call sites are already in the graph (compare from_id / from_file of edges --direction in)
# 3) If a call site is not in the graph → the symbol is a false entry. Keep walking up from the caller's file
```

Why `grep` and not `codexqa search`: `search` is **file-chunk** BM25. One file returns one hit (`path` + line range + snippet) and **does not give the call-site line**. Measured: a function-name query returned a file's import chunk, and the line that actually calls the function did not appear. At `--limit 50` it degrades toward hitting almost every file. So `search` may only narrow candidate files. Line-level call sites must come from `grep`.

Write the cross-check result in the "verdict" column of the §3.4 table (entry / intermediate method). **Do not write the cross-check commands into the report.** The report shows only the real call chain after the cross-check. The analysis must still have run them (especially when graph edges are incomplete), or the verdict is not trustworthy.

### 3.3 Framework entries (graph and tags may both be empty)

```bash
codexqa tag . keys --json                        # tag keys this repo can query
codexqa query --repo . tagged --key framework.http          # server routes (Spring / Rust taggers only)
codexqa query --repo . tagged --key framework.http.client   # outbound REST call sites
codexqa query --repo . tagged --key framework.mq_consumer   # MQ consumers
```

`tag keys` only covers languages with a registered tagger (currently Spring / Rust). **JS/TS/Python repos usually have an empty `tagged` result. Find entries from text shapes:**

```bash
grep -rn "router\.\(get\|post\|put\|patch\|delete\)\|app\.\(get\|post\)" <repo>   # Node/Express
grep -rn "@GetMapping\|@PostMapping\|@RequestMapping" <repo>                      # Spring
grep -rn "func main\|def main\|if __name__" <repo>                                # process entry
grep -rn "addEventListener\|window.onload\|createRoot" <repo>                     # frontend startup
```

### 3.4 Conclusion table (evidence table; the report shape is `#entry-rows` in [report.md](report.md))

(The row below is a **format example**. Names and paths come from the sample repo. Fill your own repo in the same shape.)

| Changed symbol | Upward path (hop by hop) | Entry (`file:line`) | Shape | Verdict | Evidence |
|---|---|---|---|---|---|
| `someMethod` (`path:line`, add) | Graph: two same-file callers (both `to_count=0`); text cross-check: `routeFile:line` calls it through the router | `routeFile:line` `GET /api/xxx` | HTTP route | **False entry** (missing graph edge, corrected) | `edges --direction in` + `grep -rn <method>` |

The verdict column has only three values: **true entry** (graph and text both confirm no upstream caller), **false entry** (graph says 0 but text found a call site → corrected to the real upstream), **intermediate node** (has an upstream; not an entry). Every "true entry" must include the §3.2 cross-check result.

Those three words are **evidence vocabulary. Rename them in the report**: true entry → `entry`; false entry (corrected upstream) and intermediate node → `intermediate method`. The report must not contain "true entry / false entry / intermediate node" (see `#entry-rows` and the rewrite conditions in [report.md](report.md)).

```bash
codexqa query --repo . path --from <entry-id> --to <changed-id>   # prove the entry can reach the change
```

`path` returning `hops = -1` means not connected within the depth (missing edges do this too). Use the text call chain as evidence. Do not write "unreachable".

---

## §4 Regression scope

Produce an **actionable caller list** (file + symbol + line). Do not stop at "the blast radius is large".

```bash
codexqa query --repo . edges --id <changed-id> --direction in
codexqa query --repo . reach --id <changed-id> --direction in --depth 2
codexqa query --repo . reach --id <changed-id> --direction in --depth 3 --edge-kinds calls,tests
codexqa query --repo . imports --file <changed-file> --direction in
```

- Direct callers are the first-hop regression targets. `reach --depth 2..3` adds transitive callers.
- A signature or contract change (parameters, return value, error codes, routes, event names, SQL meaning) must list **every** direct caller.
- When only the internal implementation changed (no contract change), shrink the regression scope to the nearest two hops and say why.
- File-level `imports --direction in` covers missing cross-file edges: grep the changed symbol name inside dependent files.
- Every impact claim names a concrete caller or module. The `to_count` number itself is not a conclusion.

---

## §5 Test plan

Organize by **entry × scenario**, not by file.

1. **Must-test entries**: true entries from §3, plus framework entries (HTTP / MQ / scheduled task) that `path` can reach from a changed symbol.
2. **Case matrix** (each must-test entry covers at least):

| Dimension | Content |
|---|---|
| Happy path | The main flow this change introduced or altered. Assert the new behavior (new field, new state, new return) |
| Boundary | Empty collection, single element, upper bound, page boundary, omitted default argument |
| Error | Unauthorized / forbidden / illegal input / missing resource / concurrent or duplicate submit |
| Contract | Response shape, error codes, and fields before vs after; whether they stay backward compatible |
| Data | Behavior of the changed SQL or fields under "no rows / many rows / missing relation" |

3. **Sensitive paths**: if a symbol name or the patch hits high-risk words such as `auth` / `token` / `password` / `pay` / `refund` / `order` / `stock`, or `to_count` is very large, add authorization and amount/stock consistency cases.

```bash
codexqa query --repo . symbols --name token --kind function,method
codexqa query --repo . search --query "password OR secret OR api_key"   # needs a search index first
```

4. **The test plan must land on a concrete assertion.** Write "assert every record from `GET /api/xxx` includes `newField` (boolean), and it is `true` when the match condition holds". Do not write "test the list API".
5. **Handoff to step 6**: the test-plan "disposition" column uses only **reuse / extend / add** (write `uncovered` when it truly cannot be written, and put the reason in the "case file" column). "Kind" and "case file" give the test layer and a real `file:line`. Points with no existing case are marked "add" and handed to step 7. Do not recreate a case that already exists.
