# Workspace initialization

This is the first step after the skill clears the routing gate. This Skill creates or reuses a unified local working directory. `run_dir` comes from a user-specified path, an existing `userConfig.runDir`, or the default `$HOME/codexqa-testdata-generator/runs/{runid}`. Do not pre-place a knowledge pack. All later-stage file reads and writes are based on this directory structure.

## Unified directory structure

### run_dir description

`{run_dir}` is determined by this Skill from the user interaction:

1. The local run directory the user explicitly gave in this turn
2. The `runDir` in `{run_dir}/testcase/testdocs/userConfig.json` already written in the current conversation
3. When neither of the above exists, create the default directory `$HOME/codexqa-testdata-generator/runs/{runid}` (`runid` is this task's id)

Regardless of the source, during initialization write the determined absolute path into `runDir` of `{run_dir}/testcase/testdocs/userConfig.json`. `userConfig.runDir` and the working directory are the same path: if the user specified a directory, write that directory; otherwise by default write the expanded `$HOME/codexqa-testdata-generator/runs/{runid}`. When the field is missing or empty, backfill it with that default. Do not change another directory the user explicitly specified. Store all artifacts uniformly under `{run_dir}`; the original internal subdirectories (`knowledge/`, `testdesign/`, `testcase/`, etc.) stay the same. During initialization create all subdirectories in one pass (skip those that already exist).

### Directory structure

```
{run_dir}/                                   # Run root directory (default $HOME/codexqa-testdata-generator/runs/{runid})
├── knowledge/                                # Optional knowledge pack (this Skill bootstraps index.md)
│   ├── index.md                              # Knowledge index; empty index when there is no user knowledge source
│   ├── knowledge-manifest.json               # Bootstrap result
│   ├── repo/                                 # Shallow clone when the user explicitly gave a Git URL
│   └── pack/                                 # Markdown copied from a local directory or cloned repo
├── testdesign/                               # Test-design artifact directory (created by this Skill)
│   ├── test_design.md                         # Stage 5 only formal test plan
│   ├── testcase_generation_report.html        # Stage 6 aggregated Web/Server/APP case report
│   └── testdesign_changelog.md                # Stage 5 changelog
├── testcase/                                 # Test-case and knowledge-artifact root
    ├── testdocs/                             # userConfig and Stage 0 through 4-1 materials/reports
    │   ├── userConfig.json                   # Bootstrap config (runid, runDir, etc.)
    │   ├── run-status.json                   # Plan/Exec stage pointer (currentStage)
    │   ├── _ingest/                          # Stage 0 local-ingest intermediate artifacts
    │   ├── requirement-[title].md             # Stage 0 cleaned requirement materials
    │   ├── tech-spec-[title].md             # Stage 0 cleaned technical-design materials
    │   ├── stage0-input-processing-report.md
    │   ├── stage1-requirement-analysis-report.md
    │   ├── stage2-impact-and-risk-report.md
    │   ├── stage3-coverage-judgment-report.md
    │   ├── stage4-test-design-report.md          # Stage 4 first draft; Stage 4-1 audit edits in place
    │   └── stage4-1-audit-receipt.md             # Stage 4-1 audit trail (required)
    ├── knowledge-biz/                        # Close-reading and decision artifacts
    │   ├── {project-name}/
    │   │   ├── knowledge-audit.md
    │   │   ├── stage1-requirement-analysis/
    │   │   ├── stage2-impact-analysis/
    │   │   ├── stage3-case-recall/
    │   │   ├── stage4-test-design/
    │   │   ├── stage6-case-generation/
    │   │   └── incremental-case-enhance/
    │   └── decision-records/{project-name}/
    ├── initialcase/                          # AI-generated first-version cases (incremental read-only)
    ├── procase/                              # Protected copy from the first diff enhancement; read-only afterward
    ├── testcase_changelog.md
    ├── cases/                                # Latest-version cases (incremental publish target)
    ├── .case-enhance/{executionId}/          # Post-submit incremental process area
    └── .pr-cache/                            # Incremental cache for explicitly given PR code
```

> **Bootstrap config**: `{run_dir}/testcase/testdocs/userConfig.json` stores config (runid, runDir, optional knowledgeSource / knowledgeGitUrl). `{run_dir}/testcase/testdocs/run-status.json` stores the Plan/Exec stage pointer. This Skill does not bind a remote case space and does not write a usable remote `projectId`. Do not write artifacts outside `{run_dir}`.

## Term conventions (apply throughout)

| Term | Meaning |
|------|------|
| **run_dir** | Run root directory, specified by the user or newly created by this Skill; default `$HOME/codexqa-testdata-generator/runs/{runid}`, where `{runid}` is the task id |
| **local run config** | `userConfig.json` saves only local fields such as runid, runDir, and optional knowledgeSource / knowledgeGitUrl |
| **test-design artifacts** | Stages 0 through 4-1 in `{run_dir}/testcase/testdocs/`; Stage 5 formal test plan in `{run_dir}/testdesign/` |
| **incremental process area** | `{run_dir}/testcase/.case-enhance/{executionId}/`; the publish target remains `{run_dir}/testcase/cases/` |
| **project name** | Automatically extracted from this run's requirement document or technical design, taking the document title; used for document titles and isolation under `testcase/knowledge-biz/` |

---

## Initialization execution flow

```
Locate {run_dir} from the user-specified path / an already-present runDir in the conversation / the default new directory
Check whether {run_dir}/testcase/testdocs/userConfig.json exists
  ├── Does not exist → [Path A: first-time initialization] execute Steps 1–5
  └── Exists   → [Path B: existing workspace]
            ├── Intent is generate a plan / generate cases / both / pre-submit update / post-submit incremental
            │     → Execute only Step 4; skip the rest
            └── Other intents (for example switch project)
                  → Execute the corresponding dedicated operation
```

---

## Path A: first-time initialization

### Step 1: Generate runid and determine run_dir

This `runid` is the current Skill's own workspace identity, and also the task id in the default path.

```bash
runid=$(date +%Y%m%d-%H%M%S)

# If the user specified a directory this turn, use it; otherwise create the default directory
if [ -n "${USER_RUN_DIR}" ]; then
  rundir="${USER_RUN_DIR}"
else
  rundir="$HOME/codexqa-testdata-generator/runs/${runid}"
fi

mkdir -p "${rundir}/testcase/testdocs"
mkdir -p "${rundir}/testcase/knowledge-biz"
mkdir -p "${rundir}/knowledge"
mkdir -p "${rundir}/testdesign"
```

### Step 1b: Bootstrap the knowledge pack (local directory or user Git URL)

If the user provided a local knowledge directory, or **explicitly** gave a knowledge-repo Git URL, generate the index with the script; otherwise write an empty index and do not block. Do not auto-extract Git/HTTP links from the requirement body as a knowledge repo. Do not call a knowledge-retrieval Skill.

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/bootstrap_knowledge.py \
  --output-dir "${rundir}/knowledge" \
  --source "${USER_KNOWLEDGE_DIR}" \
  --git-url "${USER_KNOWLEDGE_GIT_URL}" \
  --git-ref "${USER_KNOWLEDGE_GIT_REF}"
```

Both `--source` and `--git-url` may be omitted. When both are omitted, `knowledge/index.md` is still generated, with an entry count of 0. When both are given in this turn, take the Git URL as authoritative, shallow-clone, then build the index. On clone failure, write an empty index and `FAIL`; Plan/Exec continues. An empty index is valid; do not mid-run ask for a knowledge source. stdout is a single JSON (`ok`, `msg`, `indexPath`, `entryCount`); per the "script long-output handling spec", redirect stdout only and then parse.

### Step 2: Write the local run config

Execute when `userConfig.json` does not exist. This Skill **does not connect to a case platform** and does not ask about a remote space.

```json
{
  "projectId": "",
  "projectName": "",
  "projectSource": "none",
  "staffId": "",
  "initTime": "<init time YYYY-MM-DD HH:mm:ss>",
  "runid": "<run ID, format YYYYMMDD-HHmmss>",
  "runDir": "<run root directory, e.g. /Users/name/codexqa-testdata-generator/runs/20260820-143000>",
  "knowledgeSource": "<local knowledge directory the user provided; empty if not provided>",
  "knowledgeGitUrl": "<knowledge-repo Git URL the user explicitly gave; empty if not provided>",
  "knowledgeGitRef": "<optional branch or tag; empty if not provided>"
}
```

**runid generation rule**: auto-generate on first-time initialization, format `YYYYMMDD-HHmmss`. An existing workspace reuses the existing runid.

**runDir determination rule**: user-specified path → `userConfig.runDir` already restored in the conversation → default `$HOME/codexqa-testdata-generator/runs/{runid}`. Both first write and missing-field backfill use that default's expanded absolute path. After writing, later stages only read and reuse from the JSON.

| Field | Type | Default | Description |
|------|------|--------|------|
| `runid` | string | auto-generated | This task id / unique run identifier |
| `runDir` | string | `$HOME/codexqa-testdata-generator/runs/{runid}` | Run root directory; same as the default working directory; must write the expanded absolute path |
| `knowledgeSource` | string | empty | Local knowledge directory the user provided; empty means no local directory was given |
| `knowledgeGitUrl` | string | empty | Knowledge-repo Git URL the user explicitly gave; empty means no Git was given |
| `knowledgeGitRef` | string | empty | Optional branch or tag |
| `projectId` / `projectName` | string | empty | Reserved fields, always empty |
| `projectSource` | string | `none` | Always `none` |

Stage 3 treats all scenarios as new per [s03-coverage-judge.md](s03-coverage-judge.md).

After writing `userConfig.json`, write `{run_dir}/testcase/testdocs/run-status.json` if it does not exist:

```json
{
  "statusContractVersion": "1.0",
  "currentStage": "0",
  "completed": [],
  "lastGate": null,
  "planPersistedAt": "",
  "execAllowed": false
}
```

`currentStage` is the stage the Agent may work on now (`0` | `1` | `2` | `3` | `4` | `4-1` | `5` | `6`). Advance it only with `scripts/close_stage.py`. Do not infer `completed[]` from reports.

### Step 3: (removed)

> The original step was a full local sync of the case library; it has been removed.

### Step 4: Prepare the test-design node + case directories

See [Step 4] below; Path A and Path B share it.

### Step 5: Output the initialization result

```
Workspace initialization complete!

📁 Run directory: {run_dir}
📋 Run mode: user-conversation driven, local Plan/Exec only
📚 Knowledge pack: bootstrapped from a local directory (or: empty index, generic layer only)
⚙️ User config: {run_dir}/testcase/testdocs/userConfig.json
📂 Stage 0 through 4-1 test-design artifacts: {run_dir}/testcase/testdocs/
📋 Stage 5 formal test plan: {run_dir}/testdesign/test_design.md
📝 Stage 5 changelog: {run_dir}/testdesign/testdesign_changelog.md

📂 Close-reading artifacts: {run_dir}/testcase/knowledge-biz/{project-name}/
🧾 Knowledge audit: {run_dir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md
🧠 Analysis basis and conclusions: {run_dir}/testcase/knowledge-biz/decision-records/{project-name}/

📂 Case root: {run_dir}/testcase/
   ├── initialcase/  AI-generated first-version cases (incremental read-only)
   ├── procase/      Protected copy from the first diff enhancement
   ├── cases/        Latest-version cases
   └── .case-enhance/ Post-submit incremental process area
```

---

## Path B: existing workspace (execute when userConfig.json exists)

When userConfig.json already exists under `{run_dir}/testcase/testdocs/`:

- Restore `run_dir` from `userConfig.runDir` per the shared-rules "Stage entry check"
- Read `run-status.json` and continue from `currentStage`. If that file is missing, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --init` (writes `currentStage` `0`; do not infer `completed[]` from reports; re-close existing stages in order)
- Do not ask, and do not bind a remote case space
- **Execute only Step 4**

If the user **actively provides** a new local knowledge directory or knowledge-repo Git URL in this turn, run Step 1b once more to overwrite the `knowledge/` index, and update `knowledgeSource` / `knowledgeGitUrl` / `knowledgeGitRef`. Do not actively ask for a knowledge source just to fill dimensions.

---

## Step 4: Prepare the test-design node + case directories (shared by Path A and Path B)

**Automatic project-name extraction rules (do not ask the user):**

- If the user provided a **local file** of a requirement document or technical design: take the first-level heading (`h1`) inside the file; if there is no `h1`, take the filename (without extension)
- If the user provided a **local directory**: prefer the first-level heading of the main document in the directory (`README.md` / `index.md` / requirement*.md); otherwise take the directory name
- If the user provided a **text fragment**: summarize and distill the content into a short project name (no more than 20 characters)
- If the user provided only a **remote link** and no local file: do not open that link to fetch a title; first ask the user to supply local materials per Stage 0
- Name handling: strip filesystem-illegal characters (`/ \ : * ? " < > |`); keep Chinese characters, letters, digits, hyphens, and underscores
- **Use it directly after extraction; no need to ask the user for confirmation**

After extracting the project name:

1. Determine `run_dir`: if the user specified a path and userConfig already exists → read `runDir` from it; otherwise the user-specified path or the default new directory.

> Convention: the code block below uses variables only; `{placeholder}` appears only in explanatory text and replacement slots produced by this step such as `{project-name}`.
> Variable sources: `USER_RUN_DIR` = the directory the user specified this turn (empty if none); `runid` = the run identifier generated on first-time initialization.

```bash
if [ -n "${USER_RUN_DIR}" ] && [ -f "${USER_RUN_DIR}/testcase/testdocs/userConfig.json" ]; then
  rundir=$(<skill_dir>/scripts/tcg-python -c "import json; print(json.load(open('${USER_RUN_DIR}/testcase/testdocs/userConfig.json'))['runDir'])")
elif [ -n "${USER_RUN_DIR}" ]; then
  rundir="${USER_RUN_DIR}"
else
  rundir="$HOME/codexqa-testdata-generator/runs/${runid}"
fi

mkdir -p "${rundir}/testcase/testdocs"
mkdir -p "${rundir}/testdesign"
mkdir -p "${rundir}/testcase/knowledge-biz/{project-name}"
audit_file="${rundir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md"
if [ ! -f "${audit_file}" ]; then
  printf '# Knowledge work audit\n\n> This file records, in execution order, the knowledge checks, reuse, close reading, adoption, gaps, and degradation actions that actually occurred in each stage.\n> Analysis basis and conclusions are saved separately under knowledge-biz/decision-records/{project-name}/; do not write them into this file or the close-reading stage directories.\n\n' > "${audit_file}"
fi
decision_dir="${rundir}/testcase/knowledge-biz/decision-records/{project-name}"
mkdir -p "${decision_dir}"
mkdir -p "${rundir}/testcase/initialcase/testcase_app/testcases"
mkdir -p "${rundir}/testcase/initialcase/testcase_web/testcases"
mkdir -p "${rundir}/testcase/procase/testcase_app/testcases"
mkdir -p "${rundir}/testcase/procase/testcase_web/testcases"
mkdir -p "${rundir}/testcase/cases/testcase_app/testcases"
mkdir -p "${rundir}/testcase/cases/testcase_web/testcases"
```

**Directory reuse rule**: if `{run_dir}/testcase/testdocs/` already exists, reuse it directly and output "Detected existing test-design testdocs node; continue using it". Do not write outside `{run_dir}`.

---

## Path conventions for later stages

This table is the repo-wide single source of truth for "artifact → path" mapping; other files only cite this table.

After initialization completes, later stages read `run_dir` from the `runDir` field of `{run_dir}/testcase/testdocs/userConfig.json`:

| Purpose | Path |
|------|------|
| Run directory (run_dir) | `$HOME/codexqa-testdata-generator/runs/{runid}` (user-specified or default newly created) |
| User config | `{run_dir}/testcase/testdocs/userConfig.json` |
| Plan/Exec run status | `{run_dir}/testcase/testdocs/run-status.json` |
| Optional local knowledge directory | `{run_dir}/knowledge/` (bootstrapped by this Skill; optionally copies the user's knowledge directory) |
| Optional local knowledge index | `{run_dir}/knowledge/index.md` (an empty index still counts as bootstrapped; entry count may be 0) |
| Close-reading artifact root | `{run_dir}/testcase/knowledge-biz/{project-name}/` |
| Knowledge work audit | `{run_dir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md` |
| Per-stage analysis basis and conclusions | `{run_dir}/testcase/knowledge-biz/decision-records/{project-name}/stage{N}-{scenario}.md` |
| Stage 0 through 4-1 test materials and analysis reports | `{run_dir}/testcase/testdocs/` |
| Stage 5 formal test plan | `{run_dir}/testdesign/test_design.md` |
| Stage 5 test-plan changelog | `{run_dir}/testdesign/testdesign_changelog.md` |
| Stage 6 aggregated HTML case report | `{run_dir}/testdesign/testcase_generation_report.html` |
| Test cases · initial version | `{run_dir}/testcase/initialcase/testcase_*/` |
| Test cases · procase | `{run_dir}/testcase/procase/testcase_*/` |
| Test cases · latest version | `{run_dir}/testcase/cases/testcase_*/` |
| Incremental execution workspace | `{run_dir}/testcase/.case-enhance/{executionId}/` |
| Incremental PR code cache | `{run_dir}/testcase/.pr-cache/{host}/{owner}/{repo}/` |
| Incremental review report | `{run_dir}/testcase/.case-enhance/{executionId}/outputs/reports/review-summary.md` |

| Artifact | Path |
|------|------|
| `test_design.md` | `{run_dir}/testdesign/test_design.md` |
| Test-plan changelog | `{run_dir}/testdesign/testdesign_changelog.md` |
| `testcase_generation_report.html` | `{run_dir}/testdesign/testcase_generation_report.html` |
| `userConfig.json` | `{run_dir}/testcase/testdocs/userConfig.json` |
| `run-status.json` | `{run_dir}/testcase/testdocs/run-status.json` |
| Requirement document content | `{run_dir}/testcase/testdocs/requirement-[title].md` |
| Technical design content | `{run_dir}/testcase/testdocs/tech-spec-[title].md` |
| Spec / analytics-event / other materials | `{run_dir}/testcase/testdocs/Spec-[title].md`, `analytics-event-[title].md`, or `[material-type]-[title].md` |
| Stage 0 input-processing report | `{run_dir}/testcase/testdocs/stage0-input-processing-report.md` |
| Stage 1 requirement-analysis report | `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md` |
| Stage 2 impact-and-risk report | `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md` |
| Stage 3 coverage-judgment report | `{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md` |
| Stage 4 test-design report (including Stage 4-1 audit corrections) | `{run_dir}/testcase/testdocs/stage4-test-design-report.md` |
| Stage 4-1 audit receipt | `{run_dir}/testcase/testdocs/stage4-1-audit-receipt.md` |
| Close-reading layer artifacts | `{run_dir}/testcase/knowledge-biz/{project-name}/stage{N}-{scenario}/` |
| Case list (dual-write initial version + latest version) | `{run_dir}/testcase/initialcase/testcase_*/` + `{run_dir}/testcase/cases/testcase_*/` |
| Single case file | `{run_dir}/testcase/initialcase/testcase_*/testcases/{ID}-{casename}.md` |
| Case index | `{run_dir}/testcase/initialcase/testcase_*/testcase_*_index.md` |
| Incremental decision / delivery / publish records | `{run_dir}/testcase/.case-enhance/{executionId}/` |

---

## Switch project

If the user later in the conversation asks to "switch project" or "create a new project", update the project name that corresponds to this run's input, and execute Step 4 to reuse `{run_dir}/testcase/testdocs/`, create or reuse `testcase/knowledge-biz/{project-name}/`, and reuse the existing case directories. Stages 0 through 5 do not create a new project-level test-design directory.
