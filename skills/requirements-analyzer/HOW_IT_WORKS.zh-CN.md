# 需求分析：原理

[English](HOW_IT_WORKS.md)

[`requirements-analyzer`](README.zh-CN.md) 不内置模型。它是宿主 agent 要走的固定流水线：审计你已经给的材料，只写**一份**缺口/冲突登记表，并给 P0 / P1 补上可执行验证。

**输入是需求正文，不是源码。** PRD、故事、接口说明、范围表——不是 git 克隆，也不是 `code/`。详见 [README · 你要交什么](README.zh-CN.md#你要交什么)。

Agent 运行时读 [`SKILL.md`](SKILL.md) 再读 [`prompts/requirements-analyzer.md`](prompts/requirements-analyzer.md)，不要读本页。能力边界见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 要解决的问题

直接让模型「审这份 PRD」常见三类错误：

| 错误 | 表现 | 约束 |
|---|---|---|
| 好几份重叠清单 | 缺口、冲突、「TOP 3 风险」重复同一批问题 | 只出一份登记表（`RA-xx`）。不再另开缺口/冲突章节 |
| 编造事实 | 凭空出现接口、SLA，或替产品拍板 | 未知保持提问。冲突保留两边观点和建议决策人 |
| 不可测的 P0 | 「提高完整性」却没有判定条件 | P0/P1 要有前置、刺激、期望、证据。看不到失败 → `untestable` |

模型判断措辞和冲突。`references/` 里的格子定义「完整」是什么。写用例是 [`testcase-generation`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/testcase-generation/README.zh-CN.md)。

## 评估状态

`evals/` 是 skill-up 用例清单（材料不全、跨源冲突、缺判定）。没有公开的宿主 agent 成绩，也没有和 defect-detection inventory-service 7/7 对等的答案键。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 你会看到什么

| 时机 | 展示 | 你怎么回 |
|---|---|---|
| 材料薄或缺类 | 先出一稿，标出假设和缺口 | 补上缺的那一类，或接受这稿 |
| 两个来源打架 | 一行 `conflict`；两边观点；建议负责人 | 你来拍板；不要指望 skill 冻结规则 |
| 条目看不到失败 | `untestable`，不是可执行 P0 | 补判定，或维持不可测 |
| 分析结束 | 7 段 Markdown（或你要求的格式） | 把 P0 交给人或交给写用例 |

## 机制

### 1. 先流水线，再风险

收料 → 审计 → 格子 → 一份登记表 → 风险 → 验证 → 阻塞项。不要先写「TOP 3」。

### 2. 一份登记表

状态和字段名见 [`references/register-fields.md`](references/register-fields.md)。不要再写「缺口与歧义」或「跨源冲突」。

### 3. 不编造系统

用户没给的接口、字段、SLA、环境、根因一律不编。过期或不可比的来源不得标 `aligned`。

### 4. 角色报告保留署名

文档带 `source_role` 时，每条都留下该角色。不要压成匿名共识。不要求安装角色 Skill。

## 流水线

```text
PRD / 故事 / 接口说明 / 可选角色报告
        │
        ▼
  五类收料 + 短输入门
        │
        ▼
  结构盘点 + 来源审计 + 气味 / NFR / KPI / 依赖格子
        │
        ▼
  一份缺口/冲突登记表（RA-xx）
        │
        ▼
  风险 + 可测性（P0 要有 FailureMode）
        │
        ▼
  阻塞项与下一步
```

## 延伸阅读

| 主题 | 文档 |
|---|---|
| 要交什么、怎么说 | [README](README.zh-CN.md) |
| 已知边界 | [已知边界](KNOWN_LIMITATIONS.zh-CN.md) |
| Agent 入口 | [`SKILL.md`](SKILL.md) |
| 质量条 | [`prompts/requirements-analyzer.md`](prompts/requirements-analyzer.md) |
| 最短路径 | [`quick-start.md`](quick-start.md) |
| 各 skill 要交什么 | [FAQ](https://github.com/openqa-cn/openqa-skills/blob/main/docs/FAQ.zh-CN.md) |
