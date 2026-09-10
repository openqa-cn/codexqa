# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Limits observed in use or verified in this skill’s files. Data flow: [How it works](HOW_IT_WORKS.md).

## No public eval

No fixture, no answer key, no recorded end-to-end run. The `defect-detection` blind fixture does not apply here.

Unmeasured:

- Case coverage of a requirement (no recall metric)
- R1–R4 detection rate on the failures they target
- Lift over “ask the model for cases”
- Cross-model stability

Quality is human review of outputs.

## Instruction size

`generate-skill.md` is ~200 lines (orchestrator). Each `phase-*.md` is 70–230 lines. `subagent-gen-duty.md` is ~50 lines. A generate run still loads `case-authoring-rules.md` (~650 lines) plus at least one gate. `update-skill.md` is ~590 lines.

- `case-authoring-rules.md` still enters the Phase 3 subagent context in full. If expansion is skipped or `caseType` is wrong, start there.
- Phase numbers, duty text, and the file index have no automated cross-check. Edits need a manual pass.

## Subagents

Phase 2: up to 3 parallel subagents. Phase 3: one per `design.md` module. R1–R4 each use a separate subagent.

Hosts without subagents can run the sequence serially; that path is untested. Gates sharing the author agent lose independent review.

## No mechanical semantic check

`lint_case_documents.ts` covers structure only: headers, empty `Construction`, placeholders, headings, engineering-table columns. The model still judges:

- whether steps are executable
- whether expected values are concrete (not “success”)
- whether `coverage[]` landed in the case body
- whether `analysis.md` extracted the rules

Update matching is the same: a missed semantic hit leaves a stale case.

## `prd/` is not auto-synced

`prd/` is a git-baselined snapshot. Update diffs disk only.

- Edit only on a hosted doc platform, no local overwrite → “no changes”
- Docs added to `context.json` after generate with no baseline file → skipped; re-run generate to create a baseline

Enterprise HTTP covers spec / knowledge / config / env, not document hosting.

## Test data is out of scope

`{placeholder}` and empty `Construction` are filled by `testdata-generation`. Without that skill the library is a design artifact, not a backend script. See [How it works §4](HOW_IT_WORKS.md#4-placeholders-vs-data-construction).

## No schema inference from code

Tables, cache keys, and config keys absent from the PRD / technical design become `TBD`. `code/` is used for update diffs only. A thin PRD yields many `TBD`s.

## Runtime

- POSIX `sh`; no `jq` / `uuidgen` / bash-4 associative arrays. Windows untested. [SUPPORT_MATRIX](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md)
- `git` required (`prd/` baseline, `code/` diff). No non-git mode
- Workspace layout: `prd/`, `code/`, `usecases/`. Other layouts untested

## Domain assumptions

Rule docs are English. Examples and expansion heuristics assume order / account / catalog plus HTTP/gRPC and DB/Cache/MQ. Pipelines, embedded, and pure-algorithm work still emit files; coverage directions were not designed for those domains.
