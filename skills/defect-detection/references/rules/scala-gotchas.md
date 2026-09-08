# Scala detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `scala`.
> Strategy stays 11. Call-chain format is still `A#name(L12)→B#name(L45)`; A is the slash FQCN (`com/acme/billing/Charge`).
> Java Semgrep seeds do **not** parse `.scala`; `run-ast-scan` loads `AST-SC-*` only. Community Edition taint is intra-file / intra-procedure.

---

## className / filePath

- **className**: slash FQCN relative to `src/main/scala/`: `com/acme/billing/Charge`
- **filePath**: the changed `.scala` path from `diff.files`
- Do **not** rewrite to `src/main/java/...*.java`
- `object` members and `case class` methods are reported under the enclosing file

## GitNexus

Try GitNexus after clone. Grep-fallback if `ready=false` (`rg "def refund\b"`).

## High-signal defects

- SQL concat or `s"... $id"` interpolator into JDBC `execute` / `prepareStatement` (AST-SC-001 taint)
- `Process(...)` / `!!` / `sys.process` command execution with user input (AST-SC-002)
- Empty `catch { case e: Exception => }` that swallows a failure (AST-SC-003)
- SSL / hostname verification forced off (AST-SC-004)
- Path concat with a user segment and no root check (AST-SC-005)
- Hardcoded `password` / `apiKey` / `secret` / `token` assignment (AST-SC-006)
- Java `ObjectInputStream.readObject` interop (AST-SC-007)
- HTTP client created with no timeout (AST-SC-008)
- Request parameter → `new URL` / `openConnection` (SSRF, AST-SC-009 taint; intra-function only)
- Agent-only (no seed): `Await.result` with `Duration.Inf`; `Future` without an `ExecutionContext` boundary or recovery; `Option.get` / `head` on possibly empty collections; non-exhaustive `match` on a sealed hierarchy; `var` shared across actors/futures; `Try` result discarded; implicit conversions hiding a null; recursion without `@tailrec` on unbounded input

Dismiss when the same method allowlists the host, binds parameters, or the source is not user-controlled.

## Trivial filter

Java-like `get` / `set` / `is` and one-line `def` (`bodyLineCount` 1, e.g. `def total = items.sum`) can be T0. Do not mark business methods trivial.

## Write-back fence

Use ` ```scala `. Contract strings stay English.
