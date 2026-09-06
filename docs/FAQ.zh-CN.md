# AI 缺陷检测 FAQ

[English](FAQ.md)

## 这是做什么的？

`ai-defect-detection` 是 OpenQA 当前已提供的 Skill，将 Agent 指令、TypeScript CLI、静态分析和本地/远程 provider 组合成一次可追踪的变更审查。它可以用于工程实践，但检测效果尚未经过独立 benchmark。

## 需要 npm 或 OpenQA 账号吗？

不需要。`npx skills add` 只是从 GitHub 获取 Skill 的通用安装器。

## 安装后会自动审查代码吗？

不会。安装只让 Agent 能读取文件；你还需要提供仓库、分支和需求材料。

## 代码会离开本机吗？

取决于宿主 Agent/模型和 provider 配置。本地 provider 将结果写入磁盘；远程 provider、仓库克隆、文档获取以及自动安装 Semgrep/GitNexus 可能联网。

## 它能替代测试或静态分析吗？

不能。它组织上下文和证据，并输出待人工确认的候选；不证明不存在缺陷，也不替代测试执行。

## 当前支持什么？

Skill 文档面向 Codex、Claude Code、Cursor 和 OpenClaw；完整 Agent 流程和检测准确率尚未完成独立 benchmark，详见[支持矩阵](SUPPORT_MATRIX.md)。
