# Language profile (primary language detection)

## Source of truth

Always from **CodexQA CLI** evidence — never guess from README, folder names, or IDE icons alone.

1. `02-summary.json` → `lang_stats` (file counts per language)
2. PR mode also uses `04-changed-files.json` → per-file `language`
3. Collector writes `09-language-profile.json` and stamps manifest:
   - `primary_language` — repo main language
   - `review_language_focus` — PR change language if available, else primary
   - `is_polyglot`, `secondary_languages`, `confidence`

## Algorithm (implemented in `scripts/lib/codexqa-preflight.sh`)

1. Canonicalize names (`go`→`Go`, `ts`→`TypeScript`, `json`→`JSON`, …)
2. Deprioritize noise langs (Markdown/JSON/YAML/HTML/CSS/…) when picking primary
3. Primary = language with max file count among **code** langs
4. `primary_share = primary_files / sum(code_lang_stats)` (noise excluded from denominator)
5. Confidence: `high` (≥70%), `medium` (≥50%), else `low`; empty stats → `UNKNOWN`
6. Polyglot if share &lt; 70% or a secondary **code** language share ≥ 15%
7. Optional `--primary-lang` overrides detection (still recorded in profile)

## How the agent must use it

1. Read `manifest.primary_language` / `09-language-profile.json` **before** findings.
2. Apply [dimension-registry.md](dimension-registry.md) order and [review-dimensions.md](review-dimensions.md) family table for `review_language_focus` (Design fit first).
3. If `is_polyglot: true`, also scan secondary languages for cross-boundary risks; label FFI/dynamic uncertainty.
4. Do not claim “this is a Java repo” if primary is Go — cite the profile artifact.

## Override

```bash
./scripts/collect-pr-evidence.sh --repo /path --diff-base main --primary-lang Java
```
