# Checkout boundary: a known-good and seeded-defect pair

**Requirement:** a finite checkout amount must be strictly positive. Zero, negative, and non-finite values must be rejected.

## Run

From the repository root:

```bash
node examples/checkout-boundary/verify.mjs
```

Expected output:

```text
PASS: known-good implementation satisfies sampled contract
EXPECTED FAILURE: defective implementation accepts zero
Fixture verified; no AI detection claim.
```

The verifier exits zero only when the good implementation passes the sampled contract and the defective implementation fails it. Unexpected behavior exits nonzero.

## Inspect the defect

[good.mjs](good.mjs) rejects `amount <= 0`. [defective.mjs](defective.mjs) rejects only `amount < 0`. The boundary call `checkout(0)` is accepted by the defective version.

The corresponding candidate finding is: “Zero-value checkout is accepted at defective.mjs line 2; reject zero as required.” It has a concrete input, expected/actual behavior, and executable evidence. This is a hand-authored fixture, not an agent-generated platform report.

## Use it in an agent evaluation

Provide the requirement and one implementation to the agent without revealing the answer or verifier. Record the agent/model version, commit, command environment, and finding. Repeat with the good implementation as a negative control. The seed should be found; unrelated findings require human assessment. That evaluation has not been performed as part of this example.

This checks a numeric boundary only; it does not model currency precision, payment APIs, or a complete checkout service.
