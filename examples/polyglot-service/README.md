# Polyglot service: Python + Go + TypeScript in one change set

A small repository with three languages and a feature branch that plants one or two seeded defects per language. It remains a polyglot fixture for local experiments with `codexqa-defect-analyzer` (`run_scan.py`) or other code skills.

## Seeded defects (`feature/polyglot-defects` vs `main`)

| File | Method | Seed | Expected signal |
|---|---|---|---|
| `app/api/users.py` | `find_user` | SQL built by string concatenation | `AST-PY-001` (taint) + STEP C |
| `app/api/users.py` | `load_users` | mutable default argument shared across calls | `AST-PY-MUT-001` |
| `internal/pay/charge.go` | `Charge` | `amount < 0` accepts zero although the contract says strictly positive | STEP C boundary finding (no seed rule; agent) |
| `internal/pay/charge.go` | `Refund` | `os.Open` error discarded, nil receipt dereferenced | `AST-GO-004` + STEP C |
| `web/src/cart.ts` | `applyCoupon` | `==` on a value, `eval` of user input | `AST-JS-EQ-001`, `AST-JS-001` |

`get_name` and `total` are unchanged and must not appear in the plan; the two Python methods, two Go functions and `applyCoupon` are the whole plan, each tagged with its own `language`.

## Build the fixture

```bash
node examples/polyglot-service/make-git-fixture.mjs      # prints the repo path
```

## Run the skill against it

From `skills/codexqa-defect-analyzer`:

```bash
python3 scripts/run_scan.py incremental --repo "$REPO" --intent "polyglot seeded defects" --fresh -o /tmp/aid_report
```

Use `npm test` in `skills/codexqa-defect-analyzer` for pipeline/policy regressions.

This is a hand-authored fixture: it proves the pipeline handles a non-Java, multi-language change set; it is not an agent-generated report or an accuracy claim.
