# 各 skill 的工作原理

[English](HOW_IT_WORKS.md)

索引页。`npx skills add … --skill <name>` 只复制 `skills/<name>/`，因此原理文档必须放在对应 skill 目录。安装后读该目录下的「工作原理」，不要依赖本页正文。

| 文档 | 用途 |
| --- | --- |
| skill 内 `HOW_IT_WORKS*` | 数据流、约束、停点、产物路径 |
| skill 内 `KNOWN_LIMITATIONS*` | 未实现 / 未测量项 |
| skill 内 `SKILL.md` | Agent 运行时入口与路由 |

| Skill | 人读 | Agent |
| --- | --- | --- |
| `defect-detection` | [工作原理](../skills/defect-detection/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/defect-detection/SKILL.md) |
| `code-reviewer` | [工作原理](../skills/code-reviewer/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/code-reviewer/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/code-reviewer/SKILL.md) |
| `requirements-analyzer` | [工作原理](../skills/requirements-analyzer/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/requirements-analyzer/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/requirements-analyzer/SKILL.md) |
| `testdata-generation` | [工作原理](../skills/testdata-generation/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/testdata-generation/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/testdata-generation/SKILL.md) |
| `testcase-generation` | [工作原理](../skills/testcase-generation/HOW_IT_WORKS.zh-CN.md) · [已知边界](../skills/testcase-generation/KNOWN_LIMITATIONS.zh-CN.md) | [`SKILL.md`](../skills/testcase-generation/SKILL.md) |

各 skill 要交什么（仓库 / PRD / 用例与 API）：[FAQ](FAQ.zh-CN.md#每个-skill-要我交什么)。产物长什么样：[README 预览](../README.zh-CN.md#产物长什么样)。

安装、贡献、安全策略、目录和[支持矩阵](SUPPORT_MATRIX.zh-CN.md)在本目录。[文档读者划分](ARCHITECTURE.md#documentation-audiences)。
