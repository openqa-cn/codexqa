import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { render_report_html, _parse_confirm_items } from "../providers/platform/report_html.ts";

describe("render_report_html", () => {
  it("structures risks and findings", () => {
    const summary = "📋[Requirement changes] Updated checkout validation    🔍[Analysis scope] Covered 1 service    ⚠️[Risks]▎[This change] ▸(1)❗ OrderService#pay lines 10-20｜Trigger: amount is negative｜Impact: checkout succeeds.    🔔[Pending confirmation]▸(1) [Amount policy] ▸ Open question: whether 0 is allowed. ▸ Current assumption: 0 should be rejected. ▸ Need confirmation: whether product allows 0.    📌[Notes]►Test: construct a negative amount.►Release: ship the payment service first.    ✅[Conclusion] Recommend fixing before release.";
    const html = render_report_html({
      taskId: 3,
      planName: "Checkout validation",
      status: "completed",
      git: "ssh://git@git.sankuai.com/bm/demo.git",
      developBranch: "feature/x",
      contrastBranch: "master",
      submitUser: "alice",
      summary,
    }, [
      {
        bugStatus: 6,
        className: "com/example/order/OrderService",
        methodName: "pay",
        content: "Defect: Negative amount is not blocked\n\nLines: 10-20\n\nProblem description: amount<=0 proceeds to checkout\n\nAffected business: fund loss\n\nTrigger: amount is negative\n\nFix: reject non-positive amounts\n\n```java\nif (amount <= 0) throw new IllegalArgumentException();\n```",
      },
      {
        bugStatus: 7,
        className: "com/example/order/OrderService",
        methodName: "format",
        content: "Improvement: Logs are missing the order id\n\nLines: 3-4\n\nCurrent impact: slower troubleshooting\n\n[Pending confirmation] whether masking is required",
      },
    ]);
    assert.match(html, /⚠️\[Risks\]/);
    assert.match(html, /OrderService#pay/);
    assert.match(html, /amount is negative/);
    assert.match(html, /id="finding-1"/);
    assert.match(html, /class="finding-row"/);
    assert.match(html, /data-filter="bug"/);
    assert.match(html, /if \(amount &lt;= 0\)/);
    assert.match(html, /whether product allows 0/);
    assert.match(html, /<dt>Please confirm<\/dt><dd>whether product allows 0\.<\/dd>/);
    assert.match(html, /class="kpi-row"/);
  });

  it("unpacks Chinese pipe-packed pending confirmation cards", () => {
    const body = [
      "▸(1) 值域矛盾项: staffmanageserver 写入缓存 securityCodeType 的实际值域是 1/2/3 还是 0/1/2 | 当前假设：写入方与情报侧一致使用 1/2/3，仅注释错误 | 请确认：写入方枚举定义；若确认仅注释问题请修正三处注释。",
      "▸(2) 降级开关项: intelligence.degrade 是否为遗漏接线的独立手动开关 | 当前假设：预留未接线 | 请确认：运维手册中两个 Lion 键的预期用途。",
    ].join("");
    const items = _parse_confirm_items(body);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "值域矛盾项");
    assert.equal(items[0]["Open question"], "staffmanageserver 写入缓存 securityCodeType 的实际值域是 1/2/3 还是 0/1/2");
    assert.equal(items[0]["Current assumption"], "写入方与情报侧一致使用 1/2/3，仅注释错误");
    assert.equal(items[0]["Please confirm"], "写入方枚举定义；若确认仅注释问题请修正三处注释。");
    assert.equal(items[1].title, "降级开关项");
    assert.equal(items[1]["Open question"], "intelligence.degrade 是否为遗漏接线的独立手动开关");
    assert.equal(items[1]["Current assumption"], "预留未接线");
    assert.equal(items[1]["Please confirm"], "运维手册中两个 Lion 键的预期用途。");

    const html = render_report_html({
      taskId: 4,
      planName: "packed confirms",
      status: "completed",
      summary: `🔔[Pending confirmation]${body}`,
    }, []);
    assert.match(html, /<h3>#1 值域矛盾项<\/h3>/);
    assert.match(html, /<dt>Open question<\/dt><dd>staffmanageserver 写入缓存 securityCodeType 的实际值域是 1\/2\/3 还是 0\/1\/2<\/dd>/);
    assert.match(html, /<dt>Current assumption<\/dt><dd>写入方与情报侧一致使用 1\/2\/3，仅注释错误<\/dd>/);
    assert.match(html, /<dt>Please confirm<\/dt><dd>写入方枚举定义；若确认仅注释问题请修正三处注释。<\/dd>/);
    assert.match(html, /<h3>#2 降级开关项<\/h3>/);
    assert.match(html, /<dt>Open question<\/dt><dd>intelligence.degrade 是否为遗漏接线的独立手动开关<\/dd>/);
    assert.doesNotMatch(html, /<dt>Open question<\/dt><dd>—<\/dd>/);
  });
});
