# Python detection notes

> Load this file in Phase 2 STEP C when `service[].language` is `python` (or a Python file is in a polyglot change set).
> Strategy stays 11. Call-chain format is still `A#name(L12)→B#name(L45)`; A is the module path (`app/api/users`) or `app/api/users.Class`.

---

## className / filePath

- **className**: extension-less repo path as produced by `get-changed-methods` (`app/api/users`); append `.Class` for methods when useful
- **filePath**: the changed path from `diff.files` (`app/api/users.py`)
- Do **not** rewrite to `src/main/java/...*.java`
- `methodName` is the `def` name (`create_user`); nested `def`s are reported as separate units

## GitNexus

Try GitNexus after clone. If `ensure-gitnexus` reports `ready=false`, degrade to grep/find (`rg "def create_user\b"`, `rg "create_user\("`). Do not block the task.

## High-signal defects

- SQL built with `+`, `%` or an f-string instead of a parameterised query (AST-PY-001 taint)
- `subprocess.*(shell=True)` / `os.system` / `os.popen` with request input (AST-PY-002 / 008)
- `pickle.load(s)` / `yaml.load` without `SafeLoader` on untrusted data (AST-PY-003)
- Bare `except:` (AST-PY-004) or typed `except X: pass` (AST-PY-EXC-001) that swallows a failure callers must see
- `eval` / `exec` of request or config text (AST-PY-005)
- `os.path.join` / `Path /` with a user segment and no sandbox check (AST-PY-006)
- `open()` / `urlopen()` without a `with` block — resource leak (AST-PY-007)
- `requests.*` without `timeout=` — hangs a worker (AST-PY-009)
- Hardcoded `password` / `api_key` / `secret` / `token` assignment (AST-PY-010)
- `requests.*(verify=False)` — TLS verification disabled (AST-PY-011)
- Request data → `requests.*` / `urlopen` (SSRF, AST-PY-012 taint); request data → `redirect` / `HttpResponseRedirect` / `RedirectResponse` (open redirect, AST-PY-013); request data → `mark_safe` / `Markup` (XSS, AST-PY-014). Taint is intra-function: dismiss when an allowlist / `html.escape` / `bleach.clean` guard is on the same path
- `x == None` instead of `is None` (AST-PY-EQ-001) — low severity unless `__eq__` is overridden
- Mutable default argument `def f(x=[])` shared across calls (AST-PY-MUT-001)
- Agent-only (no seed): `async def` calling blocking I/O; missing `await`; `dict[key]` on request payloads without `.get` / validation; `datetime.now()` without tz in persisted data; `assert` used for input validation (stripped with `-O`)

## Facade / proxy false-positive traps

A FastAPI / Flask / Django view that proxies to another service is not "missing auth" when the spec names the callee as the enforcer. Do not use a first-party view's `Depends(auth)` as proof that the proxy is defective. Full rule: `analysis-framework.md` → Facade / proxy vs first-party handler.

## Trivial filter

`__str__` / `__repr__`, `@property` one-liners and tiny `get_*` / `set_*` / `is_*` accessors are T0 (`trivialReason` GETTER/SETTER). A real handler (`create_user`, `charge`) is never trivial, however short. Never invent `bodyLineCount`.

## Write-back fence

Use ` ```python `. Contract strings stay English (`Defect:` / `Improvement:` / `No defect in this code`).
