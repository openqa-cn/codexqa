# 已知边界

[English](KNOWN_LIMITATIONS.md)

本文说明 `codexqa-code-analyzer` skill 及其依赖的本地分析引擎目前有哪些边界。

## 分发边界

本仓库公开发布 skill 文件、playbook、查询 schema 和示例。`codexqa` 命令来自单独分发的闭源 npm 包 `@openqa-cn/codexqa`，分析引擎源码不包含在本仓库中。

建索引和图查询在本地完成，不需要 LLM。安装过程会从 npm 下载包；使用已配置外部服务的可选功能时可能联网。本地索引和会话存放在 `~/.codexqa/`；卸载 CLI 不会自动删除这些数据。

## 兼容性与验证状态

- 本仓库 CI 当前不会安装或执行这个闭源 CLI。
- `codexqa-code-analyzer` 目前没有公开的宿主 Agent 运行记录或独立质量 benchmark。
- 示例图用于说明报告契约，不是对某个公开仓库的真实分析记录。
- 目前还没有正式发布 Skill 与 CLI 的版本兼容矩阵。反馈问题时请附上 `codexqa --version`。

当前公开证据见仓库[支持矩阵](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)。

## 图完整性

如果 parser 无法解析某种语言结构、框架约定、生成代码、宏、动态分派、反射或运行时注册，图关系可能缺失或只做近似。stub 节点和符号碰撞也会降低结论置信度。把影响范围当成完整结论前，应先检查 `stats` 和 `summary`。

## 信号代表什么

- `tests` 边是静态图关系，不是运行时代码覆盖率。
- 没有 `tests` 边表示“没有找到图关系测试”，不等于“这段代码一定没有测试”。
- 可达关系表示索引中存在路径，不证明该路径在所有运行条件下都可执行。
- HTTP / RPC / MQ / 定时任务入口识别依赖框架 tag 和可识别的源码模式。
- 全文检索需要单独建立搜索索引，结果会受分词器选择影响。

## 工作流边界

`codexqa-code-analyzer` 分析结构、变更影响、调用方、入口和测试缺口。它不执行测试、不证明不存在缺陷、不判断代码是否符合业务需求，也不替代图证据代码审查。代码风险扫描用 `codexqa-defect-analyzer`（SAST + Agent LLM Detection），CodexQA 证据包 HTML 评审用 `codexqa-code-reviewer`（含 Agent LLM judgment），完整异常根因报告用 `codexqa-rootcause-analyzer`（在 CodexQA CLI 分析之上）。
