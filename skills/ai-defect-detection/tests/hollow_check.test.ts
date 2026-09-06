import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_HOLLOW_NO_BUG_RATIO_WARN,
  validate_batch_hollow_check,
  _normalize_thinking_for_hollow,
  _text_similarity,
} from "../open_validate.ts";

const CHAIN =
  " Call chain: RiderOnlineRequiredIfaceImpl#getRiderOnlineRequiredInfo(L38)→SecurityCodeBiz#handle(L271)→SecurityCodeBiz#doGetRiderOnlineRequiredInfo(L347)→IntelligenceAdaptor#doQueryIntelligence(L219)";

const CHAIN_ZH =
  " 调用链：RiderOnlineRequiredIfaceImpl#getRiderOnlineRequiredInfo(L38)→SecurityCodeBiz#handle(L271)→SecurityCodeBiz#doGetRiderOnlineRequiredInfo(L347)";

const CLASS_SLASH = "com/sankuai/meituan/banma/staff/rider/securitycode/biz/SecurityCodeBiz";

const UNIQUES: Array<[string, string]> = [
  ["queryRealtimeSecurityCodeFallback", "方法体 L102-106：Rhino @Degrade 熔断 fallback，打 METRIC_INTELLIGENCE_FUSE 并 return null。"],
  ["queryTempGreenCode", "方法体 L121-163：Lion 熔断返回 fail()；list 空返回 success(null) 表示确认无临时绿码。"],
  ["queryTempGreenCodeFallback", "方法体 L169-173：返回 TempGreenQueryResult.fail()，上层 L430 按查询异常放行。"],
  ["currentDateStr", "方法体 L181-187：dateOverride 优先，否则 SimpleDateFormat 格式化当天，局部变量无线程安全问题。"],
  ["parseEffectiveTime", "方法体 L193-204：空串或解析失败返回 0L，isValidTempGreen 将 0 判为无效临时码。"],
  ["doQueryIntelligence", "方法体 L219-256：SECURITY_CODE/QY012/idCard 请求，list 空视为无安全码不拦截。"],
  ["supportedRequiredType", "方法体 L266-268：仅 return REQUIRED_TYPE_SECURITY_CODE=1，与 Iface requiredType=1 对齐。"],
  ["handle", "方法体 L271-280：requiredType==1 走查询，catch 后 buildResponse 放行。"],
  ["getRiderOnlineRequiredInfo", "方法体 L292-334：熔断三态（降级/观察/正常），finally complete 释放。"],
  ["doGetRiderOnlineRequiredInfo", "方法体 L347-450：灰度、白名单、缓存、红码、临时绿码分支均保守放行。"],
  ["readCacheOrDb", "方法体 L457-468：只读双缓存 AUTO，异常返回 null 走无码弹窗。"],
  ["inGray", "方法体 L474-485：riderId%100 尾号灰度，异常返回 false 不拦截。"],
  ["inGrayWhitelist", "方法体 L495-509：riderId+stationId 白名单，stationId 为空跳过站点维度。"],
  ["logTypeMetric", "方法体 L511-528：switch 三色打点，null 保护，无状态。"],
  ["buildNonRedResponse", "方法体 L536-544：黄码提示弹窗 type=4 不拦截，绿码无弹窗。"],
  ["buildResponse", "方法体 L549-562：cache 或码色为空时置 0，临时码三字段固定 0。"],
  ["buildResponseWithTemp", "方法体 L567-580：仅红码链路调用，cache 空兜底 RED(3)。"],
  ["buildEntryJson", "方法体 L619-669：内外层模板替换、URLEncode、非法 JSON 走默认。"],
  ["isCrowdSourcing", "方法体 L677-683：riderType null 检查后与 CROWD_SOURCING 比较。"],
  ["loadOuterActionTemplate", "方法体 L689-697：Lion 外层模板优先，空则内置 ${scheme}/${data} 默认。"],
  ["loadInnerDialogTemplate", "方法体 L703-714：useDefault==1 强制默认，否则按 dialogType 读 Lion。"],
  ["isValidTempGreen", "方法体 L824-839：临时码=1 且 effective>effectiveDate 才有效。"],
  ["resolveDialogType", "方法体 L845-858：红码强制 type=1，黄码走配置，缺省回落 4。"],
  ["maskIdCard", "方法体 L862-871：保留前 1 后 1，中间替换为 *，空串原样返回。"],
  ["shouldPopup", "方法体 L880-891：观察态只打点不弹窗，降级直接放行。"],
  ["mergeCacheEntry", "方法体 L900-918：本地缓存优先，DB 回源后写回 expireAt。"],
  ["toColorEnum", "方法体 L922-930：未知色值按 0 处理，避免 NPE。"],
  ["buildMetricTags", "方法体 L934-948：riderType+requiredType 维度，空值填 unknown。"],
  ["isExpiredTempGreen", "方法体 L952-961：effective<=now 视为过期，与 isValidTempGreen 互斥。"],
  ["safeComplete", "方法体 L965-972：Future 已完成则跳过，避免 complete 二次抛错。"],
  ["defaultFailResult", "方法体 L976-982：统一 fail() 占位，调用方按查询异常放行。"],
  ["commentOnlyHelper", "方法体 L990-996：仅日志拼接，无分支、无外部依赖。"],
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
      item("inGray", "方法体 L474-485：riderId%100 尾号灰度，异常返回 false。判定无缺陷。"),
    );
    assert.ok(!text.includes("Call chain"));
    assert.ok(!text.includes("getRiderOnlineRequiredInfo"));
    assert.ok(!text.includes("IntelligenceAdaptor"));
    assert.ok(text.includes("尾号灰度"));
  });

  it("strips 调用链 suffix, slash-FQCN simple name, and methodName", () => {
    const raw =
      `SecurityCodeBiz#inGray 方法体 L474-485：riderId%100 尾号灰度。判定无缺陷。` +
      ` com.sankuai.meituan.banma.staff.rider.securitycode.biz.SecurityCodeBiz 细节已读。` +
      CHAIN_ZH;
    const text = _normalize_thinking_for_hollow(item("inGray", raw, { thinking: raw }));
    assert.ok(!text.includes("调用链"));
    assert.ok(!text.includes("SecurityCodeBiz"));
    assert.ok(!text.includes("inGray"));
    assert.ok(!text.includes("com.sankuai"));
    assert.ok(text.includes("尾号灰度"));
    assert.ok(text.includes("<FILE>") || text.includes("<CLASS>"));
    assert.ok(text.includes("<METHOD>"));
  });

  it("shared Call-chain boilerplate is not enough to make independent thinkings similar", () => {
    const a = _normalize_thinking_for_hollow(item("inGray", UNIQUES[11][1]));
    const b = _normalize_thinking_for_hollow(item("inGrayWhitelist", UNIQUES[12][1]));
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
      thinking: `Local pre-filter: SecurityCodeBiz#getField${i} is GETTER. Accessor; no business logic. [${i}] Call chain: SecurityCodeBiz#getField${i}`,
    }));
    const result = validate_batch_hollow_check(items);
    assert.equal(result.blocked, false);
    assert.equal(result.details.trivial_filter_exempt, true);
  });

  it("still blocks a true copy-paste template batch", () => {
    const items = Array.from({ length: 22 }, (_, i) =>
      item(
        `method${i}`,
        "Performed detection analysis on file SecurityCodeBiz. Reviewed the code content of this Java file. After careful review the implementation complies with project standards. No functional defects or issues were found. Performed comprehensive analysis and found no problems.",
      ),
    );
    const result = validate_batch_hollow_check(items);
    assert.equal(result.blocked, true);
    assert.ok(result.details.templateHitCount >= 18 || result.details.maxConsecutiveSimilar >= 6);
  });
});
