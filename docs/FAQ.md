# codexqa FAQ

[简体中文](FAQ.zh-CN.md)

This page covers installation and the published skills. Most answers below are about `defect-detection`; the others are called out where their contract differs.

## What is codexqa?

codexqa is a public, local-first [Agent Skills](https://agentskills.io/specification) pack for Cursor, Claude Code, Codex, and OpenClaw. AI makes producing code faster; codexqa focuses on the verification work that does not automatically get cheaper: clarifying requirements, understanding change impact, reviewing implementation evidence, designing cases, and preparing test data.

The eight worker skills cover different parts of the delivery lifecycle, plus [`skill-router`](../skills/skill-router/README.md) as the auto-select entry when the request does not name a skill. Each worker has a separate input contract so the agent knows whether it should read documents, index a local checkout, scan for code risk, write cases, call a data backend, diagnose an exception, collect a CodexQA review pack, or export an architecture wiki:

| Skill | Role |
| --- | --- |
| [`skill-router`](../skills/skill-router/README.md) | Discover live siblings + bundled catalog; on-demand install; hand off to the matched skill |
| [`code-analyzer`](../skills/code-analyzer/README.md) | Index a local repository, then trace change impact, regression scope, test gaps, entries, and errors through its symbol graph |
| [`code-wiki`](../skills/code-wiki/README.md) | Index a local repository, export community digests with `wiki inputs` (no model), and write an architecture knowledge-graph HTML report |
| [`root-cause-diagnosis`](../skills/root-cause-diagnosis/README.md) | Exception RCA from stacks/logs on top of the CodexQA CLI; gated English root-cause report |
| [`defect-detection`](../skills/defect-detection/README.md) | SAST/lint/secrets/SCA + agent-inline semantic scan → `report_scan.*` (P0–P3) |
| [`ai-code-reviewer`](../skills/ai-code-reviewer/README.md) | CodexQA evidence pack → bilingual `REVIEW-REPORT.html` |
| [`requirements-analyzer`](../skills/requirements-analyzer/README.md) | Quality-and-risk analysis of requirement documents; one gap register |
| [`testcase-generation`](../skills/testcase-generation/README.md) | Generate test plans and manual cases (Plan / Exec / Incremental) from local requirements; dual-write Markdown plus aggregated HTML report |
| [`testdata-generation`](../skills/testdata-generation/README.md) | Construct reusable test data and backfill `{placeholder}`s in those cases |

`npx skills add … --skill <name>` copies one directory. Install the skill you need; they do not replace each other. Prefer `skill-router` when unsure — a solo router install can fetch workers on demand. Detection accuracy for `defect-detection` has not been independently benchmarked. `code-analyzer`, `code-wiki`, `root-cause-diagnosis`, `defect-detection`, `testcase-generation`, `ai-code-reviewer`, `requirements-analyzer`, and `skill-router` have no published host-agent score.

What a finished report or case looks like: [sample pages and screenshots](../README.md#what-the-output-looks-like).

## Why not just use a linter or one code-review prompt?

They solve different parts of the problem. Linters and static rules catch suspicious syntax and data-flow shapes. A general review prompt can comment on a diff, but it has no stable input contract or evidence gate. codexqa keeps the model you already use, then adds task-specific context collection, playbooks, symbol-graph queries, structured artifacts, and stop conditions. It is not a test runner or proof of correctness; it makes the verification work more bounded and reviewable.

## Which skill should I install?

Match the request, not the wording:

- Unsure which skill / auto-route a vague QA request → `skill-router`
- Scan a diff / repo / paste for SAST and semantic code-risk findings → `defect-detection`
- Trace changed symbols, callers, regression scope, test gaps, and reachable entries in a local repository → `code-analyzer`
- Map modules, real dependencies, and a reading path without calling a model → `code-wiki`
- Diagnose exception root cause from stacks / logs / dumps → `root-cause-diagnosis`
- CodexQA graph-evidence pack and bilingual HTML review report → `ai-code-reviewer`
- Review whether the PRD itself is complete and consistent → `requirements-analyzer`
- Write or update a manual case library (and optional aggregated HTML report) → `testcase-generation`
- Build data that fills case `{placeholder}`s → `testdata-generation`

“Review this PR” is not enough to choose: `code-wiki` maps communities and reading order; `code-analyzer` maps changed symbols, callers, entries, and test gaps; `defect-detection` runs SAST + agent semantic scan into `report_scan.*`; `ai-code-reviewer` collects a CodexQA pack and renders `REVIEW-REPORT.html`; `root-cause-diagnosis` needs exception evidence for RCA. A request can span skills: use `code-wiki` to learn the map, `code-analyzer` to bound the impact, then `ai-code-reviewer` for graph-evidence HTML review. Generate cases first; placeholders can only be backfilled after the `.md` files exist.

## What do I have to give each skill?

They do not share one input. Two skills take Git, but not the same way:

| Skill | You bring | Not used as input |
|---|---|---|
| `skill-router` | A request to route (optionally consent to on-demand install); Python 3.10+ | Doing the worker task itself — it only selects, may fetch, then follows another skill |
| `code-analyzer` | A local repository; for change review, the baseline ref | Requirements or a clone task. It indexes the checkout already on disk and queries its symbol graph |
| `code-wiki` | A local repository with an existing index | A change set, requirements, or a clone task. It exports `wiki inputs` and writes an architecture report |
| `root-cause-diagnosis` | Exception evidence (stack / log / dump) plus git URL, local dir, file, or open workspace | A PRD or P0/P1/P2 review request. It diagnoses exceptions, not requirement gaps or graph-evidence HTML review |
| `defect-detection` | Diff / repo / upload / paste for a code-risk scan | Exception stacks as the primary goal (use `root-cause-diagnosis`) or graph-evidence HTML review (use `ai-code-reviewer`) |
| `ai-code-reviewer` | Local checkout + `codexqa`/`jq`; `--diff-base` for PR mode | Structure/impact Q&A alone (use `code-analyzer`) or SAST scan reports (use `defect-detection`) |
| `requirements-analyzer` | Requirement documents (PRD, stories, API notes, optional role reports) | Application source. It does not write cases |
| `testcase-generation` | Local PRD / design files, paste, or HTTPS document URLs given this turn (optional knowledge dir / Git URL) | Application source as the primary input. Code fetch is Incremental-only when the user gives a PR/git URL and a case baseline already exists |
| `testdata-generation` | A construct request, written cases, and/or OpenAPI / `planId` / `serviceId` | Application source. It calls a backend (or the local mock) and reports IDs the backend returned |

Sample prompts: [root README · Quick start](../README.md#quick-start).

## Do I need an npm account or a codexqa account?

No. `npx skills add` runs a community installer that fetches skill files from GitHub. Local providers do not require a codexqa account. `code-analyzer`, `code-wiki`, `root-cause-diagnosis`, and `defect-detection` additionally install the separately distributed npm package `@openqa-cn/codexqa`, but no npm account is required. Your agent or remote providers may have their own account requirements.

## What is the relationship between the code-analyzer / code-wiki Skills and the codexqa CLI?

The `code-analyzer` and `code-wiki` Skills, playbooks, and examples are published in this repository. The `@openqa-cn/codexqa` npm package is a separately distributed, closed-source local code-analysis engine. The Skills tell the agent when to invoke it, which graph evidence to collect, and how to report the result.

Indexing, graph queries, and `wiki inputs` run on the user's machine and do not require an LLM. Indexes and sessions are stored under `~/.codexqa/`. The engine is not installed or executed by this repository's CI; see the [`code-analyzer` known limitations](../skills/code-analyzer/KNOWN_LIMITATIONS.md), [`code-wiki` known limitations](../skills/code-wiki/KNOWN_LIMITATIONS.md), and [support matrix](SUPPORT_MATRIX.md) for the current verification status.

## Does installing a skill run the workflow?

No. Installation makes the files available to the agent. You still start a session and give it a clone URL, a local checkout, a PRD, or a data-construction request. Scripts store and validate artifacts; they do not supply a model. Exception: [`skill-router`](../skills/skill-router/README.md) may **fetch** another skill's files on demand (after consent) and then follow that skill — it still does not run a worker workflow by itself.

## Does code stay on my machine?

Local providers persist results on disk, but that is not a guarantee of offline execution. The host agent/model controls how source context is processed. Configured HTTP providers can send business material and findings to external services. GitHub issue integration can create external records.

Repository cloning and fetching public documents can also use the network. Current analysis commands may attempt to install Semgrep via pip/Homebrew and GitNexus globally via npm/pnpm. Review configuration and host permissions before analyzing confidential repositories.

## Where are defect-detection reports and configuration stored?

`defect-detection` writes reports to the `-o` directory (default `/tmp/aid_report/`) and optional feedback under the skill `data/` directory. See its [README](../skills/defect-detection/README.md). Keep runtime data and private configuration outside version control and back them up before upgrading.

`testcase-generation` writes under a `run_dir` (default `$HOME/testdata-generation/runs/{runid}`, or a path you specify): `testcase/testdocs/`, `testdesign/` (including `test_design.md` and `testcase_generation_report.html`), `testcase/initialcase/`, `testcase/cases/`. `testdata-generation` writes under the workspace `testdata/` (see that skill's README). `code-analyzer` and `code-wiki` store local indexes under `~/.codexqa/`; indexing, graph queries, and `wiki inputs` do not require an LLM. `code-wiki` also writes a self-contained HTML report in the working directory. `root-cause-diagnosis` stores task data under its skill `data/` directory and also uses the CodexQA CLI indexes. `ai-code-reviewer` writes evidence packs under a working directory such as `.codexqa-review/` and renders `REVIEW-REPORT.html`.

## Is defect-detection a replacement for static analysis or testing?

It combines static-analysis integration with agent-led review. It does not replace test execution or establish the absence of defects. Structure/coverage gates validate records, not semantic correctness. AI candidates require human review.

## What languages and agents are supported?

The instructions mention Codex, Claude Code, Cursor, and OpenClaw. Installation compatibility, runtime tests, and complete agent validation are different claims. See the [support matrix](SUPPORT_MATRIX.md) for what has actually been checked. Java receives method/call-graph-oriented handling; other language behavior depends on the relevant extraction and scan paths.

## Is detection accuracy measured?

Not yet on a published agent benchmark. The regression suite validates CLI and workflow behaviors. The boundary example demonstrates a deterministic defect, not AI detection accuracy or a false-positive rate.

## What does the output look like?

Sample pages (same renderers, canned findings): [README · What the output looks like](../README.md#what-the-output-looks-like). HTML and PNGs live in `docs/assets/previews/`.

## Does testcase-generation fill test data?

No. It writes test plans and manual case Markdown (unknowns stay TBD / pending clarification), then an aggregated HTML report for review. Constructing live backend IDs and writing them back as preconditions is `testdata-generation`. Installing only `testcase-generation` yields a design library, not a script against a live backend.
