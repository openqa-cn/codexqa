# Language and rule mapping

`service[].language` in the content store identifies the repository language and drives the AST rule pack, GitNexus, the trivial-method filter, `className` / `filePath` conventions and the write-back code fence. The single source of truth for all of this is `scripts/lang.ts` (`LanguageProfile`); this page is the human-readable view.

## How the language is resolved

Resolution order (`resolve_language` in `scripts/lang.ts`; recorded as `service[].languageSource`):

| `languageSource` | Meaning |
|---|---|
| `explicit` | `--language` passed to `submit-git` / `add-service-to-content` / `register-repo-clone` |
| `declared` | language carried by the ingested task / plan item |
| `detected` | inferred by `clone-and-diff` from `diff.files` extensions (dominant language, JS+TS merged) |
| `unknown` | nothing to inspect yet (pre-clone), or the changed files carry no recognised source extension. **Never silently `java`**: the language stays `unknown` until the diff resolves it, and an `unknown` service gets file-level review with no forced `.java` paths |

A service record that says `java` with no `languageSource` is treated as a legacy default rather than a declaration: if the changed files contain no Java but do contain another profiled language, detection wins.

`clone-and-diff` also stores `service[].languageBreakdown` (`{python: 12, go: 3}`) and reports `polyglot: true` when more than one language changed. **AST scan, method extraction and the trivial filter are per file, not per service**: a polyglot change set keeps its Go and Python rules and units even when TypeScript dominates.

Canonical ids: `java`, `kotlin`, `scala`, `javascript`, `typescript`, `python`, `go`, `c`, `cpp`, `csharp`. Aliases (`js`, `ts`, `py`, `golang`, `c++`, `cxx`, `cs`, `c#`, `kt`, …) are canonicalised on entry by `canonicalize_language`.

## Per-language behaviour

| language | AST pack (strategy=8) | `className` produced by `get-changed-methods` | GitNexus | STEP C gotchas | fence |
|---|---|---|---|---|---|
| `java` | `AST-EXC/EQ/SQL/RES/NPE/BOOL/RET/TH-001`, taint `AST-SQL-001`, `AST-SSRF-001` | slash FQCN relative to the source root: `com/acme/order/OrderService` | try, grep fallback | `java-gotchas.md` | ` ```java ` |
| `kotlin` | `AST-KT-001…011` (Java YAML does not parse `.kt`) | slash FQCN: `com/acme/billing/Charge` | try, grep fallback | `kotlin-gotchas.md` | ` ```kotlin ` |
| `scala` | `AST-SC-001…009` | slash FQCN | try, grep fallback | `scala-gotchas.md` | ` ```scala ` |
| `python` | `AST-PY-001…014` + `AST-PY-EXC/EQ/MUT-001` | extension-less repo path: `app/api/users` | try, grep fallback | `python-gotchas.md` | ` ```python ` |
| `go` | `AST-GO-001…009` | extension-less repo path: `internal/pay/charge` | try, grep fallback | `go-gotchas.md` | ` ```go ` |
| `javascript` | `AST-JS-001…014` + `AST-JS-EQ-001`, `AST-JS-BOUND-001` | extension-less repo path: `web/src/cart` | skipped on clients | `frontend-gotchas.md` | ` ```javascript ` |
| `typescript` | all JS rules + `AST-TS-001…007` | extension-less repo path | skipped on clients | `frontend-gotchas.md` (TypeScript subsection) | ` ```typescript ` |
| `c` | `AST-C-001…007` | extension-less repo path: `src/net/sock` | try, grep fallback | `c-cpp-gotchas.md` | ` ```c ` |
| `cpp` | `AST-CPP-001…007` + the C pack | extension-less repo path | try, grep fallback | `c-cpp-gotchas.md` | ` ```cpp ` |
| `csharp` | `AST-CS-001…011` | extension-less repo path: `src/Orders/OrderService` (**not** a `Acme.Orders.X` namespace: C# has no universal source root to strip and re-add) | try, grep fallback | `csharp-gotchas.md` | ` ```csharp ` |

Gotchas files live in `references/rules/`; `lang.ts` exposes the path per language (`gotchas_doc_for_language`). Single-file component formats keep their own fence (` ```vue `, ` ```svelte `, ` ```css `).

Path-style `className` (Go, Python, C, C#, JS/TS) means the report records `gitFilePath`. Only the `js` family plus `.vue` / `.css` / `.html` are **client** (`is_client_path`). Go is never frontend.

## Method extraction

`get-changed-methods`, `read-method-code` and `verify-line-method-mapping` share one extractor hub (`scripts/lang_methods.ts`):

- Regex/brace/indentation extractors for every supported language produce `methodName`, `params`, `startLine`, `endLine`, `bodyLineCount`, `language`.
- When Semgrep is available, function ranges are refined with Semgrep (`rangeSource: "semgrep"` on the unit; `semgrepRefinedUnits` in the command output). A rule the installed Semgrep cannot parse is dropped and the scan retried, never turned into an empty result.
- Files with no recognised structure (config, SQL, templates) fall back to one file-level unit (`fileLevel: true`) so the diff is still reviewed.
- JS/TS class fields that hold a function (`handleClick = (e) => {…}`, `fetchUser = async (id): Promise<U> => {…}`) are extracted as their own units, not folded into the class or degraded to a file-level unit.
- `bodyLineCount` counts body lines: brace one-liners (`{ return x; }`) and expression bodies (`fun f() = x`, `def f(): return 1`) count as 1, so they are never classified `EMPTY_METHOD`.

## AST scan

`run-ast-scan` is **not Java-only**:

- Rules are filtered by the Semgrep `languages:` list against **every language present in the scan targets** (plus `--project-language`). TypeScript projects accept JS rules; C++ projects accept C rules; `generic` rules always apply.
- Rules the installed Semgrep rejects (schema drift, unsupported syntax) are removed one round at a time and reported in `droppedRules`; a pack that stays invalid returns `scanOk=false` — never "0 hits".
- PR default scans `diff.files` only; `inDiff=false` stays auto-dismiss. `--scan-purpose trunk --full-repo` leaves `inDiff` null so stock hits are verified.
- Injection / command / path / SSRF / redirect / XSS seeds use Semgrep `mode: taint` from request data, argv and method parameters. Community Edition taint is intra-function: a guard such as `if is_safe_url(url)` in the same function is **not** recognised as a sanitizer — the agent dismisses those hits with the allowlist evidence.
- Every rule carries `cwe`, `owaspTop10_2025` and `asvs50` in its description (`ast_rule_metadata`); cite them in the write-back when relevant.

## Write-back requirements

- The code fence in `content` **must use the file's language tag**; `gen-writeback-template` fills it from the plan item / file path. Never hard-code ` ```java `.
- `filePath` authority is `diff.files` / plan `filePath`. When nothing else is known the fallback is `guess_file_path_for_class(className, language)` (`app/api/users.py`, `src/main/java/com/acme/Foo.java`), flagged as guessed — never invent `src/main/java` for a non-Java service.
- Contract strings stay English (`Defect:` / `Improvement:` / `No defect in this code`).
