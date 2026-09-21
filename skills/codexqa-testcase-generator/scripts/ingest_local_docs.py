#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local document ingest: read docs, collect first-level child docs, parse local diagrams.

Does not access the network, call a document platform, or install/depend on any external CLI.

Usage:
  scripts/tcg-python scripts/ingest_local_docs.py --input <file or directory> [--input ...] \\
      --output-dir <directory> [--svg-script <extract_svg_text.py>] [--no-merge]

Artifacts:
  {output-dir}/ingest-manifest.json
  {output-dir}/assets/<stem>.<ext>.txt     structured extract of local SVG / drawio
  {output-dir}/merged/<stem>.md            main doc + first-level children, flowcharts inserted
"""

from __future__ import annotations

from py_version import require_py310

require_py310()

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse


DOC_EXTS = {".md", ".markdown", ".txt", ".html", ".htm"}
RASTER_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
FLOW_EXTS = {".svg", ".drawio", ".dio"}
SKIP_DIR_NAMES = {".git", ".svn", "node_modules", "__pycache__"}

MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
HTML_IMAGE_RE = re.compile(r"<img\b[^>]*?\bsrc\s*=\s*['\"]([^'\"]+)['\"][^>]*>", re.I)
MD_LINK_RE = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)]+)\)")
H1_RE = re.compile(r"^#\s+(.+)$", re.M)
STRIKE_MD_RE = re.compile(r"~~(.*?)~~", re.S)
STRIKE_HTML_RE = re.compile(
    r"<(?:del|s)\b[^>]*>.*?</(?:del|s)>",
    re.I | re.S,
)
STRIKE_STYLE_RE = re.compile(
    r"<(?P<tag>span|div|p|font|td|th|li)\b"
    r"[^>]*\bstyle\s*=\s*"
    r"(?P<q>['\"])(?:(?!\2).)*text-decoration(?:-line)?\s*:\s*[^;'\"]*line-through"
    r"(?:(?!\2).)*\2[^>]*>.*?</(?P=tag)\s*>",
    re.I | re.S,
)
BARE_URL_RE = re.compile(r"https?://[^\s<>\[\]()\"']+")


def is_remote(target: str) -> bool:
    parsed = urlparse(target.strip())
    return parsed.scheme in {"http", "https"}


def is_data_uri(target: str) -> bool:
    return target.strip().lower().startswith("data:")


def strip_angle_url(raw: str) -> str:
    value = raw.strip()
    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1].strip()
    if " " in value and not value.startswith("http"):
        value = value.split(" ", 1)[0]
    if value.startswith("<") and ">" in value:
        value = value[1:value.index(">")].strip()
    return unquote(value.strip())


def classify_flow_asset(path: Path) -> bool:
    name = path.name.lower()
    return path.suffix.lower() in FLOW_EXTS or "drawio" in name


def safe_stem(path: Path) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", path.stem)[:80] or "doc"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def strip_strikethrough(text: str) -> tuple[str, int]:
    """Remove strikethrough fragments; keep adjacent unmarked body text. Return (text, dropped fragment count)."""
    count = 0

    def _drop(_match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return ""

    text = STRIKE_MD_RE.sub(_drop, text)
    text = STRIKE_HTML_RE.sub(_drop, text)
    text = STRIKE_STYLE_RE.sub(_drop, text)
    return text, count


def collect_bare_remote_urls(content: str, already: set[str]) -> list[str]:
    found: list[str] = []
    for match in BARE_URL_RE.finditer(content):
        url = match.group(0).rstrip(").,;。，、")
        if not is_remote(url) or url in already:
            continue
        already.add(url)
        found.append(url)
    return found


def extract_title(path: Path, content: str) -> str:
    match = H1_RE.search(content)
    if match:
        return match.group(1).strip()
    return path.stem


def iter_input_docs(raw_path: str) -> list[Path]:
    path = Path(raw_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError("Input does not exist: %s" % path)
    if path.is_file():
        return [path]
    docs: list[Path] = []
    for child in sorted(path.iterdir()):
        if child.name.startswith("."):
            continue
        if child.is_file() and child.suffix.lower() in DOC_EXTS:
            docs.append(child)
    if not docs:
        raise FileNotFoundError("No ingestible documents (.md/.txt/.html) in directory: %s" % path)
    return docs


def resolve_local(source_file: Path, raw_target: str) -> Path | None:
    target = strip_angle_url(raw_target)
    if not target or is_remote(target) or is_data_uri(target):
        return None
    if target.startswith("file://"):
        target = urlparse(target).path
    candidate = Path(target)
    if not candidate.is_absolute():
        candidate = (source_file.parent / target).resolve()
    return candidate if candidate.exists() else None


def find_sidecar_children(main_path: Path) -> list[Path]:
    """Documents in a same-name first-level subdirectory; read one level only."""
    sidecar = main_path.with_suffix("")
    if not sidecar.is_dir():
        return []
    children: list[Path] = []
    for child in sorted(sidecar.iterdir()):
        if child.name in SKIP_DIR_NAMES or child.name.startswith("."):
            continue
        if child.is_file() and child.suffix.lower() in DOC_EXTS:
            children.append(child)
    return children


def collect_markdown_targets(content: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Return (image list[(raw, kind)], document links[(label, raw)])."""
    images: list[tuple[str, str]] = []
    for match in MD_IMAGE_RE.finditer(content):
        images.append((strip_angle_url(match.group(2)), "md"))
    for match in HTML_IMAGE_RE.finditer(content):
        images.append((strip_angle_url(match.group(1)), "html"))

    links: list[tuple[str, str]] = []
    for match in MD_LINK_RE.finditer(content):
        links.append((match.group(1).strip(), strip_angle_url(match.group(2))))
    return images, links


def run_svg_extract(svg_script: Path, asset_path: Path, dest: Path) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [sys.executable, str(svg_script), str(asset_path), "--output", str(dest)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    text = dest.read_text(encoding="utf-8", errors="replace") if dest.is_file() else ""
    return {
        "ok": result.returncode == 0 and bool(text.strip()),
        "path": str(dest) if dest.is_file() else "",
        "text": text.strip(),
        "stderr": (result.stderr or "").strip(),
        "returncode": result.returncode,
    }


def media_block(kind: str, title: str, source: str, body: str) -> str:
    header = "📊 Flowchart summary" if kind == "flow" else "📷 Image content transcription"
    lines = ["> %s: %s (source: %s)" % (header, title or "untitled", source)]
    for line in (body or "").splitlines() or [""]:
        lines.append("> %s" % line)
    return "\n".join(lines)


def replace_image_token(content: str, raw_target: str, replacement: str) -> str:
    def md_repl(match: re.Match[str]) -> str:
        if strip_angle_url(match.group(2)) == raw_target:
            return replacement
        return match.group(0)

    def html_repl(match: re.Match[str]) -> str:
        if strip_angle_url(match.group(1)) == raw_target:
            return replacement
        return match.group(0)

    content = MD_IMAGE_RE.sub(md_repl, content)
    return HTML_IMAGE_RE.sub(html_repl, content)


def replace_doc_link(content: str, raw_target: str, title: str, child_body: str) -> str:
    block = "\n\n📄 Child document merged: %s\n\n%s\n" % (title, child_body.rstrip())

    def link_repl(match: re.Match[str]) -> str:
        if strip_angle_url(match.group(2)) == raw_target:
            return block
        return match.group(0)

    updated = MD_LINK_RE.sub(link_repl, content)
    if updated == content:
        updated = content.rstrip() + "\n" + block
    return updated


def ingest_one(main_path: Path, output_dir: Path, svg_script: Path, merge: bool) -> dict:
    raw_content = read_text(main_path)
    content, strike_count = strip_strikethrough(raw_content)
    title = extract_title(main_path, content)
    images, links = collect_markdown_targets(content)
    already_urls = {raw for raw, _kind in images} | {raw for _label, raw in links}

    asset_records = []
    seen_image_targets: set[str] = set()
    for raw_target, _kind in images:
        if raw_target in seen_image_targets:
            continue
        seen_image_targets.add(raw_target)
        record = {
            "raw": raw_target,
            "remote": is_remote(raw_target),
            "localPath": "",
            "exists": False,
            "type": "unknown",
            "extractPath": "",
            "status": "pending",
            "note": "",
        }
        if is_data_uri(raw_target):
            record["type"] = "data-uri"
            record["status"] = "skipped"
            record["note"] = "Embedded data URI; not written as a separate file"
            asset_records.append(record)
            continue
        if is_remote(raw_target):
            record["type"] = "remote"
            record["status"] = "unresolved"
            record["note"] = "Remote image was not downloaded; provide a local file instead"
            asset_records.append(record)
            continue

        local = resolve_local(main_path, raw_target)
        if local is None:
            record["status"] = "missing"
            record["note"] = "Relative path does not resolve to a local file"
            asset_records.append(record)
            continue

        record["localPath"] = str(local)
        record["exists"] = True
        if classify_flow_asset(local):
            record["type"] = "flow"
            dest = output_dir / "assets" / (local.name + ".txt")
            extracted = run_svg_extract(svg_script, local, dest)
            record["extractPath"] = extracted["path"]
            record["status"] = "extracted" if extracted["ok"] else "extract-failed"
            record["note"] = extracted["stderr"]
            record["extractText"] = extracted["text"]
        else:
            record["type"] = "raster" if local.suffix.lower() in RASTER_EXTS else "file"
            record["status"] = "local-ready"
            record["note"] = "Local image located; pending visual transcription"
        asset_records.append(record)

    child_records = []
    seen_children: set[str] = set()

    def add_child(path: Path, raw: str, label: str, source: str) -> None:
        key = str(path.resolve())
        if key in seen_children or path.resolve() == main_path.resolve():
            return
        seen_children.add(key)
        child_content = read_text(path)
        child_records.append({
            "raw": raw,
            "label": label,
            "source": source,
            "path": str(path),
            "title": extract_title(path, child_content),
            "status": "integrated" if merge else "discovered",
            "content": child_content,
        })

    for label, raw_target in links:
        suffix = Path(strip_angle_url(raw_target)).suffix.lower()
        looks_like_doc = suffix in DOC_EXTS or suffix == ""
        if is_remote(raw_target):
            if looks_like_doc:
                child_records.append({
                    "raw": raw_target,
                    "label": label,
                    "source": "link",
                    "path": "",
                    "title": label or raw_target,
                    "status": "unresolved-remote",
                    "note": "Remote child document was not fetched; provide a local file or directory instead",
                    "content": "",
                })
            continue
        local = resolve_local(main_path, raw_target)
        if local is None:
            if looks_like_doc:
                child_records.append({
                    "raw": raw_target,
                    "label": label,
                    "source": "link",
                    "path": "",
                    "title": label or raw_target,
                    "status": "missing",
                    "note": "Relative path does not resolve to a local file",
                    "content": "",
                })
            continue
        if local.is_file() and local.suffix.lower() in DOC_EXTS:
            add_child(local, raw_target, label, "link")

    for raw_target in collect_bare_remote_urls(content, already_urls):
        child_records.append({
            "raw": raw_target,
            "label": raw_target,
            "source": "bare-url",
            "path": "",
            "title": raw_target,
            "status": "unresolved-remote",
            "note": "Bare URL in body; remote content was not fetched; provide a local file or directory instead",
            "content": "",
        })

    for sidecar in find_sidecar_children(main_path):
        add_child(sidecar, sidecar.name, sidecar.stem, "sidecar-dir")

    merged = content
    if merge:
        for asset in asset_records:
            raw = asset["raw"]
            if asset["type"] == "flow" and asset.get("extractText"):
                block = media_block("flow", title, asset.get("localPath") or raw, asset["extractText"])
                merged = replace_image_token(merged, raw, block)
            elif asset["status"] == "local-ready":
                block = media_block(
                    "raster",
                    "pending visual transcription",
                    asset.get("localPath") or raw,
                    "📷 Pending visual transcription: %s" % asset.get("localPath"),
                )
                merged = replace_image_token(merged, raw, block)
            elif asset["status"] in {"unresolved", "missing", "extract-failed"}:
                block = "> 📷 Image fetch failed: %s, pending supplement" % raw
                merged = replace_image_token(merged, raw, block)

        for child in child_records:
            if child["status"] == "integrated" and child.get("content"):
                merged = replace_doc_link(merged, child["raw"], child["title"], child["content"])
            elif child["status"] in {"unresolved-remote", "missing"}:
                marker = "\n\n📄 Child document \"%s\" fetch failed, pending supplement (%s)\n" % (
                    child["title"],
                    child.get("note") or child["raw"],
                )
                if child["raw"] and child["raw"] in merged:
                    merged = replace_doc_link(merged, child["raw"], child["title"], marker.strip())
                else:
                    merged = merged.rstrip() + marker

    merged_path = ""
    if merge:
        merged_dir = output_dir / "merged"
        merged_dir.mkdir(parents=True, exist_ok=True)
        merged_path = str(merged_dir / ("%s.md" % safe_stem(main_path)))
        Path(merged_path).write_text(merged if merged.endswith("\n") else merged + "\n", encoding="utf-8")

    return {
        "path": str(main_path),
        "title": title,
        "mergedPath": merged_path,
        "imageMarkCount": len(seen_image_targets),
        "strikethroughSegmentsRemoved": strike_count,
        "children": [
            {k: v for k, v in child.items() if k != "content"}
            for child in child_records
        ],
        "assets": [
            {k: v for k, v in asset.items() if k != "extractText"}
            for asset in asset_records
        ],
    }


def default_svg_script() -> Path:
    return Path(__file__).resolve().parent / "extract_svg_text.py"


def emit_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest local requirement docs, first-level children, and local images/flowcharts")
    parser.add_argument("--input", action="append", required=True, help="Local file or directory; repeatable")
    parser.add_argument("--output-dir", required=True, help="Ingest artifact directory")
    parser.add_argument("--svg-script", default="", help="Path to extract_svg_text.py; defaults to the same directory as this script")
    parser.add_argument("--no-merge", action="store_true", help="Emit the manifest only; do not write a merged draft")
    args = parser.parse_args(list(argv) if argv is not None else None)

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    svg_script = Path(args.svg_script).expanduser().resolve() if args.svg_script else default_svg_script()
    if not svg_script.is_file():
        emit_json({
            "ok": False,
            "error": "SVG_SCRIPT_NOT_FOUND",
            "msg": "Cannot find extract_svg_text.py: %s" % svg_script,
        })
        return 1

    documents = []
    errors = []
    seen_mains: set[str] = set()
    for raw in args.input:
        try:
            mains = iter_input_docs(raw)
        except FileNotFoundError as exc:
            errors.append(str(exc))
            continue
        for main_path in mains:
            key = str(main_path.resolve())
            if key in seen_mains:
                continue
            seen_mains.add(key)
            documents.append(ingest_one(main_path, output_dir, svg_script, merge=not args.no_merge))

    remote_titles: list[str] = []
    missing_titles: list[str] = []
    strike_total = 0
    for doc in documents:
        strike_total += int(doc.get("strikethroughSegmentsRemoved") or 0)
        for child in doc.get("children") or []:
            title = child.get("title") or child.get("raw") or ""
            if child.get("status") == "unresolved-remote" and title:
                remote_titles.append(title)
            elif child.get("status") == "missing" and title:
                missing_titles.append(title)
    gap_stats = {
        "unresolvedRemoteCount": len(remote_titles),
        "missingLocalCount": len(missing_titles),
        "strikethroughSegmentsRemoved": strike_total,
        "unresolvedRemoteTitles": remote_titles[:20],
        "missingLocalTitles": missing_titles[:20],
    }
    manifest = {
        "ok": not errors and bool(documents),
        "documentCount": len(documents),
        "errors": errors,
        "gapStats": gap_stats,
        "documents": documents,
    }
    manifest_path = output_dir / "ingest-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "manifest=%s" % manifest_path,
        "documents=%d" % len(documents),
        "unresolvedRemote=%d" % gap_stats["unresolvedRemoteCount"],
        "missingLocal=%d" % gap_stats["missingLocalCount"],
        "strikethroughRemoved=%d" % strike_total,
    ]
    if errors:
        lines.extend("ERROR: %s" % item for item in errors)
    if not documents:
        lines.append("ERROR: No ingestible documents")
    emit_json({
        "ok": manifest["ok"],
        "manifestPath": str(manifest_path),
        "documentCount": len(documents),
        "errors": errors,
        "gapStats": gap_stats,
        "msg": "\n".join(lines),
    })
    return 0 if manifest["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
