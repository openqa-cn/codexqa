# How AI Code Reviewer works

[简体中文](HOW_IT_WORKS.zh-CN.md)

[`ai-code-reviewer`](README.md) is scaffolding for a host agent: a local repo (PR/diff, full-repo, or adhoc files) goes in; a CodexQA evidence pack and bilingual `REVIEW-REPORT.html` come out. The skill does not embed a model and does not vendor CodexQA source. Collectors talk to the `codexqa` binary; the model reasons only from pack artifacts.

The runtime contract is in [`SKILL.md`](SKILL.md).

## Data flow

```text
repo + diff-base  |  full-repo  |  adhoc file(s)
        │
        ▼
   collect-*-evidence.sh  (+ derive-* dimension signals)
        │
        ▼
   .codexqa-review/<run-id>/   (manifest + JSON pack)
        │
        ├─ validate-evidence.sh
        ├─ host agent reads prompts/ + pack artifacts
        └─ writes review-conclusion.json
                │
                ▼
        render-review-html.sh → REVIEW-REPORT.html
```

1. **Preflight** — `codexqa` and `jq` on PATH; PR mode also needs `REPO` + `--diff-base`.
2. **Collect** — index / change-groups / symbol-diff / impact / tags / sensitive / hot-but-thin / language profile, then local `derive-*` signal files.
3. **Validate** — refuse packs without CodexQA provenance or reviewable change identity; legacy packs may WARN and still pass.
4. **Review** — agent follows `prompts/pr-diff-review.md` or `prompts/full-repo-review.md`; cite artifact fields only.
5. **Deliver** — required `review-conclusion.json` + `REVIEW-REPORT.html` (bilingual `*_en` siblings).

## What bash owns vs the model

| Layer | Owns |
|---|---|
| Bash collectors / validators / HTML render | Tooling status, pack schema, dimension signal derivation, HTML filtering |
| Host agent | Findings / dimension cards / bilingual prose under `prompts/` + `references/` |
| CodexQA CLI | Symbol graph, callers, reachability, test edges |

## Relationship to other code skills

| Skill | Difference |
|---|---|
| [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.md) | Symbol-graph Q&A / impact — not a full review-report pipeline |
| [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.md) | SAST + agent-inline scan → `report_scan.*` |
| [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.md) | Exception RCA on top of CLI facts |

## Evidence status

Local `bash scripts/validate-skill.sh` covers static tree, fixture validate/render smoke, and plan-coverage audit. Live CodexQA indexing is not required by repository CI. See [Known limitations](KNOWN_LIMITATIONS.md).
