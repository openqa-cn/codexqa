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

# Deterministic SAST pattern classes. Without a per-class policy from
# 23-sast-signals.json, a candidate in one of these classes is dropped
# (historical behavior). With a policy file, an owned candidate is kept
# only when its suspect_id is listed in suspects[]. Same file and line as
# an existing hit is always a duplicate, never a second card.
SAST_OWNED_RES: list[tuple[str, re.Pattern[str]]] = [
    ("ssrf", re.compile(r"\bssrf\b|server-side request forgery", re.I)),
    ("path_traversal", re.compile(r"path traversal|path-traversal|路径穿越|目录穿越", re.I)),
    ("pickle", re.compile(r"\bpickle\b|pickle\.loads|不安全反序列化|unsafe deserial", re.I)),
    ("weak_hash", re.compile(r"weak hash|弱哈希|弱散列|\bmd5\b|\bsha-?1\b", re.I)),
    ("float_money", re.compile(r"float money|浮点金额|浮点数.{0,8}金额|金额.{0,12}浮点", re.I)),
    ("sqli", re.compile(r"\bsqli\b|sql injection|sql注入|sql 注入", re.I)),
    ("command_injection", re.compile(r"command injection|命令注入", re.I)),
    ("xss", re.compile(r"\bxss\b|cross-site scripting|跨站脚本", re.I)),
    ("hardcoded_secret", re.compile(
        r"hardcoded (password|secret|api key)|硬编码.{0,8}(密码|密钥|秘钥)|DB_PASSWORD|SIGN_SECRET", re.I)),
    ("insecure_tls", re.compile(
        r"useSSL\s*=\s*false|insecure.trust.manager|HostnameVerifier|信任所有证书|证书校验", re.I)),
    ("bigdecimal_equals", re.compile(
        r"BigDecimal\.equals|(?:amount|limit).{0,40}\.equals\s*\(|限额.{0,16}equals", re.I)),
]


def sast_owned_class(finding: dict) -> str:
    """Return the SAST-owned pattern class, or empty if the candidate is not one."""
    explicit = str(finding.get("pattern_class") or "").strip()
    owned_names = {name for name, _rx in SAST_OWNED_RES}
    if explicit in owned_names:
        return explicit
    blob = " ".join(
        str(finding.get(k) or "")
        for k in ("title", "title_en", "risk", "risk_en", "evidence", "evidence_en")
    )
    for name, rx in SAST_OWNED_RES:
        if rx.search(blob):
            return name
    return ""


VARIANT_MARKERS = (
    "扫描器未覆盖这一写法",
    "scanner does not cover this shape",
)


def variant_uncovered(finding: dict) -> bool:
    blob = " ".join(
        str(finding.get(k) or "")
        for k in ("title", "title_en", "risk", "risk_en", "evidence", "evidence_en", "fix", "fix_en")
    )
    return any(mark in blob for mark in VARIANT_MARKERS)


def class_locus_match(candidate: dict, baseline: dict, cls: str) -> bool:
    """Same pattern class at the same file and a nearby line."""
    if sast_owned_class(baseline) != cls and str(baseline.get("pattern_class") or "") != cls:
        return False
    c_path = extract_path(candidate)
    b_path = extract_path(baseline)
    if not c_path or not b_path or c_path != b_path:
        return False
    c_line = extract_line(candidate)
    b_line = extract_line(baseline)
    if c_line is None or b_line is None:
        return False
    return abs(c_line - b_line) <= 3


def sast_policy_drop(
    candidate: dict,
    policy: dict | None,
    baseline_rows: list,
    suspect_ids: set[str] | None = None,
) -> str | None:
    """Return a drop reason, or None to keep evaluating the candidate.

    policy is None → legacy global drop of every owned class.
    With a policy, keep an owned candidate only when suspect_id is in suspects[].
    A same-file same-line hit is not dropped here; the duplicate pass enriches it.
    """
    del baseline_rows
    cls = sast_owned_class(candidate)
    if not cls:
        return None
    if policy is None:
        return "legacy_global_ban"
    sid = str(candidate.get("suspect_id") or "").strip()
    if sid and suspect_ids and sid in suspect_ids:
        return None
    return "not_a_suspect"


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


def relation_ids(finding: dict) -> str:
    return str(finding.get("rule_id") or "").strip()


def same_relation(candidate: dict, baseline: dict) -> bool:
    """Line proximity is not a relation.

    Both ids present and equal: same defect. Both absent: a restatement may
    still match on wording. Exactly one id present: not the same relation.
    """
    c_rule = relation_ids(candidate)
    b_rule = relation_ids(baseline)
    if c_rule or b_rule:
        return bool(c_rule and b_rule and c_rule == b_rule)
    return True


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
    if not same_relation(candidate, baseline):
        return False
    c_cls = sast_owned_class(candidate) or str(candidate.get("pattern_class") or "").strip()
    b_cls = sast_owned_class(baseline) or str(baseline.get("pattern_class") or "").strip()
    if c_cls and b_cls and c_cls != b_cls:
        return False
    # A rate/timeout/test row is not the same defect as a scanner class on a nearby line.
    if candidate.get("derive_suspect_id") and sast_owned_class(baseline):
        return False

    # Same symbol + similar prose, only for the same relation.
    if c_sym and b_sym and c_sym == b_sym and overlap >= 0.5:
        return True

    # Nearby lines merge only when the relation id matches, or both findings
    # are unlabeled restatements of one issue.
    if c_path and b_path and c_path == b_path and families_compatible(c_cat, b_cat):
        if c_line is not None and b_line is not None and abs(c_line - b_line) <= 3:
            # Same line merges. The same rule_id on a nearby line is one defect:
            # the caller records the other line in also_lines. A different
            # relation stays a second card.
            if c_line == b_line or c_line in listed_lines(baseline):
                return True
            if relation_ids(candidate) and relation_ids(candidate) == relation_ids(baseline):
                return True
            return False
        if c_line is None and b_line is None and overlap >= 0.55:
            return True

    if c_path and b_path and c_path == b_path and overlap >= 0.55:
        return True

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


def listed_lines(finding: dict) -> set[int]:
    found: set[int] = set()
    if isinstance(finding.get("line"), int):
        found.add(finding["line"])
    for key in ("lines", "also_lines"):
        raw = finding.get(key)
        if isinstance(raw, list):
            found.update(n for n in raw if isinstance(n, int))
    return found


def union_lines(finding: dict, candidate: dict) -> None:
    """A restatement keeps the other line on this card. It is not a second card."""
    extra = extract_line(candidate)
    primary = finding.get("line") if isinstance(finding.get("line"), int) else extract_line(finding)
    if not isinstance(extra, int):
        return
    if not isinstance(primary, int):
        finding["line"] = extra
        return
    if extra == primary:
        return
    also = [n for n in (finding.get("also_lines") or []) if isinstance(n, int)]
    if extra not in also:
        also.append(extra)
    finding["also_lines"] = also
    finding["same_fix"] = True


def enrich_evidence(finding: dict, candidate: dict) -> None:
    union_lines(finding, candidate)
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


def merge(
    baseline: dict,
    candidates: dict,
    *,
    enrich: bool = True,
    sast_policy: dict | None = None,
    suspect_ids: set[str] | None = None,
    spans: list[tuple[int, int]] | None = None,
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
    dropped_sast = 0
    dropped_ledger = 0

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

            owned = sast_owned_class(c)
            locus = None
            if owned:
                for bsev, bi, bf in flat:
                    if class_locus_match(c, bf, owned):
                        locus = (bsev, bi, bf)
                        break
            if locus:
                deduped += 1
                bsev, bi, bf = locus
                if enrich:
                    enrich_evidence(merged[bsev][bi], c)
                    enriched += 1
                report_rows.append(
                    {
                        "decision": "duplicate",
                        "severity": sev,
                        "title": c.get("title"),
                        "pattern_class": owned,
                        "matched_severity": bsev,
                        "matched_title": bf.get("title"),
                        "matched_index": bi,
                        "reason": "same_file_line_class",
                    }
                )
                continue

            drop_reason = sast_policy_drop(c, sast_policy, flat, suspect_ids)
            if drop_reason:
                dropped_sast += 1
                report_rows.append(
                    {
                        "decision": "sast_owned",
                        "severity": sev,
                        "title": c.get("title"),
                        "pattern_class": owned,
                        "reason": drop_reason,
                    }
                )
                continue

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
        "dropped_sast_owned": dropped_sast,
        "dropped_outside_ledger": dropped_ledger,
        "enriched_existing": enriched if enrich else 0,
        "baseline_total": sum(len(base[s]) for s in SEVERITY_KEYS),
        "merged_total": sum(len(merged[s]) for s in SEVERITY_KEYS),
        "dedupe_report": report_rows[:80],
        "notes": [
            "Host-agent LLM candidates merged against heuristic findings; duplicates omitted",
            "Without --sast-signals, owned pattern classes are dropped. With a policy file, an owned candidate is kept only when suspect_id is listed in suspects[].",
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
    merged, summary = merge(
        baseline,
        candidates,
        enrich=not args.no_enrich,
        sast_policy=sast_policy,
        suspect_ids=suspect_ids,
        spans=ledger_spans(args.ledger),
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
