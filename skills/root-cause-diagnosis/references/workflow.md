# Diagnosis workflow

Copy this checklist and track progress. Do **not** load this file before `run`. After a successful `run` with `facts` / `factsPath`, skip to Step 5.

```
Task Progress:
- [ ] Collect exception evidence and code location
- [ ] run (parses, brief, facts.json, heading skeleton)
- [ ] Fill report.draft.md from facts.json
- [ ] write-report --from-draft
- [ ] Show stdout chat.en + report paths
```

## Step 1: Inputs

**Exception evidence** (required): paste, `--exception`, or `--exception-file`. Includes stack traces, exception logs, call-chain dumps, debug output, and printed errors.

**Code location** (one of):

| User gives | CLI |
|---|---|
| Git URL + branch | `--git` + `--branch` (clone into `data/<taskId>/repo`) |
| Uploaded business file | `--file /abs/path/Foo.java` (preferred for this interaction) |
| Local / already-open IDE project | `--dir /abs/path` |
| Nothing but an open workspace | omit both; `submit` uses `cwd` |

**Uploaded / non-git strategy (CodexQA):** `codexqa index` requires a git repository. Never `git init` in the user's original folder. `submit` copies the uploaded file, stack-referenced siblings found in that folder, and other **top-level** source files in the same directory into `data/<taskId>/repo`, then `git init` **only in that task copy**. Nested trees (`node_modules`, nested checkouts, `.testcase-generation`) are not walked. If the origin already has `.git`, index it in place.

Do not clone a remote when `--file` / `--dir` / cwd already has the business code. A `--git` value that is an existing local path is treated as a local origin.

If exception text is missing, ask. If git, file, and dir are all missing, use cwd as origin.

## Step 2: run (preferred)

One process: parse, resolve repo, index (incremental unless `--force-reindex`), slice app frames, extract facts.

```bash
node "$SKILL_SCRIPT" run --exception-file "$PATH" --file "$BUSINESS_FILE"
# or: --dir "$LOCAL_DIR"
# or: --git "$GIT_URL" --branch "$BRANCH"
```

Stdout includes `taskId`, `localDir`, `timings`, `nextCli`, `facts`, and `analyzed.brief`. Persist nothing by hand; the CLI writes `meta.json` and `exception.txt`. If `codexqa.ready=true` and `brief` is present, facts come from it. `parse-exception` is already done. Do not run `--help`.

If `facts` / `factsPath` are present, skip Steps 3–4.

## Step 3: CodexQA index (only if run/submit did not index)

```bash
node "$SKILL_SCRIPT" ensure-codexqa --task-id $TASK_ID --with-analyze
```

Retry once with `--force-install` if `ready=false` and Node/npm can be fixed. Use `--force-reindex` only when the tree changed under CodexQA's feet. If index fails with `not a git repository`, the CLI rematerializes `data/<taskId>/repo` from `meta.originDir` + `--file` + stack frames and indexes again. Then continue; mark graph evidence weak if still `ready=false`.

## Step 4: Parse and slice frames (skip if run already did)

`submit`/`run` already wrote `parsed.json`. Re-parse only if that file is missing (`parse-exception --force` to overwrite).

```bash
node "$SKILL_SCRIPT" analyze-frames --task-id $TASK_ID
```

`analyze-frames` queries CodexQA **in parallel** for each unique **app** frame (Class#method symbols → source + callers/callees) and writes compact `data/<taskId>/codexqa/analysis.json`. Load [exception-parse.md](exception-parse.md) only when `facts`/`brief` are missing and `parsed.json` must be interpreted by hand.

## Step 5: Facts (CLI) then narrative (model)

1. Use stdout `facts` or read `data/<taskId>/facts.json` **once**. Skip `analysis.json` unless a source slice is missing.
2. `facts` already has throw key, in-repo root, entry, hops, extracted branch, `lineDrift`, swallow key, confidence, and `mustCite`.
3. Open a source file only if a cited line is outside brief `source`. Never open a whole 600-line class.
4. If a method key is missing and `meta.codexqa.ready=true`, re-run `analyze-frames` once — never open `~/.codexqa/`.
5. Write the call-path story into the empty `##` bodies of `report.draft.md`. Keep headings. Do not copy facts as slogans. Do not invent frames.
6. Executive summary must contain the literal `Confidence:` plus `high`, `medium`, or `low`, and must **not** overstate to `high` when `facts.confidence` is `medium`. Mapped must include `facts.branch.thenCall` and the throw class. Root must include the throw class, `facts.branch.elseCall`, and `hypothesis` when `lineDrift` is non-empty. Include race language **only when** `facts.raceEvidence` is true; cite swallow **only when** `facts.swallowKey` is set; never invent line-drift or weak-frame claims without facts. Trigger must include the throw class and `not the root`.
7. Do not load unrelated skills, do not invent `Class#search:1` for `→ Class` tails, and do not read `scripts/*.ts` on the happy path.

## Step 6: Report

Follow `SKILL.md` **Report rules** (load [report-template.md](report-template.md) only if those rules are not already in context): English only; Mapped call path / Root cause should tell the full hop story (prompt hint 300 字); other `##` prompt hint 100 字. Those numbers are hints, not a `write-report` reject. Do not pre-count 字 or trim to fit.

```bash
node "$SKILL_SCRIPT" write-report --task-id $TASK_ID --from-draft
```

If stdout has `storyGaps`, add the missing cite **once** using that output, then retry `--from-draft`. Do not retry to shrink length.

Show the user **one English paragraph** from stdout `chat.en` (the first line of Executive summary), then the report paths. If `chat.en` is empty, use that summary line. Files are `data/<taskId>/report.md` and `report.en.md`. Do not paste the full document into chat.
