# Recall related tests

Answer one question: **which existing tests in this repo relate to this change?** If there are some, recall them with `file:line` and a reason. If there are none, write "no coverage" and hand the scenario to the test plan.

Recall has two layers: **layer A first** (`tests` edges on the graph; most trustworthy). **When layer A is empty, layer B is mandatory** (text recall in test files).
Evidence rule: **a lexical hit is not coverage; a directory name is not coverage; only a tests edge or a real assertion in a test file counts.**

---

## Layer A: tests edges (most trustworthy)

```bash
# 1) Changed production symbols; read tested_count per row
codexqa query --repo . symbols --change add,change --kind function,method

# 2) Walk tests edges backward to test symbols (edges does not support --edge-kinds; use reach)
codexqa query --repo . reach --id <changed-id> --direction in --edge-kinds tests

# 3) File level: who imports the changed file as tests
codexqa query --repo . imports --file <changed-file> --direction in    # read edge_source=tests
```

How to judge:

- `tested_count > 0`, or `reach --direction in --edge-kinds tests` hits → the production symbol **has** a test edge. Follow the test node with `source --id` / `inspect` and read the case name and assertion.
- `tested_count` is the **number of tests edges**. It is not in-degree `to_count` and not out-degree `from_count`.
- Test nodes are filtered by default **only when the indexer marked them `source=test`**. Then add `--include-tests` (measured for §A: the sample repo had 0 `source=test` nodes; `.mjs` files that look like tests were `file_source=local`, so they were already in the default results). **Do not use this flag to decide "did tests change".** Filter `file_path` for `test` / `spec`. To read a test body, use `codexqa query --repo . source --id <test-id>`.

**An empty layer A is normal.** Only some languages emit tests edges. Measured on one JS repo: every node was `source=local`, `tested_count` was always 0, and `reach --edge-kinds tests` was empty, while the repo had full API smoke and UI end-to-end cases. An empty layer A **does not mean** there are no tests → you must enter layer B.

---

## Layer B: text recall in test files (mandatory when layer A is empty)

### B1 Find test files

```bash
codexqa query --repo . files                 # all files; filter by name
codexqa query --repo . files --prefix tests   # narrow to the test directory (use the repo's real prefix), then filter by name
```

Name shapes: `*test*` / `*spec*` / `*.test.*` / `*_test.*` / `test_*.py` / `*Test.java` / `*Tests.cs` / `tests/` / `__tests__/` / `smoke` / `e2e` / `scripts/*test*` / `*fixture*`.
Also check whether **this change itself edited tests** (filter the §1 method table by `file_path` containing `test` / `spec`). Changed test files have the highest priority.

### B2 Build recall keys

**Recalling by symbol name alone misses most cases.** Measured (JS sample repo): three changed method names had **zero hits** in test files, while field names and API paths from the patch hit several concrete cases. Tests are usually written against **behavior and contract** (fields, paths, error codes, states), not against internal function names. The primary keys are **observable contracts the patch added or changed**. Symbol names are only a supplement.

Take all of these from §1 / §2 / §3:

| Recall key | Source | Priority |
|---|---|---|
| Field names / return values / state values / error-code literals the change introduced | `symbol-diff` patch | **Highest** |
| HTTP paths or event names the change introduced or altered | `symbol-diff`, `files --change` | **Highest** |
| Entries the change touches (route / consumer / command) | §3 entry resolution | High |
| Changed file path and its module name | `files --change` | Medium |
| SQL table names / column names / config keys the change touches | `symbol-diff` patch | Medium |
| Added / changed / deleted symbol names | `symbols --change` | Supplement (often zero hits) |
| Shared functions that were reused and whose behavior changed | `symbol-diff` patch | Supplement |

### B3 Search inside test files

**Prefer `grep` (line-level, does not miss):**

```bash
grep -rn "<recall-key>" <test files or scripts/ tests/ directories>
```

`codexqa search` is allowed, but **only to narrow files. It cannot locate a line or a case name:**

```bash
codexqa query --repo . search --query "<recall-key>"       # default simple tokenizer; do not add --tests-only
```

Measured (JS sample repo):

| Command | Result |
|---|---|
| `grep -c <behavior key> <test file>` | **Hits** (7 in the sample repo) |
| `search --query <behavior key> --tests-only` (simple) | **0 rows** |
| `search --query <behavior key> --tests-only` (whitespace) | **0 rows** |
| `search --query <behavior key>` (simple, no `--tests-only`) | Hits, and they land on the two test files |

Three hard conclusions:

1. **Do not trust `--tests-only`.** The test files are already in the index (they are found without the flag). With the flag, both tokenizers return 0. **Filter test files by name yourself** (the B1 name shapes). Do not hand that job to `--tests-only`.
2. **`search` is file-chunk level.** One file returns one row (`path` + `start_line` / `end_line` + `snippet`). It does not say which line or which case. To get the case name, `grep` that file, or read the range with `snippet` / `file-source`.
3. **The tokenizer changes recall. Pick it by query type.** Behavior keys (field names / paths / error codes) use the **default simple** tokenizer. `--tokenizer whitespace` fits whole symbol names, but misses behavior keys such as `.fieldName` inside a larger token. Switching needs `--force` to rebuild the index, which is expensive. That is why line-level recall uses `grep`.

### B4 Extract the concrete case name (by language)

A file name is not enough. Land on **case name + line number**:

| Language / framework | Case shape | How to extract |
|---|---|---|
| JS/TS (jest/vitest/mocha/node:test) | `test('...')` / `it('...')` / `describe('...')` | `grep -n "test(\|it(\|describe("` |
| JS custom assertion helper | `check('case name', condition, extra)` | `grep -n "check("` |
| JS table-driven route cases | `const ROUTES = [['/path', 'name', 'session'], ...]` | Read the table; match path/session |
| Python (pytest/unittest) | `def test_xxx()` / `class TestXxx` | `grep -n "def test_\|class Test"` |
| Java (JUnit) | `@Test` + method name / `@DisplayName("...")` | `grep -n "@Test\|@DisplayName"` |
| Rust | `#[test] fn xxx()` / `mod tests` | `grep -n "#\[test\]\|mod tests"` |
| Go | `func TestXxx(t *testing.T)` | `grep -n "func Test"` |
| API / integration description files | `.http` / `.rest` / Postman collection / OpenAPI example | Match path and status code |

Case names are often business phrases. **Keep the case name as written.** Do not rewrite it as a function name. The reader uses it to find the case.

### B5 Link strength

| Strength | How to decide | Disposition |
|---|---|---|
| Strong (recall it) | The case's input or assertion depends directly on the changed symbol, file, path, or error code | Disposition `reuse`. If the assertion does not cover the new behavior, write `extend` (do not edit the existing file; a new case strengthens it) |
| Medium | The case hits the same entry or API, but the assertion is unrelated to this change point | Do not count it as "already covered" in the coverage verdict. Put the missing assertion in the test plan's "add" group |
| Weak | Only the same symbol name or the same module appears, with no related assertion | Do not put it in the report. It is background for judging blast radius |
| None | No recall key hit | Do not list it |

Only **strong** counts as "an existing case covers this change point". Filling the coverage conclusion with medium or weak is a rewrite.

---

## Where recall results go (into the test plan, not a section of their own)

**The report has no "existing test recall" section.** Recall lands in two places inside the test plan, so it is not duplicated by the case table:

1. **Three columns of the test-plan table**: `disposition` (reuse / extend / add / uncovered), `kind` (API smoke / UI end-to-end …), `case file` (`file:line` + case name). **Each column stays in its own cell. The disposition cell is the bare value.** Do not stuff kind or location into parentheses (see "Split source info into three columns" in `report.md`):

   | Disposition | Kind | Case file |
   |---|---|---|
   | `reuse` | `API smoke` | `<file:line> "case name"` |
   | `extend` | `API smoke` | `existing <file:line> → new <generated:line> covers` |
   | `add` | `UI end-to-end` | `<generated:line>` |
   | `uncovered` | Follow the repo's layer names | The reason goes in this column, for example `not generated: no end-to-end framework` |

2. **Coverage verdict** (`#coverage`, a sibling of the test plan, not nested inside it): first write "already covered by existing cases" — name the existing cases that actually hit the change point (case name + `file:line`; the same file may be compressed to one line) — then list each gap and whether it is now covered or still not.

Notes:

- **Move the previous run's artifacts out of the repo before a re-run.** If the last run's `change-impact-*` case files are still in the repo, layer B treats them as "existing cases" (measured: the hits were exactly the two files the previous run generated) and inflates "cases you can reuse". `mv` them outside the repo, then recall and rebuild the index.
- **List only cases that already exist.** Recall is the cases that are really in the repo. Cases that do not exist yet get disposition `add` and a generated `file:line`. Do not invent a "recall" row for them (a location of `—` contradicts itself).
- **Case name + `file:line` + kind are required.** A file name or a symbol name alone is not a recall.
- **"Extend" is a diagnosis, not an action.** When an existing assertion is weak, a new case covers the same assertion point under the add-only rule. **The existing file is not edited.** The case-file column writes both locations (`existing <file:line> → new <generated:line> covers`). **Do not** add "existing case was not edited". Process notes do not enter the report.
- **Only "strong" counts as coverage.** Medium and weak go into the gaps. Do not use them to fill the coverage conclusion.

### Coverage verdict

(Written in the standalone coverage-verdict section `#coverage`.)

After the table, give **one conclusion**. Only three values:

- **Already covered**: every key change point is hit by a strongly linked case (list the cases)
- **Partially covered**: some change points have a strongly linked case; the rest go to "add" in the test plan
- **Not covered**: layer B also found no strongly linked case → write "not covered", and say which keys and scope were searched (so it is not mistaken for "not looked up")

Running the existing cases and recording the result is optional but recommended:

```bash
# Use the repo's real script, for example
npm test          # or the test entry in package.json / Makefile / Cargo.toml
codexqa inspect <test-symbol-id> --repo .    # when you need to read the test body
```
