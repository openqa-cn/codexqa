# Changelog

Each release has two sections. **Highlights** is what changes for someone using the skills. **Internal** is the full engineering record — refactors, test changes, and fixes with no user-visible effect. If you are upgrading, Highlights is enough.

## Unreleased

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
