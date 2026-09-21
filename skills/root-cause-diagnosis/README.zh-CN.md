# 根因诊断

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

`root-cause-diagnosis` 把异常证据（堆栈、日志、调用链 dump、调试输出）加上业务代码库，变成一份**英文** Markdown 根因报告（`report.md` / `report.en.md`）。对业务仓库的结构化理解只来自公开的 **CodexQA CLI**（`@openqa-cn/codexqa`）；本 skill 不复制引擎或 skill 源码。

**不是** [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.zh-CN.md)（符号图影响面 / 调用方 / 测试缺口），**不是** [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.zh-CN.md)（SAST + Agent LLM Detection 代码风险扫描报告），也**不是** [`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.zh-CN.md)（CodexQA 证据包 HTML 评审，含 Agent LLM judgment）。那些负责结构、需求或审查发现；输入是异常、目标是根因分析时用本 skill。

## 安装要求

- Node.js 22+（通过 `NODE_OPTIONS=--experimental-strip-types` 跑 TypeScript）
- 远程仓库输入时需要 `git` 在 `PATH` 上
- `PATH` 上有 `@openqa-cn/codexqa` CLI（缺失时安装）：
  `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`
- 仅在克隆远程仓库、以及必要时安装 CLI 时联网

## 安装 skill（npx）与跑 CLI（node）

| 命令 | 作用 |
|---|---|
| `npx skills add openqa-cn/codexqa --skill root-cause-diagnosis` | 把 skill 装进 Coding Agent 的 skills 目录 |
| `node scripts/diagnose.ts …` | 跑诊断 CLI（**不是** `npx` 二进制） |

没有 `npx root-cause-diagnosis` / package `bin`。安装后把 `$SKILL_DIR` 指到已安装目录，再跑 `node "$SKILL_DIR/scripts/diagnose.ts"`。

见[安装指南](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.zh-CN.md)、[支持矩阵](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)和 [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.zh-CN.md)。

## 快速开始

在本 skill 目录下：

```bash
export NODE_OPTIONS=--experimental-strip-types

node scripts/diagnose.ts run \
  --exception-file /tmp/npe.txt \
  --file /abs/path/OrderService.java

# 本地目录（非 git 会复制进 data/<taskId>/repo 再给 CodexQA）：
node scripts/diagnose.ts run \
  --exception-file /tmp/npe.txt \
  --dir /abs/path/to/business-code

# 或 git 远程：
node scripts/diagnose.ts run \
  --exception-file /tmp/npe.txt \
  --git git@github.com:acme/order-service.git \
  --branch main
```

`run` 是一次进程里的 `submit` + 增量 CodexQA 索引 + 并行帧分析。逐步命令（`submit`、`ensure-codexqa`、`analyze-frames`）仅供调试。

Agent 跑 `run`，写出 `brief.json`、`facts.json` 和仅含标题的 `report.draft.md`。按 facts 填草稿（只写叙事），再 `write-report --from-draft`。不要读 `analysis.json`，也不要硬裁字数。CLI 不写 RCA 正文。

## Agent 说明

Agent 入口是 `SKILL.md`。主路径：异常文件 → `run` → 按 `facts.json` 填 `report.draft.md` → `write-report --from-draft` → 用 stdout 的 `chat.en` 给一段英文摘要，并附上 `report.md` / `report.en.md`。

`run` 之前不要加载 `references/`。有 `facts` 之后按 `SKILL.md` 的 Report rules 填草稿；只有规则不在上下文里时才加载 reference。

## 测试

```bash
export NODE_OPTIONS=--experimental-strip-types
npm test
```

## 许可证

Apache License 2.0。

## 边界

依赖闭源的 `@openqa-cn/codexqa` CLI；RCA 叙事质量由模型判断；图缺口会削弱证据。具体失败场景见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。数据流见[工作原理](HOW_IT_WORKS.zh-CN.md)。完整说明见[英文 README](README.md)。
