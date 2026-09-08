# Requirement smell dictionary

Quote the source sentence. Set `Smell` and map to `QualityChar` / `Status`. The pre-parse script is a hint, not the judgment.

| Category | Chinese signals | English signals | Map to |
| --- | --- | --- | --- |
| vague | 适当、合理、尽快、及时、相关、若干、良好、优化、可能 | appropriate, reasonable, soon, promptly, relevant, several, good, optimize, maybe | Unambiguous; often `untestable` |
| optional | 可以、尽量、建议、宜 | may, optionally, try to, unforced should | Necessary / Verifiable |
| subjective | 友好、易用、美观、体验好、流畅、较好 | user-friendly, easy, intuitive, nice, smooth, better | Unambiguous + no-oracle |
| loophole | 必要时、视情况、原则上、如需要 | as needed, as appropriate, if necessary, in principle | Unambiguous; `untestable` |
| unbounded | 所有、任何、永远、从不、全部 | all, any, always, never, every | Complete / Feasible |
| compound | 并且同时、以及还要 | and also, as well as (two obligations) | Singular |
| tbd | 待定、待确认、TBD、TBC、后续确认 | TBD, TBC, to be decided, later | Complete; `missing` or `stale` |

Passive voice with no actor is vague / Complete.

Do not promote wording-only variants to smells. Enter the register only when observable behavior is uncertain.
