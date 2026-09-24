#!/usr/bin/env python3
"""Bounded local error-handling / resilience heuristics for codexqa-code-reviewer.

Zero network. Zero extra CodexQA. Reads changed-file list + on-disk sources
under --repo. Single-pass line scan with O(n) regex checks and fixed caps.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import advance_block_state, iter_code_lines, window_code_lines, is_heuristic_meta_line  # noqa: E402
from _identical_copies import expand_mirrored_hits, narrow_scan  # noqa: E402
from _det_rules import (  # noqa: E402
    scan_admin_grant_without_audit,
    scan_charset_gaps,
    scan_close_on_success,
    scan_disabled_bounds,
    scan_exception_unwraps,
    scan_executor_leaks,
    scan_null_deref_gaps,
    scan_process_defaults,
    scan_retry_side_effects,
    scan_shared_mutables,
    scan_unguarded_parses,
)

MAX_FILES = 40
MAX_LINES = 4000
NEIGHBOR = 4
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

SECURITY_OWNED = re.compile(
    r"(?i)\b(password|passwd|secret|token|api[_-]?key|auth(entication)?|bearer|private[_-]?key|inject)\b"
)

# Catch / swallow
CATCH_OPEN = re.compile(
    r"(?i)^\s*(catch\s*\(|except\s*:|except\s+(\w|\()|}\s*catch\s*\(|rescue\s+|on\s+Error)"
)
EMPTY_CATCH_BODY = re.compile(
    r"(?i)(catch\s*\([^)]*\)\s*\{\s*\}|except\s*(\w+)?:\s*(pass|continue|\.\.\.)\s*$|"
    r"catch\s*\([^)]*\)\s*\{\s*(//[^\n]*)?\s*\})"
)
SWALLOW_HINT = re.compile(
    r"(?i)\b(ignore(d)?|swallow(ed)?|doNothing|noop)\b|"
    r"catch\s*\([^)]*\)\s*\{\s*(return;?|continue;?|pass)\s*\}"
)
HANDLE_CLUE = re.compile(
    r"(?i)\b(log|logger|print|throw|rethrow|raise|return\s+err|wrap|"
    r"metrics?|counter|span|trace|Sentry|report|panic|fatal)\b"
)

# Go ignored error
GO_IGN_ERR = re.compile(r"(?i)\b(_\s*,\s*err|err\s*:?=)\b")
GO_CHECK_ERR = re.compile(r"(?i)\bif\s+err\s*!=\s*nil\b")

# Remote / IO without timeout.
# Avoid a trailing \b on the whole group — alternatives like fetch( end on '(' (non-word).
REMOTE_CALL = re.compile(
    r"(?i)(?:"
    r"\bhttp\.(Get|Post|Head|Do|Client)\b|\bRestTemplate\b|\bWebClient\b|\bOkHttp\b|"
    r"\bfetch\s*\(|\baxios\.|\brequest\.(get|post)\b|\burllib\b|"
    r"\brequests\.(get|post|put|delete)\b|\bgrpc\.|\bDialContext\b|\bsql\.Open\b|"
    r"\bredis\.(Dial|NewClient|Connect)\b|\bMongoClient\b|\bcreateConnection\b|"
    r"\bSocket\s*\(|\bTcpClient\b|\bHttpURLConnection\b|\bfeign\.|\bRetrofit\b|\bHttpClient\b|"
    r"\bDriverManager\b|\bDataSource\b|\bJdbcTemplate\b|"
    r"\bPreparedStatement\b|\bCallableStatement\b|"
    r"\bcreateStatement\s*\(|\bprepareStatement\s*\(|\bgetConnection\s*\(|"
    r"\b\.execute(Query|Update)?\s*\("
    r")"
)
TIMEOUT_CLUE = re.compile(
    r"(?i)\b(timeout|deadline|WithTimeout|WithDeadline|setTimeout|readTimeout|"
    r"connectTimeout|RequestTimeout|setQueryTimeout|queryTimeout|loginTimeout|"
    r"context\.WithCancel|AbortSignal|signal:)\b"
)

# Retry — keyword starts a retry risk check; bound clues stay in RETRY_BOUND only
RETRY_HINT = re.compile(
    r"(?i)\b(retry|retries|retriable|RetryTemplate|@Retryable|RetryPolicy|"
    r"attempts?\s*[:=]|max_?retr(?:y|ies))\b"
)
RETRY_BOUND = re.compile(
    r"(?i)\b(max(Retries|Attempts|Tries)|max_?retr(?:y|ies)|attempts?\s*[:=]\s*\d+)\b"
)
BACKOFF_CLUE = re.compile(
    r"(?i)\b(backoff|jitter|exponential.?backoff|sleep\s*\(|Thread\.sleep|"
    r"time\.Sleep|await\s+delay|setTimeout)\b"
)
BATCH_LOOP = re.compile(
    r"(?i)\b(for\s*\(|for\s+\w+\s+in\s+|foreach\s*\(|\.forEach\s*\()\b"
)
BATCH_WRITE = re.compile(
    r"(?i)\b(persist|save|insert|update|executeUpdate|execute\s*\(|delete|put|send)\s*\("
)

# Degradation / circuit — do NOT treat bare "fallback" params (e.g. asInt(..., fallback))
# as breakers; require resilience-oriented tokens or Fallback* APIs.
DEGRADE_HINT = re.compile(
    r"(?i)\b("
    r"degrade|degradation|defaultResponse|circuit.?breaker|"
    r"CircuitBreaker|hystrix|resilience4j|bulkhead|fail.?open|fail.?closed|"
    r"sentinel|RateLimiter|FallbackFactory|fallbackMethod|withFallback|"
    r"FallbackHandler|CircuitBreaking"
    r")\b"
    r"|@Fallback\b"
)

# Partial failure — fan-out without settle/per-item handling.
# Note: errgroup is a handling pattern (not a gap signal); omit from PARTIAL_FANOUT.
PARTIAL_FANOUT = re.compile(
    r"(?i)\b(Promise\.all\s*\(|CompletableFuture\.allOf|WaitGroup|"
    r"asyncio\.gather|Promise\.race)\b"
)
PARTIAL_HANDLE = re.compile(
    r"(?i)\b(allSettled|settle|partial|per[-_]?item|AggregateError|"
    r"Promise\.allSettled|eachLimit|p-map|errgroup)\b"
)

# Idempotency / compensation
IDEMPOT_NEED = re.compile(
    r"(?i)\b(retry|consumer|@KafkaListener|@RabbitListener|onMessage|"
    r"payment|pay|charge|refund|wallet|inventory|deduct|MQ|amqp|pubsub)\b"
)
IDEMPOT_CLUE = re.compile(
    r"(?i)\b(idempot|dedup|dedupe|exactly.?once|at.?most.?once|"
    r"compensate|compensation|saga|outbox|inbox|request[_-]?id|"
    r"Idempotency[_-]?Key|unique[_-]?key)\b"
)

PAY_SURFACE = re.compile(
    r"(?i)\b(pay|payment|charge|refund|wallet|order|inventory|billing)\b"
)
MQ_SURFACE = re.compile(
    r"(?i)\b(kafka|rabbit|rocketmq|sqs|pubsub|consumer|mq|amqp)\b"
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


def window(lines: list[str], i: int, n: int = NEIGHBOR) -> str:
    return "\n".join(lines[max(0, i - n) : min(len(lines), i + n + 1)])


def window_code(lines: list[str], i: int, n: int = NEIGHBOR) -> str:
    """Neighborhood with line/block/Javadoc comments removed (avoid comment waivers)."""
    return window_code_lines(lines, i, n)


def hit(rel: str, line: int, kind: str, snippet: str) -> dict:
    return {
        "path": rel,
        "line": line,
        "kind": kind,
        "snippet": snippet.strip()[:160],
    }


IMPORT_LINE = re.compile(
    r"(?i)^\s*(import\s+|using\s+|require\s*\(|from\s+\S+\s+import\b|#include\b)"
)
SPIN_LOOP = re.compile(r"(?i)^\s*(for\s*\(\s*;\s*;\s*\)|while\s*\(\s*true\s*\)|loop\s*\{)")


def is_go_path(rel: str) -> bool:
    return rel.replace("\\", "/").lower().endswith(".go")


def scan_file(rel: str, lines: list[str]) -> dict:
    silent = []
    timeout_gaps = []
    retry_risks = []
    degrade = []
    partial = []
    residual_sites = []  # per-remote sites lacking local degrade clues
    idempot_need = False
    idempot_clue = False
    pay = False
    mq = False
    any_remote = False
    any_retry = False
    batch_write = False
    go_file = is_go_path(rel)

    n = len(lines)
    for i, line, stripped in iter_code_lines(lines):
        _ = stripped
        if is_heuristic_meta_line(line):
            continue

        is_import = bool(IMPORT_LINE.search(line))

        if SECURITY_OWNED.search(line) and not (
            RETRY_HINT.search(line) or REMOTE_CALL.search(line)
        ):
            continue

        low_blob = line
        if PAY_SURFACE.search(low_blob):
            pay = True
        if MQ_SURFACE.search(low_blob):
            mq = True
        if IDEMPOT_NEED.search(low_blob):
            idempot_need = True
        if IDEMPOT_CLUE.search(low_blob):
            idempot_clue = True

        # Silent swallow — empty catch / bare except
        if EMPTY_CATCH_BODY.search(line) or SWALLOW_HINT.search(line):
            silent.append(hit(rel, i + 1, "silent_swallow", line))
        elif CATCH_OPEN.search(line):
            body = []
            in_blk = False
            for j in range(i + 1, min(n, i + 6)):
                t = lines[j].strip()
                skip, in_blk = advance_block_state(t, in_blk)
                if skip or not t:
                    continue
                if t in {"}", "end", "pass", "continue", "...", "return;", "return"}:
                    body.append(t)
                    if t in {"pass", "continue", "...", "return;", "return", "}"}:
                        if not HANDLE_CLUE.search("\n".join(lines[i : j + 1])):
                            silent.append(hit(rel, i + 1, "silent_swallow", line))
                    break
                body.append(t)
                if HANDLE_CLUE.search(t) or t.startswith("throw") or t.startswith("raise"):
                    break
                if len(body) >= 2 and not HANDLE_CLUE.search("\n".join(body)):
                    break

        # Go ignored err — .go files only (avoid Java string/regex false positives)
        if go_file and GO_IGN_ERR.search(line) and "_," in line.replace(" ", ""):
            w = window_code(lines, i)
            if not GO_CHECK_ERR.search(w) and "err !=" not in w:
                silent.append(hit(rel, i + 1, "ignored_error", line))

        # Remote without timeout — skip import/using lines (type imports flood the cap)
        if not is_import and REMOTE_CALL.search(line):
            any_remote = True
            w = window_code(lines, i)
            if not TIMEOUT_CLUE.search(w):
                row = hit(rel, i + 1, "missing_timeout", line)
                row["close"] = "per_line"
                timeout_gaps.append(row)
            # Per-call residual: neighborhood lacks degrade/breaker (not whole-file)
            if not DEGRADE_HINT.search(w):
                residual_sites.append(hit(rel, i + 1, "remote_without_local_degrade", line))

        # Retry without bound — skip import …Retryable
        if (
            not is_import
            and RETRY_HINT.search(line)
            and not re.search(r"(?i)\b(static|final|const)\b[^=\n]*=", line)
        ):
            any_retry = True
            idempot_need = True
            w = window_code(lines, i, n=6)
            if not RETRY_BOUND.search(w):
                retry_risks.append(hit(rel, i + 1, "unbounded_retry", line))
            elif not BACKOFF_CLUE.search(w):
                # A max attempt count does not close a retry that has no backoff.
                retry_risks.append(hit(rel, i + 1, "retry_without_backoff", line))

        if not is_import and BATCH_LOOP.search(line):
            ahead = "\n".join(lines[i : min(n, i + 12)])
            if BATCH_WRITE.search(ahead):
                batch_write = True

        # Spin loops (for(;;)/while(true)) without bound clues in neighborhood
        if not is_import and SPIN_LOOP.search(line):
            w = window_code(lines, i, n=8)
            if not RETRY_BOUND.search(w):
                any_retry = True
                idempot_need = True
                retry_risks.append(hit(rel, i + 1, "spin_loop_unbounded", line))

        # Degradation / breaker (positive) — skip bare import of library names only if
        # the line is solely an import (annotation usages still count)
        if DEGRADE_HINT.search(line):
            if not (is_import and not re.search(r"(?i)@|fallbackMethod|CircuitBreaker\s*\(", line)):
                degrade.append(hit(rel, i + 1, "degrade_or_breaker", line))

        # Partial failure
        if not is_import and PARTIAL_FANOUT.search(line):
            w = window_code(lines, i, n=6)
            if not PARTIAL_HANDLE.search(w):
                partial.append(hit(rel, i + 1, "partial_failure_gap", line))

    return {
        "silent": silent[:20],
        "timeout_gaps": timeout_gaps[:20],
        "retry_risks": retry_risks[:20],
        "degrade": degrade[:20],
        "partial": partial[:20],
        "residual_sites": residual_sites[:20],
        "idempot_need": idempot_need,
        "idempot_clue": idempot_clue,
        "pay": pay,
        "mq": mq,
        "any_remote": any_remote,
        "any_retry": any_retry,
        "batch_write": batch_write,
    }


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


def dedupe(hits: list[dict], lim: int = 30) -> list[dict]:
    seen = set()
    out = []
    for h in hits:
        key = (h.get("path"), h.get("line"), h.get("kind"))
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
        if len(out) >= lim:
            break
    return out


def main() -> None:
    pack_dir, repo, files_json, _lang_json, out_path = sys.argv[1:6]
    _ = pack_dir
    files_obj = load(files_json)
    candidates = [p for p in file_paths(files_obj) if is_source(p)]
    if not candidates and repo and os.path.isdir(repo):
        candidates = enumerate_root(repo)
    all_paths, mirrors = narrow_scan(repo, candidates, MAX_FILES)

    silent = []
    timeout_gaps = []
    retry_risks = []
    degrade = []
    partial = []
    residual_sites = []
    exception_unwraps = []
    resource_leaks = []
    charset_gaps = []
    null_deref_gaps = []
    authz_audit_gaps = []
    disabled_bounds = []
    retry_side_effects = []
    shared_mutables = []
    process_defaults = []
    idempot_need = False
    idempot_clue = False
    pay = False
    mq = False
    any_remote = False
    any_retry = False
    hot_paths = set()
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
        silent.extend(sc["silent"])
        timeout_gaps.extend(sc["timeout_gaps"])
        retry_risks.extend(sc["retry_risks"])
        degrade.extend(sc["degrade"])
        partial.extend(sc["partial"])
        residual_sites.extend(sc.get("residual_sites") or [])
        idempot_need = idempot_need or sc["idempot_need"]
        idempot_clue = idempot_clue or sc["idempot_clue"]
        pay = pay or sc["pay"]
        mq = mq or sc["mq"]
        any_remote = any_remote or sc["any_remote"]
        any_retry = any_retry or sc["any_retry"]
        if sc.get("pay") or sc.get("any_retry") or sc.get("batch_write"):
            hot_paths.add(rel)
        exception_unwraps.extend(scan_exception_unwraps(rel, lines))
        resource_leaks.extend(scan_executor_leaks(rel, lines))
        resource_leaks.extend(scan_close_on_success(rel, lines))
        charset_gaps.extend(scan_charset_gaps(rel, lines))
        null_deref_gaps.extend(scan_null_deref_gaps(rel, lines))
        null_deref_gaps.extend(scan_unguarded_parses(rel, lines))
        authz_audit_gaps.extend(scan_admin_grant_without_audit(rel, lines))
        disabled_bounds.extend(scan_disabled_bounds(rel, lines))
        retry_side_effects.extend(scan_retry_side_effects(rel, lines))
        shared_mutables.extend(scan_shared_mutables(rel, lines))
        process_defaults.extend(scan_process_defaults(rel, lines))

    silent = dedupe(silent)
    timeout_gaps = dedupe(timeout_gaps)
    retry_risks = dedupe(retry_risks)
    degrade = dedupe(degrade)
    partial = dedupe(partial)
    residual_sites = dedupe(residual_sites)
    exception_unwraps = dedupe(exception_unwraps)
    resource_leaks = dedupe(resource_leaks)
    charset_gaps = dedupe(charset_gaps)
    null_deref_gaps = dedupe(null_deref_gaps)
    authz_audit_gaps = dedupe(authz_audit_gaps)
    disabled_bounds = dedupe(disabled_bounds)
    retry_side_effects = dedupe(retry_side_effects)
    shared_mutables = dedupe(shared_mutables)
    process_defaults = dedupe(process_defaults)

    idempotency_gaps = []
    if (idempot_need or any_retry or mq) and not idempot_clue:
        idempotency_gaps.append(
            {
                "kind": "idempotency_or_compensation_gap",
                "pay_surface": pay,
                "mq_surface": mq,
                "note": "retry/MQ/payment clues without idempotent/dedup/compensate/saga in scanned files",
            }
        )

    # A remote call with no breaker stays residual only when the file has no
    # retry, batch write, or money movement. Those hot paths are findings:
    # the HTML report does not render residuals.
    residual_hardening = []
    protection_gaps = []
    for site in residual_sites[:15]:
        row = {
            "path": site.get("path"),
            "line": site.get("line"),
            "snippet": site.get("snippet"),
        }
        if site.get("path") in hot_paths:
            row["kind"] = "missing_protection"
            row["visible_absence"] = True
            row["note"] = (
                "remote/IO call on a retry, batch, or money path has no "
                "degrade or circuit-breaker clue"
            )
            protection_gaps.append(row)
        else:
            row["kind"] = "no_degrade_or_breaker_clue"
            row["note"] = (
                "this remote/IO call neighborhood lacks degrade/breaker clues "
                "— residual only when the file has no retry, batch, or money write"
            )
            residual_hardening.append(row)

    signals_thin = (
        len(silent) == 0
        and len(timeout_gaps) == 0
        and len(retry_risks) == 0
        and len(partial) == 0
        and len(idempotency_gaps) == 0
        and len(exception_unwraps) == 0
        and len(resource_leaks) == 0
        and len(charset_gaps) == 0
        and len(null_deref_gaps) == 0
        and len(authz_audit_gaps) == 0
        and len(disabled_bounds) == 0
        and len(retry_side_effects) == 0
        and len(shared_mutables) == 0
        and len(process_defaults) == 0
        and len(protection_gaps) == 0
    )

    payload = {
        "body_ok": True,
        "repo_resolved": bool(repo and os.path.isdir(repo)),
        "signals_thin": signals_thin,
        "silent_swallows": silent,
        "timeout_gaps": timeout_gaps,
        "retry_risks": retry_risks,
        "degradation_or_breaker": degrade,
        "partial_failure_gaps": partial,
        "idempotency_gaps": idempotency_gaps,
        "exception_unwraps": exception_unwraps,
        "resource_leaks": resource_leaks,
        "charset_gaps": charset_gaps,
        "null_deref_gaps": null_deref_gaps,
        "authz_audit_gaps": authz_audit_gaps,
        "disabled_bounds": disabled_bounds,
        "retry_side_effects": retry_side_effects,
        "shared_mutables": shared_mutables,
        "process_defaults": process_defaults,
        "protection_gaps": protection_gaps,
        "residual_hardening": residual_hardening,
        "thresholds": {
            "max_files": MAX_FILES,
            "max_lines": MAX_LINES,
            "neighbor": NEIGHBOR,
        },
        "files_considered": len(all_paths),
        "files_scanned": files_scanned,
        "surfaces": {
            "pay": pay,
            "mq": mq,
            "remote": any_remote,
            "retry": any_retry,
        },
    }
    expand_mirrored_hits(payload, mirrors)
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
