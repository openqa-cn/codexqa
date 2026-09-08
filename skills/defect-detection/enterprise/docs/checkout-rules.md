# Checkout amount rules

Requirement document for plan 1001. `LocalDocProvider` resolves this file from
`enterprise/docs/` when the plan lists `requirementDocs: ["checkout-rules.md"]`.

## Business rules

1. Checkout amount must be **greater than zero**. Amount `<= 0` is rejected.
2. A negative or zero amount must not create an order.
3. The API must return HTTP 400 with a stable error code (`INVALID_AMOUNT`).
4. Frequency or feature flags must not bypass the amount check.

## Out of scope

- Payment-channel timeouts (covered by the technical note).
- Display copy on the client.
