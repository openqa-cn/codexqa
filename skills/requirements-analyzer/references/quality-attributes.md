# Requirement quality characteristics (executable checks)

Judge high-impact statements. Failures go on the register as `QualityChar`. Do not restate the standard.

## Individual (first)

| Characteristic | Pass question | Fail → register |
| --- | --- | --- |
| Necessary | If removed, can the goal still be met? | Gold-plating; implementation posing as need |
| Appropriate | Does the detail match the abstraction level? | Premature solution binding |
| Unambiguous | Would two readers observe the same behavior? | Vague words, and/or, missing actor |
| Complete | Can it be executed or accepted without extra context? | Missing condition, threshold, or object |
| Singular | Does it state exactly one capability or constraint? | Two obligations joined by “and” / “also” |
| Feasible | Realizable under known cost, schedule, tech, and compliance? | Mark infeasibility as a hypothesis unless evidenced |
| Verifiable | Can you write the observable failure? | No oracle → `untestable` + `FailureMode=no-oracle` |
| Correct | Does it match a supplied source rather than an inference? | Inferences stay assumptions |
| Conforming | Does it look like an assignable rule (who, when, what)? | Slogans and vision lines |

## Set

| Characteristic | Pass question |
| --- | --- |
| Complete | Goals, roles, happy path, failure, data, permissions, NFRs are covered or marked missing |
| Consistent | Terms, units, thresholds, and state names agree; cross-source fights are `Status=conflict` |
| Feasible | The set still fits the timebox; overload is a project risk |
| Comprehensible | One concept has one name |
| Able to be validated | An observable AC set covers the MUST statements |

## Anti-examples (must enter the register)

- “User logs in and exports a report” → not Singular.
- “Experience should be good” → not Verifiable / Unambiguous.
- “Use Redis underneath” with no constraint source → may fail Necessary / Appropriate.
