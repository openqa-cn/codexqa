# 已知边界

[English](KNOWN_LIMITATIONS.md)

已观察到或已在本 skill 源码/文档中核实的限制。数据流见[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 无公开评测

无 fixture、无答案键、无记录在案的端到端运行。`defect-detection` 的盲测 fixture 不适用于本 skill。

未测量项：

- 用例对需求的覆盖（无召回指标）
- R1–R4 对目标缺陷的检出率
- 相对「直接让模型写用例」的增益
- 跨模型稳定性

质量判定目前是人工审产出。

## 指令体积

`generate-skill.md` 约 200 行（编排）。`phase-*.md` 各 70–230 行。`subagent-gen-duty.md` 约 50 行。生成仍会加载 `case-authoring-rules.md`（约 650 行）和至少一道 gate。`update-skill.md` 约 590 行。

- `case-authoring-rules.md` 仍整份进入 Phase 3 子 agent 上下文；展开规则被跳过或 `caseType` 写错时优先查这里。
- 阶段编号、duty 原文、引用表无自动校验，改文档需手工对引用。

## 子 agent

Phase 2 最多 3 路并行；Phase 3 按 `design.md` 模块各一路。R1–R4 各用独立子 agent。

无子 agent 的宿主上流程仍可串行执行，未实测。门禁与作者同一 agent 时，独立评审失效。

## 语义无机械校验

`lint_case_documents.ts` 只覆盖结构：表头、空 `Construction`、占位符、标题、工程表列。以下由模型判断：

- 步骤是否可执行
- 期望是否为具体值（非「成功」）
- `coverage[]` 是否落在用例正文
- `analysis.md` 是否抽全规则

更新时的语义命中同样无脚本：漏匹配则过时用例会留下。

## `prd/` 不会自动同步

`prd/` 是 git 基线快照。更新只 diff 磁盘内容。

- 只在托管平台改、未覆盖本地 → 报告无变更
- 生成之后才写入 `context.json` 且无 `localPath` 基线文件 → 跳过；需再跑一次生成建基线

企业 HTTP 适配覆盖 spec / knowledge / config / env，不含文档托管。

## 测试数据不在本 skill

`{placeholder}` 与空 `Construction` 由 `testdata-generation` 回填。未装该 skill 时，库可作为设计产物使用，不能直接打后端。见[工作原理 §4](HOW_IT_WORKS.zh-CN.md#4-占位符与数据构造解耦)。

## 工程信息不上代码补全

未在 PRD / 技术方案出现的表、cache key、配置 key 写 `TBD`。`code/` 仅用于更新流程的 diff，生成阶段不从代码推断 schema。薄 PRD 会导致大量 `TBD`。

## 运行环境

- Shell 为 POSIX `sh`，不用 `jq` / `uuidgen` / bash 4 关联数组。Windows 未测。[SUPPORT_MATRIX](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)
- 依赖 `git`（`prd/` 基线、`code/` diff）。无非 git 模式
- 工作区约定 `prd/`、`code/`、`usecases/`。其它目录布局未测

## 领域假设

规则文档为英文。示例与展开启发式按「订单 / 账户 / 目录 + HTTP/gRPC + DB/Cache/MQ」调的。数据管道、嵌入式、纯算法需求仍会出文件，覆盖方向未按这些域设计。
