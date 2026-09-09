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
paths = list(root.glob('*.md')) + list((root / 'docs').glob('*.md')) + list((root / 'examples').rglob('*.md')) + [root / 'skills/README.md', root / 'skills/README.zh-CN.md', root / 'skills/defect-detection/README.md', root / 'skills/code-reviewer/README.md', root / 'skills/requirements-analyzer/README.md', root / 'skills/testcase-generation/README.md', root / 'skills/testdata-generation/README.md']
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
# Translations drift silently and the gap lands on trust content: the Chinese README
# pointed at an FAQ answer the Chinese FAQ never had. Compare `## ` counts per
# language pair; a file that is deliberately shorter has to say so here, so a gap
# stays visible instead of disappearing.
translation_gaps = {
    'CONTRIBUTING.zh-CN.md': 'short summary; the full process is English-only',
    'skills/defect-detection/README.zh-CN.md': 'operator sections not translated yet',
    'skills/testdata-generation/HOW_IT_WORKS.zh-CN.md': 'appendices not translated yet',
}
declared_gaps = 0
for zh in sorted(root.rglob('*.zh-CN.md')):
    rel = zh.relative_to(root).as_posix()
    if 'node_modules' in zh.parts or '/data/' in f'/{rel}':
        continue
    en = zh.with_name(zh.name.replace('.zh-CN.md', '.md'))
    if not en.exists():
        errors.append(f'{rel}: no English source ({en.name})')
        continue
    counts = [len(re.findall(r'^## ', p.read_text(), re.M)) for p in (en, zh)]
    if counts[0] == counts[1]:
        if rel in translation_gaps:
            errors.append(f'{rel}: sections now match {en.name}; drop the translation_gaps entry')
        continue
    if rel in translation_gaps:
        declared_gaps += 1
        continue
    errors.append(f'{rel}: {counts[1]} sections vs {counts[0]} in {en.name} (translate it, or declare it in translation_gaps)')
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
print(f'PASS: {len(paths)} reader documents, {skill_docs} skill documents (no link escapes the skill directory), {len(names)} skill registry entries, {declared_gaps} declared translation gaps (file links only; anchors/external URLs not checked)')
