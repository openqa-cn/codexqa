# Changelog

Each release has two sections. **Highlights** is what changes for someone using the skills. **Internal** is the full engineering record — refactors, test changes, and fixes with no user-visible effect. If you are upgrading, Highlights is enough.

## Unreleased

### Highlights

- **Discoverability copy.** README and GitHub About lead with the post-AI-coding pain (requirement bugs, rubber-stamp review, PRD → cases → testdata) and name Cursor / Claude Code / Codex, so repository search matches how people look for Agent Skills. README H2s now say the hosts and “from a PRD”; topics are filled (20/20), including `agentskills` and `manual-testing`.
- **`testcase-generation` and `testdata-generation` install from the repo.** Both READMEs (and testdata `INSTALL.md`) now lead with `npx skills add openqa-cn/codexqa --skill …`, matching the other three skills. Zip unpack stays as the local-checkout fallback for testdata.
- **README leads with the report instead of a status table.** The header is one centered block (badges, language switcher, nav) followed by the sample defect report, so the first screen shows what the tool produces. The 17-row capability map and the roadmap moved to [`docs/ROADMAP.md`](docs/ROADMAP.md) — the README no longer describes the same five skills four times. New: a host and language support table (10 languages, which overlays are optional), a *why a skill, not another platform* section, and an intent-oriented documentation table that finally links the changelog, `benchmarks/`, and the commercial boundary. The four secondary quick-start recipes are collapsed; `#quick-start` and `#what-the-output-looks-like` anchors are unchanged.
- **Chinese docs no longer answer fewer questions than the English ones.** `FAQ.zh-CN` was missing where reports and configuration are stored and whether detection accuracy has been measured — both linked from the Chinese README as if they existed. `GETTING_STARTED.zh-CN` regained the standalone troubleshooting table, the local-verification steps and the environment caveats; `SUPPORT_MATRIX.zh-CN` regained the Linux CI, ZIP packaging, Windows and evidence-schema rows; `skills/README.zh-CN.md` is new. `scripts/check-docs.py` now fails when a language pair's section counts diverge, and known-shorter files must declare themselves in `translation_gaps` (three do, including the untranslated `defect-detection` README sections).
- **`defect-detection`: branch arguments accept the ref you actually have.** `--branch` and `--base-branch` now take `origin/master`, `refs/heads/master` or `refs/remotes/origin/master` as well as a plain `master`. Previously `--base-branch origin/master` was expanded into `origin/origin/master` and the run failed with an unresolvable base revision. Branch names containing a slash (`release/1.0`) are preserved rather than truncated to their last segment.
- **`defect-detection`: default-branch detection no longer guesses.** The base branch is resolved from remote `HEAD`, then `main` / `master` / `develop`, checking refs already in the clone before going to the network. The local `origin/HEAD` is ignored when it points at the branch being scanned, which a `--single-branch` clone always makes it do — that previously made a client-repo merge-base diff against the branch itself. When nothing resolves, the command fails with an error naming `--base-branch` / `--contrast-commit` instead of falling back to a hardcoded `master`.
- **`defect-detection`: submitting a task says what it did.** `submit-plan` / `submit-git` / `submit-skill-direct` now report the task as *registered* at `status=in_progress`, state that nothing is scanning yet, and name the next command. The agent is the worker — there is no background scanner — and “detection task submitted!” read as though one had started. `KNOWN_LIMITATIONS` documents this, along with what an abandoned run leaves behind and how to clean it up with `force-abort-task`.

## 0.2.0 — 2026-09-08

Five published skills on current `main`. This is the first tag that includes `defect-detection`, `code-reviewer`, `requirements-analyzer`, `testcase-generation`, and `testdata-generation` together.

### Highlights

- **Five vendor-neutral skills.** The pack is `defect-detection`, `code-reviewer`, `requirements-analyzer`, `testcase-generation`, and `testdata-generation`. Sample language is inventory-hold / account credit, not a consumer app.
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
