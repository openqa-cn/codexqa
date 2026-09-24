#!/usr/bin/env python3
"""Write the one-file judgment packet and the conclusion skeleton.

The host agent reads 29-judgment-packet.json and does not reopen signal
files, git, or a second copy of a read group. 30-conclusion-skeleton.json
holds span hashes, drift line skips, and the untested-symbol name list.
render-review-html.sh merges that skeleton so those fields are not copied
by hand.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

MAX_SOURCE_LINES = 400
SIGNAL_GLOBS = ("1*-*signals.json", "2*-*signals.json")


def load_validate():
    path = Path(__file__).resolve().parent / "validate-conclusion.py"
    spec = importlib.util.spec_from_file_location("validate_conclusion_packet", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("validate-conclusion.py is not importable")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_json(path: Path):
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def pr_paths(detail: dict) -> set[str] | None:
    three = detail.get("three_dot") if isinstance(detail, dict) else None
    if not isinstance(three, dict):
        return None
    paths: set[str] = set()
    for key in ("identical_to_base", "content_differs", "only_on_head"):
        values = three.get(key) or []
        if not isinstance(values, list):
            return None
        paths.update(str(item) for item in values)
    return paths


def write_json(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def source_text(repo: Path, rel: str) -> tuple[str, bool]:
    full = repo / rel
    if not full.is_file():
        return "", False
    try:
        lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return "", False
    if len(lines) <= MAX_SOURCE_LINES:
        return "\n".join(f"{n}|{text}" for n, text in enumerate(lines, 1)), False
    head = lines[:MAX_SOURCE_LINES]
    note = f"... truncated after {MAX_SOURCE_LINES} of {len(lines)} lines"
    body = "\n".join(f"{n}|{text}" for n, text in enumerate(head, 1))
    return body + "\n" + note, True


def report_rows(pack: Path, validate) -> list[dict]:
    rows: list[dict] = []
    for pattern in SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            doc = load_json(path)
            if doc is not None:
                validate.walk_report_rows(doc, rows)
    compact = []
    for row in rows:
        rel = str(row.get("path") or row.get("file") or "")
        rule = str(row.get("rule_id") or row.get("kind") or row.get("pattern_class") or "report")
        snippet = str(row.get("snippet") or row.get("message") or row.get("text") or "")
        compact.append({
            "file": rel,
            "line": int(row["line"]),
            "rule": rule,
            "snippet": snippet[:180],
        })
    return compact


def marked_rows(pack: Path, validate) -> list[dict]:
    rows: list[dict] = []
    for pattern in SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            doc = load_json(path)
            if doc is not None:
                validate.walk_marked(doc, rows)
    return rows


def drift_skips(rows: list[dict], in_pr: set[str] | None) -> list[dict]:
    """Skip a marked line only when every copy of that kind+line is outside the PR patch."""
    groups: dict[tuple[str, int], list[str]] = {}
    for row in rows:
        kind = str(row.get("kind") or row.get("rule_id") or "")
        line = int(row["line"])
        rel = str(row.get("path") or row.get("file") or "")
        groups.setdefault((kind, line), []).append(rel)
    skips = []
    for (kind, line), paths in sorted(groups.items()):
        if in_pr is not None and any(rel in in_pr for rel in paths):
            continue
        skips.append({
            "kind": kind,
            "line": line,
            "note": (
                "Outside the three-dot PR patch (branch drift). "
                "Not judged in the residual read."
            ),
        })
    return skips


def untested_names(pack: Path, validate) -> list[str]:
    doc = load_json(pack / "05-changed-symbols.json")
    if not isinstance(doc, dict):
        return []
    names = []
    seen = set()
    for node in validate.production_methods(doc):
        name = str(node.get("name") or "")
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def read_groups(repo: Path, bundle: dict) -> list[dict]:
    groups = []
    for group in bundle.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        paths = [str(item) for item in (group.get("paths") or [])]
        text, truncated = ("", False)
        if paths:
            text, truncated = source_text(repo, paths[0])
        groups.append({
            "id": group.get("id"),
            "paths": paths,
            "opened": paths[0] if paths else "",
            "symbol_ids": group.get("symbol_ids") or [],
            "text": text,
            "truncated": truncated,
        })
    return groups


def risk_drivers(pack: Path) -> dict:
    doc = load_json(pack / "20-risk-tier.json")
    if not isinstance(doc, dict):
        return {}
    drivers = doc.get("drivers") if isinstance(doc.get("drivers"), dict) else {}
    depth = doc.get("review_depth") if isinstance(doc.get("review_depth"), dict) else {}
    sensitive = []
    for hit in drivers.get("sensitive_hits") or []:
        if isinstance(hit, dict):
            sensitive.append({
                "path": hit.get("path"),
                "reason": hit.get("reason"),
            })
    return {
        "tier": doc.get("tier"),
        "industry_tier": doc.get("industry_tier"),
        "evidence_floor": depth.get("evidence_floor"),
        "sensitive_hits": sensitive,
        "rollout_surfaces": drivers.get("rollout_surfaces") or {},
    }


def build(pack: Path, repo: Path) -> tuple[dict, dict]:
    validate = load_validate()
    digest = load_json(pack / "26-review-digest.json") or {}
    detail = load_json(pack / "26-review-digest-detail.json") or {}
    queue = load_json(pack / "27-suspect-queue.json") or {}
    bundle = load_json(pack / "28-symbol-bundle.json") or {}
    ledger = load_json(pack / "24-coverage-ledger.json") or {}
    language = load_json(pack / "09-language-profile.json") or {}
    stats = load_json(pack / "01-stats.json") or {}
    in_pr = pr_paths(detail)
    rows = report_rows(pack, validate)
    pr_rows = []
    drift_rows = []
    for row in rows:
        if in_pr is not None and row["file"] in in_pr:
            pr_rows.append(row)
        else:
            drift_rows.append(row)
    pending = []
    for row in bundle.get("pending") or []:
        if not isinstance(row, dict):
            continue
        pending.append({
            "symbol_id": row.get("symbol_id"),
            "name": row.get("name"),
            "kind": row.get("kind"),
            "path": row.get("path"),
            "start_line": row.get("start_line"),
            "end_line": row.get("end_line"),
            "ranges": row.get("ranges") or [],
            "read_group": row.get("read_group"),
            "applicable": row.get("applicable") or [],
            "skip_ids": row.get("skip_ids") or [],
            "span_hash": row.get("span_hash"),
            "span_check": row.get("span_check"),
        })
    impacts = []
    for row in bundle.get("impacts") or []:
        if isinstance(row, dict) and row.get("review_scope") == "pr_delta":
            impacts.append(row)
    stubs = None
    if isinstance(stats, dict):
        stubs = stats.get("stubs")
    packet = {
        "kind": "JudgmentPacket",
        "schema_version": 1,
        "generated_by": "build-judgment-packet.py",
        "read_this": (
            "Read this file only. Do not open 01-28, diffs/, impact/, "
            "signal JSON, or git. read_groups[].text is paths[0] once; "
            "do not open paths after the first. Judge report.pr_delta and "
            "suspects.packets. report.branch_drift is cited at render time. "
            "Non-source samples are not symbols."
        ),
        "language": {
            "primary_language": language.get("primary_language"),
            "review_language_focus": language.get("review_language_focus"),
            "is_polyglot": language.get("is_polyglot"),
            "confidence": language.get("confidence"),
        },
        "stubs": stubs,
        "counts": digest.get("counts") or {},
        "history": {
            "commits_behind": (digest.get("history") or {}).get("commits_behind"),
            "commits_ahead": (digest.get("history") or {}).get("commits_ahead"),
            "three_dot_counts": (digest.get("history") or {}).get("three_dot_counts"),
            "two_dot_counts": (digest.get("history") or {}).get("two_dot_counts"),
        },
        "dimensions": digest.get("dimensions") or {},
        "non_source_changed": digest.get("non_source_changed") or [],
        "risk_tier": risk_drivers(pack),
        "report": {
            "pr_delta": pr_rows,
            "branch_drift_count": len(drift_rows),
            "branch_drift_lines": sorted(
                {row["line"] for row in drift_rows} - {row["line"] for row in pr_rows}
            ),
        },
        "suspects": {
            "omitted_branch_drift": queue.get("omitted_branch_drift"),
            "policies": queue.get("policies") or {},
            "packets": queue.get("packets") or [],
            "sast_packets": queue.get("sast_packets") or [],
        },
        "skip_notes": bundle.get("skip_notes") or {},
        "pending": pending,
        "read_groups": read_groups(repo, bundle if isinstance(bundle, dict) else {}),
        "impacts_pr_delta": impacts,
    }
    closure = []
    for row in ledger.get("symbols") or []:
        if not isinstance(row, dict) or row.get("status") != "pending":
            continue
        item = {
            "symbol_id": row.get("symbol_id"),
            "status": "reviewed",
            "open_result": "none",
        }
        if row.get("span_hash"):
            item["span_hash"] = row["span_hash"]
        elif row.get("span_check"):
            item["span_check"] = row["span_check"]
        closure.append(item)
    names = untested_names(pack, validate)
    skeleton = {
        "kind": "ConclusionSkeleton",
        "schema_version": 1,
        "generated_by": "build-judgment-packet.py",
        "read_this": (
            "Do not hand-copy this file into the conclusion. "
            "seal-conclusion.py fills coverage_closure, line_skips, "
            "and the untested symbol names at render. Judge pr_delta "
            "report rows yourself; branch_drift lines are cited for you."
        ),
        "coverage_closure": closure,
        "line_skips": drift_skips(marked_rows(pack, validate), in_pr),
        "test_gaps": [{
            "symbol": "untested-production-symbols",
            "symbol_en": "untested-production-symbols",
            "symbols": names,
            "tested_count": "0",
            "tests_reach": "empty",
            "tests_reach_en": "No accepted test edge",
            "note": (
                "Prefilled from changed symbols with tested_count 0. "
                "Names outside the judgment packet pending list are branch drift."
            ),
            "note_en": (
                "Prefilled from changed symbols with tested_count 0. "
                "Names outside the judgment packet pending list are branch drift."
            ),
        }] if names else [],
        "branch_drift_lines": packet["report"]["branch_drift_lines"],
    }
    return packet, skeleton


def write(pack: Path, repo: Path) -> None:
    packet, skeleton = build(pack, repo)
    write_json(pack / "29-judgment-packet.json", packet)
    write_json(pack / "30-conclusion-skeleton.json", skeleton)
    print(
        "Judgment packet written: "
        f"groups={len(packet['read_groups'])} "
        f"pending={len(packet['pending'])} "
        f"pr_delta_rows={len(packet['report']['pr_delta'])} "
        f"drift_lines={len(packet['report']['branch_drift_lines'])} "
        f"skips={len(skeleton['line_skips'])}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Write 29-judgment-packet.json")
    parser.add_argument("--dir", required=True)
    parser.add_argument("--repo", required=True)
    args = parser.parse_args()
    pack = Path(args.dir)
    repo = Path(args.repo)
    if not pack.is_dir():
        print(f"error: pack dir missing: {pack}", file=sys.stderr)
        return 2
    write(pack, repo)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
