#!/usr/bin/env python3
"""
Load LLM semantic policy pack from references/policies/.

Pack layout:
  manifest.yaml          — pack version + rule id list
  <RULE_ID>.yaml         — policy + embedded positive/negative fixtures

Used by run_scan (prompt injection) and audit_policy_fixtures (regression).
"""
import os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import skill_dir

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

RULE_ID_RE = re.compile(r'^[A-Z]{2,8}-\d{3}$')
REQUIRED_FIELDS = ('id', 'version', 'status', 'category', 'severity_default', 'title', 'look_for')


def policies_dir():
    return os.path.join(skill_dir(), 'references', 'policies')


def _load_yaml(path):
    if yaml is None:
        raise RuntimeError('PyYAML required to load policies (pip install pyyaml)')
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def load_manifest(root=None):
    root = root or policies_dir()
    path = os.path.join(root, 'manifest.yaml')
    if not os.path.isfile(path):
        raise FileNotFoundError('policy manifest missing: %s' % path)
    m = _load_yaml(path)
    if not m.get('version'):
        raise ValueError('manifest.version required')
    if not m.get('rules'):
        raise ValueError('manifest.rules required')
    return m


def load_policy(rule_id, root=None):
    root = root or policies_dir()
    path = os.path.join(root, '%s.yaml' % rule_id)
    if not os.path.isfile(path):
        raise FileNotFoundError('policy file missing: %s' % path)
    p = _load_yaml(path)
    if p.get('id') != rule_id:
        raise ValueError('id mismatch in %s: got %r' % (path, p.get('id')))
    return p


def validate_policy(p, prefixes=None):
    errs = []
    for k in REQUIRED_FIELDS:
        if not p.get(k) and p.get(k) != 0:
            errs.append('missing field: %s' % k)
    rid = p.get('id') or ''
    if not RULE_ID_RE.match(str(rid)):
        errs.append('invalid rule_id format: %s (expect PREFIX-NNN)' % rid)
    if p.get('status') not in ('active', 'deprecated', 'retired'):
        errs.append('invalid status: %s' % p.get('status'))
    if p.get('severity_default') not in ('P0', 'P1', 'P2', 'P3'):
        errs.append('invalid severity_default: %s' % p.get('severity_default'))
    if prefixes and rid:
        pref = rid.split('-')[0]
        want = prefixes.get(pref)
        if want and p.get('category') != want:
            errs.append('category %s does not match prefix %s→%s'
                        % (p.get('category'), pref, want))
    fixtures = p.get('fixtures') or {}
    for kind in ('positive', 'negative'):
        cases = fixtures.get(kind) or []
        if not cases:
            errs.append('missing fixtures.%s' % kind)
            continue
        for i, c in enumerate(cases):
            if not (c.get('code') or '').strip():
                errs.append('fixtures.%s[%d] missing code' % (kind, i))
            exp = c.get('expect') or {}
            if 'should_find' not in exp:
                errs.append('fixtures.%s[%d] expect.should_find required' % (kind, i))
            elif kind == 'positive' and not exp.get('should_find'):
                errs.append('fixtures.%s[%d] positive must should_find=true' % (kind, i))
            elif kind == 'negative' and exp.get('should_find'):
                errs.append('fixtures.%s[%d] negative must should_find=false' % (kind, i))
    return errs


def load_all_policies(root=None, include_retired=False):
    root = root or policies_dir()
    manifest = load_manifest(root)
    prefixes = manifest.get('prefixes') or {}
    policies = []
    errors = []
    for rid in manifest.get('rules') or []:
        try:
            p = load_policy(rid, root=root)
        except (OSError, ValueError, FileNotFoundError) as e:
            errors.append('%s: %s' % (rid, e))
            continue
        errs = validate_policy(p, prefixes=prefixes)
        if errs:
            errors.append('%s: %s' % (rid, '; '.join(errs)))
            continue
        if p.get('status') == 'retired' and not include_retired:
            continue
        policies.append(p)
    return {
        'manifest': manifest,
        'version': manifest.get('version'),
        'pack_id': manifest.get('pack_id'),
        'policies': policies,
        'errors': errors,
    }


def active_policies(root=None):
    pack = load_all_policies(root=root)
    return [p for p in pack['policies'] if p.get('status') == 'active']


def render_policies_for_prompt(policies=None, max_chars=24000):
    """Compact markdown injected into SYSTEM_BASE / Stage prompts."""
    policies = policies if policies is not None else active_policies()
    lines = [
        '# LLM semantic policies (cite rule_id when matching)',
        'When a finding matches a policy below, set finding.rule_id to that id '
        '(e.g. CONC-001). If no policy fits, omit rule_id or use empty string.',
        '',
    ]
    for p in policies:
        block = [
            '## %s — %s' % (p['id'], p['title']),
            '- category: %s | default_severity: %s | status: %s | policy_ver: %s'
            % (p['category'], p['severity_default'], p['status'], p.get('version', 1)),
            '- look_for: %s' % (p.get('look_for') or '').strip().replace('\n', ' '),
            '- do_not_report: %s' % (p.get('do_not_report') or '').strip().replace('\n', ' '),
        ]
        if p.get('suggestion_hint'):
            block.append('- suggestion_hint: %s' % p['suggestion_hint'].strip())
        # one short fixture hint each
        fx = p.get('fixtures') or {}
        pos = (fx.get('positive') or [None])[0]
        neg = (fx.get('negative') or [None])[0]
        if pos and pos.get('code'):
            snippet = pos['code'].strip().splitlines()[0][:80]
            block.append('- positive_hint: `%s` …' % snippet)
        if neg and neg.get('code'):
            snippet = neg['code'].strip().splitlines()[0][:80]
            block.append('- negative_hint: `%s` …' % snippet)
        block.append('')
        lines.extend(block)
    text = '\n'.join(lines)
    if len(text) > max_chars:
        text = text[:max_chars] + '\n… [policies truncated for token budget]\n'
    return text


def pack_meta_for_report(root=None):
    pack = load_all_policies(root=root, include_retired=True)
    return {
        'pack_id': pack.get('pack_id'),
        'version': pack.get('version'),
        'rule_count_active': sum(1 for p in pack['policies'] if p.get('status') == 'active'),
        'rule_ids': [p['id'] for p in pack['policies'] if p.get('status') == 'active'],
        'errors': pack.get('errors') or [],
    }


def known_rule_ids(root=None):
    pack = load_all_policies(root=root, include_retired=True)
    return {p['id'] for p in pack['policies']}


def iter_fixtures(root=None, status='active'):
    """Yield (policy, kind, case) for regression."""
    pack = load_all_policies(root=root, include_retired=(status != 'active'))
    for p in pack['policies']:
        if status == 'active' and p.get('status') != 'active':
            continue
        fx = p.get('fixtures') or {}
        for kind in ('positive', 'negative'):
            for case in fx.get(kind) or []:
                yield p, kind, case
