#!/usr/bin/env python3
"""Refresh references/catalog.json from sibling SKILL.md files (dev helper).

Run from a full codexqa checkout after adding or editing worker skills so the
bundled catalog used for match-when-empty stays current.

  python3 scripts/refresh_catalog.py
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

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
    if sys.version_info >= _MIN_PY:
        return
    if os.environ.get(_REEXEC_ENV) == "1":
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
    sys.exit(1)


_reexec_if_needed()

SELF_NAME = "codexqa-skill-router"


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


def main() -> int:
    skill = Path(__file__).resolve().parents[1]
    root = skill.parent
    skills = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith(".") or child.name == SELF_NAME:
            continue
        if child.name.endswith("-workspace"):
            continue
        md = child / "SKILL.md"
        if not md.is_file():
            continue
        meta = parse_frontmatter(md.read_text(encoding="utf-8", errors="replace"))
        name = (meta.get("name") or child.name).strip()
        if name == SELF_NAME:
            continue
        skills.append(
            {
                "name": name,
                "directory": child.name,
                "repoPath": "skills/%s" % child.name,
                "description": meta.get("description") or "",
                "compatibility": meta.get("compatibility") or "",
                "installHint": "npx skills add openqa-cn/codexqa --skill %s" % name,
            }
        )
    catalog = {
        "schema_version": "1.0",
        "pack": "openqa-cn/codexqa",
        "source": "generated from sibling SKILL.md frontmatter",
        "skills": skills,
    }
    out = skill / "references" / "catalog.json"
    out.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "count": len(skills), "path": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
