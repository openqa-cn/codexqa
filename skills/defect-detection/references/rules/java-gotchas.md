# Java detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `java` (the historical default). Most of the skill's general rules were written against Java; this page lists what is specific and what the AST pack already covers.
> Strategy stays 11. Call-chain format is `A#name(L12)→B#name(L45)`; A is the slash FQCN (`com/acme/order/OrderService`).

---

## className / filePath

- **className**: slash FQCN relative to `src/main/java/` (the platform treats `com.acme.Foo` and `com/acme/Foo` as equal)
- **filePath**: the changed `.java` path from `diff.files`; the fallback guess is `src/main/java/<className>.java`
- Inner classes are reported under the outer file's class name

## GitNexus

Try GitNexus after clone (`ensure-gitnexus`); it is the preferred call-graph source for JVM repos. Grep-fallback if `ready=false`.

## High-signal defects

- Empty `catch` (AST-EXC-001) or `printStackTrace` instead of structured handling (AST-TH-001)
- `==` on objects / strings (AST-EQ-001)
- SQL built by concatenation into `execute` / `prepareStatement` / `createQuery` (AST-SQL-001 taint)
- `Closeable` opened without try-with-resources (AST-RES-001)
- `Optional.get()` without `isPresent` (AST-NPE-001); collection lookup returned as `null` (AST-RET-001)
- Assignment inside a boolean condition (AST-BOOL-001)
- Request data → `new URL` / `RestTemplate` / `HttpClient` (SSRF, AST-SSRF-001 taint; intra-function only — dismiss when the same method allowlists the host)
- Agent-only (no seed): `@Transactional` on private / self-invoked methods; checked exception swallowed into a generic `RuntimeException` without cause; `BigDecimal` compared with `equals`; `SimpleDateFormat` shared across threads; `HashMap` used across threads; `stream().findFirst().get()`; `Integer` cache `==` comparisons; missing `@Override`; resource leaks in `finally`; null returned from a method annotated / documented as non-null; boundary `< 0` where `<= 0` was meant

## Facade / proxy false-positive traps

A `@RequestMapping` that only forwards headers / body to another service (OpenFeign, `RestTemplate` exchange, a BFF) is not missing `@PreAuthorize` / DG checks when the spec says the callee owns them. Compare same-kind siblings only. Full rule: `analysis-framework.md` → Facade / proxy vs first-party handler.

## Trivial filter

`get*` / `set*` / `is*` / builder `with*` one-liners, `toString` / `equals` / `hashCode` are T0. A real `checkout` / `charge` method is never trivial.

## Write-back fence

Use ` ```java `. Contract strings stay English.
