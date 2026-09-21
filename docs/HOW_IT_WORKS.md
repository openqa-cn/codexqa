# How the skills work

[简体中文](HOW_IT_WORKS.zh-CN.md)

Index only. `npx skills add … --skill <name>` copies `skills/<name>/`, so method documentation must stay in that directory. Each published skill has human-facing workflow and limitation documents plus an agent-facing `SKILL.md`. After install, read the linked documents in the skill directory, not this page.

| Doc | Role |
| --- | --- |
| `HOW_IT_WORKS*` in the skill | Data flow, constraints, stops, artifact paths |
| `KNOWN_LIMITATIONS*` in the skill | Unimplemented / unmeasured behavior |
| `SKILL.md` in the skill | Agent entry and routing |

| Skill | Human | Agent |
| --- | --- | --- |
| `codexqa-skill-router` | [How it works](../skills/codexqa-skill-router/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-skill-router/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-skill-router/SKILL.md) |
| `codexqa-code-analyzer` | [Workflow](../skills/codexqa-code-analyzer/README.md) · [Known limitations](../skills/codexqa-code-analyzer/KNOWN_LIMITATIONS.md) · [Playbook](../skills/codexqa-code-analyzer/references/playbook.md) | [`SKILL.md`](../skills/codexqa-code-analyzer/SKILL.md) |
| `codexqa-rootcause-analyzer` | [How it works](../skills/codexqa-rootcause-analyzer/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-rootcause-analyzer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-rootcause-analyzer/SKILL.md) |
| `codexqa-code-wiki` | [Workflow](../skills/codexqa-code-wiki/README.md) · [Known limitations](../skills/codexqa-code-wiki/KNOWN_LIMITATIONS.md) · [Playbook](../skills/codexqa-code-wiki/references/playbook.md) | [`SKILL.md`](../skills/codexqa-code-wiki/SKILL.md) |
| `codexqa-defect-analyzer` | [How it works](../skills/codexqa-defect-analyzer/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-defect-analyzer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-defect-analyzer/SKILL.md) |
| `codexqa-code-reviewer` | [How it works](../skills/codexqa-code-reviewer/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-code-reviewer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-code-reviewer/SKILL.md) |
| `codexqa-requirement-analyzer` | [How it works](../skills/codexqa-requirement-analyzer/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-requirement-analyzer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-requirement-analyzer/SKILL.md) |
| `codexqa-testdata-generator` | [How it works](../skills/codexqa-testdata-generator/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-testdata-generator/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-testdata-generator/SKILL.md) |
| `codexqa-testcase-generator` | [How it works](../skills/codexqa-testcase-generator/HOW_IT_WORKS.md) · [Known limitations](../skills/codexqa-testcase-generator/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/codexqa-testcase-generator/SKILL.md) |

What to bring to each skill (repo vs PRD vs cases/API): [FAQ](FAQ.md#what-do-i-have-to-give-each-skill). What the artifacts look like: [README previews](../README.md#overview-of-all-skills).

Install, contributing, security, layout, and the [support matrix](SUPPORT_MATRIX.md) stay here. [Documentation audiences](ARCHITECTURE.md#documentation-audiences).
