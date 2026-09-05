# verify-change

Verify whether a code change satisfies its intended behavior and is ready to merge.

## Use when

Reviewing a pull request or local diff, especially one produced by a coding agent.

## Install

Copy or reference [`SKILL.md`](SKILL.md) from your compatible coding agent. The current release is a workflow contract; executable adapters are tracked on the roadmap.

## Inputs

- change diff or pull request;
- intent and acceptance criteria;
- repository test commands;
- relevant environment constraints.

## Output

Intent, scope, risk, verification evidence, residual risk, and `PASS`, `FAIL`, or `REVIEW`.

## Limitations

A passing command does not prove correctness. The skill cannot infer unavailable business rules or validate behavior that was never exercised.
