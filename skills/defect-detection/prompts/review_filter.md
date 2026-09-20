Stage 2 — VERIFY, GRADE, and FILTER.

{{SYSTEM_BASE}}

## Few-shot examples (format only)

Example keep (confirmed judgment):
Input finding: concurrency at svc/order.py:12
Output: {"findings":[{"file":"svc/order.py","line":12,"category":"concurrency","severity":"P1","rule_id":"CONC-001","title":"non-atomic stock debit","evidence":"read-then-write without WHERE stock>=n","suggestion":"atomic UPDATE ... WHERE stock >= n","confidence":0.85}]}

Example drop (intentional / already clear SAST / no evidence):
Input finding: null_safety already listed in Clear deterministic findings
Output: {"findings":[]}

Example demote ambiguous SAST residue (localhost HTTP mock graded P3):
Input: ambiguous Semgrep P1 at verify_foo.ts:40 "Unencrypted request over HTTP"
Output: {"findings":[{"file":"verify_foo.ts","line":40,"category":"security","severity":"P3","rule_id":"SEC-001","title":"loopback mock health probe (not production TLS)","evidence":"fetch http://127.0.0.1 for local mock only","suggestion":"keep loopback mocks; allowlist in Semgrep if noisy","confidence":0.85}]}

Example dismiss ambiguous SAST residue (false positive / intentional design):
Input: ambiguous Semgrep P1 at verify_foo.ts:40 localhost HTTP
Output: {"findings":[],"dismissals":[{"file":"verify_foo.ts","line":40,"reason":"intentional loopback mock health check; not a production cleartext client"}]}
# Equivalent: emit a finding with "dismissed": true or "verdict": "dismiss" at the same file:line.

Suspected findings from Stage 1:
{{FINDINGS}}

Full context:
{{CONTEXT}}

Task: for each suspected finding, verify against the context:
1. If evidence does not hold, is intentional design, or duplicates a *clear* deterministic finding → DROP from `findings`.
2. For **ambiguous SAST residue** you grade/demote: keep a finding at the same file:line with the final severity (LLM severity wins over ambiguous SAST).
3. For **ambiguous SAST residue** you reject as FP/intentional: either add `dismissals:[{file,line,reason}]` or a finding with `"dismissed": true` / `"verdict":"dismiss"` at that locus (clear SAST cannot be dismissed).
4. Assign final severity (P0-P3) and confidence.
5. Preserve or correct **rule_id** when the finding matches an injected policy; drop unknown invented ids.
6. Improve the suggestion to be actionable.
Output: STRICT JSON — `{"findings":[...]}` and optional `"dismissals":[...]`. No markdown fences.
