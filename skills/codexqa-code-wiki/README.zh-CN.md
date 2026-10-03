<div align="center">

[English](README.md) · **简体中文**

# CodexQA Code Wiki

</div>

**把仓库变成一页架构 Wiki：有哪些模块、谁调用谁、调用多少次、从哪读起。事实部分不需要模型。**

CodexQA 先给仓库建索引，再把符号调用图切成模块。本技能的脚本把导出结果整理成一份简报，Agent 只往 `notes.json` 里写简短的名字和句子，脚本再渲染出一个自包含的 HTML 页面。Agent 不画图、不改 HTML，所以页面不会和代码对不上。

- **从哪读起** —— 例如「要改支付回调：P06 → P04 → P07」，相邻两步之间一定有真实调用
- **架构图** —— 按调用关系分组，线宽代表调用次数，标出枢纽；悬停可看一个模块的全部调用
- **模块卡片** —— 做什么、调用和被调用（带次数）、对外接口、关键流程、可点到源码的文件
- **搜索** —— 模块、符号、文件；按 `/` 聚焦
- **离线可用** —— 单个 HTML 文件，白天 / 黑夜主题，手机可读，可打印

`codexqa-code-wiki` 回答的是**架构和上手**问题。它不审 PR、不圈回归、不打 P0 / P1 / P2。变更影响用 `codexqa-code-analyzer`，代码风险扫描报告用 `codexqa-defect-analyzer`，CodexQA 证据包 HTML 评审用 `codexqa-code-reviewer`。

Skill 和脚本发布在本仓库；依赖的 `@openqa-cn/codexqa` 是单独分发的闭源本地引擎。建索引和导出都在本机完成，不需要 LLM。边界见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

---

## 快速开始

### 1. 安装

需要 **Node.js >= 18**。

```bash
npx skills add openqa-cn/codexqa --skill codexqa-code-wiki
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
codexqa --help
```

命令找不到时，把 `$(npm prefix -g)/bin` 加进 `PATH`。

### 2. 直接说

```text
给这个仓库做一份代码 Wiki。
```

Agent 会跑三步：

```bash
node <skill>/scripts/wiki.mjs brief .     # 建索引、导出、打印简报
# … 填写 .codexqa-wiki/<repo>/notes.json
node <skill>/scripts/wiki.mjs build .     # 校验 notes，生成 HTML
```

最后给你 `codexqa-code-wiki-<repo>-YYYYMMDD-HHMM.html`。

### 3. 继续细调

`加一条改存储层的阅读路径`、`P04 改个名字`、`换成英文`。Agent 改 `notes.json` 再重新 build，索引和事实不变。

想先看个样子？`brief` 之后直接 `build . --draft`，用规则生成的名字出一版，页面顶部会标明是草稿。

---

## 页面上有什么

| 区块 | 来源 |
|---|---|
| 标题、一句话介绍、概览 | `notes.json` |
| 模块 / 分组 / 独立模块数，导出覆盖了多少索引代码，提交号 | 导出 + git |
| 从哪读起（每一步标出调用次数） | `notes.json` 的步骤，按真实调用校验 |
| 架构图 | 导出，脚本排版 |
| 模块卡片：名字、职责、说明 | `notes.json` |
| 模块卡片：规模、调用、被调用、对外接口、关键流程、文件 | 导出 |
| 术语、用过的命令、生成时间 | 脚本 |

导出被截断、覆盖率低、工作区有未提交改动、草稿，都会在页面顶部标出来。

---

## 为什么用这个技能

- **事实和文字分开。** 次数、连线、架构图都来自导出。Agent 只写名字和句子；`build` 会拒绝不存在的模块、相邻两步没有调用的路径、占位符和内部字段名。
- **结果确定。** 同一份导出，分组、枢纽、建议路径和布局都一样。
- **快。** 首次建索引之后，`brief` 几秒完成，`build` 不到一秒。
- **不依赖 CDN 和服务器。** 页面就是一个文件，可以发邮件、当附件、本地直接打开。

---

## 命令

| 命令 | 用途 |
| --- | --- |
| `wiki.mjs brief <repo>` | 增量建索引、导出 `wiki inputs`、写简报和 `notes.json` 骨架 |
| `wiki.mjs build <repo>` | 校验 `notes.json` 并生成 HTML；没写 notes 时加 `--draft` |
| `wiki.mjs check <repo>` | 只校验 |
| `codexqa wiki --no-llm` | 可选：把规则页存进 CodexQA Web UI |

参数和退出码见 [`references/cli.md`](references/cli.md)。本技能不跑不带 `--no-llm` 的 `codexqa wiki`，也不跑 `wiki embed` 或 `query wiki`。

---

## 安装与接入

| 使用位置 | 安装位置或方法 | 能力 |
| --- | --- | --- |
| **CLI** | `npm install -g @openqa-cn/codexqa` | 建索引、`wiki inputs` |
| **Cursor** | 把 `codexqa-code-wiki/` 放到 `~/.cursor/skills/` 或 `.cursor/skills/` | Wiki 工作流 |
| **Claude Code** | `~/.claude/skills/` 或 `.claude/skills/` | Wiki 工作流 |

---

## 包内容

```text
codexqa-code-wiki/
├── README.md / README.zh-CN.md
├── SKILL.md                  # Agent 流程与规则
├── KNOWN_LIMITATIONS(.zh-CN).md
├── scripts/
│   ├── wiki.mjs              # brief / build / check
│   └── lib/                  # 数据模型、notes 校验、布局、渲染
├── assets/
│   ├── wiki.css              # 页面样式（内联进 HTML）
│   └── wiki.js               # 搜索、架构图高亮、主题、导航
├── references/
│   ├── notes.md              # notes.json 怎么写
│   ├── playbook.md           # 单个模块、索引自检、落库
│   └── cli.md                # 安装 / 仓库标识 / 命令
└── tests/                    # node --test；夹具取自本仓库
```

在技能目录下运行 `npm test` 跑测试。
