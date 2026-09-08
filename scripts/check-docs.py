"""Check local Markdown file links and skill registry entries; no network access."""
import json
import re
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parents[1]
errors = []


def file_links(path):
    """Local file targets in a Markdown file, skipping URLs, anchors and template placeholders."""
    for target in re.findall(r'\]\(([^\s)]+)\)', path.read_text()):
        if '://' in target or target.startswith(('#', 'mailto:')):
            continue
        # `{reportUrl}` and bare words like `url` are illustrative placeholders, not links.
        if '{' in target or '}' in target:
            continue
        target = unquote(target.split('#')[0])
        if not target or ('/' not in target and '.' not in target):
            continue
        yield target


# Agent reference syntax is not a documentation link contract; check reader-facing docs.
paths = list(root.glob('*.md')) + list((root / 'docs').glob('*.md')) + list((root / 'examples').rglob('*.md')) + [root / 'skills/README.md', root / 'skills/defect-detection/README.md', root / 'skills/code-reviewer/README.md', root / 'skills/requirements-analyzer/README.md', root / 'skills/testcase-generation/README.md', root / 'skills/testdata-generation/README.md']
for p in paths:
    for target in file_links(p):
        if not (p.parent / target).exists():
            errors.append(f'{p.relative_to(root)}: missing {target}')
# A skill is installed on its own: `npx skills add` copies only skills/<name>/.
# A relative link that escapes that directory resolves in-repo but breaks after
# install, so cross-boundary references must be absolute URLs.
skill_docs = 0
for skill_dir in sorted((root / 'skills').iterdir()):
    if not skill_dir.is_dir():
        continue
    skill_root = skill_dir.resolve()
    for p in sorted(skill_dir.rglob('*.md')):
        rel = p.relative_to(skill_dir)
        if rel.parts[0] in ('data', 'node_modules') or 'node_modules' in rel.parts:
            continue
        skill_docs += 1
        for target in file_links(p):
            resolved = (p.parent / target).resolve()
            try:
                resolved.relative_to(skill_root)
            except ValueError:
                errors.append(f'{p.relative_to(root)}: link escapes the skill directory and will break after install: {target} (use an absolute GitHub URL)')
                continue
            if not resolved.exists():
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
print(f'PASS: {len(paths)} reader documents, {skill_docs} skill documents (no link escapes the skill directory), {len(names)} skill registry entries (file links only; anchors/external URLs not checked)')
