# Path feasibility (strategy=11, bugStatus=6/7)

Before writing a suspected defect, confirm the tainted or risky path can actually execute in production. Required marker in `thinking`: `[Feasibility]`. Not required for T3 trivial methods or bugStatus=2 (`No defect in this code`).

`gen-writeback-template --strategy-code 11 --bug-status 6|7` appends the marker to the template `thinking` and explains it in `_hint_strategy11`.

## Checklist — cite the one that applies, or state that none applies

1. **Sanitizer / allowlist** — the input is escaped, parameterised, host-allowlisted or passed through a known sanitizer before the sink (`PreparedStatement` bind, `html.escape`, `bleach.clean`, `filepath.Clean` + prefix check, `is_safe_url`). Community Semgrep taint is intra-function and does not recognise these as sanitizers; the agent must.
2. **Dead config flag** — a feature flag, env variable or compile-time switch makes this branch unreachable in the deployed environment.
3. **Test-only path** — the sink lives in tests, fixtures, code generators or a sample that never ships.
4. **Caller already validated** — every production caller already checks null / range / auth / format; this method is not an entry point (show the caller and its line).
5. **Source not user-controlled** — the value is a constant, trusted config or an internally generated id, not request / argv / untrusted file data.
6. **Framework guard** — servlet filter, Spring Validation, Express/Koa middleware, Django form, ORM parameterisation or a typed API layer already blocks the sink.

If one of 1–6 applies with evidence → the finding is dismissed (bugStatus=2 with the evidence in `thinking`), or downgraded to bugStatus=7 when the guard is fragile (e.g. relies on a caller convention rather than the method itself).

## Format

```text
[Feasibility] caller already validated: OrderController#checkout(L42) rejects amount <= 0 before OrderService#charge(L88); no other caller (rg "\.charge\(") — path still reachable via BatchJob#retry(L17) → defect stands
```

- Always cite line numbers and the grep / GitNexus evidence used.
- For AST-seeded findings also cite the standards from the rule description: `cwe`, `owaspTop10_2025`, `asvs50` (`Standards: CWE-89, OWASP A05:2025, ASVS V5.3.4`).
- Per-language sanitizer idioms are listed in the language gotchas (`references/rules/<lang>-gotchas.md`).
