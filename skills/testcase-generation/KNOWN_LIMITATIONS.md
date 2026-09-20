# Known limitations

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is a real boundary of the current skill, not a marketing disclaimer. Read [how it works](HOW_IT_WORKS.md) first for the design split.

## Requires Python 3.10+

Gate and stage scripts use modern typing and stdlib behavior. **Always** invoke them via `scripts/tcg-python`. Bare `python3` that is older than 3.10 exits immediately with a FATAL message.

## No case-platform or doc-platform binding

The skill writes local Markdown only. It does not recall, upload, or sync remote case spaces, and it does not install or call a document-platform / identity CLI.

## Plan and case prose are model-judged

`check_run_gate.py` / `close_stage.py` enforce artifact presence, headings, and dual-write. Whether scenarios and steps match the business domain is decided by the host model. A gate that passes can still yield a wrong plan or case if the model invents facts instead of marking TBD / pending clarification.

## Incremental needs a valid baseline

Diff-enhancement from a PR / git URL requires an existing case baseline first. Without one, bootstrap an initial version; do not fetch code yet. Permission and missing-ref failures surface as script `error.code` values.

## Knowledge is optional and local

An empty knowledge index is valid. The skill does not call an external knowledge-retrieval Skill. Mid-run it will not ask for a knowledge source just to fill dimensions.

## No published host-agent score

Offline `--self-check` covers gate fixtures. There is no public answer-key fixture and no recorded host-agent score for full Plan→Exec or Incremental runs.

## Workflow boundary

This skill produces **test plans and manual cases**. It does not replace `requirements-analyzer` for gap registers, `testdata-generation` for live backend data, or code-review / scan skills for defect findings.
