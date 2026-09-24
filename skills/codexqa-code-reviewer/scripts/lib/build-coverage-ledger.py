#!/usr/bin/env python3
"""Build 24-coverage-ledger.json from an existing evidence pack.

Queue membership comes from changed symbols (pr/adhoc) or the risk-ranked
full-repo sample. Scanner hits are attached to symbols and never dequeue them.
No CodexQA calls.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from typing import Any

from _line_scan import is_source_path

EXCLUDE_DIRS = {"generated", "vendor", "node_modules", "dist", "target"}
LOCK_NAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "cargo.lock",
    "go.sum",
    "composer.lock",
    "gemfile.lock",
    "packages.lock.json",
}
BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
    ".woff", ".woff2", ".jar", ".zip", ".class", ".so", ".dll",
    ".exe", ".bin", ".wasm",
}
SIGNAL_GLOBS = ("1*-*signals.json", "2*-*signals.json")
SKIP_WALK_KEYS = {
    "derive_suspects",
    "triage",
    "notes",
    "evidence_refs",
    "thresholds",
    "confidence_caps",
    "summary",
    "surfaces",
    "llm_report_policy",
    "tools",
}


def load_json(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def nodes_of(doc: Any) -> list[dict]:
    if not isinstance(doc, dict):
        return []
    raw = doc.get("nodes")
    if not isinstance(raw, list):
        result = doc.get("result")
        if isinstance(result, dict):
            raw = result.get("nodes")
    if not isinstance(raw, list):
        return []
    return [node for node in raw if isinstance(node, dict)]


def symbol_path(node: dict) -> str:
    for key in ("file_path", "file", "path"):
        raw = node.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.replace("\\", "/").lstrip("./")
    return ""


def same_path(left: str, right: str) -> bool:
    a = left.replace("\\", "/").lstrip("./")
    b = right.replace("\\", "/").lstrip("./")
    if not a or not b:
        return False
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def path_excluded(path: str) -> bool:
    norm = path.replace("\\", "/").lower()
    parts = [part for part in norm.split("/") if part]
    if any(part in EXCLUDE_DIRS for part in parts):
        return True
    base = parts[-1] if parts else ""
    if base in LOCK_NAMES or base.endswith(".lock") or base.endswith(".sum"):
        return True
    if any(base.endswith(ext) for ext in BINARY_EXTS):
        return True
    if ".generated." in base or base.endswith("_generated.go"):
        return True
    return False


def safe_id(symbol_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", symbol_id)


def edges_path(pack: Path, symbol_id: str) -> Path | None:
    safe = safe_id(symbol_id)
    direct = (
        pack / "impact" / safe / "edges-in.json",
        pack / "impact" / f"{safe}_" / "edges-in.json",
        pack / "impact" / symbol_id / "edges-in.json",
    )
    for candidate in direct:
        if candidate.is_file():
            return candidate
    impact = pack / "impact"
    if not impact.is_dir():
        return None
    for candidate in impact.glob("*/edges-in.json"):
        name = candidate.parent.name
        if name == safe or name.rstrip("_") == safe:
            return candidate
    return None


def callers_for(pack: Path, symbol_id: str, names: dict[str, str]) -> tuple[str, list[dict]]:
    path = edges_path(pack, symbol_id)
    if path is None:
        return "unknown", []
    doc = load_json(path)
    edges = []
    if isinstance(doc, dict):
        raw = doc.get("edges")
        if isinstance(raw, list):
            edges = raw
    found: list[dict] = []
    seen: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        caller_id = str(edge.get("from_id") or "").strip()
        if not caller_id or caller_id in seen or caller_id == symbol_id:
            continue
        seen.add(caller_id)
        found.append({"id": caller_id, "name": names.get(caller_id) or ""})
    return "present", found


def walk_hits(node: Any, source: str, out: list[dict]) -> None:
    if isinstance(node, dict):
        disposition = node.get("disposition")
        line = node.get("line")
        if disposition in {"report", "suspect"} and isinstance(line, int):
            file_path = node.get("path") or node.get("file") or ""
            if isinstance(file_path, str):
                out.append({
                    "path": file_path.replace("\\", "/"),
                    "line": line,
                    "disposition": disposition,
                    "rule_id": str(node.get("rule_id") or ""),
                    "kind": str(node.get("kind") or node.get("pattern_class") or node.get("title") or ""),
                    "source": source,
                })
        for key, child in node.items():
            if key in SKIP_WALK_KEYS:
                continue
            walk_hits(child, source, out)
    elif isinstance(node, list):
        for child in node:
            walk_hits(child, source, out)


def collect_hits(pack: Path) -> list[dict]:
    hits: list[dict] = []
    seen: set[tuple] = set()
    paths = []
    for pattern in SIGNAL_GLOBS:
        paths.extend(sorted(pack.glob(pattern)))
    for path in paths:
        doc = load_json(path)
        if doc is None:
            continue
        found: list[dict] = []
        walk_hits(doc, path.name, found)
        for hit in found:
            key = (hit["path"], hit["line"], hit["disposition"], hit["rule_id"], hit["kind"], hit["source"])
            if key in seen:
                continue
            seen.add(key)
            hits.append(hit)
    return hits


def hits_for(symbol_path_value: str, start: int | None, end: int | None, hits: list[dict]) -> tuple[list[dict], list[dict]]:
    matched = []
    if not isinstance(start, int) or not isinstance(end, int) or end < start:
        return matched, hits
    rest = []
    for hit in hits:
        line = hit["line"]
        if start <= line <= end and (not hit["path"] or not symbol_path_value or same_path(symbol_path_value, hit["path"])):
            matched.append(hit)
        else:
            rest.append(hit)
    return matched, rest


def tier_paths(doc: Any) -> dict[str, set[str]]:
    found = {"T0": set(), "T1": set()}
    if not isinstance(doc, dict):
        return found
    for row in doc.get("file_tiers") or []:
        if not isinstance(row, dict):
            continue
        path = str(row.get("path") or "").strip()
        tier = str(row.get("tier") or "")
        if path and tier in found:
            found[tier].add(path)
    return found


def hotspot_ids(doc: Any) -> set[str]:
    return {str(node.get("id")) for node in nodes_of(doc) if node.get("id")}


def is_entry(node: dict) -> bool:
    tags = node.get("tag_count") or 0
    annotations = node.get("annotations") or []
    if isinstance(tags, int) and tags > 0:
        return True
    return isinstance(annotations, list) and len(annotations) > 0


def in_risk_queue(node: dict, hotspots: set[str], tiers: dict[str, set[str]]) -> bool:
    symbol_id = str(node.get("id") or "")
    if symbol_id and symbol_id in hotspots:
        return True
    path = symbol_path(node)
    for tier in ("T0", "T1"):
        if any(same_path(path, candidate) for candidate in tiers[tier]):
            return True
    tested = node.get("tested_count")
    return tested == 0 and is_entry(node)


def line_of(node: dict, key: str) -> int | None:
    value = node.get(key)
    return value if isinstance(value, int) else None


def usable_symbol_doc(doc: Any) -> dict | None:
    if not isinstance(doc, dict) or doc.get("error") is True:
        return None
    if "nodes" not in doc and not (isinstance(doc.get("result"), dict) and "nodes" in doc["result"]):
        return None
    return doc


def universe_for(pack: Path, mode: str) -> tuple[str, dict, bool]:
    if mode == "adhoc":
        alt = usable_symbol_doc(load_json(pack / "05-coverage-universe.json"))
        if alt is not None:
            return "05-coverage-universe.json", alt, False
        source = load_json(pack / "05-changed-symbols.json") or {}
        methods = [node for node in nodes_of(source) if node.get("kind") in {"function", "method"}]
        return "05-changed-symbols.json", source if isinstance(source, dict) else {}, len(methods) >= 60
    if mode == "pr":
        source = load_json(pack / "05-changed-symbols.json") or {}
        return "05-changed-symbols.json", source if isinstance(source, dict) else {}, False
    source = load_json(pack / "04-hot-symbols.json") or {}
    return "04-hot-symbols.json", source if isinstance(source, dict) else {}, False


def changed_file_paths(pack: Path) -> list[str]:
    doc = load_json(pack / "04-changed-files.json")
    paths: list[str] = []
    for node in nodes_of(doc) if isinstance(doc, dict) else []:
        path = symbol_path(node)
        if path:
            paths.append(path)
    if isinstance(doc, dict):
        for item in doc.get("files") or []:
            if isinstance(item, str) and item.strip():
                paths.append(item.replace("\\", "/"))
            elif isinstance(item, dict):
                path = symbol_path(item)
                if path:
                    paths.append(path)
    seen: set[str] = set()
    unique: list[str] = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        unique.append(path)
    return unique


def uncovered_ranges(line_count: int, spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    covered = [False] * (line_count + 1)
    for start, end in spans:
        for index in range(max(1, start), min(line_count, end) + 1):
            covered[index] = True
    ranges: list[tuple[int, int]] = []
    start: int | None = None
    for index in range(1, line_count + 1):
        if not covered[index]:
            if start is None:
                start = index
        elif start is not None:
            ranges.append((start, index - 1))
            start = None
    if start is not None:
        ranges.append((start, line_count))
    return ranges


def nonblank_ranges(lines: list[str], ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    kept: list[tuple[int, int]] = []
    for start, end in ranges:
        chunk_start: int | None = None
        for index in range(start, end + 1):
            text = lines[index - 1] if 0 < index <= len(lines) else ""
            if text.strip():
                if chunk_start is None:
                    chunk_start = index
            elif chunk_start is not None:
                kept.append((chunk_start, index - 1))
                chunk_start = None
        if chunk_start is not None:
            kept.append((chunk_start, end))
    return kept


def method_spans(path: str, symbols: list[dict]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for row in symbols:
        if row.get("kind") not in {"function", "method"}:
            continue
        if not same_path(path, str(row.get("path") or "")):
            continue
        start = row.get("start_line")
        end = row.get("end_line")
        if isinstance(start, int) and isinstance(end, int) and end >= start:
            spans.append((start, end))
    return spans


def hits_in_ranges(path: str, ranges: list[tuple[int, int]], hits: list[dict]) -> tuple[list[dict], list[dict]]:
    matched: list[dict] = []
    rest: list[dict] = []
    for hit in hits:
        line = hit["line"]
        in_range = any(start <= line <= end for start, end in ranges)
        path_ok = not hit["path"] or not path or same_path(path, hit["path"])
        if in_range and path_ok:
            matched.append(hit)
        else:
            rest.append(hit)
    return matched, rest


def assign_read_groups(symbols: list[dict], source_root: str) -> list[dict]:
    """One group per distinct file body. Identical copies share the group."""
    root = Path(source_root) if source_root and Path(source_root).is_dir() else None
    cache: dict[str, str] = {}

    def group_id(path: str) -> str:
        if path in cache:
            return cache[path]
        gid = "path:" + path
        if root is not None and path:
            full = root / path
            if full.is_file():
                gid = "blob:" + hashlib.sha256(full.read_bytes()).hexdigest()
        cache[path] = gid
        return gid

    grouped: dict[str, dict] = {}
    for row in symbols:
        if row.get("status") != "pending":
            continue
        path = str(row.get("path") or "")
        gid = group_id(path) if path else "symbol:" + str(row.get("symbol_id") or "")
        row["read_group"] = gid
        bucket = grouped.get(gid)
        if bucket is None:
            bucket = {"id": gid, "paths": [], "symbol_ids": []}
            grouped[gid] = bucket
        if path and path not in bucket["paths"]:
            bucket["paths"].append(path)
        symbol_id = str(row.get("symbol_id") or "")
        if symbol_id:
            bucket["symbol_ids"].append(symbol_id)
    return list(grouped.values())


def stamp_span_hashes(symbols: list[dict], source_root: str) -> None:
    """Store the closure hash the conclusion gate recomputes. Same bytes, same ranges."""
    path = Path(__file__).resolve().parent / "validate-conclusion.py"
    spec = importlib.util.spec_from_file_location("validate_conclusion_span", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("validate-conclusion.py is not importable")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    root = Path(source_root) if source_root and Path(source_root).is_dir() else None
    lines_cache: dict[str, list[str]] = {}
    for row in symbols:
        if row.get("status") != "pending":
            continue
        rel = str(row.get("path") or "")
        full = (root / rel) if root is not None and rel else None
        if full is None or not full.is_file():
            row.pop("span_hash", None)
            row["span_check"] = "unverified"
            continue
        if rel not in lines_cache:
            try:
                lines_cache[rel] = full.read_text(encoding="utf-8", errors="ignore").splitlines()
            except OSError:
                row.pop("span_hash", None)
                row["span_check"] = "unverified"
                continue
        row["span_hash"] = mod.span_hash(lines_cache[rel], mod.symbol_ranges(row))
        row.pop("span_check", None)


def build(pack: Path, mode: str, source_root: str = "") -> dict:
    source_name, source, universe_capped = universe_for(pack, mode)
    raw_nodes = [node for node in nodes_of(source) if node.get("kind") in {"function", "method"}]
    names = {str(node.get("id")): str(node.get("name") or "") for node in raw_nodes if node.get("id")}
    hotspots = hotspot_ids(load_json(pack / "05-untested-hotspots.json"))
    tiers = tier_paths(load_json(pack / "20-risk-tier.json"))
    remaining_hits = collect_hits(pack)
    symbols = []
    for node in raw_nodes:
        path = symbol_path(node)
        symbol_id = str(node.get("id") or "")
        start = line_of(node, "start_line")
        end = line_of(node, "end_line")
        matched, remaining_hits = hits_for(path, start, end, remaining_hits)
        callers_status, callers = ("unknown", [])
        if symbol_id:
            callers_status, callers = callers_for(pack, symbol_id, names)
        if path_excluded(path):
            status, reason = "excluded", "path_excluded"
        elif mode == "full" and not in_risk_queue(node, hotspots, tiers):
            status, reason = "excluded", "outside_risk_budget"
        else:
            status, reason = "pending", ""
        symbols.append({
            "symbol_id": symbol_id,
            "name": str(node.get("name") or ""),
            "kind": node.get("kind"),
            "path": path,
            "start_line": start,
            "end_line": end,
            "status": status,
            "reason": reason,
            "callers_status": callers_status,
            "ranges": [[start, end]] if isinstance(start, int) and isinstance(end, int) and end >= start else [],
            "callers": callers,
            "hits": matched,
        })
    non_source_skipped = 0
    if mode in {"pr", "adhoc"} and source_root and Path(source_root).is_dir():
        root = Path(source_root)
        for rel in changed_file_paths(pack):
            if path_excluded(rel):
                continue
            if not is_source_path(rel):
                non_source_skipped += 1
                continue
            full = root / rel
            if not full.is_file():
                continue
            try:
                file_lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
            except OSError:
                continue
            ranges = nonblank_ranges(file_lines, uncovered_ranges(len(file_lines), method_spans(rel, symbols)))
            if not ranges:
                continue
            matched, remaining_hits = hits_in_ranges(rel, ranges, remaining_hits)
            symbols.append({
                "symbol_id": "file-scope:" + rel,
                "name": "file_scope",
                "kind": "file_scope",
                "path": rel,
                "start_line": ranges[0][0],
                "end_line": ranges[-1][1],
                "ranges": [[start, end] for start, end in ranges],
                "status": "pending",
                "reason": "",
                "callers_status": "unknown",
                "callers": [],
                "hits": matched,
            })
    stats = load_json(pack / "01-stats.json")
    stats_nodes = None
    if isinstance(stats, dict) and isinstance(stats.get("nodes_total"), int):
        stats_nodes = stats["nodes_total"]
    read_groups = assign_read_groups(symbols, source_root)
    stamp_span_hashes(symbols, source_root)
    pending = sum(1 for row in symbols if row["status"] == "pending")
    excluded = sum(1 for row in symbols if row["status"] == "excluded")
    notes = [
        "Scanner hits are annotations. A hit does not remove a symbol from the pending queue.",
        "Callers come only from impact/*/edges-in.json. An unknown callers_status is not an empty caller list.",
        "Residual reading opens each read_group once. Byte-identical copies share a group. Every pending symbol, including file_scope, still gets its own coverage_closure. Copy span_hash or span_check from the symbol; do not recompute the digest.",
        "Non-source changed files are not residual symbols. Their path class and a one-line sample stay on 26-review-digest.json. Report lines are not dropped.",
    ]
    if universe_capped:
        notes.append("Adhoc coverage universe is missing, so the ledger fell back to the capped 05-changed-symbols slice.")
    if mode == "full":
        notes.append("Symbols beyond 04-hot-symbols.json are outside_symbol_sample and are not enumerated.")
    outside_sample = None
    if mode == "full" and isinstance(stats_nodes, int) and stats_nodes > len(raw_nodes):
        outside_sample = "unenumerated"
    return {
        "kind": "CoverageLedger",
        "schema_version": 1,
        "generated_by": "build-coverage-ledger.py",
        "mode": mode,
        "source_root": source_root if source_root and Path(source_root).is_dir() else "",
        "universe_source": source_name,
        "universe_capped": universe_capped,
        "symbols": symbols,
        "orphan_hits": remaining_hits,
        "summary": {
            "pending": pending,
            "excluded": excluded,
            "path_excluded": sum(1 for row in symbols if row["reason"] == "path_excluded"),
            "outside_risk_budget": sum(1 for row in symbols if row["reason"] == "outside_risk_budget"),
            "outside_symbol_sample": outside_sample,
            "stats_nodes": stats_nodes,
            "fetched_methods": len(raw_nodes),
            "non_source_skipped": non_source_skipped,
            "read_groups": len(read_groups),
        },
        "read_groups": read_groups,
        "notes": notes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Write 24-coverage-ledger.json")
    parser.add_argument("--dir", required=True, help="Evidence pack directory")
    parser.add_argument("--mode", required=True, choices=("pr", "full", "adhoc"))
    parser.add_argument("--repo", default="", help="Source root used to hash file-scope lines")
    args = parser.parse_args()
    pack = Path(args.dir)
    pack.mkdir(parents=True, exist_ok=True)
    ledger = build(pack, args.mode, args.repo)
    out = pack / "24-coverage-ledger.json"
    out.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Coverage ledger written: {out} pending={ledger['summary']['pending']} excluded={ledger['summary']['excluded']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
