# 已知边界

[English](KNOWN_LIMITATIONS.md)

这里的每一条都是当前 skill 的真实边界，不是宣传性免责声明。设计分工请先读[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 依赖闭源的 `@openqa-cn/codexqa`

对业务仓库的结构化分析来自单独分发的 npm 包 `@openqa-cn/codexqa`。本仓库发布 skill 脚本、prompts 和报告契约，**不**包含引擎源码。安装后只与 `codexqa` 二进制对话。

## 本仓库 CI 不跑这条路径

本地 `bash scripts/validate-skill.sh` 覆盖静态布局、fixture 校验/渲染冒烟与 plan-coverage 审计。闭源 CLI 不会在本仓库 CI 中安装或执行，因此端到端 index/query 能否成功取决于用户机器和包版本。

## 评审叙事与 Agent LLM judgment 由模型判断

Bash 收集信号、用 `merge-llm-findings.py` 做确定性去重，并根据 `review-conclusion.json` 渲染 HTML。发现、维度卡、双语叙事以及第 16 维 Agent LLM judgment 候选在业务域是否*成立*，仍由宿主模型决定。校验通过的包仍可能产出错误报告——模型可能编造调用边、忽略 `confidence: UNKNOWN`，或提出超出包范围的新问题。去重只消除重复表述，不证明正确性。

## 图缺口会削弱证据

当 CodexQA 无法解析调用方、可达性或测试边（parser 限制、stubs ≥ 20、碰撞、缺索引）时，边/可达类发现应封顶为 **UNKNOWN**。优先用 `edges-in` 调用方，而不是 `from_count`。禁止把 `test/` 路径当成覆盖证明。

## 没有公开的宿主 agent 成绩

没有公开答案键 fixture，也没有完整现场评审的宿主 agent 成绩。把「写出一份 `REVIEW-REPORT.html`」当成设计路径，不要当成已测过的误报率。

## 工作流边界

本 skill 产出**图证据评审报告**。它不替代 `defect-detection` 的扫描报告、`code-analyzer` 的临时图问答，也不替代 `root-cause-diagnosis` 的异常 RCA。
