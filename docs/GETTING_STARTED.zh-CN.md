# 安装与运行 OpenQA Skills

[English](GETTING_STARTED.md)

下面的命令和冒烟路径以 [`defect-detection`](../skills/defect-detection/README.zh-CN.md) 为例，因为它有 CLI。同一安装器也接受 `--skill code-reviewer`、`--skill requirements-analyzer`、`--skill testcase-generation` 和 `--skill testdata-generation`；后四者没有对等的 `detect.ts` 冒烟套件。

## 环境要求

需要 Node.js、npm/npx、Git，以及能够读取 Skill 文件并执行命令的 Coding Agent。CLI 测试在 macOS、Node 22.15.0 上通过，运行 TypeScript 需要：

```bash
export NODE_OPTIONS=--experimental-strip-types
node --version
git --version
```

## 从 GitHub 安装

```bash
npx skills add openqa-cn/openqa-skills --skill defect-detection
```

按提示选择 Agent；为 Codex 全局安装：

```bash
npx skills add openqa-cn/openqa-skills --skill defect-detection --agent codex --global
```

## 本地验证

在仓库根目录运行：

```bash
npx skills add . --skill defect-detection --agent codex --copy
export NODE_OPTIONS=--experimental-strip-types
node skills/defect-detection/scripts/detect.ts --help
node --test skills/defect-detection/tests/cli_smoke.test.ts
node examples/checkout-boundary/verify.mjs
```

## 启动审查

安装后新建 Agent 会话，提供仓库 URL、分支、需求或测试用例。结果是待人工复核的疑似发现，不是自动合并决定。

## 更新与排错

```bash
npx skills list
npx skills update
npx skills remove defect-detection --agent codex
```

常见问题包括：skill 未推送到 GitHub、Agent 安装范围错误、Node 无法识别 `.ts`、静态分析工具不在 PATH，以及远程 provider 无权限。报告问题时请提供 commit、系统、Node 版本、Agent 版本和脱敏命令输出。

## 其他已发布 skill

```bash
npx skills add openqa-cn/openqa-skills --skill code-reviewer
npx skills add openqa-cn/openqa-skills --skill requirements-analyzer
npx skills add openqa-cn/openqa-skills --skill testcase-generation
npx skills add openqa-cn/openqa-skills --skill testdata-generation
```

安装后新建 Agent 会话并指向该 skill。输入各不相同：

- `code-reviewer` 需要本地 Git 工作副本，再加上分支 / PR / commit。它不克隆。见 [README · 你要交什么](../skills/code-reviewer/README.zh-CN.md#你要交什么)。
- `requirements-analyzer` 需要需求文档，不要交仓库。见 [README · 你要交什么](../skills/requirements-analyzer/README.zh-CN.md#你要交什么)。
- `testcase-generation` 需要 `prd/`（PRD / 技术方案 / 契约）。`code/` 可选，且只在更新时用。见其 [README](../skills/testcase-generation/README.zh-CN.md)。
- `testdata-generation` 需要造数请求、用例或 API 来源，**不要**丢被测源码当输入。见其 [README · 你要交什么](../skills/testdata-generation/README.zh-CN.md#你要交什么)。

对各 skill 可以直接说的话：[仓库 README · 快速开始](../README.zh-CN.md#快速开始)。

原理索引：[各 skill 的工作原理](HOW_IT_WORKS.zh-CN.md)。各 skill 要交什么：[FAQ](FAQ.zh-CN.md#每个-skill-要我交什么)。
