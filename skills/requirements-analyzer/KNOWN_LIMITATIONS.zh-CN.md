# 已知边界与失败场景

[English](KNOWN_LIMITATIONS.md)

这里每条都是文件里能看到的，不是免责声明。设计背景见[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 没有公开准确率

`evals/` 列的是 skill-up 提示（冲突、材料不全、缺判定）。没有已记录的宿主 agent 运行，也没有答案键 fixture。eval 文件通过，不代表模型会只出一份登记表，或拒绝编造 SLA。

## 这不是 testcase-generation

| | `requirements-analyzer` | `testcase-generation` |
|---|---|---|
| 输入 | 需求正文（你粘贴的文件） | `prd/` 布局（PRD / 技术方案 / 契约） |
| 输出 | 一份缺口/冲突登记表 + 验证字段 | `usecases/cases/` 下的手工用例 |
| 代码 | 不用 | 只在更新时用 `code/` |

只装本 skill 不会写出带 `{placeholder}` 的用例，也不会跑 R1–R4 门禁。

## 模型仍可能编造系统

playbook 禁止编造接口和 SLA。`scripts/` 里没有任何步骤会回读源材料驳回虚构字段。登记表必须人工看。

## 辅助脚本只做格式，不做分析

`scripts/run_analysis.ts` 和解析/转换脚本只在 Markdown / JSON / CSV / Word 形态之间搬文本。它们不算风险，也不填登记表。分析是宿主 agent 在走 `prompts/requirements-analyzer.md`。

## 材料不全仍会出一稿

缺计划、KPI 或接口说明是标出来的缺口，不是硬停。稿子可能看起来已经写完。把 Status=`aligned` 当成「双方同意」之前，先读「假设与缺口」。
