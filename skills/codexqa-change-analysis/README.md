**English** · [简体中文](README.zh-CN.md) · [Known Limitations](KNOWN_LIMITATIONS.md)

# codexqa-change-analysis

Change-impact analysis with CodexQA's **symbol graph and diff indexing**. The input is a git baseline (for example `origin/main`). CodexQA finds and labels the change (`index --diff-base` → `change-groups` / `symbol-diff`). The skill produces two things: an **HTML report** (affected entries, change list, test plan, coverage verdict, sensitive paths) and **new test files** in the analyzed repo that cover the gaps (add only; existing test files are not edited).

> This file is for people. The agent does not load it at runtime. The runtime contract is [SKILL.md](SKILL.md).

Former skill name: `change-impact-analysis`.

## What it answers

| Question | Output |
|---|---|
| Which methods changed? Which were added? | A method list grouped as added / changed / deleted, with `file:line` and what changed |
| Which entries do those changes reach? | Entries: methods with no upstream caller (HTTP route / main / MQ / scheduled task / exported function), plus the hop-by-hop path |
| What should be tested? | A case matrix organized as entry × happy / boundary / error / contract / data |
| Can existing tests be reused? | Named in the test-plan "case file" column (case name + `file:line` + kind). The coverage-verdict section states the conclusion |
| Who writes what is not covered? | **New runnable test files** in the repo (API layer, plus an end-to-end file when needed; add only). After they pass, case counts and results are written back into the report |

## Install

```bash
npx skills add openqa-cn/codexqa --skill codexqa-change-analysis
```

From a local checkout:

```bash
# Common agent skill directories:
#   ~/.agents/skills/
#   ~/.claude/skills/
cp -R codexqa-change-analysis ~/.agents/skills/
```

Requires Node.js >= 18 and the `codexqa` CLI.

```bash
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

Without CodexQA the skill still runs: SKILL.md has a degraded mode (git + grep). The deliverable shape does not change.

## How to trigger it

Tell the agent something like:

- "Analyze this change: which methods were added, and which entries do they hit?"
- "What should this change be tested for? Are there existing cases we can reuse?"
- "Diff against origin/main and write a change-impact report"
- change impact / changed methods / entry points / test plan

## Typical commands

```bash
codexqa index . --diff-base origin/main --full    # --full is required, or change tags go stale
codexqa query --repo . change-groups              # change groups ordered by risk
codexqa query --repo . symbols --change add,change --kind function,method
codexqa query --repo . symbol-diff --id <id>      # the only authority for "what changed"
codexqa query --repo . reach --id <id> --direction in --depth 10   # walk up to entries
codexqa query --repo . reach --id <id> --direction in --edge-kinds tests  # layer-A test recall
```

## Layout

```
codexqa-change-analysis/
├── SKILL.md                           # routing, hard rules, index gate, delivery contract
├── assets/
│   └── report-template.html           # HTML shell (copy, then fill by id; do not restyle)
├── references/
│   ├── analysis.md                    # §1–§5 evidence: list / patch / entries / regression / test plan
│   ├── test-recall.md                 # existing-test recall: layer A tests edges + layer B text
│   ├── report.md                      # HTML fill contract: what each slot says, and which query it comes from
│   └── generate-cases.md              # generated cases: new-file contract, run, and write-back
├── KNOWN_LIMITATIONS.md               # measured limits and how to work around them
└── README.md
```

## Artifacts

Two parts:

```
<repo>/change-impact-<repo-slug>-YYYYMMDD-HHMM.html   # self-contained HTML report
<repo>/<test dir>/change-impact-*                     # new case files: fixed stem, suffix/language
                                                      # follow existing tests (JS is .mjs; Python / Rust / Java use the same idea)
```

The look follows the Claude Code session-report (ivory page, dark terminal, clay accent, JetBrains Mono).
Section order is fixed: **Key findings → Risks and unknowns → Affected entries → Change list → Test plan → Coverage verdict → Sensitive paths**, including one Mermaid entry diagram.
The diagram is rendered to an **inlined static SVG**, so it still shows offline. Fonts still come from Google Fonts and fall back to system fonts; the body does not depend on them.

The report states results only: which methods changed, which APIs or pages can trigger them, what to test, and which existing cases can be reused.
Method and process data never enter the report (no process appendix, no confidence statement). They stay in the analysis.

## Three rules that matter most

1. **`--diff-base` must be paired with `--full`.** An incremental index does not refresh change tags. Changing the base without a full re-index returns the previous conclusion.
2. **`to_count == 0` is not an entry.** Cross-file call edges can be missing in dynamic-language repos. Cross-check with `grep` / `imports`.
3. **`tested_count == 0` is not "no tests".** Some languages (JS, measured) emit no `tests` edges. Text-recall the test files.

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
