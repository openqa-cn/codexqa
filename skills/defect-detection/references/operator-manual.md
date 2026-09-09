# AI Defect Detection Skill — Operator Manual

This document is for operators, integrators, and Agents: how to install, configure, trigger a detection, add materials, write back conclusions, confirm false positives, and how to replace local `enterprise/` with a company HTTP system.

Skill directory (below as `$SKILL_DIR` / `{baseDir}`):

```text
# In-repo development directory
.../scripts/defect-detection/
# After install into a tool it must be named defect-detection (matches SKILL.md name)
~/.cursor/skills/defect-detection/
```

**Distribution format is zip / directory. Do not pack a jar.** Cursor, OpenClaw, Claude Code, and similar hosts load Agent Skills: after unzip, the top level must be `defect-detection/SKILL.md`.

```bash
cd "$SKILL_DIR"
bash pack-skill.sh            # produces defect-detection.zip
# Cursor
unzip defect-detection.zip -d ~/.cursor/skills/
# OpenClaw
unzip defect-detection.zip -d ~/.openclaw/skills/
# Or inside a project
unzip defect-detection.zip -d .cursor/skills/
```

CLI entry:

```bash
export SKILL_SCRIPT="$SKILL_DIR/scripts/detect.ts"   # after install this is {baseDir}/scripts/detect.ts
node "$SKILL_SCRIPT" --help
```

Agent execution details are still authoritative in `SKILL.md` / `references/phase1-preparation.md` / `references/phase2-detection.md` / `references/writeback.md` / `references/feedback.md`. This manual is "how a person uses it and which commands to type".

---

## Contents

- [1. What it does](#1-what-it-does)
- [2. Environment requirements](#2-environment-requirements)
- [3. First landing (local)](#3-first-landing-local)
- [4. Directories and data landing](#4-directories-and-data-landing)
- [5. Core scenarios and material dependencies](#5-core-scenarios-and-material-dependencies)
- [6. Recommended operating flow](#6-recommended-operating-flow)
- [7. Daily queries](#7-daily-queries)
- [8. Connect company systems (HTTP slots)](#8-connect-company-systems-http-slots)
- [9. Prepare your own enterprise seeds](#9-prepare-your-own-enterprise-seeds)
- [10. FAQ](#10-faq)
- [11. Command cheat sheet](#11-command-cheat-sheet)
- [12. Related documents](#12-related-documents)
- [13. Minimum runnable checklist (local sample)](#13-minimum-runnable-checklist-local-sample)

---

## 1. What it does

Defect detection by **changed method**: pull a plan or Git branch → clone and compute a diff → apply rules / cases / docs / historical defects → write suspected defects or Improvements → the user confirms or rejects.

Default **local mode**: no company intranet required. Tasks, tags, and rules live under `data/`. Plans / cases / docs / tickets / traces are read from `enterprise/`. Missing files do not stop the run; they degrade to materials provided in chat.

| Role | Duty |
|---|---|
| Operator | Give a plan ID, Git URL, docs or cases; read the report; confirm / reject defects |
| Agent | Run the CLI by Phase, analyze code, write back conclusions |
| Integrator | Change `kind: local` to `kind: http` and connect company systems |

---

## 2. Environment requirements

| Item | Requirement |
|---|---|
| Node.js | 22+ (`node` on `PATH`; skill entry is `scripts/detect.ts`) |
| Git | On `PATH`, able to clone the repo under analysis |
| Permission | Read access to the target repo (SSH or HTTPS) |
| GitNexus | Default path for Java call graphs. If not installed, force `npm i -g gitnexus` once; only then degrade to grep |
| Network | Needed only for HTTP / GitHub providers |
| Python | Optional — only used if Semgrep auto-installs via `pip` on first `run-ast-scan` |

Self-check:

```bash
cd "$SKILL_DIR"
node --test tests/*.test.ts
```

---

## 3. First landing (local)

```bash
cd "$SKILL_DIR"
cp config.example.yaml config.yaml
```

The repo already ships sample data you can try immediately:

| Sample | Path | Meaning |
|---|---|---|
| Plan 1001 | `enterprise/plans/1001.json` | Order checkout validation |
| Already-filed tickets | `enterprise/plans/1001.defects.json` | Defects already filed under that plan |
| Case TC-1001 | `enterprise/test-cases/index.json` | Reject negative amounts |
| Requirement doc | `enterprise/docs/checkout-rules.md` | Must contain "greater than zero" |
| Tech doc | `enterprise/docs/checkout-api.md` | API contract |
| Ticket 42 | `enterprise/issues/42.json` | Requirement ticket |

```bash
node "$SKILL_SCRIPT" get-plan-info --plan-id 1001 --plan-type 2
node "$SKILL_SCRIPT" get-tag-list
node "$SKILL_SCRIPT" get-rules --git git@github.com:acme/order-service.git --user-id alice
```

On success, `get-plan-info` JSON includes `code=0`, `source=provider`, `data.services` / `testCaseIds` / `requirementDocs`.

---

## 4. Directories and data landing

```text
$SKILL_DIR/
  SKILL.md                    # agent entry
  scripts/
    detect.ts                 # CLI entry
    providers/                # local / http / github adapters
  references/
    phase1-preparation.md … phase3-close.md, writeback.md, feedback.md
    api/                      # HTTP contracts
  config.yaml                 # runtime config (copied from example)
  enterprise/                 # enterprise-side seeds (plans/cases/docs/tickets/traces)
  data/
    platform/                 # local detection platform (tasks, process, rank, tags, rules)
    <taskId>/                 # working copy for one task (each new detection uses a new directory; does not overwrite the previous run)
      meta.json
      static.json
      context.json
      test_cases.json
      plan.json
      writebacks.json
      findings.json
```

Environment variables (common):

| Variable | Role |
|---|---|
| `DETECTION_CONFIG` | Path to `config.yaml` |
| `DETECTION_DATA_DIR` | Platform JSON root (default `$SKILL_DIR/data`) |
| `DETECTION_ENTERPRISE_DIR` | `enterprise/` root |
| `CONTENT_JSON_BASE` | Task content-store root (default `$SKILL_DIR/data`) |
| `DETECTION_CLONE_DIR` | Root for git clones made by `clone-and-diff` (default `<data dir>/repos`); `cleanup-stale-data` ages clones out with the same threshold |
| `DETECTION_USER` | Default operator |
| `DETECTION_TOKEN` / `DETECTION_API_KEY` | Remote auth |
| `DETECTION_SKIP_GITNEXUS` | `1` disables the one-time global `npm install -g gitnexus`; call-graph falls back to grep/find |

Chat writes (`add-test-case` / `add-document`) go only into `data/<taskId>/` and do not change `enterprise/`. `add-test-case` upserts by `id`: calling it again for the same case merges the new fields (e.g. semantic-compilation results) into the existing record.

In local mode the platform has no diff engine of its own, so `build-detection-plan` (also run by `clone-and-diff --with-plan`) seeds one pending process per plan item on the local platform (`seededFrom: "detection-plan"`). After that `get-pending` lists the planned methods and `check-coverage` counts them as missed until they are written back — the same shape a remote platform gives you. Providers that own their pending list (HTTP) skip the seeding and plan items keep `processId: null` until the first write-back.

Layout of the data dir: `<taskId>/` (content store per task), `platform/` (local platform provider: tasks, batches, ranks, reports), `issues/` (runtime issue store from `mark-bug` / `create-issue`), `repos/` (git clones), `_tmp/` (scratch). `cleanup-stale-data` never deletes `platform/` or `issues/`; it removes stale `<taskId>/` and `repos/*` entries older than `--max-age-hours` and wipes `_tmp/`.

A new detection allocates an unoccupied taskId. The previous `data/<taskId>/` is kept by default. Do not wipe an old directory just to start a new task; reuse only when the user explicitly continues the same task.

---

## 5. Core scenarios and material dependencies

These materials have **no** hard chain such as "you must have a test plan before you can give Git". They are independent: use what you can get; if you cannot, ask the user or degrade.

**The only hard gate: clonable code (Git URL + branch).** Without a repo there is no diff and detection cannot start. Requirements, tech design, cases, historical defects, and a test plan are not start preconditions.

### 5.0 Material dependencies (required / recommended / optional)

| Material | Level | Depend on each other? | What the skill does if missing |
|---|---|---|---|
| Git repo + branch (can be multi-repo) | **Blocking** | No. A repo is enough to run; a plan is not required first | Ask the user verbatim for git + branch; do not clone until complete |
| Test plan / delivery plan | Optional | No. Only an entry to pull services/cases/already-filed tickets | Without a plan, take `submit-git` |
| Requirements / PRD | Recommended | No. Does not depend on a plan or tech design | Ask once; if the user says "skip", continue and infer business rules from code |
| Tech design / API docs | Recommended | No. After clone it also scans in-repo `docs/` | Ask once; you can also `scan-repo-docs` |
| Test cases | Recommended | No. Does not depend on a plan (can be pasted in chat) | Ask once; if none, `HAS_CASES=false` |
| Historically confirmed defects / already-filed tickets on this plan | Optional | No. Used for cross-check | Do not chase; skip if the pull is empty |
| Exception traces | Optional | No | Do not chase |

At runtime, inventory with the command below and **send `askUser[].prompt` to the user verbatim** (do not dump internal command names):

```bash
node "$SKILL_SCRIPT" check-materials --plan-id "$TEST_PLAN_ID" --task-id "$TASK_ID"
# When you already have a repo:
node "$SKILL_SCRIPT" check-materials --git "$GIT_URL" --branch "$BRANCH" --task-id "$TASK_ID"
```

| Return field | Meaning |
|---|---|
| `canStart` | `false`: still missing git+branch; wait for the user first |
| `blocking` | Hard gate, usually `services` |
| `recommended` | `requirementDocs` / `technicalDocs` / `testCases` |
| `optionalMissing` | Historical defects, traces, plans, etc.; no need to chase |
| `askUser[].prompt` | Verbatim prompt to send to the user |
| `source` | `provider` / `content_store` / `user_input` / `empty` |

`get-plan-info` JSON carries the same fields. `degraded=true` is not a failure.

After the user supplies materials, write them into the task (once you have a `taskId`):

```bash
node "$SKILL_SCRIPT" add-test-case --task-id "$TASK_ID" --case-json '{
  "id": "TC-1", "title": "Reject 0-amount checkout",
  "preCondition": "Logged in", "steps": "Set amount to 0 and submit",
  "expectedResult": "Return 400, do not place the order"
}'
node "$SKILL_SCRIPT" add-document --task-id "$TASK_ID" --doc-type prdDocs --doc-json '{
  "title": "checkout-rules", "content": "amount must be greater than zero",
  "fetchStatus": "success", "fetchMethod": "user_input"
}'
```

`--doc-type` can only be `prdDocs` (requirement) or `techDocs` (tech design). In-repo docs: `scan-repo-docs --task-id $TASK_ID`.

---

### 5.1 Trigger from a test plan

The user gave a test-plan ID or link (`planType=2`).

```bash
node "$SKILL_SCRIPT" get-plan-info --plan-id 1001 --plan-type 2
node "$SKILL_SCRIPT" check-materials --plan-id 1001 --plan-type 2
node "$SKILL_SCRIPT" submit-plan --plan-id 1001 --plan-type 2 --submit-user alice
# Or one-shot: submit + init content + pull tags/rules
node "$SKILL_SCRIPT" phase1-init --plan-id 1001 --plan-type 2 --submit-user alice
```

If the plan file has `services`, clone directly. If there is only a plan number and neither local nor HTTP has the plan: `degraded=true`; per 5.0 ask the user for git (and recommended requirements/cases).

---

### 5.2 Trigger from a delivery / release plan

The user gave a delivery plan, iteration, or release ticket (`planType=4`). Same flow as 5.1; only the type changes:

```bash
node "$SKILL_SCRIPT" get-plan-info --plan-id "$DELIVERY_ID" --plan-type 4
node "$SKILL_SCRIPT" submit-plan --plan-id "$DELIVERY_ID" --plan-type 4 --submit-user alice
```

---

### 5.3 Only Git repo + branch (no plan)

The most common "scan this branch for me". You **do not need** a test plan, requirements, or cases to start.

```bash
node "$SKILL_SCRIPT" submit-git \
  --git git@github.com:acme/order-service.git \
  --branch feature/checkout-guard \
  --submit-user alice
```

`submit-git` also initializes the content store and registers the service (same as the content half of `phase1-init`), so `check-phase2-readiness` does not fail with an empty services list.

This **registers** the task; it does not start a scan. There is no background worker: the task sits at `in_progress` until the agent runs clone → plan → analysis → `complete-task` (or `force-abort-task` to give up). A remote prefix on `--branch` / `--contrast-branch` is stripped, so `origin/feature/checkout-guard` and `feature/checkout-guard` mean the same thing.

After submit, still recommended: `check-materials --git ... --branch ... --task-id $TASK_ID` — take requirements/cases if present; if the user says there are none, continue.

---

### 5.4 Multi-service / multi-repo

Each repo is cloned + detected independently, then aggregated by task. A master plan is not required first.

```bash
node "$SKILL_SCRIPT" submit-plan --plan-id 1001 --plan-type 2 --submit-user alice \
  --services-json '[
    {"git":"git@github.com:acme/order-service.git","branch":"feature/a","language":"java"},
    {"git":"git@github.com:acme/order-api.git","branch":"feature/a","language":"java"}
  ]'
# Without a plan use submit-skill-direct --services-json '...'
```

If one repo has no permission: `skip-service-batch`; the rest continue.

---

### 5.5 Existing report / continue or append on the same taskId

The user gave a report link or "continue last time". **Reuse the taskId**; do not create a new task (when code and requirements have not changed).

```bash
node "$SKILL_SCRIPT" status --task-id "$TASK_ID"
node "$SKILL_SCRIPT" check-phase2-readiness --task-id "$TASK_ID"
# After supplementing conclusions
node "$SKILL_SCRIPT" finalize-all --task-id "$TASK_ID"
```

---

### 5.6 Requirement or code already changed: invalidate and retest

The user says "the requirement changed / the branch was resubmitted". Old conclusions are invalid; `retry` produces a new task:

```bash
node "$SKILL_SCRIPT" retry --task-id "$TASK_ID" --submit-user alice
```

If preconditions did not change and they just think something was missed: overlay write-back on the same taskId; do not `retry`.

---

### 5.7 Only a plan number, no enterprise / HTTP plan

`get-plan-info` still exits 0. Ask the user for materials per `askUser`. Do not stop after reporting "plan does not exist".

```bash
node "$SKILL_SCRIPT" get-plan-info --plan-id 999 --plan-type 2
# The user already gave a repo or pasted cases in chat:
node "$SKILL_SCRIPT" get-plan-info --plan-id 999 --plan-type 2 \
  --git git@github.com:acme/order-service.git --branch feature/demo \
  --user-materials-json '{"testCases":[{"id":"TC-1","title":"Reject 0 amount","steps":"Pay 0"}]}'
```

---

### 5.8 The user only pasted requirements / cases / a snippet, no plan

1. First ask for **git + branch** (hard gate). If there is only a snippet and no repo: ask whether they can give a repo, or save the snippet as a single file and then `submit-git`.
2. `add-document` / `add-test-case` the pasted requirements/cases.
3. Start with `submit-git`. You do not need to invent a fake test plan.

---

### 5.9 When the Agent must ask the user

| Moment | What to ask | If the user replies "none" |
|---|---|---|
| `blocking` is non-empty | Only git + branch (can be multi-repo) | **Cannot start**; explain there is no code entry so detection cannot run |
| `recommended` is non-empty | Ask once each for requirements, tech design, cases | Continue, and explain possible missed detection |
| Only `optionalMissing` | Do not ask | Go straight to clone / detection |

When asking, use the `askUser[].prompt` text. Do not mention `enterprise/`, providers, or the command line.

---


## 6. Recommended operating flow

Replace `$TASK_ID`, `$BATCH_ID`, `$GIT_URL`, `$BRANCH`, `$USER_ID` with real values.

### Phase 1 — Prepare

```bash
# 1) Submit the task (pick one)
node "$SKILL_SCRIPT" submit-plan --plan-id 1001 --plan-type 2 --submit-user "$USER_ID"
# or
node "$SKILL_SCRIPT" submit-git --git "$GIT_URL" --branch "$BRANCH" --submit-user "$USER_ID"

# 2) Clone + diff (will register-repo-clone)
node "$SKILL_SCRIPT" clone-and-diff \
  --task-id "$TASK_ID" --batch-id "$BATCH_ID" \
  --git-url "$GIT_URL" --branch "$BRANCH" \
  --with-plan --submit-trivial

# Java repo: clone-and-diff automatically ensure-gitnexus; you can also run it alone
node "$SKILL_SCRIPT" ensure-gitnexus --task-id "$TASK_ID" --local-dir "$LOCAL_DIR"

# 3) Tags / rules / history / traces / already-filed tickets (can be parallel)
node "$SKILL_SCRIPT" phase1-fetch-all \
  --task-id "$TASK_ID" --git-url "$GIT_URL" --user-id "$USER_ID" --plan-id 1001
# or split:
node "$SKILL_SCRIPT" get-tag-list
node "$SKILL_SCRIPT" get-rules --git "$GIT_URL" --user-id "$USER_ID"
node "$SKILL_SCRIPT" get-confirmed-defect-history --git "$GIT_URL"
node "$SKILL_SCRIPT" get-delivery-defects --plan-id 1001 --plan-type 2 --task-id "$TASK_ID"
node "$SKILL_SCRIPT" get-exception-traces --plan-id 1001 --plan-type 2 --task-id "$TASK_ID"

# 4) Cases (if the plan has no IDs and the user pasted none, mark HAS_CASES=false and continue)
node "$SKILL_SCRIPT" fetch-test-cases --task-id "$TASK_ID" --plan-id 1001

# 5) Changed methods + detection plan + trivial write-back (one command)
node "$SKILL_SCRIPT" prep-and-plan --task-id "$TASK_ID" --submit-trivial
# or, if clone-and-diff already ran with --with-plan --submit-trivial, skip this step

# 6) Self-check before entering Phase 2
node "$SKILL_SCRIPT" check-phase2-readiness --task-id "$TASK_ID"
node "$SKILL_SCRIPT" content-summary --task-id "$TASK_ID"
```

`build-detection-plan` picks the mode from **changed line count**: 1–199 lines light, ≥200 lines strict.

### Phase 2 — Detection and write-back

1. `get-pending --batch-id $BATCH_ID` to claim pending methods.
2. Immediately `register-code-read` after reading source (register one as you finish one).
3. `run-ast-scan` for static rules; hits must carry `ruleId`.
4. Analyze by method; `tagId` must come from `get-tag-list`.
5. Batch write-back: `batch-update-process` (do not `update-process` one by one unless appending).
6. After aggregating each method, `finalize-rank`, and also `record-rank` locally.

Write-back body conventions:

- A defect starts with `Defect:`; an improvement starts with `Improvement:`
- Must have `Lines:X-Y`
- Must have a fix / improvement code block
- AI only writes `bugStatus=6` (suspected) or `7` (improvement); `2` means that method has no defect

`scripts/validate.ts` is the format authority: when it reports a format error, fix per it. Do not tweak wording to cheat the quality gate.

### Phase 3 — Close

```bash
node "$SKILL_SCRIPT" check-coverage --batch-id "$BATCH_ID"
node "$SKILL_SCRIPT" check-rank-integrity --batch-id "$BATCH_ID"
node "$SKILL_SCRIPT" reconcile-report --task-id "$TASK_ID"
# --summary is required: flat plain text in the references/output/summary-spec.md format
# (no Markdown tables). Put the text in a file to avoid shell-quoting issues.
node "$SKILL_SCRIPT" complete-task --task-id "$TASK_ID" --batch-ids "$BATCH_ID" --summary-file summary.txt
# Or finish Phase 3 in one command (uses pending_cache, or the task's batchIds when the cache is empty):
node "$SKILL_SCRIPT" finalize-all --task-id "$TASK_ID" --summary-file summary.txt
```

`reconcile-report` / `complete-task` must exit 0 to count as complete. The user summary must include a report link:

```text
> View full report: [Open]({reportUrl})
```

Locally it defaults to openable HTML: `data/platform/reports/{taskId}.html` (`file://` link). Chat links sometimes do not open; open the file in the system browser. Remote platforms can set `report_base_url` in `config.yaml`.

`complete-task` **does not lock the task**. You can keep appending on the same `taskId`. Use `retry` only when the repo / branch is wrong (it invalidates and starts over).

### Phase 4 — User confirmation

When the user says "item 2", use `get-findings --task-id $TASK_ID` to map summary order to the internal `rankId`. **Do not read rankId aloud to the user**.

```bash
node "$SKILL_SCRIPT" mark-bug --rank-id "$RANK_ID" --bug-status 3 --task-id "$TASK_ID"   # confirm; real defect
node "$SKILL_SCRIPT" mark-bug --rank-id "$RANK_ID" --bug-status 4 --extra "attribution notes"     # false positive
node "$SKILL_SCRIPT" mark-bug --rank-id "$RANK_ID" --bug-status 5                       # later
node "$SKILL_SCRIPT" mark-bug --rank-id "$RANK_ID" --bug-status 8                       # duplicates another
node "$SKILL_SCRIPT" create-issue --plan-id 1001 --title "..." --description "..."
```

| bugStatus | Who writes | Meaning |
|---|---|---|
| 0 | Platform | Initial |
| 2 | AI | no defect |
| 6 / 7 | AI | suspected / improvement |
| 3 / 4 / 5 / 8 | User | confirm fix / invalid / later / duplicate |

If preconditions did not change (same code) and they want a recheck: overlay write-back, **do not create a new task**. If the requirement or code already changed: `invalid-record` then `retry`.

---

## 7. Daily queries

```bash
node "$SKILL_SCRIPT" status --task-id "$TASK_ID"
node "$SKILL_SCRIPT" list-my-tasks --submit-user alice
node "$SKILL_SCRIPT" get-report --task-id "$TASK_ID"
node "$SKILL_SCRIPT" show-local-progress --task-id "$TASK_ID"
node "$SKILL_SCRIPT" content-summary --task-id "$TASK_ID"
node "$SKILL_SCRIPT" get-findings --task-id "$TASK_ID"
node "$SKILL_SCRIPT" code-read-stats --task-id "$TASK_ID" --batch-id "$BATCH_ID"
```

Clean stale local cache:

```bash
node "$SKILL_SCRIPT" cleanup-stale-data
```

A service clone failed and should be skipped:

```bash
node "$SKILL_SCRIPT" skip-service-batch --parent-batch-id "$BATCH_ID" --reason "no clone permission"
```

Abort the whole task:

```bash
node "$SKILL_SCRIPT" force-abort-task --task-id "$TASK_ID" --reason "wrong branch"
```

---

## 8. Connect company systems (HTTP slots)

Local files ↔ HTTP slots are one-to-one and can be switched per system. Contract: `references/api/enterprise-http-api.md`. The detection platform itself: `references/api/platform-api.md`.

| System | Local | Default HTTP |
|---|---|---|
| Detection tasks / process / rank | `data/platform/` | `/v1/tasks` etc. in `references/api/platform-api.md` |
| Test / delivery plan | `enterprise/plans/{id}.json` | `GET /v1/plans/{plan_id}` |
| Cases | `enterprise/test-cases/` | `GET /v1/test-cases` |
| Wiki / requirement docs | `enterprise/docs/` | `GET /v1/documents/{doc_id}` |
| Defect tickets / requirement tickets | `enterprise/issues/` | `GET/POST /v1/issues` |
| Exception traces | `enterprise/traces/{planId}.json` | `GET /v1/plans/{plan_id}/traces` |

`config.yaml` example:

```yaml
enterprise_http_base_url: https://gateway.example.com   # when systems share one gateway, this one line is enough
providers:
  auth:
    kind: bearer                    # none | bearer | api_key
    options: {}
  platform:
    kind: http
    options:
      base_url: https://quality.example.com
  plan:
    kind: http
    options:
      base_url: https://qa.example.com
      paths:
        get_plan: /api/test-apply/{plan_id}    # only change here when the company path differs from the default
  testcase:
    kind: http
  docs:
    kind: http
  issues:
    kind: http                      # or github + options.repo
  traces:
    kind: http
```

Equivalent environment variables:

```bash
export DETECTION_PLATFORM_KIND=http
export DETECTION_PLATFORM_BASE_URL=https://quality.example.com
export DETECTION_ENTERPRISE_BASE_URL=https://gateway.example.com
export DETECTION_PLAN_KIND=http
export DETECTION_TESTCASE_KIND=http
export DETECTION_DOCS_KIND=http
export DETECTION_ISSUES_KIND=http
export DETECTION_TRACES_KIND=http
export DETECTION_TOKEN=your-token
```

Path variables: `{plan_id}` `{id}` `{case_id}` `{issue_id}` `{doc_id}`. Slot table: `scripts/providers/http_slots.ts`. Systems not connected yet stay `kind: local`.

HTTP failure is the same as a missing local file: **degrade; do not kill the task**.

---

## 9. Prepare your own enterprise seeds

When there is no company API, place JSON yourself following the samples:

```text
enterprise/
  plans/1001.json
  plans/1001.defects.json          # optional
  test-cases/index.json
  docs/checkout-rules.md
  docs/checkout-api.md
  issues/42.json
  traces/1001.json                 # optional
```

Minimum fields for `plans/{id}.json`: `planId`, `planName`, `services[]` (`git`/`branch`/`language`), `testCaseIds`, `issueList`, `requirementDocs`, `technicalDocs`. Doc filenames only need to match the references in the plan.

---

## 10. FAQ

| Symptom | Handling |
|---|---|
| `get-plan-info` says there is no plan | Look at JSON `degraded` / `missing`. Add `--git` or `add-test-case` / `add-document`; do not retry in a dead loop |
| Clone failed | `skip-service-batch` that repo; continue other services |
| Auth failed | Set `DETECTION_TOKEN` or `--token`; `auth.kind` must match the company gateway |
| Write-back format failed | Auto-fix deterministic items per `scripts/validate.ts`; quality issues need re-analysis |
| `reconcile-report` exits 1 | Missed write / extra write / process vs rank mismatch; fill `batch-update-process` or `finalize-rank` then compare again |
| Tags / rules empty | Local is seeded from `scripts/providers/platform/seed_catalog.ts`; HTTP platforms use `/v1/tags` and `/v1/rules` |
| GitNexus missing | `ensure-gitnexus` installs once first; if the Agent cannot fix it, `--force-install`; only then grep |
| The user only pasted a plan link, no repo | Ask for git + branch; do not stop after reporting "plan does not exist" |
| Want to change repo and re-run | `retry`; to append conclusions on the same report, continue the original `taskId` |

---

## 11. Command cheat sheet

| Stage | Command | Use |
|---|---|---|
| Trigger | `submit-plan` / `submit-git` / `submit-skill-direct` / `phase1-init` | Create a task |
| Plan | `get-plan-info` / `check-materials` / `fetch-test-cases` / `testcase-pipeline` | Plan, material inventory, cases |
| Code | `clone-and-diff` / `ensure-gitnexus` / `register-repo-clone` / `get-changed-methods` | Clone, call graph, changes |
| Context | `get-tag-list` / `get-rules` / `phase1-fetch-all` / `get-delivery-defects` / `get-exception-traces` | Rules and history |
| Materials | `add-test-case` / `add-document` / `set-meta-field` / `init-content` | Chat materials into the store |
| Plan build | `prep-and-plan` / `trivial-method-filter --submit` / `build-detection-plan` / `check-phase2-readiness` | Detection checklist |
| Analysis | `get-pending` / `read-method-code` / `register-code-read` / `run-ast-scan` | Per method |
| Write-back | `batch-update-process` / `finalize-rank` / `record-rank` / `batch-no-bug` | Land conclusions |
| Close | `check-coverage` / `check-rank-integrity` / `reconcile-report` / `complete-task` / `finalize-all` | Close the gate |
| Feedback | `mark-bug` / `create-issue` / `update-rank-content` / `retry` | User decisions |
| Query | `status` / `get-report` / `get-findings` / `content-summary` / `list-my-tasks` | Progress and report |

Full flags: `node "$SKILL_SCRIPT" <command> --help`.

---

## 12. Related documents

| Document | Reader |
|---|---|
| `README.md` | Install and one-line intro |
| `SKILL.md` | Agent top-level routing |
| `references/phase1-preparation.md` / `references/phase2-detection.md` / `references/writeback.md` / `references/feedback.md` | Per-phase Hard rule |
| `references/api/adapters.md` | How to change config when switching company systems |
| `references/api/platform-api.md` | Detection-platform HTTP |
| `references/api/enterprise-http-api.md` | Plan / case / doc / ticket / trace slots |
| `config.example.yaml` | Copyable config |
| `references/` | Rules, write-back templates, output specs |

---

## 13. Minimum runnable checklist (local sample)

1. `cp config.example.yaml config.yaml`
2. `get-plan-info --plan-id 1001 --plan-type 2` sees `source=provider`
3. `submit-git` or `submit-plan` gets a `taskId`
4. Run `clone-and-diff` against a real clonable repo (sample git URLs are illustrative; replace with a repo you can access)
5. `get-tag-list` + `get-rules` are non-empty
6. `build-detection-plan` produces `data/<taskId>/plan.json`
7. After Phase 2 write-back, `reconcile-report` and `complete-task` both exit 0
8. `get-report --task-id <id>` can open the summary
