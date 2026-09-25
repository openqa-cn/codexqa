# Contributing to codexqa

We welcome skills, adapters, benchmark cases, documentation, and reproducible bug reports.

Agent-assisted contributions are welcome. They must include human maintainer review and reproducible evidence; generated code or text is not, by itself, evidence of correctness.

## Before opening a pull request

- Explain the user problem and the expected verification outcome.
- Include a runnable example.
- Include a failing or seeded-defect case where possible.
- State supported agents, languages, frameworks, and limitations.
- Do not include customer code, credentials, private logs, or proprietary data.

## Quality bar

A contribution should make it easier to distinguish a test that merely passes from a test that proves behavior.

## Local verification

From the repository root:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/codexqa-defect-analyzer && npm test)
node examples/checkout-boundary/verify.mjs
(cd skills/codexqa-testcase-generator && ./scripts/tcg-python scripts/close_stage.py --self-check && ./scripts/tcg-python scripts/check_run_gate.py --self-check && ./scripts/tcg-python scripts/generate_case_report.py --self-check)
python3 skills/codexqa-skill-router/scripts/discover_skills.py --self-check
```

`check-docs.py` covers all published skills (relative links must stay inside each skill directory). `codexqa-code-analyzer`, `codexqa-change-analysis`, `codexqa-code-wiki`, `codexqa-code-reviewer`, `codexqa-requirement-analyzer`, `codexqa-testcase-generator`, and `codexqa-testdata-generator` have no equivalent CLI test suite; verify those changes with the checks in each skill's `CONTRIBUTING.md` (for `codexqa-testcase-generator`, run `scripts/tcg-python scripts/close_stage.py --self-check`, `check_run_gate.py --self-check`, and `generate_case_report.py --self-check`). For `codexqa-skill-router`, run `scripts/discover_skills.py --self-check` and optionally `ensure_skill.py --dry-run <name>`. For `codexqa-jev-browser`, run `npm install && npm test` in its directory. After adding a worker skill, refresh `skills/codexqa-skill-router/references/catalog.json` with `scripts/refresh_catalog.py`. The codexqa-defect-analyzer suite requires Git and packaging tools (Bash, rsync, zip, unzip). Include OS, Node version, commit, and results in your PR. Passing CLI tests do not measure model detection accuracy.

When you change `docs/` or skill READMEs, `python3 scripts/check-docs.py` is enough for this repo. GitHub About, topics, and social preview live in repository Settings, not in git. Version tags and published Releases get notes from [`.github/release-notes.md`](.github/release-notes.md) via [`.github/workflows/release-notes.yml`](.github/workflows/release-notes.yml) (`https://openqa.cn/` is injected if missing).

## Useful contributions

Submit minimal public reproductions of false positives or missed defects, expected results, agent/model versions, and sanitized evidence. Include a known-good control when possible. For installation issues, specify agent, installation scope, Node version, and the exact command. See [examples](examples/README.md).
