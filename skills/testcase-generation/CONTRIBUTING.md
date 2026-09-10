# Contributing

## Contract

- `SKILL.md` `name` is kebab-case and matches this directory.
- `SKILL.md` is routing only. Generate bodies live in `generation/phase-*.md`; the orchestrator is `generation/generate-skill.md`.
- Case-generation duty is `generation/subagent-gen-duty.md`. Quote it verbatim. Do not copy duty text into `generate-skill.md` or `maintenance/update-skill.md`.
- Relative links must stay inside this directory. Cross-repo references use absolute GitHub URLs (`scripts/check-docs.py` enforces both).
- Do not infer engineering identifiers. Unstated fields stay `TBD`. Do not fill `{placeholder}` here — that is `testdata-generation`.

## Layout

```
SKILL.md                 routing, hand-off, scripts
HOW_IT_WORKS.md          data flow and constraints (human)
KNOWN_LIMITATIONS.md     unimplemented / unmeasured
generation/              generate orchestrator + phase-*.md + guides + quality gates
maintenance/             incremental update
scripts/                 validate / call integrations (Node 22.6+, no npm install)
config/                  default / example YAML + schema
references/              HTTP adapter contract
evals/                   representative prompts; no published fixture
```

## Security (skill-specific)

Vulnerability reporting is at the repository level: [SECURITY.md](https://github.com/openqa-cn/codexqa/blob/main/SECURITY.md). For this skill specifically:

- Do not commit tokens, cookies, PEM files, or an `integrations.yaml` that contains secrets.
- Put credentials in environment variables (`${OAUTH_CLIENT_SECRET}`, `${MTLS_CERT_PATH}`).
- Zero-config reads local `prd/` and `knowledge/` only. Enterprise HTTP is opt-in.

## Checks

From the repository root:

```bash
python3 scripts/check-docs.py
node --experimental-strip-types --experimental-default-type=module \
  skills/testcase-generation/scripts/validate_integrations.ts --help
node --experimental-strip-types --experimental-default-type=module \
  skills/testcase-generation/generation/quality-gates/lint_case_documents.ts --help
```

`lint_case_documents.ts` is the deterministic R4 structure check. There is no published case fixture and no measured coverage score — do not add a fake benchmark.

Public docs, comments, identifiers, and config keys are written in English. `HOW_IT_WORKS.zh-CN.md` / `README.zh-CN.md` / `KNOWN_LIMITATIONS.zh-CN.md` track the English source.
