#!/usr/bin/env bash
# Write 25-unit-calls.json from CodexQA call edges for every method in the
# coverage universe. Sampled impact/*/edges-in.json files are not the full graph.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"
REPO=""; DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    *) echo "error: unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$REPO" && -d "$REPO" && -n "$DIR" && -d "$DIR" ]] || {
  echo "error: --repo and --dir are required" >&2
  exit 2
}
SYMBOLS="$DIR/05-coverage-universe.json"
[[ -f "$SYMBOLS" ]] || SYMBOLS="$DIR/05-changed-symbols.json"
[[ -f "$SYMBOLS" ]] || {
  echo '{"kind":"UnitCalls","calls":[],"note":"no symbol universe"}' >"$DIR/25-unit-calls.json"
  exit 0
}
"$SCRIPT_DIR/../acr-python" - "$REPO" "$SYMBOLS" "$DIR/25-unit-calls.json" <<'PY'
import json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

repo, symbols_path, out_path = sys.argv[1:4]
# One CLI process per method. Eight at a time keeps the graph read, without
# paying a full process start for each of up to 160 methods in series.
UNIT_CALL_WORKERS = 8
doc = json.loads(Path(symbols_path).read_text(encoding="utf-8"))
nodes = doc.get("nodes") or doc.get("result", {}).get("nodes") or []
by_id = {}
ids = []
for node in nodes:
    if not isinstance(node, dict):
        continue
    kind = str(node.get("kind") or "")
    if kind not in {"method", "function", "constructor"}:
        continue
    sid = str(node.get("id") or "")
    if not sid:
        continue
    by_id[sid] = node
    ids.append(sid)
ids = ids[:160]

def outgoing_calls(sid: str) -> list[dict]:
    try:
        proc = subprocess.run(
            ["codexqa", "query", "--repo", repo, "edges", "--id", sid, "--direction", "out"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0 or not proc.stdout.strip():
        return []
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []
    found = []
    for edge in payload.get("edges") or []:
        if not isinstance(edge, dict) or edge.get("kind") != "calls":
            continue
        info = {}
        raw = edge.get("call_info")
        if isinstance(raw, str) and raw:
            try:
                info = json.loads(raw)
            except json.JSONDecodeError:
                info = {}
        src = by_id.get(edge.get("from_id") or "", {})
        dst = by_id.get(edge.get("to_id") or "", {})
        found.append({
            "from": src.get("name") or info.get("caller") or edge.get("from_id"),
            "to": dst.get("name") or info.get("callee") or edge.get("to_id"),
            "from_file": edge.get("from_file") or src.get("file_path"),
            "to_file": edge.get("to_file") or dst.get("file_path"),
            "line": info.get("line"),
            "kind": "calls",
            "_key": (edge.get("from_id"), edge.get("to_id"), edge.get("call_info")),
        })
    return found

calls = []
seen = set()
workers = min(UNIT_CALL_WORKERS, len(ids)) or 1
with ThreadPoolExecutor(max_workers=workers) as pool:
    for batch in pool.map(outgoing_calls, ids):
        for row in batch:
            key = row.pop("_key", None)
            if key in seen:
                continue
            seen.add(key)
            calls.append(row)
Path(out_path).write_text(json.dumps({
    "kind": "UnitCalls",
    "calls": calls,
    "method_count": len(ids),
    "note": (
        "Call edges for methods in this compilation unit, including nested types. "
        "An empty impact/*/edges-in.json only means that symbol was not in the "
        "sampled set or has no recorded external caller."
    ),
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"unit calls: {len(calls)} from {len(ids)} methods")
PY
