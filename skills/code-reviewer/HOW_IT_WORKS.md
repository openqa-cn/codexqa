# Code review: principles

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`code-reviewer`](README.md) does not ship a model. It is a playbook the host agent follows: detect the review surface from a local Git diff, load matching rules, optionally run `tooling/` scripts, and write a P0 / P1 / P2 report.

**Input is a local checkout, not a clone URL.** Open the repository in the agent and name the branch / PR / commit. The skill does not fetch a remote the way [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.md) does. See [README — What you give it](README.md#what-you-give-it).

Agents read [`SKILL.md`](SKILL.md) then [`review-playbook.md`](review-playbook.md), not this page. Gaps: [Known limitations](KNOWN_LIMITATIONS.md). Sample report: [preview](https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/cr-findings.html).

## Problem

Asking a model to “review this PR” typically fails in three ways:

| Failure | Symptom | Constraint |
|---|---|---|
| Style nits as findings | The report is a list of preferences with no runtime cost | Every finding needs a concrete runtime consequence; no “consider refactoring” |
| Invented locations | A line number that was never read | P0 requires location + consequence + rule citation; skip optional tooling rather than block |
| One playbook for every file | Frontend rules on a Java service, or the reverse | Detect frontend / backend / mixed from the diff; load only matching `playbook/` files |

The model judges. The playbook decides which rules apply and what a valid finding looks like. Persist and HTTP stay optional.

## Evaluation status

No public fixture, no answer key, no recorded number comparable to the defect-detection inventory-service 7/7. `tooling/` has offline contract checks. Treat a finished report as the intended design, not as a measured false-positive rate. See [Known limitations](KNOWN_LIMITATIONS.md).

## What you will see

| When | Shown | Your reply |
|---|---|---|
| Config missing | Built-in defaults (`main` then `master`; HTTP off) | Optional: add `code-reviewer.config.json` to the reviewed repo |
| A `tooling/` script cannot run | A warning in the report; review continues | Authorize the command, or ignore |
| Diff is large | Grouped, two-phase, or multi-agent mode | Let it finish, or name a smaller commit range |
| Review finished | P0 / P1 / P2 findings with location, rule, impact, fix | Human confirm or dismiss |

## Mechanisms

### 1. Diff first, then playbooks

The change set chooses the surface. Always-on rules (`project-conventions`, `design-quality-rules`) plus file-type and content-triggered playbooks. Unused languages are not loaded.

### 2. Findings are not write-backs

There is no task store, no 23-rule write-back validator, and no HTML platform report. Output is the findings report. Requirement-vs-code defect hunting with gates is [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.md).

### 3. External systems are config-only

`tooling/load-config.js` is the only source for Git browse URLs, layer paths, and HTTP integrations. No config or `enabled: false` → skip and leave a trace. Do not invent hosts.

### 4. Size switches mode

| Diff lines | Mode |
|---|---|
| ≤ 200 | Standard |
| 200–600 | Grouped by file type |
| 600–3000 | Two-phase |
| > 3000 | Multi-agent with a shared rule snapshot |

## Pipeline

```text
Local git checkout + branch / PR / commit
        │
        ▼
  load-config (defaults if missing)
        │
        ▼
  Produce diff against base
        │
        ▼
  Detect surface → load matching playbooks
        │
        ▼
  Optional tooling (progress, security, deps)
        │
        ▼
  Deep review (mode by diff size)
        │
        ▼
  Verification filter → findings report
```

## Further reading

| Topic | Doc |
|---|---|
| What to bring, install, prompts | [README](README.md) |
| Observed failures and boundaries | [Known limitations](KNOWN_LIMITATIONS.md) |
| Agent entry | [`SKILL.md`](SKILL.md) |
| Review algorithm | [`review-playbook.md`](review-playbook.md) |
| Repo config | [`config/README.md`](config/README.md) |
| What each published skill takes | [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md) |
