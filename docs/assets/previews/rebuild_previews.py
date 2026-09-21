#!/usr/bin/env python3
"""Rebuild README preview HTML with the shared testcase-generator chrome."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
PREVIEWS = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "skills" / "codexqa-defect-analyzer" / "scripts"))
from merge_report import render_html_report  # noqa: E402

CSS = (ROOT / "docs" / "assets" / "report-chrome.css").read_text(encoding="utf-8")
JS = (ROOT / "docs" / "assets" / "report-chrome.js").read_text(encoding="utf-8")

BOOT = """<script>
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
</script>"""

PREFS = """<div class="prefs" role="toolbar" aria-label="Language and theme">
  <div class="group" role="group" aria-label="Language">
    <button type="button" data-set-lang="zh" aria-pressed="true">中文</button>
    <button type="button" data-set-lang="en" aria-pressed="false">EN</button>
  </div>
  <div class="group" role="group" aria-label="Theme">
    <button type="button" data-set-theme="light" aria-pressed="true"><span data-zh="白天" data-en="Light">白天</span></button>
    <button type="button" data-set-theme="dark" aria-pressed="false"><span data-zh="黑夜" data-en="Dark">黑夜</span></button>
  </div>
</div>"""


def page(store, title_zh, title_en, body, lang="zh"):
    html_lang = "en" if lang == "en" else "zh-CN"
    shown = title_zh if lang == "zh" else title_en
    return f"""<!DOCTYPE html>
<html lang="{html_lang}" data-theme="light" data-lang="{lang}" data-store="{store}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title data-zh="{title_zh}" data-en="{title_en}">{shown}</title>
{BOOT}
<style>
{CSS}
</style>
</head>
<body>
{PREFS}
<div class="wrap">
{body}
</div>
<script>
{JS}
</script>
</body>
</html>
"""


def write_defect():
    findings = [
        {"id": "fr-20260921-002", "severity": "P0", "file": "src/inventory.js", "line": 49, "source": "llm_judged",
         "rule_id": "CONC-001", "confidence": 0.87, "category": "concurrency",
         "title": "holdStock is check-then-act; two last-unit holds can both succeed",
         "evidence": "readStock to available then putStock with no lock. Two concurrent quantity=1 holds when available=1 both pass the check.",
         "suggestion": "Make the availability check and reserved increment one atomic update under withLock."},
        {"id": "fr-20260921-004", "severity": "P0", "file": "src/refund.js", "line": 27, "source": "llm_judged",
         "rule_id": "LOGIC-002", "confidence": 0.93, "category": "logic",
         "title": "resolveRefundAmount ignores remaining balance and can over-refund",
         "evidence": "remaining is computed then unused. When requested is set, the function returns roundMoney(requested) with no min(requested, remaining).",
         "suggestion": "return min(amount, remaining) after the <=0 guard; never exceed remaining."},
        {"id": "fr-20260921-005", "severity": "P0", "file": "src/refund.js", "line": 72, "source": "llm_judged",
         "rule_id": "LOGIC-003", "confidence": 0.91, "category": "logic",
         "title": "Gateway refund failure fabricates a local receipt and still settles",
         "evidence": "catch of gateway.refund writes a localOnly receipt and continues. Callers see a settled refund while the provider did not capture it.",
         "suggestion": "Return { ok: false } on gateway failure; do not invent a receipt or increment refundedTotal."},
        {"id": "fr-20260921-007", "severity": "P0", "file": "src/reservation.js", "line": 166, "source": "llm_judged",
         "rule_id": "LOGIC-001", "confidence": 0.89, "category": "logic",
         "title": "Expiry sweep frees reserved units without invalidating availability cache",
         "evidence": "expireStaleReservations adjusts reserved then saves EXPIRED, but never availabilityCache.invalidate.",
         "suggestion": "Invalidate the same cache key holdStock / releaseStock already invalidate after adjustReserved."},
        {"id": "fr-20260921-001", "severity": "P1", "file": "src/db.js", "line": 191, "source": "llm_judged",
         "rule_id": "RES-001", "confidence": 0.88, "category": "resource_leak",
         "title": "withLock releases the lock after await fn() with no finally",
         "evidence": "If fn() throws, releaseLock never runs and the key stays held.",
         "suggestion": "Wrap fn() in try/finally and always releaseLock(key)."},
        {"id": "fr-20260921-003", "severity": "P1", "file": "src/pricing.js", "line": 33, "source": "llm_judged",
         "rule_id": "LOGIC-004", "confidence": 0.95, "category": "logic",
         "title": "Volume tiers use exclusive > so exactly 10 units miss the 5% discount",
         "evidence": "volumeDiscountRate uses units > 50 and units > 10. Spec is inclusive lower bounds.",
         "suggestion": "Use units >= VOLUME_TIER_LARGE and units >= VOLUME_TIER_SMALL."},
        {"id": "fr-20260921-006", "severity": "P1", "file": "src/reservation.js", "line": 95, "source": "llm_judged",
         "rule_id": "LOGIC-005", "confidence": 0.83, "category": "logic",
         "title": "commitReservation never sets status COMMITTED so the hold stays replayable",
         "evidence": "committedAt is written but status stays HELD. A second commit can pass the NOT_HELD guard.",
         "suggestion": "Set reservation.status = COMMITTED before saveReservation returns."},
    ]
    report = {
        "scan_type": "incremental",
        "target": "inventory-service@reservation-v2",
        "generated_at": "2026-09-21T14:34:12.651036",
        "findings": findings,
        "summary": {
            "total": 7,
            "findings": {"P0": 4, "P1": 3, "P2": 0, "P3": 0},
            "files_scanned": 6,
            "coverage": {
                "deterministic_share": 0.0,
                "llm_share": 100.0,
                "by_source": {"sast_confirmed": 0, "sast_only": 0, "llm_judged": 7},
                "by_rule_id": {
                    "CONC-001": 1, "LOGIC-002": 1, "LOGIC-003": 1, "LOGIC-001": 1,
                    "RES-001": 1, "LOGIC-004": 1, "LOGIC-005": 1,
                },
            },
        },
        "policy_pack": {"pack_id": "codexqa-defect-analyzer-default", "version": "1.1.0", "rule_count_active": 27},
        "tooling_status": {"degraded": False, "ready": ["semgrep", "gitleaks", "bandit", "ruff", "eslint", "osv-api"]},
    }
    (PREVIEWS / "defect-report.html").write_text(render_html_report(report), encoding="utf-8")
    print("defect-report.html")


def write_wiki():
    body = """
  <header class="hero">
    <p class="kicker">codexqa-code-wiki · architecture wiki</p>
    <h1><span data-zh="架构知识图谱" data-en="Architecture wiki">架构知识图谱</span>
      <span class="total-pill">6 <span class="unit-zh">个模块</span><span class="unit-en"> modules</span></span>
    </h1>
    <p class="sub">inventory-service</p>
    <div class="meta-row">
      <span>wiki inputs <code>examples/inventory-service --kind architecture --limit 8</code></span>
    </div>
    <div class="stats">
      <div class="card">
        <h2 data-zh="规模" data-en="Scale">规模</h2>
        <div class="chip-row">
          <div class="stat-chip"><span class="n">6</span><span class="l">communities</span></div>
          <div class="stat-chip p1"><span class="n">2</span><span class="l">standalone</span></div>
          <div class="stat-chip web"><span class="n">7</span><span class="l">dep edges</span></div>
        </div>
      </div>
      <div class="card">
        <h2 data-zh="怎么读" data-en="How to read">怎么读</h2>
        <p class="muted" style="margin:0">先看关键发现抓住枢纽，再按入口到存储往下读。</p>
      </div>
    </div>
  </header>
  <section class="panel">
    <div class="panel-head">
      <h2 data-zh="关键发现" data-en="Key findings">关键发现</h2>
    </div>
    <article class="case open">
      <div class="case-head"><span class="badge pri p0">p03</span><h3>p03 库存占用是枢纽：hold / expire / commit 都经过它</h3></div>
      <div class="case-body"><div class="block"><p>改这里影响面最宽，先读对外接口再碰退款。</p></div></div>
    </article>
    <article class="case open">
      <div class="case-head"><span class="badge type">path</span><h3>HTTP 入口 → 预订编排 → 库存占用 → db/cache</h3></div>
      <div class="case-body"><div class="block"><p>相邻步都有真实依赖。</p></div></div>
    </article>
    <article class="case open">
      <div class="case-head"><span class="badge pri p1">p05</span><h3>p05 退款封顶依赖 p03 的提交状态</h3></div>
      <div class="case-body"><div class="block"><p>提交没写 COMMITTED 时，退款会打到空订单。</p></div></div>
    </article>
  </section>
  <p class="footer">codexqa-code-wiki · assets/report-template.html</p>
"""
    (PREVIEWS / "code-wiki.html").write_text(
        page("wiki-report", "inventory-service — 架构知识图谱", "inventory-service — architecture wiki", body),
        encoding="utf-8")
    print("code-wiki.html")


def write_analyzer():
    body = """
  <header class="hero">
    <p class="kicker">codexqa-code-analyzer · change-impact graph</p>
    <h1>Checkout: who calls the change, which entries fire, which tests miss it</h1>
    <p class="sub"><span class="badge type">symbol graph</span> Entry → impact → changed symbols → graph-backed tests</p>
  </header>
  <section class="panel">
    <div class="panel-head"><h2>Change-impact graph</h2></div>
    <div class="figure-frame">
      <img src="checkout-change-impact.svg" alt="Checkout change-impact graph">
    </div>
  </section>
  <p class="footer">codexqa-code-analyzer · illustration from the published SVG</p>
"""
    (PREVIEWS / "code-analyzer.html").write_text(
        page("analyzer-report", "变更影响图", "codexqa-code-analyzer · checkout change impact", body, lang="en"),
        encoding="utf-8")
    print("code-analyzer.html")


def write_rootcause():
    body = """
  <header class="hero">
    <p class="kicker">codexqa-rootcause-analyzer · RCA</p>
    <h1>Exception diagnosis</h1>
    <p class="sub">inventory-service · <code>NullPointerException</code> on refund · <span class="badge pri p1">Confidence: medium</span></p>
  </header>
  <section class="panel">
    <div class="panel-head"><h2>Executive summary</h2></div>
    <div class="block"><p><code>NullPointerException</code> on <code>refund.js#resolveRefundAmount</code>. Root is <code>reservation.js#commitReservation</code> leaving status unset.</p></div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Mapped call path</h2></div>
    <div class="block"><p><code>POST /refunds → refund.js#refundOrder:44 → refund.js#resolveRefundAmount:18 → NPE</code></p></div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Root cause</h2></div>
    <div class="block"><p>Throw is the trigger, not the root. <code>commitReservation</code> returns success without writing <code>COMMITTED</code>.</p></div>
  </section>
  <p class="footer">Native delivery is Markdown; this HTML is the README screenshot surface.</p>
"""
    (PREVIEWS / "rootcause.html").write_text(
        page("rca-report", "异常诊断", "Exception diagnosis", body, lang="en"),
        encoding="utf-8")
    print("rootcause.html")


def write_ra():
    body = """
  <header class="hero">
    <p class="kicker">codexqa-requirement-analyzer · gap register</p>
    <h1>Inventory hold v2 — one register, not three lists</h1>
    <p class="sub">PRD §3 hold rules · API note <code>POST /v1/holds</code> · no SLA</p>
    <div class="stats">
      <div class="card">
        <h2>By risk</h2>
        <div class="chip-row">
          <div class="stat-chip p0"><span class="n">2</span><span class="l">P0</span></div>
          <div class="stat-chip p1"><span class="n">1</span><span class="l">P1</span></div>
        </div>
      </div>
      <div class="card">
        <h2>Kind</h2>
        <div class="chip-row">
          <div class="stat-chip"><span class="n">1</span><span class="l">Conflict</span></div>
          <div class="stat-chip"><span class="n">2</span><span class="l">Gap</span></div>
        </div>
      </div>
    </div>
  </header>
  <section class="panel">
    <div class="panel-head"><h2>Gap register</h2></div>
    <table class="steps">
      <thead><tr><th>ID</th><th>Kind</th><th>Risk</th><th>What is missing or in conflict</th><th>P0 / P1 check</th></tr></thead>
      <tbody>
        <tr><td><code>RA-01</code></td><td>Conflict</td><td><span class="badge pri p0">P0</span></td>
          <td>PRD says a hold expires after 15 minutes. The API note says until the client releases it.</td>
          <td>Create a hold, wait 16 minutes, call get. Fail if the two sources still disagree.</td></tr>
        <tr><td><code>RA-02</code></td><td>Gap</td><td><span class="badge pri p0">P0</span></td>
          <td>Over-sell when two holds race on the last unit is not specified.</td>
          <td>Two concurrent <code>quantity=1</code> requests when available=1. Expect one 200 and one 409.</td></tr>
        <tr><td><code>RA-03</code></td><td>Gap</td><td><span class="badge pri p1">P1</span></td>
          <td>No success metric for hold conversion to order.</td>
          <td>Marked <code>untestable</code> until product names the metric.</td></tr>
      </tbody>
    </table>
  </section>
  <p class="footer">codexqa-requirement-analyzer · sample register</p>
"""
    (PREVIEWS / "ra-register.html").write_text(
        page("ra-report", "需求缺口登记表", "Sample requirements gap register", body, lang="en"),
        encoding="utf-8")
    print("ra-register.html")


def write_testdata():
    body = """
  <header class="hero">
    <p class="kicker">codexqa-testdata-generator · write-back</p>
    <h1>Placeholders filled with IDs the backend returned</h1>
    <p class="sub"><span class="badge type">case-executable.md</span> · mock catalog</p>
  </header>
  <section class="panel">
    <div class="panel-head"><h2>Before (from codexqa-testcase-generator)</h2></div>
    <table class="steps">
      <thead><tr><th>Entity</th><th>Content</th><th>Construction</th></tr></thead>
      <tbody><tr><td>Catalog product</td><td><code>productId</code>: {placeholder}</td><td><em>(empty)</em></td></tr></tbody>
    </table>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>After (backend created the row)</h2></div>
    <table class="steps">
      <thead><tr><th>Entity</th><th>Content</th><th>Construction</th></tr></thead>
      <tbody><tr>
        <td>Catalog product</td>
        <td><code>productId</code>: <span class="was">{placeholder}</span> <span class="now">prd_8f21</span></td>
        <td>Created via <code>POST /v1/catalog/products</code>; id from <code>data.id</code></td>
      </tr></tbody>
    </table>
  </section>
  <p class="footer">codexqa-testdata-generator · sample write-back</p>
"""
    (PREVIEWS / "testdata-writeback.html").write_text(
        page("tdg-report", "测试数据回写", "Sample testdata write-back", body, lang="en"),
        encoding="utf-8")
    print("testdata-writeback.html")


def write_testcase_sample():
    body = """
  <header class="hero">
    <p class="kicker">codexqa-testcase-generator · V56 sample · server</p>
    <h1>inventory-hold · local Markdown case</h1>
    <p class="sub">Dual-write target: <code>testcase/initialcase/</code> + <code>cases/</code></p>
  </header>
  <section class="panel">
    <div class="panel-head"><h2>Case details</h2></div>
    <table class="steps">
      <thead><tr><th>Case ID</th><th>Name</th><th>Priority</th><th>Expected</th></tr></thead>
      <tbody>
        <tr>
          <td><code>run042-…042</code></td>
          <td>Submit hold succeeds when stock is reserved</td>
          <td><span class="badge pri p0">P0</span></td>
          <td>code=0 · holdId H1 · available_stock = 9</td>
        </tr>
        <tr>
          <td><code>run042-…087</code></td>
          <td>Submit hold fails when quantity exceeds available</td>
          <td><span class="badge pri p1">P1</span></td>
          <td>code=4001 · no new hold · stock stays 9</td>
        </tr>
      </tbody>
    </table>
  </section>
  <p class="footer">Illustration only — Stage 6 server template shape.</p>
"""
    (PREVIEWS / "testcase-sample.html").write_text(
        page("tcg-sample", "服务端用例样例", "Sample generated case (V56 server)", body, lang="en"),
        encoding="utf-8")
    print("testcase-sample.html")


if __name__ == "__main__":
    write_defect()
    write_wiki()
    write_analyzer()
    write_rootcause()
    write_ra()
    write_testdata()
    write_testcase_sample()
