import json, os, re, sys
from collections import defaultdict
from pathlib import Path

out_dir, repo, files_json, syms_json, out_path, empty_by_id_path = sys.argv[1:7]
THRESH_LOC_ATT, THRESH_LOC_HIGH = 80, 150
THRESH_DEC, THRESH_NEST, THRESH_TYPE_METHODS = 10, 5, 15

DEC_RE = re.compile(
    r"\b(if|else\s+if|elif|for|while|switch|case|catch|except|when|match)\b|(\&\&|\|\|)|(\?[^:])",
    re.I,
)
YAGNI_RE = re.compile(
    r"\b(future|reserved|later|todo\s*:\s*later|speculative|for\s+now\s+unused|"
    r"premature|yagni|will\s+be\s+used|prepare\s+for|when\s+we\s+need)\b",
    re.I,
)


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def file_paths(obj):
    arr = (
        obj.get("nodes") or obj.get("result", {}).get("nodes")
        or obj.get("files") or obj.get("result", {}).get("files")
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
    return out[:40]


def symbol_nodes(obj):
    arr = obj.get("nodes") or obj.get("result", {}).get("nodes") or []
    return arr if isinstance(arr, list) else []


files_obj = load(files_json)
syms_obj = load(syms_json)
empty_by_id = load(empty_by_id_path)
if not isinstance(empty_by_id, dict):
    empty_by_id = {}
paths = file_paths(files_obj)
nodes = symbol_nodes(syms_obj)

file_lines = {}
if repo and os.path.isdir(repo):
    for rel in paths:
        abs_path = os.path.join(repo, rel)
        if not os.path.isfile(abs_path):
            continue
        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                lines = []
                for i, line in enumerate(f):
                    if i >= 4000:
                        break
                    lines.append(line.rstrip("\n"))
                file_lines[rel] = lines
        except Exception:
            continue

hot_methods = []
type_methods = defaultdict(list)
yagni_hints = []

for n in nodes:
    if not isinstance(n, dict):
        continue
    kind = (n.get("kind") or "").lower()
    if kind and kind not in ("method", "function", "constructor", "func"):
        continue
    name = n.get("name") or ""
    sid = n.get("id") or ""
    start = n.get("start_line")
    end = n.get("end_line")
    path = n.get("file_path") or n.get("path") or n.get("file") or ""
    if not path and paths:
        path = paths[0] if len(paths) == 1 else ""
    ns = n.get("namespace") or n.get("module") or ""
    tested = n.get("tested_count")
    from_count = n.get("from_count")
    change = n.get("change_status") or ""
    depth = n.get("depth")
    try:
        depth_n = int(depth) if depth is not None else 1
    except (TypeError, ValueError):
        depth_n = 1

    loc = None
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        loc = end - start + 1

    decisions = 0
    nest_max = 0
    yagni_hit = False
    if path and path in file_lines and isinstance(start, int) and isinstance(end, int):
        lines = file_lines[path]
        doc_lo = max(0, max(1, start) - 8 - 1)
        lo = max(1, start) - 1
        hi = min(len(lines), end)
        window = lines[lo:hi]
        doc_window = lines[doc_lo:hi]
        depth_brace = 0
        base_indent = None
        uses_braces = any(("{" in line) or ("}" in line) for line in window)
        for line in window:
            decisions += len(DEC_RE.findall(line))
            if uses_braces:
                depth_brace += line.count("{") - line.count("}")
                if depth_brace < 0:
                    depth_brace = 0
                nest_max = max(nest_max, depth_brace)
            else:
                # Indent-only languages (e.g. Python): relative to method baseline
                stripped = line.lstrip(" \t")
                if stripped:
                    indent = len(line) - len(stripped)
                    if base_indent is None:
                        base_indent = indent
                    rel = max(0, indent - base_indent)
                    nest_max = max(nest_max, rel // 4 if (base_indent % 4 == 0 or rel >= 4) else rel // 2)
        for line in doc_window:
            if YAGNI_RE.search(line):
                yagni_hit = True
                break

    reasons = []
    severity = None
    if loc is not None:
        if loc >= THRESH_LOC_HIGH:
            reasons.append("loc_high")
            severity = "high"
        elif loc >= THRESH_LOC_ATT:
            reasons.append("loc_attention")
            severity = severity or "attention"
    if decisions >= THRESH_DEC:
        reasons.append("decisions")
        severity = severity or "attention"
    if nest_max >= THRESH_NEST:
        reasons.append("nesting")
        severity = severity or "attention"

    untested = tested == 0 or tested == "0"
    if reasons and untested:
        reasons.append("untested")
        if severity in ("attention", "high"):
            severity = "elevated"

    cluster = ns or path or "unknown"
    # Top-level type surface only (depth<=1)
    if change == "add" and kind in ("method", "function", "constructor", "func", "") and depth_n <= 1:
        type_methods[cluster].append(name or sid)

    if reasons:
        hot_methods.append({
            "id": sid,
            "name": name,
            "path": path,
            "namespace": ns,
            "loc": loc,
            "decisions": decisions,
            "nest_max": nest_max,
            "tested_count": tested,
            "from_count": from_count,
            "change_status": change,
            "reasons": reasons,
            "severity": severity or "attention",
        })

    edges_empty = bool(sid) and (sid in empty_by_id)
    try:
        from_n = int(from_count) if from_count is not None else None
    except (TypeError, ValueError):
        from_n = None
    # Comment/Javadoc YAGNI language is sufficient on add symbols (even if
    # from_count is stub-inflated). Otherwise require isolation signals.
    yagni_trigger = (
        yagni_hit
        or (from_n == 0 and (depth_n >= 2 or (loc and loc >= THRESH_LOC_ATT)))
        or (edges_empty and depth_n >= 2)
    )
    if change == "add" and yagni_trigger:
        yagni_hints.append({
            "kind": "add_low_fanin",
            "id": sid,
            "name": name,
            "path": path,
            "from_count": from_count,
            "edges_in_empty": edges_empty,
            "depth": depth,
            "yagni_comment": yagni_hit,
            "note": "add symbol YAGNI/isolation signal — review unused or premature complexity",
        })

hot_types = []
for cluster, methods in type_methods.items():
    if len(methods) >= THRESH_TYPE_METHODS:
        hot_types.append({
            "cluster": cluster,
            "add_method_count": len(methods),
            "sample_methods": methods[:20],
            "reason": "type_surface",
        })

weight = {"elevated": 3, "high": 2, "attention": 1}
hot_methods.sort(key=lambda m: (-weight.get(m.get("severity"), 0), -(m.get("loc") or 0)))
hot_methods = hot_methods[:40]
yagni_hints = yagni_hints[:30]
hot_types = hot_types[:20]

payload = {
    "body_metrics_ok": True,
    "hot_methods": hot_methods,
    "hot_types": hot_types,
    "yagni_hints_body": yagni_hints,
    "files_scanned": len(file_lines),
    "symbols_considered": len(nodes),
    "repo_resolved": bool(repo and os.path.isdir(repo)),
}
Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
