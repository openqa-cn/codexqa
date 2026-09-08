# Polyglot service: Python + Go + TypeScript in one change set

A small repository with three languages and a feature branch that plants one or two seeded defects per language. It exercises the language-aware path of `defect-detection`: language detection from `diff.files`, per-language method extraction, per-language Semgrep packs on a single `run-ast-scan`, and write-back conventions that never fall back to `src/main/java`.

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

From `skills/defect-detection` (see its README Quick start for the environment variables):

```bash
REPO=$(node ../../examples/polyglot-service/make-git-fixture.mjs)
node scripts/detect.ts submit-git --git "file://$REPO" --branch feature/polyglot-defects --submit-user you
# → taskId / batchId
node scripts/detect.ts clone-and-diff --task-id $TASK_ID --batch-id $BATCH_ID --git-url "file://$REPO" \
  --branch feature/polyglot-defects --base-branch main
```

`clone-and-diff` reports `languageSource: "detected"`, `polyglot: true`, `languageBreakdown: {python:1, go:1, typescript:1}` and `gotchasDocs` pointing at `python-gotchas.md`, `go-gotchas.md`, `frontend-gotchas.md`. Then:

```bash
node scripts/detect.ts get-changed-methods --task-id $TASK_ID --local-dir "$LOCAL_DIR"   # units for all three files, language on each
node scripts/detect.ts build-detection-plan --task-id $TASK_ID --batch-ids $BATCH_ID     # get_name trivial=true, the rest deep
node scripts/detect.ts run-ast-scan --code-dir "$LOCAL_DIR" --rules-json "$RULES" --task-id $TASK_ID
# languages: [go, python, typescript]; ruleCount covers the Go + Python + JS + TS packs
node scripts/detect.ts run-optional-overlays --code-dir "$LOCAL_DIR" --task-id $TASK_ID   # bandit / gosec / eslint when installed
```

The same flow is asserted end to end by `skills/defect-detection/tests/multilang_e2e.test.ts`.

This is a hand-authored fixture: it proves the pipeline handles a non-Java, multi-language change set; it is not an agent-generated report or an accuracy claim.
