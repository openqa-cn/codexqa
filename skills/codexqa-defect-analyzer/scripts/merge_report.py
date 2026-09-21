#!/usr/bin/env python3
"""Merge deterministic + Agent LLM dimensions; dedupe; validate; emit report.

Dimensions:
  - deterministic — SAST / lint / secrets / SCA (`sast_only`)
  - agent_llm     — host-agent embedded model Stage1/Stage2 (`llm_judged`)
  - both          — same-locus compatible merge (`sast_confirmed`)
"""
import argparse, datetime, html, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (VALID_SOURCES, append_sast_evidence, filter_valid_findings,
                 findings_merge_compatible, findings_same_bucket, generate_finding_id,
                 load_config, normalize_finding)
from html_chrome import boot_script, chrome_css, chrome_js, prefs_html

SEV_ICON = {'P0': '[P0]', 'P1': '[P1]', 'P2': '[P2]', 'P3': '[P3]'}
SEV_RANK = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}
_DISMISS_VERDICTS = frozenset({
    'dismiss', 'dismissed', 'ignore', 'false_positive', 'false-positive', 'fp', 'wontfix',
})


def key(f, window=3):
    return (f['file'], f['line'] // max(1, window))  # proximity bucket helper unused; use abs


def _norm_path(p):
    return (p or '').replace('\\', '/').lstrip('./')


def is_llm_dismissal(f):
    """True when an LLM finding is an explicit false-positive / dismiss marker."""
    if not isinstance(f, dict):
        return False
    if f.get('dismissed') is True:
        return True
    v = str(f.get('verdict') or f.get('action') or '').strip().lower().replace(' ', '_')
    return v in _DISMISS_VERDICTS


def collect_dismissals(llm_payload, findings=None):
    """Normalize dismissals from llm_final/stage2 JSON + dismissed finding rows."""
    out = []
    findings = list(findings or [])
    if isinstance(llm_payload, dict):
        for d in llm_payload.get('dismissals') or []:
            if isinstance(d, dict) and d.get('file') is not None:
                out.append({
                    'file': d.get('file') or '',
                    'line': int(d.get('line') or 0),
                    'reason': (d.get('reason') or d.get('evidence') or '')[:400],
                })
        findings = findings or list(llm_payload.get('findings') or [])
    for f in findings:
        if is_llm_dismissal(f):
            try:
                line = int(f.get('line') or 0)
            except (TypeError, ValueError):
                line = 0
            out.append({
                'file': f.get('file') or '',
                'line': line,
                'reason': (f.get('evidence') or f.get('title') or 'dismissed by Stage2')[:400],
            })
    return out


def _matches_dismissal(sast_f, dismissal, line_window=3):
    if _norm_path(sast_f.get('file')) != _norm_path(dismissal.get('file')):
        return False
    try:
        sl = int(sast_f.get('line') or 0)
        dl = int(dismissal.get('line') or 0)
    except (TypeError, ValueError):
        return False
    return abs(sl - dl) <= max(1, line_window)


def _resolve_merged_severity(sast_f, llm_f):
    """Clear SAST: keep stricter severity. Ambiguous SAST: Stage2/LLM grade wins."""
    ls = llm_f.get('severity') or sast_f.get('severity') or 'P2'
    ss = sast_f.get('severity') or 'P2'
    if sast_f.get('ambiguous'):
        return ls if ls in SEV_RANK else ss
    # clear deterministic — never let LLM demote below SAST severity
    if SEV_RANK.get(ss, 9) <= SEV_RANK.get(ls, 9):
        return ss
    return ls


def stamp_dimension(f):
    """Annotate cross-dimension provenance for report consumers."""
    f = dict(f)
    src = f.get('source') or 'llm_judged'
    if src == 'sast_confirmed':
        f['dimension'] = 'deterministic+agent_llm'
    elif src == 'sast_only':
        f['dimension'] = 'deterministic'
    else:
        f['dimension'] = 'agent_llm'
    return f


def merge_sast_llm(sast, llm, line_window=3, dismissals=None):
    """
    Cross-dimension merge + proximity dedupe:
      Deterministic hit + Agent LLM confirm (same file, compatible class, line±window)
        → sast_confirmed (dimension deterministic+agent_llm)
      Deterministic only → sast_only (dimension deterministic)
      Agent LLM only → llm_judged (dimension agent_llm)

    Ambiguous SAST residue (ambiguous=True):
      - Matching LLM finding → severity follows LLM (Stage2 may demote)
      - Matching dismissal (dismissals[] or finding.dismissed/verdict) → omit from report
      - Clear SAST cannot be dismissed; dismissals for clear hits are ignored
    """
    dismissals = list(dismissals or [])
    # Pull dismiss markers out of the LLM finding list so they are not emitted as defects
    llm_keep = []
    for f in llm or []:
        if is_llm_dismissal(f):
            dismissals.append({
                'file': f.get('file') or '',
                'line': int(f.get('line') or 0),
                'reason': (f.get('evidence') or f.get('title') or '')[:400],
            })
        else:
            llm_keep.append(f)

    sast = [normalize_finding(f, 'sast_only') for f in sast]
    llm = [normalize_finding(f, 'llm_judged') for f in llm_keep]
    used_llm = set()
    out = []

    for s in sast:
        # Ambiguous residue explicitly dismissed by Stage2 → drop (clear SAST stays)
        if s.get('ambiguous') and any(_matches_dismissal(s, d, line_window) for d in dismissals):
            continue

        match_idx = None
        for i, l in enumerate(llm):
            if i in used_llm:
                continue
            if findings_merge_compatible(s, l, line_window=line_window):
                match_idx = i
                break
        if match_idx is not None:
            l = llm[match_idx]
            used_llm.add(match_idx)
            merged = dict(l)
            merged['source'] = 'sast_confirmed'
            merged['confidence'] = max(float(s.get('confidence', 0.5)), float(l.get('confidence', 0.5)))
            merged['severity'] = _resolve_merged_severity(s, l)
            if s.get('ambiguous'):
                merged['ambiguous'] = True
                merged['sast_graded_by_llm'] = True
            merged = append_sast_evidence(merged, s)
            if not (merged.get('suggestion') or '').strip():
                merged['suggestion'] = s.get('suggestion') or s.get('evidence') or ''
            out.append(normalize_finding(merged, 'sast_confirmed'))
        else:
            out.append(normalize_finding(dict(s, source='sast_only'), 'sast_only'))

    for i, l in enumerate(llm):
        if i not in used_llm:
            out.append(normalize_finding(dict(l, source='llm_judged'), 'llm_judged'))

    out.sort(key=lambda f: (f['file'], f['line']))
    deduped = []
    for f in out:
        if deduped and findings_same_bucket(deduped[-1], f, line_window=line_window):
            pref = {'sast_confirmed': 2, 'sast_only': 1, 'llm_judged': 0}
            a, b = deduped[-1], f
            best = a if pref.get(a['source'], 0) >= pref.get(b['source'], 0) else b
            if best is b:
                best = append_sast_evidence(dict(b), a)
            else:
                best = append_sast_evidence(dict(a), b)
            # Prefer LLM-graded severity when either side is ambiguous residue
            if a.get('ambiguous') or b.get('ambiguous') or a.get('sast_graded_by_llm') or b.get('sast_graded_by_llm'):
                graded = a if a.get('sast_graded_by_llm') else (b if b.get('sast_graded_by_llm') else None)
                if graded and graded.get('severity') in SEV_RANK:
                    best['severity'] = graded['severity']
            deduped[-1] = normalize_finding(best, best.get('source', 'llm_judged'))
        else:
            deduped.append(f)
    for f in deduped:
        if f.get('source') not in VALID_SOURCES:
            f['source'] = 'llm_judged'
    return [stamp_dimension(f) for f in deduped]

def render_md(report):
    L = ['# %s Scan Report' % report['scan_type'].capitalize(),
         '- target: `%s`' % report['target'],
         '- generated: %s' % report['generated_at'],
         '- primary_language: `%s` (confidence=%s)' % (
             report.get('primary_language')
             or (report.get('summary') or {}).get('primary_language')
             or 'unknown',
             report.get('language_confidence')
             or (report.get('summary') or {}).get('language_confidence')
             or 'unknown'),
         '- summary: %s\n' % json.dumps(report['summary'], ensure_ascii=False)]
    cov = (report.get('summary') or {}).get('coverage') or {}
    if cov:
        L.append('- deterministic-first coverage: det=%.1f%% llm=%.1f%% agent_dim=%.1f%% '
                 '(target det≥70%%) sources=%s dimensions=%s\n'
                 % (cov.get('deterministic_share', 0), cov.get('llm_share', 0),
                    cov.get('agent_llm_dimension_share', 0),
                    json.dumps(cov.get('by_source') or {}),
                    json.dumps(cov.get('by_dimension') or {})))
        if cov.get('by_rule_id'):
            L.append('- by_rule_id: %s\n' % json.dumps(cov['by_rule_id'], ensure_ascii=False))
    if report.get('policy_pack'):
        pp = report['policy_pack']
        L.append('- policy_pack: %s v%s (active_rules=%s)\n'
                 % (pp.get('pack_id'), pp.get('version'), pp.get('rule_count_active')))
    ts = report.get('tooling_status') or {}
    if ts:
        missing = ts.get('missing') or []
        L.append('- tooling_status: degraded=%s missing=%s ready=%s\n'
                 % (ts.get('degraded'), missing, ts.get('ready')))
        if missing:
            L.append('> WARNING: scanners missing/degraded: %s\n' % ', '.join(missing))
    if cov.get('code_metrics'):
        L.append('- code metrics: %s\n' % json.dumps(cov['code_metrics'], ensure_ascii=False))
    if report.get('delta'):
        L.append('- baseline delta: %s\n' % json.dumps(report['delta'], ensure_ascii=False))
    if report.get('module_summaries'):
        L.append('\n## Module risk summaries\n')
        for m in report['module_summaries']:
            L.append('### %s\n%s\n- deep_review: %s\n- architecture: %s\n' % (
                m.get('module'), m.get('summary', ''),
                ', '.join(m.get('deep_review_files', [])[:10]),
                '; '.join(m.get('architecture_concerns', [])[:5])))
    if report.get('heat_map'):
        L.append('\n## Heat map (top hot files)\n')
        for h in report['heat_map'][:30]:
            L.append('- `%-60s` hot=%.1f' % (h['path'], h['hot_score']))
        L.append('')
    for sev in report['config_severity_order']:
        group = [f for f in report['findings'] if f['severity'] == sev]
        if not group:
            continue
        L.append('\n## %s (%d)\n' % (SEV_ICON[sev], len(group)))
        for f in group:
            rid = f.get('rule_id') or '-'
            L.append('- **`%s:%d`** [%s/%s/rule=%s/conf=%.2f] `%s` **%s**  \n  evidence: %s  \n  fix: %s'
                     % (f['file'], f['line'], f['category'], f['source'], rid,
                        f.get('confidence', 0), f.get('id', ''), f['title'],
                        f['evidence'], f['suggestion']))
    if report.get('budget_note'):
        L.append('\n> WARNING: %s' % report['budget_note'])
    if report.get('validation_dropped'):
        L.append('\n> Dropped %d findings failing schema/file:line checks.'
                  % len(report['validation_dropped']))
    return '\n'.join(L) + '\n'


def _h(text):
    return html.escape(str(text)) if text is not None else ''


def _source_label(source):
    return {'sast_confirmed': 'SAST ✓', 'sast_only': 'SAST', 'llm_judged': 'LLM'}.get(source, source or '—')


def _source_class(source):
    return {'sast_confirmed': 'confirmed', 'sast_only': 'sast', 'llm_judged': 'llm'}.get(
        source or '', 'llm')


def _render_finding_card(finding, index):
    sev = (finding.get('severity') or 'P3')
    sev_l = sev.lower()
    conf = int(round(float(finding.get('confidence', 0)) * 100))
    rid = finding.get('rule_id') or '—'
    fid = finding.get('id') or '—'
    loc = '%s:%s' % (finding.get('file', '?'), finding.get('line', '?'))
    src = finding.get('source')
    body_id = 'finding-%d-body' % index
    return '''<article class="case" id="finding-%d" data-pri="%s">
  <header class="case-head" role="button" tabindex="0" aria-expanded="false" aria-controls="%s">
    <span class="badge pri %s">%s</span>
    <span class="badge source %s">%s</span>
    <span class="badge type">%s</span>
    <h3>%s</h3>
    <span class="meta-id">%s · %d%% · %s</span>
    <span class="chev" aria-hidden="true"></span>
  </header>
  <div class="case-body" id="%s">
    <dl class="kv">
      <div><dt data-zh="分类" data-en="Category">分类</dt><dd>%s</dd></div>
      <div><dt>ID</dt><dd><code>%s</code></dd></div>
      <div><dt data-zh="位置" data-en="Location">位置</dt><dd><code>%s</code></dd></div>
      <div><dt data-zh="置信度" data-en="Confidence">置信度</dt><dd>%d%%</dd></div>
    </dl>
    <h4 data-zh="证据" data-en="Evidence">证据</h4>
    <div class="block"><p>%s</p></div>
    <h4 data-zh="修复建议" data-en="Remediation">修复建议</h4>
    <div class="block"><p>%s</p></div>
  </div>
</article>''' % (
        index, _h(sev),
        body_id,
        sev_l, _h(sev),
        _source_class(src), _h(_source_label(src)),
        _h(rid),
        _h(finding.get('title', '')),
        _h(loc), conf, _h(fid),
        body_id,
        _h(finding.get('category', '')),
        _h(fid),
        _h(loc),
        conf,
        _h(finding.get('evidence', '')),
        _h(finding.get('suggestion', '')),
    )


def _render_toolbar(sev_counts, total):
    tabs = [
        '<button type="button" class="tab" data-sev="all" aria-selected="true">'
        '<span data-zh="全部" data-en="All">全部</span> (%d)</button>' % total
    ]
    for sev in ('P0', 'P1', 'P2', 'P3'):
        tabs.append(
            '<button type="button" class="tab" data-sev="%s" aria-selected="false">%s (%d)</button>'
            % (sev.lower(), sev, sev_counts.get(sev, 0))
        )
    return '''<div class="toolbar">
    <div class="tabs" role="tablist" aria-label="Severity">
      %s
    </div>
    <div class="filters">
      <button class="tab" type="button" id="expandAll"><span data-zh="展开全部" data-en="Expand all">展开全部</span></button>
      <button class="tab" type="button" id="collapseAll"><span data-zh="收起全部" data-en="Collapse all">收起全部</span></button>
    </div>
  </div>''' % '\n      '.join(tabs)


def _render_severity_section(sev, findings, start_index):
    if not findings:
        return '', start_index
    cards = []
    idx = start_index
    for f in findings:
        cards.append(_render_finding_card(f, idx))
        idx += 1
    return '''<section class="panel" id="sev-%s" data-sev-panel="%s">
  <div class="panel-head">
    <h2><span class="badge pri %s">%s</span> <span data-zh="发现项" data-en="Findings">发现项</span> <span class="count">%d</span></h2>
    <p class="desc" data-zh="点击卡片展开证据与修复建议" data-en="Click a card to expand evidence and remediation">点击卡片展开证据与修复建议</p>
  </div>
  <div class="case-list">
  %s
  </div>
</section>''' % (
        sev.lower(), sev.lower(), sev.lower(), _h(sev), len(findings), '\n'.join(cards),
    ), idx


def render_html_report(report):
    """Render a standalone HTML report using the testcase-generator chrome."""
    summary = report.get('summary') or {}
    sev_counts = summary.get('findings') or {
        k: summary.get(k, 0) for k in ('P0', 'P1', 'P2', 'P3')
    }
    cov = summary.get('coverage') or {}
    by_source = cov.get('by_source') or {}
    by_rule = cov.get('by_rule_id') or {}
    ts = report.get('tooling_status') or {}
    pp = report.get('policy_pack') or {}
    scan_type = report.get('scan_type', 'scan').capitalize()
    title = '%s Scan Report' % scan_type
    total = summary.get('total') or sum(sev_counts.get(k, 0) for k in ('P0', 'P1', 'P2', 'P3'))

    chips = ''.join(
        "<a class='stat-chip %s' href='#sev-%s'><span class='n'>%d</span><span class='l'>%s</span></a>"
        % (s.lower(), s.lower(), sev_counts.get(s, 0), s)
        for s in ('P0', 'P1', 'P2', 'P3'))

    max_rule = max(by_rule.values()) if by_rule else 1
    rule_rows = (
        "<div class='rule-grid'>" + ''.join(
            "<div class='bar-row'><span>%s</span><div class='bar'><i style='width:%.0f%%'></i></div><b>%d</b></div>"
            % (_h(rid), 100 * n / max_rule, n)
            for rid, n in sorted(by_rule.items(), key=lambda x: -x[1])[:8]
        ) + "</div>"
    ) if by_rule else "<p class='muted'>—</p>"

    source_rows = ''.join(
        "<div class='stat-chip'><span class='n'>%d</span><span class='l'>%s</span></div>"
        % (by_source.get(k, 0), _h(k.replace('_', ' ')))
        for k in ('sast_confirmed', 'sast_only', 'llm_judged')
    )

    severity_order = report.get('config_severity_order') or ['P0', 'P1', 'P2', 'P3']
    findings_html = []
    card_idx = 0
    for sev in severity_order:
        group = [f for f in report.get('findings') or [] if f.get('severity') == sev]
        section, card_idx = _render_severity_section(sev, group, card_idx)
        if section:
            findings_html.append(section)
    if not findings_html:
        findings_html.append(
            '<section class="panel"><div class="empty">'
            '<span data-zh="暂无发现项" data-en="No findings">暂无发现项</span></div></section>'
        )

    alerts = []
    if ts.get('missing'):
        alerts.append('<div class="alert alert-warn"><span data-zh="缺失扫描器：" data-en="Scanners missing: ">缺失扫描器：</span>%s</div>' % _h(', '.join(ts['missing'])))
    if report.get('budget_note'):
        alerts.append('<div class="alert alert-warn">%s</div>' % _h(report['budget_note']))
    if report.get('validation_dropped'):
        alerts.append('<div class="alert alert-drop"><span data-zh="已丢弃 " data-en="Dropped ">已丢弃 </span>%d<span data-zh=" 条未通过 schema/file:line 校验的发现。" data-en=" findings failing schema/file:line checks."> 条未通过 schema/file:line 校验的发现。</span></div>'
                      % len(report['validation_dropped']))

    extra_sections = []
    if report.get('module_summaries'):
        items = ''.join(
            "<article class='case'>"
            "<header class='case-head' role='button' tabindex='0' aria-expanded='false'>"
            "<h3>%s</h3><span class='chev' aria-hidden='true'></span></header>"
            "<div class='case-body'><div class='block'><p>%s</p></div></div></article>"
            % (_h(m.get('module')), _h(m.get('summary', '')))
            for m in report['module_summaries'][:12]
        )
        extra_sections.append(
            '<section class="panel"><div class="panel-head">'
            '<h2 data-zh="模块风险" data-en="Module risk">模块风险</h2>'
            '<p class="desc" data-zh="点击卡片展开模块摘要" data-en="Click a card to expand the module summary">'
            '点击卡片展开模块摘要</p></div>%s</section>' % items
        )
    if report.get('heat_map'):
        rows = ''.join("<tr><td><code>%s</code></td><td>%s</td></tr>"
                       % (_h(h['path']), _h('%.1f' % h.get('hot_score', 0)))
                       for h in report['heat_map'][:20])
        extra_sections.append('<section class="panel"><div class="panel-head"><h2 data-zh="热点文件" data-en="Hot files">热点文件</h2></div><table class="steps"><thead><tr><th data-zh="路径" data-en="Path">路径</th><th>score</th></tr></thead><tbody>%s</tbody></table></section>' % rows)

    det = cov.get('deterministic_share', 0) or 0
    llm = cov.get('llm_share', 0) or 0
    tooling = 'Degraded' if ts.get('degraded') else 'Ready: %s' % _h(', '.join(ts.get('ready') or []))
    css = chrome_css()
    js = chrome_js()
    return f'''<!DOCTYPE html>
<html lang="zh-CN" data-theme="light" data-lang="zh" data-store="aid-report">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title data-zh="{_h(title)}" data-en="{_h(title)}">{_h(title)}</title>
{boot_script()}
<style>
{css}
</style>
</head>
<body>
{prefs_html()}
<div class="wrap">
  <header class="hero">
    <p class="kicker">codexqa-defect-analyzer · {_h(scan_type)}</p>
    <h1><span data-zh="缺陷扫描报告" data-en="{_h(title)}">缺陷扫描报告</span>
      <span class="total-pill">{total} <span class="unit-zh">条</span><span class="unit-en"> findings</span></span>
    </h1>
    <p class="sub"><span data-zh="目标" data-en="Target">目标</span> <code>{_h(report.get('target', '—'))}</code></p>
    <div class="meta-row">
      <span data-zh="生成时间" data-en="Generated">生成时间</span>: <code>{_h(report.get('generated_at', '—'))}</code>
      <span data-zh="扫描文件" data-en="Files scanned">扫描文件</span>: {_h(summary.get('files_scanned', '—'))}
      <span>Policy: <code>{_h(pp.get('pack_id', '—'))}</code> v{_h(pp.get('version', '—'))}</span>
      <span>Tooling: {tooling}</span>
    </div>
    <div class="stats">
      <div class="card">
        <h2 data-zh="按严重级别" data-en="By severity">按严重级别</h2>
        <div class="chip-row">{chips}</div>
      </div>
      <div class="card">
        <h2 data-zh="扫描覆盖" data-en="Scan coverage">扫描覆盖</h2>
        <div class="bar-row"><span>DET</span><div class="bar"><i style="width:{det:.1f}%"></i></div><b>{det:.0f}%</b></div>
        <div class="bar-row"><span>LLM</span><div class="bar"><i style="width:{llm:.1f}%"></i></div><b>{llm:.0f}%</b></div>
        <div class="chip-row sources">{source_rows}</div>
      </div>
    </div>
  </header>
  {''.join(alerts)}
  <section class="panel">
    <div class="panel-head">
      <h2 data-zh="规则命中" data-en="Rule hits">规则命中</h2>
      <p class="desc">Active rules: {_h(pp.get('rule_count_active', '—'))}</p>
    </div>
    {rule_rows}
  </section>
  {_render_toolbar(sev_counts, total)}
  {''.join(findings_html)}
  <section class="panel" id="sev-empty" hidden>
    <div class="empty"><span data-zh="该级别暂无发现" data-en="No findings at this severity">该级别暂无发现</span></div>
  </section>
  {''.join(extra_sections)}
  <p class="footer">codexqa-defect-analyzer · report_scan.html · {_h(report.get('generated_at', ''))}</p>
</div>
<script>
{js}
</script>
</body>
</html>'''

def render_html(report_or_md, title='AI Defect Detection Report'):
    """Render HTML from report dict (preferred) or JSON string."""
    if isinstance(report_or_md, dict):
        return render_html_report(report_or_md)
    try:
        data = json.loads(report_or_md)
        if isinstance(data, dict) and 'findings' in data:
            return render_html_report(data)
    except (json.JSONDecodeError, TypeError):
        pass
    raise ValueError('render_html requires a report dict or JSON with findings')


def write_report_files(report, output_dir):
    """Write report_scan.json, .md, and .html to output_dir."""
    os.makedirs(output_dir, exist_ok=True)
    md_text = render_md(report)
    json.dump(report, open(os.path.join(output_dir, 'report_scan.json'), 'w'),
              ensure_ascii=False, indent=1)
    open(os.path.join(output_dir, 'report_scan.md'), 'w', encoding='utf-8').write(md_text)
    open(os.path.join(output_dir, 'report_scan.html'), 'w', encoding='utf-8').write(
        render_html_report(report))
    return md_text


def load_prev_snapshot(baseline_dir):
    if not os.path.isdir(baseline_dir):
        return None
    snaps = sorted([f for f in os.listdir(baseline_dir) if f.startswith('snapshot_') and f.endswith('.json')])
    if len(snaps) < 1:
        return None
    # newest is about to be written; use second-newest if exists, else newest as "previous"
    path = os.path.join(baseline_dir, snaps[-1])
    try:
        return json.load(open(path))
    except Exception:
        return None

def compute_delta(prev, summary, findings):
    if not prev:
        return {'first_baseline': True}
    ps = prev.get('summary', {})
    delta = {}
    for k in ('P0', 'P1', 'P2', 'P3', 'total'):
        delta[k] = int(summary.get(k, 0)) - int(ps.get(k, 0))
    prev_ids = {f.get('title') for f in prev.get('findings', []) if f.get('title')}
    cur_titles = {f.get('title') for f in findings}
    delta['new_titles'] = sorted(cur_titles - prev_ids)[:20]
    delta['resolved_titles'] = sorted(prev_ids - cur_titles)[:20]
    return delta

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sast', default=None)
    ap.add_argument('--llm', default=None)
    ap.add_argument('--meta', default=None)
    ap.add_argument('--repo', default=None)
    ap.add_argument('--module-summaries', default=None)
    ap.add_argument('--heat-map', default=None)
    ap.add_argument('--tokens-used', type=int, default=0)
    ap.add_argument('-o', '--output-dir', default='/tmp/aid_report')
    args = ap.parse_args()
    cfg = load_config()
    meta = json.load(open(args.meta)) if args.meta else {}
    repo = args.repo or meta.get('repo')

    sast, llm = [], []
    llm_payload = None
    if args.sast and os.path.exists(args.sast):
        raw = json.load(open(args.sast))
        sast = raw if isinstance(raw, list) else raw.get('findings', [])
    if args.llm and os.path.exists(args.llm):
        data = json.load(open(args.llm))
        llm_payload = data if isinstance(data, dict) else {'findings': data}
        llm = llm_payload.get('findings', []) if isinstance(llm_payload, dict) else data

    line_window = int(cfg.get('merge_line_window') or 3)
    dismissals = collect_dismissals(llm_payload, findings=llm)
    findings = merge_sast_llm(sast, llm, line_window=line_window, dismissals=dismissals)
    findings, dropped = filter_valid_findings(findings, repo=repo)

    when = datetime.datetime.now()
    for i, f in enumerate(findings, 1):
        f['id'] = f.get('id') or generate_finding_id(i, when)

    # attach policy pack meta + by_rule_id stats
    policy_pack = {}
    try:
        from policy_loader import known_rule_ids, pack_meta_for_report
        policy_pack = pack_meta_for_report()
        known = known_rule_ids()
        for f in findings:
            rid = (f.get('rule_id') or '').strip()
            if rid and rid not in known and f.get('source') == 'llm_judged':
                # keep but mark for ops; do not drop (LLM may invent during transition)
                f['rule_id_unknown'] = True
    except Exception as e:
        policy_pack = {'error': str(e)}

    order = cfg['severity_order']
    findings.sort(key=lambda f: (order.index(f['severity']) if f['severity'] in order else 9,
                                 f['file'], f['line']))

    files_scanned = meta.get('files_scanned')
    if files_scanned is None:
        files_scanned = len({f['file'] for f in findings} |
                            {c.get('path') for c in meta.get('changed_files', []) if c.get('path')})

    sev_counts = {s: sum(1 for f in findings if f['severity'] == s) for s in order}
    by_source = {src: sum(1 for f in findings if f.get('source') == src)
                 for src in ('sast_only', 'sast_confirmed', 'llm_judged')}
    by_rule = {}
    for f in findings:
        rid = f.get('rule_id') or '(none)'
        by_rule[rid] = by_rule.get(rid, 0) + 1
    det_n = by_source['sast_only'] + by_source['sast_confirmed']
    total = max(1, len(findings))
    by_dimension = {
        'deterministic': sum(1 for f in findings if f.get('dimension') == 'deterministic'),
        'agent_llm': sum(1 for f in findings if f.get('dimension') == 'agent_llm'),
        'deterministic+agent_llm': sum(
            1 for f in findings if f.get('dimension') == 'deterministic+agent_llm'),
    }
    coverage = {
        'by_source': by_source,
        'by_dimension': by_dimension,
        'by_rule_id': by_rule,
        'deterministic_share': round(100.0 * det_n / total, 1),
        'llm_share': round(100.0 * by_source['llm_judged'] / total, 1),
        'agent_llm_dimension_share': round(
            100.0 * (by_dimension['agent_llm'] + by_dimension['deterministic+agent_llm']) / total, 1),
        'target_deterministic_share_pct': 70,
        'sast_clear_count': meta.get('sast_clear_count'),
        'sast_ambiguous_count': meta.get('sast_ambiguous_count'),
        'code_metrics': meta.get('code_metrics'),
        'deterministic_first': bool(meta.get('deterministic_first')),
        'dimensions': ['deterministic', 'agent_llm'],
    }
    summary = {'files_scanned': files_scanned, 'total': len(findings),
               'findings': sev_counts, **sev_counts, 'coverage': coverage,
               'primary_language': meta.get('primary_language') or 'unknown',
               'language_confidence': meta.get('language_confidence') or 'unknown',
               'language_source': meta.get('language_source') or 'unknown'}

    module_summaries = []
    if args.module_summaries and os.path.exists(args.module_summaries):
        module_summaries = json.load(open(args.module_summaries))
    heat_map = []
    if args.heat_map and os.path.exists(args.heat_map):
        heat_map = json.load(open(args.heat_map))

    baseline_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                'data', 'baseline')
    prev = load_prev_snapshot(baseline_dir) if meta.get('scan_type') == 'full' else None
    # For delta, prefer previous snapshot's findings titles if present
    delta = compute_delta(prev, summary, findings) if meta.get('scan_type') == 'full' else None

    tooling_status = meta.get('tooling_status')
    if not isinstance(tooling_status, dict):
        tooling_status = {}

    report = {'scan_type': meta.get('scan_type', 'incremental'),
              'target': meta.get('target') or meta.get('head') or meta.get('repo', '?'),
              'generated_at': when.isoformat(),
              'primary_language': meta.get('primary_language') or 'unknown',
              'language_confidence': meta.get('language_confidence') or 'unknown',
              'config_severity_order': order,
              'policy_pack': policy_pack,
              'tooling_status': tooling_status,
              'summary': summary,
              'budget_note': meta.get('budget_note', ''),
              'tokens_used': args.tokens_used or meta.get('tokens_used', 0),
              'context_level': meta.get('context_level', ''),
              'findings': findings,
              'validation_dropped': [{'title': d['finding'].get('title'), 'errors': d['errors']}
                                     for d in dropped],
              'module_summaries': module_summaries,
              'heat_map': heat_map,
              'delta': delta}
    write_report_files(report, args.output_dir)
    print('report: %d findings %s (dropped %d) -> %s'
          % (len(findings), summary, len(dropped), args.output_dir))

if __name__ == '__main__':
    main()
