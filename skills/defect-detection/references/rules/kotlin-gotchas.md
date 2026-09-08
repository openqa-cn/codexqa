# Kotlin detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `kotlin` (alias `kt`).
> Strategy stays 11. Call-chain format is still `A#name(L12)→B#name(L45)`; A is the slash FQCN (`com/acme/billing/Charge`).
> Java Semgrep seeds do **not** parse `.kt`; `run-ast-scan` loads `AST-KT-*` only.

---

## className / filePath

- **className**: slash FQCN relative to the source root (`src/main/kotlin/` or `src/main/java/` are stripped): `com/acme/billing/Charge`
- **filePath**: the changed `.kt` / `.kts` path from `diff.files`
- Do **not** rewrite to `src/main/java/...*.java`
- Top-level functions belong to the file's class name; `companion object` and `object` members are reported under the enclosing file too

## GitNexus

Try GitNexus after clone (JVM repos are supported). Grep-fallback if `ready=false`.

## High-signal defects

- SQL string template `"... $id"` or concat into `execute` / `createQuery` / `prepareStatement` (AST-KT-001 taint)
- `Runtime.exec` / `ProcessBuilder` with interpolation (AST-KT-002)
- Empty `catch (e: Exception) { }` that swallows a failure (AST-KT-003)
- Hostname / TLS verification forced to succeed (AST-KT-004, AST-KT-010)
- `File(root, userSegment)` / `Paths.get` with a user segment and no root check (AST-KT-005)
- Hardcoded `password` / `apiKey` / `secret` / `token` assignment (AST-KT-006)
- `ObjectInputStream.readObject` on untrusted data (AST-KT-007)
- Request/query → `URL` / `HttpURLConnection` / Ktor `client.get` (SSRF, AST-KT-008 taint; intra-function only)
- `!!` on request, query or nullable platform types (AST-KT-009) — Kotlin's NPE
- `openConnection()` with no connect/read timeout (AST-KT-011)
- Agent-only (no seed): `runBlocking` inside a coroutine / request thread; `GlobalScope.launch` leaking work; `lateinit` read before init; `!!` after a `?.` chain; `when` without `else` on a non-sealed type; `data class` with mutable collections in `equals`; suspend function called from a non-suspending callback; `@Transactional` on a `private`/`final` member (Spring proxies ignore it unless `allopen`)

Dismiss when the same method allowlists the host, binds parameters, or the source is not user-controlled.

## Trivial filter

Java-like `get` / `set` / `is` and one-line expression-bodied `fun` (`bodyLineCount` 1, e.g. `fun total() = items.sum()`) can be T0. Do not mark business methods trivial.

## Write-back fence

Use ` ```kotlin `. Contract strings stay English.
