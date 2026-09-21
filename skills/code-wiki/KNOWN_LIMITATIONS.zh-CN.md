# 已知边界

[English](KNOWN_LIMITATIONS.md)

本文说明 `code-wiki` skill 及其依赖的本地分析引擎目前有哪些边界。

## 分发边界

本仓库公开发布 skill 文件、playbook 和示例。`codexqa` 命令来自单独分发的闭源 npm 包 `@openqa-cn/codexqa`，分析引擎源码不包含在本仓库中。

建索引、`wiki inputs` 和 `wiki --no-llm` 在本地完成，不需要 LLM。安装过程会从 npm 下载包。本地索引存放在 `~/.codexqa/`；卸载 CLI 不会自动删除这些数据。

## 兼容性与验证状态

- 本仓库 CI 当前不会安装或执行这个闭源 CLI。
- `code-wiki` 目前没有公开的宿主 Agent 运行记录或独立质量 benchmark。
- 示例图用于说明报告契约，不是对某个公开仓库的真实分析记录。
- 目前还没有正式发布 Skill 与 CLI 的版本兼容矩阵。反馈问题时请附上 `codexqa --version`。

## 图与社区完整性

社区来自 Leiden 聚类、目录 / 模块先验和页数上限。切割可能拆开真实包，也可能把无关文件并在一起。stub 节点和符号碰撞也会降低置信度。把地图当成完整结论前，应先看 `stats` / `summary` 以及 `communities` 与 `selected` 是否一致。

不调模型时，页面标题是规则标题（常常像目录名）。这是预期行为。除非签名能支撑，否则不要改写成产品名。

`visualization` / `architecture` / `overview` 的 `wiki inputs` 只用规则标题，没有模型正文。`（无摘要）` 不是一条发现。

## 信号代表什么

- `deps` 和 `cross_community` 是社区之间的静态图关系，不是运行时耦合。
- `deps` 为空表示“没有计入的跨社区边”，不等于“这段代码没人用”。
- `call_chain` / `method_flows` 是 token 预算下的 digest 摘录，不是完整方法体。
- 签名上的 `called_by` 是 digest 里的 fan-in，不是线上流量。
- 阅读导览是沿着已列出依赖的路径，不证明新人只该读这些文件。

## 工作流边界

`code-wiki` 画社区、真实依赖和上手路径。它不跑不带 `--no-llm` 的 `codexqa wiki`，不跑 `wiki embed` 或 `query wiki`，不审变更，不打 P0 / P1 / P2。影响面和测试缺口用 `code-analyzer`，代码风险扫描报告用 `defect-detection`，CodexQA 证据包 HTML 评审用 `ai-code-reviewer`。
