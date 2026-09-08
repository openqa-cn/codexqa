# Code Reviewer

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

Playbook-driven code review of a **local Git checkout**: current branch, a PR, or a commit. It writes a P0 / P1 / P2 report with file locations, rule citations, runtime impact, and suggested fixes.

It is **not** [`defect-detection`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/defect-detection/README.md). That skill clones a remote URL, extracts changed methods, runs AST / optional call-graph analysis, and gates write-backs. This skill diffs in place and loads frontend / backend playbooks.

## What you give it

**A Git repository already on disk**, plus the change to review:

| Job | Bring |
|---|---|
| Review this branch / PR / commit | Open the repo in the agent. Name the base branch if it is not `main` / `master` |
| Repo-specific Git links, layers, HTTP integrations | `code-reviewer.config.json` in the **reviewed** repo (copy from `config/code-reviewer.config.example.json`) |

No Git URL for this skill to clone. No PRD, and no application `code/` tree as a separate input. Pasted snippets without a Git repo are out of scope.

## What it does

1. Detects a frontend, backend, or mixed surface from the diff.
2. Loads only the matching playbooks under `playbook/`.
3. Runs optional local helpers (`tooling/`) when Node can execute them.
4. Emits a findings report (`report-formats/findings-report.md`).

Default HTTP integrations are off. A successful report is a candidate for a human reviewer, not a merge gate. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

```
code-reviewer/                 # install folder (same as the source directory)
├── SKILL.md                   # platform entry; loads the playbook
├── review-playbook.md         # review algorithm (agent)
├── HOW_IT_WORKS.md            # why (humans; not loaded by the agent)
├── HOW_IT_WORKS.zh-CN.md
├── KNOWN_LIMITATIONS.md
├── KNOWN_LIMITATIONS.zh-CN.md
├── README.zh-CN.md
├── config/                    # schema + example for the reviewed repo
├── playbook/                  # rules loaded on demand
├── tooling/                   # optional TypeScript helpers (compiled .js)
├── report-formats/
└── examples/
```

## Install

```bash
npx skills add openqa-cn/openqa-skills --skill code-reviewer
```

Or unpack a zip whose root is `code-reviewer/SKILL.md` into `~/.cursor/skills/` (or the host's project skill directory). Start a **new** agent session.

## What you can say to the Agent

```text
Review the current branch with code-reviewer against main.
For each finding give severity, file:line, the rule, the runtime impact, and a fix.
```

```text
CR this PR with code-reviewer. Use the local checkout; do not clone.
```

## Optional helpers

```bash
cd tooling && npm install && npm run build && npm test && cd -
node tooling/load-config.js
node tooling/run-local-checks.js
node tooling/pack-skill.js
```

Edit `tooling/*.ts` only; rebuild before committing the matching `.js`.

## License

MIT. See [LICENSE](LICENSE). The OpenQA Skills repository is Apache-2.0; this skill keeps the upstream MIT license.
