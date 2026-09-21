<!-- Compat alias: Stage1 Agent LLM Detection lives in agent_detect.md.
     Kept so older docs / external callers that name rule_checker.md still resolve. -->

Stage 1 — **Agent LLM Detection dimension** (one-round code defect analysis).

{{SYSTEM_BASE}}

## What this dimension is

You are the **host agent's embedded model** (the same model that invoked this skill).
This pass is an independent detection dimension — not a paraphrase of SAST output.

Run **one** thorough analysis of the code in CONTEXT and emit suspected defects.
Python will **dedupe and merge** your findings with the deterministic dimension
(SAST / lint / secrets / SCA) into the final `report_scan.*`.

## What to find

Prioritize defects deterministic scanners miss or under-specify:

- concurrency / race / check-then-act
- transaction boundaries / partial commit
- business logic holes / authz bypass paths
- architecture / trust-boundary mistakes
- security design gaps (even when no Semgrep rule fired)
- ambiguous SAST residue that needs human-grade interpretation

Prefer injected **LLM semantic policies** (`rule_id` like CONC-001, AUTH-001, …).

## Dedup discipline (important for merge quality)

- Do **not** clone clear SAST/lint/secrets/SCA hits word-for-word — those already form the
  deterministic dimension and will appear as `sast_only` / `sast_confirmed` after merge.
- You **may** emit a finding near a clear SAST locus when you add *new* semantic evidence
  (different vuln class, missing authz path, wrong severity story). Compatible same-locus
  hits become `sast_confirmed` on merge.
- You **must** surface judgment-class bugs with **no** matching SAST hit — those become
  `llm_judged` after merge.
- Skip style, naming, TODOs, and patterns already dismissed in context / auto_rules.

## Few-shot examples (format only; do not copy unless present in CONTEXT)

Example A (agent-only logic/concurrency — no SAST twin):
{"findings":[{"file":"svc/order.py","line":12,"category":"concurrency","severity":"P1","rule_id":"CONC-001","title":"check-then-act stock debit","evidence":"read stock then write without atomic UPDATE","suggestion":"use UPDATE ... WHERE stock >= n","confidence":0.7}]}

Example B (do NOT restate an already-clear Semgrep XSS):
{"findings":[]}

Example C (interpret ambiguous SAST residue):
{"findings":[{"file":"auth/mw.py","line":40,"category":"architecture","severity":"P1","rule_id":"ARCH-001","title":"auth bypass path unclear","evidence":"SAST message vague; middleware skips check on OPTIONS+internal header","suggestion":"require auth for all non-health routes","confidence":0.65}]}

Context (diff + CodexQA linked + deterministic partition):
{{CONTEXT}}

Task: perform **one round** of Agent LLM Detection. Prefer recall over precision —
Stage 2 verifies and grades. Output STRICT JSON with `"findings"` array (0–10).
Empty array is OK when the deterministic dimension already covers the risk and no
judgment-class defect remains.
