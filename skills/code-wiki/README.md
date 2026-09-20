<div align="center">

**English** · [简体中文](README.zh-CN.md)

# CodexQA Code Wiki

</div>

**Turn a repository into a local architecture knowledge graph — module map, real dependencies, and reading guides — without calling a model.**

CodexQA indexes the repo, then `wiki inputs` exports Leiden communities and digests as JSON. Cursor / Claude Code read [`SKILL.md`](SKILL.md) and write a Claude Code official-style HTML wiki report from that JSON.

- **Module map** — communities (`p01`…) with rule titles and real `deps`
- **Module notes** — signatures, in-community `call_chain`, `method_flows`, `cross_community`
- **Reading guides** — only steps backed by a listed dependency
- **Optional persist** — `wiki --no-llm` writes rule-only pages for the Web UI

`code-wiki` answers **architecture and onboarding** questions from wiki-pipeline facts. It does not review a PR, bound regression, or score P0 / P1 / P2 findings. Use `code-analyzer` for change impact, `defect-detection` for requirement-oriented defects, and `code-reviewer` for playbook-driven implementation review.

The Skill, playbook, and examples are published in this repository. The required `@openqa-cn/codexqa` package is a separately distributed, closed-source local analysis engine. Index and `wiki inputs` run on the user's machine without an LLM. See [known limitations](KNOWN_LIMITATIONS.md).

```bash
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
```

---

## Quick start

### 1. Install

Requires **Node.js >= 18**.

```bash
npx skills add openqa-cn/codexqa --skill code-wiki
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

If the command is missing, add `$(npm prefix -g)/bin` to `PATH`. Do not reinstall when it is already present.

**Cursor / Claude Code:** put [`SKILL.md`](SKILL.md) in the agent skills directory. When the user asks for a knowledge graph, architecture wiki, module map, or reading guide, follow the SKILL and use the no-LLM wiki commands.

### 2. Index, then export wiki inputs

```bash
codexqa index /path/to/repo
codexqa wiki inputs /path/to/repo --kind architecture --limit 8
codexqa wiki inputs /path/to/repo --kind overview
codexqa wiki inputs /path/to/repo --kind page --id p01
```

Or say it in conversation:

```text
Build a code knowledge graph for this repo. Use wiki inputs only — no LLM wiki.
Start with the architecture map, then explain the core modules and a reading path.
```

### 3. Refine in conversation

Keep going with: `only the storage communities`, `open p03`, `drop isolated modules from the guide`. The agent should keep the existing index, rerun `wiki inputs` with `--kind` / `--id` / `--limit`, and not regenerate a product brochure.

---

## Choose the right scenario

| Scenario | Best for | Include in the prompt |
| --- | --- | --- |
| **Repository map** | What this repo is, module map, architecture wiki | Repo path, how many pages |
| **One module** | What a community does and who it talks to | `p01` / community id / module name |
| **Reading guide** | Where to start, onboarding path | Goal (API / storage / a feature) |
| **Persist rule-only wiki** | Store pages for the Web UI without a model | Whether to persist |
| **Index health** | Empty inputs, missing repo | Repo path or `repo_id` |

Change review, callers, test gaps, and stack traces: use `code-analyzer`.

---

## Why this skill

- **Communities are the knowledge-graph nodes** — Leiden + directory affinity, then a hard page cap. The agent does not invent modules
- **`deps` and `cross_community` are the edges** — counted from the symbol graph. Empty `deps` means isolated, not “put it in Domain”
- **`wiki inputs` is the evidence export** — same pipeline as generation, no model, no wiki tables. Read `inputs[].input`, not the prompt strings
- **`--no-llm` is optional persist** — rule titles only; do not follow it with `wiki embed`

---

## How it works

```text
index
  → wiki inputs --kind architecture / overview / page / visualization
  → group pages (Entry → Application → Domain → Storage)
  → reading guides along real deps
  → Claude Code official-style HTML report (Mermaid inside)
```

Optional: `wiki --no-llm` persists rule-only pages. The agent report still comes from `wiki inputs`.

---

## Commands

| Command | Use |
| --- | --- |
| `index` | Build the symbol graph wiki reads |
| `repos` / `stats` / `query summary` | Confirm the index exists |
| `wiki inputs --kind …` | Export community / digest / dep JSON (no model) |
| `wiki --no-llm` | Persist or dry-run rule-only wiki |

Do not run `codexqa wiki` without `--no-llm`. Do not run `wiki embed` or `query wiki`.

---

## Install and attach

| Surface | Where / how | Capability |
| --- | --- | --- |
| **CLI** | `npm install -g @openqa-cn/codexqa` | Index, `wiki inputs`, `wiki --no-llm` |
| **Cursor** | Put `code-wiki/` in `~/.cursor/skills/` or `.cursor/skills/` | Knowledge-graph workflow |
| **Claude Code** | `~/.claude/skills/` or `.claude/skills/` | Knowledge-graph workflow |

Maintenance: [`references/cli.md`](references/cli.md).

---

## Package contents

```text
code-wiki/
├── README.md                 # this file
├── README.zh-CN.md           # Chinese
├── SKILL.md                  # agent routing + report contract
├── assets/
│   └── report-template.html  # Claude Code official-style HTML chrome
└── references/
    ├── playbook.md           # scenario steps (load on demand)
    ├── report.md             # how to fill the HTML report
    ├── diagrams.md           # report diagram rules and templates
    └── cli.md                # install / repos / no-LLM wiki commands
```
