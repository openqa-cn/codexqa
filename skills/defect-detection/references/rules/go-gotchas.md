# Go detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `go` (alias `golang`) or a `.go` file is in the change set.
> Strategy stays 11. Call-chain format is still `A#name(L12)→B#name(L45)`; A is the extension-less file path (`internal/pay/charge`).

---

## className / filePath

- **className**: extension-less repo path as produced by `get-changed-methods` (`internal/pay/charge`)
- **methodName**: the function name; receiver methods use the bare name (`Refund`, the receiver `(s *Service)` is in `params`/signature)
- **filePath**: the changed `.go` path from `diff.files`
- Do **not** rewrite to `src/main/java/...*.java`

## GitNexus

Try GitNexus after clone. If install/analyze fails, degrade to `rg "func (\(.*\) )?Refund\("` / `rg "\.Refund\("`. Do not block.

## High-signal defects

- SQL concatenated into `Query` / `Exec` / `QueryRow` (AST-GO-001 taint)
- `exec.Command` with unsanitised request input (AST-GO-002)
- `http.Get` / `&http.Client{}` with no `Timeout` (AST-GO-003)
- Discarded error (`_, err` ignored or `_ =`) on `Exec` / `Write` / `Open` / `Close` (AST-GO-004)
- `tls.Config{InsecureSkipVerify: true}` (AST-GO-005)
- `filepath.Join` / `os.Open` with a user segment and no `filepath.Clean` + prefix check (AST-GO-006)
- Hardcoded `password` / `apiKey` / `secret` / `token` assignment (AST-GO-007)
- `template.HTML` / `template.JS` wrapping unsanitised input — XSS (AST-GO-008)
- `r.FormValue` / `r.URL.Query().Get` → `http.Get` / `http.Post` / `http.NewRequest` (SSRF, AST-GO-009 taint). Intra-function only; dismiss when the same function allowlists the host
- Agent-only (no seed): goroutine leak (channel never closed, `ctx` not propagated), `defer` inside a loop holding files/locks, `sync.Mutex` copied by value, map written from multiple goroutines, `err` shadowing (`err :=` in an inner scope), `time.After` in a `select` loop, nil-pointer deref after a `, ok` lookup ignored, `range` variable captured by a closure (pre-1.22)

## Facade / proxy false-positive traps

Go services often grow a thin HTTP facade in front of another process (`media-gateway`, a worker, an internal ALB). That is not "missing auth" just because `ExtractCredentials` / `RequireToken` is absent.

- A handler that `proxy`s the request and copies auth headers (`Authorization`, `xc-auth`, `x-tenant-id`, …) **owns routing**, not billing. If the service doc says the callee checks balance and returns `401 missing … credentials`, write bugStatus=2 and cite that rule — do not demand a local 401 to match `/v1/audio/speech`.
- IndexTTS / batch-style routes that create a job on the callee inherit the callee's auth. Doubao / first-party TTS that calls `ExtractCredentials` is a **different kind** of handler; do not copy its gate onto the facade.
- `io.LimitReader` on a raw upload proxy is not a reason to flag `json.NewDecoder(r.Body).Decode` on a JSON API. The same-kind analog is the first-party JSON handler this facade maps onto (e.g. `HandleSpeech`).
- `http.Get` / `&http.Client{}` with no `Timeout` is still a real defect (AST-GO-003). Facades that already use `http.Client{Timeout: …}` are the analog for that finding, not for auth.

See `analysis-framework.md` → Facade / proxy vs first-party handler.

## Trivial filter

Generated `String()`, `Error()` and one-line `GetX` / `IsX` / `SetX` are T0. A real `Charge` / `Authenticate` / `Refund` function is not.

## Write-back fence

Use ` ```go `. Contract strings stay English.
