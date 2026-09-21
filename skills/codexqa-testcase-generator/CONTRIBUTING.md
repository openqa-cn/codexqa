# Contributing

## Contract

- `SKILL.md` `name` is kebab-case and matches this directory (`codexqa-testcase-generator`).
- `SKILL.md` is the agent execution map: route first, then load only the references that scope needs.
- Relative links must stay inside this directory. Cross-repo references use absolute GitHub URLs (`scripts/check-docs.py` enforces both).
- Do not invent business facts. Missing information stays pending clarification / TBD.
- Do not connect to case or doc platforms. Do not call an external knowledge-retrieval Skill.

## Layout

```
SKILL.md                 agent execution map (routing + stage table)
user-guide.md            human how-to and current policy
HOW_IT_WORKS.md          data flow (human)
KNOWN_LIMITATIONS.md     unimplemented / unmeasured
README.md                install + overview
references/              stage specs, templates, incremental specs
scripts/                 close_stage / check_run_gate / generate_case_report / ingest / knowledge / incremental
scripts/tcg-python       Python 3.10+ resolver for hosts with old python3
```

## Security (skill-specific)

Vulnerability reporting is at the repository level: [SECURITY.md](https://github.com/openqa-cn/codexqa/blob/main/SECURITY.md). For this skill specifically:

- Do not commit tokens, cookies, or private PEM material.
- Knowledge-repo and PR fetch use only URLs the user explicitly supplies this turn.
- Stage 0 fetches only document URLs given this turn; it does not crawl page-internal links.

## Checks

From this skill directory:

```bash
./scripts/tcg-python scripts/close_stage.py --self-check
./scripts/tcg-python scripts/check_run_gate.py --self-check
./scripts/tcg-python scripts/generate_case_report.py --self-check
```

From the repository root:

```bash
python3 scripts/check-docs.py
```

There is no published Plan→Exec fixture and no measured coverage score — do not add a fake benchmark.

Public docs, comments, identifiers, and config keys are written in English. `HOW_IT_WORKS.zh-CN.md` / `README.zh-CN.md` / `KNOWN_LIMITATIONS.zh-CN.md` track the English source.
