# Checkout API notes

Technical document for plan 1001. Referenced from `technicalDocs`.

## Endpoint

`POST /v1/orders/checkout`

Required fields: `cartId`, `amount`, `currency`.

## Validation

- `amount` is a decimal. Reject when missing, not a number, or `<= 0`.
- Do not persist the order before the amount check succeeds.
- Time out downstream payment calls after 3 seconds and return a degradable error.

## Suggested guard

```java
if (request.getAmount() == null || request.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
    throw new InvalidAmountException("INVALID_AMOUNT");
}
```
