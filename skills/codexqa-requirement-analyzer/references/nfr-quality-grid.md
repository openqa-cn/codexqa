# ISO 25010 NFR grid

Mark each of the eight characteristics exactly once: `specified-measurable` / `specified-vague` / `missing` / `not-applicable`. Put them on one line in section 2. Do not invent thresholds.

| Characteristic | Measurable-threshold question | Raise `missing` to P0/P1 when |
| --- | --- | --- |
| Functional suitability | What decides complete/correct? | Core goal has no AC |
| Reliability | Are recovery, retry, and data-loss rules numeric or observable? | Money / order integrity |
| Performance efficiency | Load, latency, capacity numbers and probe points? | A peak scenario is named with no numbers |
| Usability | Can a key task state an observable done condition? | Rarely P0 alone |
| Security | Can authn, authz, audit, or sensitive-data rules fail observably? | Money, identity, or privacy |
| Compatibility | Browser / OS / counterpart versions stated? | An external contract already exists |
| Maintainability | Are logs, config, and compatible change observable? | Usually P2 unless ops blocks release |
| Portability | Required environments declared? Else `not-applicable` | Multi-platform is already promised |

`specified-vague` (“must be secure/fast” with no measure) enters the register as smell `subjective`/`vague` and `QualityChar=Verifiable`.
