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
    return {'sast_confirmed': 'tag-confirmed', 'sast_only': 'tag-sast', 'llm_judged': 'tag-llm'}.get(
        source or '', 'tag-llm')


def _render_finding_card(finding, index):
    sev = finding.get('severity', 'P3').lower()
    conf = int(round(float(finding.get('confidence', 0)) * 100))
    rid = finding.get('rule_id') or '—'
    fid = finding.get('id') or '—'
    return '''<article class="finding sev-%s" style="--i:%d">
  <div class="finding-accent"></div>
  <header class="finding-head">
    <div class="finding-top">
      <code class="loc">%s:%s</code>
      <span class="tag %s">%s</span>
      <span class="tag tag-rule">%s</span>
      <span class="tag tag-conf">%d%%</span>
      <span class="tag tag-id">%s</span>
    </div>
    <h3 class="finding-title">%s</h3>
    <span class="finding-cat">%s</span>
  </header>
  <div class="finding-body">
    <div class="field field-evidence">
      <span class="field-label">Evidence</span>
      <p>%s</p>
    </div>
    <div class="field field-fix">
      <span class="field-label">Remediation</span>
      <p>%s</p>
    </div>
  </div>
</article>''' % (
        sev, index,
        _h(finding.get('file', '?')), _h(finding.get('line', '?')),
        _source_class(finding.get('source')), _h(_source_label(finding.get('source'))),
        _h(rid), conf, _h(fid),
        _h(finding.get('title', '')),
        _h(finding.get('category', '')),
        _h(finding.get('evidence', '')),
        _h(finding.get('suggestion', '')),
    )


def _render_severity_section(sev, findings, start_index):
    if not findings:
        return '', start_index
    cards = []
    idx = start_index
    for f in findings:
        cards.append(_render_finding_card(f, idx))
        idx += 1
    return '''<section class="severity-block sev-%s" id="sev-%s">
  <div class="severity-head">
    <span class="severity-badge">%s</span>
    <h2 class="severity-title">%s Findings</h2>
    <span class="severity-count">%d</span>
  </div>
  <div class="findings-grid">%s</div>
</section>''' % (
        sev.lower(), sev.lower(),
        _h(sev), _h(sev), len(findings), '\n'.join(cards),
    ), idx


def render_html_report(report):
    """Render a premium standalone HTML report from structured report dict."""
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

    stat_pills = ''.join(
        '<a class="stat-pill sev-%s" href="#sev-%s"><span class="stat-label">%s</span>'
        '<span class="stat-num">%d</span></a>' % (s.lower(), s.lower(), s, sev_counts.get(s, 0))
        for s in ('P0', 'P1', 'P2', 'P3'))

    rule_rows = ''.join(
        '<div class="rule-row"><span class="rule-id">%s</span><span class="rule-bar-wrap">'
        '<span class="rule-bar" style="width:%.0f%%"></span></span><span class="rule-n">%d</span></div>'
        % (_h(rid), 100 * n / max(1, max(by_rule.values())), n)
        for rid, n in sorted(by_rule.items(), key=lambda x: -x[1])[:8]
    ) if by_rule else '<p class="muted">—</p>'

    source_rows = ''.join(
        '<div class="source-chip"><span class="source-n">%d</span><span class="source-l">%s</span></div>'
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

    alerts = []
    if ts.get('missing'):
        alerts.append('<div class="alert alert-warn">Scanners missing: %s</div>' % _h(', '.join(ts['missing'])))
    if report.get('budget_note'):
        alerts.append('<div class="alert alert-warn">%s</div>' % _h(report['budget_note']))
    if report.get('validation_dropped'):
        alerts.append('<div class="alert alert-drop">Dropped %d findings failing schema/file:line checks.</div>'
                      % len(report['validation_dropped']))

    extra_sections = []
    if report.get('module_summaries'):
        items = ''.join('<div class="module-card"><h4>%s</h4><p>%s</p></div>'
                        % (_h(m.get('module')), _h(m.get('summary', '')))
                        for m in report['module_summaries'][:12])
        extra_sections.append('<section class="extra-block"><h2>Module Risk</h2>%s</section>' % items)
    if report.get('heat_map'):
        rows = ''.join('<div class="heat-row"><code>%s</code><span class="heat-score">%.1f</span></div>'
                       % (_h(h['path']), h.get('hot_score', 0))
                       for h in report['heat_map'][:20])
        extra_sections.append('<section class="extra-block"><h2>Hot Files</h2>%s</section>' % rows)

    return '''<!DOCTYPE html>
<html lang="zh-CN" data-theme="night">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<script>
(function(){
  try{
    var q=new URLSearchParams(location.search).get('theme');
    var t=(q==='day'||q==='night')?q:localStorage.getItem('aid-report-theme');
    if(t!=='day'&&t!=='night') t='night';
    document.documentElement.setAttribute('data-theme',t);
  }catch(e){}
})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Karla:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root,html[data-theme="night"] {
    --bg:#0c0c0f; --bg2:#12121a; --surface:#18181f; --surface2:#1f1f28;
    --border:rgba(255,255,255,.07); --border2:rgba(255,255,255,.12);
    --text:#ece8df; --muted:#8b8780; --dim:#5c5954;
    --p0:#ff4d4d; --p0-glow:rgba(255,77,77,.25);
    --p1:#ff9f43; --p1-glow:rgba(255,159,67,.2);
    --p2:#54a0ff; --p2-glow:rgba(84,160,255,.18);
    --p3:#8395a7; --p3-glow:rgba(131,149,167,.15);
    --accent:#c9a962; --accent-dim:rgba(201,169,98,.12);
    --confirmed:#2ecc71; --sast:#54a0ff; --llm:#b388ff;
    --wash-gold:rgba(201,169,98,.08); --wash-alert:rgba(255,77,77,.06);
    --grid:rgba(255,255,255,.025); --finding-shadow:0 8px 32px rgba(0,0,0,.35);
    --alert-drop-fg:#ff8080; --toggle-shadow:0 10px 32px rgba(0,0,0,.4);
    --thumb:linear-gradient(180deg,#ead7a4,#c9a962);
    --radius:14px; --font-display:"Fraunces",Georgia,serif;
    --font-body:"Karla",system-ui,sans-serif; --font-mono:"IBM Plex Mono",monospace;
  }
  html[data-theme="day"] {
    --bg:#e7dcc6; --bg2:#d9cdb4; --surface:#f6edd8; --surface2:#efe3c8;
    --border:rgba(62,46,18,.14); --border2:rgba(62,46,18,.26);
    --text:#1a150e; --muted:#6a5d45; --dim:#8d8068;
    --p0:#b42318; --p0-glow:rgba(180,35,24,.14);
    --p1:#a34b0a; --p1-glow:rgba(163,75,10,.14);
    --p2:#1558b0; --p2-glow:rgba(21,88,176,.12);
    --p3:#4d5a66; --p3-glow:rgba(77,90,102,.12);
    --accent:#7a5810; --accent-dim:rgba(122,88,16,.16);
    --confirmed:#176c3a; --sast:#1558b0; --llm:#5c32b0;
    --wash-gold:rgba(201,169,98,.32); --wash-alert:rgba(180,35,24,.07);
    --grid:rgba(62,46,18,.07); --finding-shadow:0 12px 28px rgba(72,48,12,.1);
    --alert-drop-fg:#9b1c12; --toggle-shadow:0 10px 24px rgba(72,48,12,.14);
    --thumb:linear-gradient(180deg,#f4d27a,#b8861c);
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;color-scheme:dark}
  html[data-theme="day"]{color-scheme:light}
  body{font-family:var(--font-body);background:var(--bg);color:var(--text);
       line-height:1.6;-webkit-font-smoothing:antialiased}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:
      radial-gradient(ellipse 80%% 50%% at 15%% -10%%,var(--wash-gold),transparent 55%%),
      radial-gradient(ellipse 60%% 40%% at 90%% 5%%,var(--wash-alert),transparent 50%%),
      linear-gradient(var(--grid) 1px,transparent 1px),
      linear-gradient(90deg,var(--grid) 1px,transparent 1px);
    background-size:auto,auto,48px 48px,48px 48px}
  html.theme-ready body,html.theme-ready .stat-pill,html.theme-ready .meta-card,
  html.theme-ready .finding,html.theme-ready .source-chip,html.theme-ready .loc,
  html.theme-ready .watch-toggle,html.theme-ready .module-card,html.theme-ready .heat-row,
  html.theme-ready .alert,html.theme-ready .hero-sub code{
    transition:background-color .45s ease,color .45s ease,border-color .45s ease,box-shadow .45s ease}
  .page{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:3rem 1.5rem 4rem}
  @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  @keyframes shimmer{0%%,100%%{opacity:.4}50%%{opacity:1}}
  .hero{animation:fadeUp .7s ease both;margin-bottom:2.5rem;padding-right:9.5rem}
  @media(max-width:640px){.hero{padding-right:3.5rem}}
  .hero-eyebrow{font-size:.72rem;font-weight:600;letter-spacing:.22em;text-transform:uppercase;
    color:var(--accent);margin-bottom:.75rem;display:flex;align-items:center;gap:.6rem}
  .hero-eyebrow::before{content:"";width:28px;height:1px;background:var(--accent);animation:shimmer 2.5s ease infinite}
  .hero h1{font-family:var(--font-display);font-size:clamp(2rem,5vw,3rem);font-weight:700;
    letter-spacing:-.02em;line-height:1.1;margin-bottom:.5rem}
  .hero-sub{color:var(--muted);font-size:.95rem}
  .hero-sub code{font-family:var(--font-mono);font-size:.82rem;background:var(--surface2);
    padding:.15em .5em;border-radius:6px;border:1px solid var(--border)}
  .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;margin:2rem 0;
    animation:fadeUp .7s .1s ease both}
  @media(max-width:640px){.stats-row{grid-template-columns:repeat(2,1fr)}}
  .stat-pill{display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:1rem .75rem;
    background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
    text-decoration:none;color:inherit;transition:transform .2s,border-color .2s,box-shadow .2s}
  .stat-pill:hover{transform:translateY(-2px);border-color:var(--border2)}
  .stat-pill.sev-p0:hover{box-shadow:0 0 24px var(--p0-glow);border-color:var(--p0)}
  .stat-pill.sev-p1:hover{box-shadow:0 0 24px var(--p1-glow);border-color:var(--p1)}
  .stat-pill.sev-p2:hover{box-shadow:0 0 24px var(--p2-glow);border-color:var(--p2)}
  .stat-pill.sev-p3:hover{box-shadow:0 0 24px var(--p3-glow);border-color:var(--p3)}
  .stat-label{font-size:.68rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .stat-num{font-family:var(--font-display);font-size:2rem;font-weight:700;line-height:1}
  .stat-pill.sev-p0 .stat-num{color:var(--p0)}
  .stat-pill.sev-p1 .stat-num{color:var(--p1)}
  .stat-pill.sev-p2 .stat-num{color:var(--p2)}
  .stat-pill.sev-p3 .stat-num{color:var(--p3)}
  .meta-panel{display:grid;grid-template-columns:1.2fr 1fr;gap:1rem;margin-bottom:2.5rem;
    animation:fadeUp .7s .18s ease both}
  @media(max-width:768px){.meta-panel{grid-template-columns:1fr}}
  .meta-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1.4rem}
  .meta-card h3{font-size:.68rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
    color:var(--accent);margin-bottom:1rem}
  .meta-kv{display:grid;gap:.55rem;font-size:.88rem}
  .meta-kv dt{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
  .meta-kv dd{color:var(--text);margin-bottom:.35rem}
  .meta-kv dd code{font-family:var(--font-mono);font-size:.78rem;color:var(--accent)}
  .coverage-bar{display:flex;height:6px;border-radius:99px;overflow:hidden;background:var(--surface2);margin:.6rem 0}
  .coverage-bar span{height:100%%}
  .coverage-bar .det{background:var(--confirmed)}
  .coverage-bar .llm{background:var(--llm)}
  .source-chips{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}
  .source-chip{background:var(--surface2);border:1px solid var(--border);border-radius:8px;
    padding:.35rem .65rem;font-size:.78rem;display:flex;gap:.4rem;align-items:center}
  .source-n{font-weight:600;color:var(--text)}
  .source-l{color:var(--muted);text-transform:capitalize}
  .rule-row{display:grid;grid-template-columns:72px 1fr 28px;gap:.5rem;align-items:center;
    font-size:.82rem;margin-bottom:.4rem}
  .rule-id{font-family:var(--font-mono);font-size:.72rem;color:var(--muted)}
  .rule-bar-wrap{height:4px;background:var(--surface2);border-radius:99px;overflow:hidden}
  .rule-bar{display:block;height:100%%;background:linear-gradient(90deg,var(--accent),var(--p1));border-radius:99px}
  .rule-n{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
  .severity-block{margin-bottom:2.5rem;animation:fadeUp .6s calc(.25s + var(--i,0)*.05s) ease both}
  .severity-head{display:flex;align-items:center;gap:.85rem;margin-bottom:1.25rem;padding-bottom:.75rem;
    border-bottom:1px solid var(--border)}
  .severity-badge{font-family:var(--font-mono);font-size:.72rem;font-weight:500;padding:.3em .75em;
    border-radius:6px;letter-spacing:.06em}
  .sev-p0 .severity-badge{background:var(--p0-glow);color:var(--p0);border:1px solid rgba(255,77,77,.35)}
  .sev-p1 .severity-badge{background:var(--p1-glow);color:var(--p1);border:1px solid rgba(255,159,67,.35)}
  .sev-p2 .severity-badge{background:var(--p2-glow);color:var(--p2);border:1px solid rgba(84,160,255,.35)}
  .sev-p3 .severity-badge{background:var(--p3-glow);color:var(--p3);border:1px solid rgba(131,149,167,.35)}
  .severity-title{font-family:var(--font-display);font-size:1.35rem;font-weight:500;flex:1}
  .severity-count{font-family:var(--font-display);font-size:1.5rem;color:var(--muted);font-weight:500}
  .findings-grid{display:flex;flex-direction:column;gap:1rem}
  .finding{position:relative;background:var(--surface);border:1px solid var(--border);
    border-radius:var(--radius);overflow:hidden;
    animation:fadeUp .5s calc(.08s * var(--i,0)) ease both;
    transition:border-color .25s,box-shadow .25s}
  .finding:hover{border-color:var(--border2);box-shadow:var(--finding-shadow)}
  .finding-accent{position:absolute;left:0;top:0;bottom:0;width:3px}
  .sev-p0 .finding-accent{background:linear-gradient(180deg,var(--p0),transparent)}
  .sev-p1 .finding-accent{background:linear-gradient(180deg,var(--p1),transparent)}
  .sev-p2 .finding-accent{background:linear-gradient(180deg,var(--p2),transparent)}
  .sev-p3 .finding-accent{background:linear-gradient(180deg,var(--p3),transparent)}
  .finding-head{padding:1.1rem 1.25rem 1rem 1.4rem}
  .finding-top{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:.65rem}
  .loc{font-family:var(--font-mono);font-size:.78rem;background:var(--surface2);padding:.2em .55em;
    border-radius:6px;border:1px solid var(--border);color:var(--accent)}
  .tag{font-size:.68rem;font-weight:600;padding:.22em .55em;border-radius:5px;
    letter-spacing:.04em;text-transform:uppercase}
  .tag-confirmed{background:rgba(46,204,113,.12);color:var(--confirmed);border:1px solid rgba(46,204,113,.3)}
  .tag-sast{background:rgba(84,160,255,.12);color:var(--sast);border:1px solid rgba(84,160,255,.3)}
  .tag-llm{background:rgba(179,136,255,.12);color:var(--llm);border:1px solid rgba(179,136,255,.3)}
  .tag-rule,.tag-conf,.tag-id{background:var(--surface2);color:var(--muted);border:1px solid var(--border);
    font-family:var(--font-mono);font-size:.65rem;text-transform:none;letter-spacing:0}
  .finding-title{font-family:var(--font-display);font-size:1.08rem;font-weight:500;line-height:1.35;
    margin-bottom:.35rem}
  .finding-cat{font-size:.72rem;color:var(--dim);text-transform:uppercase;letter-spacing:.08em}
  .finding-body{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border)}
  @media(max-width:720px){.finding-body{grid-template-columns:1fr}}
  .field{padding:1rem 1.25rem 1.1rem 1.4rem}
  .field-evidence{border-right:1px solid var(--border)}
  @media(max-width:720px){.field-evidence{border-right:none;border-bottom:1px solid var(--border)}}
  .field-label{display:block;font-size:.65rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
    color:var(--muted);margin-bottom:.45rem}
  .field-evidence .field-label{color:var(--p1)}
  .field-fix .field-label{color:var(--confirmed)}
  .field p{font-size:.86rem;color:var(--text);line-height:1.55;word-break:break-word}
  .alert{padding:.85rem 1.1rem;border-radius:10px;font-size:.86rem;margin-bottom:1.25rem;
    animation:fadeUp .5s ease both}
  .alert-warn{background:rgba(255,159,67,.1);border:1px solid rgba(255,159,67,.3);color:var(--p1)}
  .alert-drop{background:rgba(255,77,77,.08);border:1px solid rgba(255,77,77,.25);color:var(--alert-drop-fg)}
  .extra-block{margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border)}
  .extra-block h2{font-family:var(--font-display);font-size:1.2rem;margin-bottom:1rem;color:var(--accent)}
  .module-card,.heat-row{background:var(--surface);border:1px solid var(--border);border-radius:10px;
    padding:.85rem 1rem;margin-bottom:.5rem;font-size:.86rem}
  .heat-row{display:flex;justify-content:space-between;align-items:center}
  .heat-score{font-family:var(--font-mono);color:var(--p1)}
  .footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);
    display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;
    font-size:.78rem;color:var(--dim)}
  .footer-brand{font-family:var(--font-mono);letter-spacing:.06em}
  .footer-meta{color:var(--muted)}
  .muted{color:var(--muted);font-size:.85rem}
  .total-badge{display:inline-flex;align-items:center;gap:.4rem;margin-left:.5rem;
    font-size:.82rem;color:var(--muted);font-weight:400}
  .total-badge strong{color:var(--text);font-weight:600}
  .watch-toggle{position:fixed;top:1.15rem;right:1.15rem;z-index:30;display:inline-flex;
    align-items:center;gap:.65rem;padding:.32rem .75rem .32rem .32rem;border-radius:999px;
    border:1px solid var(--accent);background:var(--surface);
    color:var(--text);cursor:pointer;font-family:var(--font-mono);box-shadow:var(--toggle-shadow);
    appearance:none;-webkit-appearance:none}
  .watch-toggle:hover{border-color:var(--accent)}
  .watch-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  .watch-rail{position:relative;display:flex;align-items:center;justify-content:space-between;
    width:64px;height:28px;padding:0 7px;border-radius:99px;background:var(--bg2);
    border:1px solid var(--border);box-shadow:inset 0 0 0 1px var(--accent-dim)}
  .watch-icon-sun,.watch-icon-moon{position:relative;z-index:1;width:10px;height:10px;border-radius:50%%}
  .watch-icon-sun{background:#e8b84a;box-shadow:0 0 0 1.5px #e8b84a,0 0 8px rgba(232,184,74,.55)}
  .watch-icon-moon{background:#d8d4cc;box-shadow:inset -3px -1px 0 0 #6b675f}
  .watch-thumb{position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%%;
    background:var(--thumb);box-shadow:0 2px 6px rgba(0,0,0,.35);z-index:2;
    transform:translateX(34px);transition:transform .4s cubic-bezier(.4,.15,.2,1)}
  html[data-theme="day"] .watch-thumb{transform:translateX(0)}
  .watch-meta{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1;min-width:3.2rem}
  .watch-mode{font-size:.68rem;font-weight:500;letter-spacing:.14em;color:var(--accent)}
  .watch-hint{font-size:.58rem;letter-spacing:.16em;color:var(--dim);margin-top:.15rem}
  @media(max-width:640px){.watch-hint{display:none}.watch-toggle{padding:.3rem .55rem .3rem .3rem}}
  @media(prefers-reduced-motion:reduce){
    html{scroll-behavior:auto}
    .watch-thumb,html.theme-ready body,html.theme-ready .stat-pill,html.theme-ready .meta-card,
    html.theme-ready .finding,html.theme-ready .source-chip,html.theme-ready .loc,
    html.theme-ready .watch-toggle,html.theme-ready .module-card,html.theme-ready .heat-row,
    html.theme-ready .alert,html.theme-ready .hero-sub code{transition:none}
  }
</style>
</head>
<body>
<div class="page">
  <button type="button" class="watch-toggle" id="aidThemeToggle" aria-pressed="false" aria-label="切换为白天视图">
    <span class="watch-rail" aria-hidden="true">
      <span class="watch-icon-sun"></span>
      <span class="watch-thumb"></span>
      <span class="watch-icon-moon"></span>
    </span>
    <span class="watch-meta">
      <span class="watch-mode" id="aidThemeLabel">NIGHT</span>
      <span class="watch-hint">VIEW</span>
    </span>
  </button>
  <header class="hero">
    <p class="hero-eyebrow">AI Defect Detection</p>
    <h1>%s Report<span class="total-badge"><strong>%d</strong> findings</span></h1>
    <p class="hero-sub">Target <code>%s</code> · Generated %s</p>
  </header>

  <nav class="stats-row" aria-label="Severity summary">%s</nav>

  <div class="meta-panel">
    <div class="meta-card">
      <h3>Scan Coverage</h3>
      <dl class="meta-kv">
        <dt>Files Scanned</dt><dd>%s</dd>
        <dt>Deterministic Share</dt><dd>%.1f%% <span class="muted">(target ≥70%%)</span></dd>
        <dt>LLM Share</dt><dd>%.1f%%</dd>
      </dl>
      <div class="coverage-bar" title="Deterministic vs LLM">
        <span class="det" style="width:%.1f%%"></span><span class="llm" style="width:%.1f%%"></span>
      </div>
      <div class="source-chips">%s</div>
    </div>
    <div class="meta-card">
      <h3>Policy &amp; Rules</h3>
      <dl class="meta-kv">
        <dt>Policy Pack</dt><dd><code>%s</code> v%s</dd>
        <dt>Active Rules</dt><dd>%s</dd>
        <dt>Tooling</dt><dd>%s</dd>
      </dl>
      %s
    </div>
  </div>

  %s

  %s

  <footer class="footer">
    <span class="footer-brand">codexqa-defect-analyzer</span>
    <span class="footer-meta">report_scan.html · %s</span>
  </footer>
</div>
<script>
(function(){
  var KEY='aid-report-theme';
  var root=document.documentElement;
  var btn=document.getElementById('aidThemeToggle');
  var label=document.getElementById('aidThemeLabel');
  function apply(theme,persist){
    root.setAttribute('data-theme',theme);
    var isDay=theme==='day';
    if(btn){
      btn.setAttribute('aria-pressed',isDay?'true':'false');
      btn.setAttribute('aria-label',isDay?'切换为黑夜视图':'切换为白天视图');
    }
    if(label) label.textContent=isDay?'DAY':'NIGHT';
    if(persist){try{localStorage.setItem(KEY,theme)}catch(e){}}
  }
  var saved=null;
  try{
    var q=new URLSearchParams(location.search).get('theme');
    if(q==='day'||q==='night') saved=q;
    else saved=localStorage.getItem(KEY);
  }catch(e){}
  apply((saved==='day'||saved==='night')?saved:'night',false);
  requestAnimationFrame(function(){root.classList.add('theme-ready')});
  if(btn) btn.addEventListener('click',function(){
    apply(root.getAttribute('data-theme')==='day'?'night':'day',true);
  });
})();
</script>
</body>
</html>''' % (
        _h(title),
        _h(scan_type), total,
        _h(report.get('target', '—')), _h(report.get('generated_at', '—')),
        stat_pills,
        summary.get('files_scanned', '—'),
        cov.get('deterministic_share', 0), cov.get('llm_share', 0),
        cov.get('deterministic_share', 0), cov.get('llm_share', 0),
        source_rows,
        _h(pp.get('pack_id', '—')), _h(pp.get('version', '—')),
        _h(pp.get('rule_count_active', '—')),
        'Degraded' if ts.get('degraded') else 'Ready: %s' % _h(', '.join(ts.get('ready') or [])),
        ('<div style="margin-top:1rem">%s</div>' % rule_rows) if by_rule else '',
        '\n'.join(alerts),
        '\n'.join(findings_html) + '\n'.join(extra_sections),
        _h(report.get('generated_at', '')),
    )


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
