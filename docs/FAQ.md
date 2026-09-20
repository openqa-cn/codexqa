# codexqa FAQ

[简体中文](FAQ.zh-CN.md)

This page covers installation and the published skills. Most answers below are about `defect-detection`; the others are called out where their contract differs.

## What is codexqa?

codexqa is a public, local-first [Agent Skills](https://agentskills.io/specification) pack for Cursor, Claude Code, Codex, and OpenClaw. AI makes producing code faster; codexqa focuses on the verification work that does not automatically get cheaper: clarifying requirements, understanding change impact, reviewing implementation evidence, designing cases, and preparing test data.

The seven skills cover different parts of the delivery lifecycle. Each has a separate input contract so the agent knows whether it should read documents, index a local checkout, scan for code risk, write cases, call a data backend, or diagnose an exception:

| Skill | Role |
| --- | --- |
| [`code-analyzer`](../skills/code-analyzer/README.md) | Index a local repository, then trace change impact, regression scope, test gaps, entries, and errors through its symbol graph |
| [`root-cause-diagnosis`](../skills/root-cause-diagnosis/README.md) | Exception RCA from stacks/logs on top of the CodexQA CLI; gated English root-cause report |
| [`defect-detection`](../skills/defect-detection/README.md) | SAST/lint/secrets/SCA + agent-inline semantic scan → `report_scan.*` (P0–P3) |
| [`code-reviewer`](../skills/code-reviewer/README.md) | Playbook CR of a local checkout; P0 / P1 / P2 report |
| [`requirements-analyzer`](../skills/requirements-analyzer/README.md) | Quality-and-risk analysis of requirement documents; one gap register |
| [`testcase-generation`](../skills/testcase-generation/README.md) | Generate and update structured manual test cases from PRD / design / specs |
| [`testdata-generation`](../skills/testdata-generation/README.md) | Construct reusable test data and backfill `{placeholder}`s in those cases |

`npx skills add … --skill <name>` copies one directory. Install the skill you need; they do not replace each other. Detection accuracy for `defect-detection` has not been independently benchmarked. `code-analyzer`, `root-cause-diagnosis`, `defect-detection`, `testcase-generation`, `code-reviewer`, and `requirements-analyzer` have no published host-agent score.

What a finished report or case looks like: [sample pages and screenshots](../README.md#what-the-output-looks-like).

## Why not just use a linter or one code-review prompt?

They solve different parts of the problem. Linters and static rules catch suspicious syntax and data-flow shapes. A general review prompt can comment on a diff, but it has no stable input contract or evidence gate. codexqa keeps the model you already use, then adds task-specific context collection, playbooks, symbol-graph queries, structured artifacts, and stop conditions. It is not a test runner or proof of correctness; it makes the verification work more bounded and reviewable.

## Which skill should I install?

Match the request, not the wording:

- Scan a diff / repo / paste for SAST and semantic code-risk findings → `defect-detection`
- Trace changed symbols, callers, regression scope, test gaps, and reachable entries in a local repository → `code-analyzer`
- Diagnose exception root cause from stacks / logs / dumps → `root-cause-diagnosis`
- Broader quality / security / maintainability CR on a local checkout → `code-reviewer`
- Review whether the PRD itself is complete and consistent → `requirements-analyzer`
- Write or update a manual case library → `testcase-generation`
- Build data that fills case `{placeholder}`s → `testdata-generation`

“Review this PR” is not enough to choose: `code-analyzer` maps changed symbols, callers, entries, and test gaps; `defect-detection` runs SAST + agent semantic scan into `report_scan.*`; `code-reviewer` diffs in place and loads review playbooks; `root-cause-diagnosis` needs exception evidence for RCA. A request can span skills: use `code-analyzer` to bound the impact, then `code-reviewer` for concrete P0 / P1 / P2 findings. Generate cases first; placeholders can only be backfilled after the `.md` files exist.

## What do I have to give each skill?

They do not share one input. Two skills take Git, but not the same way:

| Skill | You bring | Not used as input |
|---|---|---|
| `code-analyzer` | A local repository; for change review, the baseline ref | Requirements or a clone task. It indexes the checkout already on disk and queries its symbol graph |
| `root-cause-diagnosis` | Exception evidence (stack / log / dump) plus git URL, local dir, file, or open workspace | A PRD or P0/P1/P2 review request. It diagnoses exceptions, not requirement gaps or playbook CR |
| `defect-detection` | Diff / repo / upload / paste for a code-risk scan | Exception stacks as the primary goal (use `root-cause-diagnosis`) or playbook CR (use `code-reviewer`) |
| `code-reviewer` | A local Git checkout + the branch / PR / commit to review | A clone URL. This skill diffs in place |
| `requirements-analyzer` | Requirement documents (PRD, stories, API notes, optional role reports) | Application source. It does not write cases |
| `testcase-generation` | PRD / technical design / API specs under `prd/` | Application `code/` on generate. `code/` is update-only, to see which cases a change hits — not to invent schemas or data |
| `testdata-generation` | A construct request, written cases, and/or OpenAPI / `planId` / `serviceId` | Application source. It calls a backend (or the local mock) and reports IDs the backend returned |

Sample prompts: [root README · Quick start](../README.md#quick-start).

## Do I need an npm account or a codexqa account?

No. `npx skills add` runs a community installer that fetches skill files from GitHub. Local providers do not require a codexqa account. `code-analyzer`, `root-cause-diagnosis`, and `defect-detection` additionally install the separately distributed npm package `@openqa-cn/codexqa`, but no npm account is required. Your agent or remote providers may have their own account requirements.

## What is the relationship between the code-analyzer Skill and the codexqa CLI?

The `code-analyzer` Skill, playbook, query schemas, and examples are published in this repository. The `@openqa-cn/codexqa` npm package is a separately distributed, closed-source local code-analysis engine. The Skill tells the agent when to invoke it, which graph evidence to collect, and how to report the result.

Indexing and graph queries run on the user's machine and do not require an LLM. Indexes and sessions are stored under `~/.codexqa/`. The engine is not installed or executed by this repository's CI; see the [`code-analyzer` known limitations](../skills/code-analyzer/KNOWN_LIMITATIONS.md) and [support matrix](SUPPORT_MATRIX.md) for the current verification status.

## Does installing a skill run the workflow?

No. Installation makes the files available to the agent. You still start a session and give it a clone URL, a local checkout, a PRD, or a data-construction request. Scripts store and validate artifacts; they do not supply a model.

## Does code stay on my machine?

Local providers persist results on disk, but that is not a guarantee of offline execution. The host agent/model controls how source context is processed. Configured HTTP providers can send business material and findings to external services. GitHub issue integration can create external records.

Repository cloning and fetching public documents can also use the network. Current analysis commands may attempt to install Semgrep via pip/Homebrew and GitNexus globally via npm/pnpm. Review configuration and host permissions before analyzing confidential repositories.

## Where are defect-detection reports and configuration stored?

`defect-detection` writes reports to the `-o` directory (default `/tmp/aid_report/`) and optional feedback under the skill `data/` directory. See its [README](../skills/defect-detection/README.md). Keep runtime data and private configuration outside version control and back them up before upgrading.

`testcase-generation` writes under the workspace `usecases/` and optional `{workspace}/.ai-testcase/`. `testdata-generation` writes under the workspace `testdata/` (see that skill's README). `code-analyzer` stores local indexes under `~/.codexqa/`; indexing and graph queries do not require an LLM. `root-cause-diagnosis` stores task data under its skill `data/` directory and also uses the CodexQA CLI indexes.

## Is defect-detection a replacement for static analysis or testing?

It combines static-analysis integration with agent-led review. It does not replace test execution or establish the absence of defects. Structure/coverage gates validate records, not semantic correctness. AI candidates require human review.

## What languages and agents are supported?

The instructions mention Codex, Claude Code, Cursor, and OpenClaw. Installation compatibility, runtime tests, and complete agent validation are different claims. See the [support matrix](SUPPORT_MATRIX.md) for what has actually been checked. Java receives method/call-graph-oriented handling; other language behavior depends on the relevant extraction and scan paths.

## Is detection accuracy measured?

Not yet on a published agent benchmark. The regression suite validates CLI and workflow behaviors. The boundary example demonstrates a deterministic defect, not AI detection accuracy or a false-positive rate.

## What does the output look like?

Sample pages (same renderers, canned findings): [README · What the output looks like](../README.md#what-the-output-looks-like). HTML and PNGs live in `docs/assets/previews/`.

## Does testcase-generation fill test data?

No. Cases keep `{placeholder}` markers and an empty `Construction` column. Backfill is `testdata-generation`. Installing only `testcase-generation` yields a design library, not a script against a live backend.
