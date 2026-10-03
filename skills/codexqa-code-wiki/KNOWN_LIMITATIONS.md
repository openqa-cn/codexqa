# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

This file covers the limits of the `codexqa-code-wiki` skill and its required local analysis engine.

## Distribution boundary

The skill files, scripts, and tests are published in this repository. The `codexqa` command comes from the separately distributed, closed-source `@openqa-cn/codexqa` npm package. The engine source is not included in this repository.

Indexing, `wiki inputs`, and `wiki --no-llm` run locally and do not require an LLM. Installation downloads the npm package. Local indexes live under `~/.codexqa/`; uninstalling the CLI does not automatically remove that data.

## Compatibility and verification

- CI runs the skill's own tests (`npm test`): data model, notes validation, escaping, layout, rendering, and the `brief` / `build` / `check` commands against a stand-in `codexqa` that replays a real export of this repository.
- CI does not install or execute the closed-source CLI. The scripts were checked by hand against `codexqa` 0.1.11 on four repositories.
- No public host-agent run or independent quality benchmark has been published for `codexqa-code-wiki`.
- A formal skill-to-CLI version matrix has not been published. `meta.json` records `codexqa --version`; include it when reporting a problem.

## Graph and module completeness

Modules are Leiden communities on the symbol call graph, plus directory priors and a page cap. They are not folders: one module can mix unrelated scripts that call the same helpers, and one package can be split across modules. Stub nodes and symbol collisions lower confidence; `brief` reports a high stub share.

- The export keeps a limited number of communities (12 on every repository tested, set by the engine's page cap; `--limit N` keeps fewer). The page shows how much of the indexed code those modules cover and flags truncated exports.
- Module titles in the export are rule-made (`directory · busiest symbol`). Human names come only from `notes.json`.
- The export's own overview groups modules differently from its call counts; the page ignores those groups and builds its own from the counts.
- Symbols carry no file location in the export, so public API rows do not link to a line, and same-named definitions (one `main` per script) are folded into one row with a count.
- Some export rows list a related module without a count. Those show as dashed lines in the listed direction (the module that lists the other uses it), without a count.

## What the signals mean

- Call counts are static references between modules in the symbol graph, not runtime traffic.
- The arrow points the heavier way; a double arrow means calls go both ways. A module with no arrows has no counted calls to other modules, which does not mean it is unused.
- The hub is the most connected module inside a group of three or more.
- Dense groups show only their strongest calls; the legend says how many are hidden, and every module card lists all of them.
- Reading paths go through modules that call each other. They are a sensible order, not proof that a newcomer needs nothing else.

## Known engine issues

- Indexing a subfolder of a git repository (for example `examples/inventory-service`) creates an index that `wiki inputs` cannot find. Index the git root. `brief` prints this hint when it detects the case.
- `codexqa repos` defaults to 20 rows and truncates silently; use `--filter` and `--limit 200`.

## Workflow boundary

`codexqa-code-wiki` maps modules, real calls, and onboarding paths. It does not call `codexqa wiki` without `--no-llm`, does not run `wiki embed` or `query wiki`, does not review a change, and does not assign P0 / P1 / P2 findings. Use `codexqa-code-analyzer` for impact and test gaps, `codexqa-defect-analyzer` for SAST+agent code-risk scan reports, and `codexqa-code-reviewer` for CodexQA evidence-pack HTML review.
