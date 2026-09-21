import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EN_HEADINGS, ZH_HEADINGS, extract_sections, split_bilingual } from "./report.ts";

export type HtmlReportOpts = {
  lang?: "en" | "zh";
  store?: string;
  preview?: boolean;
  product?: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));

export const HEADING_PAIRS = EN_HEADINGS.map((en, i) => ({
  en,
  zh: ZH_HEADINGS[i],
  enLabel: en.replace(/^#+ /, ""),
  zhLabel: ZH_HEADINGS[i].replace(/^#+ /, ""),
}));

/** README screenshot sample — bilingual so 中文 / EN actually swaps body text. */
export const PREVIEW_REPORT_MD = `# Exception diagnosis

## Executive summary
\`NullPointerException\` on \`refund.js#resolveRefundAmount\`. Root is \`reservation.js#commitReservation\` leaving status unset. Confidence: medium

## Symptom and exception facts
Type \`NullPointerException\` on refund amount resolve; primary \`refund.js#resolveRefundAmount:18\`.

## Mapped call path
\`POST /refunds → refund.js#refundOrder:44 → refund.js#resolveRefundAmount:18 → NPE\`

## Root cause
Throw is the trigger, not the root. \`commitReservation\` returns success without writing \`COMMITTED\`.

## Trigger
NPE at \`refund.js#resolveRefundAmount:18\` is not the root.

## Contributing factors
Refund reads reservation status that stayed \`HELD\` after a successful commit.

## Suggested fix and verification
Set status \`COMMITTED\` before \`saveReservation\` returns; verify a second commit is rejected and refund amount is defined.

## Confidence and gaps
Confidence: medium. Indexed line vs stack can drift on \`refund.js\`.

# 异常诊断

## 摘要
\`refund.js#resolveRefundAmount\` 触发 \`NullPointerException\`。根因是 \`reservation.js#commitReservation\` 成功返回却未写入 \`COMMITTED\`。Confidence: medium

## 现象与异常事实
异常类型 \`NullPointerException\`，主帧 \`refund.js#resolveRefundAmount:18\`，发生在退款金额解析。

## 映射调用链
\`POST /refunds → refund.js#refundOrder:44 → refund.js#resolveRefundAmount:18 → NPE\`

## 根因
抛错只是触发点，不是根因。\`commitReservation\` 返回成功但未把状态写成 \`COMMITTED\`。

## 触发点
\`refund.js#resolveRefundAmount:18\` 的 NPE 是触发点，不是根因。

## 促成因素
退款读取预订状态；提交成功后状态仍停在 \`HELD\`。

## 修复建议与验证
在 \`saveReservation\` 返回前写入 \`COMMITTED\`；验证第二次 commit 被拒绝，且退款金额可解析。

## 置信度与缺口
Confidence: medium。\`refund.js\` 堆栈行号与索引可能有偏差。
`;

function chrome_dir(): string {
  const skill = join(HERE, "..", "assets");
  const docs = join(HERE, "..", "..", "..", "docs", "assets");
  if (existsSync(join(skill, "report-chrome.css")) && existsSync(join(skill, "report-chrome.js"))) return skill;
  if (existsSync(join(docs, "report-chrome.css")) && existsSync(join(docs, "report-chrome.js"))) return docs;
  throw new Error("report chrome missing (assets/report-chrome.css + .js)");
}

function escape_html(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline_md(text: string): string {
  const escaped = escape_html(String(text || "").trim());
  const withCode = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  const paras = withCode.split(/\n{2,}/).map((p) => p.replace(/\n/g, "<br/>"));
  return paras.map((p) => `<p>${p}</p>`).join("");
}

function bi_label(zh: string, en: string, shown: string): string {
  return `<span data-zh="${escape_html(zh)}" data-en="${escape_html(en)}">${escape_html(shown)}</span>`;
}

function dual_block(enBody: string, zhBody: string): string {
  const en = String(enBody || "").trim();
  const zh = String(zhBody || "").trim();
  if (en && zh && en !== zh) {
    return `<div class="block"><div class="unit-en">${inline_md(en)}</div><div class="unit-zh">${inline_md(zh)}</div></div>`;
  }
  return `<div class="block">${inline_md(en || zh)}</div>`;
}

function confidence_badge(summary: string, shownLang: "en" | "zh"): string {
  const m = String(summary || "").match(/Confidence:\s*(high|medium|low)\b/i);
  const level = (m?.[1] || "").toLowerCase();
  if (!level) return "";
  const cls = level === "high" ? "p0" : level === "low" ? "p3" : "p1";
  const en = `Confidence: ${level}`;
  const zh = `置信度：${level === "high" ? "高" : level === "low" ? "低" : "中等"}`;
  return `<span class="badge pri ${cls}">${bi_label(zh, en, shownLang === "en" ? en : zh)}</span>`;
}

function prefs_html(lang: "en" | "zh"): string {
  const zhOn = lang === "zh" ? "true" : "false";
  const enOn = lang === "en" ? "true" : "false";
  const lightOn = "true";
  const darkOn = "false";
  return `<div class="prefs" role="toolbar" aria-label="${lang === "en" ? "Language and theme" : "语言和主题"}">
  <div class="group" role="group" aria-label="Language">
    <button type="button" data-set-lang="zh" aria-pressed="${zhOn}">中文</button>
    <button type="button" data-set-lang="en" aria-pressed="${enOn}">EN</button>
  </div>
  <div class="group" role="group" aria-label="Theme">
    <button type="button" data-set-theme="light" aria-pressed="${lightOn}"><span data-zh="白天" data-en="Light">${lang === "en" ? "Light" : "白天"}</span></button>
    <button type="button" data-set-theme="dark" aria-pressed="${darkOn}"><span data-zh="黑夜" data-en="Dark">${lang === "en" ? "Dark" : "黑夜"}</span></button>
  </div>
</div>`;
}

function boot_script(): string {
  return `<script>
(function(){
  try {
    var prefix = document.documentElement.getAttribute('data-store') || 'codexqa-report';
    var t = localStorage.getItem(prefix + '-theme');
    var l = localStorage.getItem(prefix + '-lang');
    if (t === 'day') t = 'light';
    if (t === 'night') t = 'dark';
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    if (l === 'en' || l === 'zh') {
      document.documentElement.setAttribute('data-lang', l);
      document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    }
  } catch (e) {}
})();
</script>`;
}

export function render_html_report(markdown: string, opts: HtmlReportOpts = {}): string {
  const lang = opts.lang === "zh" ? "zh" : "en";
  const store = opts.store || "rca-report";
  const { en, zh } = split_bilingual(markdown);
  const enDoc = en || String(markdown || "");
  const zhDoc = zh;
  const enSections = extract_sections(enDoc, EN_HEADINGS);
  const zhSections = zhDoc ? extract_sections(zhDoc, ZH_HEADINGS) : [];
  const zhByIndex = new Map(zhSections.map((s, i) => [i, s.body]));
  const title = HEADING_PAIRS[0];
  const summaryEn = enSections.find((s) => s.heading === "## Executive summary")?.body || "";
  const summaryZh = zhSections.find((s) => s.heading === "## 摘要")?.body || "";
  const product = opts.product || (opts.preview ? "inventory-service" : "");
  const badge = confidence_badge(summaryEn || summaryZh, lang);
  const subEn = opts.preview ? `${product} · \`NullPointerException\` on refund` : product;
  const subZh = opts.preview ? `${product} · \`NullPointerException\` 退款路径` : product;

  const panels = HEADING_PAIRS.slice(1).map((pair, i) => {
    const enBody = enSections[i]?.body || "";
    const zhBody = zhByIndex.get(i) || "";
    return `  <section class="panel">
    <div class="panel-head"><h2>${bi_label(pair.zhLabel, pair.enLabel, lang === "en" ? pair.enLabel : pair.zhLabel)}</h2></div>
    ${dual_block(enBody, zhBody)}
  </section>`;
  }).join("\n");

  const footerEn = opts.preview
    ? "Native delivery is Markdown; this HTML is the README screenshot surface."
    : "codexqa-rootcause-analyzer";
  const footerZh = opts.preview
    ? "技能交付物是 Markdown；本 HTML 仅作 README 截图页。"
    : "codexqa-rootcause-analyzer";

  const dir = chrome_dir();
  const css = readFileSync(join(dir, "report-chrome.css"), "utf8");
  const js = readFileSync(join(dir, "report-chrome.js"), "utf8");
  const shownTitle = lang === "en" ? title.enLabel : title.zhLabel;
  const htmlLang = lang === "en" ? "en" : "zh-CN";

  return `<!DOCTYPE html>
<html lang="${htmlLang}" data-theme="light" data-lang="${lang}" data-store="${escape_html(store)}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title data-zh="${escape_html(title.zhLabel)}" data-en="${escape_html(title.enLabel)}">${escape_html(shownTitle)}</title>
${boot_script()}
<style>
${css}
</style>
</head>
<body>
${prefs_html(lang)}
<div class="wrap">
  <header class="hero">
    <p class="kicker">codexqa-rootcause-analyzer · RCA</p>
    <h1>${bi_label(title.zhLabel, title.enLabel, shownTitle)}</h1>
    <p class="sub">${dual_inline(subZh, subEn, lang)}${badge ? " · " + badge : ""}</p>
  </header>
${panels}
  <p class="footer">${bi_label(footerZh, footerEn, lang === "en" ? footerEn : footerZh)}</p>
</div>
<script>
${js}
</script>
</body>
</html>
`;
}

function inline_md_fragment(text: string): string {
  return escape_html(String(text || "").trim()).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function dual_inline(zh: string, en: string, _lang: "en" | "zh"): string {
  const z = String(zh || "").trim();
  const e = String(en || "").trim();
  if (z && e && z !== e) {
    return `<span class="unit-en">${inline_md_fragment(e)}</span><span class="unit-zh">${inline_md_fragment(z)}</span>`;
  }
  return inline_md_fragment(e || z);
}

export function render_preview_html(): string {
  return render_html_report(PREVIEW_REPORT_MD, {
    lang: "en",
    store: "rca-report",
    preview: true,
    product: "inventory-service",
  });
}
