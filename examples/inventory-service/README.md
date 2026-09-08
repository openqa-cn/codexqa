# Inventory service: a blind-evaluation fixture for business-logic defects

A JavaScript reservation-and-refund service with an approved product specification. The `feature/reservation-v2` branch delivers real functionality — hold windows, an expiry sweep, partial refunds, a bounded cache — and hides **seven business-logic defects** inside those otherwise legitimate changes, alongside **four decoy functions** that look wrong but satisfy the spec.

None of the seven has a syntactic signature. Each one is code that reads naturally and only becomes a defect when checked against [`base/docs/requirements.md`](base/docs/requirements.md). That makes this fixture a test of *semantic* review rather than pattern matching, and a way to measure false positives, which most detection demos leave out.

What a finished HTML report looks like on this domain: [sample page](../../docs/assets/previews/defect-report.html) (canned findings, same renderer).

## Run the answer key

```bash
node examples/inventory-service/verify.mjs
```

Every defect is reproduced at runtime and tied to the requirement it breaks; every decoy is exercised and shown to be correct. Expected output ends with:

```text
PASS: 7 seeded defects reproduce, 4 decoys behave correctly.
```

This keeps [`ground-truth.json`](ground-truth.json) honest — if the fixture is edited and a defect stops reproducing, this fails.

## Seeded defects

| ID | File · function | Requirement broken | Seed | Difficulty |
|---|---|---|---|---|
| D1 | `reservation.js` · `expireStaleReservations` | 6 — expiry must be visible immediately | Sweep adjusts the reserved counter directly and never invalidates the availability cache a sibling module reads | medium |
| D2 | `inventory.js` · `holdStock` | 4 — no double holding | Refactor to the async row API turns an atomic update into check-then-act; two concurrent holds both succeed | medium |
| D3 | `refund.js` · `resolveRefundAmount` | 11 — refunds must never exceed what was paid | A requested amount is returned uncapped instead of clamped to the remaining balance | easy |
| D4 | `pricing.js` · `volumeDiscountRate` | 8 — tiers are inclusive at the lower bound | `>` where the spec says "10 units or more" | easy |
| D5 | `refund.js` · `refundOrder` | 12 — the gateway is the source of truth | Gateway failure is caught, a local receipt is fabricated, and the caller is told `ok: true` | easy |
| D6 | `db.js` · `withLock` | 14 — locks release even on failure | Release moved after an `await` with no `finally`, so a throwing section leaks the key forever | medium |
| D7 | `reservation.js` · `commitReservation` | 5 — commit semantics | Status is never set to `COMMITTED`, leaving the reservation replayable | hard |

## Decoys

These are changed in the same branch, look suspicious, and are correct. Flagging one is a false positive.

| File · function | Why it looks wrong | Why it is right |
|---|---|---|
| `pricing.js` · `roundMoney` | A `Number.EPSILON` nudge reads like a magic-number hack | It is the fix for a real v1 bug: without it `1.005` rounds down, violating requirement 10 |
| `inventory.js` · `releaseStock` | The existing null guard was removed | Documented caller contract guarantees an open hold, so the row exists |
| `reservation.js` · `resolveHoldWindow` | Only clamps the upper bound | Requirement 1 explicitly permits shorter windows |
| `cache.js` · `set` | Delete-then-reinsert plus `keys().next()` looks like a broken LRU | `Map` preserves insertion order, so this is a correct write-order eviction |

Three further changed functions — `computeOrderTotal`, `refundSummary`, `createReservation` — are simply clean.

## Build the git fixture

```bash
node examples/inventory-service/make-git-fixture.mjs      # prints the repo path
```

`main` holds the known-good service; `feature/reservation-v2` carries the changes above (7 files, +217/−35).

## Run defect-detection against it

From `skills/defect-detection` (see its README Quick start for environment variables):

```bash
REPO=$(node ../../examples/inventory-service/make-git-fixture.mjs)
node scripts/detect.ts submit-git --git "file://$REPO" --branch feature/reservation-v2 --submit-user you
# → taskId / batchId
node scripts/detect.ts clone-and-diff --task-id $TASK_ID --batch-id $BATCH_ID --git-url "file://$REPO" \
  --branch feature/reservation-v2 --base-branch main --with-plan
```

Supplying the specification is what makes this a meaningful run — without it every plan item stays at T3 and the depth requirements do not apply (see [known limitations](../../skills/defect-detection/KNOWN_LIMITATIONS.md)):

```bash
node scripts/detect.ts add-document --task-id $TASK_ID --doc-type requirementDocs \
  --title "Reservation & Refund Requirements v2" --file-path "$LOCAL_DIR/docs/requirements.md"
node scripts/detect.ts check-phase2-readiness --task-id $TASK_ID     # re-stamps tiers upward
```

## Blind evaluation protocol

The recorded result below came from following this protocol, and any comparable claim should follow it too:

1. The agent gets the repository, the branch, and `docs/requirements.md` — the same inputs a human reviewer would get.
2. `ground-truth.json` and `verify.mjs` are **withheld** for the entire run. The agent never sees defect IDs, counts, or locations.
3. The agent completes Phase 1 → 3 and produces its report.
4. Only then is the report scored against the answer key: a defect counts as found when the reported location and mechanism match, and any finding on a decoy or a clean function counts as a false positive.

Scoring after the fact is what makes the number meaningful. A run where the agent has seen the answer key measures nothing.

## Recorded result

| Metric | Result |
|---|---|
| Recall | 7 / 7 |
| Precision | 7 / 7 (0 false positives on the four decoys) |
| Found by Semgrep seed rules | 0 / 7 |

Conditions: Composer agent, 2026-09-08, local providers, runtime-confirmed findings.

Read this as a demonstration that the contract works end to end, **not as a benchmark score**. It is one model, one run, on a fixture authored by the same project. Multi-model variance, repeated runs, and third-party fixtures are all missing. The third row is the interesting one: every defect here was caught by method-level analysis against the specification, and none by static rules — see [how it works](../../skills/defect-detection/HOW_IT_WORKS.md).
