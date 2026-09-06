# OpenQA Skills

**为 AI 软件工程提供从需求到发布的质量验证基础设施。**

[![CI](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md)

<p align="center">
  <a href="#能力地图"><strong>能力地图</strong></a> ·
  <a href="#快速开始"><strong>快速开始</strong></a> ·
  <a href="examples/checkout-boundary/README.md"><strong>可运行示例</strong></a> ·
  <a href="docs/GETTING_STARTED.zh-CN.md"><strong>安装入门</strong></a> ·
  <a href="docs/FAQ.zh-CN.md"><strong>FAQ</strong></a> ·
  <a href="docs/SUPPORT_MATRIX.zh-CN.md"><strong>支持矩阵</strong></a>
</p>

AI Coding 降低了实现成本，但一个补丁仍可能遗漏需求、削弱测试、破坏间接调用方，或通过未覆盖目标行为的检查。OpenQA 正在建设一层质量验证能力，把仓库上下文、需求、测试、分析结果、证据和人工发布决策连接起来。

> **Coding Agent 帮助生成变更，OpenQA 帮助判断这些变更是否值得信任。**

适合在以下场景使用本仓库：

- 按明确需求审查 Pull Request、分支、测试计划或交付任务
- 在人工评审前发现静态缺陷和业务逻辑缺陷候选
- 把分析结果整理为包含位置、触发条件、分析依据和修复建议的结构化发现
- 优先在本地运行，同时按需连接现有工程系统

## 本仓库提供什么

`openqa-skills` 是 OpenQA 面向 Coding Agent 的公开、本地优先 Skill 层。当前发布 [`ai-defect-detection`](skills/ai-defect-detection/README.zh-CN.md)：一套可执行的缺陷检测工作流，用于审查代码变更和测试计划，并输出带依据的结构化疑似缺陷。

当前工作流包括：

- 创建任务、克隆仓库、收集分支与 diff 上下文
- 基于 AST 规则分析变更方法，并可选使用 Java 调用图分析
- 本地 JSON provider，以及可选的 HTTP、GitHub、测试用例、文档、问题单和异常链路适配器
- 发现结果校验、写回、排序、标签和 HTML 报告
- 可确定复现的正常实现/预置缺陷案例，以及自动化 CLI 测试套件

## 工作方式

```text
代码仓库 + 分支 + 需求或测试材料
                    │
                    ▼
          上下文收集与变更分析
                    │
                    ▼
       AST 规则 + 可选调用图分析
                    │
                    ▼
          Agent 审查与发现校验
                    │
                    ▼
        结构化发现 + HTML 报告
                    │
                    ▼
                  人工复核
```

OpenQA 负责编排工作流，语义审查由宿主 Agent/模型执行。本地 provider 无需连接 OpenQA 私有后端；如有需要，也可以通过适配器连接外部平台。

## 能力地图

OpenQA 的产品方向覆盖 AI 软件工程全生命周期的质量验证。本仓库当前主要提供 [`ai-defect-detection`](skills/ai-defect-detection/README.zh-CN.md) 一个 Skill。除非特别说明，下表中标记为**已提供**或**部分提供**的能力都由该工作流提供；其余条目是规划方向，不代表已经包含在当前仓库中。

| 能力 | 当前仓库状态 | 范围 |
| --- | --- | --- |
| 缺陷检测 | **已提供** | 面向代码变更、测试计划和交付任务的 Agent 静态与业务逻辑审查 |
| 代码分析 | **部分提供** | 基于 AST 规则和变更方法分析；更多语言和框架仍在扩展 |
| 需求评审 | **计划中** | 根据结构化业务需求检查实现与测试 |
| 规格评审 | **计划中** | 检查技术规格的完整性、一致性和可测试性 |
| AI Code Review | **计划中** | 更完整的 Pull Request 审查、协作和平台集成 |
| 变更影响分析 | **部分提供** | 通过 GitNexus 提供 Java 调用图路径，并有降级行为；跨仓影响分析仍在规划 |
| 测试执行编排 | **计划中** | 在验证工作流中运行现有测试框架并采集结果 |
| 代码覆盖率分析 | **计划中** | 覆盖率质量信号和需求到测试的覆盖分析 |
| UI 端到端测试 | **计划中** | 浏览器和 UI 工作流生成、执行与结果集成 |
| 测试用例生成 | **计划中** | 根据需求和已有材料生成结构化测试用例 |
| 测试数据构造 | **计划中** | 构造边界、场景和可复用的领域测试数据 |
| 问题定位与诊断 | **部分提供** | 发现结果包含位置、触发条件、分析依据和修复建议；更深入的根因诊断仍在建设 |
| 证据采集与结构化发现 | **已提供** | 发现校验、写回、排序、标签和可追踪 HTML 报告 |
| 本地 provider 与报告 | **已提供** | 本地优先的 JSON 持久化和报告生成，不依赖私有后端 |
| 企业与外部系统集成 | **部分提供** | HTTP 和 GitHub 适配器已有代码，需要部署配置 |
| 质量门禁与发布决策 | **产品方向** | 将验证结果连接到 CI 门禁和发布流程 |
| 托管验证服务 | **产品方向** | 不在本仓库中的 OpenQA 托管工程系统 |

> **状态说明：** **已提供**表示当前仓库可用；**部分提供**表示已有工作路径，但覆盖范围或集成仍不完整；**计划中**表示尚未在本仓库交付；**产品方向**表示 OpenQA 更大的平台目标。

> [!IMPORTANT]
> 当前缺陷检测工作流已经是一套可实际使用的工程工具，而不是只能用于实验的原型。它输出供人工确认的缺陷候选，不能替代测试、静态分析、安全审查或维护者判断。

- [OpenQA 官网](https://openqa.cn)
- [OpenQA 产品](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)

## 安装

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

按提示选择 Agent。全局安装到 Codex：

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection --agent codex --global
```

无需 OpenQA 或 npm 账号。运行要求、安装范围和故障排查见[安装与入门](docs/GETTING_STARTED.zh-CN.md)。

## 快速开始

1. 使用上面的命令安装 Skill。
2. 新建一个 Coding Agent 会话。
3. 提供可访问的仓库、分支，以及需求或测试材料：

```text
使用 ai-defect-detection 审查 REPOSITORY_URL 的 BRANCH_NAME。
业务要求：结账金额必须大于零。
对每个疑似缺陷给出位置、触发条件、依据和修复建议。
```

将大写占位符替换为真实内容。工作流会收集上下文、分析变更方法、执行当前可用的检查、校验发现并生成报告，供人工复核。

如果想运行一个不需要 AI 模型或私有后端的完整仓库示例：

```bash
node examples/checkout-boundary/verify.mjs
```

该案例包含正常实现和预置边界缺陷，用于展示预期契约和验证流程；它不代表模型检测准确率。

## 开发者验证

参与贡献前，请运行仓库检查：

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

这些检查覆盖文档链接、CLI 与 provider 行为、打包、任务隔离、写回校验和仓库自带的边界案例，但不能证明所有缺陷都会被发现。

## 适用边界

本项目用于组织代码上下文和验证证据，不能替代测试、静态分析、安全审查或维护者判断；也不能证明不存在缺陷，或推断未提供的业务规则。发现结果是待确认候选，不是自动合并决策。

本地 provider 会把数据写入磁盘。仓库克隆、文档获取、远程 provider、自动安装 Semgrep/GitNexus，以及宿主 Agent/模型都可能联网。处理私有源码前，请阅读 [FAQ](docs/FAQ.zh-CN.md)、[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md)和[安全说明](SECURITY.zh-CN.md)。

## 路线图

- **现在：** 加固干净环境安装、Agent 兼容性、公开案例和开发者文档。
- **下一步：** 按同一套“证据 + 人工复核”约定，增加规格评审、需求评审、测试用例生成和更广泛的分析 Skill。
- **之后：** 接入跨仓影响分析、AI Code Review、CI 质量门禁和托管工程系统。

只有实现、案例和局限性都已公开的能力，才会在本仓库标记为“已提供”。进度见[公开路线图](https://openqa.cn/roadmap)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [安装与入门](docs/GETTING_STARTED.zh-CN.md) | 运行要求、安装范围、本地设置和故障排查 |
| [FAQ](docs/FAQ.zh-CN.md) | 账号、数据处理、联网行为、报告和局限性 |
| [支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md) | 已验证的运行时、Agent、集成和已知限制 |
| [架构说明](docs/ARCHITECTURE.md) | 仓库结构、命名和项目成熟度模型 |
| [示例](examples/README.zh-CN.md) | 可运行案例和预期结果 |
| [安全说明](SECURITY.zh-CN.md) | 安全问题反馈和数据处理指引 |

## 获取支持

- 通过 [GitHub Issues](https://github.com/openqa-cn/openqa-skills/issues) 报告可复现问题
- 在 [GitHub Discussions](https://github.com/openqa-cn/openqa-skills/discussions) 提问和讨论实现方案
- 安全漏洞请按照[安全说明](SECURITY.zh-CN.md)反馈

寻求帮助时，请提供 commit 或 Skill 版本、操作系统、Agent、命令、预期结果和实际结果。分享前请移除凭据、私有源码和专有日志。

## 参与贡献

欢迎提交误报或漏报的最小公开复现、正常对照、新分析规则、案例和文档改进。分享前请移除凭据、私有源码和专有日志。请从[贡献指南](CONTRIBUTING.zh-CN.md)、[示例](examples/README.zh-CN.md)和[发布流程](PUBLISHING.zh-CN.md)开始。

Apache-2.0 · [GitHub](https://github.com/openqa-cn/openqa-skills)
