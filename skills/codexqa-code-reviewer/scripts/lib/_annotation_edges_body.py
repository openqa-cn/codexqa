#!/usr/bin/env python3
"""Synthetic annotation-edge compensation (0 CodexQA).

Framework callbacks (@CircuitBreaker fallbackMethod, Spring MVC/Kafka/Scheduled
entry annotations) often have edges-in=0 in the symbol graph. This scan emits
synthetic callers so high-severity findings can cite annotation edges instead of
inventing UNKNOWN-only callers.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

MAX_FILES = 40
MAX_LINES = 5000
ROOT_ENUM_LIMIT = 24

SOURCE_EXTS = {
    ".java",
    ".kt",
    ".kts",
    ".scala",
}

SKIP_DIR_PARTS = {
    "node_modules",
    "vendor",
    ".git",
    "dist",
    "build",
    ".codexqa-review",
    "target",
    "__pycache__",
}

# @CircuitBreaker(..., fallbackMethod = "foo")
FALLBACK_METHOD = re.compile(
    r"(?i)@(?:CircuitBreaker|Retry|RateLimiter|Bulkhead|TimeLimiter)\b[^\n]*?"
    r"fallbackMethod\s*=\s*\"([A-Za-z_][\w]*)\""
)
# Method following an annotation block — crude: look for next method decl
METHOD_DECL = re.compile(
    r"(?m)^\s*(?:public|protected|private|static|final|synchronized|native|\s)*"
    r"[\w.<>,\[\]?]+\s+([A-Za-z_][\w]*)\s*\("
)

ENTRY_ANN = re.compile(
    r"(?i)@(?:RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|"
    r"MessageMapping|KafkaListener|RabbitListener|JmsListener|Scheduled|EventListener|"
    r"RestController|Controller)\b"
)


def load_paths(pack_dir: str, warnings: list[str]) -> list[str]:
    paths: list[str] = []
    for name in (
        "04-changed-files.json",
        "03-files-sample.json",
        "05-changed-symbols.json",
        "04-hot-symbols.json",
    ):
        p = Path(pack_dir) / name
        if not p.is_file():
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            msg = f"annotation_edges: skip unreadable pack file {name}: {exc}"
            warnings.append(msg)
            print(f"warn: {msg}", file=sys.stderr)
            continue
        arr = (
            obj.get("nodes")
            or obj.get("result", {}).get("nodes")
            or obj.get("files")
            or obj.get("result", {}).get("files")
            or obj.get("paths")
            or []
        )
        if not isinstance(arr, list):
            continue
        for x in arr:
            if isinstance(x, str) and x:
                paths.append(x)
            elif isinstance(x, dict):
                fp = x.get("path") or x.get("file") or x.get("name")
                if isinstance(fp, str) and fp:
                    paths.append(fp)
        if paths:
            break
    # unique preserve order
    seen = set()
    out = []
    for p in paths:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
        if len(out) >= MAX_FILES:
            break
    return out


def enum_repo(repo: str) -> list[str]:
    out = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_PARTS and not d.startswith(".")]
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in SOURCE_EXTS:
                continue
            rel = os.path.relpath(os.path.join(root, fn), repo)
            if any(part in SKIP_DIR_PARTS for part in rel.replace("\\", "/").split("/")):
                continue
            out.append(rel.replace("\\", "/"))
            if len(out) >= ROOT_ENUM_LIMIT:
                return out
    return out


def scan_file(rel: str, lines: list[str]) -> list[dict]:
    hits = []
    n = len(lines)
    # fallbackMethod edges: annotated method → fallback method (synthetic caller of fallback)
    for i, line in enumerate(lines):
        window = "\n".join(lines[max(0, i - 2) : min(n, i + 8)])
        m = FALLBACK_METHOD.search(window)
        if not m:
            continue
        fb = m.group(1)
        # find primary method name after annotations
        primary = None
        for j in range(i, min(n, i + 25)):
            md = METHOD_DECL.search(lines[j])
            if md and md.group(1) != fb:
                primary = md.group(1)
                break
        if not primary:
            continue
        hits.append(
            {
                "kind": "fallbackMethod",
                "path": rel,
                "line": i + 1,
                "from_name": primary,
                "to_name": fb,
                "caller_role": "annotation_callback",
                "note": f"@{primary} declares fallbackMethod=\"{fb}\" — synthetic edge (graph edges-in often 0)",
                "confidence": "medium",
            }
        )
        # also reverse: framework invokes primary (entry-like)
        hits.append(
            {
                "kind": "annotated_target",
                "path": rel,
                "line": i + 1,
                "from_name": f"@{primary}_annotation",
                "to_name": primary,
                "caller_role": "framework_annotation",
                "note": f"resilience annotation on {primary} — cite as framework caller when edges-in empty",
                "confidence": "low",
            }
        )

    # Spring entry annotations
    for i, line in enumerate(lines):
        if not ENTRY_ANN.search(line):
            continue
        primary = None
        for j in range(i, min(n, i + 20)):
            md = METHOD_DECL.search(lines[j])
            if md:
                primary = md.group(1)
                break
        if not primary:
            # class-level RestController — record type entry
            hits.append(
                {
                    "kind": "spring_entry_type",
                    "path": rel,
                    "line": i + 1,
                    "from_name": "SpringDispatcher",
                    "to_name": Path(rel).stem,
                    "caller_role": "framework_entry",
                    "snippet": line.strip()[:160],
                    "note": "Spring type-level entry annotation — edges-in often 0",
                    "confidence": "low",
                }
            )
            continue
        hits.append(
            {
                "kind": "spring_entry",
                "path": rel,
                "line": i + 1,
                "from_name": "SpringDispatcher",
                "to_name": primary,
                "caller_role": "framework_entry",
                "snippet": line.strip()[:160],
                "note": f"Spring/MQ/schedule entry on {primary} — cite as framework caller when edges-in empty",
                "confidence": "medium",
            }
        )
    # dedupe by kind+to_name+line
    seen = set()
    out = []
    for h in hits:
        key = (h.get("kind"), h.get("to_name"), h.get("line"), h.get("from_name"))
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out[:40]


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: _annotation_edges_body.py <pack_dir> <out_json> [repo]", file=sys.stderr)
        sys.exit(2)
    pack_dir, out_path = sys.argv[1], sys.argv[2]
    repo = sys.argv[3] if len(sys.argv) > 3 else ""
    warnings: list[str] = []
    if not repo:
        try:
            man = json.loads((Path(pack_dir) / "manifest.json").read_text(encoding="utf-8"))
            repo = man.get("repo") or ""
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            warnings.append(f"annotation_edges: manifest.json unreadable: {exc}")
            print(f"warn: annotation_edges: manifest.json unreadable: {exc}", file=sys.stderr)
            repo = ""

    paths = load_paths(pack_dir, warnings)
    if not paths and repo and os.path.isdir(repo):
        paths = enum_repo(repo)

    edges = []
    files_scanned = 0
    for rel in paths:
        abs_p = os.path.join(repo, rel) if repo else ""
        if not abs_p or not os.path.isfile(abs_p):
            continue
        try:
            lines = Path(abs_p).read_text(encoding="utf-8").splitlines()[:MAX_LINES]
        except (OSError, UnicodeError) as exc:
            msg = f"annotation_edges: skip source {rel}: {exc}"
            warnings.append(msg)
            print(f"warn: {msg}", file=sys.stderr)
            continue
        files_scanned += 1
        edges.extend(scan_file(rel, lines))

    # dedupe global
    seen = set()
    uniq = []
    for e in edges:
        key = (e.get("kind"), e.get("path"), e.get("to_name"), e.get("from_name"), e.get("line"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(e)

    notes = [
        "Synthetic edges for annotation callbacks / Spring entries — compensate empty edges-in.",
        "Cite callers from here with confidence medium|low; do not invent human callers.",
    ]
    if warnings:
        notes.extend(warnings[:12])

    payload = {
        "kind": "AnnotationEdges",
        "generated_by": "derive-annotation-edges.sh",
        "schema_version": 1,
        "signals_thin": len(uniq) == 0,
        "edges": uniq[:80],
        "files_scanned": files_scanned,
        "files_considered": len(paths),
        "warnings": warnings[:20],
        "notes": notes,
        "evidence_refs": ["04-changed-files.json", "on-disk sources"],
    }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
