<div align="center">

# codexqa

**Shipping fast is table stakes. CodeXQA runs fully local, installs ready to use, and tells you if the code is good.**

After AI coding, the hard part is **verifying quality before you merge**: bugs in what just landed, blast radius on old features, complete test cases, the change knowledge graph (which APIs, methods, and call chains moved), whether architecture broke, security risk, requirement fit, and test data you can actually run. **codexqa** is built for that **test-and-verify stage** — 8 Agent Skills (+ a router), 360° coverage, so you not only write fast, you **see fast whether it is good**, and the development loop actually closes.

Cursor · Claude Code · Codex · OpenClaw. Fully local. Install and use — no account, no gateway, no QA-platform move.

<p>
  <strong>8</strong> skills &nbsp;·&nbsp;
  <strong>0</strong> accounts &nbsp;·&nbsp;
  <strong>7/7</strong> blind recall &nbsp;·&nbsp;
  <strong>0</strong> decoy FPs &nbsp;·&nbsp;
  <strong>10</strong> languages
</p>

<sub>Recorded JS blind eval on <a href="examples/inventory-service/README.md">inventory-service</a>: 7 planted semantic defects, 4 decoys. Recall 7/7, precision 7/7, 0 trap FPs — Composer, 2026-09-08, <em>one run, not a multi-model benchmark</em>. Semgrep seeds: 102 rules / 10 languages.</sub>

GitHub is the skill source; product site: [openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=hero).

[![CI](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml)
[![Docs](https://img.shields.io/badge/docs-openqa.cn-111827)](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=badge-docs)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=release)](https://github.com/openqa-cn/codexqa/releases)
[![Last commit](https://img.shields.io/github/last-commit/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/commits)
[![Commit activity](https://img.shields.io/github/commit-activity/m/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/graphs/commit-activity)
[![Stars](https://img.shields.io/github/stars/openqa-cn/codexqa?style=flat)](https://github.com/openqa-cn/codexqa/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/codexqa)](LICENSE)

**English | [简体中文](README.zh-CN.md)**

<a href="https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=nav-docs"><strong>Documentation</strong></a> ·
<a href="#quick-start"><strong>Quick Start</strong></a> ·
<a href="#overview-of-all-test-and-verify-skills"><strong>Skills overview</strong></a> ·
<a href="docs/GETTING_STARTED.md"><strong>Install notes</strong></a> ·
<a href="CHANGELOG.md"><strong>Changelog</strong></a>

</div>

<a id="what-the-output-looks-like"></a>
<a id="overview-of-all-test-and-verify-skills"></a>

## Overview of all test-and-verify skills

Each skill below states **what it verifies**, **what it can do**, then shows an openable HTML report. Pages use the project renderers and prepared sample data. They are illustrations, not recorded Agent scores.

<table>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-defect-analyzer/README.md">codexqa-defect-analyzer</a></strong></p>
<p><strong>Verifies</strong> — whether the code you just wrote or merged hides bugs or security issues a quick glance would miss.</p>
<p><strong>Does</strong> — merges SAST / lint / secrets with one Agent semantic pass into a P0–P3 HTML report: location, evidence, suggestion.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="codexqa-defect-analyzer HTML scan report"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-code-reviewer/README.md">codexqa-code-reviewer</a></strong></p>
<p><strong>Verifies</strong> — whether this change is merge-ready, and whether it silently hits old behavior. A git diff alone rarely shows call chains or test gaps.</p>
<p><strong>Does</strong> — collects a CodexQA evidence pack (callers, blast radius, test edges), then writes a bilingual <code>REVIEW-REPORT.html</code> you can send to a reviewer.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/review-report.html"><img src="docs/assets/previews/review-report.png" alt="codexqa-code-reviewer bilingual REVIEW-REPORT.html"></a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-code-wiki/README.md">codexqa-code-wiki</a></strong></p>
<p><strong>Verifies</strong> — how the repo is actually layered, which module is the hub, and where a newcomer (or an Agent) should start reading. Without a map, “did we break the architecture?” is a guess.</p>
<p><strong>Does</strong> — builds a local architecture knowledge graph — communities, real dependencies, reading paths — as openable HTML, not a chat summary.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/code-wiki.html"><img src="docs/assets/previews/code-wiki.png" alt="codexqa-code-wiki architecture wiki HTML report"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-code-analyzer/README.md">codexqa-code-analyzer</a></strong></p>
<p><strong>Verifies</strong> — which APIs, methods, and call chains this change actually hits; what to regression-test; which paths still have no tests.</p>
<p><strong>Does</strong> — queries a local symbol graph for callers, entries, and untested edges. Not a full-text search guess.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/code-analyzer.html"><img src="docs/assets/previews/code-analyzer.png" alt="codexqa-code-analyzer change-impact graph"></a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-rootcause-analyzer/README.md">codexqa-rootcause-analyzer</a></strong></p>
<p><strong>Verifies</strong> — after mapping a stack or log back onto the repo, where the failure really starts. The throw site is often not the root cause.</p>
<p><strong>Does</strong> — writes a gated English RCA: trigger vs root cause vs confidence, plus one fix-and-verify suggestion.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/rootcause.html"><img src="docs/assets/previews/rootcause.png" alt="codexqa-rootcause-analyzer English RCA report"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-requirement-analyzer/README.md">codexqa-requirement-analyzer</a></strong></p>
<p><strong>Verifies</strong> — whether the requirement is testable, complete, and internally consistent — before anyone writes code. Gaps and conflicts often live in the PRD.</p>
<p><strong>Does</strong> — one P0/P1 gap-and-conflict register from a PRD (or a multi-source pack). High-priority items come with executable verification steps.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/ra-register.html"><img src="docs/assets/previews/ra-register.png" alt="codexqa-requirement-analyzer gap register"></a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-testcase-generator/README.md">codexqa-testcase-generator</a></strong></p>
<p><strong>Verifies</strong> — what a complete test pass should cover for Web / server / APP, without inventing business facts when the PRD is silent.</p>
<p><strong>Does</strong> — local Markdown plan + cases (unknowns stay TBD) plus an aggregated HTML you can open. No test-management platform.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testcase-report.html"><img src="docs/assets/previews/testcase-report.png" alt="codexqa-testcase-generator aggregated HTML case report"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-testdata-generator/README.md">codexqa-testdata-generator</a></strong></p>
<p><strong>Verifies</strong> — whether the preconditions in a case can actually be built on a real backend. A copied fake ID will not pass a real API.</p>
<p><strong>Does</strong> — constructs data against the backend and writes the returned business IDs back into case preconditions. Success means the backend issued an ID.</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testdata-writeback.html"><img src="docs/assets/previews/testdata-writeback.png" alt="codexqa-testdata-generator write-back of backend IDs"></a></p>
</td>
</tr>
</table>

Click a screenshot to open the HTML report in the browser. Regeneration: [`docs/assets/previews/README.md`](docs/assets/previews/README.md). <a id="evidence-and-limitations"></a>Findings stay candidates for human review; live `@openqa-cn/codexqa` indexing is not run by this repository’s CI.

<a id="quick-start"></a>

## Quick start

**1. Install** (router only is enough; it can fetch a worker on demand):

```bash
npx skills add openqa-cn/codexqa --skill codexqa-skill-router
```

Pick Cursor, Claude Code, Codex, or OpenClaw when prompted. No npm login.

**2. Run** — new Agent session, then paste:

```text
I am not sure which skill to use. Route this: review this repo against origin/main
and produce an openable HTML report I can send to a reviewer.
```

Or name a worker: `Use codexqa-defect-analyzer on this branch. Requirement: a refund must not exceed the remaining refundable balance.`

**3. See a report** — the Agent writes HTML/Markdown on disk. Compare with the screenshots above.

Zero-model install check:

```bash
node examples/checkout-boundary/verify.mjs
```

**Install a specific skill · code-graph CLI**

```bash
npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-code-reviewer
npx skills add openqa-cn/codexqa --skill codexqa-code-wiki
npx skills add openqa-cn/codexqa --skill codexqa-code-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-rootcause-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-requirement-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-testcase-generator
npx skills add openqa-cn/codexqa --skill codexqa-testdata-generator
```

## Capabilities

Each skill is one step in the test-and-verify loop. The table says **when to use it** and **what checkable result** you leave with — an openable artifact, not a chat summary.

| | Skill | When to use it, and what verification result you get |
| --- | --- | --- |
| 🧭 | [`codexqa-skill-router`](skills/codexqa-skill-router/README.md) | **When** you are not sure whether you need a defect scan, impact map, cases, or test data — or the worker is not installed yet.<br>**You get** the matching skill, installed on demand if missing, then a handoff. Verification starts by picking the right tool; you do not memorize eight entry points. |
| 📋 | [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.md) | **When** a PRD, story pack, or mixed materials land, before anyone writes code: is it testable, complete, internally consistent?<br>**You get** one assignable P0/P1 gap-and-conflict register. High-priority rows include preconditions, stimulus, expected result, and evidence — the requirement-layer blockers that would make later testing fail. |
| 🧪 | [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.md) | **When** you need a test plan and executable cases for Web / server / APP before submit, or extra regression after a change.<br>**You get** local Markdown plan + cases + aggregated HTML: which scenarios, which priority. Unknowns stay TBD; silent PRD gaps are not invented as fake cases. |
| 🗃️ | [`codexqa-testdata-generator`](skills/codexqa-testdata-generator/README.md) | **When** cases exist but will not run: missing accounts, catalog rows, orders. A copied fake ID will not pass a real API.<br>**You get** data constructed against the backend, with returned business IDs written into case preconditions. Success means the backend issued an ID, not that a number appeared in chat. |
| 🗺️ | [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.md) | **When** a newcomer or an Agent enters the repo, or you are reviewing whether a change broke the architecture.<br>**You get** an architecture knowledge-graph HTML: module communities, real dependencies, the hub, a reading path. You are checking layering and where to start — not another README. |
| 📈 | [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.md) | **When** you review a PR, set regression scope, or ask “who does this change hit?” A git diff will not show call chains.<br>**You get** blast radius from a local symbol graph: which APIs / methods / call chains moved, which entries fire, which edges have no tests. That list is what you regression-test. |
| 🧯 | [`codexqa-rootcause-analyzer`](skills/codexqa-rootcause-analyzer/README.md) | **When** a production or local exception, stack, or log still does not tell you which layer actually failed.<br>**You get** a gated English RCA: trigger vs root cause vs confidence, plus one fix-and-verify suggestion. The throw site is not treated as the root cause. |
| 🛡️ | [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.md) | **When** you scan a branch before merge, or paste newly written code and ask about bugs, secrets, or dangerous patterns.<br>**You get** a P0–P3 HTML scan: SAST / lint / secrets merged and de-duplicated with Agent semantic findings — location, evidence, suggestion. This is defect and security risk, not a CR opinion. |
| ⚖️ | [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.md) | **When** you need something a reviewer can open, not a raw git diff, before a merge gate.<br>**You get** a bilingual `REVIEW-REPORT.html` from a CodexQA evidence pack (call chains, blast radius, test edges): merge risk, gaps, and what still needs tests. Use it as the CR attachment. |

Narrow contracts, stop conditions, local files. The Agent you already use is the runtime.

## Who it's for

| | Who | Typical job: tools, skills, and what you take away |
| --- | --- | --- |
| 🏢 | **Enterprise** | **Tools** The Cursor / Claude Code / Codex / OpenClaw you already run. One `npx skills add` puts verification next to the coding agent — no account, no gateway, no move of QA onto another SaaS.<br>**Skills** [`codexqa-skill-router`](skills/codexqa-skill-router/README.md) to route; PRs through [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.md) + [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.md) + [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.md); pre-submit through [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.md) → [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.md) → [`codexqa-testdata-generator`](skills/codexqa-testdata-generator/README.md); architecture with [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.md); incidents with [`codexqa-rootcause-analyzer`](skills/codexqa-rootcause-analyzer/README.md).<br>**You get** blast radius (APIs / methods / call chains, regression list, test gaps), P0–P3 defect-and-security HTML, a bilingual `REVIEW-REPORT.html` for reviewers, a requirement gap register, Web/server/APP cases, real backend IDs in preconditions, an architecture knowledge graph, and a gated RCA. Files stay local; findings still need a human. |
| 👤 | **Individual** | **Tools** Your own Cursor or Codex session. Install [`codexqa-skill-router`](skills/codexqa-skill-router/README.md); workers can be fetched when you need them.<br>**Skills** Before you merge your PR: [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.md) for bugs and secrets, [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.md) for who is hit, [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.md) for an openable review page. Unfamiliar repo → [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.md); your own PRD/cases → the generators.<br>**You get** HTML you can open: whether there are obvious defects, whether the blast radius is clear, whether the review is sendable. No extra test platform. |
| 🎓 | **Education** | **Tools** Any Agent Skills IDE plus the in-repo [inventory-service](examples/inventory-service/README.md) fixture (7 semantic defects, 4 decoys, a reproducible answer key).<br>**Skills** [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.md) to teach what a graded scan report looks like; [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.md) / [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.md) for hubs and change call chains; [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.md) and [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.md) for “can this requirement be tested, and where do cases come from?”<br>**You get** openable reports plus an answer key — “checkable output,” not a chat comment. Recorded recall numbers live on the fixture README; they are one run, not a multi-model board. |
| 🤖 | **AI development** | **Tools** The Agent runtime you already ship (Cursor · Claude Code · Codex · OpenClaw) plus this Agent Skills pack — not a mega-prompt.<br>**Skills** [`codexqa-skill-router`](skills/codexqa-skill-router/README.md) as the entry; the eight workers behind a narrow handoff: requirement gaps, cases, test data, architecture graph, blast radius, RCA, defect scan, graph-evidence review.<br>**You get** Markdown / HTML on disk (register, cases, scan page, `REVIEW-REPORT.html`, RCA), with stop conditions. When you wire verification into an Agent product, you ship skills, not an uncheckable conversation. |

Not a hosted test cloud. Not a replacement for your test suite, SAST license, or maintainer judgment.

## Star this repo

If a local skill pack like this is what you wanted instead of another QA platform, a star on [openqa-cn/codexqa](https://github.com/openqa-cn/codexqa/stargazers) is the quiet way to keep it discoverable. Issues and reproductions help more than stars when something is wrong.

## Changelog

[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=latest)](https://github.com/openqa-cn/codexqa/releases)
[![Last commit](https://img.shields.io/github/last-commit/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/commits)
[![Commit activity](https://img.shields.io/github/commit-activity/m/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/graphs/commit-activity)

**Unreleased** — `codexqa-*` skill names; architecture wiki; Agent LLM Detection / judgment; canonical docs at [openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=changelog).

**0.2.0** — first five published skills, sample reports, inventory-service 7/7 blind eval (one model, one run).

Full history: [CHANGELOG.md](CHANGELOG.md) · [Releases](https://github.com/openqa-cn/codexqa/releases) (each release body links to openqa.cn).

## Product and docs

| I want to… | Go here |
| --- | --- |
| Use the product site | [openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=docs-home) |
| Browse skills | [Skill Hub](https://openqa.cn/skills?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=docs-skills) |
| See the commercial product | [openqa.cn/agent](https://openqa.cn/agent?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=docs-product) |
| Install without guessing | [Getting started](docs/GETTING_STARTED.md) · [Support matrix](docs/SUPPORT_MATRIX.md) |
| Know how a conclusion is reached | [How it works](docs/HOW_IT_WORKS.md) |
| Reproduce the blind eval | [inventory-service](examples/inventory-service/README.md) · [Methodology](benchmarks/README.md) |
| Report a bug | [Issues](https://github.com/openqa-cn/codexqa/issues) · [Security](SECURITY.md) |
| Send a PR | [Contributing](CONTRIBUTING.md) · Apache-2.0 |
