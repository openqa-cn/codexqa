# codexqa-skill-router

[简体中文](README.zh-CN.md)

Auto-routes a vague or multi-skill-looking request to the right skill under the
codexqa pack, **installs that skill beside the router if needed**, then hands
off so the skill actually does the work.

It is **not** a substitute for
[`codexqa-defect-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-defect-analyzer/README.md),
[`codexqa-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-reviewer/README.md),
[`codexqa-code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-analyzer/README.md),
[`codexqa-change-analysis`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-change-analysis/README.md),
[`codexqa-code-wiki`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-wiki/README.md),
[`codexqa-rootcause-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-rootcause-analyzer/README.md),
[`codexqa-requirement-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-requirement-analyzer/README.md),
[`codexqa-testcase-generator`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-testcase-generator/README.md),
[`codexqa-testdata-generator`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-testdata-generator/README.md), or
[`codexqa-jev-browser`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-jev-browser/README.md).
Those remain the workers; this skill **discovers, matches, ensures install, and follows** them.

## Install

```bash
npx skills add openqa-cn/codexqa --skill codexqa-skill-router
```

Python 3.10+ for scripts. **You can install only the router:** matching uses
the bundled [references/catalog.json](references/catalog.json); the first
hand-off runs `ensure_skill.py` (asks once) to fetch the chosen worker beside
this skill. Pre-installing workers is still fine and skips the fetch.

## How to use

```text
帮我看看该用哪个 skill：对照 origin/main 审一下这个仓库，我要一份能打开的审查报告。
```

The agent should:

1. `python3 scripts/discover_skills.py --with-catalog`
2. `python3 scripts/suggest_route.py --text "<request>"` → follow `outcome`
3. If not installed, `python3 scripts/ensure_skill.py <name> --yes`
4. Read that skill's `SKILL.md` and continue

## Smoke check

```bash
python3 scripts/discover_skills.py --self-check
python3 scripts/suggest_route.py --self-check
python3 scripts/discover_skills.py --with-catalog --names-only
python3 scripts/ensure_skill.py codexqa-code-reviewer --dry-run
```

Maintainer (full checkout): `python3 scripts/refresh_catalog.py`

## Docs

- [How it works](HOW_IT_WORKS.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- Agent map: [SKILL.md](SKILL.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
