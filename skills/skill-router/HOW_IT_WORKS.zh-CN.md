# skill-router 工作原理

[English](HOW_IT_WORKS.md)

[`skill-router`](README.zh-CN.md) 把「该用哪个 skill」类请求交接给具体 pack
skill——即使用户只安装了路由本身。

运行时契约：[`SKILL.md`](SKILL.md)。

## 数据流

```text
用户请求（可能未点名 skill）
        │
        ▼
  discover_skills.py --with-catalog
        │  现场兄弟 + 内置 catalog.json
        ▼
  按 description / 边界匹配意图
        │
        ├─ 已安装？ ──是──► 读 SKILL.md → 执行
        │
        └─ 否 ──► 询问一次 → ensure_skill.py --yes
                      │
                      ▼
                 再发现 → 读 SKILL.md → 执行
```

1. **发现** — 扫描兄弟目录，并合并 [catalog.json](references/catalog.json)，
   未安装的干活 skill 仍可匹配；排除 `skill-router`。
2. **匹配** — 语义对照 description
   （[routing-rules.md](references/routing-rules.md)）。
3. **确保安装** — `installed: false` 时拉取到 skills 根目录（本地仓库拷贝、
   GitHub tarball，或 `npx skills add` 兜底）。
4. **交接** — 加载胜出 skill 的 `SKILL.md` 并完整执行。

## 脚本与模型

| 层 | 负责 |
|---|---|
| `discover_skills.py` | 现场 + 内置目录 JSON |
| `ensure_skill.py` | 装到路由旁边 |
| `refresh_catalog.py` | 维护者刷新 `catalog.json` |
| 宿主 agent | 意图匹配、安装确认、执行被选 skill |

## 证据状态

`python3 scripts/discover_skills.py --self-check` 校验内置目录。
`ensure_skill.py --dry-run <name>` 显示安装计划。完整交接质量由模型判断。
