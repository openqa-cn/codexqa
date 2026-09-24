# codexqa-skill-router 工作原理

[English](HOW_IT_WORKS.md)

[`codexqa-skill-router`](README.zh-CN.md) 把「该用哪个 skill」类请求交接给具体 pack
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
  suggest_route.py --text "<请求>"
        │  按任务形态，不按 review / PR / 评审 这些共用词
        ▼
  clear | explicit | conflict | ambiguous | chain | none
        │
        ├─ clear/explicit 且已安装？ ──是──► 读 SKILL.md → 执行
        │
        └─ 否 ──► 询问一次 → ensure_skill.py --yes
                      │
                      ▼
                 再发现 → 读 SKILL.md → 执行
```

1. **发现** — 扫描兄弟目录，并合并 [catalog.json](references/catalog.json)，
   未安装的干活 skill 仍可匹配；排除 `codexqa-skill-router`。
2. **匹配** — `suggest_route.py` 按产物和任务形态选择
   （[routing-rules.md](references/routing-rules.md)）。description 不能推翻
   `clear` 结果。代码评审进 `codexqa-code-reviewer`，不进缺陷扫描。
3. **确保安装** — `installed: false` 时拉取到 skills 根目录（本地仓库拷贝、
   GitHub tarball，或 `npx skills add` 兜底）。
4. **交接** — 加载胜出 skill 的 `SKILL.md` 并完整执行。

## 脚本与模型

| 层 | 负责 |
|---|---|
| `discover_skills.py` | 现场 + 内置目录 JSON |
| `suggest_route.py` | 确定性分流，以及易混请求的回归用例 |
| `ensure_skill.py` | 装到路由旁边 |
| `refresh_catalog.py` | 维护者刷新 `catalog.json` |
| 宿主 agent | 跑 suggest、冲突或歧义时提问、执行被选 skill |

## 证据状态

`python3 scripts/discover_skills.py --self-check` 校验内置目录。
`python3 scripts/suggest_route.py --self-check` 校验易混分流，包括代码评审 →
`codexqa-code-reviewer`。
`ensure_skill.py --dry-run <name>` 显示安装计划。`clear` 之后仍按目标 skill 交接。
