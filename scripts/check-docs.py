"""Check local Markdown file links and skill registry entries; no network access."""
import json
import re
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parents[1]
errors = []
# Agent reference syntax is not a documentation link contract; check reader-facing docs.
paths = list(root.glob('*.md')) + list((root / 'docs').glob('*.md')) + list((root / 'examples').rglob('*.md')) + [root / 'skills/README.md', root / 'skills/ai-defect-detection/README.md']
for p in paths:
    for target in re.findall(r'\]\(([^\s)]+)\)', p.read_text()):
        if '://' in target or target.startswith(('#', 'mailto:')):
            continue
        target = unquote(target.split('#')[0])
        if target and not (p.parent / target).exists():
            errors.append(f'{p.relative_to(root)}: missing {target}')
registry = json.loads((root / 'skills.json').read_text())
names = set()
for item in registry['skills']:
    name = item['name']
    directory = root / item['path']
    if name in names:
        errors.append(f'duplicate skill: {name}')
    names.add(name)
    entry = directory / 'SKILL.md'
    if not entry.exists() or not re.search(r'^name:\s*' + re.escape(name) + r'\s*$', entry.read_text(), re.M):
        errors.append(f'{name}: missing or mismatched SKILL.md')
    if directory.name != name or not (directory / 'README.md').exists():
        errors.append(f'{name}: missing README or mismatched directory')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: {len(paths)} reader documents and {len(names)} skill registry entries (file links only; anchors/external URLs not checked)')
