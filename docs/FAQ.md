# codexqa FAQ

[简体中文](FAQ.zh-CN.md)

This page covers installation and the published skills. Most answers below are about `codexqa-defect-analyzer`; the others are called out where their contract differs.

## What is codexqa?

codexqa is a public, local-first [Agent Skills](https://agentskills.io/specification) pack for Cursor, Claude Code, Codex, and OpenClaw. AI makes producing code faster; codexqa focuses on the verification work that does not automatically get cheaper: clarifying requirements, understanding change impact, reviewing implementation evidence, designing cases, and preparing test data.

The eight worker skills cover different parts of the delivery lifecycle, plus [`codexqa-skill-router`](../skills/codexqa-skill-router/README.md) as the auto-select entry when the request does not name a skill. Each worker has a separate input contract so the agent knows whether it should read documents, index a local checkout, scan for code risk, write cases, call a data backend, diagnose an exception, collect a CodexQA review pack, or export an architecture wiki:

| Skill | Role |
| --- | --- |
| [`codexqa-skill-router`](../skills/codexqa-skill-router/README.md) | Discover live siblings + bundled catalog; on-demand install; hand off to the matched skill |
| [`codexqa-code-analyzer`](../skills/codexqa-code-analyzer/README.md) | Index a local repository, then trace change impact, regression scope, test gaps, entries, and errors through its symbol graph |
| [`codexqa-code-wiki`](../skills/codexqa-code-wiki/README.md) | Index a local repository, export community digests with `wiki inputs` (no model), and write an architecture knowledge-graph HTML report |
| [`codexqa-rootcause-analyzer`](../skills/codexqa-rootcause-analyzer/README.md) | Exception RCA from stacks/logs on top of the CodexQA CLI; gated English root-cause report |
| [`codexqa-defect-analyzer`](../skills/codexqa-defect-analyzer/README.md) | SAST/lint/secrets/SCA + Agent LLM Detection → `report_scan.*` (P0–P3, deduped) |
| [`codexqa-code-reviewer`](../skills/codexqa-code-reviewer/README.md) | CodexQA evidence pack + heuristic dims + Agent LLM judgment → bilingual `REVIEW-REPORT.html` |
| [`codexqa-requirement-analyzer`](../skills/codexqa-requirement-analyzer/README.md) | Quality-and-risk analysis of requirement documents; one gap register |
| [`codexqa-testcase-generator`](../skills/codexqa-testcase-generator/README.md) | Generate test plans and manual cases (Plan / Exec / Incremental) from local requirements; dual-write Markdown plus aggregated HTML report |
| [`codexqa-testdata-generator`](../skills/codexqa-testdata-generator/README.md) | Construct reusable test data and backfill `{placeholder}`s in those cases |

`npx skills add … --skill <name>` copies one directory. Install the skill you need; they do not replace each other. Prefer `codexqa-skill-router` when unsure — a solo router install can fetch workers on demand. Detection accuracy for `codexqa-defect-analyzer` has not been independently benchmarked. `codexqa-code-analyzer`, `codexqa-code-wiki`, `codexqa-rootcause-analyzer`, `codexqa-defect-analyzer`, `codexqa-testcase-generator`, `codexqa-code-reviewer`, `codexqa-requirement-analyzer`, and `codexqa-skill-router` have no published host-agent score.

What a finished report or case looks like: [sample pages and screenshots](../README.md#overview-of-all-test-and-verify-skills).

## Were the skill names renamed?

Yes. Every published skill now uses a `codexqa-*` directory and frontmatter `name`. Install with the new names, for example `npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer`. Former names map as: `ai-code-reviewer`→`codexqa-code-reviewer`, `code-analyzer`→`codexqa-code-analyzer`, `code-wiki`→`codexqa-code-wiki`, `defect-detection`→`codexqa-defect-analyzer`, `requirements-analyzer`→`codexqa-requirement-analyzer`, `root-cause-diagnosis`→`codexqa-rootcause-analyzer`, `skill-router`→`codexqa-skill-router`, `testdata-generation`→`codexqa-testdata-generator`, `testcase-generation`→`codexqa-testcase-generator`.

## Why not just use a linter or one code-review prompt?

They solve different parts of the problem. Linters and static rules catch suspicious syntax and data-flow shapes. A general review prompt can comment on a diff, but it has no stable input contract or evidence gate. codexqa keeps the model you already use, then adds task-specific context collection, playbooks, symbol-graph queries, structured artifacts, and stop conditions. It is not a test runner or proof of correctness; it makes the verification work more bounded and reviewable.

## Which skill should I install?

Match the request, not the wording:

- Unsure which skill / auto-route a vague QA request → `codexqa-skill-router`
- Scan a diff / repo / paste for SAST and semantic code-risk findings → `codexqa-defect-analyzer`
- Trace changed symbols, callers, regression scope, test gaps, and reachable entries in a local repository → `codexqa-code-analyzer`
- Map modules, real dependencies, and a reading path without calling a model → `codexqa-code-wiki`
- Diagnose exception root cause from stacks / logs / dumps → `codexqa-rootcause-analyzer`
- CodexQA graph-evidence pack and bilingual HTML review report → `codexqa-code-reviewer`
- Review whether the PRD itself is complete and consistent → `codexqa-requirement-analyzer`
- Write or update a manual case library (and optional aggregated HTML report) → `codexqa-testcase-generator`
- Build data that fills case `{placeholder}`s → `codexqa-testdata-generator`

“Review this PR” is not enough to choose: `codexqa-code-wiki` maps communities and reading order; `codexqa-code-analyzer` maps changed symbols, callers, entries, and test gaps; `codexqa-defect-analyzer` runs SAST + agent semantic scan into `report_scan.*`; `codexqa-code-reviewer` collects a CodexQA pack and renders `REVIEW-REPORT.html`; `codexqa-rootcause-analyzer` needs exception evidence for RCA. A request can span skills: use `codexqa-code-wiki` to learn the map, `codexqa-code-analyzer` to bound the impact, then `codexqa-code-reviewer` for graph-evidence HTML review. Generate cases first; placeholders can only be backfilled after the `.md` files exist.

## What do I have to give each skill?

They do not share one input. Two skills take Git, but not the same way:

| Skill | You bring | Not used as input |
|---|---|---|
| `codexqa-skill-router` | A request to route (optionally consent to on-demand install); Python 3.10+ | Doing the worker task itself — it only selects, may fetch, then follows another skill |
| `codexqa-code-analyzer` | A local repository; for change review, the baseline ref | Requirements or a clone task. It indexes the checkout already on disk and queries its symbol graph |
| `codexqa-code-wiki` | A local repository with an existing index | A change set, requirements, or a clone task. It exports `wiki inputs` and writes an architecture report |
| `codexqa-rootcause-analyzer` | Exception evidence (stack / log / dump) plus git URL, local dir, file, or open workspace | A PRD or P0/P1/P2 review request. It diagnoses exceptions, not requirement gaps or graph-evidence HTML review |
| `codexqa-defect-analyzer` | Diff / repo / upload / paste for a code-risk scan | Exception stacks as the primary goal (use `codexqa-rootcause-analyzer`) or graph-evidence HTML review (use `codexqa-code-reviewer`) |
| `codexqa-code-reviewer` | Local checkout + `codexqa`/`jq`; `--diff-base` for PR mode | Structure/impact Q&A alone (use `codexqa-code-analyzer`) or SAST scan reports (use `codexqa-defect-analyzer`) |
| `codexqa-requirement-analyzer` | Requirement documents (PRD, stories, API notes, optional role reports) | Application source. It does not write cases |
| `codexqa-testcase-generator` | Local PRD / design files, paste, or HTTPS document URLs given this turn (optional knowledge dir / Git URL) | Application source as the primary input. Code fetch is Incremental-only when the user gives a PR/git URL and a case baseline already exists |
| `codexqa-testdata-generator` | A construct request, written cases, and/or OpenAPI / `planId` / `serviceId` | Application source. It calls a backend (or the local mock) and reports IDs the backend returned |

Sample prompts: [root README · Quick start](../README.md#quick-start).

## Do I need an npm account or a codexqa account?

No. `npx skills add` runs a community installer that fetches skill files from GitHub. Local providers do not require a codexqa account. `codexqa-code-analyzer`, `codexqa-code-wiki`, `codexqa-rootcause-analyzer`, and `codexqa-defect-analyzer` additionally install the separately distributed npm package `@openqa-cn/codexqa`, but no npm account is required. Your agent or remote providers may have their own account requirements.

## What is the relationship between the codexqa-code-analyzer / codexqa-code-wiki Skills and the codexqa CLI?

The `codexqa-code-analyzer` and `codexqa-code-wiki` Skills, playbooks, and examples are published in this repository. The `@openqa-cn/codexqa` npm package is a separately distributed, closed-source local code-analysis engine. The Skills tell the agent when to invoke it, which graph evidence to collect, and how to report the result.

Indexing, graph queries, and `wiki inputs` run on the user's machine and do not require an LLM. Indexes and sessions are stored under `~/.codexqa/`. The engine is not installed or executed by this repository's CI; see the [`codexqa-code-analyzer` known limitations](../skills/codexqa-code-analyzer/KNOWN_LIMITATIONS.md), [`codexqa-code-wiki` known limitations](../skills/codexqa-code-wiki/KNOWN_LIMITATIONS.md), and [support matrix](SUPPORT_MATRIX.md) for the current verification status.

## Does installing a skill run the workflow?

No. Installation makes the files available to the agent. You still start a session and give it a clone URL, a local checkout, a PRD, or a data-construction request. Scripts store and validate artifacts; they do not supply a model. Exception: [`codexqa-skill-router`](../skills/codexqa-skill-router/README.md) may **fetch** another skill's files on demand (after consent) and then follow that skill — it still does not run a worker workflow by itself.

## Does code stay on my machine?

Local providers persist results on disk, but that is not a guarantee of offline execution. The host agent/model controls how source context is processed. Configured HTTP providers can send business material and findings to external services. GitHub issue integration can create external records.

Repository cloning and fetching public documents can also use the network. Current analysis commands may attempt to install Semgrep via pip/Homebrew and GitNexus globally via npm/pnpm. Review configuration and host permissions before analyzing confidential repositories.

## Where are codexqa-defect-analyzer reports and configuration stored?

`codexqa-defect-analyzer` writes reports to the `-o` directory (default `/tmp/aid_report/`) and optional feedback under the skill `data/` directory. See its [README](../skills/codexqa-defect-analyzer/README.md). Keep runtime data and private configuration outside version control and back them up before upgrading.

`codexqa-testcase-generator` writes under a `run_dir` (default `$HOME/codexqa-testdata-generator/runs/{runid}`, or a path you specify): `testcase/testdocs/`, `testdesign/` (including `test_design.md` and `testcase_generation_report.html`), `testcase/initialcase/`, `testcase/cases/`. `codexqa-testdata-generator` writes under the workspace `testdata/` (see that skill's README). `codexqa-code-analyzer` and `codexqa-code-wiki` store local indexes under `~/.codexqa/`; indexing, graph queries, and `wiki inputs` do not require an LLM. `codexqa-code-wiki` also writes a self-contained HTML report in the working directory. `codexqa-rootcause-analyzer` stores task data under its skill `data/` directory and also uses the CodexQA CLI indexes. `codexqa-code-reviewer` writes evidence packs under a working directory such as `.codexqa-review/` and renders `REVIEW-REPORT.html`.

## Is codexqa-defect-analyzer a replacement for static analysis or testing?

It combines static-analysis integration with agent-led review. It does not replace test execution or establish the absence of defects. Structure/coverage gates validate records, not semantic correctness. AI candidates require human review.

## What languages and agents are supported?

The instructions mention Codex, Claude Code, Cursor, and OpenClaw. Installation compatibility, runtime tests, and complete agent validation are different claims. See the [support matrix](SUPPORT_MATRIX.md) for what has actually been checked. Java receives method/call-graph-oriented handling; other language behavior depends on the relevant extraction and scan paths.

## Is detection accuracy measured?

Not yet on a published agent benchmark. The regression suite validates CLI and workflow behaviors. The boundary example demonstrates a deterministic defect, not AI detection accuracy or a false-positive rate.

## What does the output look like?

Sample pages (same renderers, canned findings): [README · Overview of all test-and-verify skills](../README.md#overview-of-all-test-and-verify-skills). HTML and PNGs live in `docs/assets/previews/`.

## Does codexqa-testcase-generator fill test data?

No. It writes test plans and manual case Markdown (unknowns stay TBD / pending clarification), then an aggregated HTML report for review. Constructing live backend IDs and writing them back as preconditions is `codexqa-testdata-generator`. Installing only `codexqa-testcase-generator` yields a design library, not a script against a live backend.
