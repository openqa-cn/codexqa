#!/usr/bin/env python3
"""Discover routable sibling skills under the codexqa skills directory.

Scans the parent of this skill (…/skills/) for subdirectories that contain a
SKILL.md with YAML frontmatter. Excludes this skill (codexqa-skill-router) and
non-skill folders. New skills appear automatically when they add SKILL.md.

Usage:
  python3 discover_skills.py                 # JSON to stdout
  python3 discover_skills.py --skills-root /path/to/skills
  python3 discover_skills.py --self-check

Prefers CPython 3.10+. Re-execs onto python3.10+ when system python3 is older
(e.g. 3.6 on some enterprise images).
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

_MIN_PY = (3, 10)
_REEXEC_ENV = "SKILL_ROUTER_PY_REEXEC"
_PY_CANDIDATES = (
    "python3.12",
    "python3.11",
    "python3.10",
    "python3.13",
    "python3.14",
    "python3",
)


def _reexec_if_needed():
    # type: () -> None
    if sys.version_info >= _MIN_PY:
        return
    if os.environ.get(_REEXEC_ENV) == "1":
        sys.stderr.write(
            "codexqa-skill-router discover_skills.py needs Python %d.%d+; got %d.%d\n"
            % (_MIN_PY[0], _MIN_PY[1], sys.version_info[0], sys.version_info[1])
        )
        sys.exit(1)
    script = os.path.abspath(__file__)
    for name in _PY_CANDIDATES:
        try:
            out = subprocess.check_output(
                [name, "-c", 'import sys; print("%d.%d" % sys.version_info[:2])'],
                stderr=subprocess.PIPE,
            )
            if not isinstance(out, str):
                out = out.decode("utf-8", "replace")
            parts = out.strip().split(".")
            ver = (int(parts[0]), int(parts[1]))
        except Exception:
            continue
        if ver < _MIN_PY:
            continue
        env = os.environ.copy()
        env[_REEXEC_ENV] = "1"
        os.execvpe(name, [name, script] + sys.argv[1:], env)
    sys.stderr.write(
        "codexqa-skill-router discover_skills.py needs Python %d.%d+ on PATH\n"
        % (_MIN_PY[0], _MIN_PY[1])
    )
    sys.exit(1)


_reexec_if_needed()

SELF_NAME = "codexqa-skill-router"
SKIP_DIR_NAMES = {
    SELF_NAME,
    "__pycache__",
    "node_modules",
    ".git",
    "data",
}


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def default_skills_root() -> Path:
    return skill_dir().parent


def parse_frontmatter(text: str) -> Dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    block = text[3:end].strip("\n")
    data: Dict[str, str] = {}
    key: Optional[str] = None
    buf: List[str] = []
    folded = False

    def flush() -> None:
        nonlocal key, buf, folded
        if key is None:
            return
        raw = "\n".join(buf) if folded else " ".join(buf)
        data[key] = re.sub(r"\s+", " ", raw).strip().strip("\"'")
        key, buf, folded = None, [], False

    for line in block.splitlines():
        if key and (line.startswith("  ") or line.startswith("\t") or (folded and line.strip())):
            # continuation of folded/literal-ish description
            buf.append(line.strip())
            continue
        flush()
        m = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not m:
            continue
        key = m.group(1)
        rest = m.group(2).strip()
        if rest in (">", ">-", "|", "|-"):
            folded = True
            buf = []
        elif rest:
            buf = [rest]
            folded = False
        else:
            buf = []
            folded = False
    flush()
    return data


def discover(skills_root: Path) -> List[Dict[str, Any]]:
    root = skills_root.resolve()
    if not root.is_dir():
        raise FileNotFoundError("skills root not found: %s" % root)

    found: List[Dict[str, Any]] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        if child.name in SKIP_DIR_NAMES or child.name.startswith("."):
            continue
        if child.name.endswith("-workspace"):
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            continue
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        meta = parse_frontmatter(text)
        name = (meta.get("name") or child.name).strip()
        if name == SELF_NAME:
            continue
        if name != child.name:
            # Prefer directory name for install path; keep frontmatter name for matching
            pass
        found.append(
            {
                "name": name,
                "directory": child.name,
                "path": str(child),
                "skillMd": str(skill_md),
                "description": meta.get("description") or "",
                "license": meta.get("license") or "",
                "compatibility": meta.get("compatibility") or "",
                "source": "live",
                "installed": True,
            }
        )
    return found


def load_bundled_catalog() -> List[Dict[str, Any]]:
    path = skill_dir() / "references" / "catalog.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    out: List[Dict[str, Any]] = []
    for s in data.get("skills", []):
        name = (s.get("name") or "").strip()
        if not name or name == SELF_NAME:
            continue
        out.append(
            {
                "name": name,
                "directory": s.get("directory") or name,
                "path": "",
                "skillMd": "",
                "description": s.get("description") or "",
                "license": "",
                "compatibility": s.get("compatibility") or "",
                "source": "bundled",
                "installed": False,
                "repoPath": s.get("repoPath") or ("skills/%s" % name),
                "installHint": s.get("installHint")
                or ("npx skills add openqa-cn/codexqa --skill %s" % name),
            }
        )
    return out


def merge_catalog(live: List[Dict[str, Any]], bundled: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Prefer live installed skills; fill gaps from bundled catalog for matching."""
    by_name = {s["name"]: s for s in live}
    for s in bundled:
        if s["name"] not in by_name:
            by_name[s["name"]] = s
    return [by_name[k] for k in sorted(by_name)]


def self_check() -> int:
    root = default_skills_root()
    skills = discover(root)
    names = {s["name"] for s in skills}
    bundled = load_bundled_catalog()
    bundled_names = {s["name"] for s in bundled}
    required = {
        "codexqa-code-reviewer",
        "codexqa-code-analyzer",
        "codexqa-change-analysis",
        "codexqa-code-wiki",
        "codexqa-defect-analyzer",
        "codexqa-jev-browser",
        "codexqa-requirement-analyzer",
        "codexqa-rootcause-analyzer",
        "codexqa-testcase-generator",
        "codexqa-testdata-generator",
    }
    if SELF_NAME in names:
        print(json.dumps({"ok": False, "error": "self included", "names": sorted(names)}), file=sys.stderr)
        return 1
    if not bundled:
        print(json.dumps({"ok": False, "error": "missing bundled catalog.json"}), file=sys.stderr)
        return 1
    missing_bundled = sorted(required - bundled_names)
    if missing_bundled:
        print(
            json.dumps({"ok": False, "error": "catalog incomplete", "missing": missing_bundled}),
            file=sys.stderr,
        )
        return 1
    for s in bundled:
        if not s["description"]:
            print(json.dumps({"ok": False, "error": "empty catalog description", "name": s["name"]}), file=sys.stderr)
            return 1
    # Live siblings optional when developing with only router; warn via field
    print(
        json.dumps(
            {
                "ok": True,
                "liveCount": len(skills),
                "bundledCount": len(bundled),
                "liveNames": sorted(names),
                "bundledNames": sorted(bundled_names),
            },
            ensure_ascii=False,
        )
    )
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Discover routable codexqa skills")
    parser.add_argument("--skills-root", type=Path, default=None, help="Override skills directory")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--names-only", action="store_true")
    parser.add_argument(
        "--with-catalog",
        action="store_true",
        help="Merge bundled references/catalog.json so matching works when siblings are not installed",
    )
    parser.add_argument(
        "--catalog-only",
        action="store_true",
        help="Return only the bundled catalog (ignore live siblings)",
    )
    args = parser.parse_args(argv)
    if args.self_check:
        return self_check()
    root = args.skills_root or default_skills_root()
    live = [] if args.catalog_only else discover(root)
    bundled = load_bundled_catalog() if (args.with_catalog or args.catalog_only) else []
    if args.catalog_only:
        skills = bundled
        mode = "catalog_only"
    elif args.with_catalog:
        skills = merge_catalog(live, bundled)
        mode = "live+bundled"
    else:
        skills = live
        mode = "live"
    if args.names_only:
        print(json.dumps([s["name"] for s in skills], ensure_ascii=False))
    else:
        print(
            json.dumps(
                {
                    "ok": True,
                    "skillsRoot": str(root.resolve()),
                    "routerSkill": str(skill_dir()),
                    "mode": mode,
                    "liveCount": len(live),
                    "bundledCount": len(bundled),
                    "count": len(skills),
                    "skills": skills,
                    "needsInstall": [s["name"] for s in skills if not s.get("installed")],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
