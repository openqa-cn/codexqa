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
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

`check-docs.py` covers all published skills (relative links must stay inside each skill directory). `code-reviewer`, `requirements-analyzer`, `testcase-generation`, and `testdata-generation` have no equivalent CLI test suite; verify those changes with the checks in each skill's `CONTRIBUTING.md`. The defect-detection suite requires Git and packaging tools (Bash, rsync, zip, unzip). Include OS, Node version, commit, and results in your PR. Passing CLI tests do not measure model detection accuracy.

## Useful contributions

Submit minimal public reproductions of false positives or missed defects, expected results, agent/model versions, and sanitized evidence. Include a known-good control when possible. For installation issues, specify agent, installation scope, Node version, and the exact command. See [examples](examples/README.md).
