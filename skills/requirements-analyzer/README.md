# Requirements Analyzer

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

Quality-and-risk analysis of **requirement documents**. It audits sources, finds gaps and conflicts, and writes one register with executable P0 / P1 verification.

It is **not** [`testcase-generation`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/testcase-generation/README.md). That skill writes a manual case library from `prd/`. This skill reviews whether the requirements themselves are complete, consistent, and testable.

## What you give it

**Documents, not a git clone.**

| Job | Bring |
|---|---|
| Analyze one PRD | The requirement text (file, paste, or URL the agent can fetch) |
| Multi-source pack | PRD plus stories / API notes / scope / plan. Optional role reports with `source_role` |
| Incomplete pack | Whatever you have. The run still ships a first draft and marks gaps |

No application `code/`. No clone URL. Do not ask this skill to invent endpoints, SLAs, or whether the feature is worth building.

## What it does

1. Intake and a short-input gate.
2. Structure inventory, source audit, smells, NFR and success-metrics grids.
3. One gap / conflict register (`RA-xx`) with risk and testability.
4. P0 / P1 items get verification fields (preconditions, stimulus, expected, evidence).

Default output is Markdown. Excel / CSV / JSON / Word only when you ask (`output-formats.md`). Helper scripts live in `scripts/` (`npx --yes tsx scripts/run_analysis.ts --input <file>`).

There is no recorded host-agent score. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

```
requirements-analyzer/
├── SKILL.md                 # agent entry
├── prompts/                 # analysis quality bar (agent)
├── references/              # grids loaded on demand
├── examples/                # generic inventory-hold samples
├── evals/                   # skill-up cases; not a published accuracy score
├── scripts/                 # parse / convert helpers
├── HOW_IT_WORKS.md
└── KNOWN_LIMITATIONS.md
```

## Install

```bash
npx skills add openqa-cn/openqa-skills --skill requirements-analyzer
```

Start a **new** agent session.

## What you can say to the Agent

```text
Analyze these requirement documents with requirements-analyzer.
Produce one gap/conflict register. P0 items must include verification fields.
Do not invent endpoints or SLAs that are not in the source.
```

A two-source conflict (from `quick-start.md`):

```text
Source A (PRD): submit is allowed when stock is insufficient; reserve later.
Source B (API): insufficient stock returns 400 and must not create an order.
Run requirements-analyzer. Mark the conflict; do not pick a winner.
```

## License

Apache-2.0, same as this repository.
