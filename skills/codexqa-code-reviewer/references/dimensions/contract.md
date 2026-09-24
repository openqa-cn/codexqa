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

## Detection rules

Judge `API-001` only in [prompts/business-logic-pass.md](../../prompts/business-logic-pass.md) using [business-rule-records.md](../business-rule-records.md). Do not judge it while filing SAST rows.

| rule_id | type | sev | Look for | Do not report |
|---|---|---|---|---|
| `API-001` | architecture | P2 | Renamed or removed response fields or enum values on an existing public endpoint, with no version bump and no compatibility shim. Also: a public purge/delete with no authz check, whose failure returns `0`, empty, or success, so the caller cannot tell the delete did not happen. | Additive optional fields; internal-only DTOs; a new `/v2` route that leaves `/v1` unchanged. The purge checks authz and returns a distinct error. |

External callers in `edges-in` raise this to P1. XSS stays `security` or `correctness` per the family checks; do not also file `API-001` for an HTML sink.

## Semantic candidates (model decides)

`17-contract-signals.json` → `error_payload_candidates` (`decision: "llm"`). This array is **not** a hard gate and does **not** change `signals_thin`. An empty array means the shape is absent. A non-empty array is judged only in [prompts/semantic-candidate-pass.md](../../prompts/semantic-candidate-pass.md): each row is a finding or a one-line skip. Do not add a new `rule_id`. Use `category: contract`. Use `API-001` only when the same method is already the purge/delete case in the table above; do not hang `API-001` on a thin error code alone. Do not judge these rows in the business-logic pass.

| Look for | File | Skip |
|---|---|---|
| A `reject` / `fail` factory takes one code and the result carries no message, cause, or trace id (`TransferResult.reject(String code)`, `func Reject(code string)`, `def reject(code)`, `function reject(code)`). | The caller of a public or exported result cannot tell root causes apart, and no trace id is returned. | The body or type already sets `message` / `detail` / `cause` / `traceId` / `correlationId`. A code catalog or enum documents every code. The helper is internal and not the caller-facing error. |

## Soft thresholds

| Signal | Default |
|---|---|
| `breaking_hints` (breaking change / removed API / `@Deprecated`) | P2; external callers → P1 |
| `xss_html_hits` (innerHTML / dangerouslySetInnerHTML / `\|safe` / etc. without escape) | P2; entry-reachable → P1 |
| `public_sig_lines` volume | Hint only — confirm with graph |

## Output

- Cover Contract: findings or None from `17-…` + edges-in.
- XSS: cite `xss_html_hits`; category `security` or `correctness` per correctness-family.
- Walk `error_payload_candidates` only in [prompts/semantic-candidate-pass.md](../../prompts/semantic-candidate-pass.md). Record each row in `semantic_coverage` as `hit` or `skip`. A skip is not a finding.

## Non-goals

No OpenAPI live crawl. Missing `17-` → WARN only.
