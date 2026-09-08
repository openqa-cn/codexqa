# QA Test Cases — Reservation & Refund v2

Environment: local service with seeded stock, `LOG_LEVEL=silent`.
Seed used by every case unless stated otherwise:
`WIDGET-1 → onHand 100, reserved 0` and `GIZMO-2 → onHand 40, reserved 0`.

| ID | Title | Steps | Expected result |
| --- | --- | --- | --- |
| TC-01 | Happy path reservation and commit | 1. Reserve `ORD-1` with 3 × WIDGET-1. 2. Read availability for WIDGET-1. 3. Commit the reservation. 4. Read availability again. | After step 2 availability is 97. After the commit availability is still 97 (on hand 97, reserved 0) and the order is `PAID`. |
| TC-02 | Reservation for the exact remaining quantity | 1. Seed `TRINKET-9` with onHand 5, reserved 0. 2. Reserve 5 units. | The reservation succeeds; availability for `TRINKET-9` becomes 0. |
| TC-03 | Partial line failure rolls back | 1. Reserve `ORD-2` with 2 × WIDGET-1 and 999 × GIZMO-2. | The request is rejected with `OUT_OF_STOCK` for GIZMO-2, and WIDGET-1 availability is unchanged at 100. |
| TC-04 | Concurrent reservations do not oversell | 1. Seed `LIMITED-3` with onHand 1, reserved 0. 2. Fire two `createReservation` calls for 1 × LIMITED-3 (different order ids) without awaiting the first. | Exactly one reservation succeeds and the other is rejected; reserved for `LIMITED-3` is 1, never 2. |
| TC-05 | Expiry returns stock to the pool | 1. Reserve `ORD-3` with 4 × WIDGET-1 and a 1 ms hold window. 2. Wait, then run the expiry sweep. 3. Read availability for WIDGET-1. | The reservation is `EXPIRED` and availability reads 100 on the very next call. |
| TC-06 | Volume discount tier boundaries | Price orders of 9, 10, 11, 49, 50 and 51 units at 10.00 each. | Discount rates are 0%, 5%, 5%, 5%, 10%, 10% respectively. Tax is charged on the discounted subtotal. |
| TC-07 | Money rounding | Price a single line of 1 × 1.005 and a single line of 3 × 19.99. | Totals round half up to two decimals: subtotals 1.01 and 59.97. |
| TC-08 | Repeated partial refunds cannot exceed the paid amount | 1. Commit an order with a paid amount of 100.00. 2. Request a refund of 80.00. 3. Request a second refund of 80.00. | The first refund returns 80.00. The second returns at most 20.00, and the refunded total for the order ends at exactly 100.00. |
| TC-09 | Gateway failure is surfaced | 1. Commit an order. 2. Arm the payment gateway to fail the next call. 3. Request a refund of 10.00. | The call returns a failure result, the refunded total stays at 0 and the order status stays `PAID`. |
| TC-10 | Failed request does not wedge the order | 1. Send a reservation for `ORD-4` with a malformed line (no `unitPrice`). 2. Retry the same order id with a well-formed line. | The first call reports an error, and the retry completes normally rather than hanging. |
