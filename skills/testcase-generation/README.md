# testcase-generation

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md) · [User guide](user-guide.md)

Conversation-driven **test-plan and test-case** generation for APP, Web, and server. Fully run **Plan (Stages 0–5)**, **Exec (Stage 6)**, and/or **Incremental (post-submit)**. Artifacts are local Markdown only.

Current policy (V56): does not connect to a case platform or a doc platform, and does not call an external knowledge-retrieval Skill. Knowledge comes from requirements / technical design, built-in norms in this skill, and a local knowledge directory or knowledge-repo Git URL you actively provide. Stage 0 may fetch `http(s)://` document URLs you give this turn and persist them as testdocs body; it does not crawl page-internal links. Post-submit incremental is handled inside this Skill; when you explicitly give a PR / MR / Code-platform PR page or a custom git repo URL, and a case baseline already exists, git can fetch code for diff enhancement.

It is **not** [`requirements-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/requirements-analyzer/README.md) (gap/conflict register), **not** [`testdata-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testdata-generation/README.md) (backend data construction / write-back), and **not** a code-risk scanner (`defect-detection` / `ai-code-reviewer`).

## Requirements

- Python **3.10+** on PATH (`scripts/tcg-python` resolves `python3.11` / `3.12` / … when system `python3` is older)
- `git` only when you supply a knowledge-repo Git URL or an Incremental PR/git URL

## Install

```bash
npx skills add openqa-cn/codexqa --skill testcase-generation
```

See the [installation guide](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md), [support matrix](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.md), and [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.md).

## How you use it

Send a PRD / technical design (local file, directory, pasted text, or an `http(s)://` document URL you give this turn) to the Agent and say whether you want a test plan, test cases, or both.

```
Generate a test plan: /Users/me/docs/prd.md
```

Optional knowledge (one, the other, or neither):

```
Knowledge directory: /Users/me/kb/biz
Knowledge repo: https://git.example.com/team/biz-knowledge.git#main
```

- Plan only → finish Stages 0–4-1, pass the stage5 gate, then compose `testdesign/test_design.md`
- Cases only and a formal test plan already exists → run Stage 6
- Both plan and cases → Plan first; confirm once after the plan is on disk, then write cases
- Post-submit incremental / enhance existing cases → diff-enhance or directly update on the existing baseline, write `testcase/cases/`
- Incremental cases from a PR / custom repo → have a case baseline first, then explicitly give a PR / MR / Code-platform PR page or an `https` / `git@` / `ssh://git@` repo URL; git-fetch into `.pr-cache/` then diff

Fetch only document URLs you give this turn; do not crawl links inside those pages. URLs in requirement text are not treated as a knowledge repo or a PR. Failures follow the script `error.code`: `PR_PERMISSION_DENIED`, `PR_HEAD_REF_MISSING`, or report as-is.

**How to use (detail):** [user-guide.md](user-guide.md). **Agent execution map:** [SKILL.md](SKILL.md).

## Artifact locations

Default run directory: `$HOME/testdata-generation/runs/{runid}`. You may also specify a local directory. Original internal subdirectories still live under that `run_dir`.

| Content | Path |
|---|---|
| Config and Stage 0–4-1 reports | `{run_dir}/testcase/testdocs/` |
| Formal test plan | `{run_dir}/testdesign/test_design.md` |
| Aggregated HTML case report (Web / Server / APP) | `{run_dir}/testdesign/testcase_generation_report.html` |
| Initial cases | `{run_dir}/testcase/initialcase/` |
| Current valid cases | `{run_dir}/testcase/cases/` |
| Incremental process area | `{run_dir}/testcase/.case-enhance/{executionId}/` |
| PR code cache | `{run_dir}/testcase/.pr-cache/` |
| Optional knowledge index | `{run_dir}/knowledge/index.md` |

## What it does not do

- Does not bind a remote case space; does not recall or upload remote cases
- Does not write remote docs; does not install a doc-platform or identity CLI
- Does not call an external knowledge-retrieval Skill
- Does not auto-clone Git from requirement text
- Completes post-submit incremental inside this Skill
- Does not construct live backend test data (that is `testdata-generation`)

## Smoke checks

```bash
./scripts/tcg-python scripts/close_stage.py --self-check
./scripts/tcg-python scripts/check_run_gate.py --self-check
./scripts/tcg-python scripts/generate_case_report.py --self-check
```

## License

MIT. See [LICENSE](LICENSE).

## Limitations

Stage gates are deterministic; plan/case prose is model-judged. See [Known limitations](KNOWN_LIMITATIONS.md). Data flow: [How it works](HOW_IT_WORKS.md).
