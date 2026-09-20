---
name: skill-router
description: >
  Auto-routes a user request to the matching codexqa skill, then ensures that
  skill is on disk and follows its SKILL.md. Use whenever the user is unsure
  which skill to run, says 帮我选 skill、自动路由、选哪个 skill、不知道用哪个、
  route this request、pick the right skill、codexqa 该用哪个, installs only
  skill-router and still needs a worker skill, or describes a verification /
  QA / testing / review / RCA / requirements / cases / testdata task without
  naming a skill. Matches against live siblings plus a bundled catalog so newly
  published pack skills remain routable; if the winner is not installed, fetch
  it beside this router (ask once, then ensure_skill.py --yes) and hand off —
  do not invent a parallel workflow. Not a replacement for any target skill.
license: Apache-2.0
compatibility: >
  Requires Python 3.10+ on PATH for discover/ensure scripts (auto re-execs from
  older system python3). On-demand install needs network (GitHub tarball) or a
  local --from-repo checkout; optional npx skills add fallback. Target skills
  may need their own runtimes (Node, Python 3.10+, codexqa CLI, etc.).
metadata:
  version: "1.1.0"
---

# skill-router

Agent entry map for **discover → match → ensure installed → hand off**. Human
docs (`README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md` and `.zh-CN` twins)
are not loaded at runtime.

This skill does not implement defect scans, case writing, RCA, or data build.
It selects a pack skill, makes sure its files exist next to this router, then
**executes that skill's contract**.

## 1. Discover (mandatory, every turn)

Refresh the match catalog:

```bash
python3 <this_skill_dir>/scripts/discover_skills.py --with-catalog
```

- Live siblings with `SKILL.md` appear as `source: "live"`, `installed: true`.
- Missing workers still appear from [references/catalog.json](references/catalog.json)
  as `source: "bundled"`, `installed: false` (for matching only).
- `needsInstall` lists names that must be fetched before hand-off.
- Optional: `--skills-root <abs-path>` when the pack is not this skill's parent.
- Self-check: `python3 …/discover_skills.py --self-check`.

Do **not** hard-code the worker list in your reasoning — use the JSON. New
skills become matchable after `catalog.json` is refreshed (maintainers:
`scripts/refresh_catalog.py` in a full checkout). `skill-router` is excluded.

If discovery fails entirely (script error), stop and report it. An empty
*live* count is OK when the bundled catalog is non-empty.

Detailed match rules: [references/routing-rules.md](references/routing-rules.md).

## 2. Match the user request

Read the user's latest message (and only this-turn attachments they named).
Compare intent against each entry's `description` (live or bundled). Prefer
the skill whose description **claims** that job and whose "Not …" boundaries
exclude the others.

| Outcome | Action |
|---|---|
| Clear single winner | Ensure + hand off (sections 3–4) |
| Two+ plausible winners | Ask once with ranked options + one-line why; wait |
| No skill fits | Say so; list catalog names; do not invent a skill |
| User already named a catalog skill | Use that name (still ensure + load `skillMd`) |
| Multi-step ask | Propose ordered chain; ensure/start the first after confirm |

Never pick a skill only because a keyword appears if the description says that
keyword belongs to another skill (classic traps: "review this PR", "影响面",
"写用例", "造数据", "堆栈").

## 3. Ensure the winner is installed

If the chosen entry has `installed: false` (or no `skillMd` on disk):

1. Tell the user in one sentence that you will install `<name>` beside
   `skill-router` so you can follow its contract (network fetch from the
   codexqa pack, unless a local checkout is available).
2. If the user refuses, stop and give the manual hint:
   `npx skills add openqa-cn/codexqa --skill <name>`.
3. If they agree (or already said to proceed / auto-route fully), run:

```bash
python3 <this_skill_dir>/scripts/ensure_skill.py <name> --yes
```

Dev / offline: add `--from-repo /path/to/codexqa` to copy from a local clone
instead of the network. Dry-run: omit `--yes` or pass `--dry-run`.

4. Re-run `discover_skills.py --with-catalog` and confirm the skill is
   `installed: true` with a real `skillMd` path. If ensure failed, show the
   JSON error and stop — do not invent the worker workflow.

Why ask once: installing copies third-party skill files onto disk. Why still
automate: a router that only prints a name does not complete the user's task.

## 4. Hand off and execute

1. Announce the choice in one short sentence: skill name + why (+ "installed
   just now" if ensure ran).
2. **Read** the chosen `skillMd` (and only the references that skill says to
   load next). Prefer the path returned by discover/ensure — do not rely on
   the host having re-indexed its skill list yet.
3. **Follow that skill completely** for the user's request — same gates,
   scripts, and artifacts.
4. Do not re-implement the target skill inside this router. Do not skip its
   "ask before Exec" or similar stop conditions.
5. If mid-flight the work clearly belongs elsewhere, stop, re-discover, and
   re-route (ensure the new winner if needed).

## 5. Done criteria

Routing is done when either:

- the chosen skill's own done criteria are met, or
- you asked a clarification / install-consent question and are waiting, or
- you reported that no catalog skill fits or ensure failed.

## 6. Boundaries

- Does not replace worker skills; it only selects, installs if needed, and
  follows them.
- Does not install missing CLIs (`codexqa`, `jq`, …); the target skill's
  compatibility section still applies after hand-off.
- Does not edit sibling skills as part of routing (install/copy only).
- Bundled `catalog.json` may lag a brand-new unpublished skill until refreshed;
  live siblings still win when present.
