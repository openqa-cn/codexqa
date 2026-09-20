#!/usr/bin/env python3
"""Route each Stage-1 finding to small/large model; P0/P1 always large."""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load_config

def route(cfg, category, severity=None):
    force = set(cfg.get('force_large_severities', ['P0', 'P1']))
    if severity in force:
        return 'large'
    for rule in cfg['model_routing']:
        if rule.get('default'):
            continue
        if category in rule.get('match', []):
            return rule['model']
    for rule in cfg['model_routing']:
        if rule.get('default'):
            return rule['model']
    return 'small'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-i', '--input', required=True)
    ap.add_argument('-o', '--output', default='/tmp/aid_routed.json')
    args = ap.parse_args()
    cfg = load_config()
    data = json.load(open(args.input))
    findings = data['findings'] if isinstance(data, dict) else data
    for f in findings:
        f['model_tier'] = route(cfg, f.get('category', ''), f.get('severity'))
    json.dump({'findings': findings}, open(args.output, 'w'), ensure_ascii=False, indent=1)
    large = [f for f in findings if f['model_tier'] == 'large']
    print('routed %d findings (%d -> large model) -> %s' % (len(findings), len(large), args.output))

if __name__ == '__main__':
    main()
