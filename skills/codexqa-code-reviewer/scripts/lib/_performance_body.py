#!/usr/bin/env python3
"""Bounded local performance heuristics: hot path / N+1 / unbounded allocation.

Zero network. Zero extra CodexQA. Comments do not count as remediation.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import iter_code_lines, window_code_lines, is_heuristic_meta_line  # noqa: E402

MAX_FILES = 40
MAX_LINES = 4000
NEIGHBOR = 6
ROOT_ENUM_LIMIT = 24

SOURCE_EXTS = {
    ".java", ".kt", ".kts", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".cs", ".rb", ".php", ".swift", ".scala", ".rs",
}

SKIP_DIR_PARTS = {
    "node_modules", "vendor", ".git", "dist", "build", ".codexqa-review",
    "target", "__pycache__", "testdata", "fixtures",
}

LOOP_START = re.compile(
    r"(?i)\b(for\s*\(|for\s+\w+\s+in\b|while\s*\(|\.forEach\s*\(|"
    r"\.map\s*\(|\.each\s*\(|\.stream\s*\(\s*\)\s*\.forEach|"
    r"for\s+range\b|forEach\s*\()"
)
LOOP_CONT = re.compile(r"[{:]|\bdo\b")

IO_CALL = re.compile(
    r"(?i)("
    r"\bfindBy\w*|\bfindOne\w*|\bfindAll\w*|\bgetById\w*|\bgetOne\w*|"
    r"\bload\s*\(|\bQuery\s*\(|\bquery\s*\(|\bexecute\s*\(|\bexecuteQuery|"
    r"\bgetConnection|\bcreateQuery|EntityManager|"
    r"repository\.|Repository\.|prisma\.|session\.|mongo(Client)?\.|"
    r"\bfetch\s*\(|axios\.|httpClient|HttpClient|RestTemplate|"
    r"WebClient|okhttp|requests\.(get|post)|http\.(Get|Post)|"
    r"\bdb\.(Query|Exec|Get)|gorm\.|sqlx\.|jdbcTemplate"
    r")"
)
BATCH_CLUE = re.compile(
    r"(?i)\b(Batch|bulk|findAllById|findByIds|IN\s*\(|\.include\s*\(|"
    r"eager|prefetch|select_related|join\s*\(|JoinFetch|"
    r"whereIn|getMany|loadAll)\b"
)

HOT_PATH = re.compile(
    r"(?i)(controller|handler|servlet|resource|endpoint|/api/|"
    r"@GetMapping|@PostMapping|@RequestMapping|router\.|app\.(get|post)|"
    r"HttpServlet|@RestController)"
)
ENTRY_TAG = re.compile(
    r"(?i)(http|rpc|grpc|mq|queue|kafka|consumer|controller|"
    r"handler|endpoint|servlet|route|job|cron|task|entry)"
)

SYNC_BLOCK = re.compile(
    r"(?i)\b(Thread\.sleep|time\.Sleep|FileInputStream|readFileSync|"
    r"Files\.readAllBytes|os\.ReadFile|BufferedReader|"
    r"ObjectInputStream|crypto\.pbkdf2Sync)\b"
)

STR_CONCAT_LOOP = re.compile(
    # Plan: loop string concat — `s += x`, `s += "…"`, `.concat(`, `s = s + …`
    r"""(?i)("""
    r"""\+=\s*(?![\d.])"""  # += non-numeric (covers s += p / s += "x")
    r"""|\+\s*["'][^"']*["']"""
    r"""|\.concat\s*\("""
    r"""|\b\w+\s*=\s*\w+\s*\+\s*(?![\d.])"""
    r""")"""
)
SB_APPEND = re.compile(r"(?i)(StringBuilder|StringBuffer|strings\.Builder)")
SB_CAP = re.compile(r"(?i)(new\s+StringBuilder\s*\(\s*\d+|Grow\s*\(|EnsureCapacity)")
LIST_GROW = re.compile(
    r"(?i)(\.add\s*\(|\.append\s*\(|\.push\s*\(|<<\s*\w)"
)
LIST_CAP = re.compile(
    r"(?i)(new\s+ArrayList\s*\(\s*\d+|make\s*\(\s*\[\]|withCapacity|"
    r"Vec::with_capacity|initialCapacity)"
)
UNPAGED_LIST = re.compile(
    r"(?i)\b(findMany|findAll|SELECT\s+\*|select\s+\*|listAll|"
    r"getAll|loadAllUsers|fetchAll)\b"
)
PAGE_CLUE = re.compile(
    r"(?i)\b(LIMIT|OFFSET|take\s*\(|skip\s*\(|pageSize|PageRequest|"
    r"pageable|pagination|cursor|per_page|Page\<)\b"
)
CACHE_PUT = re.compile(
    r"(?i)\b(cache\.(put|set)|\.put\s*\(|redis\.(set|hset)|"
    r"localCache\[|memo\[|map\[)\b"
)
CACHE_BOUND = re.compile(
    r"(?i)\b(TTL|expire|evict|maxSize|maximumSize|Caffeine|"
    r"Guava.*Cache|lru|expiring)\b"
)


def load_json(path: str):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def file_paths(obj) -> list[str]:
    if not obj:
        return []
    arr = (
        obj.get("nodes")
        or obj.get("result", {}).get("nodes")
        or obj.get("files")
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
    return out[:200]


def is_source(rel: str) -> bool:
    low = rel.replace("\\", "/").lower()
    parts = set(low.split("/"))
    if parts & SKIP_DIR_PARTS:
        return False
    if any(p in ("test", "tests", "__tests__") for p in parts):
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


def hit(rel: str, line: int, kind: str, snippet: str, note: str = "") -> dict:
    d = {
        "path": rel,
        "line": line,
        "kind": kind,
        "snippet": snippet.strip()[:160],
    }
    if note:
        d["note"] = note
    return d


def entry_paths_from_tags(tags_obj) -> set[str]:
    paths: set[str] = set()
    if not tags_obj or not isinstance(tags_obj, dict):
        return paths
    for t in tags_obj.get("tagged") or []:
        if not isinstance(t, dict):
            continue
        key = str(t.get("key") or t.get("tag") or "")
        path = str(t.get("path") or t.get("file") or "")
        blob = f"{key} {path}"
        if ENTRY_TAG.search(blob) and path:
            paths.add(path.replace("\\", "/"))
    return paths


def is_hot_path(rel: str, entry_paths: set[str]) -> bool:
    low = rel.replace("\\", "/")
    if HOT_PATH.search(low):
        return True
    for ep in entry_paths:
        if ep in low or low.endswith(ep) or low in ep:
            return True
    return False


def scan_file(rel: str, lines: list[str], entry_hot: bool) -> dict:
    n1, hot, unbound = [], [], []
    in_loop = False
    loop_depth = 0
    loop_start_line = 0
    loop_has_io = False
    loop_has_batch = False
    loop_str_concat = False
    loop_list_grow = False
    loop_sb = False
    file_has_page = False
    file_has_cache_bound = False
    file_unpaged = []
    file_cache = []

    code_idx = {i: s for i, _, s in iter_code_lines(lines)}

    def close_loop() -> None:
        nonlocal in_loop, loop_depth, loop_has_io, loop_has_batch
        nonlocal loop_str_concat, loop_list_grow, loop_sb
        if not in_loop:
            return
        if loop_has_io and not loop_has_batch:
            snip = lines[loop_start_line - 1] if 0 < loop_start_line <= len(lines) else ""
            n1.append(
                hit(
                    rel,
                    loop_start_line,
                    "n_plus_one",
                    snip,
                    "IO/DB/HTTP call inside loop without batch clue",
                )
            )
        if loop_str_concat:
            unbound.append(
                hit(
                    rel,
                    loop_start_line,
                    "string_concat_in_loop",
                    "string += / concat in loop",
                    "prefer builder with capacity or join",
                )
            )
        region = "\n".join(lines[max(0, loop_start_line - 3) : loop_start_line + 40])
        if loop_list_grow and not LIST_CAP.search(region):
            unbound.append(
                hit(
                    rel,
                    loop_start_line,
                    "collection_grow_in_loop",
                    "collection grow in loop without capacity clue",
                )
            )
        if loop_sb and not SB_CAP.search(region):
            unbound.append(
                hit(
                    rel,
                    loop_start_line,
                    "stringbuilder_no_capacity",
                    "StringBuilder/Builder in loop without capacity clue",
                )
            )
        in_loop = False
        loop_depth = 0

    for i, raw in enumerate(lines):
        if i not in code_idx:
            continue
        s = code_idx[i]
        if is_heuristic_meta_line(s) or is_heuristic_meta_line(raw):
            continue
        win = window_code_lines(lines, i, NEIGHBOR)

        if PAGE_CLUE.search(s):
            file_has_page = True
        if CACHE_BOUND.search(s):
            file_has_cache_bound = True

        starting = bool(LOOP_START.search(s))
        if starting:
            if in_loop:
                close_loop()
            in_loop = True
            loop_depth = s.count("{") - s.count("}")
            if loop_depth <= 0:
                loop_depth = 1
            loop_start_line = i + 1
            loop_has_io = False
            loop_has_batch = False
            loop_str_concat = False
            loop_list_grow = False
            loop_sb = False

        if in_loop:
            if not starting:
                loop_depth += s.count("{") - s.count("}")
            if IO_CALL.search(s):
                loop_has_io = True
            if BATCH_CLUE.search(win) or BATCH_CLUE.search(s):
                loop_has_batch = True
            if STR_CONCAT_LOOP.search(s):
                loop_str_concat = True
            if LIST_GROW.search(s):
                loop_list_grow = True
            if SB_APPEND.search(s):
                loop_sb = True
            if not starting and loop_depth <= 0:
                close_loop()

        if SYNC_BLOCK.search(s) and entry_hot:
            hot.append(
                hit(rel, i + 1, "sync_block_on_hot_path", s, "sync/blocking IO on entry-ish path")
            )

        if UNPAGED_LIST.search(s) and not PAGE_CLUE.search(win):
            file_unpaged.append(hit(rel, i + 1, "unpaginated_list", s))
        if CACHE_PUT.search(s):
            file_cache.append(hit(rel, i + 1, "cache_put", s))

    if in_loop:
        close_loop()

    if file_unpaged and not file_has_page:
        unbound.extend(file_unpaged[:5])
    if file_cache and not file_has_cache_bound:
        for h in file_cache[:5]:
            hh = dict(h)
            hh["kind"] = "cache_unbounded"
            hh["note"] = "cache growth without TTL/evict/maxSize clue in file"
            unbound.append(hh)

    if entry_hot:
        for h in n1:
            hot.append(
                hit(
                    rel,
                    h["line"],
                    "hot_path_n_plus_one",
                    h.get("snippet", ""),
                    "N+1 on entry/handler path",
                )
            )
        for h in unbound:
            if h.get("kind") == "unpaginated_list":
                hot.append(
                    hit(
                        rel,
                        h["line"],
                        "hot_path_unpaginated",
                        h.get("snippet", ""),
                        "unpaginated list on entry path",
                    )
                )

    return {
        "n_plus_one_risks": n1[:15],
        "hot_path_risks": hot[:15],
        "unbounded_allocation": unbound[:15],
    }


def enum_repo_sample(repo: str) -> list[str]:
    if not repo or not os.path.isdir(repo):
        return []
    out = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_PARTS and not d.startswith(".")]
        for fn in files:
            rel = os.path.relpath(os.path.join(root, fn), repo).replace("\\", "/")
            if is_source(rel):
                out.append(rel)
            if len(out) >= ROOT_ENUM_LIMIT:
                return out
    return out


def main() -> None:
    if len(sys.argv) < 5:
        print(
            "usage: _performance_body.py <pack_dir> <repo> <files_json> <out_json>",
            file=sys.stderr,
        )
        sys.exit(2)
    pack_dir, repo, files_path, out_path = sys.argv[1:5]
    files_obj = load_json(files_path) or {}
    tags_obj = load_json(os.path.join(pack_dir, "07-tags.json"))
    paths = [p for p in file_paths(files_obj) if is_source(p)]
    if not paths and repo:
        paths = enum_repo_sample(repo)

    entry_paths = entry_paths_from_tags(tags_obj)
    repo_ok = bool(repo and os.path.isdir(repo))

    n1_all, hot_all, unb_all = [], [], []
    scanned = 0
    for rel in paths[:MAX_FILES]:
        abs_p = os.path.join(repo, rel) if repo_ok else ""
        if not abs_p or not os.path.isfile(abs_p):
            continue
        lines = read_lines(abs_p)
        if not lines:
            continue
        scanned += 1
        entry_hot = is_hot_path(rel, entry_paths)
        sc = scan_file(rel, lines, entry_hot)
        n1_all.extend(sc["n_plus_one_risks"])
        hot_all.extend(sc["hot_path_risks"])
        unb_all.extend(sc["unbounded_allocation"])

    # dedupe by path:line:kind
    def dedupe(items: list[dict]) -> list[dict]:
        seen = set()
        out = []
        for it in items:
            k = (it.get("path"), it.get("line"), it.get("kind"))
            if k in seen:
                continue
            seen.add(k)
            out.append(it)
        return out[:40]

    n1_all = dedupe(n1_all)
    hot_all = dedupe(hot_all)
    unb_all = dedupe(unb_all)

    residual = []
    thin = len(n1_all) == 0 and len(hot_all) == 0 and len(unb_all) == 0
    if not repo_ok:
        residual.append(
            {"kind": "no_repo", "note": "repo not resolved — pass --repo for body scan"}
        )
        thin = True
    elif scanned == 0 and paths:
        residual.append(
            {"kind": "no_bodies", "note": "changed paths listed but no readable source bodies"}
        )

    payload = {
        "body_ok": True,
        "repo_resolved": repo_ok,
        "signals_thin": thin,
        "n_plus_one_risks": n1_all,
        "hot_path_risks": hot_all,
        "unbounded_allocation": unb_all,
        "residual_performance": residual,
        "thresholds": {
            "max_files": MAX_FILES,
            "max_lines": MAX_LINES,
            "neighbor": NEIGHBOR,
        },
        "files_considered": len(paths),
        "files_scanned": scanned,
    }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
