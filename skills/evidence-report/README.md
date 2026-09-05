# evidence-report

Produce a portable evidence record for a software change verification run.

## Use when

Verification has completed and the result needs to be reviewed, stored, or attached to a pull request.

## Install

Copy or reference [`SKILL.md`](SKILL.md) from your compatible coding agent.

## Output

Human-readable Markdown plus a machine-readable record compatible with [`evidence.schema.json`](../../schemas/evidence.schema.json).

## Limitations

The report preserves evidence; it cannot make incomplete or weak evidence sufficient.
