# 能力地图与路线图

[English](ROADMAP.md)

codexqa 的产品方向覆盖 AI 软件工程全生命周期的质量验证。本仓库当前提供 [`defect-detection`](../skills/defect-detection/README.zh-CN.md)、[`code-reviewer`](../skills/code-reviewer/README.zh-CN.md)、[`requirements-analyzer`](../skills/requirements-analyzer/README.zh-CN.md)、[`testcase-generation`](../skills/testcase-generation/README.zh-CN.md) 和 [`testdata-generation`](../skills/testdata-generation/README.zh-CN.md)。除非特别说明，下表中标记为**已提供**或**部分提供**的能力都由这些工作流提供；其余条目是规划方向，不代表已经包含在当前仓库中。

## 能力地图

| 能力 | 当前仓库状态 | 范围 |
| --- | --- | --- |
| 缺陷检测 | **已提供** | 面向代码变更、测试计划和交付任务的 Agent 静态与业务逻辑审查 |
| 代码分析 | **部分提供** | 基于 AST 规则和变更方法分析；更多语言和框架仍在扩展 |
| 需求评审 | **已提供** | 对需求文档做缺口/冲突分析（`requirements-analyzer`）；实现是否符合需求仍是计划中 |
| 规格评审 | **计划中** | 检查技术规格的完整性、一致性和可测试性 |
| AI Code Review | **已提供** | Playbook 驱动的 PR / 分支 / commit 审查（`code-reviewer`）；尚无公开 fixture |
| 变更影响分析 | **部分提供** | 通过 GitNexus 提供 Java 调用图路径，并有降级行为；跨仓影响分析仍在规划 |
| 测试执行编排 | **计划中** | 在验证工作流中运行现有测试框架并采集结果 |
| 代码覆盖率分析 | **计划中** | 覆盖率质量信号和需求到测试的覆盖分析 |
| UI 端到端测试 | **计划中** | 浏览器和 UI 工作流生成、执行与结果集成 |
| 测试用例生成 | **已提供** | 根据 PRD、技术方案、接口契约和知识库生成并增量更新结构化手工用例 |
| 测试数据构造 | **已提供** | 通过 domain slot、工具、API 和生成脚本构造可复用测试数据，并回写到用例前置条件 |
| 问题定位与诊断 | **部分提供** | 发现结果包含位置、触发条件、分析依据和修复建议；更深入的根因诊断仍在建设 |
| 证据采集与结构化发现 | **已提供** | 发现校验、写回、排序、标签和可追踪 HTML 报告 |
| 本地 provider 与报告 | **已提供** | 本地优先的 JSON 持久化和报告生成，不依赖私有后端 |
| 企业与外部系统集成 | **部分提供** | HTTP 和 GitHub 适配器已有代码，需要部署配置 |
| 质量门禁与发布决策 | **产品方向** | 将验证结果连接到 CI 门禁和发布流程 |
| 托管验证服务 | **产品方向** | 不在本仓库中的 codexqa 托管工程系统 |

## 状态说明

**已提供**表示当前仓库可用；**部分提供**表示已有工作路径，但覆盖范围或集成仍不完整；**计划中**表示尚未在本仓库交付；**产品方向**表示 codexqa 更大的平台目标。

只有实现、案例和局限性都已公开的能力，才会在本仓库标记为「已提供」。逐个组件核对到哪一步：[支持矩阵](SUPPORT_MATRIX.zh-CN.md)。这些工作流做不到什么：[已知边界](../skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md)。

## 顺序

- **现在：** 加固干净环境安装、Agent 兼容性、公开案例和开发者文档。
- **下一步：** 按同一套「证据 + 人工复核」约定，增加规格评审、需求评审和更广泛的分析 skill。
- **之后：** 接入跨仓影响分析、AI Code Review、CI 质量门禁和托管工程系统。

进度见[公开路线图](https://openqa.cn/roadmap)。已发布的变更见[更新日志](../CHANGELOG.md)。
