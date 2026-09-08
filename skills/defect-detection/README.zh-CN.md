# 缺陷检测

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

面向 Pull Request、测试计划和交付任务的 Agent 缺陷检测工作流。**输入是 git 仓库和分支**（再加你能提供的需求或用例）。它结合 TypeScript CLI、本地 provider、静态分析和可选远程适配器，输出带位置和依据的疑似缺陷，交给人工确认；当前工作流已经可以用于工程实践。

## 安装要求

需要 Node.js 22+、Git；可选 Semgrep（10 种语言共 102 条 AST 种子规则，推荐 1.x）与 GitNexus（JVM / Go / Python / C# 调用图）。`npx skills add` 只负责安装 skill，真正跑 CLI 用 `node scripts/detect.ts`。端到端示例见[英文 README Quick start](README.md)（checkout-boundary fixture）。测试运行：

```bash
export NODE_OPTIONS=--experimental-strip-types
npm test
```

完整说明见[英文手册](README.md)、[中文入门](https://github.com/openqa-cn/openqa-skills/blob/main/docs/GETTING_STARTED.zh-CN.md)、[中文 FAQ](https://github.com/openqa-cn/openqa-skills/blob/main/docs/FAQ.zh-CN.md)和[支持矩阵](https://github.com/openqa-cn/openqa-skills/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)。

检测方法与设计取舍见[工作原理](HOW_IT_WORKS.zh-CN.md)。工程工作流已可用，但检测效果尚未经过独立 benchmark，也不能证明不存在缺陷；具体失败场景和实现缺口见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。远程 provider 和自动工具安装可能联网。
