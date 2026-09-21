#!/usr/bin/env python3
"""Bounded local privacy / compliance heuristics for codexqa-code-reviewer.

Zero network. Zero extra CodexQA. Reads changed-file list + on-disk sources
under --repo. Optionally reuses 06-sensitive-hits (non-auth only).
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
THRESH_PII_FIELDS = 5
LOG_NEIGHBOR = 3
ROOT_ENUM_LIMIT = 24

SOURCE_EXTS = {
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".m",
    ".mm",
    ".scala",
    ".rs",
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

# Security-owned — never emit as privacy
SECURITY_OWNED = re.compile(
    r"(?i)\b(password|passwd|secret|token|api[_-]?key|auth(entication)?|bearer|private[_-]?key)\b"
)

PII_IDENT = re.compile(
    r"(?i)\b("
    r"email|e[_-]?mail|phone|mobile|cellphone|id[_-]?card|idcard|"
    r"ssn|passport|national[_-]?id|birth(day|date)|dob|"
    r"address|home[_-]?addr|geo(lat|lng|location)|latitude|longitude|"
    r"real[_-]?name|full[_-]?name|id[_-]?number|bank[_-]?card|credit[_-]?card"
    r")\b"
)

EMAIL_LIT = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_LIT = re.compile(r"(?<!\d)(?:\+?\d{1,3}[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)")
ID_LIKE = re.compile(r"(?i)\b(?:id[_-]?card|身份证)\s*[:=]\s*\S+")

# TRACE.info / LOG.warn / logger.info / console.* / System.out — not only log(ger)?
LOG_API = re.compile(
    r"(?i)\b("
    r"log(ger)?\.(trace|debug|info|warn|error|fatal)\s*\(|"
    r"[A-Za-z_][\w]*\.(trace|debug|info|warn|error|fatal)\s*\(|"
    r"console\.(log|info|warn|error|debug)\s*\(|"
    r"System\.(out|err)\.print(ln)?\s*\(|"
    r"print(ln|f)?\s*\(|"
    r"Logger\.(getLogger|[A-Z]+)|"
    r"slog\.(Info|Debug|Warn|Error)\s*\(|"
    r"fmt\.Print(ln|f)?\s*\(?"
    r")"
)

REDACT = re.compile(r"(?i)\b(mask|redact|anonymi[sz]e|encrypt|hash|tokenize|desensitiz)\b")

PERSIST = re.compile(
    r"(?i)\b(persist|save|insert|upsert|update|write|store|put|repository\.save|create)\b"
)
RETENTION_CLUE = re.compile(
    r"(?i)\b(delete|erase|forget|purge|export|dsar|gdpr|retention|ttl|expire|"
    r"right[_-]?to[_-]?be[_-]?forgotten|data[_-]?subject)\b"
)
CONSENT = re.compile(r"(?i)\b(consent|opt[_-]?in|opt[_-]?out|purpose|privacy[_-]?policy)\b")
TRANSFER = re.compile(
    r"(?i)\b(cross[_-]?border|overseas|third[_-]?party|transfer|analytics|tracking|"
    r"segment\.|amplitude|mixpanel|ga4|google[_-]?analytics|facebook[_-]?pixel|"
    r"sensorsdata|growingio)\b"
)
MINIMIZE_CLUE = re.compile(r"(?i)\b(minimi[sz]e|purpose[_-]?limitation|data[_-]?minim)\b")


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
    parts = set(low.split("/"))
    if parts & SKIP_DIR_PARTS:
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


def security_owned(text: str) -> bool:
    return bool(SECURITY_OWNED.search(text))


def scan_file(rel: str, lines: list[str]) -> dict:
    pii_fields = []
    log_exposure = []
    persist_pii = False
    retention_hit = False
    consent_hit = False
    transfer_hit = False
    minimize_hit = False

    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if security_owned(line):
            # still allow retention/consent elsewhere; skip PII/log on this line
            if RETENTION_CLUE.search(line):
                retention_hit = True
            continue

        if MINIMIZE_CLUE.search(line):
            minimize_hit = True
        if RETENTION_CLUE.search(line):
            retention_hit = True
        if CONSENT.search(line):
            consent_hit = True
        if TRANSFER.search(line):
            transfer_hit = True

        for m in PII_IDENT.finditer(line):
            name = m.group(1)
            pii_fields.append(
                {
                    "path": rel,
                    "line": i + 1,
                    "identifier": name,
                    "snippet": line.strip()[:160],
                }
            )
            if PERSIST.search(line):
                persist_pii = True

        if LOG_API.search(line):
            window = window_code_lines(lines, i, LOG_NEIGHBOR)
            if security_owned(window):
                continue
            has_pii = bool(
                PII_IDENT.search(window)
                or EMAIL_LIT.search(window)
                or PHONE_LIT.search(window)
                or ID_LIKE.search(window)
            )
            if has_pii and not REDACT.search(window):
                log_exposure.append(
                    {
                        "path": rel,
                        "line": i + 1,
                        "snippet": line.strip()[:160],
                        "kind": "log_exposure",
                    }
                )

    # dedupe pii field identifiers per path
    seen = set()
    uniq_fields = []
    for h in pii_fields:
        key = (h["path"], h["identifier"].lower())
        if key in seen:
            continue
        seen.add(key)
        uniq_fields.append(h)

    return {
        "pii_fields": uniq_fields[:40],
        "log_exposure": log_exposure[:20],
        "persist_pii": persist_pii,
        "retention_hit": retention_hit,
        "consent_hit": consent_hit,
        "transfer_hit": transfer_hit,
        "minimize_hit": minimize_hit,
    }


def sensitive_reuse(pack_dir: str) -> list[dict]:
    path = os.path.join(pack_dir, "06-sensitive-hits.json")
    if not os.path.isfile(path):
        return []
    obj = load(path)
    out = []
    # Best-effort: walk common shapes for textual hits
    blob = json.dumps(obj, ensure_ascii=False)
    # Only surface if pack mentions non-auth PII-ish terms in search results
    search = obj.get("search") or {}
    results = (
        search.get("results")
        or search.get("result", {}).get("results")
        or search.get("hits")
        or []
    )
    if not isinstance(results, list):
        results = []
    for r in results[:30]:
        if isinstance(r, dict):
            text = json.dumps(r, ensure_ascii=False)
        else:
            text = str(r)
        if security_owned(text):
            continue
        if PII_IDENT.search(text) or EMAIL_LIT.search(text):
            out.append(
                {
                    "note": "non-auth sensitive-pack hit — manually distinguish privacy vs security",
                    "snippet": text[:200],
                }
            )
        if len(out) >= 10:
            break
    if not out and ("email" in blob.lower() or "phone" in blob.lower()):
        # weak signal only
        if not security_owned(blob[:2000]):
            out.append(
                {
                    "note": "06-sensitive-hits mentions email/phone-like terms — review for privacy",
                    "snippet": "",
                }
            )
    return out


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


def main() -> None:
    # argv: dir, repo, files_json, lang_json, out_path
    pack_dir, repo, files_json, _lang_json, out_path = sys.argv[1:6]
    files_obj = load(files_json)
    all_paths = [p for p in file_paths(files_obj) if is_source(p)][:MAX_FILES]

    if not all_paths and repo and os.path.isdir(repo):
        all_paths = enumerate_root(repo)[:MAX_FILES]

    pii_field_hits = []
    log_exposure = []
    any_persist = False
    any_retention = False
    any_consent = False
    any_transfer = False
    any_minimize = False
    files_scanned = 0

    for rel in all_paths:
        abs_p = os.path.join(repo, rel) if repo else ""
        if not abs_p or not os.path.isfile(abs_p):
            continue
        lines = read_lines(abs_p)
        if not lines:
            continue
        files_scanned += 1
        sc = scan_file(rel, lines)
        pii_field_hits.extend(sc["pii_fields"])
        log_exposure.extend(sc["log_exposure"])
        any_persist = any_persist or sc["persist_pii"]
        any_retention = any_retention or sc["retention_hit"]
        any_consent = any_consent or sc["consent_hit"]
        any_transfer = any_transfer or sc["transfer_hit"]
        any_minimize = any_minimize or sc["minimize_hit"]

    # dedupe logs
    seen_log = set()
    uniq_log = []
    for h in log_exposure:
        key = (h["path"], h["line"])
        if key in seen_log:
            continue
        seen_log.add(key)
        uniq_log.append(h)
    log_exposure = uniq_log[:30]

    # minimization flag
    unique_idents = {(h["path"], h["identifier"].lower()) for h in pii_field_hits}
    minimization_flags = []
    if len(unique_idents) >= THRESH_PII_FIELDS and not any_minimize:
        minimization_flags.append(
            {
                "kind": "pii_field_bloat",
                "pii_identifier_count": len(unique_idents),
                "threshold": THRESH_PII_FIELDS,
                "note": "many PII identifiers without minimize/purpose clues",
            }
        )

    retention_gaps = []
    if any_persist and not any_retention:
        retention_gaps.append(
            {
                "kind": "retention_or_dsar_gap",
                "note": "PII persist/save signals without delete/erase/export/retention clues in scanned files",
            }
        )

    consent_or_transfer_hints = []
    if any_transfer and not any_consent:
        consent_or_transfer_hints.append(
            {
                "kind": "transfer_without_consent_clue",
                "note": "cross-border/third-party/analytics clue without consent/opt-in/purpose",
            }
        )

    reuse = sensitive_reuse(pack_dir)

    signals_thin = (
        len(pii_field_hits) == 0
        and len(log_exposure) == 0
        and len(minimization_flags) == 0
        and len(retention_gaps) == 0
        and len(consent_or_transfer_hints) == 0
    )

    payload = {
        "body_ok": True,
        "repo_resolved": bool(repo and os.path.isdir(repo)),
        "signals_thin": signals_thin,
        "pii_field_hits": pii_field_hits[:40],
        "log_exposure": log_exposure,
        "minimization_flags": minimization_flags,
        "retention_gaps": retention_gaps,
        "consent_or_transfer_hints": consent_or_transfer_hints,
        "sensitive_reuse": reuse,
        "thresholds": {
            "pii_fields": THRESH_PII_FIELDS,
            "max_files": MAX_FILES,
            "max_lines": MAX_LINES,
            "log_neighbor": LOG_NEIGHBOR,
        },
        "files_considered": len(all_paths),
        "files_scanned": files_scanned,
    }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
