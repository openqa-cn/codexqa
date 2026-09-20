---
name: defect-detection
description: >
  AI defect detection and code-risk scanning for engineering projects. Use when
  the user asks for AI defect detection, code-risk scan, review a diff/MR/PR/commit
  (incremental), baseline-scan a repository (full), OR upload/paste code snippets
  for adhoc defect detection. Combines deterministic SAST/lint/secrets/SCA with
  two-stage semantic review performed by the invoking agent model (no separate LLM
  API key). Delivers structured findings ordered by severity (P0–P3) via
  report_scan.json / report_scan.md / report_scan.html. Do NOT use to apply or
  autofix code style/formatting — lint may still surface hygiene findings.
  Code-graph / call-chain MUST use CodexQA CLI for all languages
  (references/codexqa-cli.md) — never homemade analyzers. Not a P0/P1/P2 playbook CR (that is code-reviewer), not structure/impact
  mapping (that is code-analyzer), and not exception RCA (that is
  root-cause-diagnosis). When scenario unclear, ask or run
  choose_scenario / run_scan.py choose.
license: Apache-2.0
compatibility: >
  Requires **Python 3.10+** on PATH (re-execs onto 3.10+ if system `python3` is older), git on PATH for repo scans, and
  optional SAST/lint/secrets tools (Semgrep, Bandit, gosec, gitleaks, ruff,
  eslint, osv-scanner). Talks to the `@openqa-cn/codexqa` CLI for code-graph /
  call-chain on all languages. Default `--llm-mode agent` needs no API key.
metadata:
  author: open-source
  version: "0.0.1"
  open-standard: agentskills
---

# Defect Detection

You are a defect-detection orchestrator. Commands are English; user-facing text may be Chinese.
**Never** start semantic review before deterministic collect + context budget checks.

CLI: `python3 {baseDir}/scripts/run_scan.py` (`$SKILL_SCRIPT`). Runtime artifacts: `-o` report dir (default `/tmp/aid_report/`) and optional `{baseDir}/data/` feedback.

`README.md` / `README.zh-CN.md` / `HOW_IT_WORKS.md` / `KNOWN_LIMITATIONS.md` (and their `.zh-CN` twins) are human-facing. Do not load them at runtime.

## Boundaries

| Need | Skill |
|---|---|
| SAST + agent-inline semantic scan → `report_scan.*` (P0–P3) | **this skill** (`defect-detection`) |
| P0/P1/P2 playbook review of a local checkout | `code-reviewer` |
| Symbol-graph change impact, callers, test gaps | `code-analyzer` |
| Exception RCA from stacks/logs on top of CLI analysis | `root-cause-diagnosis` |

## Judgment model (default)

**You (the agent invoking this skill) ARE the Stage1/Stage2 judgment model.**
Do **not** require `LLM_API_KEY` / `LLM_BASE_URL`. Scripts prepare prompts; you write findings JSON; scripts merge the report.

| `--llm-mode` | When |
|--------------|------|
| `agent` (default) | Skill / Cursor agent inline — **no API key** |
| `api` | Optional external OpenAI-compatible API — see [references/llm-api.md](references/llm-api.md) |
| `dry-run` | Heuristic mock (CI advisory only) |

## Deliverable

| Artifact | Default | Role |
|----------|---------|------|
| `report_scan.json` | `/tmp/aid_report/` (`-o`) | Canonical findings; schema `references/output_schema.json` |
| `report_scan.md` | same dir | Human summary (Markdown) |
| `report_scan.html` | same dir | Same content as `.md` in styled HTML (auto-generated at finalize) |

Finding fields: `file`, `line`, `category`, `severity`, `title`, `evidence`, `suggestion`; `source` ∈ `sast_only` \| `sast_confirmed` \| `llm_judged`; judgment SHOULD include `rule_id`. Order **P0→P3**. Surface `tooling_status.missing` when present. Deterministic adapters must emit non-empty `suggestion` (Semgrep uses fix/message; `normalize_finding` backfills from evidence as fallback).

**Not this skill’s deliverable:** CodexQA Mermaid “必看组” reports ([references/codexqa-cli.md](references/codexqa-cli.md)), platform write-back, or exception RCA prose.

## Scenario selection

```bash
python3 scripts/choose_scenario.py --list
python3 scripts/choose_scenario.py --infer "<user utterance>"
python3 scripts/run_scan.py choose --scenario <id> ...
```

| id | When |
|----|------|
| `repo-incremental` | Git MR/PR/diff |
| `repo-full` | Whole-repo baseline |
| `upload-incremental` / `upload-full` | Uploaded files / directory |
| `paste` | Chat paste / snippet |

Upload/paste → temp file → `run_scan.py adhoc`. Unspecified mode: snippet→incremental, directory→full. No code → ask; do not scan empty.

## Tools (deterministic)

Before collect: `python3 scripts/ensure_tools.py --repo <repo>`.
Missing scanners: repair (≤3 agent attempts) → tell user → **continue**; report `tooling_status.missing`.
CodexQA mock policy: **real CLI always wins**. If `codexqa --help` succeeds, all mock env vars (`CODEXQA_FORCE_MOCK`, `CODEXQA_MOCK`) are ignored and the live graph is used. Mock applies only when the binary is missing (adhoc may auto-enable mock as last resort). Repo scans **hard-fail** if CLI missing and mock not allowed.

| Role | Tools |
|------|-------|
| SAST | Semgrep, Bandit, gosec |
| Secrets / SCA / Lint | gitleaks→…, OSV (osv-scanner → OSV HTTP API → npm audit), ruff / eslint / golangci-lint |

**Not used:** SonarQube, CodeQL.

```bash
bash scripts/install_codexqa.sh
export PATH="$(npm prefix -g)/bin:$HOME/.local/bin:$HOME/go/bin:$PATH"
```

## Report cache (diff_hash)

Incremental scans cache **finalized** reports keyed by `diff_hash`. **Agent-inline mode (default) never reads cache at prepare** — it always emits `agent_llm/` for Stage1/Stage2. Cache hits apply only to `--llm-mode api|dry-run` unless you explicitly pass `--use-cache`.

| Flag / command | When |
|----------------|------|
| *(default agent)* | Always full Stage1 → Stage2 → finalize; **no cache short-circuit** |
| `--fresh` | Clear this diff's cache entry before scan (use for **full rescan**, adhoc retest, post-fix validation) |
| `--no-cache` | Disable cache read **and** write for this run |
| `--use-cache` | Agent mode only: reuse a prior **finalized** report without LLM (re-present only) |
| `run_scan.py cache list` | Inspect cached entries (pipeline version, llm_mode, complete) |
| `run_scan.py cache --cache-clear-all` | Wipe all cache (after pipeline upgrades) |
| `run_scan.py cache --cache-diff-hash <hash>` | Remove one stale entry |

**Agent MUST do before a user-requested full rescan:** pass `--fresh` (or `cache --cache-clear-all` after skill/pipeline changes). Never assume a prior `report_scan.*` in `-o` is from the current pipeline run.

## Scan scope planning (full / incremental)

Before deterministic collect, `scope_planner.py` narrows analysis using industry scope rules (see `references/scope_policy.yaml`):

- **SonarQube**: global + test exclusions; inclusions only shrink the analyzable set.
- **Semgrep**: monorepo `--include` roots (`apps/`, `packages/`, …).
- **CodeQL**: `paths-ignore` for vendor/generated/tests/fixtures.
- **Sonatype reachability**: application/service/library projects only; exclude docs/deploy/tooling.
- **Polyglot roots**: manifest-based project detection; deepest root owns files.

```bash
python3 scripts/scope_planner.py --repo <repo> --print-summary
python3 scripts/scope_planner.py --repo <repo> -o /tmp/scope_plan.json
```

Override via `config/scan_config.yaml` → `scope_planning.manual_include` (e.g. `[apps/]`).

## SCA (OSV-first)

- **No Trivy / trivy-db.** SCA never downloads or requires a local vulnerability DB.
- Primary: `osv-scanner` CLI when installed (optional; brew/go).
- Always available: **OSV HTTP API** (`api.osv.dev`) for Maven `pom.xml` coordinates — no binary needed.
- Node fallback: `npm audit` when `package-lock.json` is present.
- Core install does **not** fail if `osv-scanner` is missing.


## Agent-inline scan SOP (default)

### 1) Deterministic prepare (handoff)

```bash
python3 scripts/run_scan.py incremental --repo <repo> --intent "<desc>" -o /tmp/aid_report
# full rescan / adhoc / retest after fixes — always add --fresh:
python3 scripts/run_scan.py adhoc --scan-mode incremental --files path/to/File.java --fresh -o /tmp/aid_report
# or: full | adhoc --scan-mode incremental|full ...
```

Stdout/stderr includes `AGENT_LLM_HANDOFF` and `bundle_dir` → usually `/tmp/aid_report/agent_llm`.
If you see `CACHE SKIP: agent-inline mode…` — proceed to Stage1 (expected). If you see `CACHE HIT` in agent mode, you passed `--use-cache` intentionally.
Read `agent_llm/MANIFEST.json` for paths. Do **not** invent findings before this step.

### 2) Stage1 (you)

1. Read `agent_llm/stage1_prompt.md` (or each `shards/<id>/stage1_prompt.md` for full).
2. Apply `prompts/` + injected policies; output **strict JSON** `{"findings":[...]}`.
3. Write `stage1.json` (per shard if full). Empty `findings` is OK.

### 3) Stage2 prepare + Stage2 (you)

```bash
python3 scripts/run_scan.py agent-stage2 --agent-dir /tmp/aid_report/agent_llm
```

1. Read `stage2_prompt.md` (per shard if full).
2. Write `llm_final.json` (incremental) or each `shards/<id>/stage2.json` (full) as
   `{"findings":[...]}` with optional `"dismissals":[{"file","line","reason"}]`.
   - **Ambiguous SAST residue:** demote by emitting a same-locus finding with the final
     severity (merge keeps LLM severity), or dismiss via `dismissals` /
     `"dismissed": true` / `"verdict":"dismiss"` (clear SAST cannot be dismissed).
3. Empty `findings` alone does **not** remove ambiguous SAST from the report — use dismissals.
### 4) Finalize + present

```bash
python3 scripts/run_scan.py finalize --agent-dir /tmp/aid_report/agent_llm -o /tmp/aid_report
```

Read `report_scan.json` / `.md` / `.html`; present to user (Deliverable). HTML is written automatically by `finalize` / `merge_report.py` from the Markdown body. Then Section D if user verdicts.

### Quick commands

```bash
python3 scripts/run_scan.py adhoc --scan-mode incremental --files a.py --fresh -o /tmp/aid_report
python3 scripts/run_scan.py adhoc --scan-mode incremental --paste-file /tmp/snip.py --lang python --fresh -o /tmp/aid_report
python3 scripts/run_scan.py choose --infer "帮我看看这段粘贴的代码有没有漏洞"
python3 scripts/run_scan.py cache list
python3 scripts/run_scan.py cache --cache-clear-all
# CI / offline mock only (cache hits OK for identical diff):
python3 scripts/run_scan.py incremental --repo . --dry-run -o /tmp/aid_report
```

## Section D — Verdicts

Only when the user explicitly accepts/dismisses/ignores:

```bash
python3 scripts/feedback.py record --title "<title>" --verdict accept|dismiss|ignore \
  --file "<path>" --category "<cat>" --rule-id "<RULE_ID>"
```

No verdict → do not invent one.

## LLM semantic policies

Canonical: `references/policies/manifest.yaml` (**v1.1.0**, 27 rules). There is no separate `AUTH-003`; auth-bypass paths are covered by `ARCH-001`.
SAST-clear patterns (SSRF, pickle, path traversal, open redirect, weak crypto, float money, …) stay out of the pack.

```bash
python3 scripts/audit_policy_fixtures.py
```

Add rule: new unused id YAML + manifest + bump version + audit. Details in policies dir.

## Hard rules

- **Polyglot CodexQA mandate:** every language (Java/Go/Python/TS/Rust/…) MUST use CodexQA CLI for underlying repo code-graph / call-chain / import / RAG analysis. Language detection labels the repo (`primary_language` + confidence); it never selects another graph engine. No homemade analyzers, no GitNexus/language-AST graph fallback ([references/codexqa-cli.md](references/codexqa-cli.md)).
- **Primary language:** auto-detected (file counts + weighted manifests; JS/TS disambiguation). Override when wrong: `config.primary_language`, `--language`, or `AID_PRIMARY_LANGUAGE`. Low confidence is warned on stderr.
- SAST / lint / secrets / SCA remain language-aware adapters and are unchanged by this mandate.
- SAST missing: repair → warn → continue.
- Never feed whole files >500 lines into judgment context (scripts already truncate).
- Never emit a finding without `file`, `line`, `evidence`, `severity`.
- Ask/choose when scenario unclear; do not autofix style.
- Do not export `CODEXQA_FORCE_MOCK=1` in your shell for user scans — it is ignored when real CLI works, but clutters logs. Mock is auto-selected only when CLI is missing.
- **Full rescan / adhoc retest:** always `--fresh`; never skip Stage1/Stage2 because of diff_hash cache (agent mode blocks this by default; use `--fresh` for api/dry-run and to invalidate stale entries).

## CI (advisory smoke)

Monorepo hygiene runs `npm test` (pipeline + policy fixtures). Live agent/API scans are **not** required. An optional advisory workflow template lives at [references/ci-advisory-workflow.yml](references/ci-advisory-workflow.yml) (`CODEXQA_FORCE_MOCK=1` + `--dry-run`); treat its artifacts as smoke only.

## Policy fixture check

```bash
python3 scripts/audit_policy_fixtures.py
```

## Optional external API LLM

See [references/llm-api.md](references/llm-api.md) (`--llm-mode api`).
