# AI 缺陷检测 Skill

[English](README.md)

面向 Pull Request、测试计划和交付任务的 Agent 缺陷检测工作流。它结合 TypeScript CLI、本地 provider、静态分析和可选远程适配器，输出带位置和依据的疑似缺陷，交给人工确认；当前工作流已经可以用于工程实践。

## 安装要求

需要 Node.js 22+、Git；Java 调用图可选 GitNexus。测试运行：

```bash
export NODE_OPTIONS=--experimental-strip-types
npm test
```

完整说明见[英文手册](README.md)、[中文入门](../../docs/GETTING_STARTED.zh-CN.md)、[中文 FAQ](../../docs/FAQ.zh-CN.md)和[支持矩阵](../../docs/SUPPORT_MATRIX.zh-CN.md)。

工程工作流已提供，但检测效果尚未经过独立 benchmark，不能证明不存在缺陷；远程 provider 和自动工具安装可能联网。
