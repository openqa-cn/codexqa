# Writing notes.json

Read this before filling `.codexqa-wiki/<repo>/notes.json`. Routing: [SKILL.md](../SKILL.md).

`notes.json` holds the only words a model writes. Everything else on the page
(sizes, call counts, groups, the diagram, symbols, files, search) comes from
the export, so it cannot drift from the code. Your job is to turn the brief
into something a newcomer can act on: what the repo is, what each module is
for, and which modules to open, in which order, for a given task.

## Shape

`brief` writes a scaffold with every id already in place. Keep the ids; fill the strings.

```json
{
  "lang": "zh",
  "title": "CodexQA 技能仓库",
  "tagline": "十个可单独安装的质量验证 skill，彼此几乎不互相调用。",
  "overview": "第一段：这是什么。\n\n第二段：主链路怎么走，枢纽是谁。",
  "groups": {
    "G1": { "name": "缺陷扫描与诊断", "summary": "P02 把这一组连在一起，改动影响面最大。", "members": ["P02", "P05", "P11", "P12"] }
  },
  "modules": {
    "P02": { "name": "缺陷扫描主流程", "role": "全量 / 增量扫描入口和 HTML 报告。", "detail": "可选，1–2 段。", "layer": "应用" }
  },
  "guides": [
    { "title": "要改缺陷扫描", "steps": [
      { "module": "P05", "note": "先看扫描 Agent 怎么装工具。" },
      { "module": "P02", "note": "再看主流程；这里是枢纽。" }
    ] }
  ]
}
```

| Field | Required | Limit | Write |
|---|---|---|---|
| `title` | no (defaults to repo name) | 40 | What people call this repo |
| `tagline` | yes | 90 | One sentence: what it is and its shape (one service? a monorepo of tools?) |
| `overview` | yes | — | 2–4 short paragraphs: what it is, the main path through it, which group matters most |
| `groups.Gn.name` | yes | 24 | What the group does together, not the hub's file name |
| `groups.Gn.summary` | no | 160 | Why these modules move together; name the hub when there is one |
| `groups.Gn.members` | keep | — | Leave as scaffolded; it detects stale notes after the code changes |
| `modules.Pnn.name` | yes | 24 | A human name for the responsibility (`回放执行器`, not `cli · runStep`) |
| `modules.Pnn.role` | yes | 80 | One sentence: what this module does |
| `modules.Pnn.detail` | no | — | Where to start inside it (name 1–3 symbols from the brief), what is surprising, what breaks if you change it |
| `modules.Pnn.source` | keep | — | The export title this note was written for. Leave as scaffolded; after a re-index, `build` flags notes whose module changed underneath them |
| `modules.Pnn.layer` | no | — | `入口` / `应用` / `领域` / `存储` (or `entry` / `application` / `domain` / `storage`); never on a standalone module |
| `guides[].title` | yes | 40 | The task this path is for: `要改支付回调`, `第一次读这个仓库` |
| `guides[].steps[].note` | yes | 120 | What to read here, and why the next step follows |

Limits are characters; going over is a warning. Placeholder and field-name checks ignore text inside backticks, so `deps.py` or `{{ name }}` in code is fine. Text supports `` `code` ``,
`**bold**`, blank-line paragraphs, and `- ` lists. Any `P01`-style id that
exists becomes a link.

## Where the words come from

Use the brief, in this order:

1. **Public symbols and flows** (`public:` / `flow:` lines) say what a module does. `scan_full`, `render_html_report` → "全量扫描入口和报告".
2. **Files** say where it lives and whether the community mixes unrelated things. If one module holds scanner code *and* preview scripts, say so in `detail`; that is useful, not a flaw to hide.
3. **Calls and callers with counts** say who depends on whom. The heaviest pairs are the ones worth a sentence.
4. **Hub** (`· hub`) is the module most connected inside its group: changes there spread furthest. Say that in the group summary and in a guide step.

The module title in the export (`examples · scan_file`) is a rule-made label
from directories and the busiest symbol. Do not polish it into a product name
the symbols do not support.

## Reading paths

- 1–3 paths, 2–4 steps each, one per real task a newcomer has. The brief's
  `suggested path` per group is a valid starting point; reorder or cut it for
  the task.
- Consecutive steps must call each other (either direction). If `build` says
  `P01 and P03 do not call each other; next to P01 you can go to P02`, pick
  from that list.
- Each note says what to look at (name a symbol) and why the next step
  follows: "它读的正是上一步定义的类型", "改完跑这里的场景校验".
- Standalone modules cannot be steps; mention them in the overview instead.

## What build rejects

| Message | Fix |
|---|---|
| `no such module in this export (P01–P12)` | The id is not in this export; rerun `brief` and use its ids |
| `written for P01,P02 but this export groups …` | The code changed and the group moved; rewrite that group and update `members` |
| `do not call each other` | Use one of the listed neighbours |
| `still has placeholder text` | Replace `待填`, `TODO`, `TBD`, `{{…}}` with real text |
| `` `deps` → `` / `内部字段名` | Write 依赖 / 调用 / 被调用 / 规模 instead of export field names |
| `write module ids in capitals` | `P01`, not `p01` |
| `layer: a module with no calls …` | Remove `layer` from standalone modules |
| `written for "…", but P06 in this export is "…"` | Ids moved after a re-index. Rewrite the entry for the module now at that id, then copy its new title into `source` |
| `written twice under different spellings` | `p1` and `P01` are the same module; keep one key |

Missing required fields block a final build; `--draft` fills them with rule
text and marks the page as a draft.

## Language

Default is 简体中文 for every string. Set `"lang": "en"` and write English when
the user asks; the page chrome follows `lang`. Keep symbol and file names
exactly as in the brief.
