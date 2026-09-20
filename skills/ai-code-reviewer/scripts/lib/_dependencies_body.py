#!/usr/bin/env python3
"""Bounded local dependency / supply-chain heuristics for ai-code-reviewer.

Zero network. Reads changed-file list + on-disk manifests under --repo.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import is_heuristic_meta_line  # noqa: E402

MAX_FILES = 40
MAX_LINES = 8000
THRESH_DIRECT_ADD = 8
THRESH_LOCK_NEW_LINES = 200

MANIFEST_NAMES = {
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "npm-shrinkwrap.json",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "go.mod",
    "go.sum",
    "Cargo.toml",
    "Cargo.lock",
    "requirements.txt",
    "pyproject.toml",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "Gemfile",
    "Gemfile.lock",
    "composer.json",
    "composer.lock",
}

LOCK_FOR_MANIFEST = {
    "package.json": ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json"),
    "pom.xml": (),  # Maven often uses versions in pom; no universal lock
    "build.gradle": ("gradle.lockfile",),
    "build.gradle.kts": ("gradle.lockfile",),
    "go.mod": ("go.sum",),
    "Cargo.toml": ("Cargo.lock",),
    "pyproject.toml": ("poetry.lock", "uv.lock"),
    "Pipfile": ("Pipfile.lock",),
    "requirements.txt": (),
    "Gemfile": ("Gemfile.lock",),
    "composer.json": ("composer.lock",),
}

LOCK_BASENAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "npm-shrinkwrap.json",
    "go.sum",
    "Cargo.lock",
    "poetry.lock",
    "Pipfile.lock",
    "Gemfile.lock",
    "composer.lock",
    "gradle.lockfile",
    "uv.lock",
}

ECOSYSTEM_HINTS = {
    "npm": ("package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"),
    "maven": ("pom.xml",),
    "gradle": ("build.gradle", "build.gradle.kts"),
    "go": ("go.mod", "go.sum"),
    "rust": ("Cargo.toml", "Cargo.lock"),
    "python": ("requirements.txt", "pyproject.toml", "Pipfile", "poetry.lock"),
    "ruby": ("Gemfile", "Gemfile.lock"),
    "php": ("composer.json", "composer.lock"),
}

FLOATING_RE = re.compile(
    r"""(?ix)
    (-SNAPSHOT\b)
    |(["']latest["'])
    |(["']\*[\"'])
    |(version\s*[:=]\s*["']?\+)
    |(git\+https?://)
    |(https?://[^"'\\s]+\\.git)
    """
)
SNAPSHOT_RE = re.compile(r"-SNAPSHOT\b", re.I)
NPM_DEP_BLOCK = re.compile(
    r'"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{([^}]*)\}',
    re.S,
)
NPM_KV = re.compile(r'"([^"]+)"\s*:\s*"([^"]*)"')
MAVEN_DEP = re.compile(
    r"<dependency>\s*(.*?)</dependency>",
    re.S | re.I,
)
MAVEN_GAV = re.compile(
    r"<groupId>\s*([^<]+)</groupId>.*?<artifactId>\s*([^<]+)</artifactId>.*?<version>\s*([^<]+)</version>",
    re.S | re.I,
)
GO_REQUIRE = re.compile(r"^\s*([^\s]+)\s+v([^\s]+)\s*$", re.M)
GRADLE_IMPL = re.compile(
    r"""(?x)
    (?:implementation|api|compileOnly|runtimeOnly|testImplementation)
    \s*\(?\s*["']([^"']+)["']
    """
)
LICENSE_JSON = re.compile(r'"license(s)?"\s*:\s*("([^"]*)"|(\[[^\]]*\]))', re.I)


def load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def file_paths(obj) -> list[str]:
    arr = (
        obj.get("nodes")
        or obj.get("result", {}).get("nodes")
        or obj.get("files")
        or obj.get("result", {}).get("files")
        or []
    )
    out = []
    if not isinstance(arr, list):
        return out
    for x in arr:
        if isinstance(x, str) and x:
            out.append(x)
        elif isinstance(x, dict):
            p = x.get("path") or x.get("file") or x.get("name")
            if isinstance(p, str) and p:
                out.append(p)
    return out


SOURCE_EXTS = {
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".cs",
    ".rb",
    ".php",
    ".scala",
    ".rs",
    ".xml",
    ".gradle",
    ".kts",
    ".properties",
    ".yml",
    ".yaml",
}


def is_dep_path(rel: str) -> bool:
    base = os.path.basename(rel)
    if base in MANIFEST_NAMES:
        return True
    # allow nested e.g. apps/web/package.json
    return base in MANIFEST_NAMES


def is_source_scan_path(rel: str) -> bool:
    """Non-manifest source that may embed SNAPSHOT/latest/git strings."""
    if is_dep_path(rel):
        return False
    low = rel.replace("\\", "/").lower()
    if any(
        p in low.split("/")
        for p in ("node_modules", "vendor", ".git", "dist", "build", "target")
    ):
        return False
    _, ext = os.path.splitext(low)
    return ext in SOURCE_EXTS


def read_bounded(abs_path: str) -> str:
    try:
        lines = []
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                if i >= MAX_LINES:
                    break
                lines.append(line)
        return "".join(lines)
    except Exception:
        return ""


def ecosystems_for(paths: list[str]) -> list[str]:
    found = set()
    bases = {os.path.basename(p) for p in paths}
    for eco, names in ECOSYSTEM_HINTS.items():
        if bases & set(names):
            found.add(eco)
    return sorted(found)


def parse_npm_deps(text: str) -> dict[str, str]:
    deps = {}
    for m in NPM_DEP_BLOCK.finditer(text):
        for k, v in NPM_KV.findall(m.group(2)):
            deps[k] = v
    return deps


def parse_maven_coords(text: str) -> list[dict]:
    out = []
    for block in MAVEN_DEP.findall(text):
        g = MAVEN_GAV.search(block)
        if g:
            out.append(
                {
                    "group": g.group(1).strip(),
                    "artifact": g.group(2).strip(),
                    "version": g.group(3).strip(),
                }
            )
    return out


def parse_go_requires(text: str) -> list[dict]:
    out = []
    in_block = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("require ("):
            in_block = True
            continue
        if in_block:
            if s == ")":
                in_block = False
                continue
            m = GO_REQUIRE.match(s)
            if m:
                out.append({"module": m.group(1), "version": "v" + m.group(2)})
            continue
        m = re.match(r"^require\s+(\S+)\s+(v\S+)", s)
        if m:
            out.append({"module": m.group(1), "version": m.group(2)})
    return out


def floating_hits(path: str, text: str) -> list[dict]:
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        if is_heuristic_meta_line(line):
            continue
        if FLOATING_RE.search(line) or SNAPSHOT_RE.search(line):
            if any(
                k in line
                for k in (
                    "SNAPSHOT",
                    "latest",
                    "*",
                    "git+",
                    "http://",
                    "https://",
                    "version",
                )
            ):
                hits.append(
                    {
                        "path": path,
                        "line": i,
                        "snippet": line.strip()[:160],
                        "kind": "snapshot_or_floating",
                    }
                )
        if len(hits) >= 30:
            break
    return hits


def license_hints(path: str, text: str) -> list[dict]:
    hints = []
    base = os.path.basename(path)
    if base == "package.json":
        m = LICENSE_JSON.search(text)
        if not m:
            hints.append(
                {
                    "path": path,
                    "license": None,
                    "note": "package.json missing license field",
                }
            )
        else:
            raw = m.group(2).strip()
            val = m.group(3) if m.group(3) is not None else raw
            if isinstance(val, str):
                low = val.strip("\"' ").upper()
                weak = low in ("", "UNLICENSED", "NONE") or low.startswith(
                    "SEE LICENSE IN"
                )
                if weak:
                    hints.append(
                        {
                            "path": path,
                            "license": val,
                            "note": "weak or missing license declaration (clue only)",
                        }
                    )
    return hints


def companion_locks(rel: str) -> list[str]:
    base = os.path.basename(rel)
    parent = os.path.dirname(rel)
    names = LOCK_FOR_MANIFEST.get(base, ())
    out = []
    for n in names:
        out.append(os.path.join(parent, n) if parent else n)
    return out


def count_lock_lines(text: str) -> int:
    return len(text.splitlines())


def scan_local_audit(repo: str) -> dict:
    if not repo or not os.path.isdir(repo):
        return {"present": False, "files": [], "high_or_critical": False}
    files = []
    high = False
    try:
        for name in os.listdir(repo):
            low = name.lower()
            if not low.endswith(".json"):
                continue
            if "audit" not in low and "osv" not in low:
                continue
            rel = name
            abs_p = os.path.join(repo, name)
            if not os.path.isfile(abs_p):
                continue
            files.append(rel)
            raw = read_bounded(abs_p).lower()
            if "critical" in raw or '"severity": "high"' in raw or '"high"' in raw:
                high = True
            if len(files) >= 5:
                break
    except Exception:
        pass
    return {"present": bool(files), "files": files, "high_or_critical": high}


def main() -> None:
    # argv: dir, repo, files_json, lang_json, out_path
    _dir, repo, files_json, lang_json, out_path = sys.argv[1:6]
    files_obj = load(files_json)
    lang_obj = load(lang_json)
    focus = (
        lang_obj.get("review_language_focus")
        or lang_obj.get("primary_language")
        or ""
    )
    all_paths = file_paths(files_obj)
    changed = [p for p in all_paths if is_dep_path(p)][:MAX_FILES]

    # Full mode fallback: if no changed dep files, sample repo-root manifests
    if not changed and repo and os.path.isdir(repo):
        for name in sorted(MANIFEST_NAMES):
            cand = os.path.join(repo, name)
            if os.path.isfile(cand):
                changed.append(name)
            if len(changed) >= 12:
                break

    changed_set = set(all_paths)
    manifest_hits = []
    snapshot_or_floating = []
    lock_drift = []
    license_hints_out = []
    direct_add_estimate = 0
    lock_new_lines_estimate = 0
    ecosystems = ecosystems_for(changed)

    for rel in changed:
        abs_p = os.path.join(repo, rel) if repo else ""
        text = read_bounded(abs_p) if abs_p and os.path.isfile(abs_p) else ""
        base = os.path.basename(rel)
        eco = "unknown"
        for e, names in ECOSYSTEM_HINTS.items():
            if base in names:
                eco = e
                break
        hit = {
            "path": rel,
            "basename": base,
            "ecosystem": eco,
            "change_in_pack": rel in changed_set,
            "bytes_read": len(text),
        }
        if base == "package.json" and text:
            deps = parse_npm_deps(text)
            hit["direct_dep_count"] = len(deps)
            # Without base revision, treat presence of many deps on add file as bloat signal
            if len(deps) >= THRESH_DIRECT_ADD:
                direct_add_estimate = max(direct_add_estimate, len(deps))
            for _k, ver in deps.items():
                if ver in ("*", "latest") or ver.startswith("git+") or "SNAPSHOT" in ver:
                    snapshot_or_floating.append(
                        {
                            "path": rel,
                            "coord": _k,
                            "version": ver,
                            "kind": "snapshot_or_floating",
                        }
                    )
        if base == "pom.xml" and text:
            coords = parse_maven_coords(text)
            hit["direct_dep_count"] = len(coords)
            if len(coords) >= THRESH_DIRECT_ADD:
                direct_add_estimate = max(direct_add_estimate, len(coords))
            for c in coords:
                if SNAPSHOT_RE.search(c.get("version") or ""):
                    snapshot_or_floating.append(
                        {
                            "path": rel,
                            "coord": f"{c['group']}:{c['artifact']}",
                            "version": c["version"],
                            "kind": "snapshot_or_floating",
                        }
                    )
        if base == "go.mod" and text:
            reqs = parse_go_requires(text)
            hit["direct_dep_count"] = len(reqs)
            if len(reqs) >= THRESH_DIRECT_ADD:
                direct_add_estimate = max(direct_add_estimate, len(reqs))
        if base in ("build.gradle", "build.gradle.kts") and text:
            impls = GRADLE_IMPL.findall(text)
            hit["direct_dep_count"] = len(impls)
            if len(impls) >= THRESH_DIRECT_ADD:
                direct_add_estimate = max(direct_add_estimate, len(impls))
            for coord in impls:
                if SNAPSHOT_RE.search(coord) or "latest" in coord:
                    snapshot_or_floating.append(
                        {
                            "path": rel,
                            "coord": coord,
                            "version": coord,
                            "kind": "snapshot_or_floating",
                        }
                    )

        snapshot_or_floating.extend(floating_hits(rel, text)[:10])
        license_hints_out.extend(license_hints(rel, text))

        # Lock drift: manifest changed in pack, companion lock not in change set
        if base in LOCK_FOR_MANIFEST and rel in changed_set:
            locks = companion_locks(rel)
            if locks:
                any_lock_changed = any(L in changed_set for L in locks)
                any_lock_on_disk = any(
                    repo and os.path.isfile(os.path.join(repo, L)) for L in locks
                )
                if not any_lock_changed:
                    lock_drift.append(
                        {
                            "manifest": rel,
                            "expected_locks": locks,
                            "lock_in_change_set": False,
                            "lock_on_disk": any_lock_on_disk,
                            "note": "manifest changed without companion lock in change set",
                        }
                    )

        if base in LOCK_BASENAMES and text:
            n = count_lock_lines(text)
            hit["lock_line_count"] = n
            if n >= THRESH_LOCK_NEW_LINES:
                lock_new_lines_estimate = max(lock_new_lines_estimate, n)

        manifest_hits.append(hit)

    # Source-string floating: SNAPSHOT/latest/git+ inside Java/TS/… (not only manifests)
    source_paths = [p for p in all_paths if is_source_scan_path(p)][:MAX_FILES]
    for rel in source_paths:
        abs_p = os.path.join(repo, rel) if repo else ""
        text = read_bounded(abs_p) if abs_p and os.path.isfile(abs_p) else ""
        if not text:
            continue
        for h in floating_hits(rel, text)[:15]:
            h = dict(h)
            h["kind"] = "source_string_floating"
            snapshot_or_floating.append(h)

    # Dedup floating
    seen = set()
    uniq_float = []
    for h in snapshot_or_floating:
        key = (h.get("path"), h.get("line"), h.get("coord"), h.get("snippet"), h.get("kind"))
        if key in seen:
            continue
        seen.add(key)
        uniq_float.append(h)
    snapshot_or_floating = uniq_float[:40]

    local_audit = scan_local_audit(repo)

    # Necessity heuristic: language focus vs ecosystem
    necessity_flags = []
    focus_l = (focus or "").lower()
    if direct_add_estimate >= THRESH_DIRECT_ADD and focus_l:
        eco_set = set(ecosystems)
        mismatch = False
        if focus_l in ("javascript", "typescript", "js", "ts") and eco_set and "npm" not in eco_set:
            mismatch = True
        if focus_l == "java" and eco_set and not (eco_set & {"maven", "gradle"}):
            mismatch = True
        if focus_l == "go" and eco_set and "go" not in eco_set:
            mismatch = True
        if focus_l == "python" and eco_set and "python" not in eco_set:
            mismatch = True
        if mismatch:
            necessity_flags.append(
                {
                    "kind": "ecosystem_mismatch",
                    "review_language_focus": focus,
                    "ecosystems": ecosystems,
                    "note": "dependency ecosystem may not match review_language_focus — check necessity",
                }
            )

    bloat = {
        "direct_add_estimate": direct_add_estimate,
        "lock_line_estimate": lock_new_lines_estimate,
        "direct_add_ge_threshold": direct_add_estimate >= THRESH_DIRECT_ADD,
        "lock_lines_ge_threshold": lock_new_lines_estimate >= THRESH_LOCK_NEW_LINES,
    }

    # Thin only when neither manifests nor source-string floating/license/lock signals
    signals_thin = (
        len(manifest_hits) == 0
        and len(snapshot_or_floating) == 0
        and len(lock_drift) == 0
        and len(license_hints_out) == 0
    )
    payload = {
        "body_ok": True,
        "repo_resolved": bool(repo and os.path.isdir(repo)),
        "signals_thin": signals_thin,
        "ecosystems": ecosystems,
        "manifest_hits": manifest_hits[:40],
        "snapshot_or_floating": snapshot_or_floating,
        "lock_drift": lock_drift[:20],
        "license_hints": license_hints_out[:20],
        "bloat": bloat,
        "necessity_flags": necessity_flags,
        "local_audit": local_audit,
        "thresholds": {
            "direct_add": THRESH_DIRECT_ADD,
            "lock_new_lines": THRESH_LOCK_NEW_LINES,
            "max_files": MAX_FILES,
            "max_lines": MAX_LINES,
        },
        "files_considered": len(changed),
        "review_language_focus": focus,
    }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
