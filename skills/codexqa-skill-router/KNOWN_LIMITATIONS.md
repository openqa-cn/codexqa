# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

## Solo install needs on-demand fetch

Installing **only** `codexqa-skill-router` is supported for **matching** via the
bundled [catalog.json](references/catalog.json). Executing the winner still
requires `ensure_skill.py` (or a manual `npx skills add`) so the target
`SKILL.md` and scripts land beside the router. Without network / local repo /
npx, ensure fails and hand-off must stop.

## Catalog can lag new skills

Brand-new pack skills are auto-discovered when installed as siblings. Solo-router
matching needs an updated `catalog.json` (`scripts/refresh_catalog.py` in a
full checkout) before release.

## Discovery / catalog quality

Vague skill descriptions cause mis-routes or forced clarification. Authors
should put triggers and "Not …" peers in frontmatter `description`.

## Near-misses are scripted; leftovers are asked

`suggest_route.py` chooses among the current pack when the task shape is
clear (code review vs defect scan, impact query vs wiki, requirements vs
cases vs test data, stack vs scan). `ambiguous`, `explicit_conflict`, and
`none` still stop for the user. A brand-new skill that shares those verbs
stays unmatched until it has a policy branch and a fixture.

## Does not satisfy target skill prerequisites

Selecting `codexqa-code-reviewer` does not install `codexqa` / `jq`. The target
skill's compatibility section still applies after hand-off.

## Does not implement the work itself

If hand-off is skipped and the agent invents a parallel workflow, that is a
router misuse — not covered by target-skill gates.

## Host skill-list refresh

After ensure, prefer reading the returned `skillMd` path directly. The agent
host may not re-index its skill picker until a new session.

## Fixture coverage, not a live-agent score

`suggest_route.py --self-check` locks the near-miss table (代码评审 →
`codexqa-code-reviewer`, scan language → `codexqa-defect-analyzer`, and the
other pack boundaries). It does not score a host model that ignores the JSON.

## Workflow boundary

This skill **routes, ensures install, and hands off**. It does not replace
scan, CR, graph Q&A, RCA, requirements analysis, case generation, or testdata
construction.
