# Reservation & Refund Requirements (v2)

Owner: Fulfilment Platform · Status: Approved · Last reviewed: 2026-02-11

This document is the product specification for the "reservation v2" workstream:
stock reservations at checkout plus partial refunds after a sale. It is the
reference the implementation and QA are measured against. All monetary amounts
in this service are non-negative and expressed in the store currency.

## Definitions

- **On hand** — units physically in the warehouse.
- **Reserved** — units currently held by an open (uncommitted) reservation.
- **Available** — the number of units a new customer can buy, defined as
  `on hand − reserved`.
- **Paid amount** — the order total charged at commit time.
- **Refunded total** — the sum of every refund already issued for an order.

## Rules

1. **Hold window.** A reservation holds stock for 15 minutes by default. A
   caller may request a shorter or longer window, but the service must clamp
   the effective window to a maximum of 60 minutes.

2. **Availability gate.** A reservation may only be created when every line has
   at least as many available units as the line requests. A line asking for
   exactly the number of available units is acceptable.

3. **All-or-nothing.** If any line of a reservation cannot be held, every hold
   already placed for that reservation must be released before the request is
   rejected. A rejected reservation must leave availability exactly as it was.

4. **No double holding.** Two concurrent reservation requests must never both
   succeed in holding the same physical unit. The sum of all reserved units for
   a SKU must never exceed its on-hand quantity.

5. **Commit semantics.** Committing a reservation converts held units into
   shipped units: the hold is released *and* on-hand stock is reduced by the
   same quantity. A commit must not change the availability seen by other
   customers, because those units were already excluded from availability while
   they were held.

6. **Expiry sweep.** A background sweep expires reservations whose hold window
   has elapsed and returns their units to the pool. Availability reported to
   customers must reflect a release as soon as the sweep has run — a customer
   must not be told a SKU is unavailable because of a hold that has already
   been expired.

7. **Cancellation.** Cancelling a held reservation releases its holds and is
   equivalent to expiry from an inventory point of view.

8. **Volume discount.** Orders of **10 units or more** receive a 5% discount on
   the subtotal. Orders of **50 units or more** receive 10% instead. The tiers
   are inclusive at their lower bound: an order of exactly 10 units is
   discounted at 5%, and an order of exactly 50 units at 10%.

9. **Tax.** Sales tax of 8.25% is applied to the subtotal *after* any volume
   discount has been deducted.

10. **Money rounding.** Every monetary value the service stores or returns is
    rounded to two decimals, half up (`1.005` becomes `1.01`).

11. **Partial refunds.** A refund may be issued for part of an order. Callers
    may request a specific amount; when no amount is given the whole remaining
    balance is refunded. The sum of all refunds for an order must never exceed
    the amount the customer actually paid, no matter how many partial refunds
    are requested or in what order they arrive.

12. **Gateway is the source of truth.** A refund is only recorded once the
    payment gateway confirms it. If the gateway call fails, the order ledger
    must be left untouched and the caller must receive a failure result — a
    failed refund must never be reported to the caller as a success.

13. **Refund status.** After a successful refund an order is
    `PARTIALLY_REFUNDED` while `0 < refunded total < paid amount`, and
    `REFUNDED` once the refunded total reaches the paid amount. A fully
    refunded order cannot be refunded again.

14. **Serialised critical sections.** Operations that mutate a single order or
    reservation run inside a per-key lock so they cannot interleave. The lock
    must always be released when the critical section ends, including when the
    section fails with an error; a failed request must never leave a key locked
    for subsequent requests.
