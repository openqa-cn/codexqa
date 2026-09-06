# OpenQA Skills

**面向 Coding Agent 的 AI 缺陷审查 Skill。**

结合代码变更与业务上下文，生成带代码位置、分析依据和修复建议的缺陷候选，供人工复核。

[English](README.md) · [安装与入门](docs/GETTING_STARTED.md) · [可复现示例](examples/checkout-boundary/README.md) · [问题反馈](https://github.com/openqa-cn/openqa-skills/issues)

## 关于 OpenQA

[OpenQA](https://openqa.cn) 正在建设面向 AI 软件工程的验证基础设施。随着 Coding Agent 承担越来越多的实现工作，团队需要一种独立的方法来判断：变更是否满足目标、是否影响了正确的系统范围、是否拥有足以支持合并或发布的直接证据。OpenQA 将这视为软件工程验证问题，而不是继续扩大代码生成 Prompt。

产品方向由几个相互连接但边界不同的层组成：

- **验证 Agent**：在开发者电脑或受控 CI 环境中，为一次具体变更规划并执行验证。
- **Skill Hub**：开放的可复用 Skill 与 MCP 工具目录，让 Agent 能执行聚焦的测试和验证工作流。
- **软件系统与 SaaS 解决方案**：连接需求、用例、缺陷、运行轨迹等工程记录，包括跨仓代码知识图谱和变更影响面分析等能力。
- **工具与评测**：收录测试工具，并通过公开任务和证据记录比较它们在实际场景中的表现。

这些层的发布状态和信任边界不同。官网介绍完整的产品方向和托管能力；本仓库提供其中公开、本地优先的 Skill 层，包括可检查的指令、可执行适配器、案例和测试，开发者可以直接使用和贡献。

- [OpenQA 官网](https://openqa.cn)
- [OpenQA 产品预览](https://openqa.cn/agent)
- [Skill Hub](https://openqa.cn/skills)
- [OpenQA Skills 源码](https://github.com/openqa-cn/openqa-skills)

本仓库不声称 Skill 能证明代码不存在缺陷，而是提供一套可重复的流程：收集上下文、选择检查、保存证据，并将发现交给人工复核。托管执行或组织级能力可能单独提供，详见[商业边界](docs/COMMERCIAL_BOUNDARY.md)。

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Repository checks](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml)

## 安装

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

按提示选择 Agent，默认安装到当前项目。添加 `--agent codex --global` 可为 Codex 全局安装。无需注册 npm，也无需发布 OpenQA 自有 npm 包。命令安装的是 GitHub 上可用的版本。

**运行环境：** Node.js 和 Git。已在 Node 22.15.0 上通过 `NODE_OPTIONS=--experimental-strip-types` 运行测试；Agent 执行命令的环境也需要相应配置。首次分析前请查看[安装与排错说明](docs/GETTING_STARTED.md)。

## 适用场景

- 合并或交付测试前，审查仓库分支中的变更。
- 结合需求和测试用例检查实现。
- 为已有发现补充上下文并记录人工反馈。

当前提供 [ai-defect-detection](skills/ai-defect-detection/README.md)，包含分析指令、TypeScript CLI、静态分析集成、本地存储和可选企业适配器。

## 开始审查

安装后打开新的 Agent 会话，提供类似请求：

```text
使用 ai-defect-detection 审查 <仓库 URL> 的 <分支名>。
业务要求：结账金额必须严格大于零。
重点检查变更代码，给出每个疑似缺陷的位置、触发条件、依据和修复建议。
```

请替换为真实可访问的仓库和分支。分析由 Agent 执行，CLI 本身不提供 AI 模型。缺少业务材料会限制审查范围。

## 输出示例

| 字段 | 边界案例 |
| --- | --- |
| 缺陷候选 | 零金额结账被接受 |
| 触发条件 | `checkout(0)` |
| 预期 / 实际 | 拒绝 / 接受 |
| 依据 | 边界断言在缺陷实现上失败 |
| 修复建议 | 拒绝小于或等于零的金额 |
| 状态 | 待人工复核 |

这是明确标注的演示案例，不代表 Agent 已自动发现该问题。[运行正常与缺陷实现，查看预期结果](examples/checkout-boundary/README.md)。

## 工作流程

1. 收集分支差异、变更方法、规则和可用业务上下文。
2. 结合静态分析候选和 Agent 代码审查。
3. 校验发现的结构，记录分析过程。
4. 生成本地 HTML 报告或已配置平台的报告。
5. 人工确认、驳回或跟进发现。

覆盖检查核对的是流程记录，不等于证明已经发现全部缺陷。疑似缺陷、改进建议和人工决定分别处理。

## 兼容性与数据处理

项目处于 **experimental** 阶段。已有 CLI 测试，完整 Agent 流程和检测准确率尚未完成独立评测，详见[支持矩阵](docs/SUPPORT_MATRIX.md)。

本地 provider 将数据存储在磁盘，无需 OpenQA Cloud 账号；Coding Agent/模型是否发送源码取决于其配置。克隆仓库、远程 provider 和工具安装可能联网。当前分析流程可能自动安装 Semgrep 或 GitNexus，详见[FAQ 与数据边界](docs/FAQ.md)。

## 文档与参与

- [Skill 手册](skills/ai-defect-detection/README.md)：运行要求、适配器和测试。
- [安装与入门](docs/GETTING_STARTED.md)：安装、检查、更新和卸载。
- [示例](examples/README.md)与[评测计划](benchmarks/README.md)：已有证据及待验证事项。
- [贡献指南](CONTRIBUTING.md)：复现问题、补充案例、改善适配器。
- [发布流程](PUBLISHING.md)与[变更记录](CHANGELOG.md)。

欢迎提供误报、漏报案例及已验证的 Agent/运行环境组合。分享前请移除私有代码和凭据。[安全问题报告](SECURITY.md)。

## 后续计划

- [ ] 验证指定 Agent 与运行时版本下的完整审查流程。
- [ ] 用公开评测集衡量误报与漏报。
- [ ] 发布可复现的 Agent 实际报告与演示。

Apache-2.0，见 [LICENSE](LICENSE)。[OpenQA 官网](https://openqa.cn) · [商业边界](docs/COMMERCIAL_BOUNDARY.md)。
