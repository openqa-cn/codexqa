# Behavioral completeness (minimum walk)

If material is missing, mark `missing`. Do not invent rules. Hits go on the register; `FailureMode` is usually `missed-rule`.

1. **State transitions**: list states already named. For each: enter/exit, illegal transition, timeout. One gap → `missing`.
2. **Decision conditions**: find if/when. List true/false/missing-parameter. Success-only branches → `missing` failure branch.
3. **Time and idempotency**: timeout, retry, duplicate submit, timezone, exactly-once vs at-least-once. Raise to P0/P1 when payment or inventory is involved.
4. **Failure paths**: cancel, reject, partial success, downstream timeout. If scope says “happy path only”, failure must be explicit out-of-scope or enter the register.
5. **Data lifecycle**: create, uniqueness, update, delete/archive, reconciliation. Missing integrity or reconciliation on money → `product-data`.
6. **UX observable states**: empty, loading, error, fallback. If the UI main path is written but these states are not → `RiskClass=product-ux`; `FailureMode` is usually `missed-rule`.

Do not expand a full decision table. Only register gaps that block test start.
