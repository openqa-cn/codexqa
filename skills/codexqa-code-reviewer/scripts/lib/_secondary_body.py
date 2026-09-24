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
from _identical_copies import expand_mirrored_hits, narrow_scan  # noqa: E402
from _det_rules import (  # noqa: E402
    scan_decision_literals,
    scan_error_payload_candidates,
    scan_prod_test_coupling,
    scan_test_oracles,
    scan_uncontrolled_log_sinks,
    scan_unused_accumulators,
)

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
# Fee rates and short FX quotes. Kept separate so the integer magic cap still
# returns the same rows it always did; these are appended after that cap.
RATE_LITERAL = re.compile(
    r"(?<![\w.])0\.00\d+\b|new\s+BigDecimal\(\s*\"\d\.\d{2,}\"\s*\)"
)


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
    rate_literals = []
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
            row = hit(rel, i + 1, "magic_number", line)
            row["close"] = "per_line"
            magic.append(row)
        if RATE_LITERAL.search(line):
            row = hit(rel, i + 1, "rate_literal", line)
            row["close"] = "per_line"
            rate_literals.append(row)
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
        "rate_literals": rate_literals[:10],
        "loc": len(lines),
    }


_TYPE_DECL = re.compile(
    r"\b(?:class|interface|enum|struct)\s+\w+|\btype\s+\w+\s+struct\b"
)
_ROLE_PATTERNS = (
    ("storage", re.compile(r"(?i)\b(jdbc|DriverManager|executeUpdate|repository|dao)\b")),
    ("remote", re.compile(r"(?i)\b(https?://|HttpURLConnection|grpc\.)\b")),
    ("crypto", re.compile(r"(?i)\b(MessageDigest|Cipher|Mac\.)\b")),
    ("notify", re.compile(r"(?i)\b(smtp|sendMail|MimeMessage)\b")),
    ("test", re.compile(r"(?i)\b(org\.junit|pytest|testing\.T)\b")),
    ("money", re.compile(r"(?i)\b(fee|amount|balance|currency)\b")),
)


def mixed_responsibility(rel: str, lines: list[str]) -> dict:
    """Line count is not the only size signal. Many types or many roles still count."""
    text = "\n".join(lines)
    roles = [name for name, rx in _ROLE_PATTERNS if rx.search(text)]
    type_count = len(_TYPE_DECL.findall(text))
    if type_count < 6 and len(roles) < 4:
        return {}
    line = 0
    for index, row in enumerate(lines, 1):
        if _TYPE_DECL.search(row) or any(rx.search(row) for _name, rx in _ROLE_PATTERNS):
            line = index
            break
    if line <= 1:
        return {}
    return {
        "path": rel,
        "loc": len(lines),
        "line": line,
        "kind": "mixed_responsibility",
        "type_count": type_count,
        "roles": roles,
        "visible_absence": True,
        "note": "responsibility mix is independent of the line-count threshold",
    }


def collect(repo: str, files_json: str) -> dict:
    files_obj = load(files_json)
    candidates = [p for p in file_paths(files_obj) if is_source(p)]
    if not candidates and repo:
        candidates = enumerate_root(repo)
    paths, mirrors = narrow_scan(repo, candidates, MAX_FILES)
    missing_obs, xss, todos, magic, breaking = [], [], [], [], []
    rate_literals = []
    decision_literals = []
    test_oracle_inventory = []
    test_oracle_hits = []
    prod_test_coupling = []
    log_sinks = []
    error_payloads = []
    unused = []
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
        log_sinks.extend(scan_uncontrolled_log_sinks(rel, lines))
        error_payloads.extend(scan_error_payload_candidates(rel, lines))
        unused.extend(scan_unused_accumulators(rel, lines))
        missing_obs.extend(sc["missing_obs"])
        xss.extend(sc["xss"])
        todos.extend(sc["todos"])
        magic.extend(sc["magic"])
        rate_literals.extend(sc.get("rate_literals") or [])
        decision_literals.extend(scan_decision_literals(rel, lines))
        oracle = scan_test_oracles(rel, lines)
        test_oracle_inventory.extend(oracle["inventory"])
        test_oracle_hits.extend(oracle["hits"])
        prod_test_coupling.extend(scan_prod_test_coupling(rel, lines))
        breaking.extend(sc["breaking"])
        pub_sigs += sc["pub_sigs"]
        if sc["loc"] >= 800:
            long_files.append({"path": rel, "loc": sc["loc"], "kind": "long_file"})
        mixed = mixed_responsibility(rel, lines)
        if mixed:
            long_files.append(mixed)
    result = {
        "body_ok": True,
        "repo_resolved": bool(repo and os.path.isdir(repo)),
        "files_considered": len(paths),
        "files_scanned": scanned,
        "missing_observability": missing_obs[:30],
        "uncontrolled_log_sinks": log_sinks[:30],
        "xss_html_hits": xss[:30],
        "todo_fixme": todos[:30],
        "magic_numbers": magic[:30],
        "rate_literals": rate_literals[:20],
        "decision_literals": decision_literals[:30],
        "test_oracle_inventory": test_oracle_inventory[:40],
        "test_oracle_hits": test_oracle_hits[:40],
        "prod_test_coupling": prod_test_coupling[:20],
        "unused_accumulators": unused[:20],
        "long_files": long_files[:20],
        "public_sig_lines": pub_sigs,
        "breaking_hints": breaking[:20],
        "error_payload_candidates": error_payloads[:20],
    }
    expand_mirrored_hits(result, mirrors)
    return result


def main() -> None:
    # argv: repo, files_json, out_path, kind(observability|contract|maintainability)
    repo, files_json, out_path, kind = sys.argv[1:5]
    raw = collect(repo, files_json)
    if kind == "observability":
        thin = (
            len(raw["missing_observability"]) == 0
            and len(raw.get("uncontrolled_log_sinks") or []) == 0
        )
        payload = {
            **{k: raw[k] for k in ("body_ok", "repo_resolved", "files_considered", "files_scanned")},
            "signals_thin": thin,
            "missing_observability": raw["missing_observability"],
            "uncontrolled_log_sinks": raw.get("uncontrolled_log_sinks") or [],
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
            "error_payload_candidates": raw.get("error_payload_candidates") or [],
            "thresholds": {"max_files": MAX_FILES, "max_lines": MAX_LINES},
            "notes": [
                "xss_html_hits → prefer category security/correctness when raising findings",
                "public_sig_lines is a volume hint; confirm drift via edges-in callers",
                "error_payload_candidates are semantic (decision=llm), not a hard gate, and do not affect signals_thin",
            ],
        }
    else:  # maintainability
        unused_rows = raw.get("unused_accumulators") or []
        rate_rows = raw.get("rate_literals") or []
        decision_rows = raw.get("decision_literals") or []
        magic_rows = list(raw["magic_numbers"]) + list(rate_rows) + list(decision_rows)
        oracle_hits = raw.get("test_oracle_hits") or []
        coupling = raw.get("prod_test_coupling") or []
        thin = (
            len(raw["todo_fixme"]) == 0
            and len(magic_rows) == 0
            and len(raw["long_files"]) == 0
            and len(unused_rows) == 0
            and len(oracle_hits) == 0
            and len(coupling) == 0
        )
        payload = {
            **{k: raw[k] for k in ("body_ok", "repo_resolved", "files_considered", "files_scanned")},
            "signals_thin": thin,
            "todo_fixme": raw["todo_fixme"],
            "magic_numbers": magic_rows,
            "unused_accumulators": unused_rows,
            "test_oracle_inventory": raw.get("test_oracle_inventory") or [],
            "test_oracle_hits": oracle_hits,
            "prod_test_coupling": coupling,
            "long_files": raw["long_files"],
            "thresholds": {"max_files": MAX_FILES, "max_lines": MAX_LINES, "long_file_loc": 800},
            "notes": [
                "Hard gate: non-empty magic_numbers is one maintainability finding that cites every path:line. rate_literal and decision_literal rows are included. A read name does not drop an inline literal or a disabling sentinel.",
                "Hard gate: each unused_accumulators row, each test_oracle_hits row, and each prod_test_coupling row is its own finding. test_oracle_inventory is one suspect per test method; every row needs a test_oracle_coverage hit or skip. A coverage miss fails the review.",
            ],
        }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
