#!/usr/bin/env python3
"""Feedback loop: verdicts, embedding vector store, rule promotion, weekly metrics."""
import argparse, json, os, re, sys
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import cosine, data_dir, embed_text, skill_dir

def load_json(path, default):
    if os.path.exists(path):
        return json.load(open(path))
    return default

def load_jsonl(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path) if l.strip()]

def append_jsonl(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a') as f:
        f.write(json.dumps(obj, ensure_ascii=False) + '\n')

def vector_store_path():
    return data_dir('vectors.jsonl')

def add_vector(title, category='', file='', verdict='dismiss', rule_id=''):
    """Embed dismissed/ignored findings into vector store for Stage1 pre-filter."""
    vec = embed_text('%s %s %s %s' % (title, category, file, rule_id))
    append_jsonl(vector_store_path(), {
        'title': title, 'category': category, 'file': file, 'verdict': verdict,
        'rule_id': rule_id or '',
        'embedding': vec, 'ts': datetime.now().isoformat()})

def promote_to_category_rules(title):
    """Append negative example to references/category_rules.md."""
    path = os.path.join(skill_dir(), 'references', 'category_rules.md')
    marker = '## Negative examples (do NOT report)'
    line = '- Auto-promoted dismissed pattern: `%s` (dismissed ≥3×)\n' % title.replace('`', "'")
    text = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    if title in text:
        return False
    if marker in text:
        # insert after marker line
        parts = text.split(marker, 1)
        # find end of first line after marker
        rest = parts[1]
        text = parts[0] + marker + '\n' + line + rest.lstrip('\n')
    else:
        text = text.rstrip() + '\n\n' + marker + '\n' + line
    open(path, 'w', encoding='utf-8').write(text)
    return True

def record_rule_verdict(rule_id, verdict, title=''):
    """Track accept/dismiss counts per rule_id for retirement decisions."""
    if not rule_id:
        return
    append_jsonl(data_dir('policy_verdicts.jsonl'), {
        'rule_id': rule_id, 'verdict': verdict, 'title': title,
        'ts': datetime.now().isoformat()})

def record(title, verdict, file='', category='', finding_id='', rule_id=''):
    assert verdict in ('accept', 'dismiss', 'ignore')
    append_jsonl(data_dir('feedback.jsonl'), {
        'title': title, 'verdict': verdict, 'file': file,
        'category': category, 'id': finding_id, 'rule_id': rule_id or '',
        'ts': datetime.now().isoformat()})
    if verdict in ('dismiss', 'ignore'):
        add_vector(title, category, file, verdict, rule_id=rule_id)
    record_rule_verdict(rule_id, verdict, title=title)

    # promote: same dismissed title >=3 → auto_rules + category_rules negative
    recs = load_jsonl(data_dir('feedback.jsonl'))
    dismissed = [r['title'] for r in recs if r['verdict'] == 'dismiss' and r['title'] == title]
    auto = load_json(data_dir('auto_rules.json'), [])
    if len(dismissed) >= 3 and not any(r['title'] == title for r in auto):
        auto.append({'title': title, 'count': len(dismissed), 'rule_id': rule_id or '',
                     'promoted_at': datetime.now().isoformat()})
        json.dump(auto, open(data_dir('auto_rules.json'), 'w'), ensure_ascii=False, indent=1)
        if promote_to_category_rules(title):
            print('promoted negative example -> references/category_rules.md')
        print('auto-rule promoted: %r (dismissed %dx)' % (title, len(dismissed)))
    print('recorded: %s -> %s%s' % (verdict, title, (' [%s]' % rule_id) if rule_id else ''))

def filter_known(findings_file, threshold=None):
    from lib import load_config
    cfg = load_config()
    threshold = threshold if threshold is not None else cfg.get('embedding_similarity_threshold', 0.9)
    vectors = load_jsonl(vector_store_path())
    auto = load_json(data_dir('auto_rules.json'), [])
    data = json.load(open(findings_file))
    findings = data['findings'] if isinstance(data, dict) else data
    kept = []
    for f in findings:
        title = f.get('title', '')
        # Keep Stage2 dismiss markers so merge can drop ambiguous SAST residue
        verdict = str(f.get('verdict') or '').strip().lower()
        if f.get('dismissed') is True or verdict in (
                'dismiss', 'dismissed', 'ignore', 'false_positive', 'false-positive', 'fp'):
            kept.append(f)
            continue
        # auto-rule exact/jaccard-ish via embedding
        drop = False
        fv = embed_text('%s %s %s' % (title, f.get('category', ''), f.get('file', '')))
        for v in vectors:
            if v.get('verdict') not in ('dismiss', 'ignore'):
                continue
            if cosine(fv, v.get('embedding') or embed_text(v.get('title', ''))) >= threshold:
                print('filtered vector-dismissed: %s (sim>=%.2f)' % (title, threshold))
                drop = True
                break
        if not drop:
            for r in auto:
                if r['title'] == title or cosine(fv, embed_text(r['title'])) >= threshold:
                    print('filtered auto-rule: %s' % title)
                    drop = True
                    break
        if not drop:
            kept.append(f)
    if isinstance(data, dict):
        out = dict(data)
        out['findings'] = kept
        # preserve dismissals[] for ambiguous-SAST Stage2 grading
        json.dump(out, open(findings_file, 'w'), ensure_ascii=False, indent=1)
    else:
        json.dump({'findings': kept}, open(findings_file, 'w'), ensure_ascii=False, indent=1)
    print('filter_known: %d -> %d findings' % (len(findings), len(kept)))

def record_scan_cost(scan_type, tokens, findings_count=0, diff_hash=''):
    append_jsonl(data_dir('cost.jsonl'), {
        'ts': datetime.now().isoformat(), 'scan_type': scan_type,
        'tokens': tokens, 'findings': findings_count, 'diff_hash': diff_hash})

def mark_stale(finding_id_or_title):
    """Mark a finding as stale (resolved by a later commit)."""
    append_jsonl(data_dir('feedback.jsonl'), {
        'title': finding_id_or_title, 'verdict': 'stale',
        'ts': datetime.now().isoformat()})
    print('marked stale:', finding_id_or_title)

def stats(week=False):
    recs = load_jsonl(data_dir('feedback.jsonl'))
    costs = load_jsonl(data_dir('cost.jsonl'))
    if week:
        cutoff = datetime.now() - timedelta(days=7)
        def recent(r):
            try:
                return datetime.fromisoformat(r.get('ts', '')) >= cutoff
            except Exception:
                return False
        recs = [r for r in recs if recent(r)]
        costs = [c for c in costs if recent(c)]
    acc = sum(1 for r in recs if r.get('verdict') == 'accept')
    dis = sum(1 for r in recs if r.get('verdict') == 'dismiss')
    ign = sum(1 for r in recs if r.get('verdict') == 'ignore')
    stale = sum(1 for r in recs if r.get('verdict') == 'stale')
    labeled = acc + dis + ign
    tot_findings_proxy = labeled + stale
    print('period: %s' % ('last 7 days' if week else 'all time'))
    print('feedback: %d | accept %d | dismiss %d | ignore %d | stale %d' % (
        len(recs), acc, dis, ign, stale))
    # per rule_id dismiss rate (retirement signal)
    by_rule = {}
    for r in recs:
        rid = r.get('rule_id') or ''
        if not rid:
            continue
        slot = by_rule.setdefault(rid, {'accept': 0, 'dismiss': 0, 'ignore': 0})
        v = r.get('verdict')
        if v in slot:
            slot[v] += 1
    if by_rule:
        print('by_rule_id:')
        for rid, c in sorted(by_rule.items()):
            n = c['accept'] + c['dismiss'] + c['ignore']
            fp = (c['dismiss'] / n) if n else 0
            print('  %s  n=%d dismiss_rate=%.0f%% (retire if sustained high)' % (
                rid, n, 100 * fp))
    if labeled:
        print('adoption_rate: %.0f%% (target >=40%% first month)' % (100 * acc / labeled))
        print('false_positive_rate: %.0f%% (dismiss/labeled; target <=30%%)' % (100 * dis / labeled))
    if tot_findings_proxy:
        print('stale_rate: %.0f%%' % (100 * stale / tot_findings_proxy))
    if costs:
        inc = [c for c in costs if c.get('scan_type') == 'incremental']
        ful = [c for c in costs if c.get('scan_type') == 'full']
        def avg(xs):
            return sum(c.get('tokens', 0) for c in xs) / len(xs) if xs else 0
        print('avg_tokens incremental: %.0f (budget 20k) | full: %.0f | scans: %d'
              % (avg(inc), avg(ful), len(costs)))

def dashboard(week=True):
    """Write weekly metrics board (design §8.2 / W5 指标看板)."""
    from io import StringIO
    import contextlib
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        stats(week=week)
    text = buf.getvalue()
    recs = load_jsonl(data_dir('feedback.jsonl'))
    costs = load_jsonl(data_dir('cost.jsonl'))
    if week:
        cutoff = datetime.now() - timedelta(days=7)
        def recent(r):
            try:
                return datetime.fromisoformat(r.get('ts', '')) >= cutoff
            except Exception:
                return False
        recs = [r for r in recs if recent(r)]
        costs = [c for c in costs if recent(c)]
    acc = sum(1 for r in recs if r.get('verdict') == 'accept')
    dis = sum(1 for r in recs if r.get('verdict') == 'dismiss')
    ign = sum(1 for r in recs if r.get('verdict') == 'ignore')
    stale = sum(1 for r in recs if r.get('verdict') == 'stale')
    labeled = acc + dis + ign or 1
    board = {
        'period': 'last_7_days' if week else 'all_time',
        'generated_at': datetime.now().isoformat(),
        'adoption_rate': acc / labeled,
        'false_positive_rate': dis / labeled,
        'stale_rate': stale / (labeled + stale) if (labeled + stale) else 0,
        'counts': {'accept': acc, 'dismiss': dis, 'ignore': ign, 'stale': stale},
        'scans': len(costs),
        'avg_tokens_incremental': (
            sum(c.get('tokens', 0) for c in costs if c.get('scan_type') == 'incremental')
            / max(1, sum(1 for c in costs if c.get('scan_type') == 'incremental'))),
        'avg_tokens_full': (
            sum(c.get('tokens', 0) for c in costs if c.get('scan_type') == 'full')
            / max(1, sum(1 for c in costs if c.get('scan_type') == 'full'))),
        'targets': {'adoption_rate_min': 0.40, 'false_positive_rate_max': 0.30,
                    'incremental_token_budget': 20000},
        'console': text,
    }
    os.makedirs(data_dir(), exist_ok=True)
    path = data_dir('metrics_dashboard.json')
    json.dump(board, open(path, 'w'), ensure_ascii=False, indent=2)
    md = data_dir('metrics_dashboard.md')
    open(md, 'w').write(
        '# AI Defect Detection — Weekly Metrics Board\n\n'
        '- period: %s\n'
        '- adoption_rate: %.0f%% (target ≥40%%)\n'
        '- false_positive_rate: %.0f%% (target ≤30%%)\n'
        '- stale_rate: %.0f%%\n'
        '- avg_tokens incremental: %.0f / full: %.0f\n\n'
        '```\n%s```\n' % (
            board['period'], 100 * board['adoption_rate'],
            100 * board['false_positive_rate'], 100 * board['stale_rate'],
            board['avg_tokens_incremental'], board['avg_tokens_full'], text))
    print('dashboard -> %s , %s' % (path, md))
    print(text)

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p1 = sub.add_parser('record')
    p1.add_argument('--title', required=True)
    p1.add_argument('--verdict', choices=['accept', 'dismiss', 'ignore'], required=True)
    p1.add_argument('--file', default='')
    p1.add_argument('--category', default='')
    p1.add_argument('--id', default='')
    p1.add_argument('--rule-id', default='', help='LLM policy id e.g. CONC-001')
    p2 = sub.add_parser('filter-known')
    p2.add_argument('findings_file')
    p2.add_argument('--threshold', type=float, default=None)
    p3 = sub.add_parser('stats')
    p3.add_argument('--week', action='store_true')
    p4 = sub.add_parser('mark-stale')
    p4.add_argument('--title', required=True)
    p5 = sub.add_parser('record-cost')
    p5.add_argument('--scan-type', required=True)
    p5.add_argument('--tokens', type=int, required=True)
    p5.add_argument('--findings', type=int, default=0)
    p5.add_argument('--diff-hash', default='')
    p6 = sub.add_parser('dashboard')
    p6.add_argument('--week', action='store_true', default=True)
    p6.add_argument('--all-time', action='store_true')
    args = ap.parse_args()
    if args.cmd == 'record':
        record(args.title, args.verdict, args.file, args.category, args.id,
               rule_id=getattr(args, 'rule_id', '') or '')
    elif args.cmd == 'filter-known':
        filter_known(args.findings_file, args.threshold)  # Stage1/Stage2 hard-filter
    elif args.cmd == 'stats':
        stats(week=args.week)
    elif args.cmd == 'mark-stale':
        mark_stale(args.title)
    elif args.cmd == 'record-cost':
        record_scan_cost(args.scan_type, args.tokens, args.findings, args.diff_hash)
        print('cost recorded')
    elif args.cmd == 'dashboard':
        dashboard(week=not args.all_time)

if __name__ == '__main__':
    main()
