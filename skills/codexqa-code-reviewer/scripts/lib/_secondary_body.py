#!/usr/bin/env python3
"""Bounded observability / contract / maintainability / XSS heuristics.

Shared body used by derive-observability / derive-contract / derive-maintainability.
Zero network. Zero extra CodexQA.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import advance_block_state, window_code_lines, is_heuristic_meta_line  # noqa: E402

MAX_FILES = 40
MAX_LINES = 4000
ROOT_ENUM_LIMIT = 24

SOURCE_EXTS = {
    ".java", ".kt", ".kts", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".cs", ".rb", ".php", ".swift", ".scala", ".rs",
}

SKIP_DIR_PARTS = {
    "node_modules", "vendor", ".git", "dist", "build", ".codexqa-review",
    "target", "__pycache__",
}

CATCH_OPEN = re.compile(
    r"(?i)^\s*(catch\s*\(|except\s*:|except\s+(\w|\()|}\s*catch\s*\()"
)
OBS_CLUE = re.compile(
    r"(?i)\b(log|logger|metric|counter|histogram|timer|span|trace|Sentry|"
    r"StatsD|prometheus|otel|OpenTelemetry|monitor|alarm)\b"
)
PUB_SIG = re.compile(
    r"(?i)^\s*(?:\+|-)?\s*(public|export\s+(async\s+)?function|export\s+const|"
    r"func\s+[A-Z]|def\s+\w+|pub\s+fn)\b"
)
BREAKING_HINT = re.compile(
    r"(?i)("
    r"@Deprecated|"
    r"\bdeprecated\s*[:=([]|"
    r"\bbreaking[_-]?change\b|"
    r"\bremoved?\s+(endpoint|api|field|param)\b|"
    r"\bobsolete\b"
    r")"
)
XSS_SINK = re.compile(
    r"(?i)\b(innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML|"
    r"\|safe\b|markup\(|HtmlUtils\.|unescapeHtml|text/template|"
    r"template\.HTML|v-html\s*=)\b"
)
XSS_ESCAPE = re.compile(
    r"(?i)\b(escape|encode|sanitize|DOMPurify|html/template|HtmlEncoder|"
    r"OWASP|antisamy|bleach)\b"
)
TODO_RE = re.compile(r"(?i)\b(TODO|FIXME|HACK|XXX)\b")
MAGIC_NUM = re.compile(r"(?<![\w.])\b([2-9]\d{2,}|[1-9]\d{3,})\b")


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


def is_source(rel: str) -> bool:
    low = rel.replace("\\", "/").lower()
    if set(low.split("/")) & SKIP_DIR_PARTS:
        return False
    _, ext = os.path.splitext(low)
    return ext in SOURCE_EXTS


def read_lines(abs_path: str) -> list[str]:
    try:
        lines = []
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                if i >= MAX_LINES:
                    break
                lines.append(line.rstrip("\n"))
        return lines
    except Exception:
        return []


def enumerate_root(repo: str) -> list[str]:
    if not repo or not os.path.isdir(repo):
        return []
    out = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_PARTS and not d.startswith(".")]
        rel_root = os.path.relpath(root, repo)
        depth = 0 if rel_root == "." else rel_root.count(os.sep) + 1
        if depth > 4:
            dirs.clear()
            continue
        for name in files:
            rel = name if rel_root == "." else os.path.join(rel_root, name)
            rel = rel.replace("\\", "/")
            if is_source(rel):
                out.append(rel)
            if len(out) >= ROOT_ENUM_LIMIT:
                return out
    return out


def hit(rel, line, kind, snippet):
    return {"path": rel, "line": line, "kind": kind, "snippet": snippet.strip()[:160]}


def scan(rel: str, lines: list[str]) -> dict:
    missing_obs = []
    xss = []
    todos = []
    magic = []
    pub_sigs = 0
    breaking = []
    # TODO/FIXME: still scan comments (debt markers live in comments by design)
    in_block = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        skip, in_block = advance_block_state(stripped, in_block)
        if TODO_RE.search(line):
            todos.append(hit(rel, i + 1, "todo_fixme", line))
        if skip:
            continue
        if is_heuristic_meta_line(line) or is_heuristic_meta_line(stripped):
            continue
        if CATCH_OPEN.search(line):
            window = window_code_lines(lines, i, 5)
            if not OBS_CLUE.search(window):
                missing_obs.append(hit(rel, i + 1, "catch_without_obs", line))
        if XSS_SINK.search(line) and not XSS_ESCAPE.search(
            window_code_lines(lines, i, 2)
        ):
            xss.append(hit(rel, i + 1, "xss_html_sink", line))
        if MAGIC_NUM.search(line) and not re.search(r"(?i)(port|timeout|status|http)", line):
            magic.append(hit(rel, i + 1, "magic_number", line))
        if PUB_SIG.search(line):
            pub_sigs += 1
        if BREAKING_HINT.search(line):
            breaking.append(hit(rel, i + 1, "breaking_hint", line))
    return {
        "missing_obs": missing_obs[:15],
        "xss": xss[:15],
        "todos": todos[:20],
        "magic": magic[:15],
        "pub_sigs": pub_sigs,
        "breaking": breaking[:10],
        "loc": len(lines),
    }


def collect(repo: str, files_json: str) -> dict:
    files_obj = load(files_json)
    paths = [p for p in file_paths(files_obj) if is_source(p)][:MAX_FILES]
    if not paths and repo:
        paths = enumerate_root(repo)[:MAX_FILES]
    missing_obs, xss, todos, magic, breaking = [], [], [], [], []
    pub_sigs = 0
    long_files = []
    scanned = 0
    for rel in paths:
        abs_p = os.path.join(repo, rel) if repo else ""
        if not abs_p or not os.path.isfile(abs_p):
            continue
        lines = read_lines(abs_p)
        if not lines:
            continue
        scanned += 1
        sc = scan(rel, lines)
        missing_obs.extend(sc["missing_obs"])
        xss.extend(sc["xss"])
        todos.extend(sc["todos"])
        magic.extend(sc["magic"])
        breaking.extend(sc["breaking"])
        pub_sigs += sc["pub_sigs"]
        if sc["loc"] >= 800:
            long_files.append({"path": rel, "loc": sc["loc"], "kind": "long_file"})
    return {
        "body_ok": True,
        "repo_resolved": bool(repo and os.path.isdir(repo)),
        "files_considered": len(paths),
        "files_scanned": scanned,
        "missing_observability": missing_obs[:30],
        "xss_html_hits": xss[:30],
        "todo_fixme": todos[:30],
        "magic_numbers": magic[:30],
        "long_files": long_files[:20],
        "public_sig_lines": pub_sigs,
        "breaking_hints": breaking[:20],
    }


def main() -> None:
    # argv: repo, files_json, out_path, kind(observability|contract|maintainability)
    repo, files_json, out_path, kind = sys.argv[1:5]
    raw = collect(repo, files_json)
    if kind == "observability":
        thin = len(raw["missing_observability"]) == 0
        payload = {
            **{k: raw[k] for k in ("body_ok", "repo_resolved", "files_considered", "files_scanned")},
            "signals_thin": thin,
            "missing_observability": raw["missing_observability"],
            "thresholds": {"max_files": MAX_FILES, "max_lines": MAX_LINES},
        }
    elif kind == "contract":
        thin = len(raw["breaking_hints"]) == 0 and len(raw["xss_html_hits"]) == 0
        payload = {
            **{k: raw[k] for k in ("body_ok", "repo_resolved", "files_considered", "files_scanned")},
            "signals_thin": thin,
            "breaking_hints": raw["breaking_hints"],
            "xss_html_hits": raw["xss_html_hits"],
            "public_sig_lines": raw["public_sig_lines"],
            "thresholds": {"max_files": MAX_FILES, "max_lines": MAX_LINES},
            "notes": [
                "xss_html_hits → prefer category security/correctness when raising findings",
                "public_sig_lines is a volume hint; confirm drift via edges-in callers",
            ],
        }
    else:  # maintainability
        thin = (
            len(raw["todo_fixme"]) == 0
            and len(raw["magic_numbers"]) == 0
            and len(raw["long_files"]) == 0
        )
        payload = {
            **{k: raw[k] for k in ("body_ok", "repo_resolved", "files_considered", "files_scanned")},
            "signals_thin": thin,
            "todo_fixme": raw["todo_fixme"],
            "magic_numbers": raw["magic_numbers"],
            "long_files": raw["long_files"],
            "thresholds": {"max_files": MAX_FILES, "max_lines": MAX_LINES, "long_file_loc": 800},
        }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
