# Routing rules

Reading guide: sections 1–3 for every route; section 4 for ensure/install;
section 5 when the user names a skill or asks for a chain.

## 1. Catalog is the source of truth

Always run:

```bash
python3 <skill-router>/scripts/discover_skills.py --with-catalog
```

Treat each `description` as the skill's claim of work and its exclusion list.
Prefer `source: "live"` entries when both live and bundled exist for the same
name. Bundled-only rows (`installed: false`) are for **matching**; you must
run `ensure_skill.py` before reading `SKILL.md`.

## 2. Scoring heuristic (agent judgment)

For each catalog skill, score roughly:

1. **Positive triggers** — phrases in the description match the request.
2. **Task shape** — input type (PRD vs repo vs stack vs cases vs OpenAPI) and
   desired artifact (gap register, cases, `report_scan.*`, `REVIEW-REPORT.html`,
   RCA report, testdata write-back, symbol-graph Q&A).
3. **Negative boundaries** — if the description says "Not X (that is Y)", and
   the user wants X, prefer Y.

Pick the highest score. If top two are close, ask.

### Near-miss cheat sheet (current pack; still verify via discovery)

| User says something like… | Prefer | Not |
|---|---|---|
| Scan diff/repo/paste for SAST + Agent LLM Detection → `report_scan.*` | `defect-detection` | `ai-code-reviewer`, `code-analyzer` |
| CodexQA evidence pack + Agent LLM judgment → bilingual REVIEW-REPORT.html | `ai-code-reviewer` | `defect-detection` |
| Index repo, callers, regression scope, test gaps, `--diff-base` | `code-analyzer` | full HTML CR / SAST report |
| Stack / log / crash → root cause | `root-cause-diagnosis` | structure-only or scan report |
| PRD quality / gap / conflict register | `requirements-analyzer` | writing cases |
| Test plan / cases / Plan·Exec / 提测后增量 | `testcase-generation` | live backend data |
| Construct backend IDs / write back preconditions | `testdata-generation` | authoring cases from PRD |

This table is a hint only. Bundled + live descriptions win over this table.

## 3. Ambiguity prompts

Ask with at most three options:

```text
This could be:
1) <skill-a> — <one-line why>
2) <skill-b> — <one-line why>
Which should I run? (or say both in order)
```

Do not start either skill until the user answers, unless they already said
"do both: first A then B".

## 4. Ensure / on-demand install

When the winner has `installed: false`:

1. Ask once to install beside `skill-router` (unless the user already authorized
   full auto-route / "按需安装").
2. `python3 …/ensure_skill.py <name> --yes`
3. Re-discover with `--with-catalog`; confirm `skillMd` exists.
4. Only then open that `SKILL.md`.

Offline: `--from-repo /path/to/codexqa`. Failures: surface JSON; do not fake
the worker.

## 5. Explicit name and chains

- If the user names a catalog skill, route there even if another skill also
  fits, unless the named skill's description clearly rejects the task — then
  warn and offer the better fit.
- For chains, keep a short plan (skill order + stop between steps). Ensure and
  complete one skill's handoff before opening the next `SKILL.md`.

## 6. Extensibility

- **New skill in a full checkout:** add `skills/<name>/SKILL.md`, run
  `scripts/refresh_catalog.py`, commit the updated `references/catalog.json`.
- **Already installed sibling:** live discovery picks it up with no catalog
  edit (still refresh catalog before release so solo-router installs can match).
