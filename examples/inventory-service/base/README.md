# inventory-service

Stock, reservation, pricing and refund logic for the storefront checkout flow.
The persistence layer in `src/db.js` is an in-memory stand-in for the shared
Postgres cluster so the service can be exercised without infrastructure.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/db.js` | Row storage, id generation, audit trail, per-key locking |
| `src/cache.js` | Generic TTL cache used for read-mostly values |
| `src/inventory.js` | Availability, holds, releases, consumption |
| `src/pricing.js` | Line pricing, discounts, tax, money rounding |
| `src/reservation.js` | Reservation lifecycle (hold to commit or cancel) |
| `src/refund.js` | Refund issuance and the order refund ledger |
| `src/gateway.js` | Payment provider stand-in |

## Running

```sh
node smoke.mjs
LOG_LEVEL=silent node smoke.mjs
```

## Specification

Product rules live in [`docs/requirements.md`](docs/requirements.md); the QA
matrix lives in [`docs/test-cases.md`](docs/test-cases.md).
