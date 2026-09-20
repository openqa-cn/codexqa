# 已知边界

[English](KNOWN_LIMITATIONS.md)

这里的每一条都是当前 skill 的真实边界，不是宣传性免责声明。设计分工请先读[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 依赖闭源的 `@openqa-cn/codexqa`

对业务仓库的结构化分析来自单独分发的 npm 包 `@openqa-cn/codexqa`。本仓库发布 skill 脚本和报告契约，**不**包含引擎源码。安装后只与 `codexqa` 二进制对话。

## 本仓库 CI 不跑这条路径

本地 `npm test` 覆盖解析、落地、草稿和 CLI 冒烟。闭源 CLI 不会在本仓库 CI 中安装或执行，因此端到端 index/query 能否成功取决于用户机器和包版本。

## RCA 叙事由模型判断

TypeScript 抽出 facts，并拒绝机械 `storyGaps`。可选叙事（竞态、吞异常、lineDrift 假设、弱帧标签）仅在对应 facts 标志成立时才要求；无证据编造会被拒绝。`facts.confidence` 为 medium 时写 `Confidence: high` 也会被拒绝。其他因果句在本业务域是否*成立*，仍由宿主模型决定。通过 `write-report` 的报告仍可能错——模型可能编造调用边或误读契约。

## 图缺口会削弱证据

当 CodexQA 无法解析帧、调用方或分支目标（parser 限制、stub、碰撞、缺索引）时，证据应标为弱或假设。缺图 → 假设 + 如何验证；禁止编造调用边。真实跑过 `ensure-codexqa` 且 `ready=false` 之后，允许 grep，但置信度必须保持低。

## 没有公开的宿主 agent 成绩

没有公开答案键 fixture，也没有和 defect-detection inventory-service 7/7 对等的宿主 agent 成绩。把「写出一份英文报告」当成设计路径，不要当成已测过的 RCA 准确率。

## 工作流边界

本 skill 诊断**异常**。它不替代 `code-analyzer` 的变更影响审查、`defect-detection` 的代码风险扫描，也不替代 `ai-code-reviewer` 的 CodexQA 证据包 HTML 评审。
