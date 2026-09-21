# Dimension card: Complexity

Source: [Google eng-practices — Complexity](https://google.github.io/eng-practices/review/reviewer/looking-for.html)

| Field | Value |
|---|---|
| id | `complexity` |
| title | Complexity |
| order | 2 |
| modes | pr, full |
| finding_category | `complexity` |
| algorithm | derive (`11-complexity-signals.json`) + reuse symbol spans / edges-in |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Line / function / class complexity** — Is any unit harder to understand quickly than it needs to be?
2. **Bug-prone to modify** — Would callers/maintainers likely introduce bugs when changing this code?
3. **YAGNI / over-engineering (implementation)** — Is the code more generic or speculative than today’s evidenced need?

## Split vs Design fit

| Design fit | Complexity (this card) |
|---|---|
| Belong, layer, module boundary, timing of features | Cognitive load, size/nesting, modify risk, implementation YAGNI |
| `category: design` | `category: complexity` |

Do **not** re-litigate Belong/Layer here. You may cite Design-fit `dead_nested` / empty edges-in as **supporting** evidence, but findings stay `complexity`.

## Soft thresholds (auditable heuristics)

| Signal | Attention | Elevated |
|---|---|---|
| Method LOC (`end_line - start_line + 1`) | ≥ 80 | ≥ 150 (entry/sensitive intersection may raise to P1) |
| Decision-keyword density in method window | ≥ 10 | — |
| Nesting depth (brace depth + **relative** indent from method start) | ≥ 5 | — |
| `change_status=add` **top-level** methods (`depth<=1`) under one namespace cluster | ≥ 15 | — |
| High LOC/branches **and** `tested_count==0` | — | prefer P1 |
| YAGNI: add + (**empty `edges-in`**) + deep/nested abstraction; or reserved/future comments — never `from_count==0` alone (`from_count` ≠ fan-in) | P2 default | — |

Confidence default `medium`. Do not claim exact McCabe without AST; these are reader-oriented proxies.

**Collect note:** `derive-complexity.sh` must receive `--repo <abs>` (collect scripts pass it) because body scans run **before** `manifest.json` is written. Without repo, `files_scanned=0` and decisions/nesting/YAGNI-comment signals are silently zero — LOC from symbol spans still works.

### Decision-keyword language-family table (derive)

Shared counter in `derive-complexity.sh` (case-insensitive). Extend here when adding families — keep one regex, no per-project lists.

| Family | Keywords / operators counted |
|---|---|
| C-family / Java / Go / JS / TS / C# | `if`, `else if`, `for`, `while`, `switch`, `case`, `catch`, `&&`, `\|\|`, ternary `?` |
| Python | `if`, `elif`, `for`, `while`, `except`, `match`, `case` |
| Kotlin / Scala-ish | `if`, `when`, `for`, `while`, `catch`, `match` |
| Generic | same shared set — prefer adding tokens to the shared regex over bespoke per-repo rules |

## Evidence map

| Signal | Source |
|---|---|
| Method spans | `05-changed-symbols.json` (`start_line`/`end_line`) |
| Branches / nesting | Bounded scan of files in `04` via `manifest.repo` |
| Empty callers | `impact/*/edges-in.json` |
| Untested complex | `tested_count` on same symbols / `08-hot-but-thin.json` |
| Optional cross-ref | `10-design-fit-signals.json` `dead_nested_symbols` / `sprawl` if present |

## Severity

| Default | Escalate | Almost never P0 |
|---|---|---|
| P2 | Complex + untested + entry/sensitive intersection evidenced | P0 left to correctness/security/data damage |

## Output

- Always evaluate Complexity into `review-conclusion.json` (findings **or** `ok`/`none`
  + short signal summary from `11-complexity-signals.json`).
- **Report/HTML:** include the Complexity section only when `verdict` is `concern`/`unknown`
  (omit clean `ok`/`none`). Renderer filters the same way.
- **`hotspots` / `risk` prose (required when concern):** explain the **risk in plain language** —
  which functions are too large / hard to change, which user or runtime path they sit on,
  and what breaks if modified without tests. Prefer filling both `risk` and `hotspots`
  (renderer shows `risk // hotspots` as 风险说明). Soft metrics (`LOC≥150`, untested) may appear
  in parentheses; never dump `loc_high+untested` / `edges-in=N` as the whole field.
  See review-dimensions **Reader prose**.
- Prefer `call_chain` on concern Complexity cards (HTML 调用链路) from edges-in / production path.
- Optional `complexity` object on `review-conclusion.json` (see template).
- Include `complexity` in `dimensions_covered`.

## Non-goals

- No complexity “scorecard” grade.
- No extra CodexQA calls; no raising `TOP_N`.
- No project-specific method-name blacklists.
- Missing `11-…` → thin review or None; validate WARN only.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
