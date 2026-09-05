---
name: test-quality
description: Evaluate whether tests meaningfully prove behavior rather than merely passing.
---

# Test Quality

Use this skill to review generated or existing tests.

## Checks

- Assertions verify business outcomes, not only presence or absence of UI elements.
- Important success, boundary, and failure paths are represented.
- Tests fail when the behavior under test is intentionally broken.
- Mocks do not remove the behavior the test claims to verify.
- Tests are deterministic and explain their fixtures and setup.
- The test does not pass vacuously when the main action is skipped.

Prefer a small, targeted fault-injection experiment when it is safe. Record the injected fault and expected failure. Do not mutate production systems.

## Output

For each finding, report severity, location, reason, suggested change, and a reproducible example.
