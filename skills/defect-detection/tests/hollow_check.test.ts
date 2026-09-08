import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_HOLLOW_NO_BUG_RATIO_WARN,
  validate_batch_hollow_check,
  _normalize_thinking_for_hollow,
  _text_similarity,
} from "../scripts/validate.ts";

const CHAIN =
  " Call chain: CheckoutFacadeImpl#submitOrder(L38)→CheckoutBiz#handle(L271)→CheckoutBiz#doSubmitOrder(L347)→PricingAdaptor#doQueryPrice(L219)";

// The validator accepts the Chinese label as well; keep one fixture that exercises it.
const CHAIN_ZH =
  " 调用链：CheckoutFacadeImpl#submitOrder(L38)→CheckoutBiz#handle(L271)→CheckoutBiz#doSubmitOrder(L347)";

const CLASS_SLASH = "com/example/checkout/biz/CheckoutBiz";

const UNIQUES: Array<[string, string]> = [
  ["queryRealtimePriceFallback", "Method body L102-106: circuit-breaker fallback, emits METRIC_PRICING_FUSE and returns null."],
  ["queryCouponEligibility", "Method body L121-163: config-center kill switch returns fail(); empty list returns success(null) meaning no eligible coupon."],
  ["queryCouponEligibilityFallback", "Method body L169-173: returns CouponQueryResult.fail(); caller at L430 treats a query error as pass-through."],
  ["currentDateStr", "Method body L181-187: dateOverride wins, otherwise SimpleDateFormat formats today; local variable, no thread-safety issue."],
  ["parseEffectiveTime", "Method body L193-204: empty string or parse failure returns 0L; isValidCoupon treats 0 as an invalid coupon."],
  ["doQueryPrice", "Method body L219-256: PRICE_QUERY/SKU/quantity request; empty list is treated as no price and does not block."],
  ["supportedOrderType", "Method body L266-268: only returns ORDER_TYPE_STANDARD=1, aligned with the facade orderType=1."],
  ["handle", "Method body L271-280: orderType==1 runs the query; catch falls through to buildResponse and lets the order pass."],
  ["submitOrder", "Method body L292-334: three breaker states (degraded/observing/normal); finally releases via complete."],
  ["doSubmitOrder", "Method body L347-450: gray rollout, allowlist, cache, blocked and coupon branches all conservatively let the order pass."],
  ["readCacheOrDb", "Method body L457-468: read-only two-level cache AUTO; exception returns null and shows the no-price dialog."],
  ["inGray", "Method body L474-485: userId%100 tail-digit gray rollout; exception returns false and does not block."],
  ["inGrayAllowlist", "Method body L495-509: userId+storeId allowlist; empty storeId skips the store dimension."],
  ["logTypeMetric", "Method body L511-528: switch over three status colors with null guard, stateless."],
  ["buildNonBlockedResponse", "Method body L536-544: warning dialog type=4 does not block; approved status shows no dialog."],
  ["buildResponse", "Method body L549-562: cache or status color missing sets 0; the three coupon fields are fixed to 0."],
  ["buildResponseWithCoupon", "Method body L567-580: only the blocked path calls this; empty cache falls back to BLOCKED(3)."],
  ["buildEntryJson", "Method body L619-669: outer/inner template substitution, URLEncode, invalid JSON falls back to default."],
  ["isMarketplaceOrder", "Method body L677-683: null-checks orderChannel then compares with MARKETPLACE."],
  ["loadOuterActionTemplate", "Method body L689-697: config-center outer template first, otherwise built-in ${scheme}/${data} default."],
  ["loadInnerDialogTemplate", "Method body L703-714: useDefault==1 forces the default, otherwise reads the config center by dialogType."],
  ["isValidCoupon", "Method body L824-839: coupon=1 and effective>effectiveDate are both required for validity."],
  ["resolveDialogType", "Method body L845-858: blocked forces type=1, warning follows config, default falls back to 4."],
  ["maskCardNumber", "Method body L862-871: keeps the first and last digit, replaces the middle with *, empty string returned as-is."],
  ["shouldPopup", "Method body L880-891: observing state only emits metrics without dialog; degraded passes directly."],
  ["mergeCacheEntry", "Method body L900-918: local cache first, DB fallback then writes back expireAt."],
  ["toStatusEnum", "Method body L922-930: unknown status value maps to 0 to avoid NPE."],
  ["buildMetricTags", "Method body L934-948: orderChannel+orderType dimensions, empty values filled with unknown."],
  ["isExpiredCoupon", "Method body L952-961: effective<=now means expired, mutually exclusive with isValidCoupon."],
  ["safeComplete", "Method body L965-972: skips when the Future already completed, avoiding a second complete throw."],
  ["defaultFailResult", "Method body L976-982: unified fail() placeholder; callers treat it as a query error and pass through."],
  ["commentOnlyHelper", "Method body L990-996: only log concatenation, no branches, no external dependencies."],
];

function item(methodName: string, unique: string, extra: Partial<Record<string, any>> = {}) {
  return {
    className: CLASS_SLASH,
    methodName,
    bugStatus: 2,
    strategyCode: 11,
    thinking: unique + CHAIN,
    ...extra,
  };
}

describe("batch hollow check", () => {
  it("strips the mandated Call chain suffix before comparing thinking", () => {
    const text = _normalize_thinking_for_hollow(
      item("inGray", "Method body L474-485: userId%100 tail-digit gray rollout; exception returns false. Verdict: no defect."),
    );
    assert.ok(!text.includes("Call chain"));
    assert.ok(!text.includes("submitOrder"));
    assert.ok(!text.includes("PricingAdaptor"));
    assert.ok(text.includes("tail-digit gray rollout"));
  });

  it("strips 调用链 suffix, slash-FQCN simple name, and methodName", () => {
    const raw =
      `CheckoutBiz#inGray Method body L474-485: userId%100 tail-digit gray rollout. Verdict: no defect.` +
      ` com.example.checkout.biz.CheckoutBiz details were read.` +
      CHAIN_ZH;
    const text = _normalize_thinking_for_hollow(item("inGray", raw, { thinking: raw }));
    assert.ok(!text.includes("调用链"));
    assert.ok(!text.includes("CheckoutBiz"));
    assert.ok(!text.includes("inGray"));
    assert.ok(!text.includes("com.example"));
    assert.ok(text.includes("tail-digit gray rollout"));
    assert.ok(text.includes("<FILE>") || text.includes("<CLASS>"));
    assert.ok(text.includes("<METHOD>"));
  });

  it("shared Call-chain boilerplate is not enough to make independent thinkings similar", () => {
    const a = _normalize_thinking_for_hollow(item("inGray", UNIQUES[11][1]));
    const b = _normalize_thinking_for_hollow(item("inGrayAllowlist", UNIQUES[12][1]));
    assert.ok(
      _text_similarity(a, b) < 0.7,
      `expected independent thinkings below 0.7, got ${_text_similarity(a, b)} (${a} vs ${b})`,
    );
  });

  it("allows a 32-item no-defect batch when each thinking is method-specific and only the call chain is shared", () => {
    const items = UNIQUES.map(([method, unique]) => item(method, unique));
    assert.equal(items.length, 32);
    const result = validate_batch_hollow_check(items);
    assert.equal(result.blocked, false, JSON.stringify(result.details));
    assert.equal(result.passed, true);
    assert.equal(result.details.templateHitCount, 0);
    assert.ok(result.details.noBugRatio >= BATCH_HOLLOW_NO_BUG_RATIO_WARN);
    assert.ok(
      result.warnings.some((w: string) => /high no-defect rate/i.test(w)),
      "100% bugStatus=2 should warn, not block",
    );
    assert.ok(!result.warnings.some((w: string) => /templated thinking/i.test(w)));
  });

  it("exempts a CLI trivial-filter batch from hollow-check", () => {
    const items = Array.from({ length: 22 }, (_, i) => ({
      className: CLASS_SLASH,
      methodName: `getField${i}`,
      bugStatus: 2,
      strategyCode: 11,
      _trivialFilter: true,
      trivialReason: "GETTER",
      thinking: `Local pre-filter: CheckoutBiz#getField${i} is GETTER. Accessor; no business logic. [${i}] Call chain: CheckoutBiz#getField${i}`,
    }));
    const result = validate_batch_hollow_check(items);
    assert.equal(result.blocked, false);
    assert.equal(result.details.trivial_filter_exempt, true);
  });

  it("still blocks a true copy-paste template batch", () => {
    const items = Array.from({ length: 22 }, (_, i) =>
      item(
        `method${i}`,
        "Performed detection analysis on file CheckoutBiz. Reviewed the code content of this Java file. After careful review the implementation complies with project standards. No functional defects or issues were found. Performed comprehensive analysis and found no problems.",
      ),
    );
    const result = validate_batch_hollow_check(items);
    assert.equal(result.blocked, true);
    assert.ok(result.details.templateHitCount >= 18 || result.details.maxConsecutiveSimilar >= 6);
  });
});
