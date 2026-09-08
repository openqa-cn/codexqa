// Executable answer key for the inventory-service fixture.
//
// Each seeded defect is reproduced at runtime and tied to the requirement it
// breaks in base/docs/requirements.md, and each decoy is shown to be correct.
// This keeps ground-truth.json honest: if someone edits the fixture and a
// defect stops reproducing, or a decoy starts misbehaving, this fails.
//
// No AI model is involved. Passing here is a statement about the fixture,
// not about detection accuracy.
//
//   node examples/inventory-service/verify.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { materialize } from "./materialize.mjs";

// Set before the fixture modules are imported: their logger reads it at load time.
process.env.LOG_LEVEL = "silent";

const work = mkdtempSync(join(tmpdir(), "inventory-service-verify-"));
const load = async (variant, mod) => {
  const dir = join(work, variant);
  return import(pathToFileURL(join(dir, "src", mod)).href);
};

materialize(join(work, "base"), "base");
materialize(join(work, "head"), "head");

const results = [];
const check = async (id, rule, what, fn) => {
  await fn();
  results.push({ id, rule, what });
  console.log(`  ${id.padEnd(3)} ${what}  (${rule})`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- seeded defects

console.log("Seeded defects reproduce on feature/reservation-v2:");

await check("D1", "rule 6 · expiry sweep", "expiry leaves availability stale", async () => {
  const db = await load("head", "db.js");
  const inv = await load("head", "inventory.js");
  const res = await load("head", "reservation.js");

  db.reset();
  db.seedStock([{ sku: "SKU-A", onHand: 10 }]);
  await res.createReservation({ orderId: "o-1", lines: [{ sku: "SKU-A", qty: 4, unitPrice: 5 }], ttlMs: 1000 });

  assert.equal(await inv.checkAvailability("SKU-A"), 6, "hold should reduce availability");
  await res.expireStaleReservations({ now: Date.now() + 60_000 });

  // The sweep calls db.adjustReserved directly and never invalidates the cache
  // that checkAvailability reads, so customers keep seeing the expired hold.
  assert.equal(db.getStock("SKU-A").reserved, 0, "sweep should return the units");
  assert.equal(await inv.checkAvailability("SKU-A"), 6, "DEFECT: availability still excludes the expired hold");
});

await check("D2", "rule 4 · no double holding", "concurrent holds oversell", async () => {
  const head = { db: await load("head", "db.js"), inv: await load("head", "inventory.js") };
  head.db.reset();
  head.db.seedStock([{ sku: "SKU-B", onHand: 10 }]);

  const [a, b] = await Promise.all([head.inv.holdStock("SKU-B", 8), head.inv.holdStock("SKU-B", 8)]);
  // Both callers read a snapshot before either wrote back, so both were told
  // their hold succeeded while the store only recorded one of them.
  assert.ok(a && b, "DEFECT: both concurrent holds succeeded for 16 of 10 units");
  assert.equal(head.db.getStock("SKU-B").reserved, 8, "DEFECT: the second write clobbered the first");

  const base = { db: await load("base", "db.js"), inv: await load("base", "inventory.js") };
  base.db.reset();
  base.db.seedStock([{ sku: "SKU-B", onHand: 10 }]);
  const [c, d] = await Promise.all([base.inv.holdStock("SKU-B", 8), base.inv.holdStock("SKU-B", 8)]);
  assert.ok(c !== d, "known-good: exactly one concurrent hold succeeds");
});

await check("D3", "rule 11 · partial refunds", "refund amount is not capped", async () => {
  const { resolveRefundAmount } = await load("head", "refund.js");
  const order = { paidAmount: 100, refundedTotal: 80 };
  assert.equal(resolveRefundAmount(order, undefined), 20, "omitted amount uses the remaining balance");
  assert.equal(resolveRefundAmount(order, 50), 50, "DEFECT: 50 returned when only 20 remains");
});

await check("D4", "rule 8 · volume discount", "tier boundaries are exclusive", async () => {
  const { volumeDiscountRate } = await load("head", "pricing.js");
  // The spec says the tiers are inclusive at their lower bound.
  assert.equal(volumeDiscountRate(10), 0, "DEFECT: exactly 10 units gets no discount");
  assert.equal(volumeDiscountRate(50), 0.05, "DEFECT: exactly 50 units gets the small-tier rate");
  assert.equal(volumeDiscountRate(11), 0.05, "above the boundary is correct");
});

await check("D5", "rule 12 · gateway is truth", "failed refund reported as success", async () => {
  const db = await load("head", "db.js");
  const gw = await load("head", "gateway.js");
  const { refundOrder } = await load("head", "refund.js");

  db.reset();
  db.saveOrder({ id: "o-5", paidAmount: 100, refundedTotal: 0, paymentRef: "pay_o-5", status: "PAID" });
  gw.failNextRefunds(1);

  const out = await refundOrder("o-5", 40);
  assert.equal(out.ok, true, "DEFECT: gateway failure reported as a successful refund");
  assert.equal(out.receipt.localOnly, true, "DEFECT: a receipt was fabricated locally");
  assert.equal(db.getOrder("o-5").refundedTotal, 40, "DEFECT: ledger moved without a settled refund");

  const baseDb = await load("base", "db.js");
  const baseGw = await load("base", "gateway.js");
  const baseRefund = await load("base", "refund.js");
  baseDb.reset();
  baseDb.saveOrder({ id: "o-5", paidAmount: 100, refundedTotal: 0, paymentRef: "pay_o-5", status: "PAID" });
  baseGw.failNextRefunds(1);
  await assert.rejects(() => baseRefund.refundOrder("o-5"), "known-good: the gateway error propagates");
  assert.equal(baseDb.getOrder("o-5").refundedTotal, 0, "known-good: ledger untouched");
});

await check("D6", "rule 14 · critical sections", "lock leaks when the body throws", async () => {
  const db = await load("head", "db.js");
  db.reset();
  await db.withLock("k", async () => { throw new Error("boom"); }).catch(() => {});

  // releaseLock sits after the await, so it never runs on the failure path.
  const timer = sleep(150).then(() => "TIMEOUT");
  const outcome = await Promise.race([db.withLock("k", async () => "acquired"), timer]);
  assert.equal(outcome, "TIMEOUT", "DEFECT: the key stayed locked after a failed section");

  const baseDb = await load("base", "db.js");
  baseDb.reset();
  await baseDb.withLock("k", async () => { throw new Error("boom"); }).catch(() => {});
  const baseOutcome = await Promise.race([baseDb.withLock("k", async () => "acquired"), sleep(150).then(() => "TIMEOUT")]);
  assert.equal(baseOutcome, "acquired", "known-good: the lock is released in a finally");
});

await check("D7", "rule 5 · commit semantics", "commit leaves status HELD", async () => {
  const db = await load("head", "db.js");
  const res = await load("head", "reservation.js");
  db.reset();
  db.seedStock([{ sku: "SKU-C", onHand: 10 }]);

  const created = await res.createReservation({ orderId: "o-7", lines: [{ sku: "SKU-C", qty: 2, unitPrice: 5 }] });
  await res.commitReservation(created.reservation.id);

  const after = db.getReservation(created.reservation.id);
  assert.equal(after.status, "HELD", "DEFECT: committed reservation is still marked HELD");
  assert.ok(after.committedAt, "the commit timestamp was written, so the state is contradictory");

  // A second commit is now accepted, double-consuming stock.
  const replay = await res.commitReservation(created.reservation.id);
  assert.equal(replay.ok, true, "DEFECT: the commit is replayable");
});

// ------------------------------------------------------------------------ decoys

console.log("\nDecoys look suspicious but satisfy the spec:");

await check("T1", "rule 10 · rounding", "roundMoney epsilon nudge is correct", async () => {
  const { roundMoney } = await load("head", "pricing.js");
  assert.equal(roundMoney(1.005), 1.01, "half-up rounding requires the epsilon correction");
  assert.equal(roundMoney(2.675), 2.68);
  assert.equal(roundMoney(10), 10);

  const base = await load("base", "pricing.js");
  assert.equal(base.roundMoney(1.005), 1, "the branch actually fixes a v1 rounding bug");
});

await check("T2", "caller contract", "releaseStock without a null guard", async () => {
  const db = await load("head", "db.js");
  const inv = await load("head", "inventory.js");
  db.reset();
  db.seedStock([{ sku: "SKU-D", onHand: 10, reserved: 4 }]);
  assert.equal(await inv.releaseStock("SKU-D", 4), true);
  assert.equal(db.getStock("SKU-D").reserved, 0, "every documented caller holds a live reservation first");
});

await check("T3", "rule 1 · hold window", "resolveHoldWindow clamps only the maximum", async () => {
  const { resolveHoldWindow } = await load("head", "reservation.js");
  assert.equal(resolveHoldWindow(undefined), 15 * 60 * 1000, "default is 15 minutes");
  assert.equal(resolveHoldWindow(5 * 60 * 1000), 5 * 60 * 1000, "shorter windows are explicitly allowed");
  assert.equal(resolveHoldWindow(99 * 60 * 1000), 60 * 60 * 1000, "clamped to the 60 minute maximum");
});

await check("T4", "bounded cache", "TtlCache.set re-insert is intentional", async () => {
  const { TtlCache } = await load("head", "cache.js");
  const cache = new TtlCache({ ttlMs: 60_000, name: "t" });
  cache.set("a", 1);
  cache.set("a", 2);
  assert.equal(cache.get("a"), 2, "re-insert refreshes rather than duplicating");
  for (let i = 0; i < 600; i += 1) cache.set(`k${i}`, i);
  assert.ok(cache.stats().size <= 512, "eviction keeps the map bounded");
  assert.equal(cache.get("k599"), 599, "the newest key survives");
});

rmSync(work, { recursive: true, force: true });

const defects = results.filter((r) => r.id.startsWith("D")).length;
const decoys = results.filter((r) => r.id.startsWith("T")).length;
console.log(`\nPASS: ${defects} seeded defects reproduce, ${decoys} decoys behave correctly.`);
console.log("Fixture verified against ground-truth.json; no AI detection claim.");
