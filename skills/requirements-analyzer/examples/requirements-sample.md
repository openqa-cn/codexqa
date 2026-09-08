# Northwind inventory-hold draft

## Background
- Hold window: 2026-03-20 20:00 to 20:10.
- Reservable stock: 500.

## Business rules
- User must have a verified account and a completed order of at least 199 in the last 30 days.
- Each user may reserve 1 item.
- Stock status must update within 3 seconds after payment success.
- The UI must show unavailable when stock is 0.

## Non-functional
- Peak 50k QPS; p95 under 300ms.
- Anti-replay and request signature are required.
- Restock is supported “as needed”.

## Open
- Do enterprise and personal accounts share the reservation limit? (TBD)
- Is the weak-network polling interval fixed? (to be confirmed)
