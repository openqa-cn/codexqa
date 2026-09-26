#!/usr/bin/env python3
"""Write 26-review-digest.json for a PR evidence pack.

CodexQA --diff-base is a two-dot content comparison of HEAD against the base
tip. A branch that is behind that tip looks like it deleted files the base
added later. This digest separates that drift from the three-dot pull-request
patch (merge-base..HEAD) so the judgment pass does not recompute it with git.

Report rows use the same disposition walk as validate-conclusion.py. The
digest does not drop a row and does not replace symbol-diff or impact files.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import is_source_path  # noqa: E402
from _rule_router import rule_plan  # noqa: E402


def load_conclusion_mod():
    path = Path(__file__).resolve().parent / "validate-conclusion.py"
    spec = importlib.util.spec_from_file_location("validate_conclusion", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("validate-conclusion.py is not importable")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def git(repo: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def git_ok(repo: Path, args: list[str]) -> str:
    proc = git(repo, args)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(detail or f"git {' '.join(args)} failed")
    return proc.stdout


def blob_map(repo: Path, rev: str) -> dict[str, str]:
    text = git_ok(repo, ["ls-tree", "-r", rev])
    blobs: dict[str, str] = {}
    for line in text.splitlines():
        meta, sep, path = line.partition("\t")
        if not sep or not path:
            continue
        parts = meta.split()
        if len(parts) >= 3:
            blobs[path] = parts[2]
    return blobs


def name_status(repo: Path, diff_args: list[str]) -> list[tuple[str, str, str]]:
    """Return (status, old_path, new_path). Deletes use the same path twice."""
    text = git_ok(repo, ["diff", "--name-status", "--find-renames", *diff_args])
    rows: list[tuple[str, str, str]] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0]
        if status.startswith(("R", "C")) and len(parts) >= 3:
            rows.append((status, parts[1], parts[2]))
        elif len(parts) >= 2:
            rows.append((status, parts[1], parts[1]))
    return rows


def classify_path(path: str, head: dict[str, str], base: dict[str, str]) -> str:
    head_sha = head.get(path)
    base_sha = base.get(path)
    if head_sha and base_sha and head_sha == base_sha:
        return "identical_to_base"
    if head_sha and base_sha:
        return "content_differs"
    if head_sha and not base_sha:
        return "only_on_head"
    if base_sha and not head_sha:
        return "missing_on_head"
    return "unresolved"


def history_and_files(repo: Path, diff_base: str) -> dict:
    head_sha = git_ok(repo, ["rev-parse", "HEAD"]).strip()
    base_sha = git_ok(repo, ["rev-parse", "--verify", f"{diff_base}^{{commit}}"]).strip()
    merge_base = git_ok(repo, ["merge-base", "HEAD", diff_base]).strip()
    counts = git_ok(repo, ["rev-list", "--left-right", "--count", f"{diff_base}...HEAD"]).split()
    if len(counts) != 2:
        raise RuntimeError(f"unexpected rev-list count: {counts!r}")
    behind, ahead = int(counts[0]), int(counts[1])
    head_blobs = blob_map(repo, "HEAD")
    base_blobs = blob_map(repo, diff_base)

    three = name_status(repo, [f"{diff_base}...HEAD"])
    two = name_status(repo, [diff_base, "HEAD"])

    three_paths: set[str] = set()
    buckets = {
        "identical_to_base": [],
        "content_differs": [],
        "only_on_head": [],
        "deleted_by_pr": [],
    }
    for status, old, new in three:
        three_paths.add(old)
        three_paths.add(new)
        if status.startswith("D"):
            buckets["deleted_by_pr"].append(old)
            continue
        kind = classify_path(new, head_blobs, base_blobs)
        if kind not in buckets:
            buckets["content_differs"].append(new)
        else:
            buckets[kind].append(new)

    outside = {
        "content_differs": [],
        "missing_on_head": [],
        "only_on_head": [],
        "unresolved": [],
    }
    for status, old, new in two:
        path = old if status.startswith("D") else new
        if path in three_paths or old in three_paths:
            continue
        if status.startswith("D"):
            outside["missing_on_head"].append(old)
            continue
        kind = classify_path(new, head_blobs, base_blobs)
        outside.setdefault(kind, []).append(new)

    for group in (buckets, outside):
        for key, paths in group.items():
            group[key] = sorted(set(paths))

    previews = non_source_previews(repo, head_blobs, base_blobs, buckets)
    return {
        "available": True,
        "head": head_sha,
        "diff_base_sha": base_sha,
        "merge_base": merge_base,
        "commits_behind": behind,
        "commits_ahead": ahead,
        "codexqa_diff": (
            "CodexQA --diff-base compares HEAD to the base tip (two-dot). "
            "Symbol diffs can show lines the base gained after the fork."
        ),
        "pull_request_diff": (
            "three_dot is merge-base..HEAD, the patch the PR commits introduce. "
            "identical_to_base files match the current base tip even if the PR "
            "commit touched them. two_dot_not_in_pr files differ from the base "
            "tip and were not touched by those commits; do not treat them as "
            "PR deletions or edits."
        ),
        "three_dot": buckets,
        "two_dot_not_in_pr": outside,
        "non_source_preview": previews,
    }


def blob_preview(repo: Path, sha: str) -> tuple[int, str]:
    proc = subprocess.run(
        ["git", "-C", str(repo), "cat-file", "blob", sha],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        return 0, ""
    lines = proc.stdout.decode("utf-8", errors="ignore").splitlines()
    picked = [line.strip()[:160] for line in lines if line.strip()][:2]
    return len(lines), " | ".join(picked)


def non_source_previews(
    repo: Path,
    head_blobs: dict[str, str],
    base_blobs: dict[str, str],
    buckets: dict[str, list[str]],
) -> list[dict]:
    """One sample per changed data or doc file. Source files stay on the ledger."""
    rows: list[dict] = []
    for kind in ("content_differs", "only_on_head", "deleted_by_pr"):
        for path in buckets.get(kind) or []:
            if is_source_path(path):
                continue
            head_lines, head_sample = (0, "")
            base_lines = 0
            if path in head_blobs:
                head_lines, head_sample = blob_preview(repo, head_blobs[path])
            if path in base_blobs:
                base_lines, _base_sample = blob_preview(repo, base_blobs[path])
            rows.append({
                "path": path,
                "class": kind,
                "base_lines": base_lines,
                "head_lines": head_lines,
                "head_sample": head_sample,
            })
    return rows


def dimension_cards(pack: Path) -> dict[str, dict]:
    """Counts and flags for each signal file. Slices stay in the signal file."""
    specs = (
        ("design_fit", "10-design-fit-signals.json"),
        ("complexity", "11-complexity-signals.json"),
        ("dependencies", "12-dependency-signals.json"),
        ("privacy", "13-privacy-signals.json"),
        ("resilience", "14-resilience-signals.json"),
        ("rollout", "15-rollout-signals.json"),
        ("observability", "16-observability-signals.json"),
        ("contract", "17-contract-signals.json"),
        ("maintainability", "18-maintainability-signals.json"),
        ("performance", "21-performance-signals.json"),
        ("sast", "23-sast-signals.json"),
        ("risk_tier", "20-risk-tier.json"),
    )
    cards: dict[str, dict] = {}
    for name, filename in specs:
        path = pack / filename
        if not path.is_file():
            cards[name] = {"file": filename, "present": False}
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            cards[name] = {"file": filename, "present": False}
            continue
        if not isinstance(doc, dict):
            cards[name] = {"file": filename, "present": False}
            continue
        counts = {
            key: len(value)
            for key, value in doc.items()
            if isinstance(value, list)
        }
        card: dict = {
            "file": filename,
            "present": True,
            "signals_thin": doc.get("signals_thin"),
            "counts": counts,
            "suspect_count": len(doc.get("derive_suspects") or doc.get("suspects") or []),
        }
        summary = doc.get("summary")
        if isinstance(summary, dict):
            card["summary"] = summary
        surfaces = doc.get("surfaces")
        if isinstance(surfaces, dict):
            card["surfaces"] = surfaces
        if name == "risk_tier":
            depth = doc.get("review_depth") if isinstance(doc.get("review_depth"), dict) else {}
            card["tier"] = doc.get("tier")
            card["evidence_floor"] = depth.get("evidence_floor")
            card["industry_tier"] = doc.get("industry_tier")
        if name == "design_fit":
            card["layer_summary"] = doc.get("layer_summary")
            card["sprawl"] = doc.get("sprawl")
            card["over_abstraction_count"] = len(doc.get("over_abstraction_hints") or [])
        if name == "complexity":
            methods = []
            for row in doc.get("hot_methods") or []:
                if not isinstance(row, dict):
                    continue
                methods.append({
                    "name": row.get("name"),
                    "path": row.get("path") or row.get("file"),
                    "loc": row.get("loc"),
                    "tested_count": row.get("tested_count"),
                })
            card["hot_methods"] = methods[:12]
        if name == "sast":
            tools = doc.get("tools")
            if isinstance(tools, dict):
                card["tool_status"] = {
                    key: (value.get("status") if isinstance(value, dict) else value)
                    for key, value in tools.items()
                }
        cards[name] = card
    return cards


def notable_previews(previews: list[dict], limit: int = 20) -> list[dict]:
    """Line-count changes only. Identical samples stay in the detail file."""
    changed = [row for row in previews if row.get("head_lines") != row.get("base_lines")]
    changed.sort(key=lambda row: abs(int(row.get("head_lines") or 0) - int(row.get("base_lines") or 0)), reverse=True)
    return changed[:limit]


def report_rows(pack: Path, walker) -> dict:
    rows: list[dict] = []
    seen: set[tuple[str, int, str]] = set()
    for pattern in walker.SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            found: list[dict] = []
            walker.walk_report_rows(doc, found)
            for node in found:
                file = str(node.get("path") or node.get("file") or "")
                line = int(node["line"])
                rule = str(node.get("rule_id") or node.get("pattern_class") or node.get("kind") or "report")
                key = (file, line, rule)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "file": file,
                    "line": line,
                    "rule": rule,
                    "source": path.name,
                    "snippet": str(node.get("snippet") or node.get("evidence") or "")[:160],
                })
    rows.sort(key=lambda row: (row["file"], row["line"], row["rule"]))
    unique_lines = sorted({row["line"] for row in rows})
    return {
        "unique_lines": unique_lines,
        "row_count": len(rows),
        "rows": rows,
        "note": (
            "Same walk as the conclusion line ledger: disposition report, "
            "integer line, derive_suspects and other skip keys excluded. "
            "unique_lines dedupes the line number across files. rows keeps "
            "every file, line, and rule."
        ),
    }


def write_atomic(path: Path, doc: dict) -> None:
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def build(pack: Path, repo: Path, diff_base: str) -> tuple[dict, dict]:
    walker = load_conclusion_mod()
    reported = report_rows(pack, walker)
    try:
        split = history_and_files(repo, diff_base)
        git_error = ""
    except (OSError, RuntimeError) as exc:
        split = {
            "available": False,
            "commits_behind": None,
            "commits_ahead": None,
            "three_dot": {
                "identical_to_base": [],
                "content_differs": [],
                "only_on_head": [],
                "deleted_by_pr": [],
            },
            "two_dot_not_in_pr": {
                "content_differs": [],
                "missing_on_head": [],
                "only_on_head": [],
                "unresolved": [],
            },
            "non_source_preview": [],
        }
        git_error = str(exc)
    three = split["three_dot"]
    outside = split["two_dot_not_in_pr"]
    previews = split.get("non_source_preview") or []
    detail = {
        "kind": "ReviewDigestDetail",
        "schema_version": 1,
        "generated_by": "build-review-digest.py",
        "three_dot": three,
        "two_dot_not_in_pr": outside,
        "non_source_preview": previews,
        "history_available": bool(split.get("available")),
    }
    history = {
        key: value
        for key, value in split.items()
        if key not in {"three_dot", "two_dot_not_in_pr", "non_source_preview"}
    }
    history["detail_file"] = "26-review-digest-detail.json"
    history["three_dot_counts"] = {key: len(value) for key, value in three.items()}
    history["two_dot_counts"] = {key: len(value) for key, value in outside.items()}
    changed = notable_previews(previews)
    doc = {
        "kind": "ReviewDigest",
        "schema_version": 2,
        "generated_by": "build-review-digest.py",
        "repo": str(repo),
        "diff_base": diff_base,
        "read_first": (
            "When 29-judgment-packet.json exists, read that file instead of this one. "
            "Otherwise read this file for commits_behind, file-class counts, report rows, "
            "dimension counts, and non-source files whose line counts changed. "
            "Do not recompute the split with git. Do not open 10-*.json through "
            "23-sast-signals.json for the dimension verdict; use dimensions. "
            "The suspect pass reads 27-suspect-queue.json, not the signal files. "
            "Full path lists are in 26-review-digest-detail.json; "
            "open that only to look up one path."
        ),
        "counts": {
            "commits_behind": split.get("commits_behind"),
            "commits_ahead": split.get("commits_ahead"),
            "identical_to_base": len(three["identical_to_base"]),
            "content_differs": len(three["content_differs"]),
            "only_on_head": len(three["only_on_head"]),
            "deleted_by_pr": len(three["deleted_by_pr"]),
            "two_dot_not_in_pr": sum(len(value) for value in outside.values()),
            "report_rows": reported["row_count"],
            "report_unique_lines": len(reported["unique_lines"]),
            "non_source_preview": len(previews),
            "non_source_changed": len([
                row for row in previews if row.get("head_lines") != row.get("base_lines")
            ]),
        },
        "history": history,
        "report": reported,
        "dimensions": dimension_cards(pack),
        "non_source_changed": changed,
    }
    if git_error:
        doc["git_error"] = git_error
    return doc, detail


def span_text(lines: list[str], ranges: list) -> str:
    picked: list[str] = []
    for pair in ranges or []:
        if not isinstance(pair, list) or len(pair) != 2:
            continue
        start, end = pair
        if not isinstance(start, int) or not isinstance(end, int):
            continue
        for number in range(start, end + 1):
            if 1 <= number <= len(lines):
                picked.append(lines[number - 1])
    return "\n".join(picked)


def pr_paths_from_detail(detail: dict) -> set[str] | None:
    """Paths still different from the base tip, or only on the PR.

    identical_to_base matches the current base tip and is not reviewable.
    None when git history was unavailable.
    """
    three = detail.get("three_dot")
    if not isinstance(three, dict):
        return None
    paths: set[str] = set()
    for key in ("content_differs", "only_on_head"):
        values = three.get(key) or []
        if not isinstance(values, list):
            return None
        paths.update(str(item) for item in values)
    return paths


def scope_ledger(pack: Path, repo: Path, detail: dict) -> None:
    """Drop branch-drift symbols from the business-rule queue and route rules.

    Drift symbols stay in the ledger as excluded, with reason branch_drift.
    In-scope symbols keep status pending and gain rule_plan. A missing ledger
    or an unavailable git split does not change the queue.
    """
    if detail.get("history_available") is False or detail.get("three_dot") is None:
        return
    pr_paths = pr_paths_from_detail(detail)
    if pr_paths is None:
        return
    ledger_path = pack / "24-coverage-ledger.json"
    if not ledger_path.is_file():
        return
    try:
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(ledger, dict):
        return
    symbols = ledger.get("symbols")
    if not isinstance(symbols, list):
        return
    line_cache: dict[str, list[str] | None] = {}

    def lines_for(rel: str) -> list[str] | None:
        if rel in line_cache:
            return line_cache[rel]
        full = repo / rel
        if not full.is_file():
            line_cache[rel] = None
            return None
        try:
            line_cache[rel] = full.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            line_cache[rel] = None
        return line_cache[rel]

    for row in symbols:
        if not isinstance(row, dict) or row.get("status") != "pending":
            continue
        rel = str(row.get("path") or "")
        if rel not in pr_paths:
            row["status"] = "excluded"
            row["reason"] = "branch_drift"
            row["review_scope"] = "branch_drift"
            continue
        row["review_scope"] = "pr_delta"
        text = None
        file_lines = lines_for(rel)
        if file_lines is not None:
            text = span_text(file_lines, row.get("ranges") or [])
        file_text = "\n".join(file_lines) if file_lines else None
        row["rule_plan"] = rule_plan(text, str(row.get("kind") or ""), file_text)
    by_id = {str(row.get("symbol_id")): row for row in symbols if isinstance(row, dict)}
    groups = []
    for group in ledger.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        ids = [
            symbol_id
            for symbol_id in group.get("symbol_ids") or []
            if by_id.get(str(symbol_id), {}).get("status") == "pending"
        ]
        if not ids:
            continue
        paths = []
        for symbol_id in ids:
            rel = str(by_id[str(symbol_id)].get("path") or "")
            if rel and rel not in paths:
                paths.append(rel)
        groups.append({"id": group.get("id"), "paths": paths, "symbol_ids": ids})
    ledger["read_groups"] = groups
    pending = sum(1 for row in symbols if isinstance(row, dict) and row.get("status") == "pending")
    excluded = sum(1 for row in symbols if isinstance(row, dict) and row.get("status") == "excluded")
    summary = ledger.get("summary")
    if isinstance(summary, dict):
        summary["pending"] = pending
        summary["excluded"] = excluded
        summary["branch_drift"] = sum(
            1 for row in symbols if isinstance(row, dict) and row.get("reason") == "branch_drift"
        )
        summary["read_groups"] = len(groups)
    notes = ledger.get("notes")
    if isinstance(notes, list):
        notes.append(
            "branch_drift symbols are outside the three-dot PR patch and are not "
            "given the business-rule list. pr_delta symbols carry rule_plan: "
            "start with applicable ids. A look_for that matches the method body "
            "is still filed when that id is absent from applicable. "
            "Skips are the recorded rule_coverage note. A skip is not a missing id."
        )
    write_atomic(ledger_path, ledger)


POLICY_KEYS = ("look_for", "do_not_report", "fix", "noncompliant", "compliant")
SUSPECT_GLOBS = (
    "13-privacy-signals.json",
    "14-resilience-signals.json",
    "15-rollout-signals.json",
    "16-observability-signals.json",
    "17-contract-signals.json",
    "18-maintainability-signals.json",
    "21-performance-signals.json",
    "23-sast-signals.json",
)
QUEUE_RADIUS = 8
QUEUE_MAX = 1200


def tight_slice(repo: Path, rel: str, line: int) -> str:
    full = repo / rel
    if not full.is_file():
        return ""
    try:
        lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return ""
    if not lines:
        return ""
    target = line if 1 <= line <= len(lines) else min(max(line, 1), len(lines))
    start = max(1, target - QUEUE_RADIUS)
    end = min(len(lines), target + QUEUE_RADIUS)
    rows = [(n, lines[n - 1]) for n in range(start, end + 1)]
    while rows and sum(len(text) + 8 for _, text in rows) > QUEUE_MAX and len(rows) > 1:
        if abs(rows[0][0] - target) >= abs(rows[-1][0] - target) and rows[0][0] != target:
            rows.pop(0)
        elif rows[-1][0] != target:
            rows.pop()
        else:
            rows.pop(0)
    return "\n".join(f"{n}|{text}" for n, text in rows)


def write_suspect_queue(pack: Path, repo: Path, detail: dict) -> None:
    """One small queue for the suspect pass. Signal files stay on disk."""
    if detail.get("history_available") is False:
        pr_paths = None
    else:
        pr_paths = pr_paths_from_detail(detail)
    policies: dict[str, dict] = {}
    packets: list[dict] = []
    sast_packets: list[dict] = []
    omitted = 0
    for filename in SUSPECT_GLOBS:
        path = pack / filename
        if not path.is_file():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(doc, dict):
            continue
        rows = doc.get("derive_suspects") or []
        sast_rows = doc.get("suspects") or [] if filename.startswith("23-") else []
        for row in list(rows) + list(sast_rows):
            if not isinstance(row, dict):
                continue
            rel = str(row.get("file") or row.get("path") or "")
            if pr_paths is not None and rel not in pr_paths:
                omitted += 1
                continue
            kind = str(row.get("kind") or row.get("pattern_class") or "")
            policy = row.get("policy") if isinstance(row.get("policy"), dict) else {}
            if kind and kind not in policies and policy:
                policies[kind] = {key: policy.get(key) or "" for key in POLICY_KEYS}
            line = int(row.get("line") or 1)
            sl = tight_slice(repo, rel, line)
            if not sl:
                sl = str(row.get("slice") or "")
            packet = {
                "source": filename,
                "file": rel,
                "line": line,
                "kind": kind,
                "slice": sl,
            }
            if row.get("derive_suspect_id"):
                packet["derive_suspect_id"] = row["derive_suspect_id"]
            if row.get("suspect_id"):
                packet["suspect_id"] = row["suspect_id"]
            if "bound_read" in row:
                packet["bound_read"] = row["bound_read"]
            if row.get("close"):
                packet["close"] = row["close"]
            if filename.startswith("23-"):
                sast_packets.append(packet)
            else:
                packets.append(packet)
    queue = {
        "kind": "SuspectQueue",
        "schema_version": 1,
        "generated_by": "build-review-digest.py",
        "read_this": (
            "The suspect pass reads only this file. Do not open the signal JSON. "
            "Packets left out are branch_drift and are not judged here; they remain "
            "in the signal files. A true positive is filed once per derive_suspect_id "
            "or suspect_id so every path is recorded. Policy text is keyed by kind."
        ),
        "omitted_branch_drift": omitted,
        "policies": policies,
        "packets": packets,
        "sast_packets": sast_packets,
    }
    write_atomic(pack / "27-suspect-queue.json", queue)


def _load(path: Path):
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _safe_id(symbol_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", symbol_id)


def _impact_dir(pack: Path, symbol_id: str) -> Path | None:
    safe = _safe_id(symbol_id)
    impact = pack / "impact"
    for cand in (impact / safe, impact / f"{safe}_", impact / symbol_id):
        if cand.is_dir():
            return cand
    if not impact.is_dir():
        return None
    for cand in impact.glob("*/edges-in.json"):
        name = cand.parent.name
        if name == safe or name.rstrip("_") == safe:
            return cand.parent
    return None


def _diff_doc(pack: Path, symbol_id: str) -> dict | None:
    safe = _safe_id(symbol_id)
    for cand in (
        pack / "diffs" / f"{safe}.diff.json",
        pack / "diffs" / f"{safe}_.diff.json",
    ):
        doc = _load(cand)
        if isinstance(doc, dict):
            return doc
    return None


def _callers(doc: dict | None) -> list[dict]:
    if not isinstance(doc, dict):
        return []
    edges = doc.get("edges") or []
    found = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        found.append({
            "from_file": edge.get("from_file") or "",
            "from_id": edge.get("from_id") or "",
            "kind": edge.get("kind") or "",
        })
        if len(found) >= 20:
            break
    return found


def _edge_count(doc: dict | None) -> int:
    if not isinstance(doc, dict):
        return 0
    edges = doc.get("edges")
    if isinstance(edges, list):
        return len(edges)
    result = doc.get("result")
    if isinstance(result, dict) and isinstance(result.get("edges"), list):
        return len(result["edges"])
    return 0


def write_symbol_bundle(pack: Path) -> None:
    """One read for closure rows plus sampled diffs and callers.

    The full ledger, diffs/, and impact/ stay on disk for the validator.
    """
    ledger = _load(pack / "24-coverage-ledger.json")
    if not isinstance(ledger, dict):
        return
    symbols = [row for row in ledger.get("symbols") or [] if isinstance(row, dict)]
    by_path: dict[str, str] = {}
    for row in symbols:
        rel = str(row.get("path") or "")
        if rel and rel not in by_path:
            by_path[rel] = str(row.get("review_scope") or "")
    skip_notes: dict[str, str] = {}
    pending = []
    for row in symbols:
        if row.get("status") != "pending":
            continue
        plan = row.get("rule_plan") if isinstance(row.get("rule_plan"), dict) else {}
        for skip in plan.get("skips") or []:
            if isinstance(skip, dict) and skip.get("rule_id"):
                skip_notes.setdefault(str(skip["rule_id"]), str(skip.get("note") or ""))
        item = {
            "symbol_id": row.get("symbol_id"),
            "name": row.get("name"),
            "kind": row.get("kind"),
            "path": row.get("path"),
            "start_line": row.get("start_line"),
            "end_line": row.get("end_line"),
            "ranges": row.get("ranges") or [],
            "read_group": row.get("read_group"),
            "review_scope": row.get("review_scope"),
            "applicable": list((plan.get("applicable") or [])),
            "skip_ids": [str(skip.get("rule_id")) for skip in (plan.get("skips") or []) if isinstance(skip, dict) and skip.get("rule_id")],
        }
        if row.get("span_hash"):
            item["span_hash"] = row["span_hash"]
        if row.get("span_check"):
            item["span_check"] = row["span_check"]
        pending.append(item)
    impacts = []
    diffs = pack / "diffs"
    if diffs.is_dir():
        for diff_path in sorted(diffs.glob("*.diff.json")):
            doc = _load(diff_path)
            if not isinstance(doc, dict):
                continue
            result = doc.get("result") if isinstance(doc.get("result"), dict) else doc
            symbol_id = diff_path.name
            if symbol_id.endswith("_.diff.json"):
                symbol_id = symbol_id[: -len("_.diff.json")]
            elif symbol_id.endswith(".diff.json"):
                symbol_id = symbol_id[: -len(".diff.json")]
            folder = _impact_dir(pack, symbol_id)
            callers = _callers(_load(folder / "edges-in.json") if folder else None)
            tests = _edge_count(_load(folder / "tests-reach.json") if folder else None)
            diff_text = str(result.get("diff") or "")
            truncated = False
            if len(diff_text) > 4000:
                diff_text = diff_text[:4000]
                truncated = True
            file_path = str(result.get("file_path") or "")
            impacts.append({
                "symbol_id": symbol_id,
                "name": result.get("node_name") or "",
                "file": file_path,
                "review_scope": by_path.get(file_path) or "unscoped",
                "diff": diff_text,
                "diff_truncated": truncated,
                "callers": callers,
                "tests_edge_count": tests,
                "diff_file": str(diff_path.relative_to(pack)),
            })
    bundle = {
        "kind": "SymbolBundle",
        "schema_version": 1,
        "generated_by": "build-review-digest.py",
        "read_this": (
            "When 29-judgment-packet.json exists, read that file instead. "
            "It inlines each read group's first path and the span hashes. "
            "Otherwise judgment reads this file for pending closure rows, rule routing, "
            "sampled symbol diffs, callers, and test-edge counts. Do not open "
            "diffs/, impact/, or 24-coverage-ledger.json unless a symbol is "
            "missing here. branch_drift impacts are not PR edits. "
            "Do not hand-copy span_hash; seal-conclusion.py fills coverage_closure. "
            "skip_notes explains skip_ids."
        ),
        "pending_count": len(pending),
        "skip_notes": skip_notes,
        "read_groups": [
            group for group in (ledger.get("read_groups") or []) if isinstance(group, dict)
        ],
        "pending": pending,
        "impacts": impacts,
    }
    write_atomic(pack / "28-symbol-bundle.json", bundle)


def main() -> int:
    parser = argparse.ArgumentParser(description="Write 26-review-digest.json")
    parser.add_argument("--dir", required=True, help="Evidence pack directory")
    parser.add_argument("--repo", required=True, help="Repository root")
    parser.add_argument("--diff-base", required=True, help="Base ref used by codexqa index")
    args = parser.parse_args()
    pack = Path(args.dir)
    if not pack.is_dir():
        print(f"error: pack dir missing: {pack}", file=sys.stderr)
        return 2
    doc, detail = build(pack, Path(args.repo), args.diff_base)
    write_atomic(pack / "26-review-digest.json", doc)
    write_atomic(pack / "26-review-digest-detail.json", detail)
    scope_ledger(pack, Path(args.repo), detail)
    write_suspect_queue(pack, Path(args.repo), detail)
    write_symbol_bundle(pack)
    packet_path = Path(__file__).resolve().parent / "build-judgment-packet.py"
    spec = importlib.util.spec_from_file_location("build_judgment_packet", packet_path)
    if spec is not None and spec.loader is not None:
        packet_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(packet_mod)
        packet_mod.write(pack, Path(args.repo))
    counts = doc["counts"]
    print(
        "Review digest written: "
        f"behind={counts['commits_behind']} ahead={counts['commits_ahead']} "
        f"identical={counts['identical_to_base']} "
        f"differs={counts['content_differs']} "
        f"only_on_head={counts['only_on_head']} "
        f"report_rows={counts['report_rows']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
