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
| `code-analyzer` | [Workflow](../skills/code-analyzer/README.md) · [Known limitations](../skills/code-analyzer/KNOWN_LIMITATIONS.md) · [Playbook](../skills/code-analyzer/references/playbook.md) | [`SKILL.md`](../skills/code-analyzer/SKILL.md) |
| `root-cause-diagnosis` | [How it works](../skills/root-cause-diagnosis/HOW_IT_WORKS.md) · [Known limitations](../skills/root-cause-diagnosis/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/root-cause-diagnosis/SKILL.md) |
| `defect-detection` | [How it works](../skills/defect-detection/HOW_IT_WORKS.md) · [Known limitations](../skills/defect-detection/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/defect-detection/SKILL.md) |
| `ai-code-reviewer` | [How it works](../skills/ai-code-reviewer/HOW_IT_WORKS.md) · [Known limitations](../skills/ai-code-reviewer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/ai-code-reviewer/SKILL.md) |
| `requirements-analyzer` | [How it works](../skills/requirements-analyzer/HOW_IT_WORKS.md) · [Known limitations](../skills/requirements-analyzer/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/requirements-analyzer/SKILL.md) |
| `testdata-generation` | [How it works](../skills/testdata-generation/HOW_IT_WORKS.md) · [Known limitations](../skills/testdata-generation/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/testdata-generation/SKILL.md) |
| `testcase-generation` | [How it works](../skills/testcase-generation/HOW_IT_WORKS.md) · [Known limitations](../skills/testcase-generation/KNOWN_LIMITATIONS.md) | [`SKILL.md`](../skills/testcase-generation/SKILL.md) |

What to bring to each skill (repo vs PRD vs cases/API): [FAQ](FAQ.md#what-do-i-have-to-give-each-skill). What the artifacts look like: [README previews](../README.md#what-the-output-looks-like).

Install, contributing, security, layout, and the [support matrix](SUPPORT_MATRIX.md) stay here. [Documentation audiences](ARCHITECTURE.md#documentation-audiences).
