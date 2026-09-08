# C / C++ detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `c` or `cpp` (aliases `c++`, `cxx`).
> Strategy stays 11. Call-chain format is still `A#name(L12)→B#name(L45)`; A is the extension-less file path (`src/net/sock`).
> `run-ast-scan` loads `AST-C-*` for C and `AST-CPP-*` **plus** the C pack for C++.

---

## className / filePath

- **className**: extension-less repo path as produced by `get-changed-methods` (`src/net/sock`, `include/net/sock` for a header)
- **methodName**: the function name; C++ member definitions `Foo::bar` are reported as `bar` with `Foo` in the signature; `operator==` is reported as `operator==`
- **filePath**: the changed `.c` / `.h` / `.cpp` / `.cc` / `.hpp` path from `diff.files`
- Never invent a Java package or `src/main/java`

## GitNexus

Try GitNexus after clone. If unavailable, grep for the symbol and its callers (`rg "\bparse_frame\("`). Do not block.

## High-signal defects

- `strcpy` / `strcat` / `gets` / `sprintf` — unbounded copy (AST-C-001, AST-CPP-001)
- `printf(user)` — non-literal format string (AST-C-002, AST-CPP-004)
- `system()` with unsanitised input (AST-C-003, AST-CPP-002)
- `malloc` / `calloc` result used without a NULL check (AST-C-004)
- `scanf` / `sscanf` / `fscanf` with unbounded `%s` (AST-C-005, AST-CPP-007)
- `fopen` result used immediately without a NULL check (AST-C-006)
- `tmpnam` / `mktemp` — predictable temp path (AST-C-007)
- C++: empty `catch (...) {}` that swallows every exception (AST-CPP-003)
- C++: `ifstream` / `ofstream` opened with a concatenated user path (AST-CPP-005)
- C++: hardcoded `password` / `apiKey` / `secret` / `token` string (AST-CPP-006)
- Agent-only (no seed): off-by-one on `buf[len]` / `<=` bounds; integer overflow in size arithmetic before `malloc` / `memcpy`; `memcpy` with an attacker-controlled length; use-after-free / double free across error paths; missing `free` / `delete` on early `return`; returning the address of a stack local; signed/unsigned comparison on lengths; C++: raw `new` without RAII, iterator invalidation while erasing, `std::move` then reuse, `shared_ptr` cycles, virtual call in constructor, missing `virtual` destructor on a polymorphic base; SQL injection stays a residual (not seeded)

## Trivial filter

Empty or one-line `get_` / `set_` / `is_` accessors and trivial `operator` forwards can be T0. Do **not** mark real logic (auth, parse, charge, memory management) trivial even when the body is short.

## Write-back fence

Use ` ```c ` or ` ```cpp ` matching the file. Contract strings stay English.
