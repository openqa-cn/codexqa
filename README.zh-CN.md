# OpenQA Skills

[English](README.md)

**面向 AI 软件工程的全链路质量验证基础设施。**

AI Coding 改变了软件的生产方式，但交付问题没有消失：生成的变更可能误解规格、漏掉需求、削弱测试、破坏间接调用方，或者通过一个并不能证明目标行为的检查。验证需要从意图一直跟到发布，而不能只看一段代码或一次测试结果。

OpenQA 正在为 Coding Agent 和工程团队建设这一验证层，将规格评审、需求评审、测试用例生成、代码分析、AI Code Review、测试执行、证据采集和发布决策连接起来。各项能力可以复用团队已有的工具，并和 Coding Agent 或 CI 流水线组合使用。

## OpenQA 与本仓库

OpenQA 是这项工作的组织与产品计划。完整平台面向全链路质量验证：从变更意图规划检查，理解单仓和跨仓影响，调用合适的测试与工程工具，并记录证据和剩余风险，交给人工或策略做最终决定。

本仓库是其中公开、本地优先的一部分。目前发布的是 `ai-defect-detection` Skill，包含 Agent 工作流、可执行 CLI、provider、案例和测试。规格与需求评审、结构化用例生成、更完整的代码分析以及 AI Code Review 集成等能力仍在建设中，达到可复现的发布标准后会陆续开放。因此，本仓库展示的是 OpenQA 全链路验证模型的一个已交付起点，不代表所有规划能力都已在当前版本提供。

- [OpenQA 官网](https://openqa.cn)
- [OpenQA 产品](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)
- [OpenQA Skills 源码](https://github.com/openqa-cn/openqa-skills)

## 安装

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

按提示选择 Agent；使用 `--agent codex --global` 可全局安装到 Codex。安装器从 GitHub 获取本仓库，无需 OpenQA 或 npm 账号。

运行工作流需要 Node.js 22+、Git，以及能够读取 Skill 文件并执行命令的 Agent。请先阅读[安装与入门](docs/GETTING_STARTED.md)。

## 使用

安装后，在 Coding Agent 中提供仓库、分支和需求或测试材料：

```text
使用 ai-defect-detection 审查 REPOSITORY_URL 的 BRANCH_NAME。
检查这条要求：结账金额必须大于零。
对每个疑似缺陷给出位置、触发条件、依据和修复建议。
```

工作流会收集上下文，分析变更方法，执行可用检查，校验发现并生成报告，交给人工复核。它可以使用本地 provider，也可以连接配置好的企业适配器。

## 示例与验证

[结账边界案例](examples/checkout-boundary/README.md)同时提供正常实现和预置缺陷。运行：

```bash
node examples/checkout-boundary/verify.mjs
```

仓库测试覆盖 CLI 和 provider 行为，不代表模型准确率，也不能证明一次审查发现了全部缺陷：

```bash
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
```

## 边界

发现结果需要人工确认。本地 provider 将结果写入磁盘；源码上下文如何处理由宿主 Agent/模型决定；远程 provider 和自动安装工具可能联网。项目目前处于 experimental 阶段，完整 Agent 评测仍在进行。详见 [FAQ](docs/FAQ.md) 和[支持矩阵](docs/SUPPORT_MATRIX.md)。

## 参与贡献

提交公开复现、正常对照、预期结果和运行环境，分享前移除凭据与私有代码。请阅读[贡献指南](CONTRIBUTING.md)、[发布流程](PUBLISHING.md)和[安全说明](SECURITY.md)。

Apache-2.0，见 [LICENSE](LICENSE)。
