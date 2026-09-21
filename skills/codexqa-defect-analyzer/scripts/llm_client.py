#!/usr/bin/env python3
"""OpenAI-compatible LLM client (optional --llm-mode api) + heuristic dry-run mock.

Default skill path does NOT use this client — the invoking agent model writes
findings into the agent_llm bundle (see agent_llm.py / run_scan agent-stage2).
"""
import json, os, re, urllib.request

class LLMClient:
    def __init__(self, dry_run=False):
        self.base = os.environ.get('LLM_BASE_URL', '').rstrip('/')
        self.key = os.environ.get('LLM_API_KEY', '')
        self.small = os.environ.get('LLM_MODEL_SMALL', 'deepseek-chat')
        self.large = os.environ.get('LLM_MODEL_LARGE', 'deepseek-chat')
        self.dry_run = dry_run or not (self.base and self.key)

    def model_name(self, tier):
        return self.small if tier == 'small' else self.large

    def chat(self, tier, prompt, temperature=0.2):
        if self.dry_run:
            return mock_review(prompt)
        req = urllib.request.Request(
            self.base + '/v1/chat/completions',
            data=json.dumps({'model': self.model_name(tier),
                             'messages': [{'role': 'user', 'content': prompt}],
                             'temperature': temperature}).encode(),
            headers={'Content-Type': 'application/json',
                     'Authorization': 'Bearer ' + self.key})
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        return data['choices'][0]['message']['content']

def extract_json(text):
    """Tolerant JSON extraction: find the first balanced {...} or [...]."""
    if not text:
        return None
    m = re.search(r'\{.*\}', text, re.S) or re.search(r'\[.*\]', text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None

MOCK_RULES = [
    (r'\beval\s*\(', 'security', 'P0',
     'eval() executes dynamic input — RCE risk',
     'Replace eval with a safe parser/whitelist dispatch.'),
    (r'\bexec\s*\(', 'security', 'P1',
     'exec() executes dynamic input — RCE risk',
     'Replace exec with explicit function calls.'),
    (r'shell\s*=\s*True', 'secret', 'P1',
     'subprocess with shell=True and possible dynamic input',
     'Use shell=False with argument list.'),
    (r'(password|passwd|secret|api_key|token)\s*=\s*["\'][^"\']+["\']', 'secret', 'P0',
     'Hardcoded credential in source',
     'Move to env/secret manager; rotate the exposed value.'),
    (r'(["\'][^"\']*SELECT[^"\']*["\']\s*%)', 'security', 'P0',
     'String-formatted SQL — SQL injection risk',
     'Use parameterized queries.'),
    (r'\bopen\s*\([^)]+\)', 'resource_leak', 'P1',
     'File opened without obvious close/with context',
     'Use a context manager (with open(...)) or close in finally.'),
    (r'\b(TODO|FIXME)\b', 'todo', 'P3',
     'TODO/FIXME left in changed code', 'Resolve or ticket it.'),
    (r'\bprint\s*\([^)]*(password|token|secret)', 'secret', 'P1',
     'Sensitive data printed to stdout', 'Remove or redact the log.'),
]

def mock_review(prompt):
    """Heuristic offline responder for findings or module summaries."""
    if 'summarizing a module shard' in prompt.lower() or 'deep_review_files' in prompt:
        return mock_summary(prompt)
    # Only scan code context regions, not system/category prose (avoids false hits).
    regions = []
    for m in re.finditer(
            r'### (?:FILE|HOT/DEEP FILE|LINKED FILE|RAG MODULE SUMMARY):\s*(\S+)([\s\S]*?)(?=### |\Z)',
            prompt):
        regions.append((m.group(1), m.start(), m.group(0)))
    if not regions:
        # fallback: whole prompt but require a path guess
        regions = [(None, 0, prompt)]
    findings, seen = [], set()
    for pat, cat, sev, title, sug in MOCK_RULES:
        for fpath, base_pos, region in regions:
            m = re.search(pat, region, re.I)
            if not m:
                continue
            path = fpath or _guess_file(prompt, base_pos + m.start())
            if not path or path == 'unknown':
                continue
            line_no = _guess_line_in_diff(region, m.start(), path) or 1
            key = (path, title)
            if key in seen:
                continue
            seen.add(key)
            findings.append({'file': path, 'line': line_no, 'category': cat,
                             'severity': sev, 'title': title,
                             'evidence': 'mock-heuristic matched pattern %r near changed code' % pat,
                             'suggestion': sug, 'confidence': 0.5})
            break
    return json.dumps({'findings': findings}, ensure_ascii=False)

def mock_summary(prompt):
    files = re.findall(r'"path":\s*"([^"]+)"', prompt)
    hot = files[:5] if files else []
    mod = re.search(r'Module:\s*(\S+)', prompt)
    return json.dumps({
        'summary': 'Mock module summary for %s: review hot/changed surfaces for security and resource hygiene.'
                   % (mod.group(1) if mod else 'module'),
        'deep_review_files': hot,
        'architecture_concerns': ['check cross-module imports if fan-in grows'],
    }, ensure_ascii=False)

def _guess_file(prompt, pos):
    markers = [(m.start(), m.group(1)) for m in
               re.finditer(r'### (?:FILE|HOT/DEEP FILE|LINKED FILE|RAG MODULE SUMMARY):\s*(\S+)', prompt)
               if m.start() <= pos]
    return markers[-1][1] if markers else None

def _guess_line_in_diff(prompt, pos, fpath):
    """Infer new-file line from nearest unified-diff hunk header before match."""
    window = prompt[max(0, pos - 4000):pos]
    hunks = list(re.finditer(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', window))
    if not hunks:
        # fall back: count +lines after last hunk in full prompt for this file section
        return 1
    start_new = int(hunks[-1].group(1))
    after = window[hunks[-1].end():]
    delta = 0
    for line in after.splitlines():
        if line.startswith('+') and not line.startswith('+++'):
            delta += 1
        elif line.startswith(' ') or (line.startswith('+') is False and line.startswith('-') is False and line.startswith('@')):
            if line.startswith('-'):
                continue
            if line.startswith(' '):
                delta += 1
    # count added/context lines between hunk and match roughly
    add_or_ctx = 0
    for line in after.splitlines():
        if line.startswith('@@'):
            break
        if line.startswith('-'):
            continue
        add_or_ctx += 1
    return max(1, start_new + max(0, add_or_ctx - 1))
