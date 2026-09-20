<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="KNOWN_LIMITATIONS.md">Known limitations</a>
</p>

# CodexQA Skill

**Turn a repository into a queryable symbol graph in conversation — review changes, bound regression, find test gaps, and trace errors.**

CodexQA parses a repo into a local symbol graph, then answers “what changed, who is affected, what is untested, and where this error comes from” along a fixed path. Cursor / Claude Code read [`SKILL.md`](SKILL.md).

- **Review changes** — compare against a baseline, group what moved, and read the high-risk method-level patches first
- **Bound regression** — chase callers of the changed symbols, and mark reachable HTTP / RPC / MQ / job entries
- **Find test gaps** — coverage is a `tests` edge on the production symbol, not “the repo has a tests directory”
- **Trace errors** — land logs, stacks, and error text on a symbol, then see who calls it and whether it is tested

`code-analyzer` answers **structure and impact** questions from graph evidence; it does not decide whether the implementation matches a business requirement or assign P0 / P1 / P2 review findings. Use `code-wiki` for an architecture knowledge graph (module map and reading guides), `defect-detection` for requirement-oriented defect discovery and gated write-back, and `code-reviewer` for playbook-driven implementation findings. They can be chained: map the impact here, then focus the deeper review.

Indexing supports **TypeScript, JavaScript, Vue, Java, C/C++, C#, Python, Go, PHP, and Rust**. Language mix for this repo shows up in `stats` / `summary`.

The Skill, playbook, schemas, and examples are published in this repository. The required `@openqa-cn/codexqa` package is a separately distributed, closed-source local analysis engine. Indexing and graph queries run on the user's machine without an LLM; indexes and sessions live under `~/.codexqa/`. See [known limitations](KNOWN_LIMITATIONS.md) for verification status and graph-completeness boundaries.

```bash
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
```

No model required to start: install the CLI, index the repo, then review in conversation.

---

## Quick start

### 1. Install

Install the skill, then the CLI. Requires **Node.js >= 18**.

```bash
npx skills add openqa-cn/codexqa --skill code-analyzer
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

If the command is missing, add `$(npm prefix -g)/bin` to `PATH`. Do not reinstall when it is already present.

**Cursor / Claude Code:** put [`SKILL.md`](SKILL.md) in the agent skills directory. When the user asks to index, find callers, bound impact, review a change, or check test coverage, follow the SKILL and use the CLI.

### 2. Index first — read the repo, do not guess from the prompt

```bash
codexqa index /path/to/repo
codexqa stats /path/to/repo
```

For changes against a baseline, `--diff-base` is required. Otherwise every `change_status` is `default` and there is nothing to review:

```bash
codexqa index /path/to/repo --diff-base origin/main
```

Or say it in conversation:

```text
Analyze this repository, then use CodexQA to review changes against origin/main.
Start with the high-risk change groups, then bound regression and test gaps,
and mark reachable HTTP / RPC / MQ entries.
```

To locate one error:

```text
Where does this TokenExpired error come from? Land on the symbol,
then show who calls it and whether a tests edge covers it.
```

### 3. Refine in conversation

Keep going with: `only the payment-related groups`, `expand regression to the entries`, `list uncovered high fan-in symbols`. The agent should keep the existing index, query only the relevant symbols and edges, and not rewrite the whole-repo conclusion.

---

## Choose the right scenario

| Scenario | Best for | Include in the prompt |
| --- | --- | --- |
| **PR / branch change review** | Review a PR, diff against `origin/main`, ask what changed | Baseline ref, modules of interest |
| **Regression scope** | A shared function / low-level helper changed; bound who is hit | Symbol name, how many hops |
| **Test gaps** | Whether a production symbol has a `tests` edge | Change scope — not “is there a tests directory” |
| **Production error / defect** | Logs, stacks, or error text do not match a function name | Exact error, exception class, comment phrase |
| **Entry risk** | Whether HTTP / RPC / MQ / cron will reach this change | Entry kind, changed symbol |
| **Sensitive paths** | Auth, payments, credentials, permissions | Keywords, whether it already changed |
| **Module ownership / architecture drift** | Onboarding, cross-layer change, wrong layer | Module or file |
| **Index health** | Empty results, every change is `default`, about to write a report | Repo path or `repo_id` |

Not sure which one? State the baseline and the question, then pick a section from the table. All scenarios below assume `codexqa index` already ran. For “changes relative to a baseline”, add `--diff-base`.

---

## Why this skill

- **Use the symbol graph instead of reading the whole diff** — group changes by calls / same file, high fan-in first, then read method-level patches for the top groups
- **Coverage is a `tests` edge on the graph** — only `tested_count` and `reach --direction in --edge-kinds tests` count as covered. A tests directory name or a `search --tests-only` hit is not coverage
- **Walk entries backward from the change** — use tags to find HTTP / RPC / MQ / job roles, then `reach` / `path` to prove they hit this change. Do not guess entries from function names
- **Interaction does not invent topology** — every node and edge in the report must match this query. Keep a diagram to 8–15 nodes; truncate and say so
- **Failures have fixed checkpoints** — missing index, not a diff index, no full-text index, too many stubs / collisions. Handle those cases; do not idle or fall back to opinion

CodexQA Skill is not generic code-review filler and not a drawing editor. It turns repository facts into reviewable evidence, then delivers a QA report with diagrams.

---

## How it works

1. **Index** — The CLI parses the repo into a local symbol graph. `--diff-base` still parses the whole tree; it only labels `add` / `change` / `delete`.
2. **Query** — `query` always prints JSON. Judge with `change_status`, `tested_count`, and `to_count` (in-degree / callers). `from_count` is out-degree and is not blast radius.
3. **Judge** — Read patches, chase callers, verify `tests` edges, mark must-test entries. Change only the object a `subject` points at; do not rewrite the whole-graph conclusion.
4. **Deliver** — The agent files a **Mermaid evidence report** in Cursor / Markdown.

Main path for reviewing one change:

```text
index --diff-base <ref>  →  change-groups  →  symbol-diff  →  callers / tests / entries
```

Filter `query` output locally. Use `change_status`, `tested_count`, and `to_count` on nodes even when this is not a formal review.

---

## What QA can answer

| QA question | How to answer |
| --- | --- |
| Which chunks of this PR should I read first? | Group changes by calls / same file; high fan-in first |
| What changed vs the baseline? | Method-level unified diff; file-level compare against baseline source |
| How wide is the regression? | Walk callers upward; expand to entries (HTTP / RPC / MQ) when needed |
| Which production code has no test cover? | `tested_count` on changed symbols, then `reach --direction in --edge-kinds tests` |
| Where does this error / stack come from? | Full-text search the literal, land on a symbol, then the call chain |
| Did auth / payment paths move? | Name / string search + change status + in-degree |
| Can two modules reach each other? | Shortest path, import direction |
| Is this analysis trustworthy? | Check index size, stubs, collisions, then decide how deep to go |

---

## Scenarios

### 1. PR / branch change review

**When:** reviewing a PR, comparing `origin/main`, asking “what did this change affect”.

```bash
codexqa index /path/to/repo --diff-base origin/main
# remote feature branch vs main
# codexqa index https://github.com/org/repo.git -b feature --diff-base main

codexqa query --repo <repo> change-groups
codexqa query --repo <repo> files --change add,change
codexqa query --repo <repo> symbols --change add,change --kind function,method
codexqa query --repo <repo> symbol-diff --id <id>
```

**How to judge:**

1. `change-groups` sorts by max fan-in — read the riskiest groups first. Empty `groups` means this is not a diff index; rerun with `--diff-base`. If `truncated: true`, the graph is incomplete — say so in the report.
2. Read patches for the first 5–8 groups with `symbol-diff`. **The diff text is the only source of “what changed”.** Do not guess. If it is too long, add `--max-lines` (hard cap 500) or switch to `snippet`.
3. File-level fallback: `file-source` vs `file-base`. Empty `file-base` means this is not a diff index, or that file did not change.
4. Then run scenario 2 (impact) and scenario 3 (test gaps) per group. Names containing `auth` / `token` / `pay` / `password`, or a very high `to_count` (fan-in), raise risk.

`--diff-base` still parses the whole tree and only labels changes. That is not the same as incremental `index` (re-parse dirty files only).

---

### 2. Regression scope and blast radius

**When:** a shared function / low-level helper changed, and you need “who is hit, and how far tests reach”.

```bash
codexqa query --repo <repo> symbols --name <symbol>
codexqa query --repo <repo> edges --id <id> --direction in
codexqa query --repo <repo> reach --id <id> --direction in
codexqa query --repo <repo> reach --id <id> --direction in --depth 2 --edge-kinds calls,tests
codexqa query --repo <repo> path --from <caller-id> --to <changed-symbol-id>
```

**How to judge:**

- `edges --direction in`: direct callers — first ring of regression tests.
- `reach --direction in`: transitive callers. Start `--depth` at 2–3, max 10. If there is no path, say so.
- `--edge-kinds calls,tests`: see whether a tests edge reaches it at the same time.
- `path`: prove “entry A can hit this change”. `hops=-1` means not connected within the depth.
- File-level: `imports --direction in` shows who depends on this file.

The output should be a **testable caller list** (file + symbol), not “the blast radius is large”.

---

### 3. Test gaps

**When:** change review, or “does this module have unit tests”. The question is whether a **production symbol has a `tests` edge**, not whether the repo has a tests directory.

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

**How to judge:**

- `tested_count` = number of `tests` edges pointing at that production symbol. It is not production in-degree `to_count` (`from_count` is out-degree, even less so).
- **Changed production symbol + `tested_count == 0` + empty `reach --direction in --edge-kinds tests`** → record a gap.
- `search --tests-only` only means that **whole token** appeared in a test file. Default simple (snake_case-friendly) splits `into_value` into `into`+`value`; a hit does not mean the source contains this symbol. To verify a symbol name with search, first run `search-index --force --tokenizer whitespace`. Changing tokenizer always needs `--force`. That hit alone is not “covered”.
- `symbols --include-tests` / `files --include-tests` only add test symbols / files to the list. They do not prove coverage.
- `edge_source=tests` on `imports` is file-level coverage — “a test file exists but did not link to the symbol”.
- Rank gaps by risk: sensitive names, high fan-in, and symbols that can reach HTTP / RPC / MQ entries first.

---

### 4. Production error / defect location

**When:** a log, stack, error string, comment phrase, or user description does not match a function name.
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
codexqa query --repo <repo> snippet --file <path> --start <n> --end <n>
```

**How to judge:**

1. Search the exact error / exception class / comment phrase first (full text), land on file and line.
2. Align the symbol with `symbols`, then read the implementation with `source` / `inspect`.
3. `edges --direction in` answers “who triggered this path”, which helps reproduce and write a regression test.
4. If the full-text index is missing, use `symbols` / `files` first. Do not idle on `search`.

If you do not know the function name and only know “where is retry handled”, use scenario 7: land with `summary` / `imports` / `search`, then confirm with `snippet` against source.

---

### 5. API, message, and job entry risk

**When:** a change may hit outbound HTTP / RPC, an MQ consumer, or a cron job, and you need “which live entry reaches this change”.

```bash
codexqa tag <repo> keys --json
codexqa query --repo <repo> tagged --key framework.http
codexqa query --repo <repo> tagged --key framework.http.client
codexqa query --repo <repo> tagged --key <key>
# walk backward to the end (current cap: 10 hops)
codexqa query --repo <repo> reach --id <changed-symbol-id> --direction in --depth 10
# inspect the last hop: is to_count 0 (in-degree; from_count is out-degree and is not an entry)
#   - all 0 → reached an entry (main / handler / test entry)
#   - some > 0 → take those node ids and run graph-reach again until the last layer is all to_count 0
```

**How to judge:**

- Tags find a **role** (endpoint, consumer, outbound client). Do not look them up by function name.
- `framework.http` is server routing; REST clients use `framework.http.client`. Querying only the former comes back empty.
- If `tag keys` has no key for this repo’s language, or `tagged` is empty: fill in from code (`search` `/api/`, `symbols` Client methods). Do not stop, and do not invent entries.
- If an entry can `path` to the changed symbol → mark it as a must-test entry (API / consumer / job case).
- Run `codexqa tag <repo> run` only after local tag rules changed.

---

### 6. Sensitive paths (auth / payments / credentials)

**When:** the change or investigation involves login, tokens, payments, passwords, or permissions.

```bash
codexqa query --repo <repo> symbols --name token --kind function,method
codexqa query --repo <repo> symbols --change add,change
codexqa query --repo <repo> search --query "password OR secret OR api_key"
codexqa query --repo <repo> edges --id <id> --direction in
```

**How to judge:**

- A hit with `change_status` `add`/`change`, or a high `to_count`, is high risk by default.
- Always run scenarios 2 + 3: write the caller list and the test gaps.
- Tagged auth / payment entries become must-test entries via scenario 5.
- State “what changed, who calls it, whether it is tested”. Do not stop at the label “sensitive”.

---

### 7. Module ownership and architecture drift

**When:** onboarding, a cross-module change, or a suspected wrong layer.

```bash
codexqa stats <repo>
codexqa query --repo <repo> summary
codexqa query --repo <repo> imports --file crates/core/src/main.rs --direction out
codexqa query --repo <repo> search --query "retry"
```

**How to judge:**

- `stats` / `summary`: languages, files, symbol size — first picture of “what this repo looks like”.
- `imports`: whether file deps skip a layer (for example UI talking to DB).
- **Source is authoritative.** After a hit, confirm with `snippet` using file and line.

---

### 8. Index trust (pre-analysis check)

**When:** queries are empty, every change is `default`, or you are about to write a report from the graph.

```bash
codexqa repos --filter <substr> --limit 200
codexqa repos --limit 200
codexqa stats <repo>
codexqa query --repo <repo> summary
```

**How to judge:**

| Symptom | What to do |
| --- | --- |
| `repo index not found` / repo missing from `repos` | `index` first; verify with `repos --filter <substr> --limit 200` and check showing / `has_more`. Do not run bare `repos` (default 20, silently truncated) |
| Several branches and no `@branch` | List branches and let the user pick; do not default |
| Every `change_status` is `default` | Not a diff index; rerun `index --diff-base <ref>` |
| `file-base` is empty | Same as above, or that file did not change vs the baseline |
| `search` returns nothing | Run `search-index` first; use `symbols` in the meantime |
| `search --tests-only` hits but grep has no such symbol | Default simple splits snake_case; symbol-name checks need `search-index --force --tokenizer whitespace` first |
| `stats` shows many stubs / collisions | Edges may be incomplete; lower confidence on blast-radius claims |
| First index of a large repo is slow | Wait for the full run; do not conclude from a half-built index |

`<repo>`: local path (preferred for indexing; if a checkout exists, use it — do not scan the list first), `github.com/org/repo@main` (copy from `repos --limit 200`, check `has_more`), or a remote git URL (**index only**).

---

## Commands mapped to QA

QA-related capabilities only. Maintenance (`status` / `restart` / `delete`) lives in the SKILL.

| Command | QA use |
| --- | --- |
| `index [--diff-base]` | Build the graph; diff mode labels files / symbols `add` / `change` / `delete` |
| `repos` / `stats` / `query summary` | Confirm the index exists, plus size and language mix. `repos` defaults to `--limit 20`, cap 200; extra pages are silently truncated — check `has_more` / `--offset` |
| `query symbols` / `inspect` / `source` | Find a symbol, read the impl, check `to_count` (in-degree), `tested_count`, `change_status` |
| `query edges` / `reach` / `path` | Callers, transitive impact, whether two nodes connect |
| `query change-groups` / `symbol-diff` | Change topology + method-level patch (main review path) |
| `query files --change` / `file-source` / `file-base` | Changed file list; file-level old vs new |
| `query search` (after `search-index`) | Error text, comments, strings. Symbol-name checks need `search-index --force --tokenizer whitespace`, or default simple splits snake_case and false-positives; `--tests-only` only means the token appeared in a test file |
| `tag keys` / `query tagged` | HTTP / RPC / MQ / cron entries |
| `query imports` / `file` / `snippet` | File deps, directories, point reads of source |

---

## Suggested workflow

```text
# understand existing behavior / locate a defect
index → stats → search or symbols → source → edges/reach

# review one change
index --diff-base <ref>
  → change-groups (high-risk groups first)
  → symbol-diff (trust the patch only)
  → edges/reach + tagged (regression scope, entries)
  → tested_count / search --tests-only (gaps)
  → report: must-read groups, must-test entries, gaps, sensitive paths + architecture/topology diagram

# optional
search-index   # error/comment/string search; symbol-name checks need --force --tokenizer whitespace
```

---

## Diagrams in the report

A written report needs diagrams, not raw JSON. Agents use **Mermaid** in Cursor / Markdown.

| Scenario | Draw |
| --- | --- |
| Change review | Change-group topology (`change-groups`) |
| Regression scope | Blast radius (changed symbol ← callers) |
| Entry risk | Entry → service → changed symbol |
| Architecture / onboarding | Entry / application / domain / storage layers |
| Test gaps | Production symbols vs `tests` edges |

Rules: nodes and edges come only from query results; 8–15 nodes per diagram; label edges `calls` / `tests` / `imports`; `add` green, `change` orange, sensitive / uncovered red. Under the diagram, write the evidence commands and the conclusion. Templates: [`references/diagrams.md`](references/diagrams.md).

Example: entry `POST /orders` reaches this pricing change `applyDiscount`; `verify_jwt` is a change; `tests` edges cover the discount path.

![Entry / change / regression / test coverage](assets/checkout-change-impact.svg)

---

## Install and attach

| Surface | Where / how | Capability |
| --- | --- | --- |
| **CLI** | `npm install -g @openqa-cn/codexqa` | Index, query |
| **Cursor** | Put `code-analyzer/` in `~/.cursor/skills/` or `.cursor/skills/` | Full QA workflow |
| **Claude Code** | `~/.claude/skills/` or `.claude/skills/` | Full QA workflow |
| **Local plugin** | If `~/.codexqa/plugins/codexqa/` is missing, `codexqa-agent` writes this built-in plugin | MCP tool declarations |

Maintenance (`status` / `restart` / `delete`): [`references/cli.md`](references/cli.md).

---

## References and bounds

- [Routing contract](SKILL.md)
- [Analysis playbook](references/playbook.md)
- [Diagram rules and templates](references/diagrams.md)
- [Install / repo ids / LLM / maintenance](references/cli.md)
- [Graph-query tool schema](references/mcp.json)

This skill does not provide `codexqa diff` / `codexqa review`, and it does not auto-generate interactive HTML / Archify canvases. Do not query or review a diff without an index. Do not run full-text search unless the user asked.

---

## Package contents

```text
code-analyzer/
├── README.md                 # this file (scenario picker + QA playbook)
├── README.zh-CN.md           # Chinese
├── SKILL.md                  # agent routing + report contract
├── assets/                   # sample report diagrams
└── references/
    ├── playbook.md           # analysis steps (load on demand)
    ├── diagrams.md           # report diagram rules and templates
    ├── cli.md                # install / repos / LLM / maintenance
    └── mcp.json              # graph-query tool declarations
```
