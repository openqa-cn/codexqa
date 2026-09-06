# 安装与运行 AI 缺陷检测

[English](GETTING_STARTED.md)

## 环境要求

需要 Node.js、npm/npx、Git，以及能够读取 Skill 文件并执行命令的 Coding Agent。CLI 测试在 macOS、Node 22.15.0 上通过，运行 TypeScript 需要：

```bash
export NODE_OPTIONS=--experimental-strip-types
node --version
git --version
```

## 从 GitHub 安装

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection
```

按提示选择 Agent；为 Codex 全局安装：

```bash
npx skills add openqa-cn/openqa-skills --skill ai-defect-detection --agent codex --global
```

## 本地验证

在仓库根目录运行：

```bash
npx skills add . --skill ai-defect-detection --agent codex --copy
export NODE_OPTIONS=--experimental-strip-types
node skills/ai-defect-detection/open_detect.ts --help
node --test skills/ai-defect-detection/tests/cli_smoke.test.ts
node examples/checkout-boundary/verify.mjs
```

## 启动审查

安装后新建 Agent 会话，提供仓库 URL、分支、需求或测试用例。结果是待人工复核的疑似发现，不是自动合并决定。

## 更新与排错

```bash
npx skills list
npx skills update
npx skills remove ai-defect-detection --agent codex
```

常见问题包括：skill 未推送到 GitHub、Agent 安装范围错误、Node 无法识别 `.ts`、静态分析工具不在 PATH，以及远程 provider 无权限。报告问题时请提供 commit、系统、Node 版本、Agent 版本和脱敏命令输出。
