# Install and run codexqa

[简体中文](GETTING_STARTED.zh-CN.md)

HTML documentation for search engines: [openqa.cn](https://openqa.cn/). This page is the GitHub source.

Install one skill at a time on Cursor, Claude Code, Codex, or OpenClaw. This page walks [`codexqa-defect-analyzer`](../skills/codexqa-defect-analyzer/README.md) because it has a CLI you can smoke-test. The same command also takes `--skill codexqa-skill-router`, `--skill codexqa-code-analyzer`, `--skill codexqa-code-wiki`, `--skill codexqa-rootcause-analyzer`, `--skill codexqa-code-reviewer`, `--skill codexqa-requirement-analyzer`, `--skill codexqa-testcase-generator`, and `--skill codexqa-testdata-generator`. Prefer [`codexqa-skill-router`](../skills/codexqa-skill-router/README.md) when you are unsure which worker to install — it can match and fetch workers on demand. `codexqa-code-analyzer`, `codexqa-code-wiki`, `codexqa-rootcause-analyzer`, and `codexqa-code-reviewer` use the separate `codexqa` symbol-graph CLI; `codexqa-defect-analyzer` is Python-orchestrated and also uses that CLI for live graphs; `codexqa-skill-router` needs Python 3.10+ for discover/ensure.

What you give each skill is different ([FAQ](FAQ.md#what-do-i-have-to-give-each-skill)). What a finished report looks like: [README · What the output looks like](../README.md#what-the-output-looks-like).

## Requirements

Use Node.js, npm/npx, Git, and a coding agent able to read skill files and run commands. `codexqa-code-analyzer` and `codexqa-code-wiki` require Node.js 18 or newer. `codexqa-testcase-generator` requires Python 3.10+ (invoke via that skill's `scripts/tcg-python`). The `codexqa-defect-analyzer` Python pipeline is exercised with Python 3.11 locally and in CI:

```bash
python3 --version   # 3.10+; 3.11 recommended (codexqa-defect-analyzer / codexqa-testcase-generator)
node --version      # for CodexQA CLI / other skills
npx --version
git --version
```

`codexqa-defect-analyzer` may install optional SAST tools via `scripts/install_sast_tools.sh` / `ensure_tools.py`. Live graph analysis needs `@openqa-cn/codexqa` on PATH. Packaging tests for other skills may still require Bash, rsync, zip, and unzip. See [data and network behavior](FAQ.md).

## Install from GitHub

```bash
npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer
```

Choose an agent interactively. Default scope is the current project. For Codex across projects:

```bash
npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer --agent codex --global
```

Use `--copy` if you prefer copies to agent-directory symlinks. Installation locations are managed by the third-party `skills` installer; use its output to locate the installed skill. Installation does not prove that a complete analysis works on that agent.

## Verify from a local checkout

Before pushing, inspect locally available skills without installing:

```bash
npx skills add . --list
```

To install this checkout, run from the repository root:

```bash
npx skills add . --skill codexqa-defect-analyzer --agent codex --copy
```

For a CLI-only smoke check, no model or private platform is needed:

```bash
python3 skills/codexqa-defect-analyzer/scripts/run_scan.py --help
(cd skills/codexqa-defect-analyzer && npm test)
```

`npm test` runs the Python pipeline and policy-fixture suites (prefers Python 3.11). It does not run a live agent Stage1/Stage2 scan. [Run the boundary-case example](../examples/checkout-boundary/README.md) for a known-good and seeded-defect pair (fixture verification only).

## Start the agent workflow

Open a new session after installation. Provide a local repo path, PR/diff intent, upload, or paste. Example request:

> Use codexqa-defect-analyzer to scan my repository at /abs/path/to/repo for this PR. Run Agent LLM Detection (Stage1/Stage2) and return `report_scan.json` findings ordered P0–P3.

Expect deterministic collect + agent handoff, then `report_scan.json` / `.md` / `.html`. Inspect `tooling_status.missing` when scanners are absent. Keep findings under human review.

## Update and remove

Use the third-party installer's help to inspect its current options:

```bash
npx skills --help
npx skills list
npx skills update
npx skills remove codexqa-defect-analyzer --agent codex
```

For global installations add `--global` where supported. Back up configuration and task data before updating or removing an installed directory. The default skill stores data inside its installation; updates must not be used as a backup mechanism.

## Other published skills

```bash
npx skills add openqa-cn/codexqa --skill codexqa-code-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-code-wiki
npm install -g @openqa-cn/codexqa

npx skills add openqa-cn/codexqa --skill codexqa-skill-router
npx skills add openqa-cn/codexqa --skill codexqa-rootcause-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-code-reviewer
npx skills add openqa-cn/codexqa --skill codexqa-requirement-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-testcase-generator
npx skills add openqa-cn/codexqa --skill codexqa-testdata-generator
```

The `codexqa-code-analyzer`, `codexqa-code-wiki`, `codexqa-rootcause-analyzer`, `codexqa-defect-analyzer`, and `codexqa-skill-router` Skills are published in this repository. `@openqa-cn/codexqa` is the separately distributed, closed-source local code-analysis engine; indexes and sessions live under `~/.codexqa/`. See [`codexqa-code-analyzer` known limitations](../skills/codexqa-code-analyzer/KNOWN_LIMITATIONS.md), [`codexqa-code-wiki` known limitations](../skills/codexqa-code-wiki/KNOWN_LIMITATIONS.md), [`codexqa-rootcause-analyzer` known limitations](../skills/codexqa-rootcause-analyzer/KNOWN_LIMITATIONS.md), [`codexqa-defect-analyzer` known limitations](../skills/codexqa-defect-analyzer/KNOWN_LIMITATIONS.md), and [`codexqa-skill-router` known limitations](../skills/codexqa-skill-router/KNOWN_LIMITATIONS.md).

For a model-free `codexqa-code-analyzer` / `codexqa-code-wiki` smoke check, index a local checkout and inspect its summary:

```bash
codexqa --help
codexqa index /path/to/repo
codexqa stats /path/to/repo
codexqa wiki inputs /path/to/repo --kind architecture --limit 8
```

`--help` should list the CLI commands. A successful `stats` call should report indexed files, symbols, and languages. For change review, rebuild the index with `--diff-base <ref>`; without a diff base, changed symbols remain `default` and there is no change set to review. `wiki inputs` should print community / digest JSON without calling a model.

After install, start a new agent session and point it at the skill. Inputs differ:

- `codexqa-skill-router` needs a user request to route (and Python 3.10+). It matches the bundled/live catalog and can run `ensure_skill.py` to fetch a worker beside the router. See its [README](../skills/codexqa-skill-router/README.md).
- `codexqa-code-analyzer` needs a local repository. For change review, index it with a baseline such as `origin/main`; indexes live under `~/.codexqa/`. See its [README](../skills/codexqa-code-analyzer/README.md).
- `codexqa-code-wiki` needs a local repository and an existing index. It exports `wiki inputs` and writes an HTML architecture report; it does not review a change. See its [README](../skills/codexqa-code-wiki/README.md).
- `codexqa-rootcause-analyzer` needs exception evidence (stack / log / dump) plus a git URL, local dir, file, or already-open workspace. See its [README](../skills/codexqa-rootcause-analyzer/README.md).
- `codexqa-defect-analyzer` needs a diff, repo, upload, or paste for a code-risk scan. See its [README](../skills/codexqa-defect-analyzer/README.md).
- `codexqa-code-reviewer` needs a local checkout, `codexqa` + `jq` on PATH, and (for PR mode) `--diff-base`. See [codexqa-code-reviewer README](../skills/codexqa-code-reviewer/README.md).
- `codexqa-requirement-analyzer` needs requirement documents, not a repo. See [What you give it](../skills/codexqa-requirement-analyzer/README.md#what-you-give-it).
- `codexqa-testcase-generator` needs local requirement materials (file, directory, paste, or HTTPS document URL this turn). Optional knowledge dir / Git URL. After Exec, expect Markdown under `testcase/cases/` plus `testdesign/testcase_generation_report.html`. Smoke: `./scripts/tcg-python scripts/close_stage.py --self-check` (and `check_run_gate.py` / `generate_case_report.py --self-check`) from the skill directory. See its [README](../skills/codexqa-testcase-generator/README.md).
- `codexqa-testdata-generator` needs a construct request, cases, or an API source — not application source. See [What you give it](../skills/codexqa-testdata-generator/README.md#what-you-give-it).

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
| `codexqa` command not found or graph query is empty | Install `@openqa-cn/codexqa`, check PATH, confirm the repository was indexed, and use `--diff-base` for change review. For `codexqa-code-wiki`, run `wiki inputs` (not `wiki` without `--no-llm`) |
| Local report link does not open | Open the returned HTML file in a browser |

For support include the commit, Node version, OS, agent/version, command, and sanitized error. Do not upload source or task directories containing private data.
