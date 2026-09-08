# C / C++ Review Rules

> Load on demand when the diff includes `.c` / `.h` / `.cc` / `.cpp` / `.cxx` / `.hpp` / `.hxx`. Language tag on every row is `C/C++` so a native-only repo can be reviewed without loading Java or TypeScript handbooks.
> Command injection, SQL injection, path traversal, hardcoded secrets, and weak password hashes still start from `backend-security-rules.md` §1 / §2 / §7 / §14 and pocket cards G5 / B2 / B9. This file adds only C/C++ APIs and memory/build atoms those cards do not name.
> Formatting, include order, and brace style belong to the compiler / clang-format — do not repeat them here.
> Examples use `orders`, `customer_id`, and `example.com`.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Lang | Quick recognition signals |
|------|------|------|------|------------|
| §1 | Untrusted data must not reach process-spawn APIs | P0 | C/C++ | `system(` / `popen(` / `execl` / `CreateProcess` / `WinExec` / `ShellExecute` with user text |
| §2 | Prefer a library or OS API over shelling out | P2 | C/C++ | `system("rm …")` / `system("ls …")` when `remove` / `opendir` would do |
| §3 | C/C++ SQL APIs must bind parameters | P0 | C/C++ | `mysql_query` / `dbsqlexec` / `SQLPrepare` / `sprintf` into SQL |
| §4 | Wipe secrets with a non-elidable clear | P1 | C/C++ | `memset(password)` only; `std::string` holding a password |
| §5 | Secrets must not be public fields or globals | P1 | C/C++ | `public: std::string password`; `extern char secret[]` |
| §6 | Do not log addresses or buffer sizes | P2 | C/C++ | `log("%p", buf)`; `printf` of a pointer or allocation length |
| §7 | Store passwords with a password KDF | P1 | C/C++ | Password column written as plaintext or a single MD5/SHA-1 |
| §8 | Reject `..` before native file open | P0 | C/C++ | `open(base + name)` / `fopen` with a user path |
| §9 | Load modules by absolute path | P1 | C/C++ | `LoadLibrary("x.dll")`; `dlopen("libx.so")` |
| §10 | Restrictive file-creation mode | P1 | C/C++ | `creat` / `open` with `0777` for a secret or user file |
| §11 | Signal handlers must be async-signal-safe | P1 | C/C++ | `free` / `malloc` / `syslog` / `exit` inside `signal` handler |
| §12 | TOCTOU between check and use | P1 | C/C++ | `lstat` / `access` then later `open` on the same path |
| §13 | Bound every write, including negative indexes | P0 | C/C++ | `a[i]` with only an upper bound; `memcpy` with no cap |
| §14 | Integer overflow on copy or alloc size | P0 | C/C++ | `memcpy(dst, src, len - header)` when `len` can be small |
| §15 | Off-by-one on C strings | P1 | C/C++ | `strncat` without leaving a byte for `'\0'` |
| §16 | Signed / unsigned mix in size compares | P1 | C/C++ | `int` compared to `unsigned` after a subtract |
| §17 | Division by zero | P1 | C/C++ | `/` or `%` with no zero check (does not replace Java §11) |
| §18 | Keep NX / ASLR / PIE / canary enabled | P2 | C/C++ | `-z execstack`; `-fno-stack-protector`; no `-fPIE` |
| §19 | Do not hide errors or break language rules in the compiler | P2 | C/C++ | `-fpermissive`; `-w`; `-fno-access-control`; `-ffast-math` |
| §20 | `rand` / `srand` and TLS before 1.2 are not for security | P1 | C/C++ | `srand(` / `rand()` for a token; `TLSv1.0` / `TLSv1.1` |
| §21 | `printf` / `scanf` arity and types must match | P1 | C/C++ | Extra/missing `%`; `%s` with an `int` |
| §22 | Allocator must match deallocator | P0 | C/C++ | `free` on `new`; `delete` on `new[]` |
| §23 | Overlapping `memcpy` and `memcmp` length | P0 / P1 | C/C++ | `memcpy` on overlapping ranges; `memcmp` past the prefix |
| §24 | No use-after-close or double-close | P0 | C/C++ | `read` after `close`; `fclose` twice |
| §25 | Do not use an invalidated iterator | P1 | C/C++ | `erase` then `*it`; compare iterators from two containers |
| §26 | Check I/O and library returns | P1 | C/C++ | `read` result ignored; `char c = getc()` vs `EOF` |
| §27 | Release resources on every path, including exceptions | P1 | C/C++ | `new` without `unique_ptr`; leak in `catch` |
| §28 | Shared mutable data needs a mutex or atomic | P1 | C/C++ | Two threads write a plain `int`; `++` on a shared field |
| §29 | No uninitialized use, null deref, or stack-address escape | P0 | C/C++ | `int x; use(x)`; `return &local`; `*p` when `p` may be null |
| §30 | Self-assignment and string inner pointers | P1 | C/C++ | `operator=` without `this != &other`; `c_str()` stored after mutate |
| §31 | Stray semicolon after `if`; `unsigned >= 0` | P1 | C/C++ | `if (ok); { … }`; `if (n >= 0)` on `unsigned` |
| §32 | Pair `va_start`/`va_end`; do not swap same-type arguments | P1 | C/C++ | `va_start` without `va_end`; `memset(src, dest, n)` |

---

## 1. Untrusted data must not reach process-spawn APIs

Do not pass user or API input to `system`, `popen`, `execl` / `execlp` / `execle` / `execv` / `execvp`, `CreateProcess*`, `WinExec`, or `ShellExecute(Ex)`, and do not concatenate that input into a shell command. Shell metacharacters (`;`, `|`, `&`, `` ` ``, `$`, `>`, `<`, newlines) still inject after concatenation. Prefer `execv` with a **fixed** executable path and an argument array — never `execv("/bin/sh", { "sh", "-c", user_input })`. If a spawn is unavoidable, allowlist the executable and each argument. This rule does **not** replace B9 / `backend-security-rules.md` §2 (Java `Runtime.exec`).

```c
// ❌
char cmd[128] = "ls ";
strncat(cmd, user_input, sizeof(cmd) - strlen(cmd) - 1);
system(cmd);

char *via_shell[] = { "/bin/sh", "-c", user_input, NULL };
execv(via_shell[0], via_shell);

// ✅
if (!is_allowed_name(user_input)) {
    return -1;
}
char *args[] = { "/bin/ls", user_input, NULL };
execv(args[0], args);
```

---

## 2. Prefer a library or OS API over shelling out

Use libc / Win32 / POSIX APIs (`remove`, `rename`, `stat`, `opendir`) instead of `system("rm …")` or equivalent. Readability and injection surface both improve. P2; a justified, allowlisted spawn still goes through §1.

```c
// ❌
snprintf(command, sizeof(command), "rm %s", filename);
system(command);

// ✅
if (remove(filename) != 0) {
    return -1;
}
```

---

## 3. C/C++ SQL APIs must bind parameters

Do not `sprintf` / concatenate user text into SQL for `mysql_query`, ODBC `SQLPrepare` / `SQLExecDirect`, DB-Library `dbsqlexec`, Oracle execute helpers, or similar C APIs. Use a prepared statement and bound buffers (`mysql_stmt_prepare` + `MYSQL_BIND`, ODBC parameter markers). Identifier allowlists still apply for table/column names. This rule does **not** replace `backend-data-access-rules.md` §1 or `backend-security-rules.md` §1.

```c
// ❌
sprintf(sql, "SELECT id FROM orders WHERE customer_id = '%s'", name);
mysql_query(conn, sql);

// ✅
MYSQL_STMT *stmt = mysql_stmt_init(conn);
mysql_stmt_prepare(stmt, "SELECT id FROM orders WHERE customer_id = ?", -1);
params[0].buffer_type = MYSQL_TYPE_STRING;
params[0].buffer = (char *)name;
params[0].buffer_length = strlen(name);
mysql_stmt_bind_param(stmt, params);
```

---

## 4. Wipe secrets with a non-elidable clear

After a password, token, or key is used, overwrite it with a clear that the compiler must not drop: `memset_s`, `explicit_bzero`, `OPENSSL_cleanse`, `SecureZeroMemory`, or `volatile` + `std::fill_n`. Plain `memset` on a dying buffer may be optimized away. Do not keep secrets in `std::string` (copies scatter and the destructor does not wipe). Load secrets from the environment or a secrets manager at runtime — hardcoded literals still go through G5 and are **not** re-judged here.

```c
// ❌
char password[64] = {0};
/* use password */
memset(password, 0, sizeof(password));

// ✅
char password[64] = {0};
/* use password */
memset_s(password, sizeof(password), 0, sizeof(password));
```

---

## 5. Secrets must not be public fields or globals

Passwords and keys belong in private members (or a Pimpl) behind a narrow accessor. `extern` / public struct fields can be copied, serialized, or logged by accident.

```cpp
// ❌
struct Account {
    std::string customer_id;
    std::string password;
};
extern std::string g_api_secret;

// ✅
class Account {
public:
    bool verify(const char *password) const;
private:
    char password_[64];
};
```

---

## 6. Do not log addresses or buffer sizes

Do not print function, object, or buffer addresses, or allocation lengths, to logs, errors, or a remote client. Those values leak layout. `printf`-family conversions must match the arguments. Product builds must not keep debug dumps of pointers.

```c
// ❌
log("buffer address: %p, size: %d", p, n);

// ✅
snprintf(out, out_len, "%d: %s", order_id, status);
```

---

## 7. Store passwords with a password KDF

User passwords at rest use Argon2, scrypt, bcrypt, or PBKDF2 (or the project’s existing password hasher). Do not store plaintext. Single-pass MD5 / SHA-1 / DES for **password** storage still goes through `backend-security-rules.md` §14 — this section only adds the “use a password KDF” atom and does not retune §14. Transport uses TLS 1.2+ (see §20).

---

## 8. Reject `..` before native file open

User file names must be allowlisted or stripped of `..` and extra separators, then resolved under a fixed root before `open` / `fopen` / `creat`. This rule does **not** replace `backend-security-rules.md` §7.

```c
// ❌
snprintf(path, sizeof(path), "/var/orders/%s", user_name);
fd = open(path, O_RDONLY);

// ✅
if (strstr(user_name, "..") != NULL || strchr(user_name, '/') != NULL) {
    return -1;
}
snprintf(path, sizeof(path), "/var/orders/%s", user_name);
fd = open(path, O_RDONLY);
```

---

## 9. Load modules by absolute path

`LoadLibrary` / `LoadLibraryEx` / `dlopen` / `CreateProcess` of a relative name can load a planted DLL/SO from the current directory. Pass a full path. On Windows, drop the current directory from the DLL search list (`SetDllDirectory("")` or the project’s equivalent) and prefer a signature check before load.

```c
// ❌
LoadLibrary("orders.dll");
dlopen("liborders.so", RTLD_NOW);

// ✅
LoadLibrary("C:\\Program Files\\Example\\orders.dll");
dlopen("/usr/lib/example/liborders.so", RTLD_NOW);
```

---

## 10. Restrictive file-creation mode

New files that hold secrets or customer data must not be world-writable (`0777` / `0666`). Prefer owner-only (`0600` / `S_IRUSR | S_IWUSR`) unless the repo already documents a wider mode.

```c
// ❌
creat("orders.secret", 0777);

// ✅
creat("orders.secret", S_IRUSR | S_IWUSR);
```

---

## 11. Signal handlers must be async-signal-safe

Do not call `malloc`, `free`, `syslog`, `printf`, or other non-async-signal-safe functions from a `signal` / `sigaction` handler. Do not attach the same unsafe handler to several signals if it mutates shared state. Prefer `signalfd` / a self-pipe / setting an `volatile sig_atomic_t` flag, and do the real work in the normal flow.

```c
// ❌
void on_term(int signum) {
    syslog(LOG_NOTICE, "%s", log_message);
    free(log_message);
    exit(0);
}

// ✅
static volatile sig_atomic_t stop;
void on_term(int signum) {
    (void)signum;
    stop = 1;
}
```

---

## 12. TOCTOU between check and use

`lstat` / `access` / `stat` then a later `open` / `chmod` on the same path is a race. Prefer `open` + `fstat` on the fd, or lock before the check. Shared files across processes need the lock **before** the check, not after.

```c
// ❌
lstat(path, &st);
if (st.st_uid == expected) {
    fd = open(path, O_RDWR);
}

// ✅
fd = open(path, O_RDWR | O_NOFOLLOW);
if (fd >= 0 && fstat(fd, &st) == 0 && st.st_uid == expected) {
    /* use fd */
}
```

---

## 13. Bound every write, including negative indexes

Index and length must be checked on **both** sides (`>= 0` and `< cap`) before a write or `memcpy`. Untrusted length into `memcpy` / `strcpy` / `sprintf` is a P0 buffer overflow. Destination pointers that come from the caller must not be replaced by a user-controlled address.

```c
// ❌
int slots[5];
slots[index] = 1;          /* index unchecked */
slots[5] = 0;

// ✅
if (index >= 0 && index < 5) {
    slots[index] = 1;
}
```

---

## 14. Integer overflow on copy or alloc size

Sizes used for `malloc` / `memcpy` / `read` must be checked **after** subtraction/multiplication, for wrap and for `> cap`. A small `len - header` on a signed or wrapping unsigned type can become a huge copy.

```c
// ❌
memcpy(dst, payload, len - HEADER_LEN);

// ✅
if (len > HEADER_LEN && (len - HEADER_LEN) <= sizeof(dst)) {
    memcpy(dst, payload, len - HEADER_LEN);
}
```

---

## 15. Off-by-one on C strings

`strncat` / `strncpy` must leave one byte for `'\0'`. Using the full destination size as the `strncat` count can write past the terminator.

```c
// ❌
strncat(fullname, lastname, 20);

// ✅
strncat(fullname, lastname, sizeof(fullname) - strlen(fullname) - 1);
```

---

## 16. Signed / unsigned mix in size compares

Do not mix `int` and `unsigned` in a size compare or subtract; the signed side converts and a negative bound becomes a huge unsigned value. Cast to one signed type (or one size_t) **after** checking the value is non-negative.

```c
// ❌
int len = 1;
unsigned size = 9;
if (len < size - 10) { /* wraps; condition is true */ }

// ✅
int len = 1;
int size = 9;
if (len < size - 10) {
    return -1;
}
```

---

## 17. Division by zero

Check the divisor before `/` or `%`. This is the C/C++ form of the same atom as `java-review-rules.md` §11; it does **not** replace or retune that Java section.

```c
// ❌
return x / y;

// ✅
if (y == 0) {
    return -1;
}
return x / y;
```

---

## 18. Keep NX / ASLR / PIE / canary enabled

Do not ship with `-z execstack`, `-z norelro`, or `-fno-stack-protector`. Prefer PIE (`-fPIE -pie`) so the runtime layout is not fixed. Skip only when the repo documents a loader that cannot use them.

---

## 19. Do not hide errors or break language rules in the compiler

Do not use `-fpermissive` (errors become warnings), `-w` (hides warnings), `-fno-access-control` (breaks `private` / `protected`), or `-ffast-math` (drops IEEE/ISO float rules) on product binaries.

---

## 20. `rand` / `srand` and TLS before 1.2 are not for security

`rand` / `srand` are not for tokens, session ids, or keys — use a CSPRNG (`getentropy`, `BCryptGenRandom`, or the project’s existing helper). `backend-security-rules.md` §14 already bans DES / MD5 / SHA-1 for **security** and requires `SecureRandom` in Java; this section only names the C APIs and does not retune §14. New TLS clients/servers must not enable SSLv3 / TLS 1.0 / TLS 1.1. Do not treat every `http://` URL as P0 — only secrets or session traffic over cleartext HTTP.

---

## 21. `printf` / `scanf` arity and types must match

Every conversion in a `printf` / `sprintf` / `snprintf` / `scanf` format must have a matching argument of the right type. Extra, missing, or wrong-type arguments are undefined behavior. This expands the “conversions must match” sentence in §6 and does **not** replace §6 (do not log addresses).

```c
// ❌
printf("%s %d", order_id);
printf("%s", customer_id); /* customer_id is int */

// ✅
printf("%s %d", name, order_id);
```

---

## 22. Allocator must match deallocator

`malloc` / `calloc` / `realloc` pair with `free`. `new` pairs with `delete`. `new[]` pairs with `delete[]`. Mixing them (or `delete` on an array) is undefined. Prefer RAII (`unique_ptr`, `vector`) so the pair is automatic.

```cpp
// ❌
int *p = new int[8];
delete p;
char *q = (char *)malloc(16);
delete q;

// ✅
int *p = new int[8];
delete[] p;
std::unique_ptr<int[]> orders(new int[8]);
```

---

## 23. Overlapping `memcpy` and `memcmp` length

`memcpy` on overlapping ranges is undefined — use `memmove`. `memcmp` / `strncmp` length must be the compared prefix, not a larger buffer. Unbounded `memcpy` still goes through §13–§14 and is **not** re-judged here. Do not use `sizeof(pointer)` as a buffer length.

```c
// ❌
memcpy(buf + 2, buf, n);
memcmp(a, b, sizeof(a) + sizeof(b));

// ✅
memmove(buf + 2, buf, n);
memcmp(a, b, n);
```

---

## 24. No use-after-close or double-close

Do not `read` / `write` / `fdopen` a closed fd, and do not `close` / `fclose` twice. Null the pointer or set the fd to `-1` after close. Complements §12 (TOCTOU) and does **not** replace it.

```c
// ❌
close(fd);
read(fd, buf, n);
fclose(fp);
fclose(fp);

// ✅
if (fd >= 0) {
    close(fd);
    fd = -1;
}
```

---

## 25. Do not use an invalidated iterator

`erase` / `push_back` / reallocation invalidates iterators and references. Do not dereference them after. Do not compare iterators from two different containers. Complements Go/Java concurrency cards only by analogy — this is the C++ container atom.

```cpp
// ❌
for (auto it = orders.begin(); it != orders.end(); ++it) {
    orders.erase(it);
    *it = Order{};
}

// ✅
for (auto it = orders.begin(); it != orders.end(); ) {
    it = orders.erase(it);
}
```

---

## 26. Check I/O and library returns

`read` / `recv` / `fread` return a byte count — do not assume the full request. `getc` / `fgetc` return `int` so `EOF` is distinct from a `char`. Check `fclose` / `ferror` on write paths. `chroot` must be followed by `chdir("/")` and a privilege drop. Shift counts must be in `0 .. width-1`.

```c
// ❌
char c = getc(fp);
read(fd, buf, n);
/* ignore nread */

// ✅
int c = getc(fp);
if (c == EOF) {
    return -1;
}
ssize_t nread = read(fd, buf, n);
if (nread < 0) {
    return -1;
}
```

---

## 27. Release resources on every path, including exceptions

A C++ function that `new`s or opens a handle must release it on return **and** on `throw`. Prefer `unique_ptr` / lock guards over bare `new`. Complements `backend-service-rules.md` §15 and does **not** replace it.

```cpp
// ❌
Order *order = new Order();
if (!ready) {
    throw std::runtime_error("not ready");
}
delete order;

// ✅
auto order = std::make_unique<Order>();
if (!ready) {
    throw std::runtime_error("not ready");
}
```

---

## 28. Shared mutable data needs a mutex or atomic

Two threads must not write a plain `int` / pointer / container without a mutex or `std::atomic`. `++` on a shared non-atomic is a data race. Complements `java-review-rules.md` §38 / §39 and does **not** retune them.

```cpp
// ❌
int g_count;
void on_hit() { ++g_count; }

// ✅
std::atomic<int> g_count{0};
void on_hit() { g_count.fetch_add(1); }
```

---

## 29. No uninitialized use, null deref, or stack-address escape

Do not read an uninitialized scalar, dereference a pointer that may be null or a constant low address, or `return` / store the address of a stack local. Complements §13 (bounded write) and does **not** replace it.

```c
// ❌
int n;
use(n);
return &local;
*p = 1; /* p may be NULL */

// ✅
int n = 0;
if (p == NULL) {
    return -1;
}
*p = 1;
```

---

## 30. Self-assignment and string inner pointers

`operator=` must no-op (or still be correct) when `this == &other`. A pointer from `std::string::c_str()` / `data()` must not be used after the string is mutated or destroyed.

```cpp
// ❌
Order &operator=(const Order &other) {
    delete name_;
    name_ = strdup(other.name_);
    return *this;
}
const char *p = order.name.c_str();
order.name += "-x";
use(p);

// ✅
Order &operator=(const Order &other) {
    if (this == &other) {
        return *this;
    }
    /* copy then replace */
    return *this;
}
```

---

## 31. Stray semicolon after `if`; `unsigned >= 0`

`if (ok); { … }` always runs the block. `unsigned n; if (n >= 0)` is always true. Dead or identical `if`/`else` bodies in this language follow the same smell as `go-review-rules.md` §16 — do **not** retune that card. Switch fall-through still goes through G7.

```c
// ❌
if (ready); {
    ship(order);
}
unsigned n = customer_id;
if (n >= 0) { /* always */ }

// ✅
if (ready) {
    ship(order);
}
if (n > 0) {
    ship(order);
}
```

---

## 32. Pair `va_start`/`va_end`; do not swap same-type arguments

Every `va_start` needs a `va_end` on all paths. Same-type API arguments (`memset`, `memcpy`, `strncpy`) are easy to swap — dest first, then src, then length, unless the libc man page says otherwise.

```c
// ❌
va_start(ap, fmt);
vsnprintf(buf, n, fmt, ap);
/* missing va_end */
memset(src, dest, n);

// ✅
va_start(ap, fmt);
vsnprintf(buf, n, fmt, ap);
va_end(ap);
memset(dest, 0, n);
```

