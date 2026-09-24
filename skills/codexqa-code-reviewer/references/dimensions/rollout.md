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
3. **Feature flags / kill switch** — Risky rollout without flag/toggle/kill-switch / config-gate clues? A bound or switch that is a compile-time literal, and is not read from configuration at the decision, is family F3 in [rule-construction.md](../rule-construction.md). Do not special-case the constant’s name.
4. **Compat window** — Deprecate / breaking / remove API without sunset / version-coexist / compat clues?
5. **Breaking announcement** — Destructive / breaking surface without CHANGELOG / migration guide / NOTICE clues?
6. **Rollback path** — Irreversible migration or hard cutover without rollback / canary / blue-green / revert clues? File-level gaps carry `anchors` on the related symbol (deprecated field, flag, delete). A package-line slice does not close the family. `dual_write` and `feature_flags` may be none only when every `visible_absence` row is cited or named in `line_skips`.
7. **Legacy money accessor** — A `@Deprecated` balance or amount getter is still on the debit/credit path. Say whether that legacy value can include holds or frozen funds (`BIZ-005`). Do not file a second card that only repeats “the method is marked deprecated”.
8. **Environment boundary** — A `jdbc:` / `http(s):` / database / broker URL literal points at `prod`, `production`, or `.internal`, and the same file never reads `getenv` / `getProperty` / `process.env` / `@Value` / `os.Getenv` / `env::var` / a config service. File one rollout finding for the missing environment boundary. Do not repeat a hardcoded secret (`HYG-001`) or a certificate-verification finding.

## Semantic candidates (model decides)

`15-rollout-signals.json` → `opaque_status_candidates` (`decision: "llm"`). This array is **not** a hard gate and does **not** change `signals_thin`. `env_config_gaps` stays a hard gate and is unchanged. An empty candidate array means the shape is absent. A non-empty array is judged only in [prompts/semantic-candidate-pass.md](../../prompts/semantic-candidate-pass.md): each row is a finding or a one-line skip. Do not add a new `rule_id`. Use `category: rollout`. Do not re-file a `@Deprecated` compat gap as this shape. Unused configuration constraints stay on `env_config_gaps`, not in the business-logic pass.

| Look for | File | Skip |
|---|---|---|
| A status, state, or flag is compared to a one-character literal (`"R".equals(status)`, `status == "R"`, `status == 'R'`) and nothing next to it says what the letter means. Cross-language: Java `equals`, Go/C# `==`, JS `===`, Python `==`, SQL-style column compares. | The literal is a business protocol (account or payment state) and the pack has no enum, named constant, or migration note for it. | `Y` / `N` / `0` / `1` / `T` / `F` used as a boolean. `hint` says a nearby name or comment already defines it. The compare uses a named constant instead of a literal. |

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
- **Hard gate:** non-empty `env_config_gaps` must become a rollout finding with `path:line`. One card for the missing environment boundary, not one card per secret.
- Walk `opaque_status_candidates` only in [prompts/semantic-candidate-pass.md](../../prompts/semantic-candidate-pass.md). Record each row in `semantic_coverage` as `hit` or `skip`. A skip is not a finding and must not change the rollout verdict by itself.
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
