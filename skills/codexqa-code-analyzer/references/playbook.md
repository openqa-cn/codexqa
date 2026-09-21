# Analysis playbook

`SKILL.md` is the routing and report contract. Read this file after you enter a scenario. Do not preload the whole tree.
Read [diagrams.md](diagrams.md) before drawing. Install / PATH / LLM / maintenance: [cli.md](cli.md).

---

## Index health

Before treating query results as evidence, confirm the index is trustworthy. Any “change relative to a baseline” needs `--diff-base`. Otherwise every `change_status` is `default`.

`<repo>`: use a local path when a checkout exists (preferred); a canonical id such as `github.com/org/repo@main`; a remote git URL for **index only**. Multiple branches require `@branch` — do not guess.

```bash
codexqa index /path/to/repo
codexqa index https://github.com/org/repo.git
codexqa index https://github.com/org/repo.git -b main
codexqa repos --filter <substr> --limit 200
codexqa repos --limit 200
codexqa stats /path/to/repo
codexqa query --repo <repo> summary
```

`repos` defaults to `--limit 20`, cap 200. Extra pages do not error; they are silently truncated. In table output read `showing A-B of T`; in JSON read `has_more` / `next_offset`. If T>200, add `--filter`. Do not run bare `codexqa repos`, and do not treat the first page as the full set.

Default index is incremental; `--full` forces a rebuild. `-b` applies only to remote URLs; a local path follows the current worktree branch.
`query` prints JSON — filter it locally. Use `change_status`, `tested_count`, and `to_count` (in-degree / callers) even when this is not a formal review. `from_count` is out-degree (who it calls) and is not blast radius. If `stats` shows many stubs / collisions, lower confidence on impact claims. Do not conclude from a half-built index.

---

## Review one change

Use this section when the user reviews a PR, compares branches, or asks what a change affected.
Rebuild the index in diff mode first. Do not invent `codexqa diff` or `codexqa review`.

```bash
codexqa index /path/to/repo --diff-base origin/main
codexqa index /path/to/repo --diff-base HEAD~1
codexqa index https://github.com/org/repo.git -b feature --diff-base main
```

`--diff-base` still parses the whole tree; it only labels `add` / `change` (nodes may also be `delete`).
That is **not** the same as incremental `index` (re-parse dirty files only).

Then walk 1 → 2 → 3. Fold entry risk and sensitive paths into each group.

### 1. Change groups and patches

```bash
codexqa query --repo <repo> change-groups
codexqa query --repo <repo> files --change add,change
codexqa query --repo <repo> symbols --change add,change --kind function,method
codexqa query --repo <repo> symbol-diff --id <id>
codexqa query --repo <repo> symbol-diff --id <id> --max-lines 200
codexqa query --repo <repo> file-source --file crates/db/src/query.rs
codexqa query --repo <repo> file-base --file crates/db/src/query.rs
```

- `change-groups` sorts by max fan-in — read the riskiest groups first. Empty `groups` means rerun `index --diff-base`. If `truncated: true`, the graph is incomplete; say so in the report.
- Read patches for the first 5–8 groups with `symbol-diff --id`. **The diff text is the only source of “what changed”.** If it is too long, add `--max-lines` (hard cap 500) or switch to `snippet`.
- File-level fallback: `file-source` vs `file-base`. Empty `file-base` means this is not a diff index, or that file did not change.

### 2. Regression scope

Produce a **testable caller list** (file + symbol). Do not stop at “the blast radius is large”.

```bash
codexqa query --repo <repo> symbols --name parse_file
codexqa query --repo <repo> edges --id <id> --direction in
codexqa query --repo <repo> reach --id <id> --direction in
codexqa query --repo <repo> reach --id <id> --direction in --depth 2 --edge-kinds calls,tests
codexqa query --repo <repo> path --from <caller-id> --to <changed-symbol-id>
codexqa query --repo <repo> imports --file crates/core/src/main.rs --direction in
```

- `edges --direction in`: direct callers — first ring of regression.
- `reach --direction in`: transitive callers. Start `--depth` at 2–3, max 10. If there is no path, say so.
- `--edge-kinds calls,tests`: see whether a tests edge reaches it at the same time. `edges` has no `--edge-kinds`.
- `path`: prove “entry A can hit this change”. `hops=-1` means not connected within the depth.
- File-level: `imports --direction in` shows who depends on that file.
- Risk claims must name **concrete callers / modules** from the query. “The file is large” or “fan-in is high” fails.

### 3. Test gaps

The question is whether a **production symbol has a `tests` edge**, not whether the repo has a tests directory.
Queries exclude test files / symbols by default, so the first command below returns production changes.

```bash
# 1. Changed production symbols; read tested_count on each JSON row
codexqa query --repo <repo> symbols --change add,change --kind function,method

# 2. For a symbol under review, follow only tests edges (edges has no --edge-kinds)
codexqa query --repo <repo> reach --id <id> --direction in --edge-kinds tests

# 3. Optional: did this symbol name appear in a test file (a word ≠ a tests edge)
#    Symbol-name checks must build the full-text index as identifiers.
#    Default simple splits snake_case (into_value → into+value); --tests-only then false-positives.
codexqa search-index <repo> --force --tokenizer whitespace
codexqa query --repo <repo> search --query "<symbol>" --tests-only
```

- `tested_count` = number of `tests` edges pointing at that production symbol. It is not production in-degree `to_count` (`from_count` is out-degree, even less so).
- **Changed production symbol + `tested_count == 0` + empty `reach --direction in --edge-kinds tests`** → record a gap.
- Distinguish **a tests file exists** (`search --tests-only` or a test-like path) from **a `tests` edge exists** (`tested_count > 0` or a hit from `reach --direction in --edge-kinds tests`). Only the latter may be written as “covered”.
- To verify a symbol name with `search --tests-only`, first run `search-index --force --tokenizer whitespace`. Default simple (snake_case-friendly) splits `into_value` into `into`+`value`; a hit does not mean the source contains this symbol. Changing tokenizer always needs `--force`.
- `edges` has no `--edge-kinds`. `symbols --include-tests` / `files --include-tests` only list test symbols / files; they do not prove coverage.
- `edge_source=tests` on `imports` is file-level: “a test file exists but did not link to the symbol”.
- Rank gaps by risk: sensitive names, high fan-in, and symbols that can reach an entry first. If you mark risk, run `edges` / `reach` and name the callers. Do not stop at “the file is large / fan-in is high”.

### 4. Entry risk (HTTP / RPC / MQ / jobs)

Walk **callers backward from the changed symbol** until you reach an entry. Do not guess entries by name and scan downward.

```bash
codexqa tag <repo> keys --json
codexqa query --repo <repo> tagged --key framework.http
codexqa query --repo <repo> tagged --key framework.http.client
codexqa query --repo <repo> tagged --key <key>
# walk backward to the end (current cap: 10 hops)
codexqa query --repo <repo> reach --id <changed-symbol-id> --direction in --depth 10
# inspect the last hop: is to_count 0 (in-degree; from_count is out-degree and is not an entry)
#   - all 0 → reached an entry (main / handler / test entry)
#   - some > 0 → take those node ids and run reach again until the last layer is all to_count 0
codexqa query --repo <repo> path --from <entry-id> --to <changed-symbol-id>
```

- Tags find a **role** (endpoint, consumer, outbound client). Do not look them up by function name.
- `framework.http` is server routing; REST **clients** (reqwest `Client.get`, no axum/actix) use `framework.http.client`. Querying only the former comes back empty.
- If `tag keys` has no key for this repo’s language, or `tagged` is empty: **fill in from code**. Do not stop. `search` path literals (`/api/`), `symbols --name` HTTP verbs / Client methods, then treat `source` / `edges` as the entry.
- If an entry can `path` to the changed symbol → mark it as a must-test entry (API / consumer / job case).
- Run `codexqa tag <repo> run` only after local tag rules changed. List or drop: `tag list` / `tag drop --id <id>`.

### 5. Sensitive paths

A name or search hit on `auth` / `token` / `pay` / `password`, or a very high `to_count` (fan-in / many callers), is high risk by default. Always add regression scope and test gaps. State what changed, who calls it, and whether it is tested. Do not stop at the label “sensitive”.

```bash
codexqa query --repo <repo> symbols --name token --kind function,method
codexqa query --repo <repo> symbols --change add,change
codexqa query --repo <repo> search --query "password OR secret OR api_key"
codexqa query --repo <repo> edges --id <id> --direction in
```

- A hit with `change_status` `add`/`change`, or a high `to_count`, is high risk by default.
- Always run **Regression scope** + **Test gaps**: write the caller list and the gaps.
- Tagged auth / payment entries become must-test entries via the previous section.

---

## Locate a defect

Use this when a log, stack, error string, or comment phrase does not match a function name. Run `search-index` once per repo.
Full-text search covers source, comments, strings, and error text. Searching comments and searching errors is the same `search`.

```bash
codexqa search-index <repo>                 # default simple: errors / comments / phrases
# For snake_case / symbol-name checks, switch tokenizer (also --force if already built):
# codexqa search-index <repo> --force --tokenizer whitespace
codexqa query --repo <repo> search --query "TokenExpired"
codexqa query --repo <repo> search --query "Per-read inactivity time"
codexqa query --repo <repo> symbols --name verify_jwt
codexqa query --repo <repo> source --id <id>
codexqa query --repo <repo> edges --id <id> --direction in
codexqa query --repo <repo> snippet --file crates/db/src/query.rs --start 0 --end 30
codexqa inspect <id> --repo <repo>
```

1. Search the exact error / exception class / comment phrase first; land on file and line.
2. Align the symbol with `symbols`, then read the implementation with `source` / `inspect`.
3. `edges --direction in` answers who triggered this path, which helps reproduce and regress.
4. If the full-text index is missing, use `symbols` / `files` first. Do not idle on `search`.
5. If you only know “where is retry handled”, use the architecture section; after a hit, still confirm with `snippet` against source.

---

## Understand an implementation

Use this when you are not reviewing a change and only need how a symbol works.

```bash
codexqa query --repo <repo> symbols --name parse_file
codexqa query --repo <repo> symbols --name-prefix Repo
codexqa query --repo <repo> symbols --file-contains db/src
codexqa query --repo <repo> symbols --qualified-name RepoDb::open
codexqa query --repo <repo> source --id <id>
codexqa query --repo <repo> edges --id <id> --direction out
codexqa query --repo <repo> file --file crates/db/src/query.rs
codexqa query --repo <repo> files [--lang Rust] [--prefix crates/]
codexqa query repos
```

1. **How does X work?** `symbols --name X` → keep `id` → `source` → `edges --direction out`
2. **Where is X used?** `symbols` → `edges --direction in`; larger range `reach --direction in`
3. **How do X and Y relate?** get both `id`s → `path --from --to`

---

## Architecture drift

Onboarding, a cross-module change, or a suspected wrong layer.

```bash
codexqa stats <repo>
codexqa query --repo <repo> summary
codexqa query --repo <repo> imports --file crates/core/src/main.rs --direction out
codexqa query --repo <repo> search --query "retry"
```

- `stats` / `summary` first for size; `imports` for skipped layers. Do not treat README as architecture evidence.
- Layers must be **Entry → Application → Domain → Storage**. Do not flatten package names such as Renderer / Compiler / Shared.
- High-risk core modules must `class ... risk`, and `edges` / `reach` must say who is hit.
- **Source is authoritative.** After a hit, confirm with `snippet` using file and line.
- Default deliverable is a layered architecture Mermaid (see [diagrams.md](diagrams.md)). Do not auto-generate interactive HTML.

---

## Analysis blockers

| Symptom | What to do |
|---|---|
| `repo index not found` / repo missing from `repos` | `index` first; verify with `repos --filter <substr> --limit 200` and check showing / `has_more`. Do not run bare `repos` (default 20, silently truncated) |
| Several branches and no `@branch` | List branches and let the user pick; do not default |
| Every `change_status` is `default` / `file-base` is empty | Not a diff index; rerun `index --diff-base <ref>` |
| Search returns nothing | Run `search-index` first; use `symbols` in the meantime |
| `search --tests-only` hits but grep has no such symbol | Default simple splits snake_case; symbol-name checks need `search-index --force --tokenizer whitespace` first |
| `stats` shows many stubs / collisions | Edges may be incomplete; lower confidence on blast-radius claims |
