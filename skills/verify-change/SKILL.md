---
name: verify-change
description: Verify whether a code change satisfies its intended behavior and is ready to merge.
---

# Verify Change

Use this skill when reviewing a pull request or local change, especially changes produced by a coding agent.

## Workflow

1. Read the stated intent, acceptance criteria, and changed files.
2. Identify affected behavior, interfaces, data paths, and risk.
3. Inspect existing tests before proposing new tests.
4. Select the smallest set of meaningful checks that can falsify the change.
5. Run the checks and preserve commands, environment, logs, and artifacts.
6. Report `PASS`, `FAIL`, or `REVIEW` with residual risk.

Never report PASS only because a command exits zero. Explain what behavior the evidence proves and what it does not prove.

## Output

Return: intent, change scope, risk, verification plan, evidence, residual risk, and decision.
