# Changelog

Each release has two sections. **Highlights** is what changes for someone using the skills. **Internal** is the full engineering record — refactors, test changes, and fixes with no user-visible effect. If you are upgrading, Highlights is enough.

## Unreleased

- **New `codexqa-change-analysis` skill.** One diff at a time: a trusted `index --diff-base --full`, a 7-section English HTML report (affected entries, changed methods, test plan, coverage verdict, sensitive paths), and new runnable test files for uncovered points (add only; existing test files are not edited). Former name: `change-impact-analysis`. General symbol-graph Q&A stays `codexqa-code-analyzer`.
- Docs list all ten workers. Getting started, FAQ, roadmap, support matrix, architecture, contributing, commercial boundary, and the router README now name `codexqa-change-analysis` and `codexqa-jev-browser` (install lines, inputs, `codexqa` engine dependency, support rows).
- `codexqa-code-reviewer`: close review relations on objects, callee control flow, unread bounds, and `rule_id`. Nearby lines no longer merge a different relation. An unread expiry is `BND-001`, not only cache growth.
- Stop tracking `.cursor/rules` (local push-identity gate), Ruff cache, and internal `seo/` playbooks. `.github/` stays: Actions, release notes, and issue templates only run from the repository.
- Stop tracking `.editorconfig` (editor-local). `.gitattributes` stays so clones keep LF line endings. `.gitignore` is local-only and is not tracked.

## 0.3.0 — 2026-09-21

Eight published skills under the `codexqa-*` names, including `codexqa-code-wiki`. The root README is a product landing page; documentation ranks at [openqa.cn](https://openqa.cn/).

### Highlights

- **README is a landing page.** Root README leads with who it is for, eight skill HTML report screenshots, a three-step start, and activity badges. Documentation still points at [openqa.cn](https://openqa.cn/).
- **Search landing is openqa.cn.** README Documentation points at [openqa.cn](https://openqa.cn/). There is no second docs host in this repository.
- **New `codexqa-code-wiki` skill.** Index a local repository, export Leiden communities and digests with `wiki inputs` (no model), and write a DeepWiki-style HTML architecture wiki (sidebar + article + TOC, module map, real deps, reading guides). The Skill, playbook, report template, and limitations are published here; it uses the same separately distributed `@openqa-cn/codexqa` engine as `codexqa-code-analyzer`.
- **Skill rename to `codexqa-*`.** Every published skill directory and frontmatter `name` now uses the `codexqa-` prefix (see Internal). Update install flags and docs bookmarks accordingly (`--skill codexqa-defect-analyzer`, etc.).
- **`codexqa-code-reviewer` Agent LLM judgment (v0.0.3).** After heuristic dimension drafts, the host embedded model runs an order-16 semantic CR pass; `merge-llm-findings.py` dedupes/merges into final P0/P1/P2 (`22-llm-judgment.json`). Collect/validate/render still need no external LLM API.
- **`codexqa-defect-analyzer` Agent LLM Detection (v0.0.2).** First-class detection dimension via `prompts/agent_detect.md` (Stage1 + Stage2); `finalize` dedupes/merges with deterministic SAST/lint/secrets/SCA and stamps `dimension` on findings. Default `--llm-mode agent` needs no API key.
- **`codexqa-testcase-generator` rewritten to Plan / Exec / Incremental.** Conversation-driven test plans (stages 0–5) and cases (stage 6), plus post-submit incremental on a case baseline. Local Markdown under `run_dir`; Python 3.10+ gates via `scripts/tcg-python`. No case-platform / doc-platform binding. After dual-write, agents generate `testdesign/testcase_generation_report.html` (Web / Server / APP aggregate; Markdown remains the edit source).
- **New `codexqa-code-reviewer` skill.** Graph-evidence code review via the CodexQA CLI only: collect a JSON evidence pack (PR/diff, full-repo, or adhoc), validate it, then render bilingual `REVIEW-REPORT.html` from `review-conclusion.json`. Replaces the removed playbook `code-reviewer` skill; not a SAST scan pipeline (`codexqa-defect-analyzer`).
- **New `codexqa-code-analyzer` skill.** Index a local repository into a symbol graph, then review changes, bound regression scope, find test gaps, trace errors, and identify reachable HTTP / RPC / MQ / scheduled-task entries. The Skill, playbook, schemas, and examples are published here; the required `@openqa-cn/codexqa` package is a separately distributed closed-source local analysis engine. Indexing and graph queries run locally without an LLM.
- **Repository renamed from `openqa-skills` to `codexqa`.** The install path is now `npx skills add openqa-cn/codexqa`; badges, links, citation metadata, and documentation titles use the new name. The old GitHub URL redirects. GitHub About leads with the name, and topics traded three low-signal terms (`developer-tools`, `verification`, `code-graph`) for `sast`, `code-analysis`, and `agentskills`.
- **The README now leads with the verification bottleneck.** AI makes a green PR cheap; CodexQA makes the remaining work—requirements, impact, review evidence, cases, and test data—bounded and checkable. The README shows how the published skills fit together, distinguishes the four code-facing workflows, publishes the evidence status of every skill, and provides separate first-success paths for `codexqa-defect-analyzer` and `codexqa-code-analyzer`. Both language versions use the same value story.
- **Discoverability copy.** README and GitHub About lead with the post-AI-coding pain (change impact, requirement bugs, rubber-stamp review, PRD → cases → testdata) and name Cursor / Claude Code / Codex, so repository search matches how people look for Agent Skills. README H2s now say the hosts and “from a PRD”; topics are filled (20/20), including `agentskills` and `manual-testing`.
- **`codexqa-testcase-generator` and `codexqa-testdata-generator` install from the repo.** Both READMEs (and testdata `INSTALL.md`) now lead with `npx skills add openqa-cn/codexqa --skill …`, matching the other published skill docs. Zip unpack stays as the local-checkout fallback for testdata.
- **README follows a shorter developer-tool path.** It keeps one sample report as visual proof, then moves from the skill map to installation and two first-success paths. Detailed codexqa-defect-analyzer methodology, the full language matrix, extra screenshots, and per-skill evidence remain linked from the skill docs, support matrix, examples, and benchmark pages instead of being repeated in the root README.
- **Chinese docs no longer answer fewer questions than the English ones.** `FAQ.zh-CN` was missing where reports and configuration are stored and whether detection accuracy has been measured — both linked from the Chinese README as if they existed. `GETTING_STARTED.zh-CN` regained the standalone troubleshooting table, the local-verification steps and the environment caveats; `SUPPORT_MATRIX.zh-CN` regained the Linux CI, ZIP packaging, Windows and evidence-schema rows; `skills/README.zh-CN.md` is new. `scripts/check-docs.py` now fails when a language pair's section counts diverge, and known-shorter files must declare themselves in `translation_gaps` (three do, including the untranslated `codexqa-defect-analyzer` README sections).
- **`codexqa-defect-analyzer`: branch arguments accept the ref you actually have.** `--branch` and `--base-branch` now take `origin/master`, `refs/heads/master` or `refs/remotes/origin/master` as well as a plain `master`. Previously `--base-branch origin/master` was expanded into `origin/origin/master` and the run failed with an unresolvable base revision. Branch names containing a slash (`release/1.0`) are preserved rather than truncated to their last segment.
- **`codexqa-defect-analyzer`: default-branch detection no longer guesses.** The base branch is resolved from remote `HEAD`, then `main` / `master` / `develop`, checking refs already in the clone before going to the network. The local `origin/HEAD` is ignored when it points at the branch being scanned, which a `--single-branch` clone always makes it do — that previously made a client-repo merge-base diff against the branch itself. When nothing resolves, the command fails with an error naming `--base-branch` / `--contrast-commit` instead of falling back to a hardcoded `master`.
- **`codexqa-defect-analyzer`: submitting a task says what it did.** `submit-plan` / `submit-git` / `submit-skill-direct` now report the task as *registered* at `status=in_progress`, state that nothing is scanning yet, and name the next command. The agent is the worker — there is no background scanner — and “detection task submitted!” read as though one had started. `KNOWN_LIMITATIONS` documents this, along with what an abandoned run leaves behind and how to clean it up with `force-abort-task`.

### Internal

- `codexqa-code-wiki`: HTML reports now use DeepWiki wiki layout (left sidebar tree, article, on-this-page TOC) while keeping the original dark Claude chrome; default filled copy stays 简体中文.
- Root README (EN/zh-CN) rewritten as a product landing page: first-screen value line, eight skill HTML report screenshots, three-step start, capability icons, audience, star CTA, changelog badges, and openqa.cn links.
- README product name is `CodexQA`; Chinese/English share one GitHub homepage via in-page anchors; Star CTA opens the repo and keeps the stargazers list; zero-model install check clones this repo first because `npx skills add` does not copy `examples/`.
- Renamed `code-wiki` to `codexqa-code-wiki` (directory, frontmatter `name`, catalog, and docs).
- Canonical docs/product URL is [openqa.cn](https://openqa.cn/). Removed the in-repo VitePress `website/` tree and GitHub Pages docs workflow so ranking is not split.
- Search playbooks in `seo/` (intent map, directories, measurement).
- Synced docs for `codexqa-code-wiki` (architecture wiki) alongside the `codexqa-*` skill rename.
- **Renamed all eight published skills** to the `codexqa-*` namespace (directories, `SKILL.md` `name`, `skills.json`, catalog, CI paths, and docs): `ai-code-reviewer`→`codexqa-code-reviewer`, `code-analyzer`→`codexqa-code-analyzer`, `defect-detection`→`codexqa-defect-analyzer`, `requirements-analyzer`→`codexqa-requirement-analyzer`, `root-cause-diagnosis`→`codexqa-rootcause-analyzer`, `skill-router`→`codexqa-skill-router`, `testdata-generation`→`codexqa-testdata-generator`, `testcase-generation`→`codexqa-testcase-generator`. Install with `npx skills add openqa-cn/codexqa --skill <new-name>`.
- `codexqa-code-reviewer` v0.0.3: new **Agent LLM judgment** dimension (order 16) — host embedded model reviews pack-scoped diffs, then `merge-llm-findings.py` dedupes/merges against heuristic findings (`22-llm-judgment.json`).
- `codexqa-defect-analyzer` v0.0.2 / pipeline 1.3.0: first-class **Agent LLM Detection** dimension (`prompts/agent_detect.md`) — host embedded model runs one analysis round, then Stage2 verify; `finalize` dedupes/merges with deterministic SAST/lint/secrets/SCA and stamps `dimension` on findings.
- Docs: synced root README, FAQ, ROADMAP, SUPPORT_MATRIX, Getting Started, skills index, and per-skill README/HOW_IT_WORKS/KNOWN_LIMITATIONS (EN/zh) to the Agent LLM judgment / Agent LLM Detection contracts; refreshed `codexqa-skill-router` `catalog.json` from SKILL frontmatter.
- Docs: listed `codexqa-skill-router` across root README, FAQ, Getting Started, HOW_IT_WORKS index, ROADMAP, ARCHITECTURE, CONTRIBUTING, and PUBLISHING (EN/zh), including install commands, evidence rows, and catalog-refresh release steps.
- Added `codexqa-skill-router` v1.1: bundled `references/catalog.json` + `ensure_skill.py` so a solo router install can match workers and fetch them on demand before hand-off; `discover_skills.py --with-catalog` merges live siblings with the catalog.
- Added `codexqa-skill-router`: live discovery of sibling skills via `scripts/discover_skills.py`, semantic hand-off to the matched skill; new skills with `SKILL.md` are auto-routable without editing the router.
- Replaced `codexqa-testcase-generator` with the V56 Plan/Exec/Incremental skill from `resource/ai-testcase-generation` (Python stage gates, local Markdown only; removed the prior Node integrations / `generation/` playbook).
- Added Stage 6 aggregated HTML case report (`scripts/generate_case_report.py` → `testdesign/testcase_generation_report.html`) with Web / Server / APP panels, zh/EN UI, and light/dark themes.
- Removed the playbook `code-reviewer` skill; graph-evidence review remains via `codexqa-code-reviewer`. Registry, docs, CI, and sibling skill boundaries no longer reference `skills/code-reviewer`.
- Synced repository human docs (README, FAQ, SUPPORT_MATRIX, Getting Started, CONTRIBUTING, skills index) to the current seven-skill set and V56 testcase contracts.

## 0.2.0 — 2026-09-08

Five published skills at this tag. This was the first release that included `codexqa-defect-analyzer`, `code-reviewer`, `codexqa-requirement-analyzer`, `codexqa-testcase-generator`, and `codexqa-testdata-generator` together.

### Highlights

- **Five vendor-neutral skills.** The pack is `codexqa-defect-analyzer`, `code-reviewer`, `codexqa-requirement-analyzer`, `codexqa-testcase-generator`, and `codexqa-testdata-generator`. Sample language is inventory-hold / account credit, not a consumer app.
- **Sample reports you can see.** Root README and each skill README include screenshots of the defect HTML report, a generated case, a CR findings page, a requirements gap register, and testdata write-back. Pages live in `docs/assets/previews/` and are illustrations, not a recorded agent run.
- **Ten languages, not just Java.** Java, Kotlin, Scala, JavaScript, TypeScript, Python, Go, C, C++, and C# get language-aware method extraction, per-language write-back conventions, and their own Semgrep packs (102 seed rules).
- **A reproducible blind evaluation.** [`examples/inventory-service`](examples/inventory-service/README.md) hides seven business-logic defects plus four decoys. One recorded agent run scored 7/7 recall and 7/7 precision — one model, one run, not a benchmark.
- **Docs that travel with the skill.** `HOW_IT_WORKS` / `KNOWN_LIMITATIONS` live inside each skill directory. Relative links cannot escape the skill; cross-skill links use absolute GitHub URLs.
- **Windows paths and optional scanners.** Runtime data is not hardcoded to `/tmp`. `run-optional-overlays` runs third-party scanners when they are installed.
- **License GitHub can detect.** `LICENSE` is the full Apache License 2.0 text. `code-reviewer` remains MIT.

## 0.1.2 — 2026-09-05

### Highlights

- Multilingual quickstart, corrected roadmap status, and editor configuration.

## 0.1.1 — 2026-09-05

### Highlights

- Documentation and community-readiness polish.

## 0.1.0 — 2026-09-05

### Highlights

- Initial public verification-skill repository.
