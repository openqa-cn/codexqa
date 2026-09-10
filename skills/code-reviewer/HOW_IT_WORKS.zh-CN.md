# 代码审查：原理

[English](HOW_IT_WORKS.md)

[`code-reviewer`](README.zh-CN.md) 不内置模型。它是宿主 agent 要遵循的 playbook：从本地 Git diff 判断审查表面、加载对应规则、可选跑 `tooling/` 脚本，写出 P0 / P1 / P2 报告。

**输入是本地工作副本，不是克隆地址。** 在 Agent 里打开仓库，并说出分支 / PR / commit。本 skill 不会像 [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.zh-CN.md) 那样去拉远程。详见 [README · 你要交什么](README.zh-CN.md#你要交什么)。

Agent 运行时读 [`SKILL.md`](SKILL.md) 再读 [`review-playbook.md`](review-playbook.md)，不要读本页。能力边界见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。报告样例：[预览页](https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/cr-findings.html)。

## 要解决的问题

直接让模型「审这个 PR」常见三类错误：

| 错误 | 表现 | 约束 |
|---|---|---|
| 把风格偏好当发现 | 报告全是口味，没有运行时代价 | 每条发现必须有具体运行时影响；禁止「建议重构」 |
| 编造位置 | 行号从未读过 | P0 要有位置 + 后果 + 规则引用；可选脚本跑不了就跳过，不阻断 |
| 一份 playbook 打所有文件 | 前端规则套在 Java 服务上，或反过来 | 从 diff 判断前端 / 后端 / 混合；只加载匹配的 `playbook/` |

模型做判断。playbook 决定用哪些规则、什么样的发现才算数。落盘和 HTTP 都是可选的。

## 评估状态

没有公开 fixture、没有答案键、没有和 defect-detection inventory-service 7/7 对等的数字。`tooling/` 有离线契约检查。把「写出一份报告」当成设计意图，不要当成已测过的误报率。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 你会看到什么

| 时机 | 展示 | 你怎么回 |
|---|---|---|
| 没有配置 | 内置默认（先 `main` 再 `master`；HTTP 关闭） | 可选：在被审仓库放 `code-reviewer.config.json` |
| `tooling/` 脚本跑不了 | 报告里警告，审查继续 | 授权该命令，或忽略 |
| diff 很大 | 按文件类型分组、两阶段、或多 agent | 让它跑完，或指定更小的 commit 范围 |
| 审查结束 | 带位置、规则、影响、修复的 P0 / P1 / P2 | 人工确认或驳回 |

## 机制

### 1. 先 diff，再 playbook

变更集决定表面。总是加载的规则（`project-conventions`、`design-quality-rules`）加上按文件类型和内容触发的 playbook。用不到的语言不加载。

### 2. 发现不是写回

没有任务库、没有 23 条写回校验、没有 HTML 平台报告。输出就是发现报告。带门禁的「需求对代码」缺陷审查是 [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.zh-CN.md)。

### 3. 外部系统只认配置

Git 浏览链接、分层路径、HTTP 集成只来自 `tooling/load-config.js`。没有配置或 `enabled: false` → 跳过并留痕迹。不编造主机名。

### 4. 体量切换模式

| Diff 行数 | 模式 |
|---|---|
| ≤ 200 | 标准 |
| 200–600 | 按文件类型分组 |
| 600–3000 | 两阶段 |
| > 3000 | 多 agent，共享规则快照 |

## 流水线

```text
本地 git 工作副本 + 分支 / PR / commit
        │
        ▼
  load-config（没有则用默认）
        │
        ▼
  对照基线出 diff
        │
        ▼
  判断表面 → 加载匹配 playbook
        │
        ▼
  可选 tooling（进度、安全、依赖）
        │
        ▼
  深度审查（按 diff 体量选模式）
        │
        ▼
  校验过滤 → 发现报告
```

## 延伸阅读

| 主题 | 文档 |
|---|---|
| 要交什么、安装、怎么说 | [README](README.zh-CN.md) |
| 已知失败与边界 | [已知边界](KNOWN_LIMITATIONS.zh-CN.md) |
| Agent 入口 | [`SKILL.md`](SKILL.md) |
| 审查算法 | [`review-playbook.md`](review-playbook.md) |
| 仓库配置 | [`config/README.md`](config/README.md) |
| 各 skill 要交什么 | [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.zh-CN.md) |
