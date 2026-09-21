# CodexQA CLI

Install, repo ids, LLM config, and maintenance. Routing: [SKILL.md](../SKILL.md). Scenario steps: [playbook.md](playbook.md).

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
| Local path | `/path/to/repo` or `.` | Checkout already on disk; preferred for indexing |
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

## Configure the LLM

The config file is `~/.codexqa/config.toml`. If it does not exist, defaults stay in memory and are not written. Index and query do not need this file.

```toml
[llm]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "gpt-5.5"
```

After editing, run `codexqa restart` or the change does not apply.

## Maintenance

```bash
codexqa status
codexqa stop
codexqa restart                 # required after config changes
codexqa update [--check]
codexqa delete <repo>           # confirm before deleting
```

`delete` and `uninstall` remove data or the CLI entry.
State the scope first and wait for confirmation.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `command not found` | Add `$(npm prefix -g)/bin` to PATH; install only if it is truly missing |
| LLM error or 401 | Check URL, key, and model in `config.toml`, then `restart` |
| Indexing is slow | A first full index of a large repo is expected; wait for it to finish |

Full subcommands: `codexqa --help` and `codexqa query --help`.
