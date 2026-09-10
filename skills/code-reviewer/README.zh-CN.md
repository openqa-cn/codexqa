# 代码审查

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

对着**本地 Git 工作副本**做 playbook 驱动的代码审查：当前分支、PR 或某个 commit。产出带文件位置、规则引用、运行时影响和修复建议的 P0 / P1 / P2 报告。

报告长什么样：

<p align="center">
  <a href="https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/cr-findings.html"><img src="https://raw.githubusercontent.com/openqa-cn/codexqa/main/docs/assets/previews/cr-findings.png" alt="代码审查 P0 / P1 发现样例" width="880"></a>
</p>

**不是** [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.zh-CN.md)。那个 skill 会按 URL 克隆仓库、抽变更方法、跑 AST / 可选调用图，并对写回做门禁。本 skill 在原地 diff，按前端 / 后端加载 playbook。

## 你要交什么

**磁盘上已经有一份 Git 仓库**，再加上要审的变更：

| 任务 | 带上 |
|---|---|
| 审这个分支 / PR / commit | 在 Agent 里打开该仓库。基线不是 `main` / `master` 时说出基线分支 |
| 仓库自己的 Git 链接、分层、HTTP 集成 | 在**被审仓库**里放 `code-reviewer.config.json`（从 `config/code-reviewer.config.example.json` 复制） |

本 skill 不会按 Git URL 去克隆。不要交 PRD，也不要把应用 `code/` 当成另一份输入。没有 Git 仓库的粘贴片段不在范围内。

## 它做什么

1. 从 diff 判断前端、后端或混合表面。
2. 只加载 `playbook/` 里对应的规则。
3. Node 能跑时执行可选的本地脚本（`tooling/`）。
4. 写出发现报告（`report-formats/findings-report.md`）。

默认关闭 HTTP 集成。报告是给人工复核的候选，不是合并门禁。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

```
code-reviewer/                 # 安装目录（与源码目录同名）
├── SKILL.md                   # 入口；去加载 playbook
├── review-playbook.md         # 审查算法（给 agent）
├── HOW_IT_WORKS.md            # 原理（给人看；agent 不读）
├── HOW_IT_WORKS.zh-CN.md
├── KNOWN_LIMITATIONS.md
├── KNOWN_LIMITATIONS.zh-CN.md
├── config/                    # 被审仓库的 schema 与示例
├── playbook/                  # 按需加载的规则
├── tooling/                   # 可选 TypeScript 助手（编译成 .js）
├── report-formats/
└── examples/
```

## 安装

```bash
npx skills add openqa-cn/codexqa --skill code-reviewer
```

或者把根目录为 `code-reviewer/SKILL.md` 的 zip 解到 `~/.cursor/skills/`（或宿主的项目 skill 目录）。然后**新建** Agent 会话。

## 对 Agent 可以直接说

```text
用 code-reviewer 对照 main 审查当前分支。
每条发现给出严重级别、文件:行号、规则、运行时影响和修复建议。
```

```text
用 code-reviewer 做这次 PR 的 CR。用本地工作副本，不要克隆。
```

## 可选脚本

```bash
cd tooling && npm install && npm run build && npm test && cd -
node tooling/load-config.js
node tooling/run-local-checks.js
node tooling/pack-skill.js
```

只改 `tooling/*.ts`；提交前先编译出对应的 `.js`。

## 许可证

MIT。见 [LICENSE](LICENSE)。OpenQA Skills 仓库是 Apache-2.0；本 skill 保留上游 MIT。
