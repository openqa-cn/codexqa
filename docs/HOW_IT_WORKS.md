# How the skills work

[简体中文](HOW_IT_WORKS.zh-CN.md)

Index only. `npx skills add … --skill <name>` copies `skills/<name>/`, so method docs must live in that directory. After install, read the skill’s How it works page, not this file.

| Doc | Role |
| --- | --- |
| `HOW_IT_WORKS*` in the skill | Data flow, constraints, stops, artifact paths |
| `KNOWN_LIMITATIONS*` in the skill | Unimplemented / unmeasured behavior |
| `SKILL.md` in the skill | Agent entry and routing |

| Skill | Human | Agent |
| --- | --- | --- |
| `defect-detection` | [How it works](../skills/defect-detection/HOW_IT_WORKS.md) · [Known limitations](../skills/defect-detection/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/defect-detection/SKILL.md) |
| `code-reviewer` | [How it works](../skills/code-reviewer/HOW_IT_WORKS.md) · [Known limitations](../skills/code-reviewer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/code-reviewer/SKILL.md) |
| `requirements-analyzer` | [How it works](../skills/requirements-analyzer/HOW_IT_WORKS.md) · [Known limitations](../skills/requirements-analyzer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/requirements-analyzer/SKILL.md) |
| `testdata-generation` | [How it works](../skills/testdata-generation/HOW_IT_WORKS.md) · [Known limitations](../skills/testdata-generation/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/testdata-generation/SKILL.md) |
| `testcase-generation` | [How it works](../skills/testcase-generation/HOW_IT_WORKS.md) · [Known limitations](../skills/testcase-generation/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/testcase-generation/SKILL.md) |

What to bring to each skill (repo vs PRD vs cases/API): [FAQ](FAQ.md#what-do-i-have-to-give-each-skill).

Install, contributing, security, layout, and the [support matrix](SUPPORT_MATRIX.md) stay here. [Documentation audiences](ARCHITECTURE.md#documentation-audiences).
