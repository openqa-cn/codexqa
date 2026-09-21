#!/usr/bin/env python3
"""Merge host-agent LLM review candidates into heuristic findings (dedupe).

Zero CodexQA. Zero network. Deterministic fingerprint match so final P0/P1/P2
lists do not repeat the same issue from llm_judgment vs derive dimensions.

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

TOKEN_RE = re.compile(r"[a-z0-9_]{2,}", re.I)
LINE_IN_LOC = re.compile(r"(?::|\#|line\s+|L)(\d{1,6})\b", re.I)
PATH_IN_LOC = re.compile(
    r"([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)+\.[A-Za-z0-9]+)"
)

SEVERITY_KEYS = ("p0", "p1", "p2")


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


def tokens(*parts: str) -> set[str]:
    bag: set[str] = set()
    for p in parts:
        if not p:
            continue
        bag.update(t.lower() for t in TOKEN_RE.findall(p))
    # drop ultra-common noise
    bag -= {
        "the",
        "and",
        "for",
        "with",
        "from",
        "this",
        "that",
        "when",
        "into",
        "none",
        "null",
        "code",
        "file",
        "line",
        "risk",
        "issue",
        "finding",
        "should",
        "would",
        "could",
        "must",
        "may",
    }
    return bag


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / float(len(a | b))


def category_family(cat: str) -> str:
    c = (cat or "").strip().lower()
    if c in ("llm_judgment", "llm-judgment", "agent_llm", ""):
        return "*"
    return c


def families_compatible(a: str, b: str) -> bool:
    fa, fb = category_family(a), category_family(b)
    if fa == "*" or fb == "*":
        return True
    return fa == fb


def finding_text(f: dict) -> str:
    return " ".join(
        str(f.get(k) or "")
        for k in ("title", "title_en", "risk", "risk_en", "evidence", "evidence_en")
    )


def is_duplicate(candidate: dict, baseline: dict) -> bool:
    c_path = extract_path(candidate)
    c_line = extract_line(candidate)
    c_sym = str(candidate.get("symbol_id") or "").strip()
    c_cat = str(candidate.get("category") or "")
    c_tok = tokens(finding_text(candidate))

    b_path = extract_path(baseline)
    b_line = extract_line(baseline)
    b_sym = str(baseline.get("symbol_id") or "").strip()
    b_cat = str(baseline.get("category") or "")
    b_tok = tokens(finding_text(baseline))
    overlap = jaccard(c_tok, b_tok)

    # Same symbol + similar prose
    if c_sym and b_sym and c_sym == b_sym and overlap >= 0.5:
        return True

    # Same path + nearby line + compatible category
    if c_path and b_path and c_path == b_path and families_compatible(c_cat, b_cat):
        if c_line is not None and b_line is not None and abs(c_line - b_line) <= 3:
            return True
        # same path, no lines, strong text overlap
        if c_line is None and b_line is None and overlap >= 0.55:
            return True

    # Strong title/risk overlap with same path (even if category differs)
    if c_path and b_path and c_path == b_path and overlap >= 0.55:
        return True

    # Global strong prose match (rare) — require path match or both empty
    if overlap >= 0.72 and (not c_path or not b_path or c_path == b_path):
        return True

    return False


def flatten_baseline(obj: dict) -> list[tuple[str, int, dict]]:
    out: list[tuple[str, int, dict]] = []
    for sev in SEVERITY_KEYS:
        arr = obj.get(sev) or []
        if not isinstance(arr, list):
            continue
        for i, f in enumerate(arr):
            if isinstance(f, dict):
                out.append((sev, i, f))
    return out


def ensure_lists(obj: dict) -> dict:
    out = {k: list(obj.get(k) or []) for k in SEVERITY_KEYS}
    for sev in SEVERITY_KEYS:
        out[sev] = [x for x in out[sev] if isinstance(x, dict)]
    return out


def enrich_evidence(finding: dict, candidate: dict) -> None:
    extra = (candidate.get("evidence") or candidate.get("risk") or "").strip()
    if not extra:
        return
    note = f"[llm_judgment enrich] {extra[:240]}"
    for key in ("evidence", "evidence_en"):
        cur = finding.get(key)
        if isinstance(cur, str) and cur.strip():
            if "llm_judgment enrich" in cur:
                return
            finding[key] = cur.rstrip() + " · " + note
            return
    finding["evidence"] = note


def merge(
    baseline: dict,
    candidates: dict,
    *,
    enrich: bool = True,
) -> tuple[dict, dict]:
    base = ensure_lists(baseline)
    # Work on deep-ish copies of baseline findings so enrichment is visible
    merged = {
        sev: [dict(f) for f in base[sev]] for sev in SEVERITY_KEYS
    }
    flat = flatten_baseline(merged)

    report_rows: list[dict[str, Any]] = []
    kept = {sev: [] for sev in SEVERITY_KEYS}
    novel = 0
    deduped = 0
    enriched = 0

    cand_lists = ensure_lists(candidates)
    for sev in SEVERITY_KEYS:
        for cand in cand_lists[sev]:
            c = dict(cand)
            c.setdefault("source", "llm_judgment")
            if not c.get("category"):
                c["category"] = "llm_judgment"

            matched: tuple[str, int, dict] | None = None
            for bsev, bi, bf in flat:
                if is_duplicate(c, bf):
                    matched = (bsev, bi, bf)
                    break

            if matched:
                deduped += 1
                bsev, bi, bf = matched
                if enrich:
                    enrich_evidence(merged[bsev][bi], c)
                    enriched += 1
                report_rows.append(
                    {
                        "decision": "duplicate",
                        "severity": sev,
                        "title": c.get("title"),
                        "matched_severity": bsev,
                        "matched_title": bf.get("title"),
                        "matched_index": bi,
                    }
                )
                continue

            novel += 1
            kept[sev].append(c)
            report_rows.append(
                {
                    "decision": "novel",
                    "severity": sev,
                    "title": c.get("title"),
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
        "enriched_existing": enriched if enrich else 0,
        "baseline_total": sum(len(base[s]) for s in SEVERITY_KEYS),
        "merged_total": sum(len(merged[s]) for s in SEVERITY_KEYS),
        "dedupe_report": report_rows[:80],
        "notes": [
            "Host-agent LLM candidates merged against heuristic findings; duplicates omitted",
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
    ap.add_argument("--no-enrich", action="store_true", help="Do not append evidence on duplicates")
    args = ap.parse_args()

    baseline = load_json(args.baseline)
    candidates = load_json(args.candidates)
    merged, summary = merge(baseline, candidates, enrich=not args.no_enrich)
    summary["mode"] = args.mode

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
