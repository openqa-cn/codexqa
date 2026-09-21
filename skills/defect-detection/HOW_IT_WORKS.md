# How Defect Detection works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`defect-detection`](README.md) is scaffolding for a host agent: a diff, repo, upload, or paste goes in; a P0–P3 `report_scan.*` comes out. Two detection dimensions run, then Python **dedupes and merges** them into one report:

1. **Deterministic** — SAST / lint / secrets / SCA adapters
2. **Agent LLM Detection** — the invoking agent's embedded model (one analysis round + Stage2 verify; no API key)

Code-graph context comes from the CodexQA CLI binary only. The runtime contract is in [`SKILL.md`](SKILL.md).

## Data flow

```text
diff / repo / upload / paste
        │
        ▼
   ensure_tools + scope_planner
        │
        ▼
   collect (SAST / lint / secrets / SCA + CodexQA graph context)
        │  ← Dimension: deterministic
        ▼
   agent_llm/ handoff  (prompts/agent_detect.md + policies + sast.json)
        │
        ├─ Stage1 Agent LLM Detection (host agent) → stage1.json
        ├─ agent-stage2 prepare → stage2_prompt.md
        └─ Stage2 verify (host agent) → llm_final.json
                │  ← Dimension: agent_llm
                ▼
        finalize / merge_report  (dedupe ∪ merge)
                │
                ▼
        report_scan.json / .md / .html  (P0→P3; dimension stamped)
```

1. **Choose scenario** — `repo-incremental`, `repo-full`, upload, or paste via `choose_scenario` / `run_scan.py choose`.
2. **Deterministic prepare** — tools check, scope plan, collect adapters, CodexQA context; write `agent_llm/` handoff. Do not invent findings yet.
3. **Agent LLM Detection** — host agent writes Stage1 findings from `agent_detect.md`, then Stage2 verify (`references/policies/`).
4. **Finalize** — merge + dedupe deterministic ∪ agent_llm, validate, order by severity, emit `report_scan.*` with `dimension` on each finding.
5. **Optional verdicts** — `feedback.py` only when the user explicitly accepts/dismisses/ignores.

## What Python owns vs the model

| Layer | Owns |
|---|---|
| Python (`run_scan`, collect, SAST adapters, merge, finalize) | Tooling status, scope, deterministic findings, merge/dedupe rules, report schema, cache keys |
| Host agent (Agent LLM Detection Stage1/Stage2) | Semantic findings JSON under policy prompts; no autofix |
| Optional `--llm-mode api` | Same Stage1/Stage2 contract via external OpenAI-compatible API |

## Relationship to other code skills

| Skill | Difference |
|---|---|
| [`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.md) | CodexQA evidence pack + heuristic dims + Agent LLM judgment (dedupe) → bilingual `REVIEW-REPORT.html` — no `report_scan` pipeline |
| [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.md) | Structure/impact from the same CodexQA graph — not a finding severity report |
| [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.md) | Exception RCA on top of CLI facts — not incremental/full code-risk scan |

## Evidence status

Local `npm test` runs Python pipeline and policy-fixture suites (Python 3.10+). Live agent/API scans and optional SAST binaries are not required by repository CI. See [Known limitations](KNOWN_LIMITATIONS.md).
