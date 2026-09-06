# Install and run AI Defect Detection

[简体中文](GETTING_STARTED.zh-CN.md)

## Requirements

Use Node.js, npm/npx, Git, and a coding agent able to read skill files and run commands. The CLI suite has been run locally on macOS with Node 22.15.0 using TypeScript stripping:

```bash
export NODE_OPTIONS=--experimental-strip-types
node --version
git --version
```

Apply this environment setting to the shell that runs the agent's CLI commands. Desktop agents may not inherit an unrelated terminal's environment. If a `.ts` command reports `ERR_UNKNOWN_FILE_EXTENSION`, check that command's Node version and environment. This example replaces any existing `NODE_OPTIONS`; preserve options you need.

Analysis can attempt to install Semgrep (Python/pip or Homebrew) and GitNexus (npm/pnpm). Packaging tests also require Bash, rsync, zip, and unzip. See [data and network behavior](FAQ.md).

## Install from GitHub

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

Choose an agent interactively. Default scope is the current project. For Codex across projects:

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection --agent codex --global
```

Use `--copy` if you prefer copies to agent-directory symlinks. Installation locations are managed by the third-party `skills` installer; use its output to locate the installed skill. Installation does not prove that a complete analysis works on that agent.

## Verify from a local checkout

Before pushing, inspect locally available skills without installing:

```bash
npx skills add . --list
```

To install this checkout, run from the repository root:

```bash
npx skills add . --skill ai-defect-detection --agent codex --copy
```

For a CLI-only smoke check, no model or private platform is needed:

```bash
export NODE_OPTIONS=--experimental-strip-types
node skills/ai-defect-detection/open_detect.ts --help
node --test skills/ai-defect-detection/tests/cli_smoke.test.ts
```

The smoke suite verifies sample-plan loading, task creation, and missing-material handling. The included `acme` repository addresses are sample data; this test does not clone them. [Run the boundary-case example](../examples/checkout-boundary/README.md) for a known-good and seeded-defect pair.

## Start the agent workflow

Open a new session after installation. Provide an accessible repository URL and branch, plus any requirements or test cases you can share. Example request:

> Use ai-defect-detection to review my repository at REPOSITORY_URL, branch BRANCH_NAME. Check the changed implementation against these requirements: REQUIREMENTS. Return suspected defects with code locations, trigger conditions, and supporting evidence.

Replace uppercase placeholders. Expect a task, analysis records, and a report link if the workflow completes. Inspect incomplete services and unavailable tools before accepting the report. Keep suspected findings under human review.

## Update and remove

Use the third-party installer's help to inspect its current options:

```bash
npx skills --help
npx skills list
npx skills update
npx skills remove ai-defect-detection --agent codex
```

For global installations add `--global` where supported. Back up configuration and task data before updating or removing an installed directory. The default skill stores data inside its installation; updates must not be used as a backup mechanism.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Skill not listed from GitHub | The skill must be committed and pushed to the repository being installed |
| Agent does not discover the skill | Selected agent, project/global scope, and whether a new session is required |
| Unknown `.ts` extension | Node runtime and TypeScript stripping environment |
| Missing plan | Provide repository/branch and business materials; degraded loading does not mean sufficient materials |
| Static/call-graph analysis unavailable | Tool installation result, PATH, permissions, and network access |
| Local report link does not open | Open the returned HTML file in a browser |

For support include the commit, Node version, OS, agent/version, command, and sanitized error. Do not upload source or task directories containing private data.
