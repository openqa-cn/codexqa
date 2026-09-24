#!/usr/bin/env python3
"""Attach report/drop/suspect to derive-signal rows.

A row whose kind is the defect itself is report. A neighborhood or
name heuristic is suspect. Test and generated paths are drop. Residual
clues stay drop so they are not promoted to findings.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_EXCLUDED = re.compile(
    r"(^|/)(test|tests|__tests__|spec|generated|gen|vendor|node_modules|dist)(/|$)",
    re.I,
)
_EXCLUDED_FILE = re.compile(
    r"(^|/)(test_.*|.*_test\.go|.*\.generated\.[A-Za-z0-9]+|.*\.pb\.go)$",
    re.I,
)

# The matched line is already the defect.
_REPORT = {
    "silent_swallow",
    "exception_unwrap",
    "close_not_in_finally",
    "executor_not_shutdown",
    "null_deref_after_load",
    "charset_omission",
    "admin_grant_without_audit",
    "unpooled_connection",
    "n_plus_one",
    "string_concat_in_loop",
    "collection_grow_in_loop",
    "cache_unbounded",
    "unused_accumulator",
    "eol_import",
    "uncontrolled_log_sink",
    "env_config_gap",
    "destructive_ddl",
    "weak_perf_test",
    "idempotency_or_compensation_gap",
}

# Inferred from a name or a nearby line. The model confirms these.
_SUSPECT = {
    "missing_timeout",
    "magic_number",
    "rate_literal",
    "decision_literal",
    "test_oracle",
    "pii_field",
    "pii_field_bloat",
    "log_exposure",
    "retention_or_dsar_gap",
    "transfer_without_consent_clue",
    "compat_window_gap",
    "breaking_hint",
    "feature_flag_gap",
    "dual_write_gap",
    "breaking_announcement_gap",
    "rollback_gap",
    "catch_without_obs",
    "todo_fixme",
}

_RESIDUAL = {
    "no_degrade_or_breaker_clue",
    "migration_without_flag_or_rollback",
}

_GUARD = {
    "missing_timeout": re.compile(
        r"setQueryTimeout|setConnectTimeout|WithTimeout|with_timeout|context\.WithTimeout",
        re.I,
    ),
    "log_exposure": re.compile(r"\b(redact|mask|last4)\b", re.I),
}

_POLICY = {
    "missing_timeout": {
        "look_for": "A remote or database call on this line has no deadline.",
        "do_not_report": "A finite timeout is set on this call. Zero, negative, or an unbounded sentinel does not count as a deadline.",
        "fix": "Set a finite timeout on the call.",
        "noncompliant": "conn.execute(sql)",
        "compliant": "conn.execute(sql) with a positive query timeout set",
    },
    "magic_number": {
        "look_for": "A raw numeric literal encodes a business bound, or a named bound is never read at the decision.",
        "do_not_report": "The literal is a port. A named constant with bound_read true is excluded only when its value is not 0, -1, false, or an unbounded sentinel. An inline literal that decides a result stays a finding. A test number is excluded only when it does not define the pass condition.",
        "fix": "Read a configured bound at the decision, or replace a disabling sentinel.",
        "noncompliant": "if (hour <= 17) or setTimeout(0) or return cached when TTL is never read",
        "compliant": "if (hour <= cutoff) where cutoff is loaded from configuration",
    },
    "decision_literal": {
        "look_for": "An inline literal decides a timeout, rate, limit, or comparison.",
        "do_not_report": "The value is loaded from the environment or a config service. A port is not a decision. A named constant that is read and is not 0, -1, false, or an unbounded sentinel.",
        "fix": "Name the bound and load it from configuration, or reject the disabling sentinel.",
        "noncompliant": "if (fee < 0.5) or setReadTimeout(0)",
        "compliant": "if (fee < minFee) where minFee comes from configuration",
    },
    "test_oracle": {
        "look_for": "This test method's name or assertion does not exercise the claimed risk, or the assertion requires the unsafe outcome.",
        "do_not_report": "Every F5 shape on this method is absent: claim matches inputs, boundaries include null zero negative and scale, threads are joined, the other flag value runs, no branch is unreachable, and the assertion does not require the unsafe output.",
        "fix": "Change the test so the assertion fails if the production defect is still present.",
        "noncompliant": "a boundary test that uses an interior value, or threads started and not joined",
        "compliant": "the same test supplies the boundary value and joins the threads",
    },
    "log_exposure": {
        "look_for": "A personal identifier is written to a log on this line.",
        "do_not_report": "The value is redacted before the log call.",
        "fix": "Redact the identifier.",
        "noncompliant": "log(cardNumber)",
        "compliant": "log(last4(cardNumber))",
    },
    "compat_window_gap": {
        "look_for": "A deprecated or removed API has no sunset or replacement note.",
        "do_not_report": "A replacement and a sunset are named next to the declaration.",
        "fix": "Name the replacement and the version that removes the old API.",
        "noncompliant": "@Deprecated balance()",
        "compliant": "@Deprecated(since=\"2\", forRemoval=true) balance()",
    },
}

SLICE_RADIUS = 8
SLICE_MAX = 1200
_BOUND_KINDS = {"magic_number", "rate_literal"}
_BOUND_NAME = re.compile(r"\b([A-Z][A-Z0-9_]{2,})\b")


def excluded(path: str) -> bool:
    rel = (path or "").replace("\\", "/")
    return bool(_EXCLUDED.search(rel) or _EXCLUDED_FILE.search(rel))


def classify(row: dict) -> tuple[str, str]:
    kind = str(row.get("kind") or "")
    path = str(row.get("path") or row.get("file") or "")
    snippet = str(row.get("snippet") or row.get("evidence") or "")
    if excluded(path):
        return "drop", "excluded_path"
    if kind in _RESIDUAL:
        return "drop", "residual_clue"
    guard = _GUARD.get(kind)
    if guard and guard.search(snippet):
        return "drop", "guard_present"
    if kind in _SUSPECT:
        return "suspect", "neighborhood"
    if kind in _REPORT or kind:
        return "report", "structural"
    return "report", "structural"


def read_slice(repo: Path, rel: str, line: int) -> str:
    path = repo / rel if repo and rel else Path()
    if not path.is_file():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return ""
    start = max(1, int(line or 1) - SLICE_RADIUS)
    end = min(len(lines), int(line or 1) + SLICE_RADIUS)
    target = int(line or 1)
    rows = [(n, lines[n - 1]) for n in range(start, end + 1)]
    while rows and sum(len(text) + 8 for _, text in rows) > SLICE_MAX and len(rows) > 1:
        if abs(rows[0][0] - target) >= abs(rows[-1][0] - target):
            if rows[0][0] == target:
                rows.pop()
            else:
                rows.pop(0)
        elif rows[-1][0] == target:
            rows.pop(0)
        else:
            rows.pop()
    return "\n".join(f"{n}|{text}" for n, text in rows)


def bound_is_read(repo: Path, rel: str, line: int, snippet: str):
    """True when a declared constant name is read on another line of the file.

    None when the line has no constant-shaped name or the file cannot be read.
    """
    names = _BOUND_NAME.findall(snippet or "")
    if not names or not repo or not rel:
        return None
    path = repo / rel
    if not path.is_file():
        return None
    try:
        rows = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return None
    for name in names:
        token = re.compile(r"\b" + re.escape(name) + r"\b")
        for index, row in enumerate(rows, 1):
            if index == int(line or 0):
                continue
            if token.search(row):
                return True
    return False


def annotate(doc: dict, repo: Path) -> dict:
    suspects = []
    counts = {"report": 0, "drop": 0, "suspect": 0}

    def walk(value):
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and ("kind" in item) and ("line" in item or "path" in item):
                    if "disposition" in item:
                        counts[item["disposition"]] = counts.get(item["disposition"], 0) + 1
                        continue
                    disposition, reason = classify(item)
                    item["disposition"] = disposition
                    item["skip_llm"] = disposition != "suspect"
                    item["triage_reason"] = reason
                    counts[disposition] = counts.get(disposition, 0) + 1
                    if disposition != "suspect":
                        continue
                    rel = str(item.get("path") or item.get("file") or "")
                    line = int(item.get("line") or 1)
                    kind = str(item.get("kind") or "")
                    sid = f"{kind}:{rel}:{line}"
                    item["derive_suspect_id"] = sid
                    policy = dict(_POLICY.get(kind) or {
                        "look_for": "The matched line is a real defect of this kind.",
                        "do_not_report": "A guard on this line already prevents it.",
                        "fix": "Add the missing guard.",
                        "noncompliant": "unguarded use",
                        "compliant": "guarded use",
                    })
                    packet = {
                        "derive_suspect_id": sid,
                        "file": rel,
                        "line": line,
                        "kind": kind,
                        "slice": read_slice(repo, rel, line),
                        "policy": policy,
                    }
                    if kind in _BOUND_KINDS:
                        packet["bound_read"] = bound_is_read(
                            repo, rel, line, str(item.get("snippet") or "")
                        )
                    suspects.append(packet)
                else:
                    walk(item)
        elif isinstance(value, dict):
            for key, child in value.items():
                if key in ("derive_suspects", "triage"):
                    continue
                walk(child)

    walk(doc)
    doc["triage"] = counts
    doc["derive_suspects"] = suspects
    return doc


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: derive_triage.py <signal.json> [repo]")
    path = Path(sys.argv[1])
    repo = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else Path()
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        return
    annotate(doc, repo if repo.is_dir() else Path())
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
