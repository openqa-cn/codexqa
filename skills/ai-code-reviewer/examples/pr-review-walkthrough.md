# PR review walkthrough

End-to-end path for the default mode.

**Prerequisites:** `codexqa` and `jq` on PATH; `bash` 3.2+.

**All languages** (Java, Go, TS, Python, …) use this same CodexQA CLI path — do not
bypass with git-diff-only or language-native analyzers as the primary backend.

Resolve the skill root portably (no machine-specific absolute paths):

```bash
# From a git checkout of this monorepo:
SKILL_ROOT="$(git rev-parse --show-toplevel)/skills/ai-code-reviewer"
# Or, if the shell cwd is already the skill directory:
# SKILL_ROOT="$PWD"
```

**Skill self-check (no skill-up required):**

```bash
"$SKILL_ROOT/scripts/validate-skill.sh"
```

This runs static/structural checks plus fixture validate→HTML smoke (`evals/fixtures/`).
Runtime packs write **`manifest.json`** only — do not look for `evidence-manifest.json`
inside `OUT_DIR` (that path is a template schema under `templates/`).

## 1. Collect

```bash
REPO="/path/to/your/git/repo"

"$SKILL_ROOT/scripts/collect-pr-evidence.sh" \
  --repo "$REPO" \
  --diff-base origin/main
```

Note the printed `Evidence pack written: ...` path (`OUT_DIR`). Collect auto-runs `validate-evidence.sh` unless `--skip-validate`.

Expected artifacts include: `03-change-groups.json`, `diffs/*.diff.json`,
`impact/*/edges-in|reach-in|tests-reach.json`, `impact/*/paths/`, `07-tags.json`,
`08-hot-but-thin.json`, `09-language-profile.json`, `10-design-fit-signals.json`,
`11-complexity-signals.json`, `12-dependency-signals.json`, `13-privacy-signals.json`,
`14-resilience-signals.json`, `15-rollout-signals.json`, `20-risk-tier.json`,
`21-performance-signals.json`
(all derived locally — no extra CodexQA; Dependencies never networks for CVEs;
Privacy never invents legal conclusions; Resilience never invents SLO/chaos conclusions;
Change/rollout never invents canary/ops conclusions; Risk tier is path/tag/sensitive/rollout triage;
Performance never invents profiler/SLO/p99),
`manifest.json` with `commands` + `index_quality` + `primary_language` /
`review_language_focus`.

## 2. Validate (if skipped during collect)

```bash
"$SKILL_ROOT/scripts/validate-evidence.sh" --dir "$OUT_DIR" --mode pr
```

Confirm stdout shows `primary_language=...`. Legacy packs missing `09-language-profile.json`
only WARN (compat). Missing `10-` / `11-` / `12-` / `13-` / `14-` / `15-` / `20-` / `21-` signals also WARN (compat).

If invalid (empty change-groups / all `default`):

```bash
codexqa index "$REPO" --diff-base origin/main --full
# re-run collect (or collect with --skip-index after a successful diff index)
```

## 3. Review (agent)

1. Open `OUT_DIR/manifest.json` and `09-language-profile.json` — lock primary / focus language
2. Follow `prompts/pr-diff-review.md`
2b. Read `20-risk-tier.json` and apply `references/dimensions/risk-tier.md` **before** design-fit (T0–T3 evidence floor; auth/pay/migration/IaC → T0)
3. Read `10-design-fit-signals.json` and apply `references/dimensions/design-fit.md` **first** as four subsections (Belong / Layer / Over-engineering / Timing)
4. Read `11-complexity-signals.json` and apply `references/dimensions/complexity.md` next (cognitive load / YAGNI — do not re-litigate Belong/Layer)
5. Read `12-dependency-signals.json` and apply `references/dimensions/dependencies.md` (supply chain — never invent CVEs; do not re-litigate Security injection)
6. Continue correctness, then read `14-resilience-signals.json` and apply `references/dimensions/resilience.md` (timeout / retry / swallow / degrade / partial / idempotency — never invent SLO/chaos)
7. Continue security, then read `13-privacy-signals.json` and apply `references/dimensions/privacy.md` (PII / logging / retention / consent — never invent GDPR conclusions)
8. Continue contract, then read `15-rollout-signals.json` and apply `references/dimensions/rollout.md` (migration / dual-write / flags / compat / announce / rollback — never invent canary/ops)
9. Continue observability / maintainability, then read `21-performance-signals.json` and apply `references/dimensions/performance.md` (hot path / N+1 / unbounded allocation — never invent profiler/SLO/p99)
10. Continue `references/dimension-registry.md` / `references/review-dimensions.md` + `references/dimensions/correctness-family-checks.md` for `review_language_focus`
10. Read group → `diffs/*.diff.json` → `impact/` (+ `paths/`) → `07-tags` / `08-hot-but-thin` / sensitive; for hot-but-thin `equals`/`hashCode`/`compare*` **open the diff body**
11. Fill `templates/review-report.md` (Design fit + Complexity + Dependencies + Resilience + Privacy + Change/rollout + primary language in header)
12. Write `<OUT_DIR>/review-conclusion.json` from `templates/review-conclusion.json` (optional `design_fit.sections`, optional `complexity`, optional `dependencies`, optional `resilience`, optional `privacy`, optional `rollout`, + `dimensions_covered`)
13. Render HTML:

```bash
"$SKILL_ROOT/scripts/render-review-html.sh" --dir "$OUT_DIR"
# → $OUT_DIR/REVIEW-REPORT.html
```

14. Add Mermaid from `references/mermaid-evidence.md` using only pack nodes/edges (also mirror key diagrams into `review-conclusion.json` → `diagrams[]`)

## 4. Full-repo (optional)

```bash
"$SKILL_ROOT/scripts/collect-fullrepo-evidence.sh" --repo "$REPO"
"$SKILL_ROOT/scripts/validate-evidence.sh" --dir "$OUT_DIR" --mode full
```

Then use `prompts/full-repo-review.md`. Imports are auto-sampled under `imports/`.
Same language-profile stamp applies.

## 5. What not to do

- Do not copy CodexQA zip/npm package source into this skill
- Do not claim test coverage from directory names alone
- Do not skip validation when change_status is all `default`
- Do not invent entry paths when `07-tags` / `paths/` are empty
- Do not guess primary language from README; use `09-language-profile.json` (or `--primary-lang`)
- Do not hard-code machine-specific absolute paths in docs or scripts committed to the skill
