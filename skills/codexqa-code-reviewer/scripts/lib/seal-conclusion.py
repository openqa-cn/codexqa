#!/usr/bin/env python3
"""Fill mechanical conclusion fields from 30-conclusion-skeleton.json.

Span hashes, drift line skips, and the untested-symbol name list are not
retyped by the model. Branch-drift report lines are cited on one finding
so the closure gate holds. pr_delta report lines stay the model's job.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path


def load_validate():
    path = Path(__file__).resolve().parent / "validate-conclusion.py"
    spec = importlib.util.spec_from_file_location("validate_conclusion_seal", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("validate-conclusion.py is not importable")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def cite_text(lines: list[int]) -> str:
    parts: list[str] = []
    buf: list[str] = []
    for number in lines:
        trial = "、".join(buf + [str(number)])
        if buf and len(trial) > 160:
            parts.append("行：" + "、".join(buf) + "。")
            buf = [str(number)]
        else:
            buf.append(str(number))
    if buf:
        parts.append("行：" + "、".join(buf) + "。")
    return "".join(parts)


def gap_names(conclusion: dict) -> set[str]:
    names: set[str] = set()
    for row in conclusion.get("test_gaps") or []:
        if not isinstance(row, dict):
            continue
        if row.get("symbol"):
            names.add(str(row["symbol"]))
        for key in ("symbols", "waived_symbols"):
            raw = row.get(key)
            if isinstance(raw, list):
                names.update(str(item) for item in raw)
    return names


def seal(conclusion: dict, skeleton: dict, validate) -> dict:
    merged = dict(conclusion)
    skeleton_rows = [row for row in (skeleton.get("coverage_closure") or []) if isinstance(row, dict)]
    by_id = {}
    for row in merged.get("coverage_closure") or []:
        if isinstance(row, dict) and row.get("symbol_id"):
            by_id[str(row["symbol_id"])] = dict(row)
    finding_ids = set()
    for finding in validate.findings_of(merged):
        if finding.get("symbol_id"):
            finding_ids.add(str(finding["symbol_id"]))
    for row in skeleton_rows:
        sid = str(row.get("symbol_id") or "")
        if not sid:
            continue
        got = by_id.get(sid)
        if got is None:
            got = dict(row)
            by_id[sid] = got
        if not got.get("span_hash") and row.get("span_hash"):
            got["span_hash"] = row["span_hash"]
        if not got.get("span_check") and row.get("span_check"):
            got["span_check"] = row["span_check"]
        if got.get("status") not in {"reviewed", "failed"}:
            got["status"] = "reviewed"
        if sid in finding_ids:
            got["open_result"] = "hit"
        elif got.get("open_result") not in {"hit", "none"}:
            got["open_result"] = row.get("open_result") or "none"
    if by_id:
        merged["coverage_closure"] = list(by_id.values())

    have = set()
    skips = []
    for row in merged.get("line_skips") or []:
        if isinstance(row, dict) and isinstance(row.get("line"), int):
            have.add((str(row.get("kind") or ""), int(row["line"])))
            skips.append(row)
    for row in skeleton.get("line_skips") or []:
        if not isinstance(row, dict) or not isinstance(row.get("line"), int):
            continue
        key = (str(row.get("kind") or ""), int(row["line"]))
        if key in have:
            continue
        have.add(key)
        skips.append(row)
    merged["line_skips"] = skips

    names = gap_names(merged)
    missing = []
    for row in skeleton.get("test_gaps") or []:
        if not isinstance(row, dict):
            continue
        for item in row.get("symbols") or []:
            if str(item) not in names:
                missing.append(str(item))
    if missing:
        gaps = list(merged.get("test_gaps") or [])
        gaps.append({
            "symbol": "untested-production-symbols",
            "symbol_en": "untested-production-symbols",
            "symbols": missing,
            "tested_count": "0",
            "tests_reach": "empty",
            "tests_reach_en": "No accepted test edge",
            "note": "这些符号在变更集里 tested_count 为 0。判定包 pending 之外的名字属于分支漂移。",
            "note_en": "These changed symbols have tested_count 0. Names outside the judgment packet pending list are branch drift.",
        })
        merged["test_gaps"] = gaps

    cited = validate.cited_lines(merged)
    drift = [int(n) for n in (skeleton.get("branch_drift_lines") or []) if isinstance(n, int)]
    missing_lines = [n for n in drift if n not in cited]
    if missing_lines:
        text = (
            "这些行在三方 diff 之外，是分支落后主干带来的扫描命中，不是本次提交新写的逻辑。"
            + cite_text(missing_lines)
        )
        en = (
            "These lines sit outside the three-dot diff. They are scanner hits on the stale branch, not logic this pull request added. "
            + cite_text(missing_lines)
        )
        p2 = list(merged.get("p2") or [])
        p2.append({
            "title": "分支漂移上的扫描行已登记",
            "title_en": "Scanner lines on branch drift are recorded",
            "location": "three-dot patch 之外的报告行",
            "location_en": "Report lines outside the three-dot patch",
            "category": "maintainability",
            "change_status": "default",
            "risk": text,
            "risk_en": en,
            "evidence": text,
            "evidence_en": en,
            "fix": "变基后再看三方 diff。不要按这些行去改主干上已经更新的文件。",
            "fix_en": "Rebase, then review the three-dot diff. Do not patch current main because of these lines.",
            "confidence": "medium",
        })
        merged["p2"] = p2
        merged["p2_count"] = len(p2)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Seal review-conclusion.json from the skeleton")
    parser.add_argument("--dir", required=True)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    pack = Path(args.dir)
    skeleton_path = pack / "30-conclusion-skeleton.json"
    if not skeleton_path.is_file():
        return 0
    skeleton = load_json(skeleton_path)
    conclusion = load_json(Path(args.input))
    if not isinstance(skeleton, dict) or not isinstance(conclusion, dict):
        print("error: skeleton or conclusion is not a JSON object", file=sys.stderr)
        return 2
    sealed = seal(conclusion, skeleton, load_validate())
    Path(args.input).write_text(
        json.dumps(sealed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Sealed conclusion from {skeleton_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
