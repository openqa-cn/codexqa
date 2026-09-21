# Wiki playbook

`SKILL.md` is the routing and report contract. Read this file after you enter a scenario. Do not preload the whole tree.
Read [diagrams.md](diagrams.md) before drawing. Read [report.md](report.md) before writing the HTML file. Install / PATH / maintenance: [cli.md](cli.md).

This skill uses only the no-model wiki path. Do not run `codexqa wiki` without `--no-llm`. Do not run `wiki embed` or `query wiki`.

`<repo>`: use a local path when a checkout exists (preferred); a canonical id such as `github.com/org/repo@main`. Multiple branches require `@branch` — do not guess.

---

## Index health

Wiki commands read the branch LanceDB. If there is no index, `wiki inputs` fails with “先 codexqa index 建库”. Confirm the index before treating wiki JSON as evidence.

```bash
codexqa index /path/to/repo
codexqa repos --filter <substr> --limit 200
codexqa repos --limit 200
codexqa stats /path/to/repo
codexqa query --repo <repo> summary
```

`repos` defaults to `--limit 20`, cap 200. Extra pages do not error; they are silently truncated. In table output read `showing A-B of T`; in JSON read `has_more` / `next_offset`. If T>200, add `--filter`. Do not run bare `codexqa repos`.

Default index is incremental; `--full` forces a rebuild. If `stats` shows many stubs / collisions, lower confidence on community boundaries and cross-module edges. Do not conclude from a half-built index.

---

## Map the repository

Use this when the user wants a knowledge graph, architecture wiki, or module map.

`wiki inputs` shares graph build / Leiden communities / digest with full generation. It does **not** call a model and does **not** write wiki tables. stdout is JSON.

```bash
codexqa wiki inputs /path/to/repo --kind architecture
codexqa wiki inputs /path/to/repo --kind overview
codexqa wiki inputs /path/to/repo --kind page --limit 8
```

JSON shape:

```text
{ communities, selected, inputs: [{ kind, id?, community_id?, input, token_est, system, user }] }
```

How to read it:

- Walk `inputs[].input`. Ignore `system` / `user` (those are prompt strings for a model this skill does not call).
- `--kind architecture` → `input` is `{id, title, summary, node_count, deps}[]`. `id` is the short alias (`p01`…). `deps` are real opposite-page aliases (≤8). Empty `deps` = isolated / peripheral.
- Without a model, `title` is the rule title (directory / community). `summary` is often `（无摘要）` plus `真实依赖：p01 -> p02, …`. The dependency list is the fact; the empty abstract is not a finding.
- `--kind overview` → `input` is the system-context object built from pages + real community deps. Rule titles only; no model overview body.
- `--kind page` without `--id` → one digest per selected community (`p01`, `p02`, …). Read `stats`, `signatures`, `call_chain`, `method_flows`, `cross_community`.
- `--limit N` keeps the N largest communities by node count. On a large repo start with `--limit 8` for architecture, then open specific `--id` pages.
- `communities` vs `selected`: the pipeline capped or limited the page set. Say so if they differ.

Then group pages yourself:

1. Isolated pages (`deps` empty) → **peripheral / independent**. Do not force them into a functional layer.
2. Remaining pages → **Entry → Application → Domain → Storage** from signatures, tags, and `deps` direction. Do not use package names as layer titles.
3. An edge exists only when `deps`, `真实依赖`, `cross_community`, or a visualization candidate lists it.

---

## Explain one module

Use this when the user names a module, community, or page (`p01` or a community id).

```bash
codexqa wiki inputs /path/to/repo --kind page --id p01
codexqa wiki inputs /path/to/repo --kind visualization --id p01
```

`--id` alone returns that page’s `page` and `visualization` rows. `visualization` is omitted when there are no graph candidates.

Page `input` fields that count as evidence:

| Field | Meaning |
|---|---|
| `tentative_title` | Rule title for this community |
| `stats` | `node_count` / `file_count` / `block_count` / languages / namespaces |
| `signatures` | Public surface: kind, name, `called_by` (fan-in), tags, parent |
| `call_chain` | In-community edges (`from` → `to`, `kind`) |
| `method_flows` | Statement-level steps for key methods |
| `cross_community` | `in` / `out` to another community, with `weight` and edge `kinds` |
| `sibling_modules` | Split from the same oversized community — stress **differences** |
| `valid_anchors` | Anchor ids the digest may cite; not file paths |

Do not invent a responsibility that no signature, flow, or cross edge supports. After a hit, you may confirm a named symbol with `codexqa-code-analyzer` (`symbols` → `source`) — that is optional, and only when the user wants source lines.

Visualization `input.candidates`:

- `kind`: `flow` (inside the module) or `dependencies` (across modules)
- `nodes[].symbol` / `role_hint` and `edges[].relation` / `count` are static-analysis facts
- Draw only nodes and edges present in a candidate

---

## Reading guide

Use this when the user asks where to start, how to onboard, or wants a guided path.

1. Load architecture `input` (and overview if you do not already have it).
2. Keep only pages that appear in some other page’s `deps` (or in `真实依赖`). Isolated pages are not guide steps.
3. Build 1–3 paths along the **heaviest real deps**, 3–4 pages each. Prefer a path that starts at Entry and ends at Storage when the deps support it.
4. Adjacent steps must have a listed dependency. If they do not, drop the step. Do not write “then read X” from a README heading.

A guide with no real edge between consecutive steps fails the report.

---

## Persist rule-only wiki

Use this only when the user wants a wiki stored for the Web UI **without** calling a model.

```bash
codexqa wiki /path/to/repo --no-llm
codexqa wiki /path/to/repo --no-llm --limit 8
codexqa wiki /path/to/repo --no-llm --no-persist
```

- `--no-llm` runs the same graph / community / digest pipeline and writes **rule-based** pages (no narrative body from a model).
- Default persists `wiki_manifest` / `wiki_pages` / `wiki_relations` in the branch DB. `--no-persist` is a dry run.
- This is not a substitute for `wiki inputs` when writing the HTML report. Persist is for the Web UI; `wiki inputs` is the evidence export.
- Do not follow persist with `wiki embed`. Embed needs model-written sections this skill does not produce.

---

## Wiki blockers

| Symptom | What to do |
|---|---|
| `repo index not found` / resolve db path / 先 index 建库 | `index` first; verify with `repos --filter <substr> --limit 200` |
| Several branches and no `@branch` | List branches and let the user pick; do not default |
| `inputs` is empty | Index may be empty or `--id` did not match `p01` / community id; rerun architecture without `--id` |
| `communities` >> `selected` | Page cap or `--limit` dropped communities; say the graph is truncated |
| Architecture titles look like directories | Expected without a model; do not polish them into product names unless `signatures` justify it |
| User asks to “generate wiki” / “embed wiki” / “search wiki” | Stay on `--no-llm` / `wiki inputs`. `wiki` (LLM), `wiki embed`, and `query wiki` are out of scope |
| `stats` shows many stubs / collisions | Community cuts and cross edges may be noisy; lower confidence |

---

## Write the HTML report

After you have `wiki inputs` evidence, open [report.md](report.md). Copy the bundled Claude Code template, fill slots in **简体中文** (unless the user asked for English), and give the user the file path. Write for a newcomer: hub, reading order, standalone tools. Do not dump field names. Do not stop at a Markdown-only reply.
