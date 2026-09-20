# CodexQA CLI contract (no source embedding)

Prerequisite: `codexqa` on PATH (`npm i -g @openqa-cn/codexqa`). Index/query need no LLM. Data under `~/.codexqa/`.

**Polyglot mandate:** Every language / monorepo under review MUST use this CLI as the
**primary** repository analysis backend for the `ai-code-reviewer` skill. Collectors
source `scripts/lib/codexqa-preflight.sh`. Manifest stamps `engine: "codexqa"`,
`skill: "ai-code-reviewer"`, and `polyglot_mandate: true`. Alternate tools (git diff,
grep, language SAST) are never the primary backend.

**Primary language:** Collectors call `codexqa_detect_language_profile` (in
`codexqa-preflight.sh`) after `02-summary.json` is written. Manifest fields:
`primary_language`, `review_language_focus`, `is_polyglot`, `language_profile`.
Optional CLI: `--primary-lang <Lang>`. Details: [language-profile.md](language-profile.md).

There is **no** `codexqa review` or `codexqa diff`. Change review always:

```text
index --diff-base <ref> → change-groups → symbol-diff → edges/reach/path/tests
```

## Allowed commands for this skill

| Purpose | Command |
|---|---|
| Index (PR) | `codexqa index <repo> --diff-base <ref>` |
| Index (full) | `codexqa index <repo>` |
| Quality | `codexqa stats <repo> --format json` |
| List repos | `codexqa repos` |
| Summary | `codexqa query --repo <repo> summary` |
| Change groups | `codexqa query --repo <repo> change-groups` |
| Changed files | `codexqa query --repo <repo> files --change add,change` |
| Changed symbols | `codexqa query --repo <repo> symbols --change add,change --kind function,method` |
| Symbol patch | `codexqa query --repo <repo> symbol-diff --id <id> [--max-lines 200]` |
| Callers | `codexqa query --repo <repo> edges --id <id> --direction in` |
| Blast radius | `codexqa query --repo <repo> reach --id <id> --direction in --depth 3` |
| Test edges | `codexqa query --repo <repo> reach --id <id> --edge-kinds tests` |
| Path | `codexqa query --repo <repo> path --from <a> --to <b>` |
| Imports | `codexqa query --repo <repo> imports --file <path> --direction in\|out` |
| Search | `codexqa search-index <repo>` then `query search --query "..."` |
| Tags | `codexqa tag <repo> keys --json` / `query tagged --key <key>` |
| Source | `query source --id`, `file-source`, `file-base`, `snippet` |
| Inspect | `codexqa inspect <id> --repo <repo>` |

Optional (user must ask): `wiki`, `chat`, `serve`, `gui`.

Forbidden in this skill tree: copying CodexQA package source, zip contents, or reimplementing the indexer.

## Evidence pack layout

Default root: `<repo>/.codexqa-review/<run-id>/`

### PR mode (`collect-pr-evidence.sh`)

| File | Source |
|---|---|
| `manifest.json` | Collector metadata: `commands[]`, `index_quality` (stubs/collisions), selected symbols. **Runtime filename is always `manifest.json`.** `templates/evidence-manifest.json` is schema-only documentation (never written by collectors). |
| `01-stats.json` | `stats --format json` |
| `02-summary.json` | `query summary` (incl. `lang_stats`) |
| `03-change-groups.json` | `query change-groups` |
| `04-changed-files.json` | `files --change add,change` |
| `05-changed-symbols.json` | `symbols --change add,change --kind function,method` |
| `06-sensitive-hits.json` | Combined pack: BM25 `search` + `symbols --name` (password/secret/token/auth/pay) + caller `edges-in` samples |
| `06-sensitive-search.json` / `06-sensitive-symbols/` | Raw search + per-name symbol/caller queries |
| `07-tags.json` | `tag keys` + `tagged --key` samples (`07-tag-keys.json` alias) |
| `05-untested-hotspots.json` | `tested_count==0` candidates; **ranked by `edges_in_count`** when `impact/` present; `from_count` is tie-break only (NOT fan-in) |
| `08-hot-but-thin.json` | Changed symbols with `tested_count==0`, re-ranked by `edges_in_count` after impact |
| `09-language-profile.json` | Derived from `summary.lang_stats` (+ PR changed-file languages); stamps primary / focus |
| `10-design-fit-signals.json` | **Derived locally** by `scripts/lib/derive-design-fit.sh` from 03/04/05 + `impact/*/edges-in` (0 extra CodexQA) |
| `11-complexity-signals.json` | **Derived locally** by `scripts/lib/derive-complexity.sh` (method spans / decisions / nesting / YAGNI; 0 extra CodexQA) |
| `12-dependency-signals.json` | **Derived locally** by `scripts/lib/derive-dependencies.sh` (manifest/lock heuristics; 0 extra CodexQA; no network CVE) |
| `13-privacy-signals.json` | **Derived locally** by `scripts/lib/derive-privacy.sh` (PII/log/retention heuristics; 0 extra CodexQA; no legal conclusions) |
| `14-resilience-signals.json` | **Derived locally** by `scripts/lib/derive-resilience.sh` (timeout/retry/swallow/partial/idempot heuristics; 0 extra CodexQA; no chaos probes) |
| `15-rollout-signals.json` | **Derived locally** by `scripts/lib/derive-rollout.sh` (migration/dual-write/flag/compat/announce/rollback heuristics; 0 extra CodexQA; no ops probes) |
| `16-observability-signals.json` | **Derived locally** by `scripts/lib/derive-observability.sh` (catch without log/metric) |
| `17-contract-signals.json` | **Derived locally** by `scripts/lib/derive-contract.sh` (breaking hints + XSS/HTML sinks) |
| `18-maintainability-signals.json` | **Derived locally** by `scripts/lib/derive-maintainability.sh` (TODO/magic/long-file) |
| `19-annotation-edges.json` | **Derived locally** — Spring/Resilience4j synthetic callers when graph `edges-in` empty |
| `20-risk-tier.json` | **Derived locally** by `scripts/lib/derive-risk-tier.sh` (T0–T3 blast-radius triage from paths + tags + sensitive + rollout surfaces; 0 extra CodexQA) |
| `21-performance-signals.json` | **Derived locally** by `scripts/lib/derive-performance.sh` (hot-path / N+1 / unbounded-alloc heuristics; 0 extra CodexQA; no profiler) |
| `review-conclusion.json` | Agent-written structured findings (see `templates/review-conclusion.json`) |
| `REVIEW-REPORT.html` | Rendered by `scripts/render-review-html.sh` from conclusion JSON |
| `diffs/<id>.diff.json` | `symbol-diff --id` for top symbols |
| `impact/<id>/edges-in.json` | `edges --direction in` |
| `impact/<id>/reach-in.json` | `reach --direction in` |
| `impact/<id>/tests-reach.json` | `reach --edge-kinds tests` |
| `impact/<id>/paths/` | `path --from <entry> --to <changed>` for `from_count==0` candidates |
| `entries/tagged/` | Per-key tagged query JSON |
| `commands.log` | Exact commands run |

### Full-repo mode (`collect-fullrepo-evidence.sh`)

| File | Source |
|---|---|
| `manifest.json` | `mode: full`, `commands[]`, `index_quality`, `import_files` |
| `01-stats.json` | `stats --format json` |
| `02-summary.json` | `query summary` |
| `03-files-sample.json` | `files --limit ...` |
| `04-hot-symbols.json` | symbols sample (`from_count` is NOT fan-in — prefer edges-in) |
| `05-untested-hotspots.json` | `tested_count==0` ranked by `edges_in_count` when impact present |
| `06-sensitive-hits.json` | search best-effort |
| `07-tags.json` | tag keys + tagged samples |
| `09-language-profile.json` | Primary language from `lang_stats` (same detector as PR) |
| `10-design-fit-signals.json` | Derived locally (paths/hot symbols + imports when present) |
| `11-complexity-signals.json` | Derived locally (complexity / YAGNI heuristics) |
| `12-dependency-signals.json` | Derived locally (dependency / supply-chain heuristics) |
| `13-privacy-signals.json` | Derived locally (privacy / compliance heuristics) |
| `14-resilience-signals.json` | Derived locally (error handling / resilience heuristics) |
| `15-rollout-signals.json` | Derived locally (change / rollout heuristics) |
| `16-observability-signals.json` | Derived locally (observability heuristics) |
| `17-contract-signals.json` | Derived locally (contract / XSS heuristics) |
| `18-maintainability-signals.json` | Derived locally (maintainability heuristics) |
| `20-risk-tier.json` | Derived locally (blast-radius T0–T3 triage) |
| `21-performance-signals.json` | Derived locally (performance / N+1 / alloc heuristics) |
| `imports/` | Auto-sampled file imports (in/out) + optional `--import-file` |
| `entries/tagged/` | Tagged entry samples |
| `commands.log` | commands |

## `<repo>` forms

- Local path: `/path/to/repo` or `.`
- Canonical id: `github.com/org/repo@main` (from `codexqa repos`)
- Remote URL: only for indexing

Pin `@branch` when multiple branches exist.

## Confidence rules

- High stubs/collisions in `stats` / `manifest.index_quality` → lower confidence on edges/reach.
  CodexQA may emit `stubs`/`collisions` as **numbers or objects** (`{total:N}`); collectors
  normalize to numeric `index_quality.stubs` / `.collisions` (detail retained as `*_detail`).
  `validate-evidence.sh` WARNs when stubs≥20 to **cap** related findings at `UNKNOWN`.
- `change-groups.truncated: true` → state incomplete graph in report.
- Empty `file-base` / all `change_status=default` → not a diff index; re-run with `--diff-base`.
- Missing search-index → skip or note; do not invent search hits.
- Empty tag keys → skip entry tagging; do not invent entries.
- Primary language comes from `09-language-profile.json`; legacy packs without it validate with WARN only.
