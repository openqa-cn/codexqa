[English](README.md) · **简体中文** · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

# codexqa-change-analysis

利用 CodexQA 的**符号图与 Diff 索引**进行变更影响面分析。输入为一个 Git 基线（例如 `origin/main`）。CodexQA 识别并标记改动（`index --diff-base` → `change-groups` / `symbol-diff`）。本技能交付两项硬性产物：一份 **HTML 变更影响报告**（影响入口、变更清单、测试方案、覆盖判定、敏感路径）以及在被测仓库中**新增可运行的测试文件**补齐缺口（仅新增；不修改已有测试文件）。

> 本文件面向人类开发者阅读。Agent 运行时请勿加载本文件，运行期规范请遵循 [SKILL.md](SKILL.md)。

旧技能名称：`change-impact-analysis`。

## 它回答什么

| 关注问题 | 交付内容 |
|---|---|
| 改动或新增了哪些方法？ | 区分 added / changed / deleted 的方法清单，包含 `file:line` 与具体改动说明 |
| 改动会打到哪些入口？ | 入口点：没有上游调用方的方法（HTTP 路由 / main / MQ / 定时任务 / 导出函数），并提供逐跳调用链 |
| 应该测哪些场景？ | 组织为 入口 × 正常/边界/异常/契约/数据 的测试用例矩阵 |
| 能否复用已有测试？ | 在测试方案的「用例文件」列中指明（用例名 + `file:line` + 类别）。在覆盖判定小节给出明确结论 |
| 没覆盖到的由谁来补？ | 在仓库中**新增可运行的测试文件**（API 接口层，需要浏览器时补充端到端层；仅新增）。测试跑通后，用例数与结果回写至报告 |

## 安装

```bash
npx skills add openqa-cn/codexqa --skill codexqa-change-analysis
```

从本地仓库安装：

```bash
# 常见 Agent Skill 目录：
#   ~/.agents/skills/
#   ~/.claude/skills/
cp -R codexqa-change-analysis ~/.agents/skills/
```

需要 Node.js >= 18 以及 `codexqa` CLI。

```bash
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

在没有 CodexQA 引擎时，该技能仍可运行：`SKILL.md` 包含降级模式（git + grep）。交付产物结构保持不变。

## 如何触发

向 Agent 发送类似如下指令：

- “分析这次变更：新增了哪些方法，会影响到哪些入口？”
- “这次改动应该测什么？有没有可以复用的已有测试用例？”
- “对照 origin/main 比较 diff 并生成变更影响报告”
- 变更影响 / 变更代码分析 / 影响入口 / 召回测试用例 / 测试方案

## 典型命令

```bash
codexqa index . --diff-base origin/main --full    # 必须加 --full，否则变更标记不会刷新
codexqa query --repo . change-groups              # 按风险排序的变更分组
codexqa query --repo . symbols --change add,change --kind function,method
codexqa query --repo . symbol-diff --id <id>      # 确认改动内容的权威来源
codexqa query --repo . reach --id <id> --direction in --depth 10   # 沿调用链向上追溯入口
codexqa query --repo . reach --id <id> --direction in --edge-kinds tests  # A 层测试召回
```

## 目录结构

```
codexqa-change-analysis/
├── SKILL.md                           # 路由规则、硬性限制、索引门禁、交付契约
├── assets/
│   └── report-template.html           # HTML 报告骨架（拷贝后按 id 填充；不可更改样式）
├── references/
│   ├── analysis.md                    # §1–§5 证据：清单 / patch / 入口 / 回归 / 测试方案
│   ├── test-recall.md                 # 已有用例召回：A 层 tests 边 + B 层文本检索
│   ├── report.md                      # HTML 填充规范：每个 slot 的内容及对应查询来源
│   └── generate-cases.md              # 自动生成用例：新建文件契约、执行与回写
├── KNOWN_LIMITATIONS.md               # 实测边界与规避方案（英文）
├── KNOWN_LIMITATIONS.zh-CN.md         # 实测边界与规避方案（中文）
├── README.md                          # 英文说明
└── README.zh-CN.md                    # 中文说明
```

## 产物形态

包含两个部分：

```
<repo>/change-impact-<repo-slug>-YYYYMMDD-HHMM.html   # 自包含 HTML 报告
<repo>/<测试目录>/change-impact-*                     # 新增用例文件：固定前缀，语言后缀遵循现有测试
                                                      # （JS 采用 .mjs；Python / Rust / Java 同理）
```

界面遵循 Claude Code session-report 风格（象牙白底、深色终端、赤陶色重点色、JetBrains Mono 字体）。
小节顺序严格固定：**核心结论（Key findings）→ 风险与未知（Risks and unknowns）→ 受影响入口（Affected entries）→ 变更清单（Change list）→ 测试方案（Test plan）→ 覆盖判定（Coverage verdict）→ 敏感路径（Sensitive paths）**，并内嵌一张 Mermaid 入口关系图。
关系图被渲染为**内联静态 SVG**，即使在完全离线环境下也能正常显示。报告内容仅包含客观分析结果，不堆砌执行过程描述。

## 最关键的三条硬规则

1. **`--diff-base` 必须与 `--full` 配对使用**：增量索引不会刷新变更标记。切换基线若不全量重编，会返回上次的旧结论。
2. **`to_count == 0` 不等于绝对入口**：动态语言跨文件调用边可能缺失，必须配合 `grep` / `imports` 交叉核对。
3. **`tested_count == 0` 不代表没有测试**：部分语言（如 JS 实测）不产出 `tests` 边，必须通过 B 层文本召回检索测试文件。

详见 [已知边界](KNOWN_LIMITATIONS.zh-CN.md)。
