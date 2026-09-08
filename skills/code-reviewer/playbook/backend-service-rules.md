# Backend Service Correctness and Reliability

> Load on demand when the diff includes server-side source (`.java` / `.kt` / `.go` / `.py`, etc.). Focus on runtime failures; do not write specific incident cases.
> Empty catch goes through G3. Money goes through G6. Blast radius / redundant changes go through G11–G13 and `change-necessity-rules.md`. Remote calls inside loops go through `design-quality-rules.md` N+1.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Quick recognition signals |
|------|------|------|------------|
| §1 | Existing null / old-protocol compatibility | P1 | New field used with `.equals` directly; only the new path is covered |
| §2 | Delete without cascade; extension-field overwrite | P1 | Only delete the main table; `updateExt(json)` wholesale overwrite |
| §3 | Write idempotency | P0 | Payment/refund/ledger with no business unique key |
| §4 | Filter conditions and type comparison | P1 | String vs Integer `equals`; WHERE missing tenant |
| §5 | Transaction boundaries | P0 | Remote call inside a long transaction; no rollback after catch |
| §6 | Lost concurrent updates | P1 | Read-then-write with no version / lock |
| §7 | State machine missing a terminal state | P1 | switch on status misses a branch; exception stuck in a mid-state |
| §8 | Batch / backfill with no cap | P1 | Full-table scan; no canary; one row failure stops the whole batch |
| §9 | Incomplete cache fields | P1 | Update writes only some fields into cache |
| §10 | External failure with no fallback | P1 | After catch, keep using a half-built response |
| §11 | Thread-pool rejection policy | P1 | `CallerRunsPolicy` on a scheduler thread |
| §12 | Sync-to-async breaks ordering | P1 | Downstream still synchronously depends on the result |
| §13 | Retry semantics of error codes | P1 | Business failure and rate-limit share the same code |
| §14 | List nulls and complete fields | P1 | List returns `null`; new scenario omits response fields |
| §15 | Resources / large objects | P1 | Connection not closed; loading an oversized collection at once |
| §16 | Same-type positional params / wrong constants | P1 | `foo(orderId, customerId)` swapped; imported a same-named constant from another class |
| §17 | Feature flag inverted | P1 | `if (!isEnabled)` takes the new path; flag named `flag` |
| §18 | Critical-field semantics / hashCode as Map key | P1 | Tenant/type ID assigned to the wrong field; `map.put(obj.hashCode(), …)` |
| §19 | Write after a prerequisite failed | P0 | Continue `insert`/`update` after a downstream failure |
| §20 | Boundary 0 / empty collection / cross-day / cross-tenant | P1 | `if (count)` when count can be 0; query with no tenant |
| §21 | Cache miss and message consumption | P1 | cache get null returned directly; consume failure neither retried nor dead-lettered |
| §22 | Remote config backward compatibility | P1 | New field has no default; old process crashes on new JSON |
| §23 | Protocol merge bloat | P1 | Deserialize-merge accumulates unknown fields forever |
| §24 | Tight retry on failure | P1 | After catch, immediately re-hit downstream with no cap |
| §25 | Historical path re-entered via a new entry | P1 | A closed-flag branch is triggered again by a new caller |
| §26 | AI-assisted changes must match existing constants | P1 | SQL/enum written as magic numbers, inconsistent with repo constants |
| §27 | Validate external input at the entry | P1 | HTTP/RPC/message entry used without validation |
| §28 | Separate business exceptions from system exceptions | P1 | Global handler mixes them; `new Xxx(msg)` drops the cause |
| §29 | Config resolution chain and in-memory previous value | P1 | No hardcoded default; config-center down → NPE; previous good value discarded |
| §30 | Config validation / callback / observability | P1 | Out-of-range value still applied; RPC/DB in callback; change logs no old/new |
| §31 | Feature-flag shape | P1 / P2 | Not boolean; default on; nesting >2 levels; dead flags left on a hot path |
| §32 | Published API wrapper and exception declarations | P1 | Unified wrapper exists but returns bare null; entry `throws Exception` |
| §33 | Separate export/batch from list | P1 | List API `size` unbounded or doubles as export |
| §34 | Cache-Aside: read miss → DB → fill; write DB then delete cache | P1 | Write-through of a partial object; delete cache before persist |
| §35 | Cache penetration / breakdown / avalanche | P1 | Known-missing keys with no null-cache; hot-key miss stampede; identical TTLs |
| §36 | Distributed lock: atomic set+TTL; unlock only same request id | P1 | Lock with no TTL; unlock without an ownership check |
| §37 | Prefer local message table / idempotent Saga over 2PC/XA | P1 | Cross-store 2PC as the first choice for a new flow |
| §38 | MQ produce must check send result; ordered consume must not skip | P0 / P1 | Fire-and-forget send; ordered consume skips a failed message |
| §39 | Every RPC/HTTP/DB/cache call needs an explicit timeout | P1 | Outbound I/O with no timeout |
| §40 | Retry: idempotent + cap + backoff + jitter | P1 | Retry a non-idempotent write; backoff with no jitter |
| §41 | Weak dependency: catch + degrade + isolate pool | P1 | Optional dep on the core request pool; catch without degrade |
| §42 | Rate limit returns 429 (or project equivalent), not 500 | P1 | Rate-limit path returns 500 / a system error |
| §43 | Async must propagate trace/context | P1 | Async task loses request id / baggage |

---

## 1. Existing null / old-protocol compatibility

New fields, new enums, and new branches must run safely on old data that is null, old clients, and old callbacks. Changing a public method requires a cross-file search to evaluate all callers (Q0).

```java
// ❌ existing newField == null is NPE, or the restriction is skipped
if (policy.getNewField().equals("restrict")) { ... }

// ✅
if ("restrict".equals(policy.getNewField())) { ... }
```

---

## 2. Delete without cascade; extension-field overwrite

Deleting a main record must also update related tables (or be guaranteed by an explicit application-level transaction). Update extension JSON / Map with merge, not wholesale overwrite.

```java
// ❌
orderMapper.deleteById(orderId);

// ✅
@Transactional
public void deleteOrder(String orderId) {
    orderMapper.deleteById(orderId);
    orderItemMapper.deleteByOrderId(orderId);
}
```

---

## 3. Write idempotency

Retryable write paths such as payment, refund, ledger, license issue, and message delivery: the business unique-key check must precede other side effects; a database unique constraint is the backstop. Scheduled jobs / queues with at-least-once delivery must be written as if they will retry.

```java
// ❌ validate first, then check duplicates — concurrent writes can double-insert
validate(req);
if (repo.exists(req.getBizKey())) return DUPLICATE;
repo.insert(req);

// ✅ claim the unique key first, then do work
if (repo.exists(req.getBizKey())) return DUPLICATE;
try {
    repo.insertWithUniqueKey(req.getBizKey());
} catch (DuplicateKeyException e) {
    return DUPLICATE;
}
transfer(req);
```

---

## 4. Filter conditions and type comparison

Unify types before comparing remote config, query parameters, and domain fields. Multi-tenant SQL WHERE must include tenant / business line. Division by zero and overflow need guards.

```java
// ❌ Integer.equals(String) is always false; the whole table is filtered out
.filter(a -> a.getType().equals(config.getString("activity_type")))

// ✅
.filter(a -> Objects.equals(a.getType(), config.getInt("activity_type")))
```

---

## 5. Transaction boundaries

A transaction covers local data consistency only. Do not put RPC, messaging, or payment calls inside a long transaction. After catch, if rollback is still required, roll back explicitly (or rethrow so the proxy rolls back). Do not keep writing the database after an exception.

---

## 6. Lost concurrent updates

Concurrent modification of the same aggregate: optimistic lock `version`, conditional update `WHERE version=?`, or an explicit mutex. Do not bare read-modify-write.

---

## 7. State machine missing a terminal state

Write every legal transition for each state. Timeout, peer failure, and manual cancel must have a terminal or recoverable state; they must not stay in “processing” with no exit.

---

## 8. Batch / backfill with no cap

Backfill, migration, and compensation jobs: cap batch size, support canary, one-row failure must not stop the batch, be reentrant (idempotent), and be observable (success/failure counts). Do not load a whole table at once. Assess impact on online QPS.

---

## 9. Incomplete cache fields

Cache write-back must cover every field readers need. Partial updates must not leave a “half object”. Set expiry and refresh; do not remove refresh and assume the cache lives forever.

---

## 10. External failure with no fallback

On downstream timeout, error code, or gray-off, take an explicit legacy path or degraded result. Do not keep reading other fields from the response body on the failure branch. Return an empty object rather than letting the caller NPE.

```java
try {
    resp = newRouter.route(req);
} catch (Exception e) {
    return oldRouter.route(req);
}
if (!resp.isEnabled()) {
    return oldRouter.route(req);
}
```

---

## 11. Thread-pool rejection policy

`CallerRunsPolicy` makes the submitter run the task. A long task on a scheduler, IO, or request thread causes pile-up. Prefer `AbortPolicy` (or discard) + metrics / logs, and return a rate-limit error to the caller.

Threads must have readable names. Unbounded-queue `Executors` factories are forbidden (see `java-review-rules.md` §6).

---

## 12. Sync-to-async breaks ordering

Before changing a previously synchronous step to async, confirm whether downstream still depends on that result synchronously. If order is required, stay synchronous, emit a completion event, or run a compensation scan.

---

## 13. Retry semantics of error codes

Business rejection, rate-limit, and system error must be different codes. Callers retry only codes that are explicitly retryable. For the same request called multiple times, success / duplicate / failure semantics must be stable (read together with §3).

---

## 14. List nulls and complete fields

When a list / collection is empty, return `[]` / an empty collection, not `null`. Error responses carry a stable error code and displayable text; do not send a stack to the client. For new scenarios, assess whether existing response fields are still sufficient. Pagination: page < 1 is page 1; past the last page returns the last page or an empty page (follow the project convention, but it must be defined).

Numeric fields must consider client JSON precision (large integers as string, consistent with the frontend handbook).

---

## 15. Resources / large objects

Connections, streams, and buffers must be closed. Do not read a whole table or an oversized message body into memory at once. Timers / listeners must be released on the destroy path.

---

## 16. Same-type positional params / wrong constants

Two or more same-type positional parameters (`String, String`) are easy to swap and still compile. More than 3 positional parameters become an object / builder. Constants must match the imported type; do not use a same-named `Constants` from another package.

```java
// ❌
void process(String customerId, String orderId) { ... }
process(orderId, customerId);

// ✅
process(ProcessRequest.builder().customerId(customerId).orderId(orderId).build());
```

---

## 17. Feature flag inverted

The new path runs only when the flag hits. The flag name must read as the feature it controls (`featureEnabled`), not `flag` / `on`. A miss must take the old path; do not keep reading other fields from the response (read together with §10).

```java
// ❌
if (!featureToggle.isEnabled("newCheckout")) {
    runNewCheckout(req);
}

// ✅
if (featureToggle.isEnabled("newCheckout")) {
    runNewCheckout(req);
} else {
    runLegacyCheckout(req);
}
```

---

## 18. Critical-field semantics / hashCode as Map key

Before assigning tenant, type, or business IDs, confirm field semantics (org tenant vs site tenant, type code vs status code). Do not use `hashCode()` as a Map / dedup key (collisions overwrite).

```java
// ❌
map.put(item.hashCode(), item);

// ✅
map.put(item.getCustomerId(), item);
```

---

## 19. Write after a prerequisite failed

On downstream failure, validation failure, or partial success, early-return; do not continue `insert`/`update`. A failed write prerequisite means this call does not write. Complements §5: that rule is transaction rollback; this one is “should not have written at all after failure”.

```java
Catalog catalog = catalogClient.get(id);
if (catalog == null || !catalog.isOk()) {
    return Result.fail(ErrorCode.UPSTREAM);
}
orderRepo.save(from(catalog)); // write only after success
```

---

## 20. Boundary 0 / empty collection / cross-day / cross-tenant

The business meaning of `0`, empty list, and empty string must be explicit (“none” vs “not passed”). Queries and updates must include tenant / business line (same as §4 WHERE). Cross-day cutover and jobs that span calendar days must not assume “today” equals “business day”.

```java
// ❌ quantity 0 treated as not passed
if (quantity) { apply(quantity); }

// ✅
if (quantity != null) { apply(quantity); }
```

---

## 21. Cache miss and message consumption

A null cache get must load from source (DB or upstream), backfill, and set expiry; do not return null as a business result to a caller that will NPE. Message consume failure: retryable errors go back to the queue; unrecoverable go to dead-letter; a broken extension-field JSON must not kill the main message (log + empty map or dead-letter, chosen by whether it can degrade).

```java
NodeConfig config = cache.get(key);
if (config == null) {
    config = repo.findById(id);
    if (config != null) {
        cache.set(key, config, Duration.ofMinutes(30));
    }
}
```

---

## 22. Remote config backward compatibility

New config fields must have defaults so an old process reading new JSON cannot crash. After a code rollback, old logic must still parse the current config. Parse failure uses default config; do not let startup or every request 500.

```java
RemoteConfig config;
try {
    config = parse(remoteConfig.get("order.process"));
    if (config.getThreshold() == null) {
        config.setThreshold(50);
    }
} catch (Exception e) {
    log.warn("bad remote config, using defaults", e);
    config = RemoteConfig.defaults();
}
```

---

## 23. Protocol merge bloat

When old and new versions coexist, do not repeatedly merge unknown fields on the same record (protobuf / similar binary protocols accumulate unknown forever). During gray: old processes ignore new fields; new processes default new fields.

---

## 24. Tight retry on failure

Immediately re-hitting downstream after catch with no cap and no backoff causes a stampede. Retries need a count cap, exponential backoff, and only explicitly retryable error codes (see §13).

---

## 25. Historical path re-entered via a new entry

New code must not re-call a closed flag, a deprecated branch, or an entry whose comments say “do not go here again”. When changing a public method, use Q0 to search all callers and confirm a dead path will not be activated by a new entry.

---

## 26. AI-assisted changes must match existing constants

SQL conditions, status codes, and type literals added in the diff must have a matching enum / constant in the repo. If they do not match, treat as P1: a magic number or the generator guessed the wrong business code. Do not stop at “it compiles”.

---

## 27. Validate external input at the entry

External input such as HTTP, RPC, and message bodies should be validated at the method entry. Failure throws a clear business exception (or validation exception); do not return `null` / an empty object and hide the error. Numerics need upper and lower bounds so abnormal values do not hit downstream. Complements §19: that rule is “do not write after validation fails”; this one is “stop it before business logic”. Empty catch still goes through G3.

The entry may use Bean Validation (`@Valid` / `@NotNull` / `@Size`), `Objects.requireNonNull`, or the project’s existing pre-validation utilities. Do not introduce a new validation framework for this rule.

```java
// ❌
public OrderResult createOrder(OrderRequest request) {
    return orderRepo.insert(request.toEntity());
}

// ✅
public OrderResult createOrder(OrderRequest request) {
    Objects.requireNonNull(request, "request must not be null");
    if (request.getAmount() == null || request.getAmount().signum() <= 0) {
        throw new IllegalArgumentException("amount must be positive");
    }
    if (request.getAmount().compareTo(MAX_AMOUNT) > 0) {
        throw new IllegalArgumentException("amount exceeds limit");
    }
    return orderRepo.insert(request.toEntity());
}
```

---

## 28. Separate business exceptions from system exceptions

Expected business failures (illegal argument, insufficient stock, insufficient balance) and infrastructure failures (timeout, connection failure, resource exhaustion) must take different paths. Business failures return a stable error code; do not treat them as incidents that trip circuit breakers or alarm storms. System failures log at error, and trip circuit-break / degrade. Whether an error code is retryable still goes through §13.

Global exception handling (e.g. `@ControllerAdvice`) must split by type. Wrapped exceptions must keep the cause: `throw new BusinessException("msg", e)`, not `new BusinessException("msg")` dropping the chain. Empty `catch` still goes through G3; this rule does not lower that.

```java
// ❌ every exception is one ERROR; business failures also alarm
@ExceptionHandler(Exception.class)
public Result<?> handleAll(Exception e) {
    log.error("error", e);
    return Result.fail("system error");
}

// ✅
@ExceptionHandler(BusinessException.class)
public Result<?> handleBusiness(BusinessException e) {
    log.warn("business error: code={}, msg={}", e.getCode(), e.getMessage());
    return Result.fail(e.getCode(), e.getMessage());
}

@ExceptionHandler(Exception.class)
public Result<?> handleSystem(Exception e) {
    log.error("system error", e);
    return Result.fail(ErrorCode.SYSTEM_ERROR, "system busy, please retry later");
}
```

---

## 29. Config resolution chain and in-memory previous value

Remote config, local cache, and a hardcoded default must form one complete resolution chain: when remote is unavailable, read the last successful in-process value or local cache; if that fails, use the hardcoded default. Do not let a config-center timeout/null travel all the way to unboxing or `.equals` and NPE. Inverted flags still go through §17; parse-failure-does-not-crash and new-field defaults still go through §22. This rule adds: do not discard a value that was already applied successfully; keep the previous copy in-process for a fast rollback. Business fallback for external downstream failure still goes through §10.

Read remote config through the config client and listen APIs already wired in the repo; do not write a parallel wrapper (P2, maintainability).

```java
// ❌ no default, no previous value; config center down is null
private Integer maxRetry;

public int getMaxRetry() {
    return remoteConfig.getInt("order.maxRetry");
}

// ✅ hardcoded default + in-memory previous; resolve: remote → cache/previous → default
private static final int DEFAULT_MAX_RETRY = 3;
private volatile int maxRetry = DEFAULT_MAX_RETRY;

int resolveMaxRetry(Integer remote, Integer cached) {
    if (remote != null) {
        return remote;
    }
    if (cached != null) {
        return cached;
    }
    return DEFAULT_MAX_RETRY;
}
```

Fields written by an async callback and read by the request thread must be visible to other threads (Java: `volatile` / `Atomic*`; see `java-review-rules.md` §21).

---

## 30. Config validation, callback thread, and change observability

Config-center pushes are untrusted input, complementary to §27 (HTTP/RPC/message entry). Numerics must have upper and lower bounds; JSON / composite structures must be parsed in try-catch. Out of range or parse failure: keep the last good in-memory value and warn; do not overwrite with an illegal value, and do not replace an existing value with `null` (only fall through to the §29 hardcoded default when there is no previous; startup parse-failure-does-not-crash still goes through §22).

A config-change callback only parses, validates, replaces the in-memory reference, and logs. Do not RPC, hit the database, or do other slow I/O on the callback thread (it blocks the push thread and stalls later changes). Need to notify downstream: enqueue on the project’s existing work queue; do not do it synchronously in the callback.

Every accepted or rejected change must be readable from logs: time, key, old value, new value (or reject reason). “config updated” alone is not enough. Release cadence and gray ratio are release process, not a code P0 on this rule.

```java
// ❌ no validation, RPC in callback, no old/new; parse failure bubbles to the push thread
void onConfigChange(String key, String raw) {
    maxRetry = Integer.parseInt(raw);
    orderClient.refresh(raw);
}

// ✅
void onConfigChange(String key, String raw) {
    final int oldValue = maxRetry;
    try {
        int next = Integer.parseInt(raw);
        if (next < 1 || next > 100) {
            log.warn("config rejected key={}, old={}, new={}, ts={}",
                key, oldValue, next, Instant.now());
            return;
        }
        previousMaxRetry = oldValue;
        maxRetry = next;
        log.info("config changed key={}, old={}, new={}, ts={}",
            key, oldValue, next, Instant.now());
    } catch (Exception e) {
        log.warn("config parse failed, keep old: key={}, old={}, raw={}, ts={}",
            key, oldValue, raw, Instant.now(), e);
    }
}
```

---

## 31. Feature-flag shape

A feature flag must be boolean (or the project flag API’s `isEnabled`) and default off. When unset or the config center is unavailable, take the old path; do not default on and send all traffic into the new branch. “New path only on hit” still goes through §17; this rule does not change that judgment.

Flag nesting is at most 2 levels. Three or more `if (a && b && c)` layers invert easily and cannot roll back one layer alone.

```java
// ❌ string flag, treated as on by default, nested too deep
if (!"N".equals(cfg.get("newCheckout"))
        && "1".equals(cfg.get("newCheckout.v2"))
        && cfg.getBoolean("newCheckout.v2.step3")) {
    runNewCheckout(req);
}

// ✅ boolean, default off, single level
if (featureToggle.isEnabled("newCheckout")) {
    runNewCheckout(req);
} else {
    runLegacyCheckout(req);
}
```

Do not leave old flags on a hot path that no longer have a read site (P2): they raise the risk of §17 inversion and this rule’s nesting. Whether a given iteration deletes them is process; this rule only looks at whether the diff still reads a deprecated flag.

---

## 32. Published API wrapper and exception declarations

If the repo already has a unified result/error wrapper (the name may be `Result`, `ApiResponse`, `RpcResult`, or a project type), published HTTP / RPC methods should reuse it; do not start another set, and do not require the name `Result<T>`. With a wrapper, do not use bare `null` for “not found” — take the wrapper’s failure / not-found path. List and collection payloads still return an empty collection, not `null` (see §14); do not fight this rule.

If the repo already returns a DTO directly and expresses failure via HTTP status or RPC error codes, do not wrap an extra layer for this rule.

Published methods must not declare `throws Exception`, and must not throw `SQLException` or framework exceptions straight to the caller. Business failures use the project’s existing business exception type or the wrapper’s error code; technical detail goes to logs only (see `backend-security-rules.md` §10). Do not require the name `BusinessException`. Classification, keeping cause, and global handling still go through §28.

Retryable published write APIs must accept an idempotency key or business unique key (request field or header; name follows the project). Implementation and DB unique constraint still go through §3 / B5. Do not require a fixed header name.

```java
package com.example.order;

// ❌ published entry throws Exception; wrapper exists but returns null
public interface OrderService {
    OrderDTO getOrder(String orderId) throws Exception;
}

// ✅ reuse the project's existing wrapper; not-found is a failure path, not bare null
public interface OrderService {
    OrderResult<OrderDTO> getOrder(String orderId);
}

OrderResult<OrderDTO> getOrder(String orderId) {
    OrderDTO order = repo.find(orderId);
    if (order == null) {
        return OrderResult.notFound();
    }
    return OrderResult.ok(order);
}
```

---

## 33. Separate export/batch from list APIs

Client-facing list/query APIs must paginate (page-number rules: §14). SQL caps: `backend-data-access-rules.md` §20 (when the repo has no convention, recommend no more than 100; this rule does not change that number). A list API must not pull a full set by “cranking `size` huge” or omitting the cap.

Export, dump, and batch download must be a **separate** API or job; do not share one entry with the paginated list and branch on a huge `size`. Backfill / batch jobs still go through §8.

```java
package com.example.order;

// ❌ list API doubles as export
OrderPage listOrders(OrderQuery query, int page, int size); // size can be Integer.MAX_VALUE

// ✅ list is paginated; export is a dedicated entry
OrderPage listOrders(OrderQuery query, int page, int size);

void exportOrders(OrderExportRequest request); // async job or dedicated download
```

---

## 34. Cache-Aside: read miss → DB → fill; write DB then delete cache

Read-miss load-from-source and backfill still go through §21; incomplete cache fields still go through §9. This rule does not replace those. This rule only adds the write path: persist first, then **invalidate/delete** the key. Do not write-through a partial object unless the repo already does that. Do not delete the cache before the DB write (a concurrent reader can refill from the old row).

```java
package com.example.order;

// ❌ delete-then-write, or write a partial object into cache
cache.delete(key);
repo.save(order);
cache.set(key, partialOrder);

// ✅ persist, then invalidate
repo.save(order);
cache.delete(key);
```

---

## 35. Cache penetration / breakdown / avalanche

Protect the source store when cache traffic is hostile or synchronized. This rule does not replace §9 / §21 / §34.

- **Penetration** (many queries for keys that never exist): cache a short-lived null / empty marker, or reject known-missing keys with a bloom filter (or the project equivalent).
- **Breakdown** (one hot key expires): serialize the refill with a mutex / single-flight so only one loader hits the DB.
- **Avalanche** (many keys expire together): add TTL jitter so expiries spread.

Do not treat a product-specific value-size number as a P0 on this rule.

```java
package com.example.order;

// ❌ miss on a missing customerId hits DB every time; identical TTL
Order order = cache.get(key);
if (order == null) {
    return repo.find(customerId);
}

// ✅ null-cache / bloom for known-missing; jitter the TTL
Order order = cache.get(key);
if (order == null) {
    order = repo.find(customerId);
    cache.set(key, order != null ? order : NULL_MARKER, ttlWithJitter());
}
```

---

## 36. Distributed lock: atomic set+TTL; unlock only same request id

Acquire with an atomic set-if-absent plus TTL (`SET NX`/`PX` or the project equivalent) so a crashed holder cannot hold the lock forever. Unlock only via compare-and-delete (Lua or the project equivalent) using the **same request id** that acquired the lock. Do not unlock a lock you do not own. This rule names no lock product. Local `tryLock` still goes through `java-review-rules.md` §34.

```java
package com.example.order;

// ❌ lock with no TTL; unlock without checking owner
lock.set(lockKey, "1");
try {
    updateOrder(order);
} finally {
    lock.delete(lockKey);
}

// ✅ atomic set+TTL; compare-and-delete with this request id
String requestId = newLockRequestId();
if (!lock.tryAcquire(lockKey, requestId, ttl)) {
    return Result.conflict();
}
try {
    updateOrder(order);
} finally {
    lock.releaseIfOwner(lockKey, requestId);
}
```

---

## 37. Prefer local message table / idempotent Saga over 2PC/XA

For a new cross-store write, prefer an outbox / local message table plus idempotent consumers (or an idempotent Saga) over introducing 2PC/XA. This is a preference, not a ban: if the repo already uses XA, do not rip it out for this rule. Remote calls inside a DB transaction still go through §5; write idempotency still goes through §3.

```java
package com.example.order;

// ❌ new flow starts with XA across order + ledger
userTransaction.begin();
orderRepo.save(order);
ledgerXa.save(entry);
userTransaction.commit();

// ✅ local write + outbox; consumer is idempotent
@Transactional
public void submit(Order order) {
    orderRepo.save(order);
    outbox.append("order.submitted", order.getId(), order.getCustomerId());
}
```

---

## 38. MQ produce must check send result; ordered consume must not skip

Produce (P1): check the send ack/result. On failure, compensate or retry (local message table / outbox is fine). Do not fire-and-forget a business event.

Consume idempotency, retry, and dead-letter still go through §21; this rule does not rewrite that. This rule only adds **ordered** messages: they must share a partition key, and a failed message must not be skipped while later ones proceed. **P0** if the order is money / ledger sequencing; otherwise P1.

```java
package com.example.order;

// ❌ ignore send result; ordered consume skips a failure
producer.send(topic, message);
// on consume failure: ack and continue to the next offset

// ✅ check send result; same partition key; do not skip a failed ordered message
SendResult result = producer.send(topic, partitionKey(order.getCustomerId()), message);
if (!result.isOk()) {
    outbox.append("order.submitted", order.getId(), order.getCustomerId());
}
```

---

## 39. Every RPC/HTTP/DB/cache call needs an explicit timeout

Outbound I/O (RPC, HTTP, DB, cache) must set an explicit timeout. Do not rely on an unbounded framework default on the request path. Retry after timeout still goes through §24 / §40; this rule does not rewrite those.

```java
package com.example.order;

// ❌ no timeout
Order order = orderClient.getOrder(customerId);

// ✅ timeout is explicit (API follows the repo)
Order order = orderClient.getOrder(customerId, Duration.ofSeconds(2));
```

---

## 40. Retry: idempotent + jitter

§24 already requires a count cap, exponential backoff, and only explicitly retryable codes. This rule does not replace §24. This rule only adds: retry a write only if the operation is idempotent (or is guarded by §3); add jitter to the backoff so retries do not align.

```java
package com.example.order;

// ❌ retry a non-idempotent charge; backoff with no jitter
catch (TimeoutException e) {
    sleep(backoffMs);
    ledger.charge(order);
}

// ✅ retry only if idempotent; jitter the backoff
if (!isIdempotent(order) || attempt >= maxAttempts) {
    throw e;
}
sleep(backoffMs + jitterMs());
ledger.charge(order.getIdempotencyKey(), order);
```

---

## 41. Weak dependency: catch + degrade + isolate pool

Optional / non-core downstreams must not block the core path. Catch, degrade to a business-meaningful fallback, and isolate the optional dep on its own thread pool or circuit. Core-path fallback after a required downstream failure still goes through §10; this rule does not replace that.

```java
package com.example.order;

// ❌ recommendation RPC on the order submit pool; failure fails checkout
Order recs = recsClient.recommend(customerId);
return submit(order, recs);

// ✅ isolated pool / circuit; degrade and continue
List<Sku> recs;
try {
    recs = recsClient.recommend(customerId);
} catch (Exception e) {
    log.warn("recs failed, customerId={}", customerId, e);
    recs = List.of();
}
return submit(order, recs);
```

---

## 42. Rate limit returns 429 (or project equivalent), not 500

When the application or gateway rejects a caller for rate limiting, return **429** (or the project’s existing rate-limit code). Do not map that path to 500 / a generic system error — callers will retry as if the process is sick. Distinct codes for business / rate-limit / system still go through §13; this rule does not replace that.

```java
package com.example.order;

// ❌
return Result.fail(500, "system busy");

// ✅
return Result.fail(429, "rate limited");
```

---

## 43. Async must propagate trace/context

When work leaves the request thread (`Executor`, `CompletableFuture`, message handler), copy request id / baggage / MDC into the async task. Use the project’s context propagator or wrap the executor. Do not start a bare `Runnable` that drops the inbound context. Pool construction still goes through `java-review-rules.md` §6 / §42.

```java
package com.example.order;

// ❌ async task has no request context
orderPool.submit(() -> notify(order));

// ✅ wrap the executor or pass the captured context
Context captured = Context.current();
orderPool.submit(() -> captured.wrap(() -> notify(order)).run());
```
