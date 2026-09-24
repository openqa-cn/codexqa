# Business rule records

Short policy for every business rule. The business-logic pass applies one
record at a time to a changed-method slice. These rules are not SAST
dispositions and must not be judged in the SAST step.

Fields match the rule record in [rule-construction.md](rule-construction.md).
`skip_llm` is empty: there is no scanner hit to skip. Examples use roles,
not a sample project.

## LOGIC-001

- mode: `search`
- family: F1
- kind: bug
- precision: medium
- level: P2
- scope: intraprocedural
- sources: a bound, index, or compared value
- sinks: the branch or slice that uses it
- sanitizers: a comment on that line documenting an inclusive range; a rename with the same bound
- propagators: assignment of the bound into the condition
- message: the bound or slice returns one more item than asked, or the condition is inverted
- remediation: fix the bound and cover the empty and exact-length inputs
- look_for: An off-by-one bound, an inverted condition, or a slice that asks for N items and returns N+1.
- do_not_report: A documented inclusive range, or a rename that does not change the bound.
- fix: Correct the bound so the slice cannot start before zero.
- noncompliant: `items.subList(size - n - 1, size)` when the caller asked for n
- compliant: `items.subList(max(0, size - n), size)`

## BIZ-001

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a repeated submit or gateway retry
- sinks: a debit or credit write
- sanitizers: a unique business id checked before the write
- propagators: the id passed into the write without a lookup
- message: the same business submission can write again because no idempotency key is checked
- remediation: reject a second submit with the same business id
- look_for: Two shapes, filed separately. A mutating handler writes a debit or credit with no idempotency key. A loop retries a write or an external notify, and that call carries no idempotency key. A max-attempt count does not close the second shape. Missing backoff is the resilience retry row, not this one.
- do_not_report: A read-only handler, or a unique constraint already rejects the second id. The retried call is read-only. An idempotency key is checked on that call before the write or notify.
- fix: Require a unique business id before the write, and pass that id on every retry.
- noncompliant: `for { notify(id) }` and `save(order)` where the id is only logged
- compliant: `if (store.exists(businessId)) return previous; store.insert(businessId)`

## BIZ-002

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: reverse, refund, void, cancel, settle, capture, or a second post
- sinks: a status or balance write
- sanitizers: an allowed-status read, or the forward limit and permission checks run again
- propagators: the previous record loaded and then written without reading status
- message: a status-changing write does not read the previous status
- remediation: read the previous status and reject illegal transitions
- look_for: A settle, capture, or second post writes with no previous-status read.
- do_not_report: An allowed-transition check already wraps the write.
- fix: Read status and allow only the legal next states.
- noncompliant: `for (row : batch) ledger.post(row)` with no status read
- compliant: `if (row.status == POSTED) ledger.post(row)`
- narrowed_by: `PAY-006`

## BND-001

- mode: `constant`
- family: F3
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a named bound, expiry, timeout, flag, or rounding mode on the type
- sinks: the decision that should have read that symbol
- sanitizers: the decision reads the symbol before using the value
- propagators: a stored fetch time or a field that is never compared to the bound
- message: a declared bound is not read, so the decision still uses a stale or default value
- remediation: read the bound at the decision, or stop publishing the value
- look_for: A named bound (expiry, timeout, limit, capacity, verification flag, fee switch, rounding mode) does not change the decision. Either the decision never reads it, or it reads a compile-time literal that disables the bound: zero, negative, an unbounded sentinel, or a fixed true or false with no environment or config read. A stored fetch time that is never compared to the expiry is this shape. Calling the setter is not enough. Cache growth without an expiry symbol is not this id.
- do_not_report: The decision reads a value loaded from the environment or a config service, and that value is not a disabling sentinel. A host or URL literal stays on `env_config_gaps`. A secret literal stays on `hardcoded_secret`.
- fix: Load the bound from configuration and reject the disabling sentinel before use.
- noncompliant: `setDeadline(0)` or `if (cached != null) return cached` when an expiry field is never read
- compliant: `setDeadline(configured)` and `if (cached != null && now < cached.fetchedAt + ttl) return cached`

## BIZ-003

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P2
- scope: intraprocedural
- sources: a caller amount, quantity, or a cutoff clock
- sinks: the accept branch or the cutoff branch
- sanitizers: an explicit reject of null and values `<= 0`; a documented zone on the clock
- propagators: the raw amount passed into the post
- message: a null, zero, or negative amount is accepted, or a cutoff uses the default zone
- remediation: reject non-positive amounts and pin the cutoff zone
- look_for: Money or quantity has no explicit reject for null, negative, and zero, or a cutoff uses the server default zone. A null that throws and is then mapped to a generic error is still this shape. File each missing bound, not only the one that posts. For a signed amount, say how a negative value changes which side is debited and which side is credited.
- do_not_report: A min check already rejects null and `<= 0`. Float or double money is the SAST class `float_money`, never this id. A throw is not that min check.
- fix: Reject non-positive amounts before posting.
- noncompliant: `post(request.amount)` with no sign check
- compliant: `if (amount == null || amount.signum() <= 0) reject`
- sast_class: `float_money`

## BIZ-004

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: interprocedural
- sources: a batch or loop of posts
- sinks: the per-item write
- sanitizers: a per-item precondition and a stop or recorded failure
- propagators: the loop variable passed into the write; a callee catch that returns normally
- message: the batch keeps writing after one item fails and does not check each item
- remediation: stop or record the failure and compensate items already written
- look_for: Either shape is a hit. The loop writes an item with no per-item precondition. Or a failure does not stop later items. Read the callee: a catch that returns normally means the caller continues. No catch in the loop does not prove the loop stops.
- do_not_report: Each item is checked, and the loop stops or records the failure, including when the callee itself reports the failure.
- fix: Check each item and stop or compensate on failure.
- noncompliant: `for (item : batch) post(item)` with errors ignored
- compliant: `for (item : batch) { if (!ok(item)) break; post(item) }`

## BIZ-005

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a legacy or deprecated balance accessor
- sinks: the debit or credit decision
- sanitizers: the post reads a balance that already subtracts holds
- propagators: the legacy value copied into the comparison
- message: a debit uses a legacy balance that may include held funds
- remediation: read the spendable balance
- look_for: A deprecated balance accessor is used to decide a debit or credit.
- do_not_report: The posting path reads the current available balance. Deprecation with no money effect is not this rule.
- fix: Subtract holds before the debit check.
- noncompliant: `if (legacyBalance >= amount) debit(amount)`
- compliant: `if (availableBalance >= amount) debit(amount)`

## TXN-001

- mode: `typestate`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: the first of several writes that must commit together
- sinks: a later write on another connection or with no commit
- sanitizers: one transaction around the whole unit of work
- propagators: each write opened on its own connection
- message: several writes that must succeed together have no shared transaction
- remediation: commit or roll back the writes as one unit
- look_for: Several database writes that must succeed or fail together have no begin or commit.
- do_not_report: A single statement, or an explicit transaction already wraps the unit. A check-then-act race is CONC-001. A missing idempotency key is PAY-001.
- fix: Wrap the writes in one transaction.
- noncompliant: `save(payer); save(payee)` on two connections
- compliant: `tx.begin(); save(payer); save(payee); tx.commit()`

## PAY-001

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P0
- scope: intraprocedural
- sources: a second submit of the same business id
- sinks: another debit or credit
- sanitizers: a unique key that rejects the second submit
- propagators: the id logged and then ignored
- message: the same payment id can debit again
- remediation: make the business id unique before the write
- look_for: The business id is only logged or is not unique, so the same payment writes again.
- do_not_report: A unique constraint or state machine rejects the second submit. A retry with no backoff is not this rule by itself.
- fix: Insert on the business id and return the original result on conflict.
- noncompliant: `log(transferId); ledger.debit(amount)`
- compliant: `insert on conflict (transferId) do nothing`

## PAY-002

- mode: `taint`
- family: F4
- kind: bug
- precision: medium
- level: P0
- scope: intraprocedural
- sources: caller amount, currency, or rate
- sinks: the posted credit or debit
- sanitizers: a server-side snapshot compared and rejected on mismatch
- propagators: the caller number copied into the post
- message: a caller-supplied amount or rate is posted without a server recompute
- remediation: recompute the value on the server and reject mismatches
- look_for: Request amount, currency, or rate is used to post value with no server-side recompute.
- do_not_report: The amount comes from a server order snapshot, or a mismatch is rejected.
- fix: Post the server amount, not the request amount.
- noncompliant: `credit(amount * request.rate)`
- compliant: `credit(order.amount)` after rejecting a mismatched request rate

## PAY-004

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a webhook body
- sinks: a ledger credit
- sanitizers: a checked signature and a unique event id
- propagators: the body amount copied into the credit
- message: a webhook credits the ledger with no signature check or event id
- remediation: verify the signature and ignore a repeated event id
- look_for: A webhook credits the ledger with no provider signature check, or on every delivery.
- do_not_report: The signature is checked and the event id is unique before credit.
- fix: Verify the signature and store the event id first.
- noncompliant: `credit(body.amount)` with no signature
- compliant: `if (verify(body) && store.add(eventId)) credit(order.amount)`

## PAY-005

- mode: `typestate`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a local ledger write
- sinks: a later gateway call, or a compensation of the wrong account or amount
- sanitizers: an intent recorded before the call, and compensation of the same account and amount
- propagators: the posted amount reused as a different compensation amount
- message: the ledger write and the gateway call are not one unit, or compensation posts the wrong account
- remediation: record a pending or held state before the external call, and reverse the original account and amount
- look_for: Two shapes, filed separately. An irreversible local post happens before the external acknowledgement and no pending or held state exists. Compensation uses a different account or amount from the post. Filing the compensation shape does not close the ordering shape.
- do_not_report: Apply per shape. The ordering shape is clear when a pending or held state is recorded before the call. The compensation shape is clear when it reverses the account and amount that were posted.
- fix: Hold or mark pending before the external call. On failure, reverse the original debit and credit.
- noncompliant: `debit(payer); credit(payee); if (!notify) credit(payee, debitTotal)`
- compliant: `if (!notify) reverse(payer, debit); reverse(payee, credit)`

## PAY-006

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a refund, void, or reverse request
- sinks: a balance write
- sanitizers: an allowed original status and the forward limit and permission checks
- propagators: the original record loaded and written without a status test
- message: a reversal does not check the original payment state
- remediation: allow reversal only from the succeeded state, once
- look_for: Refund, void, or reverse does not check the original state and does not rerun the forward checks.
- do_not_report: The original status is in the allowed set and the forward checks run again. Do not also file BIZ-002 on this same method.
- fix: Reverse only a succeeded payment, once.
- noncompliant: `reverse(load(id))` with no status test
- compliant: `if (row.status == SUCCEEDED) reverse(row)`

## PAY-007

- mode: `search`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: line
- sources: a money multiply or divide
- sinks: a truncating scale with the remainder dropped
- sanitizers: the remainder posted to a suspense account, or a documented half-up mode
- propagators: the scaled result used as the posted amount
- message: a money rounding mode drops a remainder that is not posted
- remediation: post the remainder or use a mode that does not drop it
- look_for: Money multiply or divide uses a truncating mode and the dropped remainder is not posted.
- do_not_report: The remainder is stored, or the mode is half-up with no lost unit.
- fix: Post the truncated remainder to a suspense account.
- noncompliant: `amount.multiply(rate).setScale(2, DOWN)` with no remainder post
- compliant: `posted = scaled; suspense.post(amount.multiply(rate) - posted)`
- sast_class: `float_money`

## CONC-001

- mode: `guard`
- family: F4
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a read of stock, balance, or a flag
- sinks: a later write of a new value
- sanitizers: an atomic update whose condition rechecks the value
- propagators: the read value held in a local and then written
- message: a balance or stock check is followed by a write with no atomic guard
- remediation: update with a condition on the current value
- look_for: Code reads a balance or flag, compares it, then writes a new value with no atomic guard.
- do_not_report: The update rechecks the value in the same statement. File this even when TXN-001 also applies to a second write.
- fix: Use a conditional update and treat zero rows as a failed check.
- noncompliant: `if (balance >= n) balance = balance - n`
- compliant: `update set balance = balance - n where balance >= n`
- narrowed_by: `PAY-001`

## CONC-002

- mode: `search`
- family: F1
- kind: bug
- precision: medium
- level: P1
- scope: interprocedural
- sources: a lock acquisition
- sinks: a second lock taken in the opposite order on another path
- sanitizers: one global order used by every path
- propagators: nested lock blocks
- message: two locks are acquired in opposite orders
- remediation: take the locks in one documented order
- look_for: Two locks are acquired in opposite orders across functions.
- do_not_report: A single lock, or every path follows the same documented order.
- fix: Always acquire the locks in the same order.
- noncompliant: one path locks A then B; another locks B then A
- compliant: both paths lock A then B

## CONC-003

- mode: `search`
- family: F1
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a module-level map, list, counter, or other long-lived mutable that is not thread-safe
- sinks: a write from a handler or worker
- sanitizers: a lock, a concurrent collection, or confinement to one thread
- propagators: the shared object stored in a field and mutated in the handler
- message: shared mutable state is written from handlers with no synchronization
- remediation: guard the write or use a concurrent structure
- look_for: Two shapes, filed separately. A module-level collection or counter is mutated from handlers or workers with no lock. A static or long-lived mutable whose type is not thread-safe (formatter, calendar, generator, plain map) is read or written from those same paths with no lock. A log line that uses the object does not close this shape.
- do_not_report: The write is under a lock, on a concurrent collection, thread-local, or the object is created inside the request and not stored.
- fix: Use a concurrent structure, a thread-local instance, or hold a lock around the use.
- noncompliant: `cache.put(key, value)` on a plain map, or a static formatter used from request threads
- compliant: `concurrentCache.put(key, value)` or a formatter created inside the request

## NULL-001

- mode: `guard`
- family: F1
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a map, query, parse, or find result that may be absent
- sinks: a constructor, call, unbox, field read, or arithmetic use
- sanitizers: an explicit null or empty check on that value before the use
- propagators: assignment of the absent value into the consumer
- message: a possibly absent value is used with no absence check
- remediation: check the value before the use
- look_for: A shape in this relation that `null_deref_gaps` did not already emit. Caller text converted to a number, time, or id with no absence check is one shape. A load or find result used with no null check is another. One shape does not close the other.
- do_not_report: The line is already a `null_deref_gaps` row, including `unguarded_parse`, or a null check wraps that use.
- fix: Return a distinct error when the value is absent.
- noncompliant: `new Decimal(params.get("amount"))`
- compliant: `if (raw == null) reject; new Decimal(raw)`

## RES-001

- mode: `typestate`
- family: F1
- kind: bug
- precision: medium
- level: P1
- scope: intraprocedural
- sources: an opened file, socket, cursor, client, or worker pool
- sinks: a path that never closes or shuts it down
- sanitizers: try-with-resources, defer, or shutdown in the same type
- propagators: the handle stored and used after the successful path only
- message: an owned resource is not closed on every path
- remediation: close it on every path, including failure
- look_for: A shape in this relation that `resource_leaks` did not already emit.
- do_not_report: The line is already a `resource_leaks` row, or close covers every path.
- fix: Close the resource on the error path.
- noncompliant: `stream = open(path); stream.write(body)` with close only after success
- compliant: `try (stream = open(path)) { stream.write(body); }`

## SEC-001

- mode: `guard`
- family: F1
- kind: vulnerability
- precision: medium
- level: P0
- scope: intraprocedural
- sources: a new HTTP or RPC entry
- sinks: the handler body with no server-side principal check
- sanitizers: a documented public health check, or auth on the real method after CORS preflight
- propagators: a client role flag copied into the allow decision
- message: an entry performs work with no server-side authz
- remediation: check a server-side principal before the work
- look_for: A new route has no authz, or a client-supplied role flag is trusted.
- do_not_report: Documented public health. Scanner pattern classes stay on SAST.
- fix: Authenticate the caller on the server before the handler runs.
- noncompliant: `if (request.header("role") == "admin") delete(id)`
- compliant: `if (session.principal.isAdmin()) delete(id)`

## AUTH-001

- mode: `guard`
- family: F4
- kind: vulnerability
- precision: medium
- level: P0
- scope: intraprocedural
- sources: a request id for fetch, update, or delete
- sinks: the read or write
- sanitizers: the query scopes both owner and the other party
- propagators: an OR that treats "not restricted" as allow
- message: the operation checks the wrong object or only one party
- remediation: authorize every party the write affects
- look_for: A write by request id skips ownership, checks the wrong object, or allows any unrestricted object. List every object the write reads or updates. A check on one object does not close another object in the same method, including the other party of a transfer or another id in a callback.
- do_not_report: Owner and every mutated object are in the check. A public resource is documented. One party's check is not a skip for the other party.
- fix: Require an ownership match for every account the transfer touches.
- noncompliant: `allow if sameBranch(payer) or !payee.restricted`
- compliant: `allow if owns(caller, payer) and owns(caller, payee)`

## AUTH-002

- mode: `guard`
- family: F1
- kind: vulnerability
- precision: medium
- level: P0
- scope: intraprocedural
- sources: a role, user id, or tenant from the header, body, or query
- sinks: a principal or admin decision
- sanitizers: a value taken from a verified session and compared with equality
- propagators: a substring or contains check on the role name
- message: the principal is taken from the client or matched by substring
- remediation: compare a verified role with equality
- look_for: A role check uses contains, includes, or indexOf, or the principal comes from the request.
- do_not_report: The role comes from a verified session and is compared with equality. A missing-audit finding on the same line is a different relation. Still file this id when the match is a substring or the principal comes from the request.
- fix: Reject role names that merely contain the admin token.
- noncompliant: `if (roles.contains("ADMIN")) allow`
- compliant: `if (session.roles.equals("ADMIN")) allow`

## TEN-002

- mode: `guard`
- family: F4
- kind: vulnerability
- precision: medium
- level: P0
- scope: intraprocedural
- sources: a type that has a tenant field
- sinks: get, update, or delete by id
- sanitizers: the query always ANDs the server tenant
- propagators: the id predicate alone
- message: a tenant-scoped type is read or written by id with no tenant predicate
- remediation: AND the server tenant into the query
- look_for: The type has a tenant field, but get or update by id does not use it.
- do_not_report: The query always includes the server tenant, or the catalog is global.
- fix: Add the server tenant to every id lookup and update.
- noncompliant: `select where id = ?`
- compliant: `select where id = ? and tenant_id = ?`

## TEN-004

- mode: `guard`
- family: F4
- kind: vulnerability
- precision: medium
- level: P1
- scope: intraprocedural
- sources: an async job, callback, or message payload
- sinks: any use of the business id on the other side of the boundary, including a log
- sanitizers: the payload carries tenant, actor, and trace, and the worker rebinds them
- propagators: the business id copied without that context
- message: work handed to another thread or queue drops tenant, actor, or trace
- remediation: carry tenant, actor, and trace on the payload and rebind them
- look_for: An executor, callback, or message carries a business id and does not carry tenant, actor, and trace. The worker does not need to load a row. A log of that id is enough.
- do_not_report: The payload includes tenant, actor, and trace, and the worker rebinds that context.
- fix: Put tenant, actor, and trace on the task before it is queued.
- noncompliant: `executor.run(() -> log(transferId))`
- compliant: `executor.run(() -> log(tenant, actor, trace, transferId))`

## TEN-005

- mode: `guard`
- family: F4
- kind: vulnerability
- precision: medium
- level: P0
- scope: intraprocedural
- sources: a reverse, refund, or fetch by object id
- sinks: the read or write
- sanitizers: a composite tenant and id check
- propagators: the object id alone
- message: one tenant can act on another tenant's row by id
- remediation: require the tenant and the id together
- look_for: Reverse, refund, or fetch by object id has no tenant check.
- do_not_report: The lookup is `(tenant, id)` and a mismatch is not found.
- fix: Scope the id lookup by the server tenant.
- noncompliant: `reverse(transferId)`
- compliant: `reverse(session.tenant, transferId)`

## TEN-006

- mode: `guard`
- family: F1
- kind: vulnerability
- precision: medium
- level: P1
- scope: intraprocedural
- sources: an admin or impersonation branch
- sinks: a success return with no audit of actor, tenant, and objects
- sanitizers: an audit record written before data access
- propagators: an admin short-circuit that returns immediately
- message: an admin path succeeds for any tenant and writes no audit
- remediation: audit the actor, tenant, and objects before access
- look_for: An admin branch returns success for any tenant with no audit, and the line is not already in `authz_audit_gaps`.
- do_not_report: The line is already an `authz_audit_gaps` row, or an audit record is written first. The same line as AUTH-002 is still this finding when the missing piece is the audit.
- fix: Write the audit record before the admin path touches data.
- noncompliant: `if (isAdmin()) return allow`
- compliant: `if (isAdmin()) { audit(actor, tenant, id); return allow }`

## HYG-001

- mode: `taint`
- family: F1
- kind: vulnerability
- precision: medium
- level: P2
- scope: intraprocedural
- sources: a personal identifier
- sinks: a log, receipt, message, or stdout
- sanitizers: a redaction helper before the sink
- propagators: the identifier concatenated into the message
- message: a personal identifier reaches a human-visible sink
- remediation: redact the identifier before logging or sending
- look_for: A personal identifier is written to a log, receipt, or stdout.
- do_not_report: The value is redacted. A secret literal is `hardcoded_secret`. A shell built from caller input is `command_injection`.
- sast_class: `hardcoded_secret`
- fix: Keep only a non-identifying fragment in the sink.
- noncompliant: `log("card=" + cardNumber)`
- compliant: `log("card=" + last4(cardNumber))`

## GLOB-001

- mode: `search`
- family: F1
- kind: vulnerability
- precision: medium
- level: P1
- scope: intraprocedural
- sources: a call that replaces a process-scoped default
- sinks: every later user of that default in the process
- sanitizers: the default is set only on the current request, client, or connection
- propagators: the process default stored for subsequent connections
- message: a process-scoped default was replaced, so later callers inherit it
- remediation: set the policy on the client or connection, not on the process
- look_for: A call replaces a process-scoped default used by later callers. Rows already in `process_defaults` are filed from that array. This id covers any remaining shape.
- do_not_report: The setting is on the current client or connection only. An insecure certificate check already filed as the SAST class stays that class; this id is the process-wide assignment, and both can stand.
- fix: Apply the policy to the one client that needs it.
- noncompliant: `setProcessDefault(trustAll)` during startup
- compliant: `client.setSocketFactory(factory)` on that client only

## DES-001

- mode: `search`
- family: F5
- kind: smell
- precision: high
- level: P2
- scope: intraprocedural
- sources: a production type
- sinks: a test framework import, test annotation, or nested test type
- sanitizers: the file lives in a test directory or is only a test type
- propagators: the nested type compiled with the production type
- message: production code references a test framework, so tests compile with production and can see its private state
- remediation: move the tests to a test-scoped type
- look_for: A production type references a test framework or nests a test. Rows already in `prod_test_coupling` are filed from that array.
- do_not_report: The file is under a test directory, or its name is only a test type.
- fix: Move the test type out of the production type and keep the test framework on the test compile.
- noncompliant: a service file that imports a test framework and annotates a nested method as a test
- compliant: the same tests live in a test-scoped file

## ARCH-001

- mode: `search`
- family: F1
- kind: smell
- precision: medium
- level: P2
- scope: intraprocedural
- sources: a handler or UI module
- sinks: a raw store call that skips the repository, or a cycle
- sanitizers: a documented adapter boundary
- propagators: the store call inlined in the handler
- message: a handler crosses into storage with no repository boundary
- remediation: move the store call behind a repository
- look_for: A handler issues raw SQL or a cross-layer import that `import_cross_layer` did not already emit.
- do_not_report: The line is already an `import_cross_layer` row, or the boundary is a documented adapter. An auth skip is `SEC-001`, not this id.
- narrowed_by: `SEC-001`
- fix: Call a repository instead of embedding the store query.
- noncompliant: `handler() { execute("update account ...") }`
- compliant: `handler() { accounts.update(...) }`

## API-001

- mode: `search`
- family: F1
- kind: bug
- precision: medium
- level: P2
- scope: intraprocedural
- sources: a public response field, enum, or purge method
- sinks: a removed field with no version, or a purge whose failure looks like success
- sanitizers: a versioned route left in place, or a distinct error from the purge
- propagators: the old field deleted from the payload
- message: a public contract was removed with no compatibility path, or a purge failure looks like success
- remediation: keep a compatibility path, or return a distinct purge error
- look_for: A public field or enum disappeared with no version bump, or a public purge with no authz returns 0 or success on failure.
- do_not_report: Additive fields, an internal DTO, or a purge that checks authz and returns a distinct error. A reject helper that only lacks a message is the error-payload semantic row, not this id. An HTML sink is not this id.
- fix: Return a distinct error when the purge does not run.
- noncompliant: `public int purge() { try { delete(); } catch (Exception e) { return 0; } }`
- compliant: `public Result purge() { if (!allowed()) return forbidden(); return deleted(n); }`

