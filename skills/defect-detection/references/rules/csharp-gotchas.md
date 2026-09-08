# C# detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `csharp` (aliases `cs`, `c#`).
> Strategy stays 11. Call-chain format is still `A#name(L12)→B#name(L45)`; A is the extension-less file path (`src/Orders/OrderService`).

---

## className / filePath

- **className**: extension-less repo path as produced by `get-changed-methods` (`src/Orders/OrderService`); the namespace is visible in the file, not in the id
- **methodName**: method / constructor / property-accessor name; expression-bodied members (`=>`) are extracted with `bodyLineCount` 1
- **filePath**: the changed `.cs` path from `diff.files`
- Do **not** rewrite to `src/main/java/...*.java`

## GitNexus

Try GitNexus after clone. Grep-fallback if `ready=false` (`rg "\bRefund\("`).

## High-signal defects

- SQL concatenated into `CommandText` / `SqlCommand(...)` / `ExecuteSqlRaw` (AST-CS-001 taint)
- Empty `catch` that swallows a failure (AST-CS-002)
- `Process.Start` with unsanitised input (AST-CS-003)
- `BinaryFormatter` / untrusted `Deserialize` (AST-CS-004)
- `Path.Combine` / `File.Open` with a request segment and no root check (AST-CS-005)
- `FileStream` / `StreamReader` / `File.Open` created outside `using` (AST-CS-006)
- `new HttpClient()` per request / `WebRequest.Create` with no `Timeout` (AST-CS-007)
- `ServerCertificateValidationCallback` or custom callback that always returns `true` (AST-CS-008)
- Hardcoded `password` / `apiKey` / `secret` / `token` assignment (AST-CS-009)
- `Html.Raw` / `new HtmlString` of unsanitised input — XSS (AST-CS-010)
- `Request.Query` / `Request.Form` → `GetAsync` / `DownloadString` / `WebRequest.Create` (SSRF, AST-CS-011 taint; intra-function only)
- Agent-only (no seed): `async void` methods; `.Result` / `.Wait()` on a task in ASP.NET (deadlock); missing `ConfigureAwait` in libraries; `IDisposable` field never disposed; `DateTime.Now` where `UtcNow` is persisted; LINQ deferred query enumerated after the `DbContext` is disposed; `lock (this)` / `lock` on a string; `catch (Exception) { throw ex; }` losing the stack; nullable reference read without a check when `<Nullable>enable</Nullable>` is off

## Facade / proxy false-positive traps

A controller that only forwards to another service is not missing local auth when the spec names the callee as the enforcer. Compare same-kind siblings only. Full rule: `analysis-framework.md` → Facade / proxy vs first-party handler.

## Trivial filter

Auto-properties, `get` / `set` one-liners and tiny expression-bodied members (`bodyLineCount` 1) can be T0. Do not mark business methods trivial.

## Write-back fence

Use ` ```csharp `. Contract strings stay English.
