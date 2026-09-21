# Dimension card: API / contract

| Field | Value |
|---|---|
| id | `contract` |
| title | API / contract |
| order | 8 |
| modes | pr, full |
| finding_category | `contract` (XSS findings → `security` / `correctness`) |
| algorithm | derive (`17-contract-signals.json`) + reuse edges-in / symbol-diff |
| max_extra_codexqa | **0** |

## Questions

1. Public/export signature or behavior drift vs evidenced callers (`edges-in`)?
2. Breaking / deprecation clues in the change set?
3. XSS/HTML sinks without encode/sanitize (also in correctness-family)?

## Soft thresholds

| Signal | Default |
|---|---|
| `breaking_hints` (breaking change / removed API / `@Deprecated`) | P2; external callers → P1 |
| `xss_html_hits` (innerHTML / dangerouslySetInnerHTML / `\|safe` / etc. without escape) | P2; entry-reachable → P1 |
| `public_sig_lines` volume | Hint only — confirm with graph |

## Output

- Cover Contract: findings or None from `17-…` + edges-in.
- XSS: cite `xss_html_hits`; category `security` or `correctness` per correctness-family.

## Non-goals

No OpenAPI live crawl. Missing `17-` → WARN only.
