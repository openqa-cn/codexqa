# Defect Detection

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

Agent-led static and business-logic defect detection for pull requests and test plans. **Input is a git repository and branch** (plus any requirements or test cases you can share). Local-first: CLI, static rules, and pluggable providers. The workflow is usable; detection accuracy is not independently benchmarked.

Sample HTML report (same renderer as a local run):

<p align="center">
  <a href="https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/defect-report.html"><img src="https://raw.githubusercontent.com/openqa-cn/codexqa/main/docs/assets/previews/defect-report.png" alt="Sample defect-detection HTML report" width="880"></a>
</p>

## What you get

- A complete CLI (`scripts/detect.ts`) for task create → clone/diff → analyze → write-back → report → user feedback
- A **local platform** that persists tasks, processes, ranks, tags, and rules on disk — usable without any private backend
- Adapters for HTTP quality platforms, GitHub Issues, local/remote test plans, test cases, and documents
- The original validation gates (`scripts/validate.ts`) so write-backs stay structured

## Requirements

- Node.js: tested on 22.15.0+ with `NODE_OPTIONS=--experimental-strip-types` (set this in **every** shell that runs the CLI)
- `git` on `PATH`
- Optional: `semgrep` for AST scans (seed packs for Java, Kotlin, Scala, JS, TS, Python, Go, C, C++, C#); Semgrep 1.x recommended — taint rules use `focus-metavariable`, which 0.8x rejects; rejected rules are dropped per version and reported in `droppedRules`. Auto-install via pip/brew is attempted on first `run-ast-scan`
- Optional overlays (`run-optional-overlays`): `gitleaks` (secrets), `trivy` or `grype` (SCA), `bandit` / `ruff`, `gosec` / `go vet` / `staticcheck`, `cppcheck`, `eslint`, `detekt` (native analyzers, per language of the diff). Missing binaries are skipped
- Optional: GitNexus for call graphs on JVM / Go / Python / C# repos (`DETECTION_SKIP_GITNEXUS=1` to opt out of the one-time global install)
- Network may be used for repository cloning, remote providers, document fetching, tool installation, and the host agent/model

No extra npm packages are required for local mode. GitNexus / Semgrep are local analyzers; they do not need a company backend.

## Install the skill (npx) vs run the CLI (node)

| Command | What it does |
|---|---|
| `npx skills add openqa-cn/codexqa --skill defect-detection` | Installs the skill into a coding-agent skills directory |
| `node scripts/detect.ts …` | Runs the detection CLI (this is **not** an `npx` binary) |

There is no `npx defect-detection` / package `bin`. After install, point `$SKILL_DIR` at the installed folder and run `node "$SKILL_DIR/scripts/detect.ts"`.

See the [installation guide](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md), [support matrix](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md), and [data-handling FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md).

## Quick start (end-to-end on the checkout fixture)

This uses the [checkout-boundary](https://github.com/openqa-cn/codexqa/blob/main/examples/checkout-boundary/README.md) seeded defect (`amount === 0` accepted) as a real git branch — no `acme/...` placeholder.

From the **repository root**:

```bash
export NODE_OPTIONS=--experimental-strip-types
export DETECTION_SKIP_GITNEXUS=1   # optional; fixture is JS, no Java call graph

# 1) Build a tiny git repo: main = known-good, feature/zero-accepted = seeded defect
FIXTURE=$(node examples/checkout-boundary/make-git-fixture.mjs)   # Node + git only; works on Windows too
echo "fixture=$FIXTURE"

cd skills/defect-detection
cp -n config.example.yaml config.yaml 2>/dev/null || true
# Runtime data (tasks, clones, reports) defaults to ./data — git-ignored. Set
# DETECTION_DATA_DIR (and optionally DETECTION_CLONE_DIR) to move it elsewhere.
mkdir -p data/_tmp

S="node scripts/detect.ts"

# 2) Create a task from the defective branch
TASK_JSON=$($S submit-git --git "$FIXTURE" --branch feature/zero-accepted --submit-user alice)
TASK_ID=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.data.taskId)' "$TASK_JSON")
BATCH_ID=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.data.batchIds[0])' "$TASK_JSON")
echo "taskId=$TASK_ID batchId=$BATCH_ID"

# 3) Clone + diff against main + build the detection plan
CLONE_JSON=$($S clone-and-diff \
  --task-id "$TASK_ID" --batch-id "$BATCH_ID" \
  --git "$FIXTURE" --branch feature/zero-accepted \
  --base-branch main --language javascript --with-plan)
LOCAL_DIR=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.data.localDir)' "$CLONE_JSON")
echo "localDir=$LOCAL_DIR"

# 4) Static scan (JS/TS Semgrep seed rules — expects AST-JS-BOUND-001 on checkout.mjs)
$S get-rules --git "$FIXTURE" --user-id alice > data/_tmp/rules.json
$S run-ast-scan \
  --code-dir "$LOCAL_DIR" \
  --rules-json data/_tmp/rules.json \
  --project-language javascript \
  --task-id "$TASK_ID"

$S status --task-id "$TASK_ID"
```

`run-ast-scan` should report a hit for `AST-JS-BOUND-001` (guard uses `< 0` and accepts zero). That is static evidence only; the agent turns it into a write-back and closes the task:

```bash
# 5) Write back one finding and close the task (the agent authors the content; shown here by hand)
$S gen-writeback-template --task-id "$TASK_ID" --strategy-code 11 --bug-status 6 \
  --class-name checkout --method-name checkout > data/_tmp/item.json
#    edit data/_tmp/item.json: drop the _hint* keys, fill fileCodes / thinking / content per references/writeback.md
node -e 'const i=JSON.parse(require("fs").readFileSync("data/_tmp/item.json","utf8")).data; console.log(JSON.stringify([i]))' > data/_tmp/items.json
$S batch-update-process --task-id "$TASK_ID" --items-json data/_tmp/items.json

#    summary must follow references/output/summary-spec.md (flat plain text, no Markdown tables)
$S validate-summary --summary-file data/_tmp/summary.txt
$S finalize-all --task-id "$TASK_ID" --summary-file data/_tmp/summary.txt   # coverage → rank → report → complete
$S status --task-id "$TASK_ID"        # data.reportUrl points at the HTML report
```

Every step above is validated (`batch-update-process` rejects hollow or malformed write-backs; `finalize-all` refuses to complete with missing coverage), so a hand-run that passes is the same path the agent takes. Details: `SKILL.md`, [references/writeback.md](references/writeback.md), [operator manual](references/operator-manual.md).

Verify the fixture contract itself (no AI):

```bash
node examples/checkout-boundary/verify.mjs
```

## Configure another company

See [references/api/adapters.md](references/api/adapters.md), [references/api/platform-api.md](references/api/platform-api.md), and [references/api/enterprise-http-api.md](references/api/enterprise-http-api.md) (reserved slots for plans, cases, wiki, tickets, traces).

Typical remote setup:

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

## Agent instructions

`SKILL.md` is the entry for an AI agent. Phase files and `references/` are loaded on demand.

Human / operator walkthrough (install → trigger → degrade materials → HTTP slots → feedback): [references/operator-manual.md](references/operator-manual.md).

## Language support (current)

The language of a service is resolved by `scripts/lang.ts` (`--language` → declared → detected from `diff.files`; `languageSource` records which) and every stage below reads the same profile. Polyglot change sets are handled per file: each language keeps its own extractor, rule pack, trivial conventions and code fence.

| Capability | Java | Kotlin / Scala | JS / TS | Python | Go | C / C++ | C# |
|---|---|---|---|---|---|---|---|
| Diff + task lifecycle | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Method-level extraction (`scripts/lang_methods.ts`, Semgrep-refined ranges when available) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trivial-method filter (language conventions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Semgrep AST seed pack (`run-ast-scan`) | 9 | 11 / 9 | 15 / +7 TS | 17 | 9 | 7 / 7 | 11 |
| Detection notes (`references/rules/*-gotchas.md`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native analyzer overlay | — | detekt | eslint | bandit, ruff | gosec, go vet, staticcheck | cppcheck | — |
| Call graph (GitNexus) | ✅ optional | ✅ optional | grep fallback | ✅ optional | ✅ optional | ✅ optional | ✅ optional |

Seed rules live in `scripts/providers/platform/seed_catalog.ts` (`AST_RULES`, plain Semgrep YAML with `cwe` / `owaspTop10_2025` / `asvs50` metadata) and are written by this project — they are a starter pack, not a vendored ruleset. Add or replace rules there, or serve your own through the `get-rules` platform adapter. The per-language mapping (className / filePath conventions, fences, packs) is in `references/rules/language-mapping.md`.

## Platform notes

| | Linux / macOS | Windows |
|---|---|---|
| CLI (`node scripts/detect.ts`), local platform, reports | ✅ | ✅ Node + git only; all runtime paths derive from `DETECTION_DATA_DIR` (no `/tmp`), `npm.cmd` / `gitnexus.cmd` shims are handled by `scripts/sys.ts` |
| Quick-start shell snippets | bash / zsh | Git Bash or WSL (they use `$(...)` and `export`); `make-git-fixture.mjs` itself is plain Node |
| Semgrep AST scan | ✅ pip / brew | Semgrep's native Windows support is marked beta upstream (`pipx install semgrep`, set `PYTHONUTF8=1`); if `semgrep` is not on PATH the scan reports `scanOk:false` and the agent continues with file-level analysis |
| GitNexus (call graph) | ✅ optional | untested; set `DETECTION_SKIP_GITNEXUS=1` |
| Repo-level `scripts/check-docs.py`, CI | ✅ | not needed on a developer machine |

All OS-specific behaviour (executable lookup, `.cmd` shims, scratch and clone directories, path normalisation) is confined to `scripts/sys.ts` and `store.ts` (`content_base_dir` / `repo_clone_base_dir`); other modules must not hard-code paths or call `spawnSync` directly.

## Tests

```bash
export NODE_OPTIONS=--experimental-strip-types
npm test
```

## License

Apache License 2.0. See [LICENSE](LICENSE).

## OpenQA contribution

### User problem

Reviewers need a repeatable way to find code and business-logic defects in a pull request, test plan, release plan, or existing detection task.

### Acceptance criteria

- Sample plan loading and task lifecycle are reproducible through CLI tests.
- A [known-good/seeded-defect fixture](https://github.com/openqa-cn/codexqa/blob/main/examples/checkout-boundary/README.md) has executable expected results; a blind agent eval on a [multi-defect JS service](https://github.com/openqa-cn/codexqa/blob/main/examples/inventory-service/README.md) recorded recall 7/7 and precision 7/7 under the conditions in [Known limitations](KNOWN_LIMITATIONS.md).
- Write-back validation rejects malformed findings and preserves local evidence.
- The report states coverage, rank, and residual risk.

### Compatibility

| Component | Status | Version / notes |
| --- | --- | --- |
| Node.js | Locally tested | 22.15.0+ with TypeScript stripping |
| Git | Required | Needed for repository and diff analysis |
| Semgrep | Optional | 102 seed rules across 10 languages; 1.x recommended (0.81 loads the non-taint subset, rejected rules are reported); pip/brew auto-install attempted |
| Overlays | Optional | gitleaks, trivy/grype, bandit, ruff, gosec, go vet, staticcheck, cppcheck, eslint, detekt — skipped when missing |
| Call graph | Optional | GitNexus on JVM / Go / Python / C# repos; grep fallback is available |
| Remote platforms | Optional | HTTP adapters require configured credentials |

### Limitations

The skill cannot prove the absence of defects, infer unavailable business rules, or replace human maintainer and security review. Remote providers and GitNexus depend on the configured environment.

For concrete failure cases, implementation gaps, and what the recorded evidence does not support, read [Known limitations](KNOWN_LIMITATIONS.md). For the detection method and the reasoning behind the validation rules, read [How it works](HOW_IT_WORKS.md).
