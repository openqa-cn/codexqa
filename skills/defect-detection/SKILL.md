---
name: defect-detection
description: >-
  Reviews code changes for defects before release. Given a git repository and
  branch (optionally a PR, test plan, or a previous report to continue), it
  clones the repo, diffs the base branch, extracts changed methods, runs static
  rules, cross-checks requirements, test cases, and known defects, and writes
  back findings with line numbers, fix suggestions, and an HTML report.
  Language-aware for Java, Kotlin, Scala, JavaScript, TypeScript, Python, Go,
  C, C++ and C#: method extraction, trivial-method filter, Semgrep seed packs,
  and write-back conventions; polyglot diffs keep each language's rules.
  Optional overlays add secret / SCA / native-analyzer findings.
  Use when the user asks to find bugs in a branch or PR, review change or
  regression risk, recheck before release, scan a test plan, or resume a
  detection task. Not a P0/P1/P2 style CR (that is code-reviewer).
license: Apache-2.0
compatibility: >-
  Requires Node.js 22+ and git on PATH. Clones repos under the skill data dir
  (`<data dir>/repos`, override with DETECTION_CLONE_DIR). For non-JS/TS repos it
  may run `npm install -g gitnexus` once (call-graph analysis); set
  DETECTION_SKIP_GITNEXUS=1 to opt out. Semgrep (1.x recommended) optional for
  AST seed rules; gitleaks / trivy / bandit / ruff / gosec / cppcheck / eslint optional overlays.
metadata: {"openclaw":{"requires":{"bins":["node","git"]}}}
---

# Defect Detection

Agent-driven, method-by-method inspection. Tools gather context; rules, history, and evidence produce findings; users confirm or reject them.

**Purpose:** find real quality issues. Do not skip methods, skip steps, or soften a real defect.

**Write-back rule:** a real defect is written as bugStatus=6 (suspected) or 7 (improvement), whether or not it sits inside the current diff.

---

## Execution mode: light vs strict

`build-detection-plan` sets the mode from total changed lines (additions + deletions):

| | light | strict (default) |
|---|---|---|
| Trigger | 1–199 changed lines | ≥ 200 changed lines |
| Content fields | at least 1 | at least 3 |
| Business-impact / reproduce path | optional | required |
| contextReads | ≥ 1 file | ≥ 2 files |
| AST scan | changed files only | **PR/diff default: changed files** (`--task-id` / `--changed-only`). Whole-repo is opt-in (`--full-repo`). Out-of-diff hits are T0 / auto-dismiss — do not verify one by one. |

API required fields stay the same in both modes: thinking, processSteps, fileCodes, content (line numbers + prefix), tagId.

---

## Documents (load on demand)

Load each Phase file **at most once** per task. Do not re-read `references/phase1-preparation.md` / `references/phase2-detection.md` / `references/phase3-close.md` / `references/feedback.md` after the first load unless a gate cites a section you have not read. After `prep-and-plan` / `trivial-method-filter`, enter detection without reloading Phase 2. Do not open the Code PR page in a browser to learn source/target branch — use gitUrl+branch from the user, plan, or work-item ticket; `clone-and-diff` computes the merge-base.

| File | Load when |
|---|---|
| `SKILL.md` (this file) | always: routing, constraints, output |
| `references/phase1-preparation.md` | task starts (input → taskId → clone → plan) |
| `references/writeback.md` | before the first write-back (fields, bugStatus, content format) |
| `references/phase2-detection.md` | entering detection (AST + overlays + per-method analysis + gates) |
| `references/rules/<lang>-gotchas.md` | before STEP C, one per language listed in `gotchasDocs` (returned by `clone-and-diff` / `build-detection-plan`); `references/rules/language-mapping.md` is the index |
| `references/analysis/path-feasibility.md` | before writing a strategy=11 bugStatus=6/7 (the `[Feasibility]` marker) |
| `references/phase3-close.md` | all methods written back; closing (coverage, rank, report, summary) |
| `references/feedback.md` | user confirms / rejects / asks to recheck after the summary |
| `references/analysis/`, `output/`, `rules/`, `writeback/` | detailed specs, cited from the phase files when a gate needs them |
| `references/api/*.md` | wiring a remote platform or enterprise HTTP slots |
| `references/operator-manual.md` | human walkthrough; not needed by the agent |
| `README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md` | human-facing: usage, detection method, and known gaps; not needed by the agent |

All runtime code lives in `scripts/` (`scripts/detect.ts` is the CLI; `scripts/validate.ts` is the write-back validator).

---

## Trigger routes

| Scenario | Path | Input |
|---|---|---|
| Test plan | Phase 1 → planId → taskId → Phase 2 | planId |
| Delivery / release plan | Phase 1 → deliveryId → taskId → Phase 2 | deliveryId |
| Existing report | reuse taskId → Phase 2/3 | taskId |
| Git repo + branch | clone + diff → taskId → Phase 2 | gitUrl + branch |
| Multiple services | each repo independently, then merge | multiple gitUrl |
| Recheck same task | reuse taskId, overwrite | taskId |
| Append after complete | update-process + finalize-rank | taskId |
| Code snippet | clone / single-file diff → Phase 2 | source |

---

## Flow

| Step | Actions | Gate |
|---|---|---|
| 1.1 Init | parse input → `submit-plan` / `submit-git` (auto init-content + service) → taskId | taskId present |
| 1.2 Code | `clone-and-diff --with-plan` (clone + methods + plan + trivial filter) | clone registered |
| 1.3 Context | `get-tag-list` / `get-rules` / history / traces / plan defects | tags + rules |
| 1.4 Cases & docs | test-case provider + document provider | — |
| 1.5 Plan | `prep-and-plan --submit-trivial` if clone already ran without `--with-plan` | plan.json |
| 2.x Detect | AST + per-method analysis + `batch-update-process` + `finalize-rank` | scripts/validate.ts |
| 3.x Close | `check-coverage` → `check-rank-integrity` → `reconcile-report` → `complete-task --summary` (or `finalize-all`) | exit 0 |
| 4 Feedback | confirm / reject / create issue | user |

CLI entry: `node {baseDir}/scripts/detect.ts --help`  
(`{baseDir}` is the installed skill folder. Equivalent: `$SKILL_DIR/scripts/detect.ts`.)

Local data: `{baseDir}/data/{taskId}/` (meta, static, context, test cases, plan, writebacks, findings). Each new detection gets a new `taskId` directory. Do not delete a previous `data/{taskId}` to start the next run; reuse a directory only when the user continues that same task.

### Install (folder or zip — not a JAR)

Unzip so that **`SKILL.md` sits in a folder named `defect-detection`** (must match frontmatter `name`):

| Tool | Path |
|---|---|
| Cursor | `~/.cursor/skills/defect-detection/` or project `.cursor/skills/defect-detection/` |
| OpenClaw | `~/.openclaw/skills/defect-detection/` or workspace `skills/defect-detection/` |
| Claude Code / Codex / other Agent Skills hosts | `~/.agents/skills/defect-detection/` · `~/.claude/skills/` · `~/.codex/skills/` |

Then: `node {baseDir}/scripts/detect.ts get-plan-info --plan-id 1001 --plan-type 2`

Pack: `bash pack-skill.sh` → `defect-detection.zip`. Do not ship a `.jar`; hosts load a directory with `SKILL.md`, not a JVM archive.

---

## Enterprise adapters (no vendor lock-in)

Default **local** providers store everything under `data/platform/` and `enterprise/`. Switch backends in `config.yaml` or env vars:

| Concern | Local (default) | Remote |
|---|---|---|
| Auth | none | bearer / api_key (`DETECTION_TOKEN`) |
| Detection platform | JSON store | HTTP (`references/api/platform-api.md`) |
| Test / delivery plan | `enterprise/plans/{id}.json` (missing: degrade, do not exit) | HTTP slot `GET /v1/plans/{plan_id}` |
| Test cases | `enterprise/test-cases/` or chat `add-test-case` | HTTP slots `/v1/test-cases` |
| Issues | local JSON or GitHub Issues | HTTP slots `/v1/issues` |
| Documents | local files or public URL | HTTP slot `GET /v1/documents/{doc_id}` |
| Traces | optional JSON | HTTP slot `GET /v1/plans/{plan_id}/traces` |

Enterprise HTTP slots (plan / testcase / issues / docs / traces) are defined in `scripts/providers/http_slots.ts` and documented in `references/api/enterprise-http-api.md`. Set `kind: http` plus `base_url`, or one shared `enterprise_http_base_url`. Remap a company path with `options.paths` — no TypeScript change.

```bash
export DETECTION_CONFIG=/path/to/config.yaml
# or
export DETECTION_PLATFORM_KIND=http
export DETECTION_PLATFORM_BASE_URL=https://quality.example.com
export DETECTION_TOKEN=...
```

## Call-graph analysis (JVM / Go / Python / C# services, default)

After clone (every non-JS/TS-client repo), **detect GitNexus**. If it is not installed, **run one forced install**, then continue analysis. Only if that install fails (and a single `--force-install` retry still fails) fall back to grep / find.

```bash
node {baseDir}/scripts/detect.ts ensure-gitnexus --task-id $TASK_ID --local-dir "$LOCAL_DIR"
# clone-and-diff already calls this for non-JS/TS services. Do not run it again
# unless the clone return has gitnexus.ready=false. Reused clones skip analyze
# when the graph stamp matches HEAD.
```

Install used: `npm install -g gitnexus@latest` (or `pnpm add -g` if npm is missing). Needs Node.js ≥ 18.

Phase 2 STEP B queries the graph when `gitnexus.ready=true`:

1. Host MCP (`impact` / `context`) if the tool list actually has a GitNexus namespace.
2. Otherwise CLI (do **not** skip to grep while ready=true):

```bash
node {baseDir}/scripts/detect.ts gitnexus-impact --task-id $TASK_ID --target Class#method --direction upstream
node {baseDir}/scripts/detect.ts gitnexus-context --task-id $TASK_ID --name Class#method --content
```

Empty `~/.cursor/mcp.json` means MCP is not configured. Optional: `gitnexus setup` to register it. `ready=false` → grep / find. Do not block the task. GitNexus is local; it does not talk to a company platform.

---

## bugStatus

0 initial / 2 no defect / 6 suspected / 7 improvement / 3 confirmed fix / 4 invalid / 5 later / 8 duplicate.

AI outputs 6 or 7. Users turn those into 3 / 4 / 5 / 8.

---

## Constraints (short)

- Mission over ceremony: find defects, then self-check before closing.
- No leak: do not show internal field names, commands, or retry noise to the user.
- Write-back only after clone + code-read registration.
- tagId must come from `get-tag-list`. AST hits must carry ruleId.
- Rank is dual-write: `finalize-rank` to the platform **and** `record-rank` locally.
- Defect content starts with `Defect:` or `Improvement:`, includes `Lines:X-Y`, and a fix/optimize section with a code block.
- Batch write-backs go through `batch-update-process`. `scripts/validate.ts` is authoritative.

`complete-task` does not lock the task. Append or correct on the same taskId. Use `retry` only when the whole task must be discarded (wrong repo/branch).

---

## Output

Three user-facing moments: start card → milestone cards → final summary.

Final summary must include a report link:

`> View full report: [Open]({reportUrl})`

`reportUrl` comes from the platform provider (local HTML `file://.../reports/{taskId}.html` by default, or your configured `report_base_url`). If the chat link does not open, open that HTML file in a browser.

The `complete-task --summary` text is flat plain text (`references/output/summary-spec.md`): no Markdown tables, because it is stored and rendered by the platform as-is. The chat reply may use tables. In both, split **this change** vs **legacy** risk.

Definition of done: coverage/rank gates + `complete-task` + `reconcile-report` exit 0 + complete summary with report link.

---

## Errors

- Network / auth: retry; refresh token via the auth provider.
- Format errors: `scripts/validate.ts` auto-fixes deterministic issues.
- Quality errors: re-analyze, do not tweak wording to pass.
- Clone failure: skip that service, continue others.
- Missing `enterprise/plans/{id}.json` (or empty HTTP plan): `get-plan-info` returns `degraded=true`. Use chat materials (`--git`, `--user-materials-json`, `add-test-case`, `add-document`). Do not stop.

See `references/rules/error-handling.md`.
