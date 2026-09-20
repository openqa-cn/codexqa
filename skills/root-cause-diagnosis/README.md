# Root Cause Diagnosis

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

`root-cause-diagnosis` turns exception evidence (stack traces, logs, call-chain dumps, debug output) plus a business codebase into an **English** Markdown root-cause report (`report.md` / `report.en.md`). Structured repo understanding comes only from the public **CodexQA CLI** (`@openqa-cn/codexqa`); this skill does not copy engine or skill source.

It is **not** [`code-analyzer`](../code-analyzer/README.md) (symbol-graph impact / callers / test gaps), **not** [`defect-detection`](../defect-detection/README.md) (requirement-oriented defects with write-back gates), and **not** [`code-reviewer`](../code-reviewer/README.md) (P0/P1/P2 playbook CR). Use those for structure, requirements, or review findings; use this skill when the input is an exception and the goal is RCA.

## Requirements

- Node.js 22+ (TypeScript stripping via `NODE_OPTIONS=--experimental-strip-types`)
- `git` on `PATH` when the input is a remote repository
- `@openqa-cn/codexqa` CLI on PATH (install if missing):
  `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`
- Network only to clone a remote repo and, if needed, install the CLI

## Install the skill (npx) vs run the CLI (node)

| Command | What it does |
|---|---|
| `npx skills add openqa-cn/codexqa --skill root-cause-diagnosis` | Installs the skill into a coding-agent skills directory |
| `node scripts/diagnose.ts …` | Runs the diagnosis CLI (this is **not** an `npx` binary) |

There is no `npx root-cause-diagnosis` / package `bin`. After install, point `$SKILL_DIR` at the installed folder and run `node "$SKILL_DIR/scripts/diagnose.ts"`.

See the [installation guide](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md), [support matrix](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md), and [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md).

## Quick start

From this skill directory:

```bash
export NODE_OPTIONS=--experimental-strip-types

node scripts/diagnose.ts run \
  --exception-file /tmp/npe.txt \
  --file /abs/path/OrderService.java

# local folder (non-git is copied into data/<taskId>/repo for CodexQA):
node scripts/diagnose.ts run \
  --exception-file /tmp/npe.txt \
  --dir /abs/path/to/business-code

# or a git remote:
node scripts/diagnose.ts run \
  --exception-file /tmp/npe.txt \
  --git git@github.com:acme/order-service.git \
  --branch main
```

`run` is `submit` + incremental CodexQA index + parallel frame analysis in **one process**. Stepwise commands (`submit`, `ensure-codexqa`, `analyze-frames`) remain for debugging.

The Agent runs `run`, which writes `brief.json`, `facts.json`, and a heading-only `report.draft.md`. Fill the draft from facts (narrative only), then `write-report --from-draft`. Do not read `analysis.json` or trim the draft to a hard character cap. The CLI does not author RCA prose.

## Agent instructions

`SKILL.md` is the entry for an AI agent. Happy path: exception file → `run` → fill `report.draft.md` from `facts.json` → `write-report --from-draft` → one English paragraph from stdout `chat.en` plus `report.md` / `report.en.md`.

Do not load `references/` before `run`. After `facts` exist, fill the draft from `SKILL.md` Report rules; load a reference only if that rule is missing from context.

## Tests

```bash
export NODE_OPTIONS=--experimental-strip-types
npm test
```

## License

Apache License 2.0.

## Limitations

Depends on the closed-source `@openqa-cn/codexqa` CLI; RCA narrative quality is model-judged; graph gaps weaken evidence. For concrete failure cases see [Known limitations](KNOWN_LIMITATIONS.md). For the data flow see [How it works](HOW_IT_WORKS.md).
