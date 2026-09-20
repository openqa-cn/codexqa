# How Defect Detection works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`defect-detection`](README.md) is scaffolding for a host agent: a diff, repo, upload, or paste goes in; a P0–P3 `report_scan.*` comes out. Deterministic collectors and adapters produce evidence; the invoking agent fills Stage1/Stage2 judgment JSON; Python merges and gates the final report. Code-graph context comes from the CodexQA CLI binary only.

The runtime contract is in [`SKILL.md`](SKILL.md).

## Data flow

```text
diff / repo / upload / paste
        │
        ▼
   ensure_tools + scope_planner
        │
        ▼
   collect (SAST / lint / secrets / SCA + CodexQA graph context)
        │
        ▼
   agent_llm/ handoff  (prompts + policies + sast.json)
        │
        ├─ Stage1 (host agent) → stage1.json
        ├─ agent-stage2 prepare → stage2_prompt.md
        └─ Stage2 (host agent) → llm_final.json
                │
                ▼
        finalize / merge_report
                │
                ▼
        report_scan.json / .md / .html  (P0→P3)
```

1. **Choose scenario** — `repo-incremental`, `repo-full`, upload, or paste via `choose_scenario` / `run_scan.py choose`.
2. **Deterministic prepare** — tools check, scope plan, collect adapters, CodexQA context; write `agent_llm/` handoff. Do not invent findings yet.
3. **Stage1 / Stage2** — host agent writes strict findings JSON from injected prompts and policies (`references/policies/`).
4. **Finalize** — merge SAST + LLM, validate, order by severity, emit `report_scan.*`.
5. **Optional verdicts** — `feedback.py` only when the user explicitly accepts/dismisses/ignores.

## What Python owns vs the model

| Layer | Owns |
|---|---|
| Python (`run_scan`, collect, SAST adapters, merge, finalize) | Tooling status, scope, deterministic findings, merge rules, report schema, cache keys |
| Host agent (Stage1/Stage2) | Semantic findings JSON under policy prompts; no autofix |
| Optional `--llm-mode api` | Same Stage1/Stage2 contract via external OpenAI-compatible API |

## Relationship to other code skills

| Skill | Difference |
|---|---|
| [`code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-reviewer/README.md) | Playbook P0/P1/P2 on a local checkout — no `report_scan` pipeline |
| [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.md) | Structure/impact from the same CodexQA graph — not a finding severity report |
| [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.md) | Exception RCA on top of CLI facts — not incremental/full code-risk scan |

## Evidence status

Local `npm test` runs Python pipeline and policy-fixture suites (Python 3.10+). Live agent/API scans and optional SAST binaries are not required by repository CI. See [Known limitations](KNOWN_LIMITATIONS.md).
