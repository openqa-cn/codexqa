#!/usr/bin/env python3
"""Scan byte-identical copies once, then record every path.

A hit is produced for the representative file. Each twin with the same
bytes gets a copy of that hit at the same line. Files whose bytes differ
stay on the scan list and are not copied onto each other.
"""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path


def identical_scan_plan(repo: str | Path, paths: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    """Return paths to read, and representative -> identical twins.

    The representative is the first path in ``paths`` for that byte hash.
    Missing files are kept on the scan list and are not mirrored.
    """
    root = Path(repo) if repo else None
    groups: dict[str, list[str]] = {}
    order: list[str] = []
    scan: list[str] = []
    for rel in paths:
        if not rel:
            continue
        full = (root / rel) if root is not None else None
        if full is None or not full.is_file():
            scan.append(rel)
            continue
        digest = hashlib.sha256(full.read_bytes()).hexdigest()
        members = groups.get(digest)
        if members is None:
            groups[digest] = [rel]
            order.append(digest)
        else:
            members.append(rel)
    mirrors: dict[str, list[str]] = {}
    planned: list[str] = []
    for digest in order:
        members = groups[digest]
        rep = members[0]
        planned.append(rep)
        if len(members) > 1:
            mirrors[rep] = members[1:]
    planned.extend(scan)
    return planned, mirrors


def narrow_scan(
    repo: str | Path,
    paths: list[str],
    limit: int | None = None,
) -> tuple[list[str], dict[str, list[str]]]:
    """Drop identical twins before a file cap so the cap spends slots on unique bodies."""
    scan, mirrors = identical_scan_plan(repo, paths)
    if limit is not None:
        scan = scan[:limit]
        keep = set(scan)
        mirrors = {rep: twins for rep, twins in mirrors.items() if rep in keep}
    return scan, mirrors


def _location(item: dict) -> tuple[str, str]:
    if isinstance(item.get("path"), str) and item.get("path"):
        return "path", item["path"]
    if isinstance(item.get("file"), str) and item.get("file"):
        return "file", item["file"]
    return "", ""


def _flat_hit(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    _key, loc = _location(item)
    if not loc:
        return False
    if any(isinstance(value, (list, dict)) for value in item.values()):
        return False
    return isinstance(item.get("line"), int) or "kind" in item or "loc" in item


def expand_mirrored_hits(node: object, mirrors: dict[str, list[str]]) -> None:
    """Copy flat hit rows onto every byte-identical twin path."""
    if not mirrors:
        return
    if isinstance(node, list):
        expanded: list = []
        for item in list(node):
            expand_mirrored_hits(item, mirrors)
            expanded.append(item)
            if not _flat_hit(item):
                continue
            _key, loc = _location(item)
            for twin in mirrors.get(loc, []):
                clone = copy.deepcopy(item)
                for field in ("path", "file"):
                    if clone.get(field) == loc:
                        clone[field] = twin
                clone["mirrored_from"] = loc
                expanded.append(clone)
        node[:] = expanded
    elif isinstance(node, dict):
        for key, value in node.items():
            if key == "mirrored_from":
                continue
            expand_mirrored_hits(value, mirrors)
