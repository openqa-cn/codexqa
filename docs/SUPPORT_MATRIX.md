# Compatibility and verification status

[简体中文](SUPPORT_MATRIX.zh-CN.md)

Installation compatibility does not establish analysis quality. Record agent/model, runtime, OS, commit, and actual outcome before expanding a support claim. Rows below are `defect-detection` unless named otherwise. Sample artifacts: [README previews](../README.md#what-the-output-looks-like).

| Component | Current evidence | Limitations |
| --- | --- | --- |
| TypeScript CLI | Local suite previously passed 94 tests on macOS, Node 22.15.0 with TypeScript stripping | Results cover tested behaviors, not all defects |
| Linux / Node 22 | CI job configured in this repository | Hosted result must be checked after pushing |
| Codex, Claude Code, Cursor, OpenClaw | Skill instructions name these hosts | Complete host-by-host review runs are pending |
| Java method / call graph | Extraction and GitNexus integration code and tests | External tool results depend on its version and environment |
| Multi-language pipeline (Java, Kotlin, Scala, JS, TS, Python, Go, C, C++, C#) | One language registry (`scripts/lang.ts`) drives language resolution (`languageSource` explicit / declared / detected), per-language method extraction with Semgrep-refined ranges (`scripts/lang_methods.ts`), trivial-method conventions, className / filePath / code-fence conventions and per-language detection notes (`references/rules/*-gotchas.md`); polyglot E2E test (`tests/multilang_e2e.test.ts`: Python + Go + TS repo through submit → clone → plan → read → verify → template) and per-language extractor tests | Regex/brace extractors, not full parsers; nested/anonymous functions and macro-heavy C are approximated; no language-specific call graph beyond GitNexus |
| Semgrep seed packs (10 languages) | 102 rules with CWE / OWASP Top 10 2025 / ASVS 5.0 metadata, validated on Semgrep 1.99 against a 10-language fixture (67 hits, 0 parse errors); rules are filtered by the language set of the scanned files; rules an older Semgrep rejects are dropped per version and reported in `droppedRules` | Taint rules are intra-function (Community Edition); Semgrep 0.8x loads only the non-taint subset; seeds catch shallow patterns and do not replace method-level analysis |
| Optional overlays | Registry in `scripts/overlays.ts`: gitleaks, trivy / grype, bandit, gosec, go vet, staticcheck, cppcheck, eslint, detekt; parsers and runner covered by stubbed-binary unit tests | No real-binary CI run yet; native tools need the project's own config (eslint) or toolchain (go) |
| JS / TS AST | Semgrep seed rules + `run-ast-scan` language filter; checkout-boundary fixture hit covered by unit test | Seed rules catch shallow patterns only (e.g. `amount < 0`); they do **not** replace method-level business analysis |
| JS / TS method-level | Language-aware unit extraction (`scripts/lang_methods.ts`) builds a real detection plan for `.js/.mjs/.ts/...`; blind eval on `inventory-service` reservation-v2 (7 planted defects across cross-method state, race, spec deviation, boundary, swallowed exception, lock leak, cross-file invariant + 4 traps): **recall 7/7, precision 7/7, 0 trap FPs** (Composer agent, 2026-09-08, runtime-confirmed) | One agent/model sample; not a multi-model benchmark. Doc relevance still needs `add-document` (now seeds `extractedRules`) or `check-phase2-readiness` to lift T3 tiers |
| Python AST | 17 Semgrep seed rules (incl. except-pass, `== None`, mutable default, SQL / shell / pickle / SSRF / redirect / XSS taint) + language filter unit test | Method-level extraction is indentation-based; no call graph beyond GitNexus |
| Frontend NL rules | FE natural-language rules (FE-001 ~ FE-012) + `frontend-gotchas.md` with Node/TypeScript subsections | No comprehensive framework support claim |
| Local providers | Task lifecycle, fixtures, reports, and writeback tests | Concurrent or multi-user operation is not certified |
| HTTP / GitHub providers | Adapter implementation and selected HTTP contract tests | Real deployment credentials and integration verification required |
| ZIP packaging | Pack/unpack smoke test | Requires Bash, rsync, zip, unzip |
| Windows (defect-detection) | Runtime paths come from the data dir (no `/tmp`), `.cmd` shims handled in `scripts/sys.ts`, fixture builder is plain Node, `.gitattributes` forces LF | Not yet run on a Windows CI host; Semgrep on Windows is beta, GitNexus untested; Quick-start snippets assume Git Bash / WSL |
| Windows | Not verified | Shell commands and test script are currently POSIX-oriented |
| Evidence schema | Repository schema available | Skill output is not claimed to conform automatically |
| `testcase-generation` scripts | `validate_integrations.ts`, `call_integration.ts`, `lint_case_documents.ts` run on Node 22.6+ with TypeScript stripping; no npm install | No public fixture or recorded agent run; Windows untested; hosts without subagents untested |
| `testdata-generation` scripts | Packer, slot search, and local catalog mock documented in that skill | Runtime depends on the configured adapters and slots; not covered by the defect-detection CLI suite |
| `code-reviewer` playbooks | Offline `tooling/` contract checks (`npm test` in `tooling/`) | No public fixture or recorded host-agent run; report quality is unmeasured |
| `requirements-analyzer` | `evals/` skill-up cases and parse/convert scripts in that skill | No recorded host-agent score; analysis is the model, not `run_analysis.ts` |

One recorded agent end-to-end sample exists (JS reservation-v2 blind eval, recall/precision 7/7 — see the JS/TS method-level row). It is not yet a multi-model public benchmark. See [examples](../examples/README.md) and [benchmark methodology](../benchmarks/README.md).
