#!/usr/bin/env node
/** Write the sample defect-detection HTML used in README screenshots. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render_report_html } from "../../../skills/defect-detection/scripts/providers/platform/report_html.ts";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "defect-report.html");

const summary = [
  "📋[Requirement changes] Inventory hold, volume discount, and refund cap on feature/reservation-v2",
  "🔍[Analysis scope] reservation.js, pricing.js, refund.js against docs/requirements.md",
  "⚠️[Risks]▎[This change] ▸(1)❗ reservation.js#expireStaleReservations lines 162-168｜Trigger: expire a hold then call checkAvailability｜Impact: storefront still shows held stock.▎[This change] ▸(2)❗ pricing.js#volumeDiscountRate lines 32-39｜Trigger: order exactly 10 units｜Impact: published 5% discount is skipped.▎[This change] ▸(3)❗ refund.js#resolveRefundAmount lines 18-28｜Trigger: second partial refund｜Impact: refundedTotal can exceed paidAmount.",
  "🔔[Pending confirmation]▸(1) [Hold window] ▸ Open question: should expiry notify the storefront immediately? ▸ Current assumption: yes, via cache invalidate. ▸ Need confirmation: product owner.",
  "📌[Notes]►Test: hold, expire, then checkAvailability on the same SKU.►Release: do not ship refund or discount until the three defects are fixed.",
  "✅[Conclusion] Three requirement mismatches found. None came from Semgrep seed rules. Fix before release.",
].join("    ");

const html = render_report_html(
  {
    taskId: 12,
    planName: "Inventory reservation v2",
    status: "completed",
    git: "https://github.com/example/inventory-service.git",
    developBranch: "feature/reservation-v2",
    contrastBranch: "main",
    submitUser: "reviewer",
    createdAt: "2026-09-08T10:00:00Z",
    updatedAt: "2026-09-08T11:20:00Z",
    summary,
  },
  [
    {
      bugStatus: 6,
      className: "src/reservation.js",
      methodName: "expireStaleReservations",
      content: [
        "Defect: Expiry releases reserved units without invalidating the availability cache",
        "",
        "Lines: 162-168",
        "",
        "Problem description: expireStaleReservations calls db.adjustReserved but never availabilityCache.invalidate. checkAvailability keeps serving the held (lower) count.",
        "",
        "Affected business: customers cannot buy stock that is already free",
        "",
        "Trigger: create a reservation (warms cache), wait until it expires, run expireStaleReservations, then checkAvailability for the same SKU",
        "",
        "Expected vs actual: availability should recover after expiry; it stays at the held value until TTL",
        "",
        "Fix suggestion: invalidate the same cache key holdStock / releaseStock already invalidate",
        "",
        "```javascript",
        "db.adjustReserved(sku, -qty);",
        "availabilityCache.invalidate(sku);",
        "```",
      ].join("\n"),
    },
    {
      bugStatus: 6,
      className: "src/pricing.js",
      methodName: "volumeDiscountRate",
      content: [
        "Defect: Volume tiers use exclusive > so exactly 10 units get no 5% discount",
        "",
        "Lines: 32-39",
        "",
        "Problem description: spec says discount at 10 and 50 units; code uses units > 10 and units > 50",
        "",
        "Affected business: published tier boundaries",
        "",
        "Trigger: volumeDiscountRate(10) or computeOrderTotal with 10 units",
        "",
        "Fix suggestion: use inclusive bounds (>= 10, >= 50)",
      ].join("\n"),
    },
    {
      bugStatus: 6,
      className: "src/refund.js",
      methodName: "resolveRefundAmount",
      content: [
        "Defect: Requested refund is not capped at the remaining paid balance",
        "",
        "Lines: 18-28",
        "",
        "Problem description: remaining is computed then ignored; the function returns the requested amount",
        "",
        "Affected business: over-refund",
        "",
        "Trigger: paidAmount=100, refundedTotal=80, resolveRefundAmount(order, 80)",
        "",
        "Fix suggestion: return min(requested, remaining)",
      ].join("\n"),
    },
  ],
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, "utf8");
process.stdout.write(`${out}\n`);
