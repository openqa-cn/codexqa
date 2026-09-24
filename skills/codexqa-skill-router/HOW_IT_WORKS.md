# How codexqa-skill-router works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`codexqa-skill-router`](README.md) turns an underspecified "which skill?" request into
a hand-off to a concrete pack skill — even when only the router was installed.

Runtime contract: [`SKILL.md`](SKILL.md).

## Data flow

```text
user request (may not name a skill)
        │
        ▼
  discover_skills.py --with-catalog
        │  live siblings + bundled catalog.json
        ▼
  suggest_route.py --text "<request>"
        │  task shape, not shared words (review / PR / 评审)
        ▼
  clear | explicit | conflict | ambiguous | chain | none
        │
        ├─ clear/explicit and installed?  ──yes──► read SKILL.md → execute
        │
        └─ no ──► ask once → ensure_skill.py --yes
                      │
                      ▼
                 re-discover → read SKILL.md → execute
```

1. **Discover** — live scan of sibling dirs; merge [catalog.json](references/catalog.json)
   so missing workers remain matchable. Exclude `codexqa-skill-router`.
2. **Match** — `suggest_route.py` picks by artifact and task shape
   ([routing-rules.md](references/routing-rules.md)). Descriptions do not
   override a `clear` winner. 代码评审 goes to `codexqa-code-reviewer`, not
   the defect scan.
3. **Ensure** — if `installed: false`, fetch into the skills root (local repo
   copy, GitHub tarball, or `npx skills add` fallback).
4. **Hand off** — load the winner's `SKILL.md` and follow it to completion.

## Scripts vs model

| Layer | Owns |
|---|---|
| `discover_skills.py` | Live + bundled catalog JSON |
| `suggest_route.py` | Deterministic skill choice and near-miss fixtures |
| `ensure_skill.py` | Deterministic install beside the router |
| `refresh_catalog.py` | Maintainer regen of `catalog.json` |
| Host agent | Runs suggest, asks on conflict/ambiguity, executes the chosen skill |

## Evidence status

`python3 scripts/discover_skills.py --self-check` verifies the bundled catalog.
`python3 scripts/suggest_route.py --self-check` verifies near-miss routing,
including 代码评审 → `codexqa-code-reviewer`.
`ensure_skill.py --dry-run <name>` shows the install plan. Hand-off after a
`clear` winner still follows the target skill.
