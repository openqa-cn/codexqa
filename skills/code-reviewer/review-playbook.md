---
name: code-reviewer
description: >
  Review Git branch, PR, or commit changes for quality, security, and maintainability.
  Use when the user asks for review, CR, 审查, PR review, pre-commit checks, or risk assessment
  on React / TypeScript / JavaScript / React Native logic-layer code in a Git repository.
  Do not use for how-to questions, debugging a known bug, explaining code, rewriting components,
  Vue templates / backend-only reviews, or pasted snippets without a Git repo.
license: MIT
metadata:
  author: open-source
  version: "1.0.0"
---

# Code Review Expert

## 🧭 Global conventions (the following apply to the entire skill and are not repeated later)

### Convention A · Unified fallback strategy

This skill has three layers of artifacts. Failures are handled the same way — **run what you can; if you cannot run it, leave a trace in the report; do not block the main flow and do not ask for authorization again and again**:

| Layer | Examples | On failure / interception |
|---|------|---------------|
| **Optional Node scripts** (`tooling/`) | `review-progress.js` / `run-local-checks.js` / `rm` | Mark `⚠️ <command-name> not executed (reason: permission intercept / missing dependency / error)` in the report, then continue the main flow |
| **Knowledge base** (`playbook/`) | Rule documents under playbook/ | Mark `⚠️ not found (skip this class of rules)` on the matching row of the Step 1 load table, then continue |
| **git / Grep / Read** (native AI tools) | Generate the diff / scan dangerous patterns / read files | In theory these should not be blocked; if they truly are, tell the user "This CR cannot continue (no diff means there is nothing to review)" and stop |

**On permission intercepts**: The first time a command is blocked, ask the user to authorize that command in the current environment, or to agree to skip it; do not repeat this prompt in the same session.

**On external systems**: Call only integrations that are `enabled: true` in the **already-loaded config** and that have a URL. No config, not enabled, or call failed → skip and leave a trace in the report; do not block the main flow. Do not invent hostnames. Do not call the installer or any undeclared directory service.

### Convention B · Unified progress-recording convention

All progress tracking goes through `node $SKILL_DIR/tooling/review-progress.js`. It is **optional but strongly recommended** (resume-from-breakpoint depends on it). Phase names for each step:

| Step | phase name | findings file (grouped / multi-agent mode) |
|------|---------|--------------------------------------|
| Step 1 knowledge-base load | `load_knowledge` | — |
| Step 2 automated detection | `automation_check` | — |
| Step 3 deep review (standard) | `deep_review` | — |
| Step 3 deep review (grouped / two-phase) | `group_N_review` | `.cr-group-N.json` |
| Step 3 multi-agent | `rules_snapshot` / `subagent_dispatch` / `merge_dedup` / `cross_file_check` | each sub-agent's JSON |
| Step 4 verification filter | `verification_filter` | — |

**What to do each step**: `phase-start <name>` before starting, `phase-done <name> [--findings <file>]` after finishing. After Step 4, also run `update-counts --p0 N --p1 N --p2 N` to persist the final counts.

**On intercept / failure** → follow **Convention A**: skip all `review-progress` commands, and write at the top of the report "Review mode: <mode> (no progress file; resume-from-breakpoint unavailable)". Later steps' "progress recording" notes will not repeat this detail.

### Convention C · Repository config (the only source for all external interfaces)

At the start of a review, parse the config first. Later Git links, layer paths, generated-file rules, state-library, HTTP wrapper, PR metadata, notify, and telemetry all read this result. Do not hard-code any external host:

```bash
node $SKILL_DIR/tooling/load-config.js
```

Lookup order is in `$SKILL_DIR/config/README.md`. Failed or not executed → use built-in defaults (compare branch prefers `main`, then `master`; common `src/*` layering; **all HTTP integrations off**), and write `⚠️ config not loaded, using built-in defaults` at the top of the report.

| Config block | Purpose |
|--------|------|
| `git.defaultBaseBranch` | Preferred compare branch when the user does not specify one; if that ref does not exist, try `main`, then `master` |
| `git.codeBrowseUrlTemplate` | File links in the report; placeholders `{org}` `{repo}` `{branch}` `{path}` `{line}` `{sha}` |
| `layers.ui` / `store` / `api` / `backend` / `exclude` | Scope mapping and multi-agent grouping (`backend` defaults to `src/main/java/` etc.) |
| `conventions.stateLibrary` | Review only this state library; if empty, infer from the diff and do not force one |
| `conventions.backendLanguage` | Backend language hint; if empty, infer from diff extensions |
| `conventions.httpWrapper` | Module that new requests should go through; if empty, do not require one |
| `conventions.generatedGlobs` / `generatedMarkers` | When G8 applies |
| `integrations.prMetadata` | Optional: fetch PR title/body |
| `integrations.notify` | Optional: push a summary after the review |
| `integrations.telemetry` | Optional: report counts only, never source |
| `integrations.extraKnowledge` | Optional: fetch extra Markdown rules |

To call any integration:

```bash
node $SKILL_DIR/tooling/invoke-integration.js <prMetadata|notify|telemetry|extraKnowledge> \
  --org "$org" --repo "$repo" --branch "$currentBranch" --base "$BASE_BRANCH" [--sha "$sha"] \
  [--body-file .cr-notify-payload.json]
```

Auth follows each integration's `auth`: `bearer` / `basic` / `header` / `query`. Secrets are read only from environment variables (`tokenEnv` etc.); the config file stores only variable names. If `required: true` (the default) and the env var is missing → skip that call; do not send an unauthenticated request. The body for `notify` / `telemetry` may contain only mode, file count, P0/P1/P2 counts, and a one-sentence conclusion. Source code, secrets, and the full diff are **forbidden**.

### Convention D · Review surface (frontend / backend / mixed)

As soon as the file list is generated, determine `REVIEW_SURFACE`. Later handbook loading, pocket cards, and grouping all read this value:

| Verdict | Condition (extensions, case-insensitive) |
|------|--------------------------|
| `frontend` | Only `.ts` `.tsx` `.js` `.jsx` `.vue` `.wxml` `.wxss` `.wxs` `.axml` `.acss` `.scss` `.less` `.css` and frontend config (e.g. `app.json`) |
| `backend` | Only `.java` `.kt` `.kts` `.go` `.py` `.c` `.h` `.cc` `.cpp` `.cxx` `.hpp` `.hxx` `.sql` or `*Mapper.xml` / `*mapper.xml` |
| `mixed` | Both surfaces present |
| `unknown` | If nothing matches, treat as `mixed`, but load only the handbooks that actually hit |

Groovy page DSL (`struct.groovy` etc.) still uses the existing low-code handbook and does **not** count as backend. `layers.backend` is used only as a pathspec when the user says "backend only" / 「只看后端」; it does not replace extension-based detection.

Add one line to the scope block at the top of the report: `surface: frontend | backend | mixed`.

---

## Optional: update the local skill (hand-written Git convention only)

Do not call the installer or any remote sync that is not declared in config. Fast-forward pull only when the user explicitly asks to update **and** this skill is a Git working copy:

```bash
git -C "$SKILL_DIR" pull --ff-only 2>&1 | tail -5
```

Failed or unauthorized → continue with the version in the current directory; do not block the review.

---

Switch expertise by this diff's **review surface** (see Convention D). Do not apply frontend rules to a pure-backend diff, and do not apply backend rules to a pure-frontend diff:

- **Frontend files present**: React / TypeScript / JavaScript / miniprogram logic layer; the state library follows config `conventions.stateLibrary` (if empty, infer from the diff).
- **Backend files present**: server-side correctness, SQL/ORM, idempotency, transactions, thread pools, API contracts; language follows the diff and config `conventions.backendLanguage` (if empty, infer from extensions; Java or C/C++ are common).
- Review is more than "is the writing correct"; focus on "will this design fail in production" and "will this code still be maintainable in three months".

**Review dimensions** (cover by review surface; do not review syntax only and ignore design):

| Dimension | Frontend focus | Backend focus |
|------|-----------|-----------|
| 🔴 Security & correctness | XSS / hardcoded secrets / floating-point money / hand-editing generated files | SQL/command injection / deserialization / money & idempotency / UPDATE without WHERE |
| 🔴 Async & state | Promise forever pending / empty catch / mutating shared state after async without going through the agreed action | Empty catch / transaction not rolled back / read-after-write from replica / task-retry double write |
| 🟡 Types & contracts | Abuse of any / double assertion / missing type narrowing | Wrapper-type `==` / missing API fields / error-code semantics |
| 🟡 Performance | N+1 requests / high-frequency render without useMemo / importing the whole package | Loop RPC / in-memory pagination / unbounded thread pool |
| 🟡 Robustness & design | Edge cases / loading-error / God Component | Legacy null / state machine missing a terminal state / no fallback on external failure |
| 💡 Architecture & maintainability | Cross-layer deps / DRY / Props Drilling | Sync-to-async breaking order / half-updated cache / unbounded batch jobs |

> Dimensions are a thinking frame; frontend P0 follows G1–G13, backend P0 follows B1–B10. When only one surface exists, do not force the other surface's cards.

**Core principles**:
- **Report only with evidence**: every issue must have a code line number + runtime consequence + rule source; generic comments like "consider refactoring" are forbidden
- **P0 three-step mandatory verification**: line number → runtime consequence → rule source; if any cannot be answered, immediately downgrade to P2 (pending confirmation)
- **No compromise on security and correctness**: G1-G8 issues are not downgraded because of "urgent business" or "legacy code"
- **Understand context before judging**: read the full function and its callers; do not guess intent from a diff fragment

---

## 📌 P0 mandatory pocket card (always in effect, whether or not the knowledge base loaded)

> This is the pocket card. No matter how long the context is or which knowledge bases loaded, these 8 items always run.

| # | Pattern | Fast identification |
|---|------|------------|
| G1 | Promise forever pending | `new Promise` has an `if` but no matching `else` resolve/reject, or a dual-callback API is missing the failure callback |
| G2 | Using a Promise object as a condition | After calling an async function, immediately `&&` / `if` / `return` without `await` |
| G3 | Empty catch / swallowed exception | `catch(e) {}` empty block, or `catch(e) { throw e }` with no log and no wrapping — **this is P0, not P1** |
| G4 | XSS injection | `innerHTML=variable` / `dangerouslySetInnerHTML={{__html:variable}}` / `eval(variable)` |
| G5 | Hardcoded secrets | Literal assignment containing `key`/`token`/`secret`/`password`/`ak`/`sk` |
| G6 | Floating-point money arithmetic | Fields containing `price`/`amount`/`fee` used directly in `* 0.x` multiply/divide |
| G7 | switch missing break | A case has logic but no trailing `break`/`return`/`throw` |
| G8 | Hand-editing generated files | Fires only when config `conventions.generatedGlobs` / `generatedMarkers` match, or the file header marks generated; do not apply this to hand-written API modules |
| G9 | Store open/init does not reset stale state | In a Store `open`/`init`/`show` method, a conditional branch (`if/else`) assigns observables on only some branches and the other branch keeps leftover values from the previous open; or the method entry does not call `reset()` / does not reset all mutable fields |
| G10 | Diff deleted state cleanup/reset lines | The diff `-` removed `this.xxx = undefined/null/[]`, `reset()`, `clear()`, `dispose()`, or zeroing statements inside `runInAction(...)`, and the same function has no equivalent-semantics replacement |
| G11 | Over-engineering / redundant change (missing subtraction) | A newly added function is ≥ 20 lines but can be expressed as "one-line ternary/destructure"; the diff has ≥ 30 consecutive added lines with no clear business benefit; a new file overlaps an existing module's responsibility; no-behavior-change "style/export style/rename" dominates; wrapping `if` in `Boolean(x)`, duplicated early-return and trailing fallback, `{...item, a: item.a}` redundant spread, extra `false` default params, etc. — **if an equivalently simpler option exists, it is P1**, a subtraction-type defect |
| G12 | API DTO contract mismatch | ① A backend-returned object (e.g. `customerDTO`) is **flattened** into state/props/form `defaultValue`, then manually reassembled into the same DTO on submit — extract then rebuild, with no intermediate business logic; ② submit params have **fewer fields** than the API definition (e.g. `feePercent` missing); ③ construct a "DTO with every field undefined" and send it to the backend without null checks; ④ put a data list into `defaultValue` (should be `useState`) or similar React-intent misuse |
| G13 | Intent-unclear change (cannot answer "why change this") | If a file hits any of the following → P1, and the PR author must give a reason in a commit / comment: ① the change neither solves the problem in the PR title nor fixes an existing bug; ② it is only "export name changed / order moved / blank lines tweaked" with no semantic change; ③ the entire file's change can be "fully reverted" with no functional impact; ④ the same file both adds and deletes the same semantics (e.g. "add a validation then delete it a few lines later") |

**Backend mandatory pocket card B1–B10** (in effect only when `REVIEW_SURFACE` is `backend` or `mixed` **and** backend files exist; does not rewrite the G card above):

| # | Pattern | Fast identification |
|---|------|------------|
| B1 | NPE / constant equals | `obj.equals("x")` where obj may be null; unboxing without a null check |
| B2 | SQL injection | String-concatenated SQL; MyBatis `${}`; dynamic table names without an allowlist |
| B3 | Unscoped UPDATE/DELETE | `UPDATE`/`DELETE` with no WHERE, or a WHERE that is always true |
| B4 | Dangerous thread pool | `Executors.newCachedThreadPool` / unbounded queue; `CallerRunsPolicy` on a scheduler thread |
| B5 | Retryable write without idempotency | Payment/refund/ledger/task retry with no business unique key + DB unique constraint |
| B6 | Transaction catch without rollback | catch-and-continue inside an `@Transactional` method; or still writing to the DB after catch |
| B7 | Read-after-write from replica | select immediately after update using the default replica |
| B8 | In-memory pagination / load the whole table | MyBatis `RowBounds`; `selectList` with no LIMIT on a large table |
| B9 | Command injection / dangerous deserialization | `Runtime.exec` + user input; `ObjectInputStream`; JSON polymorphic typing |
| B10 | Resource not closed | Stream/connection not closed, and not try-with-resources |

**⚠️ Mandatory verification before declaring P0** (prevents small-model guessing and misjudgment from a diff fragment):

```
Before outputting any P0 issue, you must complete in order:
  Step A: Find the concrete code line number (do not just say "somewhere in some function")
  Step B: In one sentence, describe "what happens at runtime if this is not fixed"
  Step C: Against the pocket card above, state which item it matches (frontend G1-G8 / backend B1-B10 or which knowledge-base section)
  If any of A/B/C cannot be answered → downgrade to P2, mark (pending confirmation), and do not declare P0
```

---

## Step 0: Load config + generate diff + collect change intent + choose review mode + init progress file

At the very start of the review, run Convention C's `load-config.js` and record the result as this session's `CONFIG`:

```
CONFIG_BASE_BRANCH   = config.git.defaultBaseBranch
CONFIG_LINK_TEMPLATE = config.git.codeBrowseUrlTemplate
CONFIG_LAYERS        = config.layers
CONFIG_CONVENTIONS   = config.conventions
```

No file or script failure → built-in defaults, do not block.

### 0.0 Scope identification (limit the review target; prevent whole-repo scans that waste context)

Extract **scope signals** from the user's current message / PR description / commit message, and decide which paths this CR will scan:

| Signal type | Examples | How to handle |
|---------|------|---------|
| **Direct path** | "only `src/pages/checkout/`", "focus on `src/stores/`", 「只看 `src/pages/checkout/`」 | Convert to a git pathspec and set `SCOPE="src/pages/checkout/ src/stores/"` |
| **Module keyword** | "only the checkout module", "only customer-profile changes", 「只审 checkout 模块」 | Use `git diff --name-only master...HEAD` to get changed files, `grep` the keywords to get a path set, then assign `SCOPE` |
| **Layer prefix** | "UI layer only" / "store layer only" / "api layer only" / "backend only" (and the same phrases in Chinese) | Map to config `layers.ui` / `layers.store` / `layers.api` / `layers.backend` (defaults `src/pages/`+`src/components/` / `src/stores/` / `src/api/` / `src/main/java/`+`src/main/kotlin/`+`src/main/resources/`) |
| **Generic signal** (no concrete path) | "skip tests in scope", "ignore generated", 「范围里别扫 test」, 「忽略 generated」 | Add to the `EXCLUDE` list |
| **No scope signal at all** | The common case | `SCOPE=""` (full repo), but at the end of Step 0 you **must proactively ask the user one question**: "Does this CR need to be limited to a directory / module? A full-repo scan is noisy on a large PR. If you do not want to limit it, reply `full` / `全量`." |

**Scope declaration block** (0.0 artifact; must be printed at the top of the report):
```
━━━ Review scope ━━━
scope:   src/pages/checkout/   (user-specified / AI-mapped from "checkout module" / full repo)
surface: frontend | backend | mixed
exclude: __mocks__/**  *.stories.tsx  __MACOSX/**  .DS_Store  ._*   (or "none")
━━━━━━━━━━━━━━
```

### 0.1 Generate the diff (use git CLI, avoid Node-script intercepts + split by file immediately)

```bash
# 1) Validate repo & branch
git rev-parse --git-dir            # failure → "current directory is not a git repo", stop
currentBranch=$(git branch --show-current)   # empty → detached HEAD, stop
# BASE_BRANCH: user-specified > existing config defaultBaseBranch in the repo > existing main > existing master
# Probe local and origin with rev-parse. Do not use `git branch -a | grep`: the current-branch line is "* master" and will miss the match.
branch_exists() {
  git rev-parse --verify --quiet "refs/heads/$1" >/dev/null \
    || git rev-parse --verify --quiet "refs/remotes/origin/$1" >/dev/null
}
# USER_BASE_BRANCH: compare branch named in the user message (empty if not named)
if [ -n "$USER_BASE_BRANCH" ]; then
  BASE_BRANCH="$USER_BASE_BRANCH"
  branch_exists "$BASE_BRANCH" || { echo "base branch does not exist: $BASE_BRANCH"; exit 1; }
else
  BASE_BRANCH=""
  for cand in $CONFIG_BASE_BRANCH main master; do
    [ -z "$cand" ] && continue
    if branch_exists "$cand"; then
      BASE_BRANCH="$cand"
      break
    fi
  done
  [ -n "$BASE_BRANCH" ] || { echo "base branch does not exist (tried $CONFIG_BASE_BRANCH / main / master)"; exit 1; }
fi

# 2) Choose compareBase (prefer remote; non-blocking fetch)
git fetch origin "$BASE_BRANCH" 2>/dev/null || true
compareBase="origin/$BASE_BRANCH"   # if origin/$BASE_BRANCH does not exist, fall back to "$BASE_BRANCH"

# 3) Uncommitted changes: warn only, do not block
git status --porcelain             # has output → ⚠️ uncommitted changes will not enter the diff; commit first is recommended

# 4) Generate the diff (with 0.0 SCOPE pathspec)
# SCOPE empty → pass no pathspec; SCOPE non-empty → append to the end of git diff
git diff "$compareBase...HEAD" -- $SCOPE > .code-review-diff.tmp
wc -c .code-review-diff.tmp        # 0 bytes → delete the file, report "no changes under this SCOPE, CR not needed"

# 5) 🔑 **Split by file immediately (core anti-explosion mechanism)**
mkdir -p .cr-diffs && rm -f .cr-diffs/*.diff
awk '
  /^diff --git / {
    if (out) close(out)
    match($0, /b\/(.+)$/, m); safe = m[1]
    gsub(/[\/\\]/, "__", safe)
    out = ".cr-diffs/" safe ".diff"
  }
  out { print > out }
' .code-review-diff.tmp
ls .cr-diffs/ | sed 's/\.diff$//; s/__/\//g' | grep -vE '(^|/)__MACOSX(/|$)|(^|/)\.DS_Store$|(^|/)\._' > .cr-files.txt   # drop macOS zip junk

# 6) Summary (for context; not for the report)
wc -l .cr-files.txt                           # file count
wc -l .code-review-diff.tmp                   # total lines
du -k .code-review-diff.tmp | awk '{print $1}'   # total size KB
```

After a successful generate, print one line: `✅ Diff generated & split | <currentBranch> vs <compareBase> | <n> files / <n> lines / <n> KB`

**🚫 Strictly forbidden (causes context explosion — the #1 reason large PRs stall):**
- **Forbidden** `Read .code-review-diff.tmp` (the full diff may be tens of thousands of lines)
- **Forbidden** reading every `.cr-diffs/*.diff` into context at once

**✅ Correct approach:**
- Need the file list → `Read .cr-files.txt` (a few hundred bytes)
- Need one specific file's diff → `Read .cr-diffs/<safe>.diff` (one file, within a few hundred lines)
- After finishing a file → write the conclusion into the coverage matrix immediately, **discard that diff fragment, and do not keep it in context**
- If a single file's diff also exceeds 1000 lines → use `grep -A 20 -B 5 '^@@' .cr-diffs/<safe>.diff` and take only hunk headers + nearby context

After the review, `rm -rf .code-review-diff.tmp .cr-diffs/ .cr-files.txt`. If any step is intercepted, follow **Convention A**.

### 0.2 Get repo info (used to build clickable links)

```bash
remoteUrl=$(git remote get-url origin)    # failure → fallback
currentBranch=$(git branch --show-current)
```

Try two regexes on `remoteUrl` to parse `org` and `repo`:
- SSH：`/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/`
- HTTPS：`/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/`

Fill `{org}` `{repo}` `{branch}` `{path}` `{line}` `{sha}` using `git.codeBrowseUrlTemplate` from config. If the template is empty or remote parsing fails → `codeBaseUrl=""`, and report locations as backticks `` `src/xxx.tsx:45` ``. **Do not** assemble any hosting hostname outside of config. **Do not block the CR**.

### CR must-do: collect change intent (otherwise you cannot judge "should this have been changed")

> **Purpose**: Without "intent" you cannot review G13 (intent-unclear change) or G11 (over-engineering), because you cannot tell whether "this code is unnecessary".

```bash
# 1) PR title + body (commit-msg often records "why")
git log "${BASE_BRANCH}..HEAD" --pretty=format:'%h  %s%n%n%b%n---' | head -200

# 2) Latest 5 commit messages
git log -5 --pretty=format:'%h  %s'

# 3) Optional: fetch again only when config has integrations.prMetadata enabled
#    Expected JSON contains title and body (or description). Skip on failure.
#    If not configured, do not call gh or any other hosting CLI unless the user already has it installed and explicitly asks.
node $SKILL_DIR/tooling/invoke-integration.js prMetadata \
  --org "$org" --repo "$repo" --branch "$currentBranch" --base "$BASE_BRANCH"
```

Immediately after reading, and before the review starts, output the **"intent declaration block"** (must not skip):

```
━━━ This PR's change-intent declaration ━━━
Core goal: (one sentence extracted from commit/PR body, e.g. "fill in missing customer DTO submit fields on the checkout form")
API changes: (if any, list fields added/removed on backend API signatures; if none write "none")
Out of scope for this change: (e.g. "does not involve money calculation / does not involve authz / does not restructure existing components")
━━━━━━━━━━━━━━━━━━━━━━
```

⚠️ **What to do when intent cannot be found** (common case: commit message is "update", "fix", "修改代码", or similarly uninformative):
1. Tell the user clearly: "The commit / PR body has no readable intent statement, so change necessity cannot be judged"
2. Proactively ask one question: "What is the core goal of this PR? Which APIs changed? Which files **should not** be in scope for this change?"
3. **Do not start deep review** until the user replies (you may run Step 2 automated detection first, but Step 3 must wait until intent is complete)

Read the diff: `Read .code-review-diff.tmp`, then **choose the review mode by diff size**:

| Diff size | Review mode | Notes |
|---------|---------|------|
| ≤ 200 lines | **Standard mode** | Normal flow: load rule handbooks once, full review |
| 200–600 lines | **Grouped mode** | Batch by review surface + file type: frontend `.tsx/.ts` first then `.js`; backend then `.java/.kt`/`*Mapper.xml`; config files last |
| 600–3000 lines | **Two-phase mode** | Phase 1: pocket-card fast scan (frontend G1-G8, backend B1-B10), mark P0 candidates; Phase 2: for each candidate, Read the full file + load the matching knowledge-base section to verify |
| > 3000 lines | **Multi-agent mode** | Main agent digests rules into a snapshot → start 2-3 sub-agents in parallel (each carries the rule snapshot + a grouped diff) → main agent merges, dedups, and does cross-file fallback |

> **Core strategy for large diffs**: first scan globally with the pocket card (frontend G1-G8, backend B1-B10) — fast, low noise; then deep-dive only on suspicious points.

**After choosing the mode, init the progress file** (optional; later steps follow **Convention B** for phase-start/phase-done and will not repeat this):

```bash
# --mode values: standard / grouped / two-phase / multi-agent
node $SKILL_DIR/tooling/review-progress.js init --mode <review-mode> --base <compare-branch>
```

### 🔒 Context endurance (prevention + recovery, so a truncated session does not continue the review with broken memory)

> **Background**: when context is too long, the earliest reads (review-playbook.md, rule handbooks) get truncated.
> **Two defenses**: the first half, "rule anchor", is prevention (keep rules in recent messages); the second half, "self-recovery", is remediation (restore immediately when a signal is detected).

#### Prevention · Rule anchor (mandatory before reviewing each file group)

**Before** reviewing each group of files, output a mini rule-confirmation block to "refresh" the rules to the tail of context:

```
━━━ Group N review (of M groups) · Rule anchor ━━━
Files in this group: [file list]
P0 pocket card (in effect for this group): G1/G3/G4... (list only items relevant to this group's file types)
Loaded rule handbooks: [already-read filenames] (do not re-read)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

This way, no matter how long the context is, the current group's rules always appear in the **most recent messages** and will not be lost to truncation.

#### Recovery · Self-recovery (when any of the following signals is detected, run the recovery action immediately)

| Perceived signal | Meaning | Recovery action |
|---------|------|---------|
| P0 three-step verification Step C failed (cannot cite a rule source) | The most direct truncation signal; rules are gone | Re-Read `review-playbook.md`, lock G1-G13, then continue |
| Unsure which knowledge base a file type should load | The load table is gone | Re-Read the Step 1 load-table portion of `review-playbook.md` |
| Cannot confirm whether a knowledge file was already loaded | The load record is gone | Directly re-Read that knowledge file (cheaper than guessing) |
| Starting a new file-group review after a long discussion | Rules may have slid out of the context tail | Output a rule-anchor block (do not re-read files; only restate the rules) |
| User says "you mentioned this earlier…" / 「你之前提到过……」 but the AI has no memory of it | Historical analysis was truncated | Tell the user: "My context may have been compressed; please confirm which issue you mean and I will re-verify" |
| Session interrupted / abnormal restart | Entire review state is lost | If `.review-progress.json` exists → `Read` it, restore progress, and continue from the unfinished phase; if not → tell the user they must start over |

**Required statement after self-recovery** (tell the user; avoid silent errors):

```
⚠️ Detected that context may have been compressed; reloaded [review-playbook.md / rule filename].
   If any historical conclusions are missing, tell me and I will re-check.
```

### 🤖 Multi-agent mode (diff > 3000 lines)

> **Why the 3000-line threshold**: multi-agent can break a single-context ceiling, but a sub-agent has only the injected rules, no conversation history, and weak cross-file awareness. Below 3000 lines, two-phase mode is more accurate; only above 3000 lines is the coordination cost worth it.

#### Step M1: Main agent first digests all knowledge files and generates a rule snapshot

> **Execution order**: after multi-agent mode is triggered, **first jump to Step 1 and fully load every knowledge base**, then come back here for M1-M4. The rule snapshot can be distilled only after knowledge bases are loaded, so that sub-agents have complete rules.

**Before starting any sub-agent**, the main agent must finish loading every knowledge file from Step 1, then distill the key rules into a **rule snapshot** (keep it within 2000 tokens).

**Full rule-snapshot template** → `$SKILL_DIR/playbook/parallel-review-snapshot.md`

The main agent only needs to fill in the template section "Knowledge summary for this diff" (distill rule names + identification features from the knowledge bases actually loaded this time). Leave the other blocks unchanged.

#### Step M2: Split by module boundaries, not by equal line counts

Split principles (files with dependencies must stay in the same group):

```
Prefer splitting by config layers (use default src/* when there is no config):
  Group 1: layers.ui (pages + components)
  Group 2: layers.store
  Group 3: layers.api + config files (if changed)

Rules:
  - Do not split the same file across groups
  - A import B → put A and B in the same group
  - Each group's diff must not exceed 1000 lines
  - Split into at most 3 groups (merge small groups if over)
  - When `REVIEW_SURFACE` includes backend, add `layers.backend` (`.java` / `.kt` / Mapper); mixed diffs get at most 4 groups (frontend at most 3 + backend 1)
```

#### Step M3: Start sub-agents in parallel; each carries the rule snapshot

Each sub-agent's prompt template is also in the "Full prompt template for each sub-agent" section of `$SKILL_DIR/playbook/parallel-review-snapshot.md`. After reading it, the main agent fills the following two placeholders with real content; that is one complete sub-agent prompt:

- `[Paste the entire rule snapshot above]` → the snapshot generated in Step M1
- `[This group's diff]` → this group's diff text from Step M2

**Disk requirement**: each sub-agent is required to **write `.cr-sub-<N>.json` immediately when returning JSON** (N = group number); do not keep it in memory only. The main agent uses these on-disk files to tell who finished and who did not.

#### Step M3.5: Health check + failure isolation (one stuck sub-agent must not stall the whole review)

> **Background**: a single sub-agent occasionally stalls (model rate-limit, input token overflow, or looping Grep on the same pattern). In the past, one stall blocked everything, even though the other groups had already finished.

**Hard policy**:
1. **Start separate Tasks; do not wait serially**: each sub-agent is its own TaskCreate. The main agent must not `await Promise.all`; instead **poll `.cr-sub-*.json` for on-disk completion**
2. **Timeout = 15 minutes with no on-disk file AND no visible incremental output** (both must be true to count as stuck; one condition alone does not)
3. **Cumulative timeout 25 minutes** → force the "fault-tolerance decision point" and stop waiting
4. Each sub-agent's status must be registered one-by-one on an "M3.5 status table":

```
| Group | Files | Diff lines | Status | On-disk JSON | Notes |
|---|------|---------|------|---------|------|
| 1 | UI layer   | 5 / 840  | ✅ done  | .cr-sub-1.json | 3 P0 / 2 P1 |
| 2 | Store layer | 3 / 410  | ✅ done  | .cr-sub-2.json | 1 P0 / 4 P1 |
| 3 | API layer  | 2 / 120  | ❌ timed out  | —             | 15 min no file and no response |
```

**Fault-tolerance decision point (must ask the user explicitly; the AI must not decide for the user)**:

When any sub-agent times out / returns invalid JSON / is interrupted by the user, the main agent must output the following question:

```
⚠️ Sub-agent execution status:
  ✅ Group 1 (UI layer): done, found 3 P0 / 2 P1
  ✅ Group 2 (Store layer): done, found 1 P0 / 4 P1
  ❌ Group 3 (API layer): timed out after 15 minutes with no response (files involved: x.ts, y.ts)

Please choose next (reply A/B/C):
  [A] Output the completed parts first (groups 1+2); mark group 3 in the coverage matrix as "⚠️ not reviewed (timed out)"; add a "partial review" label to this CR's conclusion
  [B] Main agent takes over and retries group 3 (review files sequentially, no new sub-agent; estimate 5-10 minutes)
  [C] Split group 3 again into per-file sub-agents and retry in parallel (fits when files in the group are many and independent)
```

**Do not enter M4 on your own** before the user replies. Reply A → go to M4 directly but mark group 3 files in the report "📁 File coverage matrix" section as `⚠️ partial review (sub-agent timed out)`; reply B/C → finish group 3 first, then enter M4.

**Why you must ask the user instead of defaulting to A**: the user may need a CR quickly (choose A), or may have time and want a complete result (choose B/C). Both needs are reasonable; the AI must not decide.

#### Step M4: Main agent merge + cross-file fallback

After receiving all available sub-agent JSON (including the case where M3.5 chose A and only some groups exist), the main agent does:

```
1. Dedup: for the same file + nearby line (±3 lines), keep only one issue (take the higher P level)
2. P-level consistency: if the same type of issue was graded differently across groups → unify to the higher level
3. Cross-file verification:
   - Collect each group's cross_file_hints
   - Grep related callers
   - Add explanation or raise the P level for issues with cross-file risk
4. **Partial-review labeling** (if M3.5 chose A):
   - In the report "📊 Overall assessment" one-sentence conclusion, write explicitly: "This is a partial review; group X was not reviewed (sub-agent timed out)"
   - In the coverage matrix, write group X file status as `⚠️ partial review (sub-agent timed out)`
   - Prefix the merged conclusion with "⚠️ This report is based on Y/Z group sub-agent results; conclusions may be incomplete"
5. Output the final merged report (same format as standard mode)
```

> ⚠️ **Known limitation of multi-agent mode**: a sub-agent sees only its own group's diff and cannot perceive cross-group business semantics. The main agent's cross-file fallback step must run and must not be omitted.

---

## Step 1: Load rule handbooks (on demand; control the context budget)

**First**: use Convention C's `load-config.js` result as the project conventions. Then check explanation files and **read them if they exist**:
```
README.md / README.zh.md / PROJECT.md / CONTEXT.md / docs/architecture.md
```
> Config file > target-repo README / contributing guide > this skill's defaults. Skip items that do not exist; do not invent undocumented processes or hosts.

If `integrations.extraKnowledge.enabled` is true, use `invoke-integration.js extraKnowledge` to pull optional extra Markdown, save it as `.cr-extra-knowledge.md`, then Read; skip on failure.

**Then**: always load (required every CR):
```
$SKILL_DIR/playbook/project-conventions.md          ← optional hand-written conventions (skip if there is no README counterpart)
$SKILL_DIR/playbook/design-quality-rules.md             ← software design quality (performance / robustness / reuse / architecture)
$SKILL_DIR/playbook/change-necessity-rules.md  ← subtraction review (G11-G13: redundancy / contract / intent)
```

When `REVIEW_SURFACE` includes `backend` or `mixed`, **do not** read every backend handbook at once: still load on demand by the file-type / content-feature tables below. A pure-frontend diff does not load backend handbooks.

**Finally**: load on demand by diff file type + content features. **Prefer reading the quick-reference index at the start of each file**;
read the matching section only when you need to verify details; do not read every file in full every time.

> ⚠️ **Context-budget rule**: knowledge files already Read in this conversation **must not be read again**.
> If you need to cite a rule during follow-up / discussion, extract it from existing context; do not read the file again.

**▶ File-type triggers**:

| Extension | File to load |
|--------|---------|
| `.tsx` | `$SKILL_DIR/playbook/react-review-rules.md` + `$SKILL_DIR/playbook/typescript-review-rules.md` |
| `.jsx` | `$SKILL_DIR/playbook/react-review-rules.md` + `$SKILL_DIR/playbook/javascript-review-rules.md` |
| `.ts` (not `.tsx`) | `$SKILL_DIR/playbook/typescript-review-rules.md` |
| `.js` / `.mjs` | `$SKILL_DIR/playbook/javascript-review-rules.md` |
| `.vue` | `$SKILL_DIR/playbook/vue-review-rules.md` |
| `.wxml` / `.wxss` / `.wxs` / `.axml` / `.acss` / `app.json` | `$SKILL_DIR/playbook/miniprogram-review-rules.md` |
| `struct.groovy` / `dataSourceMap.groovy` / `*.groovy` with `componentsMap.json` in the same directory | `$SKILL_DIR/playbook/low-code-page-rules.md` |
| `.groovy` (when the low-code trigger does not apply) | `$SKILL_DIR/playbook/groovy-review-rules.md` |
| `.scss` / `.less` / `.css` | `$SKILL_DIR/playbook/project-conventions.md` (§6 styles) + `$SKILL_DIR/playbook/design-quality-rules.md` (§9 selector depth) |
| `.java` / `.kt` / `.kts` | `$SKILL_DIR/playbook/java-review-rules.md` + `$SKILL_DIR/playbook/backend-service-rules.md` |
| `.c` / `.h` / `.cc` / `.cpp` / `.cxx` / `.hpp` / `.hxx` | `$SKILL_DIR/playbook/cpp-review-rules.md` + `$SKILL_DIR/playbook/backend-security-rules.md` |
| `.py` | `$SKILL_DIR/playbook/python-review-rules.md` + `$SKILL_DIR/playbook/backend-service-rules.md` + `$SKILL_DIR/playbook/backend-security-rules.md` |
| `.go` | `$SKILL_DIR/playbook/go-review-rules.md` + `$SKILL_DIR/playbook/backend-service-rules.md` + `$SKILL_DIR/playbook/backend-security-rules.md` |
| `.sql` / `*Mapper.xml` / `*mapper.xml` | `$SKILL_DIR/playbook/backend-data-access-rules.md` |

**▶ Content-feature triggers**:

| Trigger signal | File to load |
|---------|---------|
| `price`/`amount`/`fee`/`money` / 金额 / 额度 / balance | `$SKILL_DIR/playbook/monetary-precision-rules.md` |
| `innerHTML`/`eval`/`dangerouslySetInnerHTML`/`token` | `$SKILL_DIR/playbook/frontend-security-rules.md` |
| financial loss / config change / dependency upgrade / legacy logic / empty catch / 资损 / 配置改动 / 依赖升级 / 存量逻辑 / 空 catch | `$SKILL_DIR/playbook/high-risk-changes.md` |
| `new Promise`/`JSON.parse`/`switch` / core business logic / 核心业务逻辑 | `$SKILL_DIR/playbook/incident-catalog.md` and `$SKILL_DIR/playbook/async-failure-modes.md` |
| render / long list / 渲染 / 长列表 / `useMemo` / `memo` | `$SKILL_DIR/playbook/frontend-performance-rules.md` |
| File path contains `store/`/`stores/`/`.store.ts` / class name contains `Store` / `@observable` / `runInAction` / `open(` / `init(` / `reset(` / `dispose(` | `$SKILL_DIR/playbook/client-state-lifecycle.md` |
| `SELECT`/`UPDATE`/`DELETE`/MyBatis `${}`/`#{}`/`RowBounds` | `$SKILL_DIR/playbook/backend-data-access-rules.md` |
| `@Transactional` / idempotency / payment / refund / thread pool / state machine / 幂等 / 支付 / 退款 / 线程池 / 状态机 | `$SKILL_DIR/playbook/backend-service-rules.md` |
| `Runtime.exec` / `ObjectInputStream` / `DocumentBuilder` / user-controlled outbound URL / 用户 URL 出站 | `$SKILL_DIR/playbook/backend-security-rules.md` |
| gray release / feature flag / remote config / message consume / protobuf merge / 灰度 / 功能开关 / 远程配置 / 消息消费 | `$SKILL_DIR/playbook/backend-incident-patterns.md` (details still start with `backend-service-rules.md`) |
| config listener / config callback / `volatile` config field / 配置监听 / 配置回调 / `volatile` 配置字段 | `$SKILL_DIR/playbook/backend-service-rules.md` (§29–§31; Java visibility is in `java-review-rules.md` §21) |
| `CountDownLatch` / `tryLock` / `new Timer(` | `$SKILL_DIR/playbook/java-review-rules.md` (§34–§36) |
| `Future.get(` / `CompletableFuture` / `supplyAsync` / `Collectors.toMap` | `$SKILL_DIR/playbook/java-review-rules.md` (§41–§47) |
| cache aside / delete cache after write / bloom filter / distributed lock / 缓存击穿 / 分布式锁 | `$SKILL_DIR/playbook/backend-service-rules.md` (§34–§36) |
| `SendResult` / ordered message / 顺序消息 | `$SKILL_DIR/playbook/backend-service-rules.md` (§38–§39) |
| `search_after` / `from+size` / `Scan(` / shard key / 分片键 | `$SKILL_DIR/playbook/backend-data-access-rules.md` (§23–§26) |
| `MessageDigest.getInstance("MD5"` / `DES` / `SecureRandom` / `SameSite` / CSRF | `$SKILL_DIR/playbook/backend-security-rules.md` (§12–§15) |
| `system(` / `popen(` / `execl` / `LoadLibrary` / `dlopen(` / `memset_s` / `sigaction` | `$SKILL_DIR/playbook/cpp-review-rules.md` |
| `delete[]` / `va_start` / overlapping `memcpy` / use after close / `std::mutex` | `$SKILL_DIR/playbook/cpp-review-rules.md` (§21–§32) |
| `yaml.unsafe_load` / `os.system` / `subprocess` / `app.debug` / `DEBUG = True` | `$SKILL_DIR/playbook/python-review-rules.md` |
| `re.sub(` / `open(` invalid mode / `x = x` / `%` format mismatch | `$SKILL_DIR/playbook/python-review-rules.md` (§12–§17) |
| `Boolean.getBoolean` / `createTempFile` / `System.exit` / `n % 2 == 1` | `$SKILL_DIR/playbook/groovy-review-rules.md` |
| `exec.Command` / `InsecureSkipVerify` / `_ = err` / `http.ListenAndServe` | `$SKILL_DIR/playbook/go-review-rules.md` |
| `Array.sort(` / `for...in` / `it.only` / `parseInt(` / `=+` | `$SKILL_DIR/playbook/typescript-review-rules.md` (§8–§21) |

**📉 Degraded review** (skip style/performance dimensions, but contract-related items must still be reviewed):

| File pattern | Dimensions still reviewed | Dimensions skipped |
|---------|--------------|----------|
| `*.test.ts` / `*.spec.ts` / `*.test.tsx` | ① **Whether mock data structures still align with the current DTO / Store observable** (DTO changed and mock did not follow = tests are green in a fake environment) ② **Whether assertions still match the new semantics** (does the `expect` value still match what the new code produces?) ③ G4/G5 security items ④ Whether the test was "hard-changed just to pass" (e.g. comment out assert / `toBe(anything)`) | Naming / comments / formatting / performance / readability |
| `*.stories.tsx` | G4/G5 security items only | Skip everything else |
| `src/mocks/**` / `__mocks__/**` | **Field symmetry between mock data structures and the API definition** (field names / types / requiredness) | Skip everything else |
| `*.generated.ts` / `*.auto.ts` | **Whether it was hand-edited (G8)** | Skip everything else |
| `*Test.java` / `*Tests.java` / `*_test.go` | ① Whether mock / fixture still aligns with the current DTO, table schema, or API fields ② Whether assertions still match the new semantics ③ G5 / B2 / B9 security items ④ Whether assertions were deleted just to pass | Naming / comments / formatting |
| `*_test.c` / `*_test.cpp` / `*_test.cc` | ① Whether fixtures still match the current structs / file paths / SQL ② G5 / B2 / B9 and `cpp-review-rules.md` §1 / §3 / §8 ③ Whether assertions were deleted just to pass | Naming / comments / formatting |
| `test_*.py` / `*_test.py` | ① Whether fixtures still match the current DTO / schema / SQL ② G5 / B2 / B9 and `python-review-rules.md` §4 / §6 / §7 / §10 ③ Whether assertions were deleted just to pass | Naming / comments / formatting |

> **Why not skip them entirely**: holes in tests/mocks are the most hidden source of production incidents — CI green ≠ production safe. The classic case: the backend DTO changed a field type, the mock still has the old type, all tests pass, production deserialization blows up. Q0 cross-file scanning must treat `*.test.ts` / `__mocks__/**` as callers and scan them together.

---



## Step 2: Automated detection

This step has two parts: **security scan (mandatory)** + **dependency/vulnerability scan (Node script, optional)**.

### 2.1 Security scan (mandatory: script first, partitioned by language)

Run a partitioned scan on `.cr-files.txt` first. **Do not** Grep S1–S12 one by one:

```bash
node $SKILL_DIR/tooling/security-scan.js --files .cr-files.txt
```

The script partitions by extension and reads each file only once: JS/TS runs S1–S8 only; `.java` / `.kt` / `.kts` / `.xml` / `.sql` run S9–S12 only. Exclude `node_modules` / `dist` / `build` / `target` / `__MACOSX` / `.DS_Store` / `._*` / tests / stories / `__mocks__` / `/api/` / generated / `*Test.java`. Skip a single file > 500KB. S1/S2 ignore `process.env` / `import.meta.env` and placeholder literals such as `changeme` / `xxx` / `your-`.

If the script fails or is not executed → **do not block**; fall back to the two partitioned Greps below (still 2 times, not 12). If Grep also fails, follow **Convention A** and sample with `Bash grep -nE` or `Read`; do not block.

| # | Pattern | Regex | Level | Matching pocket card | Surface |
|---|------|------|------|-----------|---|
| S1 | Hardcoded API Key / Token | `(api[_-]?key\|apikey\|access[_-]?token\|secret[_-]?key)\s*[:=]\s*['"\`][\w\-]{20,}['"\`]` | critical | G5 | JS/TS |
| S2 | Hardcoded password | `password\s*[:=]\s*['"\`][^'"\`]{6,}['"\`]` | critical | G5 | JS/TS |
| S3 | Dynamic innerHTML | `\.innerHTML\s*=\s*(?!['"\`])` | high | G4 | JS/TS |
| S4 | dangerouslySetInnerHTML | `dangerouslySetInnerHTML\s*=\s*\{\{?\s*__html:` | high | G4 | JS/TS |
| S5 | eval() | `\beval\s*\(` | critical | G4 | JS/TS |
| S6 | new Function | `new\s+Function\s*\(` | high | G4 variant | JS/TS |
| S7 | console.log of sensitive fields | `console\.log\(.*?(password\|token\|secret\|key\|credential)` | medium | — | JS/TS |
| S8 | Long-lived token in query | `[?&](access_)?token=` | high | G5 | JS/TS |
| S9 | SQL concat / MyBatis `${}` | `\$\{` or `['"\`]\s*(SELECT\|UPDATE\|DELETE)` | critical | B2 | Java/XML/SQL |
| S10 | Command execution | `Runtime\.getRuntime\(\)\.exec\|ProcessBuilder\s*\(` | critical | B9 | Java/XML/SQL |
| S11 | Dangerous deserialization | `new\s+ObjectInputStream\|enableDefaultTyping\|activateDefaultTyping` | critical | B9 | Java/XML/SQL |
| S12 | In-app DDL / stored procedures | `CREATE\s+PROCEDURE\|ALTER\s+TABLE\|DROP\s+TABLE\|TRUNCATE\s+TABLE` | critical | B2 / data-access §18 | Java/XML/SQL |

**Partitioned Grep fallback** (only when the script fails):
- Frontend: one match of the S1–S8 alternation regex against `.js`/`.jsx`/`.ts`/`.tsx` in the diff
- Backend: one match of the S9–S12 alternation regex against `.java`/`.kt`/`.xml`/`.sql` in the diff
- A pure-frontend diff does not run S9–S12; `` `${}` `` inside a JS/TS template string is not S9

**Candidates after a hit** (after entering Step 3 they still go through Step 4 Q1–Q5):
- **critical / high → P0 candidate** (S1/S2/S8 → G5; S3/S4/S5/S6 → G4; S9/S12 → B2 / data-access §18; S10/S11 → B9)
- **medium → P2 candidate**

If after filtering there are no scannable files → write `⚠️ no changed scannable files, skip security scan` in the report (if backend files exist, still run the backend partition).

**Write the scan conclusion into the report "🤖 Automated detection results" section**: paste the script JSON's `files` / `critical` / `high` / `medium`; if no hits, write `✅ no security issues found`.

### 2.2 Dependency & bundle scan (optional, Node script)

```bash
# First use: install deps first: cd $SKILL_DIR/scripts && npm install && cd -
node $SKILL_DIR/tooling/run-local-checks.js
```

Covers: phantom dependencies, npm vulnerabilities, abnormal bundle size.

- ✅ Succeeded → list index.js scan conclusions in the report "🤖 Automated detection results" section
- ❌ **Permission intercept / deps not installed / Node error** → **skip, do not block**. Write in the report `⚠️ dependency scan not executed (reason: permission intercept / missing dependency); security scan already covered by 2.1`

> 2.1 already covers the security dimension independently; a 2.2 failure does not affect CR correctness.

---

## Step 3: Deep review

> **Review order**: P0 pocket card (G1-G13) → intent alignment → necessity 5 questions (review the change) → knowledge-base rules → impact-scope assessment
> Progress recording follows **Convention B**; grouped / two-phase / multi-agent findings files are written per the Convention B table, to survive context truncation.

> **🔑 Per-file streaming review (hard constraint against context explosion)**:
> - Process **one** file from `.cr-files.txt` at a time; `Read .cr-diffs/<safe>.diff` to get that file's diff fragment
> - As soon as you finish, write the conclusion into the **matching coverage-matrix row** + persist `.cr-findings-<safe>.json` (anti-truncation)
> - Then **actively discard** that diff fragment's references in context (when the next file starts, refresh rules with a "rule anchor"; do not re-cite the previous file's content)
> - **Forbidden**: Read multiple `.cr-diffs/*.diff` at once / Read the entire `.code-review-diff.tmp` / leave an already-reviewed file's raw diff in context
> - If a single-file diff itself exceeds 1000 lines: first `grep '^@@' .cr-diffs/<safe>.diff` to get all hunk headers, then `Read` each hunk by line-number range
> - Grouped / two-phase / multi-agent modes all obey this constraint; the only difference is "who reviews this one file" (single-agent sequential vs multi-agent parallel)

### 3.0 Necessity 5 questions N1-N5 (review the change; mandatory gate; targets G11/G12/G13 — subtraction review)

> **Note**: do not confuse this with Step 4's "verification 5 questions Q1-Q5". N questions review the **PR code itself** ("should this change exist"); Q questions review the **AI's own output** ("is this finding filler").

> **Trigger scope**: for **every contiguous added block ≥ 5 lines** and **every newly added function / component / file** in the diff, answer the 5 questions in the table one by one.
> Skipping this step = this review did no "subtraction", and you will miss senior-reviewer-class comments.

| # | Question | Pass standard | On fail |
|---|------|---------|-----------|
| N1 | **Aligned with PR intent?** | Which item of the "core goal" declared in step 0.1 does this change answer? If you cannot say and it does not fix any known bug → G13 hit | File as P1 (G13) and have the PR author give a reason; or suggest reverting the whole block |
| N2 | **Can it be deleted?** | If you **delete this entire change**, does the feature still hold? (e.g. an early return that already has a fallback / redundant `Boolean()` wrap / add-and-delete that cancel each other / a fully revertible export reorder) | Can delete → G11 hit, P1 suggest deletion |
| N3 | **Can it be simpler?** | Can "ternary / destructure / an existing helper / reuse the DTO directly" achieve the same effect? (e.g. "this function is unnecessary, one line: `row.xxx ? ${id}:${name} : '-'`"; "just `...item`") | Can simplify → G11 hit, P1 give the simpler writing |
| N4 | **Duplicates an existing approach?** | Does the local tree/repo already have a same-semantics helper / type / constant? (`Grep` function names / constant names / semantic keywords) | Duplicate → G11 hit, P1 change to reuse |
| N5 | **Did it change the API contract?** | Did the diff change the DTO shape versus the backend? (flattening/reassembling `customerDTO`, adding/removing input fields, field type any→concrete) | If "yes" and it is not aligned with the backend API / not aligned with "API changes" in the intent declaration → **G12 hit, P0** |

**Execution rules**:
- **N2/N3 first**: subtract before you add. Any answer of "can delete / can simplify" must be output; do not skip because "the code runs"
- Whole blocks where N1 answers "intent unclear" → **collect them in one "🔎 Intent-unclear change list" section** in the report, and have the PR author explain each
- When N5 is judged P0, you must also `Grep` DTO / Store methods in the same repo and confirm flatten/reassemble symmetry (see `change-necessity-rules.md` §2)
- N1-N4 themselves do not raise to P0 (unless stacked with a G1-G10 correctness issue), but N5 goes to P0 directly


**Confidence principle** (core anti-noise mechanism):
- Report P0: must have a code line number + runtime consequence + rule source (see P0 verification steps A/B/C above)
- Report P1: have code evidence, but when impact is uncertain or there is a reasonable exception, write clearly "what the evidence is"
- Report P2: when you have a concern but evidence is insufficient, mark `(pending confirmation)` and state the concern
- **Forbidden**: inferring from a diff fragment only, or evidence-free judgments like "this style is usually a problem"

**Context expansion** (in the following cases you must Read the full file; you cannot decide from a diff fragment):

| Trigger | Expansion action |
|---------|---------|
| Changed a function/Hook that is called in many places | `Grep` callers, sample-Read 2-3 sites |
| Changed a React component props interface or state logic | `Read` that component's full file |
| Change involves money / authz / state-machine core logic | `Read` the full function context |
| Diff references a type but the type definition is not in view | `Grep` for the type declaration |

**Always check (mandatory items outside the knowledge base)**:

| Category | Mandatory item | Level |
|------|--------|------|
| Team special | Whether pnpm/yarn lock files changed widely (>10 lines of substantive change) | P0 |
| Impact scope | When an existing function/API was modified, Grep global callers | P1 |
| Diff deleted-line analysis | Every `-` line must get a one-sentence "runtime semantic difference after deletion"; for deleted lines with state-cleanup semantics such as `reset`/`clear`/`dispose`/`= undefined`/`= null`/`= []`/`= {}` / zeroing inside `runInAction`, you must additionally state "whether it was equivalently replaced in the same function"; no equivalent replacement → G10 as P0 | P0 |
| Store lifecycle symmetry | When the file hits the "Store class file" trigger (see Step 1 content-feature trigger table), you must check one by one whether the five method kinds `open/init/show/reset/dispose` are symmetric: an observable written in `open` must be explicitly reset in `reset`/`dispose`/the next `open`; conditional assignment (`if/else`) must cover every branch — uncovered → G9 as P0 | P0 |

**Concrete procedure for diff deleted-line analysis** (must not be omitted):
```
1. From .code-review-diff.tmp, grep '^-' to get all deleted lines (filter out the diff header '---')
2. For every '-' line, you must answer: "After this line is deleted, who takes over the runtime behavior it used to guarantee?"
3. If the answer is "nobody" or "unsure" → raise to a P0 candidate (per G10), and Read the full function to verify
4. Pay special attention to cleanup-statement deletions in Store / Context / global-singleton class files
```

---

## Step 3.5: Unease output (mandatory; do not look up rules; "none" is not allowed)

> **Why this is a separate step**: the rule layer (G1-G13 / knowledge base) can only catch **problem patterns you have already seen**. The most expensive real-world bugs often look like no known pattern — but a human reviewer can feel "something is off" at a glance. The only purpose of this step is to make the AI **bypass the rule layer and output its own intuition signals**.
>
> **This step does not produce P0/P1/P2**. It produces "candidate clues". If a clue later matches a concrete rule under Step 4 verification, then assign a P level as usual; if it does not match, leave it in the report as "unease" for the PR author to confirm.

### Hard rules (no compromise)

1. **You must output 3-5 items**. Answers like "no unease", "none found", or "already fully covered" are not allowed. If the AI truly feels nothing, say "the 3 places I trust least" — you must still list them.
2. **Do not cite any G1-G13 / M1-M14 / knowledge-base clause**. This step is meant to turn off rule retrieval and **force the AI to speak in plain language**.
3. **Do not use soft wording** ("might be a bit", "perhaps not great", "consider"). It must be a definite "I find it odd that [concrete point]".
4. **Every item must be anchored to a concrete file:line**. Empty talk like "overall it feels too complex" or "overall naming is not good enough" is forbidden.
5. **The Top-3 must be cross-file / cross-layer observations**, not all small intra-file nits. This item exists to stop "staring at diff lines and never looking at the whole".

### Output format (strict)

```
🧐 AI unease list (required 3-5 items)

1. [file-path:line] —— Odd because: (one sentence, ≤30 characters)
   Explanation: (one sentence, why it is odd + what the PR author should clarify / or the problem the AI suspects)

2. ……
```

### Heuristics for "what counts as odd" (reference only, not a checklist)

- **Three-way inconsistency**: the interface declares A, the implementation writes B, the caller uses C (e.g. an interface typed `T | Promise<T>` + a purely sync implementation + a caller that always `await`s)
- **Abstraction-level jump**: a UI component concatenates SQL / calls a Redis key / reads a global singleton
- **Name ≠ behavior**: the function is called `validateX` but it actually mutates state
- **Structural repetition that is inconsistent**: two adjacent branches do similar work but are written differently
- **Over-defense / under-defense**: some paths are `?.?.?.?.`, another place in the same file goes straight `.x.y.z`
- **"Disappearance" in the diff**: an important capability that existed in the original code but is not in the diff (e.g. loading / error / logging) — ask "why does the new code no longer need it"
- **Magic numbers / literals**: `0` / `1` / `-1` / hardcoded URL / hardcoded duration
- **Sync / async mismatch**: `await` a sync function / treat an async function as sync without `await`
- **Leftovers after tightening types**: it used to be `any` and is now tightened to `User`, but some internal cast / `as any` was not cleaned up

> Note: this list is **only to train your nose**, not something to match item by item. The best unease item is the one that is not on any list.

### Execution constraints

- Do not use this step to replace the rule-layer review (Step 3 is still mandatory)
- Do not use rule-layer results to replace this step (even if you already wrote 5 P0/P1/P2 items, the unease list must still be output independently)
- Repeat: if an unease item is later upgraded to P0/P1/P2 by Q1-Q5 verification, **it still stays on the unease list** (mark "→ upgraded to P0-N"); do not delete it. This preserves the "AI intuition ↔ rule hit" mapping for later skill iteration.

---

## Step 4: Verification 5 questions Q1-Q5 (review yourself) + value filter (mandatory gate; cannot skip)

> **Distinction**: N questions (3.0) review **PR code**; Q questions (4.1) review the **AI's own P0/P1/P2 drafts**. Different purposes; do not mix them up.

> **Progress recording**: besides Convention B's `phase-start/phase-done verification_filter`, after finishing you must also run `update-counts --p0 N --p1 N --p2 N` to write the post-verification final counts back to `.review-progress.json` (hinted on the last row of Convention B).

> **Purpose**: Step 3 produces a "candidate issue list" (P0/P1/P2 drafts). This step is responsible for **clearing out all false positives, nits, and filler items**, and for ensuring every real issue has a complete evidence chain.
>
> **Execution order**: first **4.1 five-question verification** (kill false positives) → then **4.2 value filter** (fix signal-to-noise) → then the later 🚦 five engineering self-check gates. All three must pass before entering `output the report`.
>
> **Key discipline**: drafts produced in this step **must not be shown to the user**; only items that finally pass enter the report.

### 4.1 Every issue candidate must pass the "verification 6 questions Q0-Q5 (review yourself)"

For **every P0 / P1 / P2** in the draft, answer the 6 questions in the table in order. If any item fails, handle it per the rule:

| # | Question | Pass standard | On fail |
|---|------|---------|-----------|
| **Q0** | **Cross-file scan** (fires only when the issue involves "a change that external code can depend on") | Trigger scope: ① signature change of an **exported function / Hook / component props / type / constant**; ② add/remove/type-change of a **DTO / API field**; ③ add/remove/semantic change of a **Store observable**. After firing you must attach **the Grep command + hit count + Read result of at least 1 sampled call site**, and register it in the item's trailing `cross-file verification` field | **P0/P1 downgrade directly to P2 (pending confirmation)**; also mark in the report "cross-file verification was not done, cannot assert P0/P1". Q0 must never be "skipped" — skipping counts as a false-positive candidate |
| Q1 | **Line-number verification** | Use the `Read` tool to actually open that line of that file; the content you see matches the "problem code" snippet (or the snippet is excerpted verbatim from that region) | **Delete the item immediately** (keeping "from memory" items is forbidden) |
| Q2 | **Consequence made concrete** | You can write three elements: "**① trigger condition** (which scenario/input makes it happen) + **② observable symptom** (what the user/monitoring/logs see) + **③ impact magnitude** (all users / a specific path / an edge case, or affected RPM / request share)". Fuzzy words like "might be a problem", "readability dropped", "reduces maintainability", "increases cognitive load" are not allowed | P0/P1 → downgrade to P2 (pending confirmation); P2 → delete |
| Q3 | **Rule excerpt** | The item's trailing `rule excerpt` field **actually quotes** a ≤50-character supporting text (may come from the G1-G13 pocket card, a knowledge-base section, or a sentence from the target-repo conventions). **Empty field / only a tag like "see G3" → Q3 fails** | P0 → downgrade to P1; P1 → downgrade to P2; P2 → delete |
| Q4 | **Reverse self-ask** | Ask yourself once: "If I were the PR owner and saw this, would I feel the AI is padding?" If the answer is "yes" | P1/P2 → delete; P0 may be kept but must strengthen Q2 (otherwise downgrade to P1) |
| Q5 | **Cost labeled** | Explicitly write the fix cost: `1 line` / `1 function` / `cross-file` / `needs refactor`. Cost and benefit are badly mismatched (e.g. suggesting a "global refactor" for one P2) | Delete the item |

> **Q0 special note**: this step is the "mandatory version" of Step 3's "context expansion" table — Step 3 only suggests searching callers at suspicious places; Q0 is a **forced check** after P0/P1 drafts exist. If there is an interface/contract change and you did not search callers, default it to "looks wrong locally but may be right overall" and do not raise it to P0/P1.

**Execution steps (finish these in order before entering 4.2)**:
```
for each candidate issue in (P0_draft, P1_draft, P2_draft):
    answer Q0 → Q5 in order (if Q0 does not fire, skip straight to Q1)
    record this item's "verification conclusion" (pass / delete / downgrade to Px)
    if downgraded: move the item to the matching draft list
    if deleted: remove it from the draft; leave no trace
```

> **Q1 special note**: for multiple issues in the same file, one `Read` of the file can be reused; but **do not** skip Q1 and confirm "from the diff fragment", because a diff shows only changed lines plus a little context and line numbers may be shifted.

### 4.2 Value filter · Signal-to-noise gate

After 4.1, do a global filter:

| Rule | Threshold / requirement | Over-limit handling |
|------|------------|---------|
| **P1 item cap** | ≤ 5 items | Sort by "severity if unfixed × 1/fix cost", keep Top 5, downgrade the rest to P2 or merge into "N more of the same kind" |
| **P2 item cap** | ≤ 8 items | Same as above; delete anything over the cap |
| **Same-kind merge** | The same rule fires in ≥3 files | Merge into 1 item, append "N more of the same kind: file1:line, file2:line, …" |
| **Pure-style throttle** | Naming / comment / formatting issues in the whole report ≤ 2 items | Over the cap, keep only the 2 with the largest impact |
| **"Suggestion" ban** | No item description may contain soft wording such as "consider", "you could try", "perhaps" | Rewrite as "[Fix action]: …" or delete |
| **No cap on P0** | Security / correctness issues must all be kept | —— |

**After 4.1 + 4.2 finish, you must append one line to the report `📋 Context analysis` section**:
```
📊 Verification summary: X candidates → Y after verification (deleted A / downgraded B / merged C)
```
If this line is missing → treat Step 4 as skipped and redo it.

### 4.3 Mandatory fields per issue (aligned with the report template)

Every issue that passed 4.1 + 4.2 must have all of the following when it enters the report:
- `location` `basis` `rule excerpt` `runtime consequence` `bad code` `fix code` (all required for P0 + P1; P2 at least has `location` + `basis` + `pending-confirmation notes`)
- `impact if unfixed`: Q2's three elements — **trigger condition + observable symptom + impact magnitude** (all users / specific path / edge case)
- `fix cost`: `1 line` / `1 function` / `cross-file` / `needs refactor` (Q5 artifact)
- `cross-file verification`: **required when Q0 fired** (Grep command + hit count + sampled call site); write `—` when it did not fire
- `rule excerpt`: **Q3 artifact; a real excerpt is required** (≤50 characters); tag-style writing like "see G3" is not allowed
- Missing any field → must not output; go back to 4.1 and fill it

---

## 🚦 Pre-output self-check gates (5 items, cannot skip)

| # | Check item | How to write the conclusion |
|---|--------|---------|
| 1 | Engineering-config changes (webpack/vite/tsconfig/.env/CI) | `✅ not involved` / `⚠️ changed, already explained` |
| 2 | Legacy-logic changes (predicates / authz / state transitions) | `✅ no change` / `⚠️ changed, impact at N sites already assessed` |
| 3 | Money/points calculation (price/amount/fee fields) | `✅ not involved` / `⚠️ involved, precision already verified` |
| 4 | Dependency upgrades (package.json / major version) | `✅ not involved` / `⚠️ upgraded, changelog already checked` |
| 5 | Exception handling (empty catch / Promise pending) | `✅ handling complete` / `❌ issue found [description]` |

---

## Output the report

Section skeleton is in `$SKILL_DIR/report-formats/findings-report.md`. Async-incident examples are in `$SKILL_DIR/examples/async-incidents.md`.

> ⛔ **Strictly forbidden**: outputting a chat summary, a bullet-point wrap-up, or conversational endings like "want me to help you fix it?".
> ✅ **Required**: output a complete structured report in the following structure; every section must exist (even if the content is "not involved").
>
> **Batched output rule** (grouped / two-phase modes): after each group finishes, first output that group's sub-findings list (same format as the official report's P0/P1/P2 sections),
> then after all groups finish, output the merged "Overall assessment" section. This avoids dumping one ultra-long report that itself consumes a lot of context.

### Sections the report must contain (in order)

```
### 📋 Context analysis
  - This PR's change intent (copy one sentence from the step 0.1 intent declaration)
  - List of files already read + key-change notes
  - **Impact scope (Grep results; must paste the command + hit count + sampled call site)**:
    - Format: one item per line — `Grep pattern='<regex>' glob='<scope>' → N hits, sample <file>:<line>`
    - Writing only a conclusive "already Grepped impact scope" → treat the scan as skipped; this section fails
    - Q0 did not fire (this PR has no exported function/DTO/Store observable change) → write explicitly "no Q0 trigger", do not leave it blank
  - 📊 Verification summary: X candidates → Y after verification (deleted A / downgraded B / merged C)   ← Step 4 artifact, required

### 📁 File coverage matrix (required; name every diff file)
  - **How to generate**: `Read .cr-files.txt` for the plain file list (forbidden to Read the entire `.code-review-diff.tmp`), then for **each** file run `awk '/^\+\+\+/||/^---/{next} /^\+/{a++} /^-/{d++} END{print a,d}' .cr-diffs/<safe>.diff` to get +/- counts; when `src !== dst` record as `<src> → <dst>`
  - **Headers**: `# / file / added / deleted / review status / issue count`; initial status `❌ not reviewed (must fill)` , issue count `—`; order follows `.cr-files.txt`
  - **Status is one of four**: `✅ reviewed (N issues)` / `✅ reviewed (no issues)` / `⚠️ partial review (state what was not covered)` / `❌ not reviewed (must fill)`
  - Any ❌ row → this CR fails; do not output a final conclusion; you must finish the missing review and rerun
  - In multi-agent mode: after the main agent merges sub-agent results it **must** cross-check this matrix; files a sub-agent did not review must be reviewed by the main agent

### 🤖 Automated detection results
  - Security scan (2.1, mandatory, `security-scan.js` partitioned scan): ✅ pass / ❌ issue description (critical/high/medium counts)
  - Dependency scan (2.2, optional, index.js): ✅ pass / ❌ issue description / ⚠️ not executed (reason: permission intercept / missing dependency / Node error)

### 🚦 Five-item self-check conclusions
  (5-item table; every item must have an explicit conclusion; blanks are not allowed)

### 🔎 Necessity review conclusions (artifact of N1-N5's 5 questions on the change; required)
  - N1 intent alignment: ✅ all aligned / ⚠️ found X "intent-unclear changes" (list below)
  - N2 can it be deleted: ✅ no redundancy / ⚠️ found X deletable places (see G11 / P1 section)
  - N3 can it be simpler: ✅ already simplest / ⚠️ found X simplifiable places
  - N4 duplicates existing: ✅ no duplicates / ⚠️ found X places that duplicate an in-repo approach
  - N5 API contract: ✅ unchanged / ❌ found X DTO contract mismatches (G12 / P0)
  - 🔎 Intent-unclear change list (fill when N1 fails): [file:line] —— change summary —— "what happens if we don't change it" the PR author must answer

### 🔴 P0 issues (fields per item: location, basis, rule excerpt, impact if unfixed, fix cost, bad code, fix code)
### 🟡 P1 issues (fields per item: location, basis, rule excerpt, impact if unfixed, fix cost, bad code, fix code)
### 💡 P2 issues (fields per item: location, basis, pending-confirmation notes, fix cost)

### 🧐 AI unease list (required 3-5 items, independent of and parallel to P0/P1/P2; "none" is not allowed)
  - Do not look up rules, do not cite the knowledge base; pure intuition
  - Format per item: `[file:line] —— Odd because: xxx —— Explanation: xxx`
  - Items already upgraded to P0/P1/P2 stay on this list, marked `→ upgraded to Pn-N`
  - See Step 3.5 hard rules for details

### 📊 Overall assessment (6-dimension scores + one-sentence conclusion)

Six-dimension score table (1-5 per dimension, 5 is best):
| Dimension | Score | Main findings |
|------|------|---------|
| 🔴 Security & correctness | /5 | |
| 🔴 Async & state | /5 | |
| 🟡 Type safety | /5 | |
| 🟡 Performance | /5 | |
| 🟡 Robustness & design | /5 | |
| 💡 Architecture & maintainability | /5 | |

**One-sentence conclusion**: (merge recommendation / P0 count / whether it is mergeable)
```

### Standard format for each issue item

```markdown
**[Px-N] Issue title**
- **Location**: [file-path:line](clickable link)
- **Basis**: pocket card G3 / typescript-review-rules.md §2
- **Rule excerpt**: (**real excerpt**, ≤50 characters, required for P0/P1; tag-style citations like "see G3" are forbidden)
   e.g. "A catch block must not be empty; swallowing exceptions is P0." — review-playbook.md §P0 pocket card G3
- **Impact if unfixed**: (Q2 three elements, required for P0/P1)
   ① Trigger condition: (which scenario/input makes it happen)
   ② Observable symptom: (what the user / monitoring / logs see)
   ③ Impact magnitude: (all users / a specific path / an edge case / affected share)
   e.g. ① The user denies location or it times out ② The "use current location" button spins forever ③ Affects only the first-open map visitor path
- **Fix cost**: one of the four tiers `1 line` / `1 function` / `cross-file` / `needs refactor`
- **Cross-file verification**: (required when Q0 fired, otherwise write `—`)
   e.g. `Grep pattern='customerDTO' glob='**/*.{ts,tsx}' → 7 hits, sample src/pages/checkout/form.tsx:45 already Read and confirmed it must change in sync`
- **Problem code**:
  ```js
  // ❌ current writing
  ```
- **Fix**:
  ```js
  // ✅ after the fix
  ```
```

P2 item format (shorter):
```markdown
**[P2-N] Issue title**
- **Location**: [file-path:line](clickable link)
- **Basis**: (rule source)
- **Pending-confirmation notes**: (the concern + what must be verified before grading)
- **Fix cost**: `1 line` / `1 function` / `cross-file` / `needs refactor`
```

> **Quality gate**: an item without `location` + `basis` + `rule excerpt` (real excerpt) + `impact if unfixed` (three elements) + `fix cost` + `cross-file verification` (when Q0 fired) + code snippets is not a qualified CR output. Step 4 will forcibly intercept; unqualified items are deleted or downgraded.

### Common P0 / P1 misgrade corrections

| Common misgrade | Correct level | Basis |
|---------|---------|------|
| Empty catch block / catch then immediately throw | **P0** (not P1) | Pocket card G3 |
| `as unknown as X` double assertion | **P0** (not P1) | typescript-review-rules.md §2 |
| `new Promise` missing the else branch | **P0** (not P1) | Pocket card G1 |
| `if (count)` when count may be 0 | **P0** (not P1) | Pocket card G2 / JS §2.1 |
| Incomplete useEffect dependency array | **P1** (not P0) | React §1.1 |
| Nonstandard naming / missing comments | **P2** (not P1) | Convention-class issues |

### Code link format

Fill `{org}` `{repo}` `{branch}` `{path}` `{line}` using config `git.codeBrowseUrlTemplate`.  
If the template is empty or parsing fails → backticks `` `src/components/Foo.tsx:45` ``. Do not hand-write an unconfigured hosting hostname.

---

## After the review

If config has `integrations.notify` enabled, first write a summary that **contains no source** and then call (skip on failure):

```bash
# .cr-notify-payload.json contains only mode / files / p0 / p1 / p2 / conclusion
node $SKILL_DIR/tooling/invoke-integration.js notify \
  --org "$org" --repo "$repo" --branch "$currentBranch" --base "$BASE_BRANCH" \
  --body-file .cr-notify-payload.json
```

`integrations.telemetry` likewise reports counts only, never source.

```bash
rm -rf .code-review-diff.tmp .cr-diffs/ .cr-files.txt .cr-findings-*.json .cr-group-*.json .cr-sub-*.json .cr-extra-knowledge.md .cr-notify-payload.json
node $SKILL_DIR/tooling/review-progress.js cleanup   # optional
```

> If this review ended early due to an exception and the user may continue asking (e.g. a second review, a local revision) → **do not cleanup yet**; keep `.review-progress.json` / `.code-review-diff.tmp` / `.cr-diffs/` / `.cr-findings-*.json` for the next resume. Cleanup only when "the review is thoroughly done and there is no need to return to this diff".
> If `rm` is permission-intercepted, tell the user "please delete these intermediate files manually" and **do not retry repeatedly**.

## Signal recycling (append when encountered)

| Situation | Which type to write in `$SKILL_DIR/playbook/review-feedback-journal.md` |
|------|---------------------------------------------------|
| Developer says "this is fine; the AI misjudged" | Type 1: false positive |
| Developer mentions "we hit a similar pit last time" | Type 2: false negative |
| A valuable new pattern not in the knowledge base is found | Type 3: new pattern |

> Do not force a write when none of the above happened.
