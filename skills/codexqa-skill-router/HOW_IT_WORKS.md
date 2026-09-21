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
  match intent to descriptions / boundaries
        │
        ├─ winner installed?  ──yes──► read SKILL.md → execute
        │
        └─ no ──► ask once → ensure_skill.py --yes
                      │
                      ▼
                 re-discover → read SKILL.md → execute
```

1. **Discover** — live scan of sibling dirs; merge [catalog.json](references/catalog.json)
   so missing workers remain matchable. Exclude `codexqa-skill-router`.
2. **Match** — semantic compare against descriptions
   ([routing-rules.md](references/routing-rules.md)).
3. **Ensure** — if `installed: false`, fetch into the skills root (local repo
   copy, GitHub tarball, or `npx skills add` fallback).
4. **Hand off** — load the winner's `SKILL.md` and follow it to completion.

## Scripts vs model

| Layer | Owns |
|---|---|
| `discover_skills.py` | Live + bundled catalog JSON |
| `ensure_skill.py` | Deterministic install beside the router |
| `refresh_catalog.py` | Maintainer regen of `catalog.json` |
| Host agent | Intent match, install consent, executing the chosen skill |

## Evidence status

`python3 scripts/discover_skills.py --self-check` verifies the bundled catalog.
`ensure_skill.py --dry-run <name>` shows the install plan. End-to-end hand-off
quality is model-judged.
