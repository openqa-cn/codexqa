# CodexQA CLI (wiki, no model)

Install, repo ids, and the no-LLM wiki commands. Routing: [SKILL.md](../SKILL.md). Scenario steps: [playbook.md](playbook.md).

## Install

Requires **Node.js >= 18**.

```bash
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

If the command is missing, add the npm global bin directory to PATH:

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

On Windows the usual location is `%AppData%\npm`. Skip install when it is already present.
Use `@latest` only when the user asked to reinstall.

Uninstall removes the CLI only. It does not delete local indexes or sessions:
`npm uninstall -g @openqa-cn/codexqa` or `codexqa uninstall`.

## Identify a repo

`<repo>` can be any of the forms below. Prefer a local path when a checkout exists; do not scan the list first.

| Form | Example | When to use |
|---|---|---|
| Local path | `/path/to/repo` or `.` | Checkout already on disk; preferred for indexing and wiki |
| Canonical id | `github.com/org/repo@main` | Reuse across commands after indexing; `@` is the branch |
| Remote git URL | `https://github.com/org/repo.git` | **Index only**: fetch that branch and parse it |

If `@branch` is omitted and there is only one branch, it is selected automatically.
If there are several branches, the command lists them — add `@branch`. Do not guess.

When copying a `repo_id` from the indexed list:

```bash
codexqa repos --filter <substr> --limit 200
codexqa repos --limit 200
# Default --limit 20, cap 200. Extra pages do not error; they are silently truncated.
# Table: "showing A-B of T". JSON: has_more / next_offset; use --offset for the next page.
# If T>200, add --filter. Do not treat the first page as the full set.
```

When the repo is unclear, use `--filter` + `--limit 200` above. Do not run bare `codexqa repos`.

## Wiki commands this skill uses

Index first. These three families need **no LLM**:

```bash
# 1. Evidence export (preferred). No model, no wiki tables.
codexqa wiki inputs /path/to/repo
codexqa wiki inputs /path/to/repo --kind page --id p01
codexqa wiki inputs /path/to/repo --kind visualization --id p01
codexqa wiki inputs /path/to/repo --kind architecture --limit 8
codexqa wiki inputs /path/to/repo --kind overview

# 2. Rule-only generation (optional persist for the UI)
codexqa wiki /path/to/repo --no-llm
codexqa wiki /path/to/repo --no-llm --limit 8
codexqa wiki /path/to/repo --no-llm --no-persist
```

| Command | Model | Writes DB | Use |
|---|---|---|---|
| `wiki inputs [--kind] [--id] [--limit]` | no | no | Agent evidence. stdout JSON |
| `wiki --no-llm` | no | yes (unless `--no-persist`) | Rule-only pages for the Web UI |
| `wiki --no-llm --no-persist` | no | no | Dry-run the rule pipeline |

`--kind` is one of `page` / `visualization` / `architecture` / `overview`. Omit `--kind` to export all four. `--id` is `p01` or a community id; with only `--id`, you get that page’s `page` + `visualization`. `--limit` keeps the N largest communities by node count.

`wiki inputs` prints JSON. Filter it locally. The fact payload is `inputs[].input`.

## Commands this skill must not run

| Command | Why |
|---|---|
| `codexqa wiki <repo>` (no `--no-llm`) | Calls the configured LLM |
| `codexqa wiki embed` | Embeds model-written wiki sections |
| `codexqa query … wiki` / `query wiki` | Semantic search; needs `wiki embed` |

`~/.codexqa/config.toml` `[llm]` is **not** required for this skill. Do not prompt the user to add a key.

Wiki generation also reads `~/.codexqa/wiki.toml` if present (community resolution, page cap). Missing file = built-in defaults. Do not edit it unless the user asked.

## Maintenance

```bash
codexqa status
codexqa stop
codexqa restart
codexqa update [--check]
codexqa delete <repo>           # confirm before deleting
```

`delete` and `uninstall` remove data or the CLI entry.
State the scope first and wait for confirmation.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `command not found` | Add `$(npm prefix -g)/bin` to PATH; install only if it is truly missing |
| resolve db / 先 index 建库 | Run `codexqa index` on that checkout, then retry `wiki inputs` |
| Indexing or wiki inputs is slow | First full index of a large repo, then Leiden + digest, is expected; add `--limit` |

Full subcommands: `codexqa --help` and `codexqa wiki --help`.
