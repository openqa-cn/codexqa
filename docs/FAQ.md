# OpenQA Skills FAQ

[简体中文](FAQ.zh-CN.md)

This page covers installation and the published skills. Most answers below are about `defect-detection`; the others are called out where their contract differs.

## What is OpenQA Skills?

OpenQA Skills is a public, local-first skill layer for coding agents. The repository currently ships five skills:

| Skill | Role |
| --- | --- |
| [`defect-detection`](../skills/defect-detection/README.md) | Clone a git branch / PR / test plan and write gated findings |
| [`code-reviewer`](../skills/code-reviewer/README.md) | Playbook CR of a local checkout; P0 / P1 / P2 report |
| [`requirements-analyzer`](../skills/requirements-analyzer/README.md) | Quality-and-risk analysis of requirement documents; one gap register |
| [`testcase-generation`](../skills/testcase-generation/README.md) | Generate and update structured manual test cases from PRD / design / specs |
| [`testdata-generation`](../skills/testdata-generation/README.md) | Construct reusable test data and backfill `{placeholder}`s in those cases |

`npx skills add … --skill <name>` copies one directory. Install the skill you need; they do not replace each other. Detection accuracy for `defect-detection` has not been independently benchmarked. `testcase-generation`, `code-reviewer`, and `requirements-analyzer` have no published host-agent score.

## Which skill should I install?

Match the request, not the wording:

- Find requirement / business-logic defects with write-back gates → `defect-detection`
- Broader quality / security / maintainability CR on a local checkout → `code-reviewer`
- Review whether the PRD itself is complete and consistent → `requirements-analyzer`
- Write or update a manual case library → `testcase-generation`
- Build data that fills case `{placeholder}`s → `testdata-generation`

“Review this PR” is not enough to choose: `defect-detection` clones a URL and gates findings; `code-reviewer` diffs in place and loads playbooks. A request can also span two skills. Generate cases first; placeholders can only be backfilled after the `.md` files exist.

## What do I have to give each skill?

They do not share one input. Two skills take Git, but not the same way:

| Skill | You bring | Not used as input |
|---|---|---|
| `defect-detection` | Git URL + branch (plus requirements or test cases if you have them) | — |
| `code-reviewer` | A local Git checkout + the branch / PR / commit to review | A clone URL. This skill diffs in place |
| `requirements-analyzer` | Requirement documents (PRD, stories, API notes, optional role reports) | Application source. It does not write cases |
| `testcase-generation` | PRD / technical design / API specs under `prd/` | Application `code/` on generate. `code/` is update-only, to see which cases a change hits — not to invent schemas or data |
| `testdata-generation` | A construct request, written cases, and/or OpenAPI / `planId` / `serviceId` | Application source. It calls a backend (or the local mock) and reports IDs the backend returned |

Sample prompts: [root README · Quick start](../README.md#quick-start).

## Do I need an npm account or an OpenQA account?

No. `npx skills add` runs a community installer that fetches skill files from GitHub. Local providers do not require an OpenQA account. Your agent or remote providers may have their own account requirements.

## Does installing a skill run the workflow?

No. Installation makes the files available to the agent. You still start a session and give it a clone URL, a local checkout, a PRD, or a data-construction request. Scripts store and validate artifacts; they do not supply a model.

## Does code stay on my machine?

Local providers persist results on disk, but that is not a guarantee of offline execution. The host agent/model controls how source context is processed. Configured HTTP providers can send business material and findings to external services. GitHub issue integration can create external records.

Repository cloning and fetching public documents can also use the network. Current analysis commands may attempt to install Semgrep via pip/Homebrew and GitNexus globally via npm/pnpm. Review configuration and host permissions before analyzing confidential repositories.

## Where are defect-detection reports and configuration stored?

Defaults include `data/` under the skill installation and local `enterprise/` inputs. Runtime overrides include `DETECTION_DATA_DIR`, `CONTENT_JSON_BASE`, and `DETECTION_ENTERPRISE_DIR`; consult the [operator manual](../skills/defect-detection/references/operator-manual.md) and [adapter guide](../skills/defect-detection/references/api/adapters.md). Keep runtime data and private configuration outside version control and back them up before upgrading.

`testcase-generation` writes under the workspace `usecases/` and optional `{workspace}/.ai-testcase/`. `testdata-generation` writes under the workspace `testdata/` (see that skill's README).

## Is defect-detection a replacement for static analysis or testing?

It combines static-analysis integration with agent-led review. It does not replace test execution or establish the absence of defects. Structure/coverage gates validate records, not semantic correctness. AI candidates require human review.

## What languages and agents are supported?

The instructions mention Codex, Claude Code, Cursor, and OpenClaw. Installation compatibility, runtime tests, and complete agent validation are different claims. See the [support matrix](SUPPORT_MATRIX.md) for what has actually been checked. Java receives method/call-graph-oriented handling; other language behavior depends on the relevant extraction and scan paths.

## Is detection accuracy measured?

Not yet on a published agent benchmark. The regression suite validates CLI and workflow behaviors. The boundary example demonstrates a deterministic defect, not AI detection accuracy or a false-positive rate.

## Does testcase-generation fill test data?

No. Cases keep `{placeholder}` markers and an empty `Construction` column. Backfill is `testdata-generation`. Installing only `testcase-generation` yields a design library, not a script against a live backend.
