# 已知边界

[English](KNOWN_LIMITATIONS.md)

## 只装路由时需要按需拉取

**只安装** `skill-router` 时，可用内置 [catalog.json](references/catalog.json)
做**匹配**。真正执行仍须 `ensure_skill.py`（或手动 `npx skills add`），把目标
`SKILL.md` 与脚本装到路由旁边。无网络 / 本地仓库 / npx 时 ensure 失败，必须停
止交接。

## 内置目录可能落后于新 skill

新 skill 作为兄弟目录安装后，现场发现即可路由。仅装路由时的匹配，需要发布前用
`scripts/refresh_catalog.py`（完整 checkout）刷新 `catalog.json`。

## 发现 / 目录质量

description 含糊会导致误路由或被迫澄清。作者应在 frontmatter `description` 写
清触发语与「不是某某」。

## 路由由模型判断

脚本负责列出与安装候选。近义请求的取舍由宿主模型依据 description 与
[routing-rules.md](references/routing-rules.md) 完成。

## 不代为满足目标 skill 的前置条件

选中 `ai-code-reviewer` 不会自动安装 `codexqa` / `jq`。交接后仍以目标 skill
的 compatibility 为准。

## 本身不干活

若跳过交接、另起一套并行流程，属于误用路由，不受目标 skill 门禁约束。

## 宿主 skill 列表刷新

ensure 之后优先直接读返回的 `skillMd` 路径。宿主可能要到新会话才更新 skill
选择器。

## 无公开宿主 agent 成绩

`--self-check` 覆盖内置目录存在性。歧义请求上的路由准确率没有公开 benchmark。

## 工作流边界

本 skill **路由、按需安装并交接**。不替代扫描、图证据审查、符号图问答、RCA、
需求分析、用例生成或造数。
