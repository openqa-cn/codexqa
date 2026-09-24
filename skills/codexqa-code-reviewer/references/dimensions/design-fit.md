# Dimension card: Design fit

Source: [Google eng-practices — Design](https://google.github.io/eng-practices/review/reviewer/looking-for.html)

| Field | Value |
|---|---|
| id | `design` |
| title | Design fit |
| order | 1 |
| modes | pr, full |
| finding_category | `design` |
| algorithm | derive (`10-design-fit-signals.json`) + reuse edges-in |
| max_extra_codexqa | **0** |

## Questions (must attempt — report as four separate bullets)

Emit Design fit coverage as **four subsections** (findings and/or explicit `None`), never only a one-line summary:

1. **Belong** — Do changed packages/paths and their imports/callers match existing module boundaries, or does the CL place unrelated responsibility here?
2. **Layer** — Do package/import and call edges cross layers in a smell way (e.g. 存储 → 入口)? Full-repo: also use `imports/` + 入口→应用→领域→存储.
3. **Over-engineering** — Heavy `change_status=add` with empty/near-empty `edges-in`, and/or nested types confirmed unused via **empty `edges-in`** (`dead_nested_symbols`; candidates alone are **not** YAGNI — `from_count==0` is NOT fan-in), large abstractions for speculative future needs.
4. **Timing** — Is now a good time given `intent`/`scope` and change surface? Do **not** invent product strategy — put uncertainty in `design_fit.timing` / residual.

## Detection rules

Judge `ARCH-001` only in [prompts/business-logic-pass.md](../../prompts/business-logic-pass.md) using [business-rule-records.md](../business-rule-records.md). A line already in `import_cross_layer` is the derive row; do not file it again. An auth skip is `SEC-001`, not a second design finding.

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `ARCH-001` | architecture | P2 | New cross-layer imports (UI→DB, handler→raw SQL that skips the repository); circular dependencies. | Intentional adapter/facade with a documented boundary. |

Auth skip on OPTIONS, a debug flag, or an internal header is the authz half of this rule: file it as `SEC-001` on [security.md](security.md) (`category: security`), not as a second design finding. Health/readiness that is explicitly public, and CORS preflight that still authenticates the real method, are not findings. Set `rule_id` when the layering half matches. `import_cross_layer` is the signal; still confirm the import is a real boundary break.

`18-maintainability-signals.json` → `prod_test_coupling` is `DES-001`. A production type that imports a test framework or nests a test is a design finding even when no build file lists the dependency. One row per file. A path under a test directory is not this row.

## Evidence map

| Signal | Pack source |
|---|---|
| Path / module clusters | `04-changed-files.json`, `03-change-groups.json` |
| Package / namespace layer | `10-design-fit-signals.json` → `labeled_files.package_layer`, `namespace_layers` |
| Import cross-layer | `10-design-fit-signals.json` → `import_cross_layer` / merged `cross_layer_edges` (source=`package_import`) |
| Call-edge cross-layer | `impact/*/edges-in.json` (source=`edges_in`) |
| Add vs change sprawl | `05-changed-symbols.json` (`change_status`) |
| Dead nested / unused nested | `dead_nested_symbols` (confirmed empty `edges-in` only); `dead_nested_candidates` are structure hints — do **not** escalate YAGNI from `from_count==0` |
| Same-file nested name layers | `nested_type_cross_layer` (name tokens → 入口/应用/领域/存储) |
| Full-repo layering | `imports/`, `imports/index.json` |

Layer labels are **heuristics** on path **and** package/import/namespace tokens
(api/iface/controller → 入口; service/app → 应用; domain/model → 领域;
dao/mapper/repo/storage → 存储; else `other`). Prefer package/namespace over bare
filename when both exist. **Also** score nested type/method **names** in the same
file (`nested_type_cross_layer`) — a `dao/mapper` path alone must not hide
入口-named helpers next to 存储 types. Confidence `medium`/`low` unless imports corroborate.

## Severity

| Default | Escalate to P1 when | Almost never P0 |
|---|---|---|
| P2 | Wrong-boundary coupling **and** entry-reachable / sensitive intersection with pack evidence | P0 reserved for correctness/security/data damage |

Under `stubs>=20`, cap cross-layer / blast-style design claims at `confidence: UNKNOWN`
(same rule as regression radius). Prefer citing direct `edges-in` callers and
`import_cross_layer` evidence.

## Output

- Always evaluate all four subsections into `review-conclusion.json`: Belong / Layer /
  Over-engineering / Timing (use `ok`/`none` when clean).
- **Report/HTML:** emit Design fit only when overall or a subsection is `concern`/`unknown`;
  include only those issue subsections (omit clean ones). Renderer filters the same way.
  Each emitted subsection **must** state the specific code risk (`risk` or risk-worded `notes`).
- Prefer separate `category: design` findings per subsection when issues exist.
- Include `design` in `dimensions_covered` when evaluated.
- Optional Mermaid: nodes only from signals + edges-in / import_cross_layer.

## Non-goals

- No architecture “scorecard” / numeric grade.
- No extra CodexQA import crawl on PR by default.
- Do not fold style, naming, or method-name blacklists into this dimension.
- Do not fail collect/validate when `10-design-fit-signals.json` is missing (legacy).

## skip_when

- Blocked pack / missing CodexQA engine → no Design fit findings.
- Empty change-groups (PR) → blocked before dimensions.
- Signals file absent → thin review from `04`/`05`/`impact` or state residual gap.
