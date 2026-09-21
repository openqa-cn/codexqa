# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is a real boundary of the current skill, not a marketing disclaimer. Read [how it works](HOW_IT_WORKS.md) first for the design split.

## Depends on closed-source `@openqa-cn/codexqa` for live graphs

Repo code-graph / call-chain / RAG context comes from the separately distributed npm package `@openqa-cn/codexqa`. This repository publishes the skill scripts and report contract; it does **not** include the engine source. Without the CLI, repo scans hard-fail unless mock is explicitly allowed (adhoc may auto-mock as last resort).

## Optional SAST / lint / secrets binaries

Semgrep, Bandit, gosec, gitleaks, language linters, and osv-scanner are optional. Missing tools are reported in `tooling_status.missing`; the pipeline continues after repair attempts. Coverage shrinks when adapters are absent.

## Agent LLM Detection is model-judged

The Agent LLM Detection dimension (Stage1 `agent_detect` + Stage2 verify) is filled by the host agent's embedded model (or optional API). Python validates schema, merge/dedupe rules, and ordering. Whether a semantic finding is *true* for this codebase is model-decided. A finished `report_scan.*` can still be wrong if the model invents evidence or misreads policies. Deterministic findings without an agent round remain `sast_only`.

## Not a full live scan in repository CI

Local `npm test` covers pipeline merge/validation and policy fixtures under Python 3.10+. Repository CI does not install every SAST binary or run a live Agent LLM Detection Stage1/Stage2 against a production repo. Treat `--dry-run` / mock as smoke only.

## No published host-agent score

There is no public answer-key fixture and no recorded host-agent score for end-to-end scan accuracy. Treat the report contract as the intended design path, not a measured detection-rate claim.

## Workflow boundary

This skill produces **code-risk scan reports**. It does not replace `ai-code-reviewer` for CodexQA evidence-pack HTML review, `code-analyzer` for change-impact mapping, or `root-cause-diagnosis` for exception RCA.
