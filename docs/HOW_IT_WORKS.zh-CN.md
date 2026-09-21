# 各 skill 的工作原理

[English](HOW_IT_WORKS.md)

索引页。`npx skills add … --skill <name>` 只复制 `skills/<name>/`，因此原理文档必须放在对应 skill 目录。每个已发布 skill 都有人读的工作流和边界文档，以及 Agent 运行时使用的 `SKILL.md`。安装后读表中链接的 skill 内文档，不要依赖本页正文。

| 文档 | 用途 |
| --- | --- |
| skill 内 `HOW_IT_WORKS*` | 数据流、约束、停点、产物路径 |
| skill 内 `KNOWN_LIMITATIONS*` | 未实现 / 未测量项 |
| skill 内 `SKILL.md` | Agent 运行时入口与路由 |

| Skill | 人读 | Agent |
| --- | --- | --- |
| `codexqa-skill-router` | [工作原理](../skills/codexqa-skill-router/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-skill-router/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-skill-router/SKILL.md) |
| `codexqa-code-analyzer` | [工作流](../skills/codexqa-code-analyzer/README.zh-CN.md) · [已知边界](../skills/codexqa-code-analyzer/KNOWN_LIMITATIONS.zh-CN.md) · [分析 playbook](../skills/codexqa-code-analyzer/references/playbook.md) | [`SKILL.md`](../skills/codexqa-code-analyzer/SKILL.md) |
| `codexqa-rootcause-analyzer` | [工作原理](../skills/codexqa-rootcause-analyzer/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-rootcause-analyzer/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-rootcause-analyzer/SKILL.md) |
| `codexqa-code-wiki` | [工作流](../skills/codexqa-code-wiki/README.zh-CN.md) · [已知边界](../skills/codexqa-code-wiki/KNOWN_LIMITATIONS.zh-CN.md) · [Wiki playbook](../skills/codexqa-code-wiki/references/playbook.md) | [`SKILL.md`](../skills/codexqa-code-wiki/SKILL.md) |
| `codexqa-defect-analyzer` | [工作原理](../skills/codexqa-defect-analyzer/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-defect-analyzer/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-defect-analyzer/SKILL.md) |
| `codexqa-code-reviewer` | [工作原理](../skills/codexqa-code-reviewer/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-code-reviewer/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-code-reviewer/SKILL.md) |
| `codexqa-requirement-analyzer` | [工作原理](../skills/codexqa-requirement-analyzer/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-requirement-analyzer/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-requirement-analyzer/SKILL.md) |
| `codexqa-testdata-generator` | [工作原理](../skills/codexqa-testdata-generator/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-testdata-generator/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-testdata-generator/SKILL.md) |
| `codexqa-testcase-generator` | [工作原理](../skills/codexqa-testcase-generator/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/codexqa-testcase-generator/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/codexqa-testcase-generator/SKILL.md) |

各 skill 要交什么（仓库 / PRD / 用例与 API）：[FAQ](FAQ.zh-CN.md#每个-skill-要我交什么)。产物长什么样：[README 预览](../README.zh-CN.md#测试验证所有技能概览)。

安装、贡献、安全策略、目录和[支持矩阵](SUPPORT_MATRIX.zh-CN.md)在本目录。[文档读者划分](ARCHITECTURE.md#documentation-audiences)。
