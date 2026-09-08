# Test case generation: data flow and constraints

[简体中文](HOW_IT_WORKS.zh-CN.md)

`testcase-generation` is a host-agent workflow skill. It does not ship a model. Inputs are a workspace PRD / technical design / API contract (optional knowledge files and code under test). Outputs are manual cases at `usecases/cases/{module}/*.md` plus intermediates under `usecases/testdocs/`.

Runtime steps: [`SKILL.md`](SKILL.md). Gaps: [Known limitations](KNOWN_LIMITATIONS.md). Install / zero-config: [README](README.md).

## Problem

Asking a model to “write cases from this PRD” typically fails in three ways. Each has a corresponding constraint:

| Failure | Symptom | Constraint |
| --- | --- | --- |
| Hallucinated engineering fields | Assertions cite tables / columns / cache keys not in the source | Unstated identifiers become `TBD`; no inference |
| Under-generation | A subset of scenarios is emitted as “the case set” | Write `case-registry.json` before any `.md`; every `pending` entry must produce a file |
| No stable identity | Cases are prose; a later PRD change cannot be mapped to files | UUID per case + `business_rules_digest`; updates are diff-driven |

The model does test design. On-disk artifacts, gates, and the linter make the result checkable and resumable.

## Evaluation status

No public fixture, no answer key, no recorded end-to-end run (the `defect-detection` inventory-service 7/7 result does not apply). Coverage, gate recall, and lift over “just ask the model” are unmeasured. Quality is human review of outputs. See [Known limitations](KNOWN_LIMITATIONS.md).

## Interaction

Generate is not a single PRD → cases step. Stops:

| When | Shown | Reply |
| --- | --- | --- |
| `analysis.md` §1.6 present (PRD vs technical design) | Inconsistency table; default follows PRD | `Confirm follow PRD` or `Item N follow technical design` |
| End of Phase 2 (always) | Module / coverage diagram, entity dependency diagram, link to `design.md` | Confirm, or edit `design.md` then confirm |
| All registry entries `status=done` | Mermaid overview by module and `new_feature` / `regression` | Edit cases in chat, or stop |

Case path: `usecases/cases/{module}/`. Format is Markdown for humans, not an automation harness. System-generated keys stay `{placeholder}` with an empty `Construction` column; backfill is [`testdata-generation`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/testdata-generation/README.md). Installing only this skill yields a complete design library, not a script against a live backend.

Update: diff `prd/` (git baseline) and each `code/*` `HEAD` stored in registry `_meta` → write `change-impact-analysis.md` → confirm → patch affected cases only.

## Mechanisms

### 1. Phase artifacts

Required before any case `.md`:

| File | Content |
| --- | --- |
| `analysis.md` | Scope, APIs / engineering fields, call chains, risks; conflicts in §1.6 |
| `design.md` | Per-module verification points, data entities and dependencies |
| `api-details.md` | FQCN, request / response |
| `case-registry.json` | Planned entries: `caseId`, `coverage`, `status` |

Token cost is higher than PRD → cases in one shot. Phase 2 confirmation edits a table, not hundreds of files. Subagents read one module. Resume uses disk state.

### 2. Registry before files

`case-registry.json` is written first. Each entry has a UUID and `pending` or `done`.

- Declared count N; after generation, `cases.length == N` and the number of `.md` files under `usecases/cases/` is N.
- Resume reads disk: no `analysis.md` → Phase 1; any `pending` → Phase 3 Step Two only. Conversation memory is not used.

`caseId` is a UUID, not `TC-001` (parallel writes and mid-run inserts break sequences). File name is `caseName`.

### 3. Engineering identifiers: explicit or `TBD`

Field names come only from `integrations-resolved.json` `profile.components[].fields`, plus Server APIs serviceId / protocol / interface name. Values come only from `analysis.md` §1.3 or source text. Otherwise: `TBD (engineering info missing)`.

Do not invent table or cache-key names. `TBD` means missing source material.

### 4. Placeholders vs data construction

`{placeholder}` marks system-generated IDs. This skill defines data requirements (`design.md` §2). Construction and write-back are `testdata-generation`. Do not fill placeholders with invented values.

### 5. Gates R1–R4

| Gate | Target | When |
| --- | --- | --- |
| R1 | `analysis.md` | After Phase 1 |
| R2 | `design.md` + `api-details.md` | After Phase 2, before confirm |
| R3 | `case-registry.json` | After registry write, before `.md` |
| R4 | Each case `.md` | After write |

Each gate is a separate subagent. The main agent passes the rule-file path and does not paraphrase the rules. R2/R3 catch gaps and duplicates before files exist.

### 6. Structure via script

`generation/quality-gates/lint_case_documents.ts` checks headers, empty `Construction`, placeholder form, heading levels, and engineering-table columns against the `--resolved` profile. Headers are not hard-coded to Redis / KV / Thrift.

R4 is two passes: lint for deterministic rules; semantics (executable steps, concrete expected values) stay in `gate-case-quality.md`.

### 7. Updates: baseline diff

On generate complete: `git -C prd/ commit` is the PRD baseline; each `code/*` `HEAD` is stored in `_meta.last_code_commits`.

Update diffs that baseline. Match:

- Searchable old values (version, error code, API name) → `grep` `usecases/cases/`
- Rule changes with no stable token → compare to `business_rules_digest` in the registry

Each change point is scored independently for “edit existing” and “needs new case”. `prd/` is not auto-fetched; only overwritten local files count. A hosted-doc edit with no local overwrite yields an empty diff. See [Known limitations](KNOWN_LIMITATIONS.md).

## Pipeline

The agent reads `generation/generate-skill.md`, then one `phase-*.md` from the resume table.

```text
Generate
  Phase 0   validate_integrations.ts          integrations-resolved.json
            git init prd/                     prd/.git, registry._meta
  Phase 1   analysis + R1                     analysis.md
            knowledge recall (optional)       changed-interface-knowledge.json
            stop if §1.6
  Phase 2   design + spec lookup + R2         design.md, api-details.md
            confirm (required)
  Phase 3   case design + R3                  case-registry.json (pending)
            parallel gen + lint + R4          usecases/cases/{module}/*.md (done)
            overview
            optional testdata-generation

Update
  Phase 0   overwrite prd/ + code git diff
  Phase 1   change points                     PRD text/semantic, code search_key
  Phase 2   hit existing cases                grep + digest
  Phase 3   incremental design                change-impact-analysis.md
            confirm (required)
  Phase 4   parallel update / gen             affected .md + registry
            testdata-generation if reconstruct
```

`analysis.md`, `design.md`, and `case-registry.json` are separate files so resume does not replay Phase 1. Cursor is `pending` / `done`.

## Runtime

Reasoning is the host agent (Cursor / Claude Code / Codex / OpenClaw). Instructions live in `SKILL.md`, `generation/`, `maintenance/`, loaded per phase. Case quality tracks the model. Registry count checks, lint, and the `TBD` rule do not.

## Related

| Topic | Path |
| --- | --- |
| Install / zero-config | [README](README.md) |
| Uncovered behavior | [Known limitations](KNOWN_LIMITATIONS.md) |
| Agent entry | [`SKILL.md`](SKILL.md) |
| Generate orchestrator | `generation/generate-skill.md` |
| Update flow | `maintenance/update-skill.md` |
| HTTP adapter contract | [`integration-api.md`](references/integration-api.md) |
| Repo runtime matrix | [SUPPORT_MATRIX](https://github.com/openqa-cn/openqa-skills/blob/main/docs/SUPPORT_MATRIX.md) |
| Doc placement | [ARCHITECTURE](https://github.com/openqa-cn/openqa-skills/blob/main/docs/ARCHITECTURE.md) |
