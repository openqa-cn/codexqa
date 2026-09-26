#!/usr/bin/env python3
"""Merge host-agent LLM review candidates into heuristic findings (dedupe).

Zero CodexQA. Zero network. One hash key, (file, line, rule_id), decides
whether a candidate is the same card. A second rule id on that line stays.

Usage:
  acr-python merge-llm-findings.py \\
    --baseline baseline-findings.json \\
    --candidates llm-candidates.json \\
    --out merged-findings.json \\
    [--report 22-llm-judgment.json] \\
    [--mode pr]

baseline / candidates / out JSON shape:
  { "p0": [...], "p1": [...], "p2": [...] }

Each finding may include: title, risk, location, file, symbol_id, category,
source, evidence, fix, line (int optional).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

LINE_IN_LOC = re.compile(r"(?::|\#|line\s+|L)(\d{1,6})\b", re.I)
PATH_IN_LOC = re.compile(
    r"([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)+\.[A-Za-z0-9]+)"
)

SEVERITY_KEYS = ("p0", "p1", "p2")

# Behavioral, concurrency, memory, and unused-parameter claims stay even when
# the quoted snippet is not in the diff. A wrong drop there is expensive.
PROTECTED_CATEGORIES = {"concurrency", "correctness"}
PROTECTED_TEXT = re.compile(
    r"unused parameter|未使用参数|越界|use-after-free|buffer overflow|null deref|空指针|内存",
    re.I,
)


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise SystemExit(f"expected object in {path}")
    return obj


def norm_path(s: str) -> str:
    s = (s or "").strip().replace("\\", "/")
    # strip location junk: "src/Foo.java:12" → path part
    m = PATH_IN_LOC.search(s)
    if m:
        return m.group(1).lower()
    # bare filename
    if "/" not in s and "." in s:
        return s.split(":")[0].split("#")[0].strip().lower()
    return s.split(":")[0].split("#")[0].strip().lower()


def extract_line(finding: dict) -> int | None:
    if isinstance(finding.get("line"), int):
        return finding["line"]
    for key in ("location", "file", "evidence"):
        raw = finding.get(key)
        if not isinstance(raw, str):
            continue
        m = LINE_IN_LOC.search(raw)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                pass
    return None


def extract_path(finding: dict) -> str:
    for key in ("file", "location", "path"):
        raw = finding.get(key)
        if isinstance(raw, str) and raw.strip():
            p = norm_path(raw)
            if p:
                return p
    return ""



def ensure_lists(obj: dict) -> dict:
    out = {k: list(obj.get(k) or []) for k in SEVERITY_KEYS}
    for sev in SEVERITY_KEYS:
        out[sev] = [x for x in out[sev] if isinstance(x, dict)]
    return out


# Signal cards often carry kind and no rule_id. Fill the key before lookup.
KIND_TO_RULE = {
    "tenant_predicate_missing": "TEN-002",
    "tenant_id_only_lookup": "TEN-002",
    "tenant_context_dropped": "TEN-004",
    "resource_leaks": "RES-001",
    "executor_not_shutdown": "RES-001",
    "process_default": "GLOB-001",
    "process_default_write": "GLOB-001",
}
RULE_ID_RE = re.compile(r"^[A-Z]+-\d+$")


def rule_of(finding: dict) -> str:
    """Rule id for the dedupe key. A bare kind is used only when it maps."""
    raw = str(finding.get("rule_id") or "").strip()
    if RULE_ID_RE.match(raw):
        return raw
    kind = str(finding.get("kind") or "").strip()
    if RULE_ID_RE.match(kind):
        return kind
    return KIND_TO_RULE.get(kind, "")


def locus_lines(finding: dict) -> list[int]:
    """Primary line, then also_lines. Each line is one key for the same card."""
    found: list[int] = []
    primary = extract_line(finding)
    if isinstance(primary, int):
        found.append(primary)
    for key in ("also_lines", "lines"):
        raw = finding.get(key)
        if not isinstance(raw, list):
            continue
        for number in raw:
            if isinstance(number, int) and number not in found:
                found.append(number)
    return found


class KeyIndex:
    """Hash set of (file, line, rule_id), plus lines whose card has no rule id."""

    def __init__(self) -> None:
        self.keys: set[tuple[str, int, str]] = set()
        self.occupied: set[tuple[str, int]] = set()

    def add(self, finding: dict) -> None:
        path = extract_path(finding)
        if not path:
            return
        rule = rule_of(finding)
        for line in locus_lines(finding):
            if rule:
                self.keys.add((path, line, rule))
            else:
                self.occupied.add((path, line))

    def reject(self, finding: dict) -> str | None:
        """Drop reason, or None when the candidate is a new card."""
        rule = rule_of(finding)
        if not rule:
            return "missing_rule_id"
        path = extract_path(finding)
        lines = locus_lines(finding)
        if not path or not lines:
            return "missing_locus"
        for line in lines:
            if (path, line, rule) in self.keys:
                return "same_key"
        if (path, lines[0]) in self.occupied:
            return "occupied_line"
        return None



def ledger_spans(path: str) -> list[tuple[int, int]] | None:
    """Pending-symbol line spans. None when --ledger was not passed."""
    if not path:
        return None
    doc = load_json(path)
    spans: list[tuple[int, int]] = []
    for row in doc.get("symbols") or []:
        if not isinstance(row, dict) or row.get("status") != "pending":
            continue
        start = row.get("start_line")
        end = row.get("end_line")
        if isinstance(start, int) and isinstance(end, int) and end >= start:
            spans.append((start, end))
    return spans


def line_in_spans(line: int | None, spans: list[tuple[int, int]]) -> bool:
    if line is None:
        return False
    return any(start <= line <= end for start, end in spans)


def squash_ws(text: str) -> str:
    return re.sub(r"\s+", "", text)


def protected_candidate(finding: dict) -> bool:
    category = str(finding.get("category") or "").strip().lower()
    if category in PROTECTED_CATEGORIES:
        return True
    rule = str(finding.get("rule_id") or "")
    if rule.startswith(("CONC-", "NULL-")):
        return True
    blob = " ".join(str(finding.get(key) or "") for key in ("title", "title_en", "risk", "risk_en", "category"))
    return bool(PROTECTED_TEXT.search(blob))


def diff_for_path(path: str, diffs: dict[str, str] | None) -> str | None:
    if not diffs or not path:
        return None
    folded = path.replace("\\", "/").lower()
    for key, text in diffs.items():
        other = str(key).replace("\\", "/").lower()
        if other == folded or other.endswith("/" + folded) or folded.endswith("/" + other):
            return text
    return None


def snippet_missing_from_diff(candidate: dict, diffs: dict[str, str] | None) -> bool:
    """True only when a diff for this file exists and the snippet is absent."""
    if not diffs:
        return False
    snippet = str(candidate.get("existing_code") or "").strip()
    if not snippet or protected_candidate(candidate):
        return False
    text = diff_for_path(extract_path(candidate), diffs)
    if text is None:
        return False
    return squash_ws(snippet) not in squash_ws(text)


def merge(
    baseline: dict,
    candidates: dict,
    *,
    enrich: bool = True,
    sast_policy: dict | None = None,
    suspect_ids: set[str] | None = None,
    spans: list[tuple[int, int]] | None = None,
    diffs: dict[str, str] | None = None,
) -> tuple[dict, dict]:
    del enrich, sast_policy, suspect_ids
    base = ensure_lists(baseline)
    merged = {
        sev: [dict(f) for f in base[sev]] for sev in SEVERITY_KEYS
    }
    index = KeyIndex()
    for sev in SEVERITY_KEYS:
        for finding in merged[sev]:
            index.add(finding)

    report_rows: list[dict[str, Any]] = []
    kept = {sev: [] for sev in SEVERITY_KEYS}
    novel = 0
    deduped = 0
    dropped_missing = 0
    dropped_ledger = 0
    dropped_unanchored = 0

    cand_lists = ensure_lists(candidates)
    for sev in SEVERITY_KEYS:
        for cand in cand_lists[sev]:
            c = dict(cand)
            c.setdefault("source", "llm_judgment")
            if not c.get("category"):
                c["category"] = "llm_judgment"

            if spans is not None and not line_in_spans(extract_line(c), spans):
                dropped_ledger += 1
                report_rows.append(
                    {
                        "decision": "outside_ledger",
                        "severity": sev,
                        "title": c.get("title"),
                        "line": extract_line(c),
                        "reason": "line outside pending symbol spans",
                    }
                )
                continue

            if snippet_missing_from_diff(c, diffs):
                dropped_unanchored += 1
                report_rows.append(
                    {
                        "decision": "not_in_diff",
                        "severity": sev,
                        "title": c.get("title"),
                        "line": extract_line(c),
                        "reason": "existing_code is not in the file diff",
                    }
                )
                continue

            reason = index.reject(c)
            if reason in {"same_key", "occupied_line"}:
                deduped += 1
                report_rows.append(
                    {
                        "decision": "duplicate",
                        "severity": sev,
                        "title": c.get("title"),
                        "rule_id": rule_of(c),
                        "line": extract_line(c),
                        "reason": reason,
                    }
                )
                continue
            if reason:
                dropped_missing += 1
                report_rows.append(
                    {
                        "decision": reason,
                        "severity": sev,
                        "title": c.get("title"),
                        "line": extract_line(c),
                        "reason": reason,
                    }
                )
                continue

            novel += 1
            kept[sev].append(c)
            index.add(c)
            report_rows.append(
                {
                    "decision": "novel",
                    "severity": sev,
                    "title": c.get("title"),
                    "rule_id": rule_of(c),
                    "category": c.get("category"),
                }
            )

    for sev in SEVERITY_KEYS:
        merged[sev].extend(kept[sev])

    summary = {
        "kind": "LlmJudgmentSignals",
        "schema_version": 1,
        "generated_by": "codexqa-code-reviewer/merge-llm-findings",
        "candidates_total": sum(len(cand_lists[s]) for s in SEVERITY_KEYS),
        "kept_novel": novel,
        "deduped_against_heuristics": deduped,
        "dropped_missing_rule_id": dropped_missing,
        "dropped_sast_owned": 0,
        "dropped_outside_ledger": dropped_ledger,
        "dropped_unanchored": dropped_unanchored,
        "enriched_existing": 0,
        "baseline_total": sum(len(base[s]) for s in SEVERITY_KEYS),
        "merged_total": sum(len(merged[s]) for s in SEVERITY_KEYS),
        "dedupe_report": report_rows[:80],
        "notes": [
            "Dedupe key is file + line + rule_id, looked up in a hash set.",
            "also_lines share that card. A kind with no rule id occupies the line.",
            "A candidate without a rule id is not admitted.",
        ],
    }
    return merged, summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Dedupe LLM CR candidates into baseline findings")
    ap.add_argument("--baseline", required=True, help="JSON with p0/p1/p2 baseline findings")
    ap.add_argument("--candidates", required=True, help="JSON with p0/p1/p2 LLM candidates")
    ap.add_argument("--out", required=True, help="Merged findings JSON (p0/p1/p2)")
    ap.add_argument("--report", default="", help="Optional 22-llm-judgment.json path")
    ap.add_argument("--mode", default="pr", help="pr|full|adhoc (stamped on report)")
    ap.add_argument("--sast-signals", default="", help="Optional 23-sast-signals.json; uses llm_report_policy")
    ap.add_argument("--ledger", default="", help="Optional 24-coverage-ledger.json; drop candidates outside pending spans")
    ap.add_argument("--diffs", default="", help="Optional JSON object of path to diff text")
    ap.add_argument("--no-enrich", action="store_true", help="Do not append evidence on duplicates")
    args = ap.parse_args()

    baseline = load_json(args.baseline)
    candidates = load_json(args.candidates)
    sast_policy = None
    suspect_ids: set[str] = set()
    triage = None
    if args.sast_signals:
        signals = load_json(args.sast_signals)
        if isinstance(signals.get("llm_report_policy"), dict):
            sast_policy = signals["llm_report_policy"]
        for row in signals.get("suspects") or []:
            if isinstance(row, dict) and row.get("suspect_id"):
                suspect_ids.add(str(row["suspect_id"]))
        if isinstance(signals.get("triage"), dict):
            triage = signals["triage"]
    diffs = None
    if args.diffs:
        loaded = load_json(args.diffs)
        diffs = {str(key): str(value) for key, value in loaded.items() if isinstance(value, str)}
    merged, summary = merge(
        baseline,
        candidates,
        enrich=not args.no_enrich,
        sast_policy=sast_policy,
        suspect_ids=suspect_ids,
        spans=ledger_spans(args.ledger),
        diffs=diffs,
    )
    summary["mode"] = args.mode
    if triage is not None:
        summary["triage"] = triage

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.report:
        rpath = Path(args.report)
        rpath.parent.mkdir(parents=True, exist_ok=True)
        rpath.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "kept_novel": summary["kept_novel"],
                "deduped": summary["deduped_against_heuristics"],
                "merged_total": summary["merged_total"],
                "out": str(out_path),
                "report": args.report or None,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
