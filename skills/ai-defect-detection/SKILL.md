---
name: ai-defect-detection
description: Detects code defects from a test plan, git branch, or report. Use when the user asks for AI defect detection, code recheck, or suspected-defect review.
metadata: {"openclaw":{"requires":{"bins":["node","git"]}}}
---

# AI Defect Detection Skill

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

Load each Phase file **at most once** per task. Do not re-read `SKILL-PHASE1.md` / `SKILL-PHASE2.md` / `SKILL-POST.md` after the first load unless a gate cites a section you have not read. After `prep-and-plan` / `trivial-method-filter`, enter detection without reloading Phase 2. Do not open the Code PR page in a browser to learn source/target branch — use gitUrl+branch from the user, plan, or onesId; `clone-and-diff` computes the merge-base.

| File | Role |
|---|---|
| `SKILL.md` (this file) | routing, constraints, output |
| `operator-manual.md` | human/operator walkthrough |
| `SKILL-PHASE1.md` | preparation |
| `SKILL-PHASE2.md` | detection + validation |
| `SKILL-WRITEBACK.md` | write-back fields and bugStatus |
| `SKILL-POST.md` | user feedback |
| `references/` | detailed specs |
| `docs/platform-api.md` | HTTP contract for a remote detection platform |
| `docs/enterprise-http-api.md` | reserved HTTP slots for plan / cases / wiki / tickets / traces |
| `docs/adapters.md` | how to plug in another company |

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
| 1.1 Init | parse input → `submit-plan` / `submit-git` → taskId | taskId present |
| 1.2 Code | `clone-and-diff --with-plan` (clone + methods + plan + trivial filter) | clone registered |
| 1.3 Context | `get-tag-list` / `get-rules` / history / traces / plan defects | tags + rules |
| 1.4 Cases & docs | test-case provider + document provider | — |
| 1.5 Plan | `prep-and-plan --submit-trivial` if clone already ran without `--with-plan` | plan.json |
| 2.x Detect | AST + per-method analysis + `batch-update-process` + `finalize-rank` | open_validate.ts |
| 3.x Close | `check-coverage` → `check-rank-integrity` → `reconcile-report` → `complete-task` | exit 0 |
| 4 Feedback | confirm / reject / create issue | user |

CLI entry: `node {baseDir}/open_detect.ts --help`  
(`{baseDir}` is the installed skill folder. Equivalent: `$SKILL_DIR/open_detect.ts`.)

Local data: `{baseDir}/data/{taskId}/` (meta, static, context, test cases, plan, writebacks, findings). Each new detection gets a new `taskId` directory. Do not delete a previous `data/{taskId}` to start the next run; reuse a directory only when the user continues that same task.

### Install (folder or zip — not a JAR)

Unzip so that **`SKILL.md` sits in a folder named `ai-defect-detection`** (must match frontmatter `name`):

| Tool | Path |
|---|---|
| Cursor | `~/.cursor/skills/ai-defect-detection/` or project `.cursor/skills/ai-defect-detection/` |
| OpenClaw | `~/.openclaw/skills/ai-defect-detection/` or workspace `skills/ai-defect-detection/` |
| Claude Code / Codex / other Agent Skills hosts | `~/.agents/skills/ai-defect-detection/` · `~/.claude/skills/` · `~/.codex/skills/` |

Then: `node {baseDir}/open_detect.ts get-plan-info --plan-id 1001 --plan-type 2`

Pack: `bash pack-skill.sh` → `ai-defect-detection.zip`. Do not ship a `.jar`; hosts load a directory with `SKILL.md`, not a JVM archive.

---

## Enterprise adapters (no vendor lock-in)

Default **local** providers store everything under `data/platform/` and `enterprise/`. Switch backends in `config.yaml` or env vars:

| Concern | Local (default) | Remote |
|---|---|---|
| Auth | none | bearer / api_key (`DETECTION_TOKEN`) |
| Detection platform | JSON store | HTTP (`docs/platform-api.md`) |
| Test / delivery plan | `enterprise/plans/{id}.json` (missing: degrade, do not exit) | HTTP slot `GET /v1/plans/{plan_id}` |
| Test cases | `enterprise/test-cases/` or chat `add-test-case` | HTTP slots `/v1/test-cases` |
| Issues | local JSON or GitHub Issues | HTTP slots `/v1/issues` |
| Documents | local files or public URL | HTTP slot `GET /v1/documents/{doc_id}` |
| Traces | optional JSON | HTTP slot `GET /v1/plans/{plan_id}/traces` |

Enterprise HTTP slots (plan / testcase / issues / docs / traces) are defined in `providers/http_slots.ts` and documented in `docs/enterprise-http-api.md`. Set `kind: http` plus `base_url`, or one shared `enterprise_http_base_url`. Remap a company path with `options.paths` — no TypeScript change.

```bash
export DETECTION_CONFIG=/path/to/config.yaml
# or
export DETECTION_PLATFORM_KIND=http
export DETECTION_PLATFORM_BASE_URL=https://quality.example.com
export DETECTION_TOKEN=...
```

## Call-graph analysis (Java, default)

After clone (Java repos), **detect GitNexus**. If it is not installed, **run one forced install**, then continue analysis. Only if that install fails (and a single `--force-install` retry still fails) fall back to grep / find.

```bash
node {baseDir}/open_detect.ts ensure-gitnexus --task-id $TASK_ID --local-dir "$LOCAL_DIR"
# clone-and-diff already calls this for non-JS/TS services. Do not run it again
# unless the clone return has gitnexus.ready=false. Reused clones skip analyze
# when the graph stamp matches HEAD.
```

Install used: `npm install -g gitnexus@latest` (or `pnpm add -g` if npm is missing). Needs Node.js ≥ 18.

Phase 2 STEP B queries the graph when `gitnexus.ready=true`:

1. Host MCP (`impact` / `context`) if the tool list actually has a GitNexus namespace.
2. Otherwise CLI (do **not** skip to grep while ready=true):

```bash
node {baseDir}/open_detect.ts gitnexus-impact --task-id $TASK_ID --target Class#method --direction upstream
node {baseDir}/open_detect.ts gitnexus-context --task-id $TASK_ID --name Class#method --content
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
- Batch write-backs go through `batch-update-process`. `open_validate.ts` is authoritative.

`complete-task` does not lock the task. Append or correct on the same taskId. Use `retry` only when the whole task must be discarded (wrong repo/branch).

---

## Output

Three user-facing moments: start card → milestone cards → final summary.

Final summary must include a report link:

`> View full report: [Open]({reportUrl})`

`reportUrl` comes from the platform provider (local HTML `file://.../reports/{taskId}.html` by default, or your configured `report_base_url`). If the chat link does not open, open that HTML file in a browser.

Do not use Markdown tables in the summary. Split **this change** vs **legacy** risk.

Definition of done: coverage/rank gates + `complete-task` + `reconcile-report` exit 0 + complete summary with report link.

---

## Errors

- Network / auth: retry; refresh token via the auth provider.
- Format errors: `open_validate.ts` auto-fixes deterministic issues.
- Quality errors: re-analyze, do not tweak wording to pass.
- Clone failure: skip that service, continue others.
- Missing `enterprise/plans/{id}.json` (or empty HTTP plan): `get-plan-info` returns `degraded=true`. Use chat materials (`--git`, `--user-materials-json`, `add-test-case`, `add-document`). Do not stop.

See `references/rules/error-handling.md`.
