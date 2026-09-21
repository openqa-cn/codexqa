# HTML 报告（默认简体中文）

写报告前读本文件。画图规则见 [diagrams.md](diagrams.md)。路由见 [SKILL.md](../SKILL.md)。

交付物是**一份自包含 HTML**。对话里的 Markdown 只负责指向这个文件，不是报告本身。

外观沿用 Claude Code 官方 session-report：象牙页 `#FAF9F5`、深色终端 `#1a1918`、陶土色 `#D97757`、数字/命令用 JetBrains Mono。不要另起卡片看板、浅色 SaaS 主题或 Archify 画布。

**默认语言是简体中文。** 标题、指标、发现、概览、表格、导览、笔记、图注都用中文。编号 `p01` 和符号名原样保留。用户没要求英文时，不要把栏目标成 findings / overview / pages selected。

读者是「刚打开这个仓库的人」。每段都要回答：这是什么、先读谁、改哪里风险大、哪些可以后看。不要把 `deps` / `cross_community` / `wiki inputs` / `node_count` 当作读者词汇——内部字段只用来取证，写成「依赖」「跨模块关系」「本次导出」「规模」。

## 步骤

1. **先有证据。** 只用本次 `wiki inputs` 的 `inputs[].input`。
2. **复制模板**（技能包自带）到工作目录：
   ```bash
   cp <skill-dir>/assets/report-template.html ./code-wiki-$(date +%Y%m%d-%H%M).html
   ```
   仓库名更清楚时写成 `code-wiki-<repo-slug>-YYYYMMDD-HHMM.html`。
3. **用 Edit 改副本**（不要用 Write，不要改 CSS 和 mermaid 加载器）：
   - `<title>`、`#title-path`、`#cmd-repo`、`#cmd-flags`、`#meta-line`
   - `#hero-total` / `#hero-split`（英雄数字 = 本报告收录的模块数，单位写「个模块」）
   - `#howto` 可按本仓改一句，但必须告诉读者先看发现、再按路径读
   - `#overall-grid`（模块社区 / 本报告收录 / 独立模块 / 依赖关系）
   - `#takeaways` — **3～5** 条，每条 = 事实 + 对读者意味着什么。精确 markup：
     ```html
     <div class="take info"><div class="fig">8</div><div class="txt"><b>p03 计价</b>是枢纽：列出 6 条依赖、规模最大。改这里影响面最宽，先读它的对外接口。</div></div>
     ```
     分类：`.take bad`（意外孤立 / 缺边 / 图被截断）、`.take good`（一条能走通的 入口→存储 路径）、`.take info`（中性事实）。`.fig` 用短数字（`8`、`3/12`、`p03`、`51%`）。主语包在 `<b>` 里。不要写「from this wiki inputs run」这种内部口吻。
   - `#overview` — 2～4 段人话：这个系统是什么、主链路怎么走、各层干什么。规则标题可以当模块名，但必须补一句职责。空的 `（无摘要）` 不是发现，不要贴进正文。
   - `#community-bars` / `#module-rows` — 每个收录页一行。分层列只用 **入口 / 应用 / 领域 / 存储**（图里的 subgraph 标题仍按 diagrams.md 用 Entry / Application / Domain / Storage）。没有依赖的页不要进这四层，列到 `#peripheral`。
   - `#diagrams` — 至少一张 `.diagram`，内含 `<pre class="mermaid">`。`%%{init:...}%%` 和三行 `classDef` 从 [diagrams.md](diagrams.md) 原样复制。图下三行用中文：`依据`、`是否截断`、`图在说明`。节点标签里的 `<` 要转义。
   - `#guides` — 1～3 条路径，用 `.callout`。相邻步骤必须出现在 `deps` / `真实依赖` 里。每步写「读什么 + 为什么下一步是它」；枢纽步加 `.callout.risk`，并可加 `<span class="why">…</span>`。
   - `#notes` — 每个核心页一个 `<details>`（`amt` = `p01`，`desc` = 人话职责，body = 职责 / 对外接口 / 内部调用 / 跨模块往来）。不要把 `signatures` / `call_chain` 当小标题原文甩给读者。
   - `#peripheral` — 没有依赖的页，并写清「为什么可以后看」（独立工具 / 实验原型 / 演示）。没有则写「未列出」。
   - `#foot-gen` / `#foot-stats` — 生成时间和用过的 `wiki inputs` 命令。
4. **不要改现有分区结构，也不要重做皮肤。** 本场景确实没有的内容可以留空提示，不要删标题。
5. **把文件路径告诉用户。** 不要在对话里打开文件或粘贴整份 HTML。

## 各栏怎么写才有用

| 栏 | 读者要带走的 | 不要写成 |
|---|---|---|
| 关键发现 | 谁是枢纽、从哪读、哪些别先碰、图有没有被截断 | 字段名堆砌、目录名复读、没有「所以呢」 |
| 系统怎么运转 | 一句话定位 + 主链路 + 各层职责 | 产品介绍、用例清单、优缺点打分 |
| 模块地图 | 每个编号在哪一层、依赖谁、规模多大 | 把独立模块塞进某一层 |
| 架构图 | 一眼看到入口→存储，以及哪一个是核心 | 空图、包名当层名、编造边 |
| 阅读路径 | 打开编辑器后的先后顺序，每步有真实依赖 | 「然后去看 README」或跳步 |
| 模块笔记 | 做什么、对外暴露什么、和谁往来 | 把 JSON 字段原样贴上 |
| 独立模块 | 为什么不在主链、什么时候才需要看 | 假装它们属于领域层 |

模块列优先写 **编号 + 人话职责**（如 `p01 渲染内核`）。目录名 `render-architecture.mjs` 可以当副名，不要当唯一标题。没有签名/调用链支撑时，不要把目录名润色成产品名。

## Markup 速查

社区规模条（可选，按 `node_count` 取前 N；宽 48 格）：

```html
<div class="bar"><span class="name">p03 计价</span><span class="blocks">████████░░░░░░░░</span><span class="pct">24%</span></div>
```

模块地图行：

```html
<tr><td class="mono">p03</td><td>领域</td><td>计价 · 折扣与报价</td><td class="num">42</td><td>p01，p04</td></tr>
```

阅读路径一步：

```html
<div class="callout risk"><b>2. p03 计价</b> — 从 p02 列有依赖；这里是枢纽，先搞清对外接口再往下读。<span class="why">改这里会同时碰到结算和存储。</span></div>
```

模块笔记：

```html
<details>
  <summary>
    <span class="amt">p03</span>
    <span class="desc">计价 <span class="tag risk">枢纽</span></span>
    <span class="meta">42 个符号 · 6 条依赖 · 被调用多</span>
  </summary>
  <div class="body">
    <p><b>职责：</b>…</p>
    <p><b>对外接口：</b>…</p>
    <p><b>内部调用：</b>…</p>
    <p><b>跨模块：</b>被谁调用 / 调用谁（只写本次导出里有的边）</p>
  </div>
</details>
```

## 出现这些情况就整份重写

- 改了皮肤色板（象牙 / term-bg / 陶土色 / JetBrains Mono 缺失）
- 没复制模板，自己另起了一套版式
- Mermaid 缺 `init` / `classDef` / 该标 `class ... risk` 的核心模块没标
- 把没有依赖的页放进了入口 / 应用 / 领域 / 存储
- 证据不是本次 `wiki inputs`
- 生成了 Archify / 分组泳道架构画布
- 用户没要求英文，但栏目标题或正文仍是 findings / overview / pages selected
- 发现或概览把 `deps` / `cross_community` / `wiki inputs` 当读者用语，没有写出职责和阅读顺序
