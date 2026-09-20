# 已知边界

[English](KNOWN_LIMITATIONS.md)

这里的每一条都是当前 skill 的真实边界，不是宣传性免责声明。设计分工请先读[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 实图依赖闭源的 `@openqa-cn/codexqa`

仓库代码图 / 调用链 / RAG 上下文来自单独分发的 npm 包 `@openqa-cn/codexqa`。本仓库发布 skill 脚本和报告契约，**不**包含引擎源码。没有 CLI 时，除非明确允许 mock，仓库扫描会硬失败（adhoc 可在最后手段自动 mock）。

## 可选的 SAST / lint / secrets 二进制

Semgrep、Bandit、gosec、gitleaks、语言 linter、osv-scanner 均为可选。缺失工具记入 `tooling_status.missing`；修复尝试后流水线继续。适配器缺失时覆盖面会缩小。

## Stage1 / Stage2 由模型判断

Python 校验 schema、合并规则与排序。某条语义发现在本仓库是否*成立*，由宿主 agent（或可选 API 模型）决定。若模型编造证据或误读策略，写完的 `report_scan.*` 仍可能是错的。

## 本仓库 CI 不跑完整实扫

本地 `npm test` 在 Python 3.10+ 下覆盖流水线合并/校验与策略夹具。仓库 CI 不会安装全部 SAST 二进制，也不会对生产仓库跑实 agent Stage1/Stage2。把 `--dry-run` / mock 仅当作冒烟。

## 无公开宿主 agent 成绩

没有公开的端到端扫描准确率答案键，也没有记录的宿主 agent 成绩。把报告契约当作设计路径，而不是已测量的检出率声明。

## 工作流边界

本 skill 产出**代码风险扫描报告**。它不替代 `ai-code-reviewer` 的 CodexQA 证据包 HTML 评审、`code-analyzer` 的变更影响面，或 `root-cause-diagnosis` 的异常 RCA。
