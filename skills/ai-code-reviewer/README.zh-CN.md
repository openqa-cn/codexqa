# AI Code Reviewer

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

`ai-code-reviewer` 是**图证据**代码评审：先收集 CodexQA 证据包（调用链、爆炸半径、测试边、各维度信号），再由宿主 agent 写出 `review-conclusion.json` 并渲染双语 `REVIEW-REPORT.html`。适用于任意语言 / 多语言 monorepo，**唯一**主分析后端是公开的 **CodexQA CLI**（`@openqa-cn/codexqa`）。

**不是** [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.zh-CN.md)（SAST+agent 的 `report_scan.*`），**不是**单独的 [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.zh-CN.md)（符号图问答、无本 skill 的 HTML 评审流水线），也**不是** [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.zh-CN.md)（异常 RCA）。目标是**基于 CodexQA 证据包的评审报告**时用本 skill。

## 安装要求

- Node.js ≥ 18
- `PATH` 上有 `bash` 3.2+、`jq`
- `PATH` 上有 `@openqa-cn/codexqa` CLI：
  `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`
- PR/diff 模式需要本地 Git 工作副本与 `--diff-base`；全仓 / adhoc 模式见 `SKILL.md`

## 安装 skill（npx）与跑收集脚本（bash）

| 命令 | 作用 |
|---|---|
| `npx skills add openqa-cn/codexqa --skill ai-code-reviewer` | 把 skill 装进 Coding Agent 的 skills 目录 |
| `bash scripts/collect-pr-evidence.sh …` | 构建证据包（**不是** `npx` 二进制） |

没有 `npx ai-code-reviewer` / package `bin`。安装后把 `$SKILL_DIR` 指到已安装目录，再跑 `$SKILL_DIR/scripts/` 下的脚本。

见[安装指南](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.zh-CN.md)、[支持矩阵](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)和 [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.zh-CN.md)。

## 快速开始

在本 skill 目录下：

```bash
# PR / diff（默认）
./scripts/collect-pr-evidence.sh --repo /abs/path/to/repo --diff-base origin/main

# 全仓健康（可选）
./scripts/collect-fullrepo-evidence.sh --repo /abs/path/to/repo

# Adhoc / 单文件
./scripts/collect-adhoc-evidence.sh --file /abs/path/to/Foo.java

# agent 写完 review-conclusion.json 之后：
./scripts/render-review-html.sh --dir <OUT_DIR>
```

默认 `OUT_DIR`：`<repo>/.codexqa-review/<run-id>/`。用 `./scripts/validate-evidence.sh --dir <OUT_DIR> --mode pr`（或 `full` / `adhoc`）校验。

## Agent 说明

`SKILL.md` 是 AI agent 入口。幸福路径：preflight → 收集证据包 → 校验 → 只根据产物评审 → 写 `review-conclusion.json` → 渲染 `REVIEW-REPORT.html`。

运行时不要加载 `README` / `HOW_IT_WORKS` / `KNOWN_LIMITATIONS`。仅在上下文缺规则时再读 `references/` 与 `prompts/`。禁止编造图边；缺事实 → `confidence: UNKNOWN`。

## 测试

```bash
bash scripts/validate-skill.sh
# 更快迭代（跳过 plan-coverage 审计）：
bash scripts/validate-skill.sh --skip-audit
```

需要 PATH 上有 Python **3.10+**（系统 `python3` 过旧时，`scripts/acr-python` 会解析到 `python3.11` / `3.12` / …）。

## 许可

Apache License 2.0。

## 限制

依赖闭源 `@openqa-cn/codexqa` CLI；评审叙事由模型判断；证据包缺口会削弱结论。具体失败情形见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。数据流见[工作原理](HOW_IT_WORKS.zh-CN.md)。
