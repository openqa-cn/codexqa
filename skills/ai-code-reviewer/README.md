# AI Code Reviewer

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

`ai-code-reviewer` is **graph-evidence** code review: collect a CodexQA evidence pack (call chains, blast radius, test edges, dimension signals), have the host agent evaluate registry dimensions, then run an **Agent LLM judgment** pass (host embedded model) that **dedupes/merges** against heuristic findings via `merge-llm-findings.py`, write `review-conclusion.json`, and render bilingual `REVIEW-REPORT.html`. It applies to any language / polyglot monorepo and uses **only** the public **CodexQA CLI** (`@openqa-cn/codexqa`) as the primary analysis backend (no homemade call graph).

It is **not** [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.md) (SAST + Agent LLM Detection → `report_scan.*`), **not** [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.md) alone (symbol-graph Q&A without the review HTML pipeline), and **not** [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.md) (exception RCA). Use this skill when the goal is a **CodexQA-backed review report**.

## Requirements

- Node.js ≥ 18
- `bash` 3.2+, `jq` on `PATH`
- `@openqa-cn/codexqa` CLI on PATH:
  `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`
- A local Git checkout for PR/diff mode (`--diff-base`); full-repo / adhoc modes documented in `SKILL.md`

## Install the skill (npx) vs run collectors (bash)

| Command | What it does |
|---|---|
| `npx skills add openqa-cn/codexqa --skill ai-code-reviewer` | Installs the skill into a coding-agent skills directory |
| `bash scripts/collect-pr-evidence.sh …` | Builds the evidence pack (this is **not** an `npx` binary) |

There is no `npx ai-code-reviewer` / package `bin`. After install, point `$SKILL_DIR` at the installed folder and run the scripts under `$SKILL_DIR/scripts/`.

See the [installation guide](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md), [support matrix](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md), and [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md).

## Quick start

From this skill directory:

```bash
# PR / diff (default)
./scripts/collect-pr-evidence.sh --repo /abs/path/to/repo --diff-base origin/main

# Full-repo health (optional)
./scripts/collect-fullrepo-evidence.sh --repo /abs/path/to/repo

# Adhoc / single-file
./scripts/collect-adhoc-evidence.sh --file /abs/path/to/Foo.java

# After the agent writes review-conclusion.json:
./scripts/render-review-html.sh --dir <OUT_DIR>
```

Default `OUT_DIR`: `<repo>/.codexqa-review/<run-id>/`. Validate with `./scripts/validate-evidence.sh --dir <OUT_DIR> --mode pr` (or `full` / `adhoc`).

## Agent instructions

`SKILL.md` is the entry for an AI agent. Happy path: preflight → collect pack → validate → review from artifacts (heuristic dimensions) → **Agent LLM judgment** + `merge-llm-findings.py` dedupe → write `review-conclusion.json` (include `llm_judgment`) → render `REVIEW-REPORT.html`.

Do not load `README` / `HOW_IT_WORKS` / `KNOWN_LIMITATIONS` at runtime. Load `references/` and `prompts/` only when the rule is missing from context. Never invent graph edges; missing facts → `confidence: UNKNOWN`.

## Tests

```bash
bash scripts/validate-skill.sh
# faster iteration (skip plan-coverage audit):
bash scripts/validate-skill.sh --skip-audit
```

Requires Python **3.10+** on PATH (`scripts/acr-python` resolves `python3.11` / `3.12` / … when system `python3` is older).

## License

Apache License 2.0.

## Limitations

Depends on the closed-source `@openqa-cn/codexqa` CLI; heuristic derive scripts need no LLM API, but review prose and the order-16 Agent LLM judgment pass are model-judged; pack gaps weaken findings. For concrete failure cases see [Known limitations](KNOWN_LIMITATIONS.md). For the data flow see [How it works](HOW_IT_WORKS.md).
