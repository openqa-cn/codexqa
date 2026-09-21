import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PREVIEW_REPORT_MD, render_html_report, render_preview_html } from "../scripts/html_report.ts";

const ENGLISH_ONLY = `# Exception diagnosis

## Executive summary
NPE in OrderService.checkout. Confidence: medium

## Symptom and exception facts
Type NullPointerException

## Mapped call path
unverified

## Root cause
null order

## Trigger
OrderService#checkout L42 is not the root

## Contributing factors
missing guard

## Suggested fix and verification
add null check

## Confidence and gaps
Confidence: medium
`;

describe("html report i18n", () => {
  it("preview HTML has paired zh/en bodies and chrome labels", () => {
    const html = render_preview_html();
    assert.match(html, /data-lang="en"/);
    assert.match(html, /data-set-lang="zh"/);
    assert.match(html, /data-zh="异常诊断"/);
    assert.match(html, /data-en="Exception diagnosis"/);
    assert.match(html, /data-zh="摘要"/);
    assert.match(html, /data-en="Executive summary"/);
    assert.match(html, /class="unit-zh"/);
    assert.match(html, /class="unit-en"/);
    assert.match(html, /未写入 <code>COMMITTED<\/code>/);
    assert.match(html, /leaving status unset/);
    assert.match(html, /html:not\(\[data-lang="en"\]\) \.unit-en/);
  });

  it("bilingual markdown keeps both section bodies for the language toggle", () => {
    const html = render_html_report(PREVIEW_REPORT_MD, { lang: "en" });
    assert.match(html, /class="unit-zh"/);
    assert.match(html, /抛错只是触发点/);
  });

  it("English-only markdown still switches heading labels", () => {
    const html = render_html_report(ENGLISH_ONLY, { lang: "en" });
    assert.match(html, /data-zh="根因"/);
    assert.match(html, /data-en="Root cause"/);
    assert.match(html, /null order/);
    assert.doesNotMatch(html, /class="unit-zh"/);
  });
});
