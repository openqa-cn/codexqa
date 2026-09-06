# OpenQA Skills

[English](README.md)

**OpenQA —— 面向 AI 生成软件变更的证据化全链路质量验证。**

AI Coding 让实现变得便宜，但验证仍然昂贵。一个补丁可能满足了 Prompt，却漏掉需求、削弱测试、破坏间接调用方，或通过一个没有覆盖目标行为的检查。支持合并或发布的证据，往往分散在规格、代码仓库、测试系统和交付工具中。

[OpenQA](https://openqa.cn) 正在为这条工作流建设验证层，连接规格与需求评审、用例生成、代码分析、AI Code Review、测试执行、影响面分析、证据采集和发布决策，回答一个可追踪的问题：**当前变更是否有足够证据可以交付？**

## 本仓库

`openqa-skills` 是 OpenQA 公开、本地优先的 Skill 层，与 Coding Agent 和现有 CI 工具协同运行。当前发布 [`ai-defect-detection`](skills/ai-defect-detection/README.zh-CN.md)，用于审查代码变更和测试计划，包含 Agent 指令、TypeScript CLI、本地与 HTTP provider、案例、报告和测试。

OpenQA 的完整平台会分阶段建设。规格评审、需求评审、结构化用例生成、更完整的代码分析、AI Code Review 集成和托管服务达到可复现的发布标准后会陆续开放；它们属于产品方向，不代表本仓库当前已经覆盖。

### 能力状态

| 能力 | 本仓库状态 |
| --- | --- |
| 缺陷检测工作流 | 已提供，experimental |
| 证据采集与结构化发现 | 当前工作流已提供 |
| 本地与 HTTP provider | 已提供，取决于环境 |
| Java 调用图与变更影响路径 | experimental，依赖 GitNexus |
| 规格与需求评审 | 计划中 |
| 测试用例生成 | 计划中 |
| 更完整的代码分析与 AI Code Review | 计划中 |
| 托管验证服务 | 产品方向，不在本仓库 |


- [OpenQA 官网](https://openqa.cn)
- [OpenQA 产品](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)

## 安装

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

按提示选择 Agent；添加 `--agent codex --global` 可全局安装到 Codex。无需 OpenQA 或 npm 账号。运行要求和本地验证见[安装与入门](docs/GETTING_STARTED.zh-CN.md)。

## 使用

安装后，在 Coding Agent 中提供可访问的仓库、分支和需求或测试材料：

```text
使用 ai-defect-detection 审查 REPOSITORY_URL 的 BRANCH_NAME。
业务要求：结账金额必须大于零。
对每个疑似缺陷给出位置、触发条件、依据和修复建议。
```

工作流会收集上下文，分析变更方法，执行可用检查，校验发现并生成报告，交给人工复核。它可以使用本地 provider，也可以连接配置好的企业适配器。

## 路线图

- **现在：** 让 `ai-defect-detection` 在干净安装、不同 Agent 和公开案例中稳定运行。
- **下一步：** 按同一套证据和人工复核约定，发布规格评审、需求评审、用例生成和更完整的代码分析 Skill。
- **之后：** 接入跨仓影响分析、AI Code Review、CI 质量门禁和托管工程系统。

进度见[公开路线图](https://openqa.cn/roadmap)。只有文件、案例、局限性和验证证据齐全的能力，才会在本仓库标为已提供。

## 查看结果

[结账边界案例](examples/checkout-boundary/README.md)包含正常实现和预置缺陷：

```bash
node examples/checkout-boundary/verify.mjs
```

[测试套件](skills/ai-defect-detection/tests)覆盖 CLI、provider、打包、隔离和写回行为，不衡量模型准确率，也不能证明发现了全部缺陷：

```bash
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
```

## 边界与状态

发现结果需要人工确认。本地 provider 将结果写入磁盘；源码上下文如何处理由宿主 Agent/模型决定；远程 provider、仓库克隆、文档获取和自动安装工具可能联网。项目处于 experimental 阶段，尚无公开精确率/召回率 benchmark。详见 [FAQ](docs/FAQ.zh-CN.md)、[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md) 和[安全说明](SECURITY.zh-CN.md)。

## 参与贡献

提交小型公开复现、正常对照、预期结果和运行环境，分享前移除凭据与私有代码。请从[贡献指南](CONTRIBUTING.zh-CN.md)、[示例](examples/README.zh-CN.md)和[发布流程](PUBLISHING.zh-CN.md)开始。

Apache-2.0 · [GitHub](https://github.com/openqa-cn/openqa-skills)
