# skill-router

[简体中文](README.zh-CN.md)

Auto-routes a vague or multi-skill-looking request to the right skill under the
codexqa pack, **installs that skill beside the router if needed**, then hands
off so the skill actually does the work.

It is **not** a substitute for
[`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.md),
[`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.md),
[`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.md),
[`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.md),
[`requirements-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/requirements-analyzer/README.md),
[`testcase-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testcase-generation/README.md), or
[`testdata-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testdata-generation/README.md).
Those remain the workers; this skill **discovers, matches, ensures install, and follows** them.

## Install

```bash
npx skills add openqa-cn/codexqa --skill skill-router
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
2. Match → if not installed, `python3 scripts/ensure_skill.py <name> --yes`
3. Read that skill's `SKILL.md` and continue

## Smoke check

```bash
python3 scripts/discover_skills.py --self-check
python3 scripts/discover_skills.py --with-catalog --names-only
python3 scripts/ensure_skill.py ai-code-reviewer --dry-run
```

Maintainer (full checkout): `python3 scripts/refresh_catalog.py`

## Docs

- [How it works](HOW_IT_WORKS.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- Agent map: [SKILL.md](SKILL.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
