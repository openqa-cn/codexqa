# codexqa-skill-router

[English](README.md)

按用户请求语义，从 codexqa pack 中自动选出匹配的 skill；**若未安装则按需装到
路由旁边**，再交接执行。

**不是**替代
[`codexqa-defect-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-defect-analyzer/README.zh-CN.md)、
[`codexqa-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-reviewer/README.zh-CN.md)、
[`codexqa-code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-analyzer/README.zh-CN.md)、
[`codexqa-change-analysis`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-change-analysis/README.md)、
[`codexqa-code-wiki`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-wiki/README.zh-CN.md)、
[`codexqa-rootcause-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-rootcause-analyzer/README.zh-CN.md)、
[`codexqa-requirement-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-requirement-analyzer/README.zh-CN.md)、
[`codexqa-testcase-generator`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-testcase-generator/README.zh-CN.md)、
[`codexqa-testdata-generator`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-testdata-generator/README.zh-CN.md)
或
[`codexqa-jev-browser`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-jev-browser/README.zh-CN.md)。
那些才是干活的 skill；本 skill 负责**发现、匹配、按需安装、按对方 SKILL.md 交接**。

## 安装

```bash
npx skills add openqa-cn/codexqa --skill codexqa-skill-router
```

脚本需要 Python 3.10+。**可以只装路由**：匹配走内置
[references/catalog.json](references/catalog.json)；首次交接会跑
`ensure_skill.py`（先问一次）把选中的干活 skill 拉到旁边。预先装好干活 skill
也可以，可跳过拉取。

## 用法

```text
帮我看看该用哪个 skill：对照 origin/main 审一下这个仓库，我要一份能打开的审查报告。
```

Agent 应：

1. `python3 scripts/discover_skills.py --with-catalog`
2. `python3 scripts/suggest_route.py --text "<请求>"` → 按 `outcome` 执行
3. 未安装则 `python3 scripts/ensure_skill.py <name> --yes`
4. 读目标 `SKILL.md` 并继续

## 冒烟

```bash
python3 scripts/discover_skills.py --self-check
python3 scripts/suggest_route.py --self-check
python3 scripts/discover_skills.py --with-catalog --names-only
python3 scripts/ensure_skill.py codexqa-code-reviewer --dry-run
```

维护者（完整 checkout）：`python3 scripts/refresh_catalog.py`

## 文档

- [工作原理](HOW_IT_WORKS.zh-CN.md)
- [已知边界](KNOWN_LIMITATIONS.zh-CN.md)
- Agent 地图：[SKILL.md](SKILL.md)

## 许可

Apache-2.0。见 [LICENSE](LICENSE)。
