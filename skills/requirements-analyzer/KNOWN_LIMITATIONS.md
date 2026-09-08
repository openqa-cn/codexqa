# Known limitations and failure cases

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is something visible in the files, not a defensive disclaimer. Design context: [How it works](HOW_IT_WORKS.md).

## No published accuracy score

`evals/` lists skill-up prompts (conflict, incomplete input, missing oracle). There is no recorded host-agent run and no answer-key fixture. Passing an eval file does not mean a model will keep one register or refuse to invent an SLA.

## This is not testcase-generation

| | `requirements-analyzer` | `testcase-generation` |
|---|---|---|
| Input | Requirement text (any files you paste) | `prd/` layout (PRD / design / specs) |
| Output | One gap/conflict register + verification fields | Manual cases under `usecases/cases/` |
| Code | Not used | `code/` on update only |

Installing only this skill does not write `{placeholder}` cases and does not run the R1–R4 gates.

## The model can still invent a system

The playbook forbids inventing endpoints and SLAs. Nothing in `scripts/` re-reads the source to reject a fabricated field. Human review of the register is required.

## Helper scripts are format I/O, not the analysis

`scripts/run_analysis.ts` and the parse/convert helpers move text between Markdown / JSON / CSV / Word-ish shapes. They do not score risks or fill the register. Analysis is the host agent following `prompts/requirements-analyzer.md`.

## Incomplete input still produces a draft

A missing plan, KPI, or API note is a marked gap, not a hard stop. The draft can look finished. Read the “assumptions and gaps” lines before treating Status=`aligned` as agreement.
