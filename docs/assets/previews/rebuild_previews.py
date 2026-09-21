#!/usr/bin/env python3
"""Rebuild README preview HTML with the shared testcase-generator chrome."""
from pathlib import Path
import os
import subprocess
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
    zh_on = "true" if lang == "zh" else "false"
    en_on = "true" if lang == "en" else "false"
    prefs = f"""<div class="prefs" role="toolbar" aria-label="Language and theme">
  <div class="group" role="group" aria-label="Language">
    <button type="button" data-set-lang="zh" aria-pressed="{zh_on}">中文</button>
    <button type="button" data-set-lang="en" aria-pressed="{en_on}">EN</button>
  </div>
  <div class="group" role="group" aria-label="Theme">
    <button type="button" data-set-theme="light" aria-pressed="true"><span data-zh="白天" data-en="Light">{"Light" if lang == "en" else "白天"}</span></button>
    <button type="button" data-set-theme="dark" aria-pressed="false"><span data-zh="黑夜" data-en="Dark">{"Dark" if lang == "en" else "黑夜"}</span></button>
  </div>
</div>"""
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
{prefs}
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
    <p class="kicker"><span data-zh="codexqa-code-analyzer · 变更影响图" data-en="codexqa-code-analyzer · change-impact graph">codexqa-code-analyzer · 变更影响图</span></p>
    <h1><span data-zh="结账：谁调用了这次变更、哪些入口会打到、哪些测试没罩住" data-en="Checkout: who calls the change, which entries fire, which tests miss it">结账：谁调用了这次变更、哪些入口会打到、哪些测试没罩住</span></h1>
    <p class="sub"><span class="badge type" data-zh="符号图" data-en="symbol graph">符号图</span> <span data-zh="入口 → 影响面 → 变更符号 → 图上的测试边" data-en="Entry → impact → changed symbols → graph-backed tests">入口 → 影响面 → 变更符号 → 图上的测试边</span></p>
  </header>
  <section class="panel">
    <div class="panel-head"><h2 data-zh="变更影响图" data-en="Change-impact graph">变更影响图</h2></div>
    <div class="figure-frame">
      <img src="checkout-change-impact.svg" alt="结账变更影响图" data-zh-alt="结账变更影响图" data-en-alt="Checkout change-impact graph">
    </div>
  </section>
  <p class="footer"><span data-zh="codexqa-code-analyzer · 插图来自已发布的 SVG" data-en="codexqa-code-analyzer · illustration from the published SVG">codexqa-code-analyzer · 插图来自已发布的 SVG</span></p>
"""
    (PREVIEWS / "code-analyzer.html").write_text(
        page("analyzer-report", "变更影响图", "codexqa-code-analyzer · checkout change impact", body),
        encoding="utf-8")
    print("code-analyzer.html")


def write_rootcause():
    skill = ROOT / "skills" / "codexqa-rootcause-analyzer"
    dest = PREVIEWS / "rootcause.html"
    env = os.environ.copy()
    env["NODE_OPTIONS"] = (env.get("NODE_OPTIONS") or "") + " --experimental-strip-types"
    subprocess.check_call(
        ["node", str(skill / "scripts" / "render_html.ts"), "--preview", str(dest)],
        cwd=str(skill),
        env=env,
    )
    print("rootcause.html")


def write_ra():
    body = """
  <header class="hero">
    <p class="kicker"><span data-zh="codexqa-requirement-analyzer · 缺口登记表" data-en="codexqa-requirement-analyzer · gap register">codexqa-requirement-analyzer · 缺口登记表</span></p>
    <h1><span data-zh="库存预占 v2 — 一张登记表，不是三份清单" data-en="Inventory hold v2 — one register, not three lists">库存预占 v2 — 一张登记表，不是三份清单</span></h1>
    <p class="sub"><span data-zh="PRD §3 预占规则" data-en="PRD §3 hold rules">PRD §3 预占规则</span> · API note <code>POST /v1/holds</code> · <span data-zh="无 SLA" data-en="no SLA">无 SLA</span></p>
    <div class="stats">
      <div class="card">
        <h2 data-zh="按风险" data-en="By risk">按风险</h2>
        <div class="chip-row">
          <div class="stat-chip p0"><span class="n">2</span><span class="l">P0</span></div>
          <div class="stat-chip p1"><span class="n">1</span><span class="l">P1</span></div>
        </div>
      </div>
      <div class="card">
        <h2 data-zh="类型" data-en="Kind">类型</h2>
        <div class="chip-row">
          <div class="stat-chip"><span class="n">1</span><span class="l" data-zh="冲突" data-en="Conflict">冲突</span></div>
          <div class="stat-chip"><span class="n">2</span><span class="l" data-zh="缺口" data-en="Gap">缺口</span></div>
        </div>
      </div>
    </div>
  </header>
  <section class="panel">
    <div class="panel-head"><h2 data-zh="缺口登记表" data-en="Gap register">缺口登记表</h2></div>
    <table class="steps">
      <thead><tr>
        <th>ID</th>
        <th data-zh="类型" data-en="Kind">类型</th>
        <th data-zh="风险" data-en="Risk">风险</th>
        <th data-zh="缺失或冲突点" data-en="What is missing or in conflict">缺失或冲突点</th>
        <th data-zh="P0 / P1 核验" data-en="P0 / P1 check">P0 / P1 核验</th>
      </tr></thead>
      <tbody>
        <tr><td><code>RA-01</code></td><td><span data-zh="冲突" data-en="Conflict">冲突</span></td><td><span class="badge pri p0">P0</span></td>
          <td data-zh="PRD 写预占 15 分钟后过期；接口说明写直到客户端主动释放。" data-en="PRD says a hold expires after 15 minutes. The API note says until the client releases it.">PRD 写预占 15 分钟后过期；接口说明写直到客户端主动释放。</td>
          <td data-zh="创建一笔预占，等 16 分钟后查询。若两份材料仍不一致则判失败。" data-en="Create a hold, wait 16 minutes, call get. Fail if the two sources still disagree.">创建一笔预占，等 16 分钟后查询。若两份材料仍不一致则判失败。</td></tr>
        <tr><td><code>RA-02</code></td><td><span data-zh="缺口" data-en="Gap">缺口</span></td><td><span class="badge pri p0">P0</span></td>
          <td data-zh="最后一件库存被两笔预占并发抢占时如何避免超卖，没有写清。" data-en="Over-sell when two holds race on the last unit is not specified.">最后一件库存被两笔预占并发抢占时如何避免超卖，没有写清。</td>
          <td>
            <span class="unit-zh">available=1 时并发两个 <code>quantity=1</code> 请求。期望一个 200、一个 409。</span>
            <span class="unit-en">Two concurrent <code>quantity=1</code> requests when available=1. Expect one 200 and one 409.</span>
          </td></tr>
        <tr><td><code>RA-03</code></td><td><span data-zh="缺口" data-en="Gap">缺口</span></td><td><span class="badge pri p1">P1</span></td>
          <td data-zh="预占转订单没有成功指标。" data-en="No success metric for hold conversion to order.">预占转订单没有成功指标。</td>
          <td>
            <span class="unit-zh">在产品给出指标前标为 <code>untestable</code>。</span>
            <span class="unit-en">Marked <code>untestable</code> until product names the metric.</span>
          </td></tr>
      </tbody>
    </table>
  </section>
  <p class="footer"><span data-zh="codexqa-requirement-analyzer · 样例登记表" data-en="codexqa-requirement-analyzer · sample register">codexqa-requirement-analyzer · 样例登记表</span></p>
"""
    (PREVIEWS / "ra-register.html").write_text(
        page("ra-report", "需求缺口登记表", "Sample requirements gap register", body),
        encoding="utf-8")
    print("ra-register.html")


def write_testdata():
    body = """
  <header class="hero">
    <p class="kicker"><span data-zh="codexqa-testdata-generator · 回写" data-en="codexqa-testdata-generator · write-back">codexqa-testdata-generator · write-back</span></p>
    <h1><span data-zh="占位符已替换为后端返回的 ID" data-en="Placeholders filled with IDs the backend returned">Placeholders filled with IDs the backend returned</span></h1>
    <p class="sub"><span class="badge type">case-executable.md</span> · <span data-zh="mock 目录" data-en="mock catalog">mock catalog</span></p>
  </header>
  <section class="panel">
    <div class="panel-head"><h2 data-zh="回写前（来自 codexqa-testcase-generator）" data-en="Before (from codexqa-testcase-generator)">Before (from codexqa-testcase-generator)</h2></div>
    <table class="steps">
      <thead><tr>
        <th data-zh="实体" data-en="Entity">Entity</th>
        <th data-zh="内容" data-en="Content">Content</th>
        <th data-zh="构造" data-en="Construction">Construction</th>
      </tr></thead>
      <tbody><tr>
        <td data-zh="目录商品" data-en="Catalog product">Catalog product</td>
        <td><code>productId</code>: {placeholder}</td>
        <td><em data-zh="（空）" data-en="(empty)">(empty)</em></td>
      </tr></tbody>
    </table>
  </section>
  <section class="panel">
    <div class="panel-head"><h2 data-zh="回写后（后端已创建记录）" data-en="After (backend created the row)">After (backend created the row)</h2></div>
    <table class="steps">
      <thead><tr>
        <th data-zh="实体" data-en="Entity">Entity</th>
        <th data-zh="内容" data-en="Content">Content</th>
        <th data-zh="构造" data-en="Construction">Construction</th>
      </tr></thead>
      <tbody><tr>
        <td data-zh="目录商品" data-en="Catalog product">Catalog product</td>
        <td><code>productId</code>: <span class="was">{placeholder}</span> <span class="now">prd_8f21</span></td>
        <td>
          <span class="unit-zh">通过 <code>POST /v1/catalog/products</code> 创建；id 取自 <code>data.id</code></span>
          <span class="unit-en">Created via <code>POST /v1/catalog/products</code>; id from <code>data.id</code></span>
        </td>
      </tr></tbody>
    </table>
  </section>
  <p class="footer"><span data-zh="codexqa-testdata-generator · 回写样例" data-en="codexqa-testdata-generator · sample write-back">codexqa-testdata-generator · sample write-back</span></p>
"""
    html = page("tdg-report", "测试数据回写", "Sample testdata write-back", body, lang="en")
    pairs = html.count("data-zh=")
    if pairs < 12 or 'data-zh="占位符已替换为后端返回的 ID"' not in html:
        raise SystemExit(f"testdata-writeback i18n incomplete: {pairs} data-zh attrs")
    (PREVIEWS / "testdata-writeback.html").write_text(html, encoding="utf-8")
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
