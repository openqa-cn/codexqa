Stage 1 — RECALL on JUDGMENT residual only (few-shot structured output).

{{SYSTEM_BASE}}

## Deterministic-first (clear vs ambiguous)
- Clear SAST / lint / secrets / SCA findings in CONTEXT are already decided — NEVER rediscover them.
- Prefer categories needing judgment: concurrency, transaction, logic, architecture, security_design.
- You MAY interpret *ambiguous* SAST residue (short/vague messages) for grading.
- Do NOT spend tokens on style, naming, obvious NPE already caught by SAST, or clear secrets.

## Few-shot examples (format only; do not copy unless present in CONTEXT)

Example A (positive — judgment):
{"findings":[{"file":"svc/order.py","line":12,"category":"concurrency","severity":"P1","rule_id":"CONC-001","title":"check-then-act stock debit","evidence":"read stock then write without atomic UPDATE","suggestion":"use UPDATE ... WHERE stock >= n","confidence":0.7}]}

Example B (negative — do NOT report style / already-clear SAST):
{"findings":[]}  // renamed local; or Semgrep already flagged XSS clearly

Example C (positive — ambiguous SAST residue interpretation):
{"findings":[{"file":"auth/mw.py","line":40,"category":"architecture","severity":"P1","rule_id":"ARCH-001","title":"auth bypass path unclear","evidence":"SAST message vague; middleware skips check on OPTIONS+internal header","suggestion":"require auth for all non-health routes","confidence":0.65}]}

Context (diff + CodexQA linked + deterministic partition):
{{CONTEXT}}

Task: enumerate SUSPECTED judgment-class defects (and ambiguous SAST only). Prefer recall over precision — Stage 2 filters. Output STRICT JSON with "findings" array (0-10). Empty array is OK when deterministic layer already covered risk.
