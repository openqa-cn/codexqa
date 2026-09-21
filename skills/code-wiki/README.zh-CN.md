<div align="center">

[English](README.md) · **简体中文**

# CodexQA Code Wiki

</div>

**把仓库变成本地架构知识图谱：模块地图、真实依赖、阅读导览，全程不调模型。**

CodexQA 先建索引，再用 `wiki inputs` 把 Leiden 社区和 digest 导出成 JSON。Cursor / Claude Code 读 [`SKILL.md`](SKILL.md)，只凭这份 JSON 写出默认中文、面向上手的 HTML Wiki 报告。

- **模块地图** —— 社区（`p01`…）、规则标题、真实 `deps`
- **模块笔记** —— 符号签名、社区内 `call_chain`、`method_flows`、`cross_community`
- **阅读导览** —— 相邻步骤必须有列出的依赖
- **可选落库** —— `wiki --no-llm` 把规则页写入 Web UI

`code-wiki` 回答的是**架构和上手路径**。它不审 PR、不圈回归、不打 P0 / P1 / P2。变更影响用 `code-analyzer`，代码风险扫描报告用 `defect-detection`，CodexQA 证据包 HTML 评审用 `ai-code-reviewer`。

Skill 与 playbook 发布在本仓库；依赖的 `@openqa-cn/codexqa` 是单独分发的闭源本地引擎。建索引和 `wiki inputs` 在本机完成，不需要 LLM。边界见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

```bash
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
```

---

## 快速开始

### 1. 安装

需要 **Node.js >= 18**。

```bash
npx skills add openqa-cn/codexqa --skill code-wiki
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

命令找不到时，把 `$(npm prefix -g)/bin` 加进 PATH。已安装则不要重装。

**Cursor / Claude Code：** 把 [`SKILL.md`](SKILL.md) 放到对应 skills 目录。用户要知识图谱、架构 Wiki、模块地图或阅读导览时，按 SKILL 走无模型 wiki 命令。

### 2. 先建索引，再导出 wiki inputs

```bash
codexqa index /path/to/repo
codexqa wiki inputs /path/to/repo --kind architecture --limit 8
codexqa wiki inputs /path/to/repo --kind overview
codexqa wiki inputs /path/to/repo --kind page --id p01
```

也可以直接说：

```text
给这个仓库建代码知识图谱。只用 wiki inputs，不要跑 LLM wiki。
先出架构地图，再讲核心模块和一条阅读路径。
```

### 3. 在对话里细调

继续说：`只看存储相关社区`、`打开 p03`、`导览里去掉孤立模块`。Agent 应保留已建索引，用 `--kind` / `--id` / `--limit` 补查，不要改写成产品介绍。

---

## 选择合适的场景

| 场景 | 最适合 | 对话里应包含 |
| --- | --- | --- |
| **整仓地图** | 仓库是什么、模块地图、架构 Wiki | 仓库路径、要几页 |
| **单个模块** | 这个社区做什么、和谁往来 | `p01` / community id / 模块名 |
| **阅读导览** | 从哪读起、上手路径 | 目标（接口 / 存储 / 某功能） |
| **落库规则 Wiki** | 不调模型，给 Web UI 存页 | 是否持久化 |
| **索引自检** | inputs 为空、找不到仓 | 仓库路径或 `repo_id` |

审变更、查调用、测试缺口、追堆栈：用 `code-analyzer`。

---

## 为什么用这个技能

- **社区就是知识图谱的节点** —— Leiden + 目录亲和，再加页数上限。Agent 不得编造模块
- **`deps` 和 `cross_community` 就是边** —— 从符号图计数。`deps` 为空是孤立模块，不是「塞进 Domain」
- **`wiki inputs` 才是证据导出** —— 和正式生成同一条建图链路，不调模型、不写 wiki 表。读 `inputs[].input`，不要读 prompt 字符串
- **`--no-llm` 只是可选落库** —— 只有规则标题；后面不要再跑 `wiki embed`

---

## 工作原理

```text
index
  → wiki inputs --kind architecture / overview / page / visualization
  → 按 Entry → Application → Domain → Storage 分组
  → 沿真实 deps 写阅读导览
  → Claude Code 官方风格 HTML 报告（内嵌 Mermaid）
```

可选：`wiki --no-llm` 落规则页。Agent 报告仍然以 `wiki inputs` 为准。

---

## 命令

| 命令 | 用途 |
| --- | --- |
| `index` | 建符号图，wiki 读这份库 |
| `repos` / `stats` / `query summary` | 确认索引在 |
| `wiki inputs --kind …` | 导出社区 / digest / 依赖 JSON（不调模型） |
| `wiki --no-llm` | 落库或空跑规则 Wiki |

不要跑不带 `--no-llm` 的 `codexqa wiki`。不要跑 `wiki embed` 或 `query wiki`。

---

## 安装与接入

| 使用位置 | 安装位置或方法 | 能力 |
| --- | --- | --- |
| **CLI** | `npm install -g @openqa-cn/codexqa` | 建索引、`wiki inputs`、`wiki --no-llm` |
| **Cursor** | 把 `code-wiki/` 放到 `~/.cursor/skills/` 或 `.cursor/skills/` | 知识图谱工作流 |
| **Claude Code** | `~/.claude/skills/` 或 `.claude/skills/` | 知识图谱工作流 |

维护见 [`references/cli.md`](references/cli.md)。

---

## 包内容

```text
code-wiki/
├── README.md                 # English
├── README.zh-CN.md           # 本文件
├── SKILL.md                  # Agent 路由 + 报告合同
├── assets/
│   └── report-template.html  # Claude Code 官方风格 HTML 外壳（默认中文）
└── references/
    ├── playbook.md           # 场景步骤（按需加载）
    ├── report.md             # HTML 报告填写说明
    ├── diagrams.md           # 报告图规范与模板
    └── cli.md                # 安装 / 仓库 / 无模型 wiki 命令
```
