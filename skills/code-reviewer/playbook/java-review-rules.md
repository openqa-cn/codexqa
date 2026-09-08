# Java Review Rules

> Load on demand when the diff includes `.java` / `.kt`. Only collect items that need semantic judgment; formatting issues such as indentation, line width, and wildcard imports belong to the compiler / Checkstyle / Spotless — do not repeat them here.
> Amount literals still go through cheat sheet G6 and `monetary-precision-rules.md`. Empty catch goes through G3. Missing switch break goes through G7.
> Examples use `com.example.order` and `customerId`.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Quick recognition signals |
|------|------|------|------------|
| §1 | Constant-side `equals` | P0 | `nullable.equals("x")` |
| §2 | Wrapper types compared with `==` | P1 | `Integer a == Integer b` |
| §3 | Float / BigDecimal compare and construct | P0 | `new BigDecimal(0.1)`; `bd.equals`; `d1 == d2` |
| §4 | Date pattern and thread safety | P1 | `YYYY`; `static SimpleDateFormat` |
| §5 | Collection mutation and subList | P1 | `remove` inside foreach; `(ArrayList) list.subList` |
| §6 | Thread pools and ThreadLocal | P0 | `Executors.new*`; ThreadLocal in a pool without `remove` |
| §7 | switch on String and ternary unboxing | P1 | `switch (external)` without null check; ternary with one wrapper side |
| §8 | Resource close and return in finally | P1 | Stream not closed; `finally { return }` |
| §9 | Logging facade and placeholders | P2 | `log.info("x" + y)`; `System.out` / `printStackTrace` |
| §10 | Serialization and public signatures | P1 | Changing `serialVersionUID`; changing a published method signature |
| §11 | Division by zero and integer overflow | P1 | `/ count` without a zero check; `int` accumulating money or large counts |
| §12 | Shallow copy sharing mutable objects | P1 | `list.clone()` / same reference stuffed into two records then mutated in place |
| §13 | Set.contains type mismatch | P1 | `Set<Integer>.contains("1")` always false |
| §14 | External returns and chained calls must null-check | P1 | `a.getB().getC()`; unboxing a wrapper directly |
| §15 | Do not increment/decrement date-time fields by hand | P1 | `getDayOfMonth() + 1`; `getHour() - 1` |
| §16 | Loops must have bounds and a real body | P1 | `while (true)`; `for (;;)`; empty loop body; index out of range |
| §17 | switch must cover default | P2 | Has cases, no `default` (missing break still goes through G7) |
| §18 | Do not mask the original exception when releasing resources | P1 | `close` in `finally` throws and hides the try exception; connection not returned |
| §19 | Non-money float compare needs an epsilon | P1 | `d1 == d2` and not a money path (money still goes through §3 / G6) |
| §20 | No synchronous reverse DNS on the request path | P1 | Reverse-lookup hostname from IP / blocking DNS |
| §21 | Config fields written asynchronously must be visible | P1 | Listener thread writes, request thread reads, field is not `volatile` / `Atomic*` |
| §22 | Published interface naming | P2 | Interface type name contains `Impl`/`DAO`; capability name abbreviated to `UMgr` |
| §23 | Published API parameter shape | P1 / P2 | `Map<String,Object>` as the only input; HTTP/RPC inputs as primitives |
| §24 | Do not delete published methods/fields | P1 | Deleting a published method or field; changing a published field type in place |
| §25 | NPE from collection elements / request attributes / concurrent get | P1 | Using foreach elements directly; `getAttribute` without null check; `containsKey` then immediate `get` |
| §26 | Split try-catch by operation | P1 | Parse + write DB + notify wrapped in one `catch (Exception)` |
| §27 | Prefer pre-checks over catching bounds/NPE | P1 | `catch (IndexOutOfBoundsException` / `NullPointerException)` as a normal branch |
| §28 | Do not throw bare RuntimeException/Exception | P1 | `throw new RuntimeException("…")`; `throw new Exception(` |
| §29 | Business code must not catch Error/Throwable | P1 | Business method `catch (Throwable` / `catch (Error` |
| §30 | catch type must match the actual failure | P2 | Only one checked failure to handle, yet `catch (Exception)` and swallow |
| §31 | Prefer not returning null from published non-collection methods | P2 | Unwrapped query returns bare `null` and the contract does not say so |
| §32 | Singleton publish: DCL needs volatile | P1 | `getInstance` double-checked locking; instance is not `volatile` |
| §33 | Shrink synchronized critical sections | P2 | `synchronized` around the whole method; a concurrent collection would suffice |
| §34 | tryLock must confirm the lock is held | P1 | `tryLock` not checked; `unlock` without holding |
| §35 | Do not schedule with Timer | P1 | `new Timer(`; `TimerTask` |
| §36 | CountDownLatch must complete and be time-bounded | P1 | `await()` with no timeout; failure path skips `countDown` |
| §37 | Do not share Random across threads | P1 | Multiple threads share one `Random` field |
| §38 | Do not rely on volatile alone with multiple writers | P1 / P2 | `volatile` field `++`; hot-path counters |
| §39 | Do not share a plain HashMap across threads | P1 | Threads share a `HashMap`; `containsKey` then `put` |
| §40 | Prefer strong consistency for funds and inventory concurrency | P2 | Balance/inventory read-modify-write without a row lock |
| §41 | Future.get must have a timeout | P1 | `future.get()` / `Future.get()` with no timeout |
| §42 | CompletableFuture / supplyAsync must use an explicit pool | P1 | `supplyAsync(fn)` with no executor; nested `join()` / `get()` on the request path |
| §43 | Local / new ThreadPoolExecutor must shutdown | P1 | Method-scoped `new ThreadPoolExecutor` / `Executors.new*` with no `shutdown` |
| §44 | Do not share one pool between parent and child blocking tasks | P1 | Parent submits child work to the same pool then `get` / `join` |
| §45 | Collectors.toMap must handle key clash and null values | P1 | `Collectors.toMap(k, v)` with no merge function; null values |
| §46 | ConcurrentHashMap must not use null key/value | P1 | `chm.put(null, …)` / `chm.put(k, null)` |
| §47 | Recursion must not spawn unbounded threads/tasks | P1 | `submit` / `new Thread` inside recursion on a request path |

---

## 1. Constant-side equals

Do not call `equals` on an object that may be null.

```java
// ❌
if (policy.getStatus().equals("ACTIVE")) { ... }

// ✅
if ("ACTIVE".equals(policy.getStatus())) { ... }
```

---

## 2. Wrapper comparison

Compare `Integer` / `Long` and other wrappers with `equals`, not `==` (except versus `null`).

```java
// ❌
if (left == right) { ... } // may be equal values on different instances

// ✅
if (Objects.equals(left, right)) { ... }
```

---

## 3. Float / BigDecimal

Do not use `new BigDecimal(double)`. Compare equality with `compareTo`, not `equals` (different scales fail). Do not use `==` on binary floats for money or rates.

```java
// ❌
new BigDecimal(0.1);
if (a.equals(b)) { ... }

// ✅
new BigDecimal("0.1");
BigDecimal.valueOf(0.1);
if (a.compareTo(b) == 0) { ... }
```

DO field types must match the database column type (money uses `BigDecimal` / `DECIMAL`, not `double`).

---

## 4. Date pattern and thread safety

- Year is `yyyy`, not `YYYY` (week-year)
- `M` is month, `m` is minute; `H` is 24-hour, `h` is 12-hour
- Current millis: `System.currentTimeMillis()`
- `SimpleDateFormat` is not thread-safe; do not share it via `static`; prefer `DateTimeFormatter`
- Business code must not use `java.sql.Date` / `Time` / `Timestamp` as domain types

```java
// ❌
new SimpleDateFormat("YYYY-MM-dd");
private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd");

// ✅
DateTimeFormatter.ISO_LOCAL_DATE;
new SimpleDateFormat("yyyy-MM-dd"); // local use only
```

---

## 5. Collection mutation and subList

- Overriding `equals` requires overriding `hashCode`; types used as Map keys / Set elements must override both
- Do not cast a `subList` result to `ArrayList`; mutating the original list can throw `ConcurrentModificationException` on the sublist
- Do not `add`/`remove` inside foreach; use `Iterator` (lock the iterator when concurrent)
- Give expected capacity when initializing a collection

```java
// ❌
for (String item : items) {
    if (expired(item)) items.remove(item);
}

// ✅
items.removeIf(this::expired);
```

---

## 6. Thread pools and ThreadLocal

Do not use factories such as `Executors.newFixedThreadPool` / `newCachedThreadPool` (unbounded queue or opaque rejection). Use `ThreadPoolExecutor` and set core size, queue, rejection policy, and thread names explicitly.

`ThreadLocal` used in a thread pool must be `remove`d in `finally`, or reused threads will leak data across requests.

Singletons and their methods must be thread-safe. Keep a fixed lock order when holding multiple locks. Blocking locks must be acquired outside `try` and released in `finally`.

Concurrent updates to the same row: use an application lock, a cache lock, or a database optimistic lock (`version`).

```java
// ❌
ExecutorService pool = Executors.newCachedThreadPool();

// ✅
new ThreadPoolExecutor(
    8, 16, 60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(200),
    namedThreadFactory("order-worker"),
    new ThreadPoolExecutor.AbortPolicy());
```

`CallerRunsPolicy` blocks the calling thread; do not use it on scheduler/IO threads (see `backend-service-rules.md`).

---

## 7. switch on String and ternary unboxing

Null-check an externally supplied `String` before `switch`. When ternary arms have mismatched types, unboxing can NPE.

```java
// ❌
switch (request.getType()) { ... } // type may be null
Integer a = null;
int b = cond ? a : 1; // unboxing NPE

// ✅
String type = request.getType();
if (type == null) { ... }
int b = cond ? (a != null ? a : 0) : 1;
```

Do not rely on “equals a single value” as a high-concurrency exit condition (it can skip); use a range or a state machine.

---

## 8. Resource close and return in finally

Use try-with-resources for streams, connections, and locks. Do not `return` in `finally` (it swallows exceptions from try).

If a transactional method catches an exception and still needs rollback, roll back explicitly (or let the exception propagate for declarative transactions).

Do not use exceptions for normal control flow (same rule as the frontend handbook; it applies to Java as well).

```java
// ❌
InputStream in = Files.newInputStream(path);
try {
    return parse(in);
} finally {
    return defaultValue(); // swallows the exception
}

// ✅
try (InputStream in = Files.newInputStream(path)) {
    return parse(in);
}
```

---

## 9. Logging facade and placeholders

Depend on SLF4J (or the project’s unified facade); do not call a concrete implementation API directly. Use `{}` placeholders, not string concatenation. Production forbids `System.out` / `System.err` / `e.printStackTrace()`. For trace/debug, check the level before assembling expensive arguments.

```java
// ❌
log.info("order=" + orderId);
e.printStackTrace();

// ✅
log.info("orderId={}", orderId);
log.error("submit failed, orderId={}", orderId, e);
```

---

## 10. Serialization and public signatures

Do not change method signatures on published interfaces; mark obsolete methods `@Deprecated` and point to the replacement. Do not casually change `serialVersionUID` when adding serializable fields (change it only for incompatible upgrades). Overrides must use `@Override`. Do not put business default values on POJO properties (avoids “never set” vs “is the default”).

---

## 11. Division by zero and integer overflow

The divisor must be non-zero before divide or modulo (including wrapper unboxing). Do not bare-add money, counts, or inventory on `int`/`long` paths that can overflow; money still goes through G6 / `BigDecimal`.

```java
// ❌
int avg = total / items.size(); // size==0
int sum = a + b; // may overflow

// ✅
if (items.isEmpty()) { return 0; }
int avg = total / items.size();
```

---

## 12. Shallow copy sharing mutable objects

`clone()`, or stuffing the same `List`/`Map` reference into two entities and then `add`/`put` in place, dirties the other. Need an independent lifecycle: deep-copy or create a new collection.

```java
// ❌
Order copy = original;
copy.getItems().add(extra); // mutates the same list

// ✅
List<Item> items = new ArrayList<>(original.getItems());
items.add(extra);
```

---

## 13. Set.contains type mismatch

The argument type of `Set.contains` / `Map.get` must match the element / key type. `contains("1")` on a `Set<Integer>` is always false; filtering silently empties the result.

```java
// ❌
Set<Integer> types = Set.of(1, 2);
types.contains(config.getString("type")); // always false

// ✅
types.contains(config.getInt("type"));
```

---

## 14. External returns and chained calls must null-check

Objects returned from RPC, database, cache, or message consumption must be null-checked before use. Do not chain calls without a null check. Methods that semantically return a primitive must not be changed to a wrapper; callers must null-check before auto-unboxing. `Optional` is fine for chained null handling. Constant-side `equals` still goes through §1 / B1; do not repeat it here.

```java
// ❌
UserInfo user = userClient.getUser(customerId);
String city = user.getAddress().getCity();
int retries = configClient.getRetryCount(); // Integer unboxing NPE

// ✅
UserInfo user = userClient.getUser(customerId);
if (user == null) {
    return Result.notFound();
}
String city = Optional.ofNullable(user.getAddress())
    .map(Address::getCity)
    .orElse(null);
Integer retries = configClient.getRetryCount();
if (retries != null && retries > 0) {
    retry(retries);
}
```

---

## 15. Do not increment/decrement date-time fields by hand

Do not apply hand-written `+` / `-` to values from `LocalDate` / `LocalDateTime` / `ZonedDateTime` `getDayOfMonth()`, `getDayOfYear()`, `getMonthValue()`, `getHour()`, `getMinute()`, `getSecond()`, `getYear()`, `get(TemporalField)`, `getLong(TemporalField)`, or `lengthOfMonth()`. Month boundaries, leap years, and DST will be wrong. Compute with `plus*` / `minus*` (or `plus(amount, unit)`). Year patterns still go through §4 (`yyyy`, not `YYYY`).

```java
// ❌
LocalDateTime next = time.withDayOfMonth(time.getDayOfMonth() + 1);

// ✅
LocalDateTime next = time.plusDays(1);
```

---

## 16. Loops must have bounds and a real body

Request-handling paths forbid bare `while (true)` / `for (;;)`. Polling that is truly required must be wrapped and must have a timeout, a max count, or an interruptible condition. The collection must be non-null before iteration; indexes must satisfy `0 <= i < size()`. Empty loop bodies are forbidden (including a stray semicolon after `for`/`while`). Structural mutation inside foreach still goes through §5; use `Iterator.remove()` / `removeIf`.

```java
// ❌
while (true) {
    poll();
}
for (int i = 0; i <= orders.size(); i++) {
    process(orders.get(i));
}

// ✅
for (int i = 0; i < maxPolls && !stopped(); i++) {
    if (!poll()) {
        break;
    }
}
if (orders == null || orders.isEmpty()) {
    return;
}
for (int i = 0; i < orders.size(); i++) {
    process(orders.get(i));
}
```

---

## 17. switch must cover default

A `switch` must have `default` (or an equivalent exhaustive set of branches, e.g. every enum constant). Unmatched values should fall back, log, or throw a clear exception; even if you decide to ignore, keep an empty `default` to show it was considered. Fall-through and missing `break`/`return`/`throw` still go through cheat sheet G7; this rule does not lower G7. Intentional fall-through must have a comment.

```java
// ❌
switch (status) {
    case PENDING:
        handlePending();
        break;
    case COMPLETED:
        handleCompleted();
        break;
}

// ✅
switch (status) {
    case PENDING:
        handlePending();
        break;
    case COMPLETED:
        handleCompleted();
        return;
    default:
        throw new IllegalArgumentException("unknown status: " + status);
}
```

---

## 18. Do not mask the original exception when releasing resources

Prefer try-with-resources for streams, connections, and locks (§8). If you must close in `finally`: a close failure must not hide the original exception from try (log and discard the close exception, or `addSuppressed`). Pooled connections (database, cache, HTTP) must be returned after use; HTTP clients need a connection cap and idle timeout; do not create a new unclosed connection per request.

```java
// ❌
InputStream in = Files.newInputStream(path);
try {
    return parse(in);
} finally {
    in.close(); // close failure hides parse's exception
}

// ✅
try (InputStream in = Files.newInputStream(path)) {
    return parse(in);
}
```

---

## 19. Non-money float compare needs an epsilon

Money and rates still go through §3 / G6 (`BigDecimal.compareTo`; no `new BigDecimal(double)`). Do not compare ordinary `float` / `double` with `==` / `equals`; use `Math.abs(a - b) < epsilon`, with epsilon set by business precision.

```java
// ❌
if (latitude == other.latitude) { ... }

// ✅
if (Math.abs(latitude - other.latitude) < 1e-6) { ... }
```

---

## 20. No synchronous reverse DNS on the request path

Do not do synchronous reverse DNS / hostname lookup from an IP on request threads or message-consumer threads. These calls block and jitter on timeout; high QPS will fill the thread pool. Need host info: use a value cached at startup, or an async query with a timeout.

```java
// ❌
String host = InetAddress.getByName(remoteIp).getHostName();

// ✅ use an already-resolved address or a startup cache
String host = request.getRemoteAddr();
```

---

## 21. Config fields written asynchronously must be visible

When a config-center listener / callback writes a field on another thread and the request thread reads the same field, visibility is required: use `volatile` or `AtomicInteger` / `AtomicReference`. Assigning a plain field in the callback can leave the request thread reading a stale or default value. Value-resolution chain, keep-old-on-out-of-range, and no slow I/O in callbacks: see `backend-service-rules.md` §29–§30; this rule only adds Java memory visibility. General singleton thread-safety still goes through §6.

```java
// ❌ callback thread writes; request thread may not see it
private int maxRetry = 3;

void onConfigChange(String raw) {
    maxRetry = Integer.parseInt(raw);
}

// ✅ visibility via volatile; validation / keep-old: see service §30
private volatile int maxRetry = 3;
```

---

## 22. Published interface naming

This rule only constrains **published** HTTP / RPC / SDK facade `interface` type names (the ones callers compile against). It does not review every private interface in the repo. Use UpperCamelCase and name by capability (`OrderService`, `OrderQuery`). Do not put `Impl` or `DAO` in the **interface type name** (those are implementation suffixes). Implementation classes may be `OrderServiceImpl`, `OrderDao`.

Do not treat “short name” as a defect by default; report only when the name does not show the capability (`UMgr`, `interface OrderServiceImpl`). Indentation and wildcard imports are still out of this handbook.

```java
package com.example.order;

// ❌ interface name carries an impl suffix, or shows no capability
public interface OrderServiceImpl {
    OrderDTO getByCustomerId(Long customerId);
}

public interface UMgr { }

// ✅ capability name; DAO only on the implementation class
public interface OrderService {
    OrderDTO getByCustomerId(Long customerId);
}

public class OrderDao { }
```

---

## 23. Published API parameter shape

Published HTTP / RPC methods must not take `Map<String, Object>` or a bare `List` as the **only** request body (callers cannot see required fields; review cannot see types). Use a DTO / the project’s existing command or query type, with business field names (`customerId`, not `p1` / `map`). A collection field inside a DTO may be `List<OrderItem>`; that is not “List as the only request body”. More than 3 same-type positional parameters still go through `backend-service-rules.md` §16; this rule does not change that threshold.

**Request/response types** of published HTTP / RPC prefer wrappers (`Long customerId`) so a missing JSON field is `null`, not `0` (P2). **Private methods are not in scope**: if the semantics call for a primitive, still follow §14; do not change to a wrapper for this rule. Unboxing NPE still goes through §7 / §14; this rule does not change those judgments.

```java
package com.example.order;

// ❌ primitives + Map as the only input
public interface OrderService {
    Order createOrder(long customerId, Map<String, Object> orderInfo);
}

// ✅ DTO, business field names; collection is a DTO field
public interface OrderService {
    OrderCreateResult createOrder(OrderCreateRequest request);
}

public class OrderCreateRequest {
    private Long customerId;
    private List<OrderItem> items;
}
```

---

## 24. Do not delete published methods and fields

§10 already forbids changing published method signatures and casually changing `serialVersionUID`. This rule only adds: do not **delete** published methods or fields. Express incompatible changes as **new** methods/fields; keep the old ones, mark `@Deprecated`, and point to the replacement (same approach as §10). Do not change a published field’s type in place (`String` → `Long` breaks deserialization for old callers).

Keeping old versions for a few iterations is a release process, not a code P0. If this diff still has in-repo callers, do not delete (P2); when to retire follows the project’s release convention; this rule sets no iteration-cycle threshold.

```java
package com.example.order;

// ❌ deleted a published method
public interface OrderService {
    // deleted getOrder(String orderId)
    OrderDTO getOrderByCustomer(Long customerId);
}

// ✅ keep the old method and deprecate; new method in parallel
public interface OrderService {
    /** @deprecated use {@link #getOrderByCustomer(Long)} */
    @Deprecated
    OrderDTO getOrder(String orderId);

    OrderDTO getOrderByCustomer(Long customerId);
}
```

---

## 25. Collection elements, request attributes, and concurrent gets must null-check

External returns and chained calls still go through §14; wrapper unboxing still goes through §7; constant-side `equals` still goes through §1 / B1. This rule only adds three NPEs that are still often missed:

1. A non-null collection does not mean its elements are non-null. Null-check elements from `get` / foreach before use.
2. Attributes taken from request, session, or thread context may never have been set (`getAttribute` and similar); null-check before use.
3. Do not `containsKey` then `get` on a concurrent Map: the entry may be removed in between; `get` returns null and unpacking is an NPE. `get` first, then null-check.

```java
package com.example.order;

// ❌ element / attribute not null-checked; check-then-act
for (Order order : orders) {
    process(order.getCustomerId());
}
UserSession session = (UserSession) request.getAttribute("orderSession");
String customerId = session.getCustomerId();
if (cache.containsKey(customerId)) {
    return cache.get(customerId).getStatus();
}

// ✅
for (Order order : orders) {
    if (order == null) {
        continue;
    }
    process(order.getCustomerId());
}
UserSession session = (UserSession) request.getAttribute("orderSession");
if (session == null) {
    return Result.unauthorized();
}
Order cached = cache.get(customerId);
if (cached == null) {
    return Result.notFound();
}
return cached.getStatus();
```

---

## 26. Split try-catch by operation

Do not wrap parse, DB write, notify, and remote calls in one large `try` then `catch (Exception)`. Keep stable local steps (parameter checks, pure computation, already-null-checked in-memory work) outside try; those failures should propagate. Wrap only unstable steps (IO, RPC, third parties), each on its own, and handle by failure type: recoverable → log and degrade; unrecoverable → throw or return a clear error.

One large catch folds “order written but notify failed” and “request never parsed” into the same result; compensation and retry will both be wrong. Whether an error code is retryable still goes through `backend-service-rules.md` §13 / §24.

```java
package com.example.order;

// ❌ parse + write DB + notify in one catch
try {
    Order order = parse(body);
    repo.save(order);
    notifier.send(order);
} catch (Exception e) {
    return Result.fail("submit failed");
}

// ✅ stable steps outside try; unstable steps separate
Order order = parse(body);
repo.save(order);
try {
    notifier.send(order);
} catch (IOException e) {
    log.warn("notify failed, customerId={}", order.getCustomerId(), e);
    return Result.acceptedWithNotifyPending();
}
```

---

## 27. Prefer pre-checks over catching NPE / bounds

If index, empty collection, or null reference can be checked with `if` before the call, do not use `catch (NullPointerException)` / `catch (IndexOutOfBoundsException)` as a normal branch. Loop bounds still go through §16. Exceptions as normal control flow still go through §8.

```java
package com.example.order;

// ❌
try {
    return orders.get(index).getCustomerId();
} catch (IndexOutOfBoundsException | NullPointerException e) {
    return null;
}

// ✅
if (orders == null || index < 0 || index >= orders.size()) {
    return null;
}
Order order = orders.get(index);
if (order == null) {
    return null;
}
return order.getCustomerId();
```

---

## 28. Published code must not throw bare RuntimeException / Exception / Throwable

Implementations of published methods must not `throw new RuntimeException(...)` / `new Exception(...)` / `new Throwable(...)`. Throw the project’s existing business or system exception types (names follow the repo; do not invent a new set for this rule, and do not require a specific class name). Entry points must not declare `throws Exception` — that still goes through `backend-service-rules.md` §32. Wrapping and dropping the cause still goes through that file’s §28. Validation failures may go through entry validation (`backend-service-rules.md` §27), including the project’s existing `IllegalArgumentException`.

```java
package com.example.order;

// ❌
throw new RuntimeException("stock insufficient");

// ✅ the project's existing business exception type
throw new OrderRejectedException("stock insufficient");
```

---

## 29. Business code must not catch Error / Throwable

Business code must not `catch (Error)`, `catch (VirtualMachineError)`, or `catch (Throwable)`: that swallows `OutOfMemoryError` / `StackOverflowError` and keeps running after the process is already unhealthy.

When integrating an unstable third party or dynamically loaded classes, `catch (Throwable)` is allowed, but you must log and decide recoverability; `VirtualMachineError` must be rethrown, not treated as a business failure to degrade. Do not treat “every RPC must catch Throwable” as a rule. Empty catch still goes through G3.

```java
package com.example.order;

// ❌ business path swallows Error
try {
    process(order);
} catch (Throwable t) {
    return Result.fail("busy");
}

// ✅ business handles only recoverable exceptions
try {
    process(order);
} catch (RuntimeException e) {
    log.error("process failed, customerId={}", order.getCustomerId(), e);
    throw e;
}

// ✅ unstable plugin / dynamic class: log and separate unrecoverable
try {
    plugin.invoke(order);
} catch (Throwable t) {
    log.error("plugin failed, customerId={}", order.getCustomerId(), t);
    if (t instanceof VirtualMachineError) {
        throw (VirtualMachineError) t;
    }
    return Result.unavailable();
}
```

---

## 30. catch type must match the failure you intend to handle

Checked-exception catch types are constrained by the compiler; this rule does not repeat that. Runtime exceptions: `catch (Exception)` **can** catch `RuntimeException`; do not write “catch Exception cannot catch RuntimeException”.

This rule only reports overly broad catches that mix handling: the method intends to handle one checked failure (e.g. `IOException`) but is written `catch (Exception)`, folding business rejection and system failure into the same branch (classification still goes through `backend-service-rules.md` §28). Overly broad but immediately rethrown and logged is not this rule alone. P2.

```java
package com.example.order;

// ❌ only meant to handle read failure, but catch Exception also eats validation failures
try {
    return Files.readString(path);
} catch (Exception e) {
    return "";
}

// ✅
try {
    return Files.readString(path);
} catch (IOException e) {
    log.warn("read failed, customerId={}", customerId, e);
    return "";
}
```

---

## 31. Prefer not returning null from published non-collection methods

Returning an empty collection instead of `null` for lists / collections still goes through `backend-service-rules.md` §14. When the repo already has a unified result wrapper, do not use bare `null` for not-found; follow that file’s §32.

This rule only adds: without a unified wrapper, published non-collection methods prefer an empty object or `Optional`. If `null` must be returned, the method contract says so, and callers null-check per §14. P2.

```java
package com.example.order;

// ❌ published query returns null and the contract does not say so
public OrderDTO findOrder(String orderId) {
    return repo.find(orderId);
}

// ✅
public Optional<OrderDTO> findOrder(String orderId) {
    return Optional.ofNullable(repo.find(orderId));
}
```

---

## 32. Singleton publish: DCL needs volatile

Singleton and method thread-safety still go through §6. This rule only adds the **publish style**: the static reference in double-checked locking (DCL) must be `volatile`, or other threads may see a half-initialized object. Prefer a static inner-class holder or an enum; hand-write DCL less often.

```java
package com.example.order;

// ❌ DCL but the reference is not volatile
public final class OrderCache {
    private static OrderCache instance;

    public static OrderCache getInstance() {
        if (instance == null) {
            synchronized (OrderCache.class) {
                if (instance == null) {
                    instance = new OrderCache();
                }
            }
        }
        return instance;
    }
}

// ✅ prefer holder
public final class OrderCache {
    private OrderCache() {}

    private static class Holder {
        static final OrderCache INSTANCE = new OrderCache();
    }

    public static OrderCache getInstance() {
        return Holder.INSTANCE;
    }
}

// ✅ if DCL is required: the reference must be volatile
private static volatile OrderCache instance;
```

---

## 33. Shrink synchronized critical sections

Do not `synchronized` the entire method and pull validation, remote calls, and pure computation into the critical section. Lock only shared mutable state; if `ConcurrentHashMap` / a concurrent queue works, do not lock the whole business block. P2. try/finally shape for blocking locks still goes through §6.

```java
package com.example.order;

// ❌ lock the whole method
public synchronized void submit(Order order) {
    validate(order);
    catalogClient.check(order);
    orders.put(order.getId(), order);
}

// ✅ protect only shared mutable state; or switch to a concurrent collection
public void submit(Order order) {
    validate(order);
    catalogClient.check(order);
    orders.put(order.getId(), order); // ConcurrentHashMap
}
```

---

## 34. tryLock must confirm the lock is held

`tryLock` / `tryLock(time, unit)` must check the return value. Enter the critical section only if the lock was acquired; `unlock` only if the lock was acquired. `unlock` without holding throws `IllegalMonitorStateException`. Blocking `lock()` still goes through §6: acquire outside try, release in finally.

```java
package com.example.order;

// ❌ did not check whether the lock was acquired; unlock even if not held
lock.tryLock();
try {
    updateOrder(order);
} finally {
    lock.unlock();
}

// ✅
boolean held = lock.tryLock();
if (!held) {
    return Result.conflict();
}
try {
    updateOrder(order);
} finally {
    lock.unlock();
}
```

---

## 35. Do not schedule with Timer

Do not use `java.util.Timer` / `TimerTask` for periodic or delayed work: all tasks share one thread; an uncaught exception from a task kills that thread and all later scheduling stops. Use `ScheduledThreadPoolExecutor` (or the project’s existing scheduler). Construction still needs explicit core size, rejection policy, and thread names; see §6. Do not use `Executors.new*Scheduled*` factories. This rule does not forbid `ScheduledThreadPoolExecutor`.

```java
package com.example.order;

// ❌ single thread; a task exception stops all later scheduling
new Timer("order-scan").scheduleAtFixedRate(new TimerTask() {
    @Override
    public void run() {
        scanExpired(orders);
    }
}, 0, 1000);

// ✅ explicit ScheduledThreadPoolExecutor; constraints same as §6
ScheduledExecutorService scheduler = new ScheduledThreadPoolExecutor(
    1,
    namedThreadFactory("order-scan"),
    new ThreadPoolExecutor.AbortPolicy());
scheduler.scheduleAtFixedRate(() -> scanExpired(orders), 0, 1, TimeUnit.SECONDS);
```

---

## 36. CountDownLatch must complete and be time-bounded

`CountDownLatch.countDown()` must be called in `finally`; skipping it on the failure path leaves waiters stuck forever. `await()` must have a timeout; on timeout fail, degrade, or interrupt — do not wait forever. Timeout length follows the call-chain SLA; this rule sets no fixed seconds.

```java
package com.example.order;

// ❌ failure path skips countDown; await waits forever
workers.submit(() -> {
    process(order);
    latch.countDown();
});
latch.await();

// ✅
workers.submit(() -> {
    try {
        process(order);
    } finally {
        latch.countDown();
    }
});
if (!latch.await(5, TimeUnit.SECONDS)) {
    throw new TimeoutException("order fan-out timed out");
}
```

---

## 37. Do not share Random across threads

Do not make one `java.util.Random` instance a static or singleton field shared by multiple threads: it contends, and `next*` may spin under high concurrency. Ordinary sharding, jitter, and sampling use `ThreadLocalRandom.current()`. Security tokens, signatures, and lottery seeds still use the project’s agreed secure random source; this rule does not cover those.

```java
package com.example.order;

// ❌ one Random shared by multiple threads
private static final Random RANDOM = new Random();
int shard = RANDOM.nextInt(16);

// ✅
int shard = ThreadLocalRandom.current().nextInt(16);
```

---

## 38. Do not rely on volatile alone with multiple writers

One writer, many readers (config callback writes, request thread reads) still goes through §21. This rule only adds: when multiple threads mutate the same field, `volatile` guarantees visibility only, not atomicity of `++` / read-modify-write. Use a lock, `AtomicInteger` / `AtomicReference`, `ConcurrentHashMap`, or `LongAdder`. Hot-path counters prefer `LongAdder` (P2: do not box a counter into `Long` for no reason in a hot loop).

```java
package com.example.order;

// ❌ multiple writers on the same volatile counter; ++ loses updates
private volatile int submitted;

void onSubmit() {
    submitted++;
}

// ✅
private final LongAdder submitted = new LongAdder();

void onSubmit() {
    submitted.increment();
}
```

---

## 39. Do not share a plain HashMap across threads

Do not give a plain `HashMap` / `HashSet` to multiple threads for read/write (resize can lose data or livelock). Cross-thread sharing uses `ConcurrentHashMap` (or a concurrent collection). Do not “`containsKey` then `put`”: another thread may have inserted in between, causing overwrite or double load. Initialize with `computeIfAbsent`. `containsKey` then `get` unpack NPE still goes through §25; this rule does not change that.

Do not operate on the same map again inside a `computeIfAbsent` mapping, and do not do slow I/O there (it stalls other keys).

```java
package com.example.order;

// ❌ HashMap shared across threads; check-then-put
private final Map<String, Order> orders = new HashMap<>();

Order cached = orders.get(customerId);
if (cached == null) {
    cached = load(customerId);
    orders.put(customerId, cached);
}

// ✅
private final ConcurrentHashMap<String, Order> orders = new ConcurrentHashMap<>();
Order cached = orders.computeIfAbsent(customerId, this::load);
```

---

## 40. Prefer strong consistency for funds and inventory concurrency

Concurrent deductions that can cause direct financial loss (funds, inventory, quotas) prefer a database row lock / `SELECT FOR UPDATE` or the project’s existing mutex; do not rely on versionless read-modify-write alone. Optimistic locking and `version` for ordinary aggregates still go through §6 and `backend-service-rules.md` §6. Money types and precision still go through G6 / `monetary-precision-rules.md`; this rule does not change those judgments. When the repo has no convention, optimistic retry paths also need a retry cap; do not spin. P2.

```java
package com.example.order;

// ❌ balance read-modify-write with no mutex
Balance balance = repo.find(customerId);
balance.setAmount(balance.getAmount().subtract(order.getPayAmount()));
repo.save(balance);

// ✅ conditional update or row lock (API follows the repo)
int n = repo.deductIfEnough(customerId, order.getPayAmount());
if (n != 1) {
    throw new OrderRejectedException("insufficient balance");
}
```

---

## 41. Future.get must have a timeout

`future.get()` / `Future.get()` without a timeout can hang the request thread forever. Use `get(timeout, unit)` and handle `TimeoutException`. Latch waits still go through §36; this rule does not replace that. Timeout length follows the call-chain SLA; this rule sets no fixed seconds.

```java
package com.example.order;

// ❌ request thread can block forever
Order order = future.get();

// ✅
try {
    Order order = future.get(5, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    throw new OrderUnavailableException("order load timed out", e);
}
```

---

## 42. CompletableFuture / supplyAsync must use an explicit pool

Do not run request-path `CompletableFuture.supplyAsync(fn)` / `runAsync(fn)` on `ForkJoinPool.commonPool()`. Pass an explicit executor (a `ThreadPoolExecutor` that still satisfies §6; this rule does not ban `ThreadPoolExecutor` and does not change §6). Nested `join()` / `get()` on the request path that can deadlock the same pool is P1; parent/child sharing still goes through §44.

```java
package com.example.order;

// ❌ commonPool on a request path; nested join can stall the same pool
CompletableFuture.supplyAsync(() -> repo.find(customerId));
CompletableFuture.allOf(loads).join();

// ✅ explicit pool; timed get
CompletableFuture.supplyAsync(() -> repo.find(customerId), orderPool);
CompletableFuture.allOf(loads).get(5, TimeUnit.SECONDS);
```

---

## 43. Local / new ThreadPoolExecutor must shutdown

A method-scoped `new ThreadPoolExecutor` / `Executors.new*` must `shutdown` or `shutdownNow` in `finally`. Otherwise threads leak after the method returns. Factory vs explicit `ThreadPoolExecutor` still goes through §6; this rule does not rewrite that. Prefer a shared, bounded pool over creating one per request.

```java
package com.example.order;

// ❌ method-scoped pool never shut down
ExecutorService pool = new ThreadPoolExecutor(
    2, 4, 60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(32),
    namedThreadFactory("order-local"),
    new ThreadPoolExecutor.AbortPolicy());
pool.submit(() -> load(customerId));

// ✅
ExecutorService pool = new ThreadPoolExecutor(
    2, 4, 60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(32),
    namedThreadFactory("order-local"),
    new ThreadPoolExecutor.AbortPolicy());
try {
    pool.submit(() -> load(customerId));
} finally {
    pool.shutdown();
}
```

---

## 44. Do not share one pool between parent and child blocking tasks

If a parent task submits child work to the **same** pool and then blocks (`get` / `join`), the pool can deadlock: parent threads wait while child tasks sit in the queue. Use a separate child pool, or do not block the parent on the same pool. Recursion that spawns tasks still goes through §47.

```java
package com.example.order;

// ❌ parent blocks on a child queued on the same pool
orderPool.submit(() -> {
    Future<Order> child = orderPool.submit(() -> repo.find(customerId));
    child.get();
});

// ✅ different pools, or do not block the parent on the same pool
orderPool.submit(() -> {
    Future<Order> child = childPool.submit(() -> repo.find(customerId));
    child.get(5, TimeUnit.SECONDS);
});
```

---

## 45. Collectors.toMap must handle key clash and null values

`Collectors.toMap(keyMapper, valueMapper)` throws `IllegalStateException` on duplicate keys and NPE on a null value. Provide a merge function. Filter or map nulls before collect.

```java
package com.example.order;

// ❌ duplicate customerId or null status throws
Map<Long, String> statuses = orders.stream()
    .collect(Collectors.toMap(Order::getCustomerId, Order::getStatus));

// ✅ merge on clash; nulls mapped
Map<Long, String> statuses = orders.stream()
    .collect(Collectors.toMap(
        Order::getCustomerId,
        order -> order.getStatus() != null ? order.getStatus() : "UNKNOWN",
        (first, second) -> first));
```

---

## 46. ConcurrentHashMap must not use null key/value

`ConcurrentHashMap` rejects a null key or null value (`NullPointerException`). Null-check before `put` / `putIfAbsent` / `compute*`. Sharing a plain `HashMap` across threads still goes through §39; this rule does not replace that.

```java
package com.example.order;

// ❌ CHM rejects nulls
ConcurrentHashMap<Long, Order> orders = new ConcurrentHashMap<>();
orders.put(customerId, order); // order or customerId may be null

// ✅
if (customerId != null && order != null) {
    orders.put(customerId, order);
}
```

---

## 47. Recursion must not spawn unbounded threads/tasks

Do not `submit` / `new Thread` / `supplyAsync` inside recursion on a request path: depth is data-dependent and thread count can explode. Walk the tree iteratively (queue / stack) and bound the work. Same-pool parent/child blocking still goes through §44; this rule does not replace that.

```java
package com.example.order;

// ❌ recursive submit; fan-out is unbounded
void loadTree(OrderNode node) {
    orderPool.submit(() -> {
        persist(node);
        for (OrderNode child : node.getChildren()) {
            loadTree(child);
        }
    });
}

// ✅ iterate, then submit bounded work
Queue<OrderNode> queue = new ArrayDeque<>();
queue.add(root);
while (!queue.isEmpty()) {
    OrderNode node = queue.poll();
    persist(node);
    queue.addAll(node.getChildren());
}
```
