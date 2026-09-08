---
name: testcase-generation
description: >-
  Turns a PRD, technical design, API spec, or knowledge base into a reviewable
  library of structured manual test cases. Every case gets a stable UUID, a
  business-semantic name, and engineering info (interface name, request
  parameters, DB / cache / MQ assertions), behind requirement, design, and
  coverage review gates. Also maintains that library: it diffs the PRD and the
  code under test against the last baseline and updates only the affected
  cases. Use this whenever the user wants test cases written, a case library
  initialized, coverage designed, cases refreshed after a PRD or code change,
  or an interrupted run resumed from pending entries — including Chinese
  phrasings such as 生成测试用例, 写用例, 用例设计, 用例库, 根据 PRD 出用例,
  补充测试场景, 用例更新, and requests that never say "test case", like asking
  which scenarios a requirement needs covered. Not for unit-test or automation
  code, not for building the data that fills case placeholders (use
  testdata-generation), not for reviewing requirement quality or writing a gap
  register (use requirements-analyzer), and not for reviewing code for defects
  (use defect-detection).
license: Apache-2.0
compatibility: >-
  Requires Node.js 22.6+ and git on PATH; scripts run with
  --experimental-strip-types --experimental-default-type=module and need no npm
  install. Shell snippets are POSIX sh and deliberately avoid jq, uuidgen, and
  bash-4 associative arrays. Zero-config mode reads only local prd/ and
  knowledge/ files with no outbound HTTP; enterprise spec, knowledge, config,
  and environment lookups are opt-in HTTP adapters configured in the workspace
  integrations.yaml with secrets kept in environment variables.
---

# Test Case Generation

## Capability routing

| Capability | Trigger | Output | Details |
|------------|---------|--------|---------|
| **Generate cases** | PRD / technical design / spec / code available; first-time case library | Complete case set with unique IDs and engineering info | `generation/generate-skill.md` |
| **Update cases** | PRD / technical design / code changed | Updated cases | `maintenance/update-skill.md` |

Identify the capability, then Read the corresponding document and follow it. Do not expand execution details in this file. Generate loads `generation/generate-skill.md` first — that file is an orchestrator; it tells you which single phase file to open next. Do not open every `generation/phase-*.md` up front.

## Documents (load on demand)

Human-facing docs are not needed by the agent.

| File | Load when |
|---|---|
| `SKILL.md` (this file) | always: routing, hand-off, scripts |
| `generation/generate-skill.md` | generate capability: overview, global rules, resume table, checklist |
| `generation/phase-0-init.md` … `phase-3-cases.md` | only the current generate phase (see the resume table) |
| `generation/subagent-gen-duty.md` | dispatching a case-generation subagent; quote it verbatim |
| `maintenance/update-skill.md` | update capability |
| `README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md` (and their `.zh-CN.md`) | human-facing; not needed by the agent |

User confirmation phrases used in the generate flow:

- `Confirm follow PRD`
- `Item N follow technical design`

## Conflict handling

- Both generate and update mentioned → ask which one to run
- Intent unclear → ask once with the two options above

## Hand off instead of running this skill

This skill designs and writes cases. Three neighbouring jobs look similar in
phrasing but have a different owner, and taking them on here produces work the
other tool would have to redo:

| Request | Owner | Why not here |
|---|---|---|
| Build the data that fills case `{placeholder}`s; prepare preconditions or case materials | `testdata-generation` | Cases ship with placeholders on purpose; that skill talks to real backends and backfills them |
| Write unit tests, automation scripts, or a framework harness | Write the code directly | Output here is human-executable Markdown cases, not runnable test code |
| Find defects in a branch, PR, or test plan | `defect-detection` | That skill reviews code; this one never reads code for correctness, only for engineering identifiers |

A request may legitimately span two of these — "generate cases for this PRD and
prepare their data" is generate here, then hand the finished `caseId` list to
`testdata-generation`. Run this skill to completion first: placeholders can only
be backfilled once the cases exist.

## Scripts

All three are plain Node with no npm install, and they exist so the agent does
not have to do deterministic work by eye:

| Script | Use |
|---|---|
| `scripts/validate_integrations.ts` | Phase 0 of both flows: validates config and writes `integrations-resolved.json` |
| `scripts/call_integration.ts` | The only sanctioned path for spec / knowledge / config / environment lookups |
| `generation/quality-gates/lint_case_documents.ts` | Deterministic R4 structure checks on generated case `.md`; run it before judging structure by reading |

## External systems

Runtime and Node flags are in `compatibility` above. Zero-config reads `prd/` and `knowledge/` only (no outbound HTTP). Enterprise HTTP: copy `config/integrations.example.yaml` to `{workspace}/.ai-testcase/integrations.yaml`; secrets only as `${ENV_VAR}`. Contract: `references/integration-api.md`. Calls go through `scripts/call_integration.ts` only.
