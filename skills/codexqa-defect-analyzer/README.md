# Defect Detection

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

`codexqa-defect-analyzer` runs two detection dimensions — deterministic SAST / lint / secrets / SCA, then **one-round Agent LLM Detection** by the **invoking agent's embedded model** (default `--llm-mode agent`, no API key) — and **dedupes/merges** them into `report_scan.json` / `.md` / `.html` ordered **P0→P3**. Code-graph and call-chain analysis use the public **CodexQA CLI** (`@openqa-cn/codexqa`) for all languages.

It is **not** [`codexqa-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-reviewer/README.md) (CodexQA evidence-pack HTML review), **not** [`codexqa-code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-analyzer/README.md) (symbol-graph impact / test gaps), and **not** [`codexqa-rootcause-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-rootcause-analyzer/README.md) (exception RCA). Use this skill when the goal is a code-risk / security / logic **scan report**.

## Requirements

- **Python 3.10+** (required; entrypoints re-exec onto 3.10+ if needed)
- `git` on `PATH` for repository incremental/full scans
- `@openqa-cn/codexqa` CLI on PATH for live graph analysis (repo scans hard-fail without it unless mock is allowed):
  `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`
- Optional scanners: Semgrep, Bandit, gosec, gitleaks, ruff / eslint / golangci-lint, osv-scanner (`bash scripts/install_sast_tools.sh`)

## Install the skill (npx) vs run the CLI (python)

| Command | What it does |
|---|---|
| `npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer` | Installs the skill into a coding-agent skills directory |
| `python3 scripts/run_scan.py …` | Runs the scan orchestrator (this is **not** an `npx` binary) |

There is no `npx codexqa-defect-analyzer` / package `bin`. After install, point `$SKILL_DIR` at the installed folder and run `python3 "$SKILL_DIR/scripts/run_scan.py"`.

See the [installation guide](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md), [support matrix](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md), and [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md).

## Quick start

From this skill directory:

```bash
# choose scenario from user utterance
python3 scripts/run_scan.py choose --infer "review this PR for security issues"

# incremental prepare (agent-inline handoff; then Agent LLM Detection Stage1 → Stage2 → finalize merge per SKILL.md)
python3 scripts/run_scan.py incremental --repo /abs/path/to/repo --intent "PR review" -o /tmp/aid_report

# adhoc paste / file (always --fresh for rescan)
python3 scripts/run_scan.py adhoc --scan-mode incremental --paste-file /tmp/snip.py --lang python --fresh -o /tmp/aid_report

# CI / offline mock only
python3 scripts/run_scan.py incremental --repo . --dry-run -o /tmp/aid_report
```

Default agent mode always emits `agent_llm/` for Agent LLM Detection (Stage1/Stage2). Pass `--fresh` for full rescan / adhoc retest. Do not invent findings before reading `AGENT_LLM_HANDOFF` / `MANIFEST.json`.

## Agent instructions

`SKILL.md` is the entry for an AI agent. Happy path: choose scenario → deterministic prepare → Agent LLM Detection (`stage1.json`) → `agent-stage2` → Stage2 JSON → `finalize` (dedupe ∪ merge) → present `report_scan.*`.

Do not load `README` / `HOW_IT_WORKS` / `KNOWN_LIMITATIONS` at runtime. Load `references/` only when the rule is missing from context.

## Tests

```bash
# uses Python 3.10+ via scripts/run_tests.sh
npm test
# or:
bash scripts/run_tests.sh  # or: python3 scripts/test_pipeline_fixes.py
# (audit_policy_fixtures included in run_tests.sh)
```

## License

Apache License 2.0.

## Limitations

Depends on optional SAST binaries and the closed-source `@openqa-cn/codexqa` CLI for live graph analysis; Agent LLM Detection quality is model-judged. For concrete failure cases see [Known limitations](KNOWN_LIMITATIONS.md). For the data flow see [How it works](HOW_IT_WORKS.md).
