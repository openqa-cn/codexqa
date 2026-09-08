# Go Review Rules

> Load on demand when the diff includes `.go`. Language tag on every row is `Go` so a Go-only repo can be reviewed without loading Java, TypeScript, Python, or C/C++ handbooks.
> SQL injection, command injection, SSRF, path traversal, hardcoded secrets, and weak hashes still start from `backend-security-rules.md` / `backend-data-access-rules.md` and pocket cards G4 / G5 / B2 / B9. This file adds only Go APIs and concurrency atoms those cards do not name.
> `gofmt` / `go vet` / `golangci-lint` formatting, unused identifiers, and typecheck belong to the toolchain — do not repeat them as CR gates. Do not cite vendor linter IDs in findings.
> Examples use `orders`, `customerID`, and `example.com`.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Lang | Quick recognition signals |
|------|------|------|------|------------|
| §1 | Must check errors | P1 | Go | `_ = err`; `foo()` when `foo` returns `error` |
| §2 | Close HTTP bodies; do not ignore `Close` errors on deferred resources | P1 | Go | `http.Get` with no `Body.Close`; `defer f.Close()` discarding `error` |
| §3 | Do not interpolate SQL with `fmt.Sprintf` or `+` | P0 | Go | `fmt.Sprintf("… WHERE id = %s", id)` into `Query` |
| §4 | `exec.Command` must not take untrusted shell text | P0 | Go | `exec.Command("sh", "-c", user)`; `exec.Command(user)` |
| §5 | File path and archive extract must stay under a fixed root | P0 | Go | `os.Open(req.Path)`; zip/tar extract without `..` check |
| §6 | Restrictive file mode; no predictable temp path | P1 | Go | `os.MkdirAll(..., 0777)`; `os.Create("/tmp/orders")` |
| §7 | TLS and SSH must verify peers | P0 | Go | `InsecureSkipVerify: true`; `ssh.InsecureIgnoreHostKey()` |
| §8 | `math/rand` and weak crypto are not for security | P1 | Go | `rand.Intn` for a token; `crypto/md5` / `des` / `rc4` / `sha1` |
| §9 | HTTP client and server must set timeouts | P1 | Go | `http.ListenAndServe` / `http.Get` with default `Client` |
| §10 | Do not expose pprof or bind all interfaces by accident | P1 / P2 | Go | `_ "net/http/pprof"`; `Listen(":0")` / `0.0.0.0` in production |
| §11 | Escape untrusted data in HTML templates | P0 | Go | `template.HTML(user)`; `template.JS(user)` |
| §12 | User URL must not go straight to `http.Get` | P0 | Go | `http.Get(r.URL.Query().Get("url"))` |
| §13 | Do not copy a mutex; do not close over a loop variable | P1 | Go | `func (Mutex)`; `go func() { use(v) }` inside `for` |
| §14 | `context` cancel must run; signal channels must be buffered | P1 | Go | `context.WithCancel` with no `defer cancel()`; `signal.Notify` on unbuffered chan |
| §15 | `unsafe`, Atoi overflow, and unbounded decompress | P1 | Go | `unsafe.Pointer`; `strconv.Atoi` into a size; `zip.NewReader` with no cap |
| §16 | Dead / identical / self-assigned control flow | P1 / P2 | Go | `= +`; `if true`; `a == a`; both `if`/`else` bodies the same |

---

## 1. Must check errors

Every `error` return on a request, I/O, or parse path must be checked. `_ = err`, unused `(T, error)`, and continuing after a failed call hide outages. This is the CR form of errcheck; do not require a specific linter. `fmt.Printf` / `fmt.Errorf` verbs must match arguments.

```go
// ❌
rows, _ := db.QueryContext(ctx, q, customerID)
data, err := os.ReadFile(path)

// ✅
rows, err := db.QueryContext(ctx, q, customerID)
if err != nil {
    return err
}
data, err := os.ReadFile(path)
if err != nil {
    return err
}
```

---

## 2. Close HTTP bodies; do not ignore `Close` errors on deferred resources

`http.Response.Body` must be closed. `defer f.Close()` on a write path should still observe the error (named return or a wrap). This rule does **not** replace `backend-service-rules.md` §15 (resources).

```go
// ❌
resp, err := http.Get(url)
if err != nil {
    return err
}
_, _ = io.ReadAll(resp.Body)

// ✅
resp, err := client.Get(url)
if err != nil {
    return err
}
defer resp.Body.Close()
```

---

## 3. Do not interpolate SQL with `fmt.Sprintf` or `+`

Use bound placeholders (`$1` / `?`) on `Query` / `Exec`. Do not `fmt.Sprintf` or concatenate user text into the statement. This rule does **not** replace `backend-data-access-rules.md` §1.

```go
// ❌
q := fmt.Sprintf("SELECT id FROM orders WHERE customer_id = '%s'", customerID)
db.Query(q)

// ✅
db.QueryContext(ctx, "SELECT id FROM orders WHERE customer_id = $1", customerID)
```

---

## 4. `exec.Command` must not take untrusted shell text

Do not pass user text to `exec.Command` / `CommandContext` as the executable or as `sh -c`. Prefer a library/API; if a process is required, allowlist the binary and each argument. This rule does **not** replace B9 / `backend-security-rules.md` §2.

```go
// ❌
exec.Command("sh", "-c", userInput).Run()
exec.Command(userInput).Run()

// ✅
if userInput != "ls" {
    return errCommand
}
exec.CommandContext(ctx, "/bin/ls", allowlistedArg).Run()
```

---

## 5. File path and archive extract must stay under a fixed root

User paths into `os.Open` / `os.Create` / `http.Dir` must be cleaned and stay under a server-fixed directory. Zip/tar extract must reject `..` entries (zip slip). This rule does **not** replace `backend-security-rules.md` §7.

```go
// ❌
f, err := os.Open(filepath.Join(root, req.Name))

// ✅
path := filepath.Clean(filepath.Join(root, req.Name))
if !strings.HasPrefix(path, root+string(os.PathSeparator)) {
    return errPath
}
f, err := os.Open(path)
```

---

## 6. Restrictive file mode; no predictable temp path

Do not create secret or customer files/dirs as `0777` / `0666`. Use `os.CreateTemp` (or the project helper), not a fixed `/tmp/orders.dat` name. Complements `cpp-review-rules.md` §10 and does **not** retune it.

```go
// ❌
os.WriteFile("/tmp/orders.dat", data, 0777)

// ✅
f, err := os.CreateTemp("", "orders-*.dat")
if err != nil {
    return err
}
```

---

## 7. TLS and SSH must verify peers

`tls.Config{InsecureSkipVerify: true}` and `ssh.InsecureIgnoreHostKey()` are P0 on any non-test path. New TLS clients/servers must not enable TLS 1.0 / 1.1. Complements `backend-security-rules.md` §14 and `cpp-review-rules.md` §20; do not retune those cards.

```go
// ❌
tls.Config{InsecureSkipVerify: true}
ssh.InsecureIgnoreHostKey()

// ✅
tls.Config{MinVersion: tls.VersionTLS12}
```

---

## 8. `math/rand` and weak crypto are not for security

Tokens, session IDs, and keys use `crypto/rand`, not `math/rand`. Do not use `crypto/md5`, `crypto/des`, `crypto/rc4`, or `crypto/sha1` for **security** (password, HMAC, TLS cert). RSA keys used for security should be at least 2048 bits. This rule does **not** replace `backend-security-rules.md` §14 or G5 (hardcoded secrets).

```go
// ❌
token := strconv.Itoa(rand.Intn(1_000_000))
h := md5.Sum([]byte(password))

// ✅
var b [16]byte
if _, err := cryptorand.Read(b[:]); err != nil {
    return err
}
```

---

## 9. HTTP client and server must set timeouts

Default `http.Client` / `http.Get` / `http.ListenAndServe` / `http.Serve` have no deadline (Slowloris / hung sockets). Set `Timeout` or `ReadHeaderTimeout` / `WriteTimeout`. This rule does **not** replace `backend-service-rules.md` §39.

```go
// ❌
http.Get(url)
http.ListenAndServe(":8080", mux)

// ✅
client := &http.Client{Timeout: 5 * time.Second}
srv := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
```

---

## 10. Do not expose pprof or bind all interfaces by accident

Importing `net/http/pprof` on a public listener leaks profiles. Binding `0.0.0.0` / `[::]` in production needs an explicit product reason. P1 for pprof; P2 for an unexplained all-interfaces bind.

```go
// ❌
import _ "net/http/pprof"
http.ListenAndServe("0.0.0.0:6060", nil)

// ✅
// pprof only on an internal admin mux / localhost, behind auth
```

---

## 11. Escape untrusted data in HTML templates

Do not cast user text to `template.HTML`, `template.JS`, or `template.URL`. `html/template` auto-escapes; `text/template` does not. Complements G4 and does **not** retune it.

```go
// ❌
tmpl.Execute(w, template.HTML(req.Comment))

// ✅
tmpl.Execute(w, req.Comment)
```

---

## 12. User URL must not go straight to `http.Get`

A query/body URL passed to `http.Get` / `http.NewRequest` is SSRF. Allowlist scheme and host (or block private hops after DNS) as in `python-review-rules.md` §2. This rule does **not** replace `backend-security-rules.md` §5.

```go
// ❌
http.Get(r.URL.Query().Get("url"))

// ✅
if !allowedFetchURL(raw) {
    return errURL
}
req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
```

---

## 13. Do not copy a mutex; do not close over a loop variable

Passing `sync.Mutex` / `sync.WaitGroup` by value (including in a struct copy) silently drops exclusion. A goroutine started in a `for` must not close over the loop variable in a way that races (Go version < 1.22, or taking `&item` from `range`). Complements Java concurrency cards and does **not** replace them.

```go
// ❌
func (m sync.Mutex) LockOrder() { m.Lock(); defer m.Unlock() }
for _, order := range orders {
    go func() { handle(order) }()
}

// ✅
func (m *sync.Mutex) LockOrder() { m.Lock(); defer m.Unlock() }
for _, order := range orders {
    order := order
    go func() { handle(order) }()
}
```

---

## 14. `context` cancel must run; signal channels must be buffered

`context.WithCancel` / `WithTimeout` / `WithDeadline` must `defer cancel()`. `signal.Notify` needs a **buffered** channel so the runtime does not drop signals.

```go
// ❌
ctx, cancel := context.WithTimeout(parent, 3*time.Second)
ch := make(chan os.Signal)
signal.Notify(ch, os.Interrupt)

// ✅
ctx, cancel := context.WithTimeout(parent, 3*time.Second)
defer cancel()
ch := make(chan os.Signal, 1)
signal.Notify(ch, os.Interrupt)
```

---

## 15. `unsafe`, Atoi overflow, and unbounded decompress

`unsafe.Pointer` casts need a documented invariant. `strconv.Atoi` / integer convert into a size or slice cap must be range-checked. Zip/gzip readers on untrusted blobs need a byte cap (decompression bomb).

```go
// ❌
n, _ := strconv.Atoi(req.Count)
buf := make([]byte, n)

// ✅
n, err := strconv.Atoi(req.Count)
if err != nil || n < 0 || n > maxOrders {
    return errRange
}
```

---

## 16. Dead / identical / self-assigned control flow

Reject `x =+ 1` (that is `x = (+1)`, not `+=`). Do not write `if true` / `if false`, `a == a`, `x = x`, two `if` / `else if` with the same condition, or `if`/`else` branches with the same body. Unreachable code after `return` / `panic` is a smell (the compiler already flags much of this — only report when the diff introduces it). Complements `javascript-review-rules.md` §14 and does **not** retune it.

```go
// ❌
count =+ 1
if true { ship(order) }
if customerID == customerID { /* … */ }
if ready { do() } else { do() }

// ✅
count += 1
if ready {
    ship(order)
}
```
