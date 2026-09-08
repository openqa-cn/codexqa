# Groovy Review Rules

> Load on demand when the diff includes `.groovy` that is **not** a low-code page package (`struct.groovy` / `dataSourceMap.groovy` / `*.groovy` next to `componentsMap.json`). Those files still go through `low-code-page-rules.md` only.
> Language tag on every row is `Groovy`. Money still goes through G6 and `java-review-rules.md` §3 (`new BigDecimal(double)`). Logging / `printStackTrace` still start from Java §9. `serialVersionUID` still starts from Java §10. This file does **not** replace those cards.
> Naming, Javadoc, braces, unused imports, and complexity metrics belong to the formatter / linter — do not repeat them here.
> Examples use `orders`, `customerId`, and `example.com`.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Lang | Quick recognition signals |
|------|------|------|------|------------|
| §1 | `Boolean.getBoolean` / `Integer.getInteger` read system properties | P1 | Groovy | `Boolean.getBoolean(flag)` meaning “parse this string” |
| §2 | Oddness is `n % 2 != 0`, not `== 1` | P1 | Groovy | `if (n % 2 == 1)` |
| §3 | No assignment / bitwise / broken null check as a condition | P1 | Groovy | `if (x = 1)`; `if (a \| b)`; `if (s != null \|\| s.isEmpty())` |
| §4 | No self-compare, constant `if`, duplicate `case` / map key | P1 | Groovy | `if (x == x)`; `[id: 1, id: 2]`; two `case 1:` |
| §5 | JDBC Connection / Statement / ResultSet must close | P1 | Groovy | `DriverManager.getConnection` with no `close` / `withCloseable` |
| §6 | `Random` / `Math.random` are not for tokens; `nextDouble()` as `int` is 0 | P1 | Groovy | `new Random().nextInt()` for a session; `(int) rnd.nextDouble()` |
| §7 | Temp files need a restrictive directory | P1 | Groovy | `File.createTempFile("orders", ".dat")` in shared `/tmp` |
| §8 | Do not `System.exit` on a request path; prefer the project logger | P2 | Groovy | `System.exit(1)`; `println` / `e.printStackTrace()` |
| §9 | Do not implement `finalize`; do not `removeAll` on self | P1 | Groovy | `void finalize()`; `orders.removeAll(orders)` |
| §10 | Do not reassign parameters; implicit `it` only in a one-line closure | P2 | Groovy | `customerId = x` at the start of a method; multi-line `{ it.foo }` |

---

## 1. `Boolean.getBoolean` / `Integer.getInteger` read system properties

These JDK helpers look up a **system property** by name. They do not parse the string/boolean you already have. Use `Boolean.parseBoolean` / `Integer.parseInt` (or Groovy truth) on the value.

```groovy
// ❌
if (Boolean.getBoolean(enabledFlag)) { ship(order) }

// ✅
if (Boolean.parseBoolean(enabledFlag)) { ship(order) }
```

---

## 2. Oddness is `n % 2 != 0`, not `== 1`

In Java/Groovy, `(-1) % 2 == -1`, so `n % 2 == 1` misses negative odds.

```groovy
// ❌
if (count % 2 == 1) { /* odd */ }

// ✅
if (count % 2 != 0) { /* odd */ }
```

---

## 3. No assignment / bitwise / broken null check as a condition

Do not assign inside `if`/`while`. Bitwise `&` / `|` in a boolean context is almost always `&&` / `||`. `s != null || s.isEmpty()` is a broken null check (`||` should be `&&` after a null test, or use `?.`).

```groovy
// ❌
if (ready = true) { ship(order) }
if (a | b) { ship(order) }
if (name != null || name.isEmpty()) { return }

// ✅
if (ready) { ship(order) }
if (a || b) { ship(order) }
if (name == null || name.isEmpty()) { return }
```

---

## 4. No self-compare, constant `if`, duplicate `case` / map key

`customerId == customerId`, `if (true)`, two `case` labels with the same value, or a map literal with a repeated key are dead or silently overwrite. Complements `go-review-rules.md` §16 and does **not** retune it. Switch fall-through still goes through G7.

```groovy
// ❌
if (customerId == customerId) { ship(order) }
def row = [id: 1, id: 2]

// ✅
if (customerId == otherId) { ship(order) }
def row = [id: 1, name: "x"]
```

---

## 5. JDBC Connection / Statement / ResultSet must close

`DriverManager.getConnection` / `createStatement` / `executeQuery` must close on every path (`try-with-resources` or `withCloseable`). Do not leave a connection open across a remote call. Complements `java-review-rules.md` §8 / `backend-service-rules.md` §15 and does **not** replace them.

```groovy
// ❌
def conn = DriverManager.getConnection(url)
def rs = conn.createStatement().executeQuery(q)

// ✅
DriverManager.getConnection(url).withCloseable { conn ->
    conn.prepareStatement(q).withCloseable { ps ->
        ps.setString(1, customerId)
        ps.executeQuery().withCloseable { rs ->
            /* read */
        }
    }
}
```

---

## 6. `Random` / `Math.random` are not for tokens; `nextDouble()` as `int` is 0

Tokens and session IDs need a CSPRNG (`SecureRandom` or the project helper). `(int) random.nextDouble()` is always `0`. Complements `cpp-review-rules.md` §20 / `backend-security-rules.md` §14 and does **not** retune them. Money `double` still goes through G6 / Java §3.

```groovy
// ❌
def token = new Random().nextInt()
def n = (int) new Random().nextDouble()

// ✅
def bytes = new byte[16]
new SecureRandom().nextBytes(bytes)
```

---

## 7. Temp files need a restrictive directory

`File.createTempFile` in a shared `/tmp` is predictable and world-visible. Use a process-private directory with a restrictive mode, or the project helper. Complements `go-review-rules.md` §6 / `cpp-review-rules.md` §10 and does **not** retune them.

```groovy
// ❌
def tmp = File.createTempFile("orders", ".dat")

// ✅
def dir = new File(System.getProperty("java.io.tmpdir"), "orders-work")
dir.mkdirs()
def tmp = File.createTempFile("orders", ".dat", dir)
```

---

## 8. Do not `System.exit` on a request path; prefer the project logger

`System.exit` kills the JVM. `println` / `System.out` / `e.printStackTrace()` bypass the project logger. Complements `java-review-rules.md` §9 and does **not** replace it.

```groovy
// ❌
System.exit(1)
e.printStackTrace()
println order

// ✅
log.error("list_orders failed", e)
throw new OrderException("unavailable")
```

---

## 9. Do not implement `finalize`; do not `removeAll` on self

`finalize()` is delayed and unsafe. `orders.removeAll(orders)` clears the list via a poorly specified path — use `clear()`.

```groovy
// ❌
void finalize() { conn.close() }
orders.removeAll(orders)

// ✅
void close() { conn.close() }
orders.clear()
```

---

## 10. Do not reassign parameters; implicit `it` only in a one-line closure

Reassigning a parameter hides the caller’s value. Multi-line closures should name the parameter; `{ it.foo }` is acceptable only as a one-liner.

```groovy
// ❌
void ship(String customerId) {
    customerId = lookup(customerId)
    orders.each {
        persist(it)
        notify(it)
    }
}

// ✅
void ship(String customerId) {
    def resolved = lookup(customerId)
    orders.each { order ->
        persist(order)
        notify(order)
    }
}
```
