# Install and run codexqa

[简体中文](GETTING_STARTED.zh-CN.md)

Install one skill at a time on Cursor, Claude Code, Codex, or OpenClaw. This page walks [`defect-detection`](../skills/defect-detection/README.md) because it has a CLI you can smoke-test. The same command also takes `--skill code-analyzer`, `--skill root-cause-diagnosis`, `--skill ai-code-reviewer`, `--skill requirements-analyzer`, `--skill testcase-generation`, and `--skill testdata-generation`. `code-analyzer`, `root-cause-diagnosis`, and `ai-code-reviewer` use the separate `codexqa` symbol-graph CLI; `defect-detection` is Python-orchestrated and also uses that CLI for live graphs.

What you give each skill is different ([FAQ](FAQ.md#what-do-i-have-to-give-each-skill)). What a finished report looks like: [README · What the output looks like](../README.md#what-the-output-looks-like).

## Requirements

Use Node.js, npm/npx, Git, and a coding agent able to read skill files and run commands. `code-analyzer` requires Node.js 18 or newer. `testcase-generation` requires Python 3.10+ (invoke via that skill's `scripts/tcg-python`). The `defect-detection` Python pipeline is exercised with Python 3.11 locally and in CI:

```bash
python3 --version   # 3.10+; 3.11 recommended (defect-detection / testcase-generation)
node --version      # for CodexQA CLI / other skills
npx --version
git --version
```

`defect-detection` may install optional SAST tools via `scripts/install_sast_tools.sh` / `ensure_tools.py`. Live graph analysis needs `@openqa-cn/codexqa` on PATH. Packaging tests for other skills may still require Bash, rsync, zip, and unzip. See [data and network behavior](FAQ.md).

## Install from GitHub

```bash
npx skills add openqa-cn/codexqa --skill defect-detection
```

Choose an agent interactively. Default scope is the current project. For Codex across projects:

```bash
npx skills add openqa-cn/codexqa --skill defect-detection --agent codex --global
```

Use `--copy` if you prefer copies to agent-directory symlinks. Installation locations are managed by the third-party `skills` installer; use its output to locate the installed skill. Installation does not prove that a complete analysis works on that agent.

## Verify from a local checkout

Before pushing, inspect locally available skills without installing:

```bash
npx skills add . --list
```

To install this checkout, run from the repository root:

```bash
npx skills add . --skill defect-detection --agent codex --copy
```

For a CLI-only smoke check, no model or private platform is needed:

```bash
python3 skills/defect-detection/scripts/run_scan.py --help
(cd skills/defect-detection && npm test)
```

`npm test` runs the Python pipeline and policy-fixture suites (prefers Python 3.11). It does not run a live agent Stage1/Stage2 scan. [Run the boundary-case example](../examples/checkout-boundary/README.md) for a known-good and seeded-defect pair (fixture verification only).

## Start the agent workflow

Open a new session after installation. Provide a local repo path, PR/diff intent, upload, or paste. Example request:

> Use defect-detection to scan my repository at /abs/path/to/repo for this PR. Run the agent-inline Stage1/Stage2 flow and return `report_scan.json` findings ordered P0–P3.

Expect deterministic collect + agent handoff, then `report_scan.json` / `.md` / `.html`. Inspect `tooling_status.missing` when scanners are absent. Keep findings under human review.

## Update and remove

Use the third-party installer's help to inspect its current options:

```bash
npx skills --help
npx skills list
npx skills update
npx skills remove defect-detection --agent codex
```

For global installations add `--global` where supported. Back up configuration and task data before updating or removing an installed directory. The default skill stores data inside its installation; updates must not be used as a backup mechanism.

## Other published skills

```bash
npx skills add openqa-cn/codexqa --skill code-analyzer
npm install -g @openqa-cn/codexqa

npx skills add openqa-cn/codexqa --skill root-cause-diagnosis
npx skills add openqa-cn/codexqa --skill ai-code-reviewer
npx skills add openqa-cn/codexqa --skill requirements-analyzer
npx skills add openqa-cn/codexqa --skill testcase-generation
npx skills add openqa-cn/codexqa --skill testdata-generation
```

The `code-analyzer`, `root-cause-diagnosis`, and `defect-detection` Skills are published in this repository. `@openqa-cn/codexqa` is the separately distributed, closed-source local code-analysis engine; indexes and sessions live under `~/.codexqa/`. See [`code-analyzer` known limitations](../skills/code-analyzer/KNOWN_LIMITATIONS.md), [`root-cause-diagnosis` known limitations](../skills/root-cause-diagnosis/KNOWN_LIMITATIONS.md), and [`defect-detection` known limitations](../skills/defect-detection/KNOWN_LIMITATIONS.md).

For a model-free `code-analyzer` smoke check, index a local checkout and inspect its summary:

```bash
codexqa --help
codexqa index /path/to/repo
codexqa stats /path/to/repo
```

`--help` should list the CLI commands. A successful `stats` call should report indexed files, symbols, and languages. For change review, rebuild the index with `--diff-base <ref>`; without a diff base, changed symbols remain `default` and there is no change set to review.

After install, start a new agent session and point it at the skill. Inputs differ:

- `code-analyzer` needs a local repository. For change review, index it with a baseline such as `origin/main`; indexes live under `~/.codexqa/`. See its [README](../skills/code-analyzer/README.md).
- `root-cause-diagnosis` needs exception evidence (stack / log / dump) plus a git URL, local dir, file, or already-open workspace. See its [README](../skills/root-cause-diagnosis/README.md).
- `defect-detection` needs a diff, repo, upload, or paste for a code-risk scan. See its [README](../skills/defect-detection/README.md).
- `ai-code-reviewer` needs a local checkout, `codexqa` + `jq` on PATH, and (for PR mode) `--diff-base`. See [ai-code-reviewer README](../skills/ai-code-reviewer/README.md).
- `requirements-analyzer` needs requirement documents, not a repo. See [What you give it](../skills/requirements-analyzer/README.md#what-you-give-it).
- `testcase-generation` needs local requirement materials (file, directory, paste, or HTTPS document URL this turn). Optional knowledge dir / Git URL. After Exec, expect Markdown under `testcase/cases/` plus `testdesign/testcase_generation_report.html`. Smoke: `./scripts/tcg-python scripts/close_stage.py --self-check` (and `check_run_gate.py` / `generate_case_report.py --self-check`) from the skill directory. See its [README](../skills/testcase-generation/README.md).
- `testdata-generation` needs a construct request, cases, or an API source — not application source. See [What you give it](../skills/testdata-generation/README.md#what-you-give-it).

Sample prompts for each skill: [root README · Quick start](../README.md#quick-start).

Method write-ups: [How it works index](HOW_IT_WORKS.md). What to bring: [FAQ](FAQ.md#what-do-i-have-to-give-each-skill).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Skill not listed from GitHub | The skill must be committed and pushed to the repository being installed |
| Agent does not discover the skill | Selected agent, project/global scope, and whether a new session is required |
| Unknown `.ts` extension | Node runtime and TypeScript stripping environment |
| Missing plan | Provide repository/branch and business materials; degraded loading does not mean sufficient materials |
| Static/call-graph analysis unavailable | Tool installation result, PATH, permissions, and network access |
| `codexqa` command not found or graph query is empty | Install `@openqa-cn/codexqa`, check PATH, confirm the repository was indexed, and use `--diff-base` for change review |
| Local report link does not open | Open the returned HTML file in a browser |

For support include the commit, Node version, OS, agent/version, command, and sanitized error. Do not upload source or task directories containing private data.
