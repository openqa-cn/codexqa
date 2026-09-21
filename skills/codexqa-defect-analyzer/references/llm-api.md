# Optional external API LLM

Default judgment for this skill is **agent-inline** (the Cursor/agent model that invoked the skill). Use this document only when you need an unattended OpenAI-compatible HTTP API.

## When to use

- Headless CI with real model keys (not the default advisory `--dry-run` smoke)
- Batch jobs outside an interactive agent session

## Env

```bash
export LLM_API_KEY=sk-...
export LLM_BASE_URL=https://api.deepseek.com   # OpenAI-compatible base
export LLM_MODEL_SMALL=deepseek-chat
export LLM_MODEL_LARGE=deepseek-reasoner
```

## Run

```bash
python3 scripts/run_scan.py incremental --repo <repo> --llm-mode api -o /tmp/aid_report
python3 scripts/run_scan.py full --repo <repo> --llm-mode api -o /tmp/aid_report
```

Missing key with `--llm-mode api` → exit 2 (does not fall back to agent or silent mock).

## Modes recap

| Mode | Key needed | Backend |
|------|------------|---------|
| `agent` (default) | No | Invoking agent model + handoff files |
| `api` | Yes | `llm_client.py` HTTP chat completions |
| `dry-run` | No | Heuristic mock in `llm_client.py` |
