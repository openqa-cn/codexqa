# Report template (English Markdown)

The CLI owns the first-level headings. `draft-report` writes `facts.json` plus an empty-bodied skeleton. The model fills each `##` body. `write-report --from-draft` rejects missing headings and story gaps. It does **not** reject over-hint section length.

Author **English only**. Do not add extra top-level headings unless the user asks. Do not paste `facts.json` as slogans. Do not encode exception-class repair wording in the skeleton.

**Prompt hint (字 = non-whitespace Unicode characters; heading excluded). Not a `write-report` cap:**

| Section | Hint |
|---|---|
| Mapped call path | **300 字** — must tell the full hop story |
| Root cause | **300 字** — must tell why this repo took that path |
| All other `##` sections | **100 字** |

`write-report` stores `report.md` and `report.en.md` (same English text). Canonical skill rules: `SKILL.md` **Report rules**. Skip this file when those rules are already in context. Chat: stdout `chat.en` is the first line of Executive summary; show that paragraph + report paths; do not paste the full document. Do not pre-count 字 or trim to the hint.

```markdown
# Exception diagnosis

## Executive summary
[What failed; in-repo root cause; literal `Confidence: high|medium|low`. Target ≤100 字.]

## Symptom and exception facts
[Type, message gist, primary `Class#method:line`. Target ≤100 字.]

## Mapped call path
[From entry to the throw: who called whom, extracted branch then-call, which frames are weak. Target ≤300 字.]

## Root cause
[Earliest wrong contract in this repo, why that path ran, what it raced. Cite `Class#method`. Target ≤300 字.]

## Trigger
[Throw site. Not the root cause. Target ≤100 字.]

## Contributing factors
[Two or three factors with a citation each. Target ≤100 字.]

## Suggested fix and verification
[One fix + one verify step. Do not apply code. Target ≤100 字.]

## Confidence and gaps
[high|medium|low; one missing fact. Target ≤100 字.]
```

## storyGaps (mechanical)

`write-report` rejects unless these strings appear. Edit the draft once from stdout `storyGaps`; do not trim length.

| Gap | Section | Required text |
|---|---|---|
| `missing-confidence` | Executive summary | `Confidence:` |
| `mapped-missing-branch-then` | Mapped call path | `facts.branch.thenCall` |
| `mapped-missing-throw` | Mapped call path | throw class from `facts.throwKey` |
| `root-missing-branch-else` | Root cause | `facts.branch.elseCall` |
| `root-missing-throw` | Root cause | throw class |
| `root-missing-race` | Root cause | `raced`, `race`, or `contend` |
| `root-missing-hypothesis-on-drift` | Root cause | `hypothesis` when `facts.lineDrift` is non-empty |
| `trigger-missing-throw` | Trigger | throw class |
| `trigger-missing-not-root` | Trigger | `not the root` (or `not root`) |

## Citation rule

Causal claims need a `Class#method` (or file:line). Mark hypotheses with hypothesis. Drop SQL dumps and numbered evidence lists.
