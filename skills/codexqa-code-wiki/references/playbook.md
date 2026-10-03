# Wiki playbook

The default flow (`brief` → `notes.json` → `build`) is in [SKILL.md](../SKILL.md). This file covers the cases around it. Install / PATH / maintenance: [cli.md](cli.md).

This skill uses only the no-model wiki path. Do not run `codexqa wiki` without `--no-llm`. Do not run `wiki embed` or `query wiki`.

---

## Index health

`brief` indexes incrementally before exporting, so a missing index is usually fixed by running `brief` without `--skip-index`. When the export still fails or looks wrong:

```bash
codexqa repos --filter <substr> --limit 200
codexqa stats /path/to/repo
codexqa index /path/to/repo --full
```

| Symptom | What to do |
|---|---|
| `resolve db` / `先 codexqa index` / `The repo has no index yet` | Run `brief` without `--skip-index`, or `codexqa index <repo>` |
| `… is a subfolder of the git repo …` | codexqa indexes whole repositories. Run `brief` on the git root, or copy the folder out and `git init` it |
| Several branches and no `@branch` | List branches and let the user pick; do not default |
| Brief says `Truncated: 8 of 30 communities exported` | The export kept the largest communities only (page cap or `--limit`). The page says so too; tell the user |
| Brief says `Index quality: N% stub nodes` | Group boundaries and call counts are less certain; mention it when you deliver |
| `these modules hold 60% of indexed symbols` | The rest sit in communities outside the export; the page shows the same coverage |
| `repos` output looks short | It defaults to `--limit 20`, cap 200, and truncates silently; use `--filter` |

---

## Explain one module

Use this when the user names a module (`P03`) or asks what some part of the code does.

1. Answer from `brief.md` first: files, calls and callers with counts, public symbols, key flows.
2. For more of the digest, export that page:

```bash
codexqa wiki inputs /path/to/repo --kind page --id p03
```

Brief ids are `P03`; the CLI takes `p03`. Fields worth reading:

| Field | Meaning |
|---|---|
| `stats` | Symbol count, file count, languages, file paths |
| `signatures` | Public surface with `called_by` (how many call sites use it) |
| `call_chain` | Calls inside the module |
| `method_flows` | Statement-level steps for its busiest methods |
| `cross_community` | Calls to and from other modules, with counts |
| `sibling_modules` | Split from the same oversized community; stress the differences |

Do not invent a responsibility no signature, flow, or call supports. For source lines of a named symbol, hand off to `codexqa-code-analyzer`.

If the user wants it on the page, put what you learned into `modules.P03.detail` and rebuild.

---

## Persist rule-only wiki

Use this only when the user wants pages stored for the CodexQA Web UI **without** calling a model. It is separate from the HTML wiki.

```bash
codexqa wiki /path/to/repo --no-llm
codexqa wiki /path/to/repo --no-llm --limit 8
codexqa wiki /path/to/repo --no-llm --no-persist   # dry run
```

- `--no-llm` runs the same graph / community / digest pipeline and writes rule-based pages.
- Default persists into the branch DB; `--no-persist` writes nothing.
- Do not follow it with `wiki embed`; that needs model-written sections.

---

## Large repositories

- `brief --limit 8` keeps the 8 largest communities. Start there, then raise it if the user wants more.
- The page draws only the strongest calls of a dense group and says how many it hid; hovering a module shows all of its calls, and every module card lists them.
- Group and module names stay readable when there are 4–12 modules per page; beyond that, prefer `--limit` over a crowded page.
