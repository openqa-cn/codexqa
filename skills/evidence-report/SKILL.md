---
name: evidence-report
description: Produce a portable evidence record for a software change verification run.
---

# Evidence Report

Use this skill after verification has run.

## Required evidence

- change identifier and repository revision;
- intent and acceptance criteria;
- verification commands and environment;
- test, scan, trace, screenshot, or runtime artifacts;
- timestamps and result provenance;
- failed or skipped checks;
- residual risk and human review requirements;
- final decision: `PASS`, `FAIL`, or `REVIEW`.

Write a human-readable Markdown report and a machine-readable record compatible with `schemas/evidence.schema.json`.

Do not claim coverage, correctness, or security properties that the collected evidence does not support.
