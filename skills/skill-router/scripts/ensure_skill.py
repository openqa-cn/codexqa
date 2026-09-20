#!/usr/bin/env python3
"""Ensure a routable codexqa skill is installed next to skill-router.

When only skill-router is installed, discover returns count 0. After the agent
matches against the bundled catalog, run this script to fetch the chosen skill
into the same skills root, then re-run discover and hand off.

Methods (first success wins):
  1. Already present as sibling with SKILL.md
  2. --from-repo <codexqa checkout>: copy skills/<name>
  3. GitHub tarball of openqa-cn/codexqa (default branch)
  4. npx skills add openqa-cn/codexqa -s <name> -y --copy (best-effort)

Usage:
  python3 ensure_skill.py ai-code-reviewer --yes
  python3 ensure_skill.py testcase-generation --dry-run
  python3 ensure_skill.py defect-detection --from-repo /path/to/codexqa --yes
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
            "ensure_skill.py needs Python %d.%d+\n" % (_MIN_PY[0], _MIN_PY[1])
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
    sys.stderr.write("ensure_skill.py needs Python %d.%d+ on PATH\n" % _MIN_PY)
    sys.exit(1)


_reexec_if_needed()

SELF_NAME = "skill-router"
DEFAULT_PACK = "openqa-cn/codexqa"
DEFAULT_BRANCH = "main"
DEFAULT_TARBALL = (
    "https://codeload.github.com/%s/tar.gz/%s" % (DEFAULT_PACK, DEFAULT_BRANCH)
)


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def default_skills_root() -> Path:
    return skill_dir().parent


def load_bundled_catalog() -> Dict[str, Any]:
    path = skill_dir() / "references" / "catalog.json"
    if not path.is_file():
        return {"skills": []}
    return json.loads(path.read_text(encoding="utf-8"))


def known_names() -> List[str]:
    return [s["name"] for s in load_bundled_catalog().get("skills", [])]


def skill_present(skills_root: Path, name: str) -> Optional[Path]:
    candidate = skills_root / name
    if (candidate / "SKILL.md").is_file():
        return candidate
    return None


def copy_from_repo(repo: Path, name: str, dest: Path) -> Path:
    src = repo / "skills" / name
    if not (src / "SKILL.md").is_file():
        raise FileNotFoundError("repo missing skills/%s/SKILL.md under %s" % (name, repo))
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    return dest


def install_from_tarball(name: str, dest_parent: Path, url: str) -> Path:
    dest = dest_parent / name
    with tempfile.TemporaryDirectory(prefix="skill-router-fetch-") as tmp:
        tar_path = Path(tmp) / "pack.tar.gz"
        req = urllib.request.Request(url, headers={"User-Agent": "skill-router-ensure/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            tar_path.write_bytes(resp.read())
        with tarfile.open(tar_path, "r:gz") as tf:
            members = [m for m in tf.getmembers() if "/skills/%s/" % name in m.name.replace("\\", "/")]
            # also allow exact skills/name/SKILL.md path variants
            if not members:
                members = [
                    m
                    for m in tf.getmembers()
                    if m.name.replace("\\", "/").endswith("/skills/%s/SKILL.md" % name)
                    or m.name.replace("\\", "/").endswith("skills/%s/SKILL.md" % name)
                ]
                # expand to whole skill tree
                prefix = None
                for m in tf.getmembers():
                    norm = m.name.replace("\\", "/")
                    marker = "/skills/%s/" % name
                    if marker in norm:
                        prefix = norm.split(marker)[0] + marker
                        break
                    if norm.endswith("/skills/%s" % name) or norm.endswith("skills/%s" % name):
                        prefix = norm.rstrip("/") + "/"
                        break
                if prefix:
                    members = [m for m in tf.getmembers() if m.name.replace("\\", "/").startswith(prefix)]
            if not members:
                raise FileNotFoundError("tarball has no skills/%s" % name)
            # normalize extract into dest
            extract_root = Path(tmp) / "extracted"
            extract_root.mkdir()
            tf.extractall(extract_root)
            # find the skill folder
            found = None
            for p in extract_root.rglob("SKILL.md"):
                if p.parent.name == name and p.parent.parent.name == "skills":
                    found = p.parent
                    break
            if found is None:
                for p in extract_root.rglob("SKILL.md"):
                    if p.parent.name == name:
                        found = p.parent
                        break
            if found is None:
                raise FileNotFoundError("could not locate skills/%s after extract" % name)
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(found, dest)
    if not (dest / "SKILL.md").is_file():
        raise RuntimeError("install incomplete: missing %s" % (dest / "SKILL.md"))
    return dest


def install_via_npx(name: str, skills_root: Path) -> Optional[Path]:
    """Best-effort: use community installer, then copy into skills_root if needed."""
    cmd = [
        "npx",
        "--yes",
        "skills",
        "add",
        DEFAULT_PACK,
        "-s",
        name,
        "-y",
        "--copy",
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=300)
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return None
    present = skill_present(skills_root, name)
    if present:
        return present
    # Search common agent skill dirs and copy
    home = Path.home()
    candidates = [
        home / ".claude" / "skills" / name,
        home / ".cursor" / "skills" / name,
        home / ".codex" / "skills" / name,
        Path.cwd() / ".claude" / "skills" / name,
        Path.cwd() / ".cursor" / "skills" / name,
        Path.cwd() / ".agents" / "skills" / name,
    ]
    for src in candidates:
        if (src / "SKILL.md").is_file():
            dest = skills_root / name
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
            return dest
    return None


def ensure(
    name: str,
    skills_root: Path,
    yes: bool,
    dry_run: bool,
    from_repo: Optional[Path],
    tarball_url: str,
    allow_npx: bool,
) -> Dict[str, Any]:
    if name == SELF_NAME:
        return {"ok": False, "error": "refusing to install skill-router into itself"}
    known = known_names()
    if known and name not in known:
        return {
            "ok": False,
            "error": "unknown skill for this pack catalog",
            "name": name,
            "known": known,
        }

    existing = skill_present(skills_root, name)
    if existing:
        return {
            "ok": True,
            "action": "already_present",
            "name": name,
            "path": str(existing),
            "skillMd": str(existing / "SKILL.md"),
        }

    if dry_run:
        return {
            "ok": True,
            "action": "would_install",
            "name": name,
            "skillsRoot": str(skills_root),
            "methods": ["from-repo" if from_repo else None, "tarball", "npx" if allow_npx else None],
        }

    if not yes:
        return {
            "ok": False,
            "error": "missing skill; re-run with --yes after user confirms install",
            "name": name,
            "installHint": "npx skills add %s --skill %s" % (DEFAULT_PACK, name),
            "skillsRoot": str(skills_root),
        }

    errors: List[str] = []
    if from_repo:
        try:
            path = copy_from_repo(from_repo, name, skills_root / name)
            return {
                "ok": True,
                "action": "copied_from_repo",
                "name": name,
                "path": str(path),
                "skillMd": str(path / "SKILL.md"),
                "fromRepo": str(from_repo),
            }
        except Exception as exc:
            errors.append("from-repo: %s" % exc)

    try:
        path = install_from_tarball(name, skills_root, tarball_url)
        return {
            "ok": True,
            "action": "fetched_tarball",
            "name": name,
            "path": str(path),
            "skillMd": str(path / "SKILL.md"),
            "tarball": tarball_url,
        }
    except Exception as exc:
        errors.append("tarball: %s" % exc)

    if allow_npx:
        path = install_via_npx(name, skills_root)
        if path:
            return {
                "ok": True,
                "action": "npx_skills_add",
                "name": name,
                "path": str(path),
                "skillMd": str(path / "SKILL.md"),
            }
        errors.append("npx: install did not place SKILL.md under skills root")

    return {"ok": False, "error": "install failed", "name": name, "details": errors}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Ensure a codexqa skill is installed beside skill-router")
    parser.add_argument("name", help="Skill directory / frontmatter name to ensure")
    parser.add_argument("--skills-root", type=Path, default=None)
    parser.add_argument("--from-repo", type=Path, default=None, help="Local codexqa checkout")
    parser.add_argument("--tarball-url", default=os.environ.get("CODEXQA_SKILLS_TARBALL", DEFAULT_TARBALL))
    parser.add_argument("--yes", "-y", action="store_true", help="Perform install without further prompts")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-npx", action="store_true", help="Skip npx skills add fallback")
    args = parser.parse_args(argv)

    root = (args.skills_root or default_skills_root()).resolve()
    root.mkdir(parents=True, exist_ok=True)
    result = ensure(
        name=args.name.strip(),
        skills_root=root,
        yes=args.yes,
        dry_run=args.dry_run,
        from_repo=args.from_repo.resolve() if args.from_repo else None,
        tarball_url=args.tarball_url,
        allow_npx=not args.no_npx,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
