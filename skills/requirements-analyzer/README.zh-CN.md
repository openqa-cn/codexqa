# 需求分析

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

对**需求文档**做质量与风险分析。核对材料、找缺口和冲突，写出一份带可执行 P0 / P1 验证项的登记表。

登记表长什么样：

<p align="center">
  <a href="https://github.com/openqa-cn/openqa-skills/blob/main/docs/assets/previews/ra-register.html"><img src="https://raw.githubusercontent.com/openqa-cn/openqa-skills/main/docs/assets/previews/ra-register.png" alt="需求分析缺口登记表样例" width="880"></a>
</p>

**不是** [`testcase-generation`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/testcase-generation/README.zh-CN.md)。那个 skill 根据 `prd/` 写手工用例库。本 skill 审的是需求本身是否完整、一致、可测。

## 你要交什么

**文档，不是 git 克隆。**

| 任务 | 带上 |
|---|---|
| 分析一份 PRD | 需求正文（文件、粘贴，或 Agent 能拉到的 URL） |
| 多源材料包 | PRD 加上故事 / 接口说明 / 范围 / 计划。可选带 `source_role` 的角色报告 |
| 材料不全 | 有什么交什么。仍会出一稿，并标出缺口 |

不要交应用 `code/`，也不要交克隆地址。不要让它编造源材料没有的接口、SLA，或替你决定值不值得做。

## 它做什么

1. 收料和短输入门。
2. 结构盘点、来源审计、气味、NFR 与成功指标格子。
3. 一份缺口 / 冲突登记表（`RA-xx`），带风险和可测性。
4. P0 / P1 带验证字段（前置、刺激、期望、证据）。

默认 Markdown。只有你要求时才出 Excel / CSV / JSON / Word（`output-formats.md`）。辅助脚本在 `scripts/`（`npx --yes tsx scripts/run_analysis.ts --input <file>`）。

没有已记录的宿主 agent 成绩。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

```
requirements-analyzer/
├── SKILL.md                 # Agent 入口
├── prompts/                 # 分析质量条（给 agent）
├── references/              # 按需加载的格子
├── examples/                # 通用库存预占样例
├── evals/                   # skill-up 用例；不是公开准确率
├── scripts/                 # 解析 / 转换助手
├── HOW_IT_WORKS.md
└── KNOWN_LIMITATIONS.md
```

## 安装

```bash
npx skills add openqa-cn/openqa-skills --skill requirements-analyzer
```

然后**新建** Agent 会话。

## 对 Agent 可以直接说

```text
用 requirements-analyzer 分析这些需求文档。
只出一份缺口/冲突登记表。P0 必须带验证字段。
源材料没有的接口和 SLA 不要编。
```

双源冲突（来自 `quick-start.md`）：

```text
来源 A（PRD）：库存不足仍可提交，后台稍后预占。
来源 B（API）：库存不足返回 400，不得建单。
跑 requirements-analyzer。标出冲突，不要替我选边。
```

## 许可证

Apache-2.0，与本仓库相同。
