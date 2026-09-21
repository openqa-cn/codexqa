#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shallow-clone a Git knowledge repo whose URL the user explicitly provided.

Only accepts addresses the user supplied; does not extract URLs from requirement text.
Does not call an external knowledge-base retrieval Skill. After clone,
bootstrap_knowledge.py builds index.md.
"""

from __future__ import annotations

from py_version import require_py310

require_py310()

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


GIT_SCP_RE = re.compile(
    r"^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~+/=@,-]+(?:\.git)?$"
)
SSH_URL_RE = re.compile(
    r"^ssh://git@[A-Za-z0-9.-]+(?::\d+)?/[A-Za-z0-9._~+/=@,-]+(?:\.git)?$"
)
REF_RE = re.compile(r"^[A-Za-z0-9._/-]{1,128}$")


def split_url_and_ref(raw: str) -> tuple[str, str]:
    text = raw.strip().strip("<>`'\"")
    text = text.rstrip(").,;")
    if " #" in text:
        url, ref = text.rsplit(" #", 1)
        return url.strip(), ref.strip()
    if text.count("#") == 1 and not text.startswith("#"):
        url, ref = text.split("#", 1)
        if "://" in url or url.startswith("git@"):
            return url.strip(), ref.strip()
    return text, ""


def validate_git_url(url: str) -> str | None:
    if not url or any(ch in url for ch in ("\n", "\r", " ", "\t")):
        return None
    if url.startswith("git@"):
        return url if GIT_SCP_RE.match(url) else None
    if url.startswith("ssh://"):
        return url if SSH_URL_RE.match(url) else None
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or not parsed.path:
        return None
    if parsed.username or parsed.password:
        return None
    if ".." in parsed.path:
        return None
    return url


def validate_ref(ref: str) -> str | None:
    if not ref:
        return ""
    if not REF_RE.match(ref) or ref.startswith("-"):
        return None
    return ref


def run_git(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd) if cwd else None,
        check=False,
        capture_output=True,
        text=True,
    )


def fetch(url: str, dest: Path, ref: str = "") -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)

    clone_args = ["clone", "--depth", "1", "--single-branch"]
    if ref:
        clone_args.extend(["--branch", ref])
    clone_args.extend(["--", url, str(dest)])
    proc = run_git(clone_args)
    if proc.returncode != 0:
        return {
            "ok": False,
            "error": (proc.stderr or proc.stdout or "git clone failed").strip()[:800],
            "repoPath": str(dest),
            "url": url,
            "ref": ref,
        }
    return {
        "ok": True,
        "repoPath": str(dest.resolve()),
        "url": url,
        "ref": ref,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Shallow-clone a user-provided Git knowledge repo")
    parser.add_argument("--url", required=True, help="Git URL explicitly provided by the user")
    parser.add_argument("--output-dir", required=True, help="{run_dir}/knowledge")
    parser.add_argument("--ref", default="", help="Optional branch or tag")
    args = parser.parse_args()

    url, inline_ref = split_url_and_ref(args.url)
    ref = args.ref or inline_ref
    valid_url = validate_git_url(url)
    valid_ref = validate_ref(ref)
    if valid_url is None:
        print(json.dumps({
            "ok": False,
            "error": "INVALID_GIT_URL",
            "msg": "Not an accepted Git URL (https / git@ / ssh://git@ only)",
        }, ensure_ascii=False, indent=2, sort_keys=True))
        return 2
    if valid_ref is None:
        print(json.dumps({
            "ok": False,
            "error": "INVALID_GIT_REF",
            "msg": "Invalid branch or tag",
        }, ensure_ascii=False, indent=2, sort_keys=True))
        return 2

    dest = Path(args.output_dir).expanduser().resolve() / "repo"
    result = fetch(valid_url, dest, valid_ref or "")
    result["msg"] = "repo=%s" % result.get("repoPath", "") if result.get("ok") else result.get("error", "git clone failed")
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
