#!/usr/bin/env python3
"""Build a GitHub Release body from .github/release-notes.md.

Ensures every release mentions https://openqa.cn/. Used by
.github/workflows/release-notes.yml. Prints the body to stdout.
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / ".github" / "release-notes.md"
CHANGELOG = ROOT / "CHANGELOG.md"
DOCS_URL = "https://openqa.cn/"
DOCS_BLOCK = """## Docs

- Product site: https://openqa.cn/
- GitHub source: https://github.com/openqa-cn/codexqa
"""


def strip_instruction_heading(markdown):
    """Drop the local how-to H1; the GitHub Release title is the tag."""
    lines = markdown.splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
        if lines and not lines[0].strip():
            lines = lines[1:]
    return "\n".join(lines).strip() + "\n"


def changelog_highlights(changelog, tag):
    ver = tag.lstrip("v")
    sections = re.split(r"(?m)^## ", changelog)
    chosen = ""
    unreleased = ""
    for section in sections[1:]:
        heading, _, body = section.partition("\n")
        title = heading.strip()
        if title.lower().startswith("unreleased"):
            unreleased = body
        elif title.split()[0].lstrip("v") == ver:
            chosen = body
            break
    source = chosen or unreleased
    match = re.search(r"(?ms)^### Highlights\s*\n(.*?)(?=^### |\Z)", source)
    if not match:
        return ""
    return match.group(1).strip()


def render_skeleton(tag):
    body = strip_instruction_heading(TEMPLATE.read_text())
    highlights = changelog_highlights(CHANGELOG.read_text() if CHANGELOG.exists() else "", tag)
    if highlights:
        body = re.sub(
            r"(?ms)^## Highlights vs internal\n.*",
            "## Highlights\n\n" + highlights + "\n",
            body,
        )
    body = body.replace("`codexqa <tag>`", f"codexqa {tag}")
    if DOCS_URL not in body:
        body = body.rstrip() + "\n\n" + DOCS_BLOCK
    return body.rstrip() + "\n"


def merge_existing(existing, tag):
    existing = existing.strip()
    if not existing or existing == "null":
        return render_skeleton(tag)
    if DOCS_URL in existing:
        return existing + "\n"
    return existing.rstrip() + "\n\n" + DOCS_BLOCK


def resolve_from_github_event(event_path):
    event = json.loads(event_path.read_text())
    name = os.environ.get("GITHUB_EVENT_NAME", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if name == "release":
        rel = event["release"]
        return rel["tag_name"], rel.get("body") or "", str(rel["id"])
    tag = os.environ.get("GITHUB_REF_NAME", "unreleased")
    listed = subprocess.run(
        ["gh", "api", f"repos/{repo}/releases/tags/{tag}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if listed.returncode != 0:
        return tag, "", ""
    data = json.loads(listed.stdout)
    return tag, data.get("body") or "", str(data["id"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default="unreleased")
    parser.add_argument("--existing", default="", help="Current GitHub Release body")
    parser.add_argument("--existing-file", help="Read current body from a file")
    parser.add_argument("--github-event", help="Path to GitHub event JSON (Actions)")
    parser.add_argument("--meta-out", help="Write tag\\nrelease_id for the workflow")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        sample = merge_existing("", "0.2.0")
        assert DOCS_URL in sample, sample
        assert "Highlights" in sample
        assert merge_existing("# notes\n\nno docs yet\n", "1.0.0").count(DOCS_URL) == 1
        already = merge_existing(f"hello {DOCS_URL}\n", "1.0.0")
        assert already.count(DOCS_URL) == 1
        print("PASS: compose-release-notes")
        return 0
    tag = args.tag
    existing = args.existing
    release_id = ""
    if args.github_event:
        tag, existing, release_id = resolve_from_github_event(Path(args.github_event))
    elif args.existing_file:
        existing = Path(args.existing_file).read_text()
    if args.meta_out:
        Path(args.meta_out).write_text(f"{tag}\n{release_id}\n")
    print(merge_existing(existing, tag), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
