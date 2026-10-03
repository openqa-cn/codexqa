<div align="center">

**English** · [简体中文](README.zh-CN.md)

# CodexQA Code Wiki

</div>

**Turn a repository into a one-page architecture wiki: modules, who calls whom and how often, and where to start reading. No model is needed for the facts.**

CodexQA indexes the repo and splits its symbol graph into modules. This skill's script turns that export into a brief, your agent writes short names and sentences into `notes.json`, and the script renders one self-contained HTML page. The agent never draws diagrams or edits HTML, so the page cannot disagree with the code.

- **Reading paths** — "要改支付回调: P06 → P04 → P07", where every step really calls the next
- **Architecture diagram** — modules grouped by who calls whom, line width by call count, hub marked; hover to trace a module's calls
- **Module cards** — what it does, calls and callers with counts, public API, key flows, files linked to the source
- **Search** — modules, symbols, and files; `/` to focus
- **Works offline** — one HTML file, light and dark themes, phone layout, print

`codexqa-code-wiki` answers **architecture and onboarding** questions. It does not review a PR, bound regression, or score P0 / P1 / P2 findings. Use `codexqa-code-analyzer` for change impact, `codexqa-defect-analyzer` for SAST+agent code-risk scan reports, and `codexqa-code-reviewer` for CodexQA evidence-pack HTML review.

The skill and its scripts are published in this repository. The required `@openqa-cn/codexqa` package is a separately distributed, closed-source local analysis engine. Indexing and export run on your machine without an LLM. See [known limitations](KNOWN_LIMITATIONS.md).

---

## Quick start

### 1. Install

Requires **Node.js >= 18**.

```bash
npx skills add openqa-cn/codexqa --skill codexqa-code-wiki
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

If the command is missing, add `$(npm prefix -g)/bin` to `PATH`.

### 2. Ask

```text
Make a code wiki for this repo.
```

The agent runs three steps:

```bash
node <skill>/scripts/wiki.mjs brief .     # index, export, print the brief
# … writes .codexqa-wiki/<repo>/notes.json
node <skill>/scripts/wiki.mjs build .     # validate notes, write the HTML
```

and gives you `codexqa-code-wiki-<repo>-YYYYMMDD-HHMM.html`.

### 3. Refine

`Add a reading path for changing the storage layer`, `rename P04`, `write it in English`. The agent edits `notes.json` and rebuilds; the index and facts stay as they are.

Want a look before any writing? `build . --draft` renders right after `brief` with rule-based names and a draft banner.

---

## What the page shows

| Section | From |
|---|---|
| Title, one-line summary, overview | `notes.json` |
| Module, group, and standalone counts; share of indexed code covered; commit | export + git |
| Where to start (reading paths with call counts per step) | `notes.json` steps, checked against real calls |
| Architecture diagram | export, laid out by the script |
| Module cards: name, role, notes | `notes.json` |
| Module cards: size, calls, callers, public API, key flows, files | export |
| Glossary, commands used, generation time | script |

Truncated exports, low coverage, uncommitted changes, and drafts are flagged at the top of the page.

---

## Why this skill

- **Facts and words are separate.** Counts, edges, and the diagram come from the export. The agent writes only names and sentences, and `build` rejects unknown modules, paths through modules that do not call each other, placeholders, and internal field names.
- **Deterministic.** The same export gives the same groups, hub, suggested paths, and layout.
- **Fast.** `brief` takes seconds after the first index; `build` takes well under a second.
- **No CDN, no server.** The page is a single file you can mail, attach, or open from disk.

---

## Commands

| Command | Use |
| --- | --- |
| `wiki.mjs brief <repo>` | Index (incremental), export `wiki inputs`, write the brief and a `notes.json` scaffold |
| `wiki.mjs build <repo>` | Validate `notes.json` and write the HTML; `--draft` for no notes |
| `wiki.mjs check <repo>` | Validate only |
| `codexqa wiki --no-llm` | Optional: store rule-only pages for the CodexQA Web UI |

Options and exit codes: [`references/cli.md`](references/cli.md). The skill never runs `codexqa wiki` without `--no-llm`, `wiki embed`, or `query wiki`.

---

## Install and attach

| Surface | Where / how | Capability |
| --- | --- | --- |
| **CLI** | `npm install -g @openqa-cn/codexqa` | Index and `wiki inputs` |
| **Cursor** | Put `codexqa-code-wiki/` in `~/.cursor/skills/` or `.cursor/skills/` | Wiki workflow |
| **Claude Code** | `~/.claude/skills/` or `.claude/skills/` | Wiki workflow |

---

## Package contents

```text
codexqa-code-wiki/
├── README.md / README.zh-CN.md
├── SKILL.md                  # agent flow and rules
├── KNOWN_LIMITATIONS(.zh-CN).md
├── scripts/
│   ├── wiki.mjs              # brief / build / check
│   └── lib/                  # model, notes validation, layout, rendering
├── assets/
│   ├── wiki.css              # page styles (inlined into the HTML)
│   └── wiki.js               # search, diagram focus, theme, navigation
├── references/
│   ├── notes.md              # how to write notes.json
│   ├── playbook.md           # one module, index health, persist
│   └── cli.md                # install / repo ids / commands
└── tests/                    # node --test; fixtures from this repository
```

Run the tests with `npm test` inside the skill directory.
