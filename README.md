<div align="center">

# codexqa

**Shipping fast is table stakes. Knowing the code is good is the bottleneck.**

After AI coding, the hard part is **verifying quality before you merge**: bugs in what just landed, blast radius on old features, complete test cases, the change knowledge graph (which APIs, methods, and call chains moved), whether architecture broke, security risk, requirement fit, and test data you can actually run. **codexqa** is built for that **test-and-verify stage** — 8 Agent Skills (+ a router), 360° coverage, so you not only write fast, you **see fast whether it is good**, and the development loop actually closes.

Cursor · Claude Code · Codex · OpenClaw. Local-first. No account, no gateway, no QA-platform move.

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
<a href="#what-the-output-looks-like"><strong>Reports</strong></a> ·
<a href="docs/GETTING_STARTED.md"><strong>Install notes</strong></a> ·
<a href="CHANGELOG.md"><strong>Changelog</strong></a>

</div>

<p align="center">
  <a href="docs/assets/previews/code-wiki.html"><img src="docs/assets/previews/code-wiki.png" alt="codexqa-code-wiki architecture knowledge-graph HTML report for inventory-service" width="100%"></a>
</p>
<p align="center"><sub>First screen: a filled <code>codexqa-code-wiki</code> HTML report. The eight skills below each produce an openable page — not a chat dump.</sub></p>

<a id="what-the-output-looks-like"></a>

## What the output looks like

Each row is one published skill’s HTML report. Pages use the project renderers and prepared sample data. They are illustrations, not recorded Agent scores.

<table>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="codexqa-defect-analyzer HTML scan report"></a>
<p align="center"><sub><b>codexqa-defect-analyzer</b> — P0–P3 scan page</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/review-report.html"><img src="docs/assets/previews/review-report.png" alt="codexqa-code-reviewer bilingual REVIEW-REPORT.html"></a>
<p align="center"><sub><b>codexqa-code-reviewer</b> — bilingual REVIEW-REPORT.html</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/code-wiki.html"><img src="docs/assets/previews/code-wiki.png" alt="codexqa-code-wiki architecture wiki HTML report"></a>
<p align="center"><sub><b>codexqa-code-wiki</b> — architecture knowledge graph</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/code-analyzer.html"><img src="docs/assets/previews/code-analyzer.png" alt="codexqa-code-analyzer change-impact graph"></a>
<p align="center"><sub><b>codexqa-code-analyzer</b> — callers, entries, test gaps</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/rootcause.html"><img src="docs/assets/previews/rootcause.png" alt="codexqa-rootcause-analyzer English RCA report"></a>
<p align="center"><sub><b>codexqa-rootcause-analyzer</b> — gated English RCA</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/ra-register.html"><img src="docs/assets/previews/ra-register.png" alt="codexqa-requirement-analyzer gap register"></a>
<p align="center"><sub><b>codexqa-requirement-analyzer</b> — one gap/conflict register</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/testcase-report.html"><img src="docs/assets/previews/testcase-report.png" alt="codexqa-testcase-generator aggregated HTML case report"></a>
<p align="center"><sub><b>codexqa-testcase-generator</b> — Web / Server / APP cases</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/testdata-writeback.html"><img src="docs/assets/previews/testdata-writeback.png" alt="codexqa-testdata-generator write-back of backend IDs"></a>
<p align="center"><sub><b>codexqa-testdata-generator</b> — backend IDs written back</sub></p>
</td>
</tr>
</table>

Open any HTML in the table. Regeneration: [`docs/assets/previews/README.md`](docs/assets/previews/README.md). <a id="evidence-and-limitations"></a>Findings stay candidates for human review; live `@openqa-cn/codexqa` indexing is not run by this repository’s CI.

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

<details>
<summary>Install a specific skill · code-graph CLI</summary>

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

Wiki, impact, RCA, and graph review also need Node.js 18+ and `npm install -g @openqa-cn/codexqa` (closed-source local engine, runs on your machine). Details: [Getting started](docs/GETTING_STARTED.md) · [FAQ](docs/FAQ.md).

</details>

## Capabilities

| | Skill | What you get |
| --- | --- | --- |
| 🧭 | [`codexqa-skill-router`](skills/codexqa-skill-router/README.md) | Matches the request to a worker; can install it on demand |
| 📋 | [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.md) | One P0/P1 gap-and-conflict register from a PRD |
| 🧪 | [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.md) | Local Markdown plan + cases + aggregated HTML; unknowns stay TBD |
| 🗃️ | [`codexqa-testdata-generator`](skills/codexqa-testdata-generator/README.md) | Real backend IDs written into case preconditions |
| 🗺️ | [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.md) | Community map, real deps, reading path, Claude Code-style HTML |
| 📈 | [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.md) | Changed symbols → callers, entries, untested edges |
| 🧯 | [`codexqa-rootcause-analyzer`](skills/codexqa-rootcause-analyzer/README.md) | Gated English RCA: trigger vs root cause vs confidence |
| 🛡️ | [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.md) | SAST/lint/secrets plus Agent LLM Detection, P0–P3 HTML |
| ⚖️ | [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.md) | CodexQA evidence pack → bilingual `REVIEW-REPORT.html` |

Narrow contracts, stop conditions, local files. The Agent you already use is the runtime.

## Who it's for

| | Who | Typical job |
| --- | --- | --- |
| 🏢 | **Enterprise** | Bound verification next to the coding agent: impact, SAST, CR evidence, without moving QA onto a new SaaS |
| 👤 | **Individual** | One `npx skills add` in Cursor/Codex; open the HTML before you merge your own PR |
| 🎓 | **Education** | Teach “checkable output” with the [inventory-service](examples/inventory-service/README.md) fixture (7 seeded defects, 4 decoys) |
| 🤖 | **AI development** | Give agents skills instead of a mega-prompt: router → worker → report on disk |

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

Organic-search playbooks (openqa.cn only, no second docs host): [`seo/`](seo/README.md).
