# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

## Solo install needs on-demand fetch

Installing **only** `skill-router` is supported for **matching** via the
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

## Routing is model-judged

Scripts list and install candidates. Choosing among near-misses is done by the
host model using descriptions and [routing-rules.md](references/routing-rules.md).

## Does not satisfy target skill prerequisites

Selecting `ai-code-reviewer` does not install `codexqa` / `jq`. The target
skill's compatibility section still applies after hand-off.

## Does not implement the work itself

If hand-off is skipped and the agent invents a parallel workflow, that is a
router misuse — not covered by target-skill gates.

## Host skill-list refresh

After ensure, prefer reading the returned `skillMd` path directly. The agent
host may not re-index its skill picker until a new session.

## No published host-agent score

Self-check covers catalog presence. There is no public benchmark for routing
accuracy across ambiguous prompts.

## Workflow boundary

This skill **routes, ensures install, and hands off**. It does not replace
scan, CR, graph Q&A, RCA, requirements analysis, case generation, or testdata
construction.
