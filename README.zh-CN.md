# OpenQA Skills

**面向 AI 软件工程的验证基础设施。**

AI Coding 工具可以很快生成补丁，却不会自动证明补丁满足需求、覆盖受影响的代码路径，或适合合并。测试通过也可能只是测到了错误的行为；间接调用关系和藏在其他文档里的业务规则，同样容易被漏掉。

OpenQA 在 AI Coding 工作流外增加一层独立验证：连接变更意图、仓库上下文、代码影响、测试、静态分析、运行证据和人工决定，回答一个实际问题：**当前证据是否足以支持合并或发布？**

## OpenQA 提供什么

OpenQA 正在建设面向 AI 软件工程的开放验证平台：

- **Verifier / Agent**：针对一次具体变更规划并执行检查。
- **Skill Hub**：为 Coding Agent 分发可复用的 Skill 和 MCP 工具。
- **工程系统与 SaaS**：连接需求、用例、缺陷、运行轨迹和发布流程；跨仓代码知识图谱、变更影响面分析属于这一层。
- **评测与工具目录**：用可复现任务记录工具能做什么，以及实际效果。

本仓库是其中公开、本地优先的 Skill 层，包含 `ai-defect-detection` 工作流、可执行 CLI、provider、案例和测试。产品服务及托管能力可能在本仓库之外提供，详见[商业边界](docs/COMMERCIAL_BOUNDARY.md)。

- [OpenQA 官网](https://openqa.cn)
- [OpenQA 产品](https://openqa.cn/agent)
- [OpenQA Skill Hub](https://openqa.cn/skills)

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
