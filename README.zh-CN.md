# OpenQA Skills

面向 Coding Agent 的开源软件变更验证 Skills。

> AI 负责写变更，OpenQA 帮助证明它有效。

OpenQA 关注的不只是生成代码或测试，而是帮助 Agent 验证软件变更是否满足目标、覆盖关键风险，并留下可复核的证据。

## 当前提供

- `verify-change`：分析变更、风险、验证计划和合并准备度；
- `test-quality`：识别弱断言、缺失异常路径和“通过但没有证明价值”的测试；
- `evidence-report`：将执行结果整理为可阅读、可追踪的验收证据。

Skills 设计为本地运行，可连接已有的测试框架和 CI，不要求注册 OpenQA Cloud。

## 快速开始

项目仍处于 early access 阶段。请先阅读 [Skills 目录](skills/README.md)、[Benchmark 规范](benchmarks/README.md) 和 [贡献指南](CONTRIBUTING.md)。

## 相关链接

- 官网：https://openqa.cn
- 产品预览：https://openqa.cn/agent
- GitHub：https://github.com/openqa-cn/openqa-skills
- 问题反馈：https://github.com/openqa-cn/openqa-skills/issues
- 讨论区：https://github.com/openqa-cn/openqa-skills/discussions
