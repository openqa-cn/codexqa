---
name: code-wiki
description: >
  Builds a local CodexQA architecture knowledge graph from community
  detection and `wiki inputs` (no model), then writes a Claude Code
  official-style HTML report. Use when the user mentions code-wiki,
  wiki, 代码知识图谱, 架构 Wiki, 模块地图, 阅读导览, wiki inputs,
  --no-llm, 社区检测, HTML 报告, or asks to map modules / generate a
  repo wiki without an LLM. Not change review (that is code-analyzer),
  not a P0/P1/P2 playbook CR (that is code-reviewer), and not
  clone-and-detect write-back (that is defect-detection).
license: Apache-2.0
compatibility: >
  Requires Node.js >= 18 and the `codexqa` CLI
  (`npm i -g @openqa-cn/codexqa`) on PATH. Index, `wiki --no-llm`, and
  `wiki inputs` need no LLM. Data lives in ~/.codexqa/.
metadata:
  author: open-source
  version: "1.2.0"
  open-standard: agentskills
---

# Code Wiki

Local **architecture knowledge graph**: index first, then export community
digests with `wiki inputs` and write a Claude Code official-style HTML
report (module map, reading guides, source-backed module notes).

There is **no** `codexqa wiki` without `--no-llm` in this skill, and no
`wiki embed` / `query wiki`. Those call a model or need an embedded wiki.
The graph facts are already in `wiki inputs` JSON:

```text
index  →  wiki inputs (architecture / overview / page / visualization)  →  HTML report
```

Pick the scenario before acting. Do not run wiki commands until an index
exists. Do not send `system` / `user` prompt strings to another model.
`README.md` / `README.zh-CN.md` are human-facing. Do not load them at runtime.

## Documents (load on demand)

Read this file first. Read another file only when the row below applies. Do not preload the whole tree.

| File | Load when |
|---|---|
| `SKILL.md` (this file) | always: routing, report contract, reject conditions |
| [references/playbook.md](references/playbook.md) | entering a scenario (index health / map / module / guide / persist) |
| [references/report.md](references/report.md) | before writing the HTML file |
| [assets/report-template.html](assets/report-template.html) | copy this file; do not invent a new layout |
| [references/diagrams.md](references/diagrams.md) | before drawing; copy `init` and `classDef` verbatim |
| [references/cli.md](references/cli.md) | CLI missing, PATH, or maintenance |
| `README.md`, `README.zh-CN.md` | human-facing; not needed by the agent |

## Scenario routing

Open [references/playbook.md](references/playbook.md) and jump to the named section.

| User is asking… | Playbook section |
|---|---|
| What is this repo / module map / knowledge graph | **Map the repository** (index health first) |
| How is the system organized / architecture wiki | **Map the repository** |
| What does this module do / who does it talk to | **Explain one module** |
| Where should I start reading / guided path | **Reading guide** |
| Persist a rule-only wiki for the UI | **Persist rule-only wiki** |
| Empty results / missing index / wiki failed | **Index health** / **Wiki blockers** |

Change review, callers, test gaps, and stack traces belong to `code-analyzer`.

## Report contract

Deliver a **self-contained HTML knowledge-graph report** in Claude Code
official style (ivory page, dark terminal chrome, clay `#D97757`,
JetBrains Mono). Copy [assets/report-template.html](assets/report-template.html)
into the working directory, then fill slots with Edit (do not rewrite CSS).
**Default the filled report to 简体中文** (headings, stats, findings,
overview, guides, notes). Keep `p01` aliases and symbol names. Write for a
newcomer: what the system is, where to start, which module is the hub,
which pages are standalone. Not a product brochure, and not an Archify /
architecture canvas.
Read [references/report.md](references/report.md) before writing the file.
Read [references/diagrams.md](references/diagrams.md) before drawing. A diagram that misses the quality bar fails the report.

Report body (HTML slots) is only these blocks:

- 关键发现 (3–5 `.take` lines: fact + what the reader should do)
- 系统怎么运转 (from `overview` / `architecture` `input`, in plain Chinese)
- 模块地图 (community ids, human titles, real `deps`)
- 阅读路径 (only steps backed by a real dependency)
- 模块笔记 (职责 / 对外接口 / 内部调用 / 跨模块往来)
- 独立模块 (empty `deps` — do not force them into a layer)
- **架构图**: at least one Mermaid block in `.diagram`, and it must pass the quality bar

Trust only the `input` object on each `wiki inputs` row. `system` / `user` are prompt templates, not evidence. `page` rows carry the digest; `visualization` / `architecture` / `overview` use rule titles and have no model-written body.

Reject the whole report and rewrite if any of these hold:

- Written as a generic project review (product intro, use cases, scored pros/cons)
- Evidence comes from README / a website / guesswork, not this run of `wiki inputs`
- Invented a module, group, or edge that is not in `communities` / `deps` / `cross_community` / visualization `candidates`
- Put an isolated module (empty `deps`) into a functional layer
- Ran `codexqa wiki` without `--no-llm`, or ran `wiki embed` / `query wiki`
- Mermaid is missing the Claude paper `init`, the three `classDef` lines, or a core module that should be `risk` has no `class ... risk`
- Architecture `subgraph` titles are package names (Renderer / Compiler / Shared) instead of **Entry → Application → Domain → Storage**
- HTML is missing the bundled Claude Code chrome, or was written from scratch instead of copying the template
- Report was delivered as Markdown-only / chat-only with no HTML file
- Archify / grouped-swimlane architecture canvas was generated (this skill does not ask for that)
- Chrome or body left in English when the user did not ask for English (findings / overview / pages selected)
- Findings or overview dump field names (`deps`, `cross_community`, `wiki inputs`) instead of 职责 / 依赖 / 阅读顺序
