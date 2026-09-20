#!/usr/bin/env python3
"""
Ingest user-uploaded files or pasted code into a temporary git workspace
so existing incremental / full scan pipelines can run unchanged.

Inputs (any combination):
  --files a.py b/c.go          copy paths into workspace (preserve basenames or --keep-tree)
  --from-dir DIR               copy a directory tree of uploaded code
  --paste-file PATH            raw pasted source (one snippet)
  --as NAME                    filename for paste (default: infer from --lang)
  --lang python|js|go|…        language hint for paste / stdin
  --manifest JSON|@file.json   [{"path":"x.py","content":"..."}, ...]
  --stdin                      read one paste from stdin (use with --as / --lang)
  --intent TEXT                stored for later collect
  -o DIR                       workspace root (default: under data/adhoc/<stamp>)

Creates:
  - empty baseline commit (tree empty)
  - second commit with all ingested files
→ `collect_incremental` sees everything as added vs base; `collect_full` scans whole tree.

Prints JSON: {"workspace": "...", "files": [...], "base": "<sha>", "head": "HEAD", ...}
"""
import argparse, json, os, re, shutil, subprocess, sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import AID_SCAN_META, data_dir, normalize_language_id, skill_dir

LANG_EXT = {
    'python': '.py', 'py': '.py',
    'javascript': '.js', 'js': '.js', 'typescript': '.ts', 'ts': '.ts',
    'tsx': '.tsx', 'jsx': '.jsx',
    'java': '.java', 'go': '.go', 'rust': '.rs', 'rs': '.rs',
    'c': '.c', 'cpp': '.cpp', 'cc': '.cpp',
    'ruby': '.rb', 'rb': '.rb', 'php': '.php',
    'kotlin': '.kt', 'kt': '.kt', 'swift': '.swift', 'scala': '.scala',
}


def _git(cwd, *args):
    return subprocess.run(['git', '-C', cwd, *args], capture_output=True, text=True)


def _infer_lang(text):
    t = text or ''
    if re.search(r'^\s*(def |class |import |from \w+ import)', t, re.M):
        return 'python'
    if re.search(r'^\s*(func |package )', t, re.M):
        return 'go'
    if re.search(r'^\s*(public |private |class |import java)', t, re.M):
        return 'java'
    if re.search(r'^\s*(export |const |function |import )', t, re.M):
        return 'typescript' if 'interface ' in t or ': ' in t[:500] else 'javascript'
    return 'python'


def _safe_rel(path):
    p = path.replace('\\', '/').lstrip('/')
    parts = [x for x in p.split('/') if x not in ('', '.', '..')]
    return '/'.join(parts) or 'snippet.txt'


def _write(ws, rel, content):
    rel = _safe_rel(rel)
    full = os.path.join(ws, rel)
    os.makedirs(os.path.dirname(full) or ws, exist_ok=True)
    with open(full, 'w', encoding='utf-8', errors='replace') as f:
        f.write(content if content.endswith('\n') else content + '\n')
    return rel


def _copy_file(ws, src, keep_tree=False, dest_name=None):
    src = os.path.abspath(src)
    if not os.path.isfile(src):
        raise FileNotFoundError('not a file: %s' % src)
    if dest_name:
        rel = _safe_rel(dest_name)
    elif keep_tree:
        try:
            cand = os.path.relpath(src, os.getcwd())
            if cand.startswith('..') or os.path.isabs(cand):
                rel = _safe_rel(os.path.basename(src))
            else:
                rel = _safe_rel(cand)
        except ValueError:
            rel = _safe_rel(os.path.basename(src))
    else:
        rel = _safe_rel(os.path.basename(src))
    dest = os.path.join(ws, rel)
    os.makedirs(os.path.dirname(dest) or ws, exist_ok=True)
    shutil.copy2(src, dest)
    return rel


def _copy_tree(ws, src_dir):
    src_dir = os.path.abspath(src_dir)
    written = []
    for root, dirs, names in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'vendor', '__pycache__')]
        for n in names:
            full = os.path.join(root, n)
            rel = _safe_rel(os.path.relpath(full, src_dir))
            dest = os.path.join(ws, rel)
            os.makedirs(os.path.dirname(dest) or ws, exist_ok=True)
            shutil.copy2(full, dest)
            written.append(rel)
    return written


def load_manifest(arg):
    if arg.startswith('@'):
        raw = open(arg[1:], encoding='utf-8').read()
    elif os.path.isfile(arg):
        raw = open(arg, encoding='utf-8').read()
    else:
        raw = arg
    data = json.loads(raw)
    if isinstance(data, dict) and 'files' in data:
        data = data['files']
    if not isinstance(data, list):
        raise ValueError('manifest must be a list of {path, content}')
    return data


def build_workspace(args):
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    ws = args.output or data_dir('adhoc', 'ws_%s' % stamp)
    if os.path.exists(ws) and os.listdir(ws):
        raise SystemExit('workspace not empty: %s (pass a fresh -o)' % ws)
    os.makedirs(ws, exist_ok=True)

    files = []

    if args.from_dir:
        files += _copy_tree(ws, args.from_dir)

    keep_tree = bool(getattr(args, 'keep_tree', False))
    include_companions = not getattr(args, 'no_companions', False)
    for src in args.files or []:
        files.append(_copy_file(ws, src, keep_tree=keep_tree))
        if include_companions and src.lower().endswith((
                '.java', '.kt', '.kts', '.scala', '.js', '.ts', '.py', '.go')):
            src_dir = os.path.dirname(os.path.abspath(src))
            for name in ('pom.xml', 'build.gradle', 'build.gradle.kts', 'package.json',
                         'package-lock.json', 'go.mod', 'requirements.txt'):
                companion = os.path.join(src_dir, name)
                if os.path.isfile(companion):
                    rel = _safe_rel(name)
                    dest = os.path.join(ws, rel)
                    if not os.path.exists(dest):
                        os.makedirs(os.path.dirname(dest) or ws, exist_ok=True)
                        shutil.copy2(companion, dest)
                        files.append(rel)

    if args.manifest:
        for item in load_manifest(args.manifest):
            path = item.get('path') or item.get('file') or 'snippet.txt'
            content = item.get('content') or item.get('text') or ''
            files.append(_write(ws, path, content))

    paste_text = None
    if args.paste_file:
        paste_text = open(args.paste_file, encoding='utf-8', errors='replace').read()
    elif args.stdin:
        paste_text = sys.stdin.read()

    if paste_text is not None:
        name = args.as_name
        if not name:
            lang = (args.lang or _infer_lang(paste_text)).lower()
            ext = LANG_EXT.get(lang, '.txt')
            name = 'snippet%s' % ext
        files.append(_write(ws, name, paste_text))

    # de-dupe preserve order
    seen, uniq = set(), []
    for f in files:
        if f not in seen:
            seen.add(f); uniq.append(f)
    files = uniq
    if not files:
        raise SystemExit(
            'no code ingested — provide --files / --from-dir / --paste-file / --manifest / --stdin')

    # git: empty baseline then content commit (enables incremental vs empty tree)
    _git(ws, 'init')
    _git(ws, 'config', 'user.email', 'adhoc@defect-detection.local')
    _git(ws, 'config', 'user.name', 'defect-detection-adhoc')
    # empty commit as base
    _git(ws, 'commit', '--allow-empty', '-m', 'adhoc baseline (empty)')
    base = _git(ws, 'rev-parse', 'HEAD').stdout.strip()
    _git(ws, 'add', '-A')
    _git(ws, 'commit', '-m', 'adhoc ingest %d files' % len(files))
    head = _git(ws, 'rev-parse', 'HEAD').stdout.strip()

    meta = {
        'workspace': os.path.abspath(ws),
        'scan_source': 'adhoc',
        'files': files,
        'file_count': len(files),
        'base': base,
        'head': head,
        'intent': args.intent or 'adhoc upload/paste defect scan',
        'created_at': datetime.now().isoformat(),
        'skill_dir': skill_dir(),
    }
    lang = normalize_language_id(getattr(args, 'lang', None))
    if not lang and files:
        # Infer from majority extension among ingested files
        from lib import CODE_LANG_BY_EXT
        c = {}
        for f in files:
            lang_i = CODE_LANG_BY_EXT.get(os.path.splitext(f)[1].lower())
            if lang_i:
                c[lang_i] = c.get(lang_i, 0) + 1
        if c:
            lang = max(c.items(), key=lambda kv: kv[1])[0]
    if lang:
        meta['primary_language'] = lang
        json.dump({'primary_language': lang, 'source': 'adhoc'},
                  open(os.path.join(ws, AID_SCAN_META), 'w'), ensure_ascii=False, indent=2)
    meta_path = os.path.join(ws, '.aid_adhoc.json')
    json.dump(meta, open(meta_path, 'w'), ensure_ascii=False, indent=2)
    return meta


def main():
    ap = argparse.ArgumentParser(description='Ingest upload/paste code into adhoc git workspace')
    ap.add_argument('--files', nargs='*', default=[])
    ap.add_argument('--keep-tree', action='store_true',
                    help='with --files, preserve paths relative to cwd (default: basename only)')
    ap.add_argument('--no-companions', action='store_true',
                    help='do not auto-include pom.xml/build.gradle/package.json from source dirs')
    ap.add_argument('--from-dir', default=None)
    ap.add_argument('--paste-file', default=None)
    ap.add_argument('--stdin', action='store_true')
    ap.add_argument('--as', dest='as_name', default=None, help='filename for paste')
    ap.add_argument('--lang', default=None)
    ap.add_argument('--manifest', default=None, help='JSON list or @path.json')
    ap.add_argument('--intent', default='')
    ap.add_argument('-o', '--output', default=None)
    args = ap.parse_args()
    meta = build_workspace(args)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    print('INGEST_OK workspace=%s files=%d base=%s' % (
        meta['workspace'], meta['file_count'], meta['base'][:12]), file=sys.stderr)


if __name__ == '__main__':
    main()
