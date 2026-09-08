---
name: code-reviewer
description: >
  Review Git branch, PR, or commit changes for quality, security, and maintainability
  (CR / 代码审查 / 审查 / pre-commit / risk assessment). Frontend: React, TypeScript,
  JavaScript, React Native, mini-program. Backend: Java, Kotlin, Go, Python, C, C++,
  Groovy, SQL / service-layer. Requires a local Git checkout — not a pasted snippet.
  Do not use for how-to questions, debugging a known bug, explaining or rewriting code,
  method-level requirement defect hunting with write-back gates (that is defect-detection),
  writing test cases (testcase-generation), or constructing test data (testdata-generation).
license: MIT
metadata:
  author: open-source
  version: "1.0.0"
---

# Code Review Expert

Before reviewing, Read [`review-playbook.md`](review-playbook.md) and follow every step in that file. This file is only the platform entry point; it does not contain the review algorithm.

Companion paths:

| Path | Purpose |
|------|---------|
| `review-playbook.md` | Review algorithm, gates, steps, and report format |
| `playbook/` | Rules loaded on demand |
| `config/` | Repository-configurable Git, layers, HTTP integrations, and auth |
| `tooling/` | Optional local scripts (config, progress, security scan, dependency scan) |
| `report-formats/findings-report.md` | Report skeleton |
| `examples/async-incidents.md` | Neutral incident examples |
| `README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md` (and `.zh-CN.md`) | Human-facing; not needed by the agent |
