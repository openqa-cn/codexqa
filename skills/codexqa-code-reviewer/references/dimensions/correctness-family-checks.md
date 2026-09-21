# Family correctness checks (language-agnostic checklist)

Apply after Design fit, as part of **Correctness / concurrency** passes.
These are **generic** patterns — not project-specific rules. Use
`review_language_focus` to weight which rows matter; always require evidence
from `symbol-diff` / source text in the pack (or hot-but-thin → matching diff).

## Must-read process (all languages)

From `08-hot-but-thin.json` (or full-repo untested hotspots), for every symbol whose
**name** matches (case-insensitive):

- `equals` / `hashCode` / `compare*` / `compareTo` / `cmp`
- identity-sensitive ops if clearly named in the graph

**You must open the corresponding `diffs/<id>.diff.json` (or symbol body in pack)
and reason about the implementation** — do not accept or dismiss by symbol name alone.

## Checklist by family

| Check | Java / Kotlin | Go | TypeScript / JS | Python |
|---|---|---|---|---|
| Equality contract | `equals` ↔ `hashCode` pair; avoid reference `==` on objects/strings when value equality intended | comparable/`==` vs `Equal` for structs; pointer vs value | `===` vs `==`; value objects | `==` vs `is`; `__eq__` ↔ `__hash__` |
| XSS / HTML sink | `innerHTML` / `document.write` / unescaped `Markup` / `HtmlUtils` misuse / raw HTML in response without encode/escape | `template.HTML` / `html/template` vs `text/template` for untrusted | `dangerouslySetInnerHTML` / `el.innerHTML` / unsanitized markdown→HTML | `Markup` / Jinja `|safe` / f-string HTML without escape |
| Resources | try-with-resources / close streams; no leaked `InputStream`/`Reader` | `defer Close()` on files/bodies | `close()` / using Disposable patterns when applicable | `with` / close files |
| Money / decimal | avoid `new BigDecimal(double)`; prefer `BigDecimal.valueOf` / string | avoid float for money; use `shopspring/decimal` or int cents | avoid IEEE float for currency | `Decimal` not float |
| Null unboxing | `Boolean`/`Integer` from `Map.get` used in `if (x)` / arithmetic without null check | nil deref on map miss | optional chaining vs truthiness | `None` in bool/arith |
| Collection CME | enhance-for / iterator invalidation via `list.remove` during traversal | range+delete pitfalls | mutate array while for-of | mutate list while for-in |
| Operator precedence | mixed `&&` / `\|\|` without parens in validators/guards | same | same | `and`/`or` precedence |
| Half-open ranges | documented `[start,end)` vs loop `<= end` / length as end index | slice vs inclusive loops | | |
| Unbounded caches | static/`static` maps without bound/eviction + concurrency story | package-level maps without bound | module-level Maps | module dict caches |
| Integer overflow | `int*int` then widen to long; `(int)(a-b)` on longs | int overflow / wrap | `Number` precision | rare; note big int |
| Shared mutable formatters / calendars | static `SimpleDateFormat` / non-thread-safe formatters | — | mutable shared Date objs | — |
| Fan-in for “unused” | Prefer empty `edges-in` over stub-inflated `from_count` when claiming unused/YAGNI | same | same | same |

### Short-method trap (Complexity + Correctness)

Do **not** skip body review for small LOC methods. From `11-complexity-signals.json`,
any method with `decisions >= 10` or `nest_max >= 5` is in-scope even when LOC &lt; 80
(e.g. dense validators / deep if-ladders). Open the symbol window / diff and apply
the family rows above.

Escalate severity using [review-dimensions.md](../review-dimensions.md) P0/P1/P2
rules. Missing graph support → state confidence and still cite diff text.

## Non-goals

- Do not invent language-specific linters as the primary engine.
- Do not encode one-off method names from a single fixture as permanent rules.
