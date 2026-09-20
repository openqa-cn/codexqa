#!/usr/bin/env python3
"""
Scan scope planner — narrows full/incremental analysis to first-party application logic.

Algorithm sources (see references/scope_policy.yaml):
  1. Polyglot project-root detection via manifest markers; deepest root owns file
     (Cascade / projectdetect pattern).
  2. SonarQube-style layered filters: global exclude → test exclude → role gate;
     inclusions only shrink the set (never expand).
  3. Semgrep monorepo --include: emit scan roots as application/library project dirs.
  4. CodeQL paths-ignore: drop vendor/generated/dist and test/fixture trees.
  5. Sonatype reachability: prioritize deployable application/service projects over
     docs/infra/tooling; optional fan_in boost from CodexQA graph.
"""

import fnmatch
import json
import os
import re
import sys
from dataclasses import dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import CODE_EXT, is_excluded, load_config, skill_dir

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

ALGO_VERSION = 'aid-scope-v1.0.0'

SOURCES = [
    'sonarqube-analysis-scope (inclusions/exclusions reduce-only)',
    'semgrep-monorepo-include-subdir',
    'codeql-paths-paths-ignore',
    'sonatype-reachability-app-sources-excludes',
    'cascade-deepest-project-root',
]


@dataclass
class ProjectRoot:
    path: str          # relative dir, '' for repo root
    ecosystem: str
    role: str
    manifest: str
    workspace_member: bool = False


@dataclass
class ScopePlan:
    algorithm: str
    sources: list
    repo: str
    projects: list
    include_roots: list
    include_files: list
    exclude_globs: list
    semgrep_include_dirs: list
    stats: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)

    def to_dict(self):
        return {
            'algorithm': self.algorithm,
            'sources': self.sources,
            'repo': self.repo,
            'projects': self.projects,
            'include_roots': self.include_roots,
            'include_files': self.include_files,
            'exclude_globs': self.exclude_globs,
            'semgrep_include_dirs': self.semgrep_include_dirs,
            'stats': self.stats,
            'notes': self.notes,
        }


def _load_scope_policy():
    path = os.path.join(skill_dir(), 'references', 'scope_policy.yaml')
    if yaml is None or not os.path.isfile(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def _read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _glob_match(path, patterns):
    p = path.replace(os.sep, '/')
    for pat in patterns or []:
        if fnmatch.fnmatch(p, pat) or fnmatch.fnmatch(os.path.basename(p), pat):
            return True
    return False


def _prefix_match(path, prefixes):
    p = path.replace(os.sep, '/')
    for pref in prefixes or []:
        pref = pref.replace(os.sep, '/')
        if not pref.endswith('/'):
            pref += '/'
        if p.startswith(pref) or p == pref.rstrip('/'):
            return True
    return False


def _dir_has_manifest(repo, rel_dir, marker_files):
    base = os.path.join(repo, rel_dir) if rel_dir else repo
    for mf in marker_files:
        if '*' in mf:
            continue
        if os.path.isfile(os.path.join(base, mf)):
            return mf
    return None


def _detect_ecosystem(repo, rel_dir, policy):
    markers = (policy.get('manifest_markers') or {})
    for eco, spec in markers.items():
        mf = _dir_has_manifest(repo, rel_dir, spec.get('files') or [])
        if mf:
            return eco, mf
    return None, None


def _read_package_json(repo, rel_dir):
    base = os.path.join(repo, rel_dir) if rel_dir else repo
    path = os.path.join(base, 'package.json')
    return _read_json(path) or {}


def _pnpm_workspace_packages(repo):
    path = os.path.join(repo, 'pnpm-workspace.yaml')
    if not os.path.isfile(path):
        return []
    try:
        text = open(path, encoding='utf-8').read()
    except OSError:
        return []
    pkgs = []
    for line in text.splitlines():
        m = re.match(r'^\s*-\s*[\'"]?([^\'"#]+)', line)
        if m:
            pkgs.append(m.group(1).strip().strip("'\""))
    return pkgs


def _npm_workspaces(repo):
    pkg = _read_package_json(repo, '')
    ws = pkg.get('workspaces')
    if isinstance(ws, list):
        return ws
    if isinstance(ws, dict):
        return list(ws.get('packages') or [])
    return []


def _expand_workspace_members(repo, policy):
    members = set()
    for fn in policy.get('workspace_markers') or []:
        if os.path.isfile(os.path.join(repo, fn)):
            members.update(_pnpm_workspace_packages(repo))
            members.update(_npm_workspaces(repo))
            break
    # Normalize globs like packages/* → packages/<name> by scanning one level
    expanded = set()
    for m in members:
        m = m.strip().strip('"\'')
        if m.endswith('/*') or m.endswith('/**'):
            parent = m.rstrip('*').rstrip('/')
            parent_abs = os.path.join(repo, parent)
            if os.path.isdir(parent_abs):
                for name in os.listdir(parent_abs):
                    sub = os.path.join(parent_abs, name)
                    if os.path.isdir(sub):
                        expanded.add(os.path.join(parent, name).replace(os.sep, '/'))
            else:
                expanded.add(parent)
        else:
            expanded.add(m.replace(os.sep, '/'))
    return expanded


def _classify_role(rel_dir, repo, eco, policy, workspace_members):
    p = rel_dir.replace(os.sep, '/')
    base = os.path.basename(p) if p else ''
    non_app = policy.get('non_app_path_prefixes') or []

    if _prefix_match(p + '/', non_app) or p in [x.rstrip('/') for x in non_app]:
        if 'legacy' in p:
            return 'legacy'
        if p.startswith('docs') or '/docs/' in p:
            return 'docs'
        return 'tooling'

    if base in ('test', 'tests', '__tests__', 'spec', 'specs', 'fixtures', 'mocks'):
        return 'test'

    # Semgrep/CodeQL monorepo convention: apps/* = deployable application modules
    if p == 'apps' or p.startswith('apps/'):
        return 'application'
    if p.startswith('apps/') and eco == 'node':
        return 'application'

    if p == 'packages' or p.startswith('packages/'):
        return 'library'

    if p.startswith('services/') or p.startswith('service/'):
        return 'service'

    if p in workspace_members or any(p.startswith(m + '/') for m in workspace_members):
        pkg = _read_package_json(repo, p)
        scripts = pkg.get('scripts') or {}
        deps = pkg.get('dependencies') or {}
        if any(k in scripts for k in ('start', 'serve', 'dev', 'build')):
            return 'application'
        if pkg.get('main') or pkg.get('bin'):
            return 'library'
        return 'library'

    # Single-module JVM/Go/… at repo root (pom.xml / go.mod / …) are deployable apps.
    # Must run BEFORE the Node-oriented root branch, which otherwise labels them
    # workspace_root and drops every file from include_files.
    if eco in ('jvm', 'go', 'rust', 'python', 'php', 'dotnet'):
        return 'application'

    if not p:
        pkg = _read_package_json(repo, '')
        if pkg.get('private') and (pkg.get('workspaces') or os.path.isfile(os.path.join(repo, 'pnpm-workspace.yaml'))):
            return 'workspace_root'
        if any(k in (pkg.get('scripts') or {}) for k in ('start', 'serve', 'dev')):
            return 'application'
        return 'workspace_root'

    if eco == 'node':
        pkg = _read_package_json(repo, p)
        if pkg.get('private') and not pkg.get('main'):
            return 'library'
        if any(k in (pkg.get('scripts') or {}) for k in ('start', 'serve')):
            return 'application'

    return 'unknown'


def discover_projects(repo, policy=None):
    """Walk repo; deepest manifest directory becomes a project root (Cascade rule)."""
    policy = policy or _load_scope_policy()
    workspace_members = _expand_workspace_members(repo, policy)
    found = []

    skip_dirs = {'.git', 'node_modules', 'vendor', 'dist', 'build', 'target', '.next'}

    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        rel_root = os.path.relpath(root, repo).replace(os.sep, '/')
        if rel_root == '.':
            rel_root = ''

        eco, mf = _detect_ecosystem(repo, rel_root, policy)
        if not eco:
            continue

        role = _classify_role(rel_root, repo, eco, policy, workspace_members)
        is_member = rel_root in workspace_members or rel_root.replace(os.sep, '/') in workspace_members
        found.append(ProjectRoot(rel_root, eco, role, mf, is_member))

    # Deepest path wins: drop ancestor if descendant exists for same tree
    paths = sorted({p.path for p in found}, key=lambda x: (-x.count('/'), x))
    keep = []
    for pr in sorted(found, key=lambda x: (-x.path.count('/'), x.path)):
        if any(pr.path != k.path and k.path.startswith(pr.path + '/') for k in keep):
            continue
        # If child kept, drop shallower duplicate ecosystem at parent when child is workspace member
        dominated = False
        for k in keep:
            if pr.path and k.path.startswith(pr.path + '/'):
                dominated = True
                break
        if not dominated:
            keep.append(pr)

    return keep, workspace_members


def _assign_file_to_project(path, projects):
    best = None
    for pr in projects:
        if not pr.path:
            if best is None:
                best = pr
            continue
        pref = pr.path + '/'
        if path == pr.path or path.startswith(pref):
            if best is None or len(pr.path) > len(best.path):
                best = pr
    return best


def _is_test_path(path, policy):
    return _glob_match(path, policy.get('test_exclude_globs') or [])


def _combined_excludes(cfg, policy):
    globs = list(cfg.get('exclude_paths') or [])
    globs.extend(policy.get('global_exclude_globs') or [])
    globs.extend(policy.get('test_exclude_globs') or [])
    return globs


def build_scope_plan(repo, cfg=None, code_files=None, fan_map=None, policy=None):
    """
    Build scan scope plan. code_files: list of relative paths (optional pre-walk).
    Returns ScopePlan with include_files, include_roots, semgrep_include_dirs.
    """
    cfg = cfg or load_config()
    policy = policy or _load_scope_policy()
    sp_cfg = cfg.get('scope_planning') or {}
    if sp_cfg.get('enabled') is False:
        return None

    repo = os.path.abspath(repo)
    role_include = policy.get('role_include') or {}
    projects, workspace_members = discover_projects(repo, policy)
    exclude_globs = _combined_excludes(cfg, policy)

    manual_include = sp_cfg.get('manual_include') or []
    manual_exclude = sp_cfg.get('manual_exclude') or []
    exclude_globs = exclude_globs + manual_exclude

    if code_files is None:
        code_files = []
        for root, dirs, names in os.walk(repo):
            dirs[:] = [d for d in dirs if d != '.git' and not is_excluded(
                os.path.relpath(os.path.join(root, d), repo) + '/', exclude_globs)]
            for n in names:
                if not n.endswith(tuple(CODE_EXT)):
                    continue
                rel = os.path.relpath(os.path.join(root, n), repo).replace(os.sep, '/')
                if not is_excluded(rel, exclude_globs):
                    code_files.append(rel)

    total = len(code_files)
    in_scope = []
    by_role = {}
    notes = []

    for path in code_files:
        if is_excluded(path, exclude_globs):
            continue
        if _is_test_path(path, policy):
            continue
        if manual_include and not _prefix_match(path, manual_include) and path not in manual_include:
            continue
        if _prefix_match(path, sp_cfg.get('non_app_path_prefixes') or policy.get('non_app_path_prefixes') or []):
            continue

        pr = _assign_file_to_project(path, projects)
        role = pr.role if pr else 'unknown'
        by_role[role] = by_role.get(role, 0) + 1

        if not role_include.get(role, False):
            continue

        # Inside included project: prefer application source globs when configured strictly
        strict_src = sp_cfg.get('strict_application_source_globs', False)
        if strict_src and role in ('application', 'service', 'library'):
            src_globs = policy.get('application_source_globs') or []
            # file must match at least one source glob OR live directly under project root src
            rel_in_proj = path[len(pr.path) + 1:] if pr and pr.path else path
            if not _glob_match(rel_in_proj, src_globs) and not _glob_match(path, src_globs):
                # allow if no src/ layout detected in project (flat package)
                proj_prefix = (pr.path + '/') if pr and pr.path else ''
                if '/src/' not in path and not path.startswith(proj_prefix + 'src/'):
                    pass  # flat layout OK
                elif '/src/' in path or path.endswith('/src') or '/src/' in proj_prefix:
                    continue

        in_scope.append(path)

    # Semgrep monorepo: --include project directories (not whole repo)
    include_roots = sorted({pr.path for pr in projects if role_include.get(pr.role, False) and pr.path})
    if manual_include:
        include_roots = sorted(set(manual_include))

    # Fallback: if nothing matched roles, use apps/ + packages/ when present (Semgrep guidance)
    if not include_roots and not manual_include:
        for cand in ('apps', 'packages', 'services', 'src'):
            if os.path.isdir(os.path.join(repo, cand)):
                include_roots.append(cand)
                notes.append('fallback Semgrep-style include root: %s/' % cand)

    if not in_scope and include_roots:
        for path in code_files:
            if is_excluded(path, exclude_globs) or _is_test_path(path, policy):
                continue
            if any(path == r or path.startswith(r + '/') for r in include_roots):
                in_scope.append(path)

    # Last-resort: never emit an empty allowlist when first-party code exists.
    # Empty include_files previously meant "reject all" in collectors — catastrophic
    # for adhoc / flat single-module repos. Prefer keep-all over wipe-all.
    if not in_scope and code_files:
        for path in code_files:
            if is_excluded(path, exclude_globs) or _is_test_path(path, policy):
                continue
            in_scope.append(path)
        if in_scope:
            notes.append(
                'fallback: empty role scope → include all non-excluded code files '
                '(avoid empty allowlist rejecting every changed file)')

    semgrep_dirs = []
    for r in include_roots:
        semgrep_dirs.append(r if r else '.')
    if not semgrep_dirs and in_scope:
        # incremental: parent dirs of files
        semgrep_dirs = sorted({p.split('/')[0] for p in in_scope if '/' in p})
    # Flat layout (files at repo root): Semgrep include dir is "."
    if not semgrep_dirs and in_scope:
        semgrep_dirs = ['.']

    plan = ScopePlan(
        algorithm=ALGO_VERSION,
        sources=SOURCES,
        repo=repo,
        projects=[{
            'path': pr.path or '.',
            'ecosystem': pr.ecosystem,
            'role': pr.role,
            'manifest': pr.manifest,
            'workspace_member': pr.workspace_member,
        } for pr in projects],
        include_roots=include_roots,
        include_files=sorted(set(in_scope)),
        exclude_globs=exclude_globs,
        semgrep_include_dirs=semgrep_dirs,
        stats={
            'total_code_files': total,
            'in_scope_files': len(set(in_scope)),
            'reduction_pct': round(100.0 * (1 - len(set(in_scope)) / total), 1) if total else 0.0,
            'by_role_candidates': by_role,
            'project_count': len(projects),
        },
        notes=notes,
    )

    if fan_map:
        hot = [p for p in plan.include_files if fan_map.get(p, 0) > 0]
        plan.stats['fan_in_boost_files'] = len(hot)

    return plan


def scope_allowlist(include_files):
    """Return a set to filter with, or None meaning do-not-filter.

    Empty include_files must NOT mean reject-all (adhoc / flat-module safety).
    Callers: only apply membership checks when the return value is not None.
    """
    if not include_files:
        return None
    return set(include_files)


def apply_scope_filter(paths, include_files):
    """Filter paths by include_files; empty/missing allowlist leaves paths unchanged."""
    allowed = scope_allowlist(include_files)
    if allowed is None:
        return list(paths)
    return [p for p in paths if p in allowed]


def file_in_scope(path, plan):
    if not plan:
        return True
    allowed = scope_allowlist(getattr(plan, 'include_files', None) or [])
    if allowed is None:
        return True
    return path in allowed


def main():
    import argparse
    ap = argparse.ArgumentParser(description='Plan scan scope for a repository')
    ap.add_argument('--repo', default='.')
    ap.add_argument('-o', '--output', default=None)
    ap.add_argument('--print-summary', action='store_true')
    args = ap.parse_args()
    plan = build_scope_plan(args.repo)
    if not plan:
        print('scope planning disabled')
        return
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(plan.to_dict(), f, ensure_ascii=False, indent=2)
    if args.print_summary or not args.output:
        print('scope %s: %d/%d files (%.1f%% reduction)' % (
            plan.algorithm, plan.stats['in_scope_files'], plan.stats['total_code_files'],
            plan.stats['reduction_pct']))
        print('include_roots:', ', '.join(plan.include_roots) or '(none)')
        print('semgrep_dirs:', ', '.join(plan.semgrep_include_dirs))


if __name__ == '__main__':
    main()
