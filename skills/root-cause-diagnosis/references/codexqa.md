# CodexQA CLI (diagnosis contract)

CodexQA itself stores its private index under `~/.codexqa/`. **Do not open those files.** This skill only talks to CodexQA through the `codexqa` CLI (`index` / `query` / `stats` / `repos`). Do not load CodexQA skill files or scripts.

On the happy path, `run` already indexed and analyzed. Read **`facts.json`** and **`data/<taskId>/codexqa/brief.json`** (also `run` / `analyze-frames` stdout `brief`) — `callPath` + `source` + weak/hint per app frame. Do **not** read `analysis.json` when `brief`/`facts` exist.

Full dump (read only if a source slice is missing): `data/<taskId>/codexqa/analysis.json`  
Pointer: `data/<taskId>/codexqa/index.json`  
Ready flag: `meta.json` → `meta.codexqa`

Install: `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`  
Binary: `codexqa` (Node.js ≥ 18; this skill's CLI requires Node.js 22+). Wiki / chat / `search-index` are optional and are **not** run by this skill.

Load this file only before `ensure-codexqa` / `analyze-frames` when `run` did not index.

## Who writes it

| When | Command | What is filled |
|---|---|---|
| After repo resolve | `ensure-codexqa` (inside `run`) | Incremental `codexqa index` (add `--force-reindex` for `--full`). Snapshot: `repo`, `summary` |
| After parse | `analyze-frames` (inside `run`) | Per-app-frame `methods["Class#method"]` slices (symbols, source, callers/callees). Frames queried in parallel; Class#method lookup first. `brief.json` + `facts.json` |

## Uploaded files / non-git origin

CodexQA `index` fails with `not a git repository` on a bare folder or a single uploaded `.java` file. This skill does **not** copy CodexQA sources. It prepares a **task-local** git workdir:

1. Prefer `--file` when the user uploads business code.
2. Bundle: uploaded file + stack-frame basenames found in that folder + other **same-extension** top-level source files in the same directory (no recursive walk of nested projects).
3. Copy into `data/<taskId>/repo` and `git init` **only there**. Never `git init` the user's path.
4. Run `codexqa index --format json` against that copy (incremental; `--full` only with `--force-reindex`).
5. If `ensure-codexqa` still sees `not a git repository`, rematerialize once from `meta.originDir` and index again.

```bash
node "$SKILL_SCRIPT" ensure-codexqa --task-id $TASK_ID
node "$SKILL_SCRIPT" analyze-frames --task-id $TASK_ID
```

## CLI JSON envelopes (keep these shapes)

`codexqa query` prints JSON. Persist and read these kinds; do not invent a graph.

| Op | Command | Envelope |
|---|---|---|
| symbols | `codexqa query --repo <dir> symbols --name X` | `{"kind":"Nodes","nodes":[<Node>],"tags":[...]}` |
| edges | `… edges --id <id> --direction in\|out\|both` | `{"kind":"Edges","edges":[{from_id,to_id,kind,from_file,to_file}]}` |
| reach | `… reach --id <id> --direction in\|out --depth N` | `{"kind":"GraphReach","result":{root,hops:[[Node]...],edges,actual_depth}}` |
| path | `… path --from <id> --to <id>` | `{"kind":"ShortestPath","result":{from,to,path,edges,hops}}` (`hops=-1` if none) |
| source | `… source --id <id>` | `{"kind":"Source","text","start_line","end_line"}` or `{"kind":"Empty"}` |
| summary | `… summary` | `{"kind":"Summary","repo","branch","files_total","nodes_total","edges_total","lang_stats","source_stats","indexed_at"}` |
| symbol | `… symbol --id <id>` | `{"kind":"NodeDetail","node":<Node>,"tags":[...]}` |

Node fields used by diagnosis: `id`, `kind`, `name`, `file_path`, `language`, `start_line`, `end_line`, `namespace`, `module`, `from_count`, `to_count`. Compact copies in `analysis.json` use camelCase (`file`, `startLine`, `endLine`).

`stats` / `repos` / `index` are invoked with `--format json`.

## How to use it in diagnosis

1. Prefer **`facts.json` + `brief.json`**. Treat `analysis.repo` + `stats`/`summary` as the repo baseline only when those are missing.
2. Look up `brief` items (and only then `analysis.methods["Class#method"]`) for each app frame (also stored as short `OrderService#checkout`).
3. Concatenate call-chain text as `A#method(L12)→B#method(L45)` from `name` + `startLine`.
4. **Only if that method key is missing** and `meta.codexqa.ready=true`, re-run `analyze-frames` (still CLI, never `~/.codexqa/` files).
5. If `ready=false` after a real install/index attempt, grep and mark evidence **weak**.

Do not dump or parse the CodexQA home directory. Do not run `wiki` / `chat` / `serve` unless the user asks.
