# Dimension card: Change / rollout

Source: modern server/platform review practice (migration, dual-write,
compat windows, feature flags, breaking-change notice, rollback). Heuristics
only — not an ops/canary verdict. Contract’s **release-side** complement.

| Field | Value |
|---|---|
| id | `rollout` |
| title | Change / rollout |
| order | 9 |
| modes | pr, full |
| finding_category | `rollout` |
| algorithm | derive (`15-rollout-signals.json`) + reuse `04-changed-files` + on-disk bounded read |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Schema / migration** — DDL / Flyway / Liquibase / Prisma / Alembic / migrate paths in the change set?
2. **Dual-write / expand-contract** — Storage or schema switch without dual-write / dual-read / backfill clues?
3. **Feature flags / kill switch** — Risky rollout without flag/toggle/kill-switch / config-gate clues?
4. **Compat window** — Deprecate / breaking / remove API without sunset / version-coexist / compat clues?
5. **Breaking announcement** — Destructive / breaking surface without CHANGELOG / migration guide / NOTICE clues?
6. **Rollback path** — Irreversible migration or hard cutover without rollback / canary / blue-green / revert clues?

## Split vs Contract / Resilience / Design-fit / Dependencies / Security

| Sibling | Owns | This card owns |
|---|---|---|
| Contract | Signature / behavior drift vs known callers (`edges`/`reach` in) | Migration, dual-write, flags, compat window, announce, rollback |
| Resilience | Runtime timeout / retry / compensate / swallow | Publish-time dual-write / backfill / flag cadence (not chaos) |
| Design-fit Timing | “Is now a good time…” (no invented product strategy) | Release *mechanics* clues only |
| Dependencies | SNAPSHOT / lock / license | Do not re-litigate supply chain |
| Security | Auth / secrets / injection | Do not treat flag names as tokens |

Do **not** re-open Contract caller-drift, Resilience runtime policy, or Dependencies findings as rollout.

## Soft thresholds (auditable heuristics)

| Signal | Attention | Elevated |
|---|---|---|
| Schema/migration path (`ALTER` / Flyway / Liquibase / prisma migrate / alembic / `db/migrate`) | P2 (document) | Irreversible drop/truncate without rollback/flag → may raise P1 |
| Schema/storage switch without dual-write / dual-read / backfill / expand-contract clue in change set | P2 | Money / master-data store → may raise P1 |
| Risky cutover (migration or breaking remove) without feature-flag / toggle / kill-switch / config gate | P2 | Entry-reachable hard cutover → may raise P1 |
| `deprecated` / `breaking` / remove public API without sunset / compat / vN coexist clue | P2 | — |
| Breaking/destructive surface without CHANGELOG / MIGRATION / NOTICE / migration-guide clue | P2 | — |
| Destructive migration without rollback / canary / blue-green / revert / undo clue | P2 | Primary store irreversible → may raise P1 |
| Feature-flag / Unleash / LaunchDarkly / kill-switch present | Positive note (not a finding) | Absence alone is residual when migration surface exists |
| Hit is clearly auth/token/secret/injection | — | **Skip** — Security owns |

Confidence default `medium`. No live canary / ops probes. Never invent “production-proven gradual rollout”.

## Evidence map

| Signal | Source |
|---|---|
| Changed source files | `04-changed-files.json` (full: sample / bounded enum) |
| File bodies | `manifest.repo` or `--repo` bounded read |
| Optional context | `05-changed-symbols` / diffs for high-risk symbols (reviewer reuse; derive does not call CodexQA) |

## Severity

| Default | Escalate | Almost never P0 |
|---|---|---|
| P2 | Irreversible primary-store migration or entry hard-cutover without rollback/flag | P0 left to confirmed data corruption / main-path breakage with graph + domain evidence |

## Output

- Always evaluate Change / rollout into `review-conclusion.json` (findings **or** `ok`/`none`
  + short signal summary from `15-rollout-signals.json`).
- **Report/HTML:** include only when `verdict` is `concern`/`unknown` (omit clean).
  Concern cards **must** include `risk`（具体代码风险说明）.
- Optional `rollout` object on `review-conclusion.json` (see template).
- Include `rollout` in `dimensions_covered`.

## Non-goals

- No live canary / blue-green / SLO measurement; no inventing traffic-split percentages.
- No full-tree AST; no `node_modules` walk; no extra CodexQA; do **not** raise `TOP_N` / `REACH_DEPTH`.
- **Comments / Javadoc do not count** as dual-write, feature-flag, rollback, compat, or
  CHANGELOG/NOTICE remediation — listing remedy keywords in docs must not waive gaps.
- Missing `15-…` → thin review or None; validate WARN only.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
- No rollout heuristics hit → explicit None (not a failure).
