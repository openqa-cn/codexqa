# 兼容性与验证状态

[English](SUPPORT_MATRIX.md)

安装兼容不等于分析质量。当前证据如下：

| 组件 | 当前证据 | 限制 |
| --- | --- | --- |
| TypeScript CLI | macOS、Node 22.15.0 本地通过 94 个测试 | 不代表能发现所有缺陷 |
| Codex、Claude Code、Cursor、OpenClaw | Skill 指令覆盖 | 尚未逐一完成完整 Agent 流程验证 |
| Java / GitNexus | 有集成代码和测试 | 依赖外部工具版本和环境 |
| 本地 provider | 任务、报告、写回测试 | 未认证多人并发 |
| HTTP / GitHub provider | 有适配器和协议测试 | 真实凭据集成待验证 |
| Windows | 未验证 | 当前脚本偏 POSIX |

当前没有公开的精确率/召回率 benchmark。
