# OpenQA Skills

面向 Coding Agent 的开源软件变更验证 Skills。

**语言：** [English](README.md) · 简体中文

> AI 负责写变更，OpenQA 帮助证明它有效。

OpenQA 关注的不只是生成代码或测试，而是帮助 Agent 验证软件变更是否满足目标、覆盖关键风险，并留下可复核的证据。

## 当前提供

- `verify-change`：分析变更、风险、验证计划和合并准备度；
- `test-quality`：识别弱断言、缺失异常路径和“通过但没有证明价值”的测试；
- `evidence-report`：将执行结果整理为可阅读、可追踪的验收证据。

Skills 设计为本地运行，可连接已有的测试框架和 CI，不要求注册 OpenQA Cloud。

## 快速开始

项目仍处于 early access 阶段。请先阅读 [Skills 目录](skills/README.md)、[Benchmark 规范](benchmarks/README.md) 和 [贡献指南](CONTRIBUTING.md)。

```bash
git clone https://github.com/openqa-cn/openqa-skills.git
cd openqa-skills
```

可以先阅读 [`skills/verify-change/SKILL.md`](skills/verify-change/SKILL.md)，将其中的指令交给你正在使用的 Coding Agent，并提供本地 diff、验收条件和可安全执行的命令。当前版本是 Skill 合约和工作流预览，真正可执行的适配器会逐步加入。

## 文档导航

- [英文主文档](README.md)：完整项目介绍和最新信息；
- [Skills 目录](skills/README.md)：当前和计划中的验证 Skill；
- [Evidence Schema](schemas/evidence.schema.json)：机器可读的证据格式；
- [Benchmark 规范](benchmarks/README.md)：评估测试有效性的原则；
- [贡献指南](CONTRIBUTING.md)：如何提交 Skill、适配器和案例；
- [支持与反馈](SUPPORT.md)：问题、讨论和企业合作入口。

## 相关链接

- 官网：https://openqa.cn
- 产品预览：https://openqa.cn/agent
- GitHub：https://github.com/openqa-cn/openqa-skills
- 问题反馈：https://github.com/openqa-cn/openqa-skills/issues
- 讨论区：https://github.com/openqa-cn/openqa-skills/discussions
