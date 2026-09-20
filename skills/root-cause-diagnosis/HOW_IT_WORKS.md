# How Root Cause Diagnosis works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`root-cause-diagnosis`](README.md) is scaffolding for a host agent: exception evidence and a business codebase go in; an English root-cause report comes out. The skill does not embed a model and does not vendor CodexQA source. Structured facts come from the CodexQA CLI; the model fills narrative inside fixed headings; TypeScript gates the draft before it becomes `report.md`.

The runtime contract is in [`SKILL.md`](SKILL.md).

## Data flow

```text
exception evidence + git / dir / file
        │
        ▼
   diagnose.ts run
        │
        ├─ parse exception → parsed.json
        ├─ materialize / resolve repo under data/<taskId>/
        ├─ CodexQA CLI: index / query (binary only)
        └─ frame analysis → brief.json + facts.json
                │
                ▼
        report.draft.md  (headings + facts; no RCA prose from TS)
                │
                ▼
        model fills draft  (narrative only, cite facts)
                │
                ▼
        write-report --from-draft  (heading + storyGaps gates)
                │
                ▼
        report.md / report.en.md  (English)
```

1. **Exception in** — stack, log, call-chain dump, or debug text, plus `--git`/`--branch`, `--dir`, `--file`, or the already-open workspace.
2. **`run`** — one process: submit task, ensure CodexQA index, analyze frames. Writes `brief.json`, `facts.json`, and a heading-only `report.draft.md`. Does **not** author `report.md`.
3. **Model fill** — narrative inside the eight required `##` headings, using only cited facts. Do not paste `facts.json` as the report.
4. **`write-report`** — rejects missing headings and mechanical `storyGaps` (confidence line, branch/throw/race markers, etc.). Does not reject on section length.
5. **Chat out** — one English paragraph from `chat.en` plus paths to the report files.

## What TypeScript owns vs the model

| Layer | Owns |
|---|---|
| TypeScript (`draft-report`, parse, ensure-codexqa, analyze) | Extracted facts, brief, first-level headings, mechanical gap detection |
| Model | Causal narrative inside those headings for *this* business domain |
| TypeScript (`write-report`) | Heading and story-gap gates before the report is accepted |

Do not put exception-class fix wording into TypeScript draft helpers. Mechanical defects stay in scripts and tests; whether a causal sentence is *true* stays with the model.

## Relationship to `code-analyzer`

`code-analyzer` answers structure and impact from the same CodexQA graph (what changed, who calls it, test gaps). This skill sits **on top of** CLI analysis for **exception RCA**: trigger vs root vs contributors, mapped call path, and a gated English report. It talks to the `codexqa` binary only; it does not copy engine or skill source.

## Evidence status

Local CLI tests cover parse, materialize, draft, and smoke paths. There is no published host-agent score and no public answer-key fixture comparable to defect-detection's inventory-service run. See [Known limitations](KNOWN_LIMITATIONS.md).
