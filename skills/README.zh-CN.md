# Skills

[English](README.md)

每个 skill 各自独立成文。已发布的 skill 都有一份给 Agent 读的 `SKILL.md` 和一份给人读的 `README.md`。报告和用例样例：[仓库 README · 产物长什么样](../README.zh-CN.md#产物长什么样)。

## 已发布的 skill

- [`defect-detection`](defect-detection/README.zh-CN.md)：面向 git 分支、PR 和测试计划的本地优先缺陷审查（10 种语言做到方法级；产出 HTML 报告，结论需人工确认）。[工作原理](defect-detection/HOW_IT_WORKS.zh-CN.md)。
- [`testcase-generation`](testcase-generation/README.zh-CN.md)：从 PRD、技术方案、接口规格和知识库生成并增量更新结构化手工用例。用例保留 `{placeholder}`，回填交给 `testdata-generation`。[工作原理](testcase-generation/HOW_IT_WORKS.zh-CN.md)。
- [`testdata-generation`](testdata-generation/README.zh-CN.md)：用 domain slot、工具、API 和生成脚本构造可复用测试数据，并把值回写成用例前置条件。[工作原理](testdata-generation/HOW_IT_WORKS.zh-CN.md)。
- [`code-reviewer`](code-reviewer/README.zh-CN.md)：对本地 Git 工作副本（分支 / PR / commit）做 playbook 驱动的 P0/P1/P2 审查。它不克隆——那是 `defect-detection`。[工作原理](code-reviewer/HOW_IT_WORKS.zh-CN.md)。
- [`requirements-analyzer`](requirements-analyzer/README.zh-CN.md)：对需求文档做质量与风险分析，产出一份带 P0/P1 验证项的缺口 / 冲突登记表。它不写用例——那是 `testcase-generation`。[工作原理](requirements-analyzer/HOW_IT_WORKS.zh-CN.md)。

提新 skill 时用 [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md)。一个够格的贡献要解决一个独立的验证问题、带验收标准、并给出可复现的证据。
