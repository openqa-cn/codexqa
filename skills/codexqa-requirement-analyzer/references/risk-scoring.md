# Risk scoring

Classify first, then rank. Every score must point at material or be marked a hypothesis. Do not emit an integer RPN or a 0–100 score.

## Product vs project

- Product risk: users, money, data, safety, or primary UI states break after release. Use `product-*` `RiskClass` (including `product-ux`).
- Project risk: cannot test, will miss the window, scope is drifting, or a dependency is not ready. Use `project-schedule` / `project-scope` / `project-dependency`.

Extra weight (only when the material mentions the topic; do not invent):

- Third-party dependency with no degrade or timeout → raise O or use `project-dependency`.
- Empty/loading/error states missing on a UI main path → `product-ux`.
- Extreme input, permission edges, or double-submit unstated → raise `product-functional` or `product-data`.

Report both. Incomplete docs are not the only P0 unless they block verification of a core product risk.

## S / O / D (High / Med / Low)

- **S severity**: money loss, safety, irreversible, or compliance → High; main-path wrong but compensable → Med; copy/UX → Low.
- **O occurrence**: on the main or peak path → High; rare config → Med; needs several mistakes at once → Low.
- **D detectability**: hard to test before release or no oracle → High (hard to detect); a clear assertion exists → Low.

## Compose P0–P3 (no multiplication)

- P0: S is High and (O or D is High), or a conflict would pick the wrong main path (`conflict-escape`).
- P1: S High with Med/Low O/D, or S Med and it blocks test start.
- P2: S Med and does not block release.
- P3: S Low, or copy-only.

## FailureMode (required on P0)

- `misinterpret`: ambiguity yields two implementations.
- `missed-rule`: unstated behavior will appear in production.
- `no-oracle`: a requirement exists but failure cannot be judged.
- `conflict-escape`: sources disagree and implementation may pick the wrong side.
