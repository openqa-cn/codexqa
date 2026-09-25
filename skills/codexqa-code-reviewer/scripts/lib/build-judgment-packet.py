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
import re
import subprocess
import sys
from pathlib import Path

RULE_FIELDS = ("look_for", "do_not_report")

MAX_SOURCE_LINES = 400
PLAN_FILE_LINES = 50
PLAN_GROUP_LINES = 100
METHOD_GROUP_SIZE = 12
SUSPECT_GROUP_CAP = 10
# A method of this length stays one slice so a 60-line checklist fixture is unchanged.
# Anything longer is cut into METHOD_WINDOW_LINES windows. A 79-line method
# such as submitTransfer therefore becomes two groups instead of one long write.
METHOD_WINDOW_TRIGGER = 60
METHOD_WINDOW_LINES = 40
GROUP_READ_THIS = (
    "Read only this file. Rules and skip notes for this group are in this file. "
    "Do not open shared.json, another judgment-work file, judgment-groups, "
    "or the source tree. Place every required_suspect_ids id and write this "
    "group's result before adding more findings."
)
MAX_NEIGHBOR_PATHS = 10
HUNK_CONTEXT = 8
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
    """Files the PR still differs from the base tip, or adds.

    identical_to_base matches the current base tip. Those paths are not a
    reviewable edit, even when an older commit on the branch touched them.
    """
    three = detail.get("three_dot") if isinstance(detail, dict) else None
    if not isinstance(three, dict):
        return None
    paths: set[str] = set()
    for key in ("content_differs", "only_on_head"):
        values = three.get(key) or []
        if not isinstance(values, list):
            return None
        paths.update(str(item) for item in values)
    return paths


def skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_rule_policies(root: Path | None = None) -> dict[str, dict[str, str]]:
    """Decision text for business rules. Only these two fields are the judgment."""
    path = (root or skill_root()) / "references" / "business-rule-records.md"
    if not path.is_file():
        return {}
    policies: dict[str, dict[str, str]] = {}
    current = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        heading = re.match(r"^##\s+([A-Z]+-\d+)\s*$", line.strip())
        if heading:
            current = heading.group(1)
            policies[current] = {}
            continue
        if not current:
            continue
        for field in RULE_FIELDS:
            prefix = f"- {field}:"
            if line.startswith(prefix):
                policies[current][field] = line.split(":", 1)[1].strip()
    return policies


def rules_for(ids: list[str], policies: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """Keep catalog order, drop ids that are not applicable or have no record."""
    selected: dict[str, dict[str, str]] = {}
    for rule_id in ids:
        policy = policies.get(rule_id)
        if policy and policy.get("look_for") and policy.get("do_not_report"):
            selected[rule_id] = {
                "look_for": policy["look_for"],
                "do_not_report": policy["do_not_report"],
            }
    return selected


def applicable_ids(pending: list[dict]) -> list[str]:
    found: list[str] = []
    for row in pending:
        if not isinstance(row, dict):
            continue
        for rule_id in row.get("applicable") or []:
            text = str(rule_id)
            if text and text not in found:
                found.append(text)
    return found


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
        kind = str(row.get("kind") or row.get("rule_id") or row.get("pattern_class") or "")
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


def numbered_span(lines: list[str], start: int, end: int) -> tuple[str, bool]:
    start = max(1, start)
    end = min(len(lines), end)
    cut = False
    if end - start + 1 > MAX_SOURCE_LINES:
        end = start + MAX_SOURCE_LINES - 1
        cut = True
    body = "\n".join(f"{n}|{lines[n - 1]}" for n in range(start, end + 1))
    return body, cut


def symbol_ranges(row: dict) -> list[tuple[int, int]]:
    ranges = []
    for pair in row.get("ranges") or []:
        if (
            isinstance(pair, list)
            and len(pair) == 2
            and isinstance(pair[0], int)
            and isinstance(pair[1], int)
            and pair[1] >= pair[0]
        ):
            ranges.append((pair[0], pair[1]))
    if ranges:
        return ranges
    start = row.get("start_line")
    end = row.get("end_line")
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        return [(start, end)]
    return []


def parse_added_lines(diff_text: str) -> dict[str, set[int]]:
    """Added line numbers from a unified diff. A zero-length hunk adds nothing."""
    files: dict[str, set[int]] = {}
    current = ""
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
            files.setdefault(current, set())
            continue
        if not current or not line.startswith("@@"):
            continue
        match = re.search(r"\+(\d+)(?:,(\d+))?", line)
        if not match:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        if count <= 0:
            continue
        files[current].update(range(start, start + count))
    return files


def three_dot_changed_lines(repo: Path, diff_base: str) -> dict[str, set[int]] | None:
    """None when git cannot show the patch. Callers then keep the full span."""
    if not diff_base or not repo.is_dir():
        return None
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), "diff", "-U0", "--no-color", f"{diff_base}...HEAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return parse_added_lines(proc.stdout)


def merge_windows(windows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not windows:
        return []
    ordered = sorted(windows)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end + 1:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def focus_ranges(
    kind: str,
    ranges: list[tuple[int, int]],
    changed: set[int] | None,
    nlines: int,
) -> list[tuple[int, int]]:
    """A touched function stays whole. Untouched lines of a file stay out.

    changed is None only when the patch could not be read: keep every range.
    """
    if changed is None:
        return ranges
    if kind == "file_scope":
        windows = []
        for line in changed:
            if not any(start <= line <= end for start, end in ranges):
                continue
            windows.append((max(1, line - HUNK_CONTEXT), min(nlines, line + HUNK_CONTEXT)))
        return merge_windows(windows)
    return [
        (start, end)
        for start, end in ranges
        if any(start <= line <= end for line in changed)
    ]


def symbol_slices(
    lines: list[str],
    symbol_ids: list,
    pending_by_id: dict,
    changed: set[int] | None = None,
) -> tuple[list[dict], bool]:
    slices = []
    truncated = False
    for symbol_id in symbol_ids:
        row = pending_by_id.get(str(symbol_id)) or {}
        parts = []
        cut = False
        ranges = focus_ranges(
            str(row.get("kind") or ""),
            symbol_ranges(row),
            changed,
            len(lines),
        )
        for start, end in ranges:
            body, part_cut = numbered_span(lines, start, end)
            cut = cut or part_cut
            if body:
                parts.append(body)
        if not parts:
            continue
        slices.append({
            "symbol_id": symbol_id,
            "start_line": row.get("start_line"),
            "end_line": row.get("end_line"),
            "text": "\n".join(parts),
            "truncated": cut,
        })
        truncated = truncated or cut
    return slices, truncated


def read_groups(repo: Path, bundle: dict, changed_lines: dict[str, set[int]] | None = None) -> list[dict]:
    pending_by_id = {}
    for row in bundle.get("pending") or []:
        if isinstance(row, dict) and row.get("symbol_id"):
            pending_by_id[str(row["symbol_id"])] = row
    groups = []
    for group in bundle.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        paths = [str(item) for item in (group.get("paths") or [])]
        symbol_ids = list(group.get("symbol_ids") or [])
        text, truncated = ("", False)
        slices: list[dict] = []
        if paths:
            full = repo / paths[0]
            lines: list[str] = []
            if full.is_file():
                try:
                    lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
                except OSError:
                    lines = []
            changed = None if changed_lines is None else changed_lines.get(paths[0], set())
            if lines and (len(lines) > MAX_SOURCE_LINES or changed_lines is not None):
                # A known patch limits the slice to touched functions and hunk context.
                # An unknown patch on a long file still slices by symbol, not past the cap.
                slices, truncated = symbol_slices(lines, symbol_ids, pending_by_id, changed)
                text = ""
            else:
                text, truncated = source_text(repo, paths[0])
        item = {
            "id": group.get("id"),
            "paths": paths,
            "opened": paths[0] if paths else "",
            "symbol_ids": symbol_ids,
            "text": text,
            "truncated": truncated,
        }
        if slices:
            item["slices"] = slices
        groups.append(item)
    return groups


def line_set(row: dict) -> set[int]:
    """Unique source lines. Overlapping symbols in one file are not added twice."""
    start = row.get("start_line")
    end = row.get("end_line")
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        return set(range(start, end + 1))
    found: set[int] = set()
    for pair in row.get("ranges") or []:
        if (
            isinstance(pair, list)
            and len(pair) == 2
            and isinstance(pair[0], int)
            and isinstance(pair[1], int)
            and pair[1] >= pair[0]
        ):
            found.update(range(pair[0], pair[1] + 1))
    return found


def plan_required(pending: list[dict]) -> bool:
    """Packet-level flag: one large file, or several files that add up.

    A method-split group does not use this flag. group_plan_required is the
    checklist for that group, and it is true only for a large method.
    """
    by_path: dict[str, set[int]] = {}
    for row in pending:
        path = str(row.get("path") or row.get("symbol_id") or "")
        by_path.setdefault(path, set()).update(line_set(row))
    counts = [len(lines) for lines in by_path.values()]
    if not counts:
        return False
    if max(counts) >= PLAN_FILE_LINES:
        return True
    return len(counts) >= 2 and sum(counts) >= PLAN_GROUP_LINES


def group_plan_required(rows: list[dict]) -> bool:
    """Checklist only when one method in the group is itself large."""
    return any(len(line_set(row)) >= PLAN_FILE_LINES for row in rows)


def suspect_points(suspects: dict | None) -> list[tuple[str, int]]:
    points = []
    if not isinstance(suspects, dict):
        return points
    for key in ("packets", "sast_packets"):
        for row in suspects.get(key) or []:
            if isinstance(row, dict) and isinstance(row.get("line"), int):
                points.append((str(row.get("file") or ""), int(row["line"])))
    return points


def same_path(suspect_file: str, paths: list[str]) -> bool:
    if not paths or not suspect_file:
        return True
    for path in paths:
        if (
            suspect_file == path
            or path.endswith("/" + suspect_file)
            or suspect_file.endswith("/" + path)
        ):
            return True
    return False


def slice_bounds(sl: dict, row: dict) -> tuple[int | None, int | None]:
    start = row.get("start_line") if isinstance(row.get("start_line"), int) else sl.get("start_line")
    end = row.get("end_line") if isinstance(row.get("end_line"), int) else sl.get("end_line")
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        return start, end
    return None, None


def count_suspects(paths: list[str], start: int | None, end: int | None, points: list[tuple[str, int]]) -> int:
    if not isinstance(start, int) or not isinstance(end, int):
        return 0
    return sum(1 for rel, line in points if same_path(rel, paths) and start <= line <= end)


def clip_slice(sl: dict, start: int, end: int) -> dict:
    kept = []
    for line in str(sl.get("text") or "").splitlines():
        head = line.split("|", 1)[0]
        if head.isdigit() and start <= int(head) <= end:
            kept.append(line)
    out = {
        "symbol_id": sl.get("symbol_id"),
        "start_line": start,
        "end_line": end,
        "text": "\n".join(kept),
    }
    if sl.get("truncated"):
        out["truncated"] = True
    return out


def suspect_windows(paths: list[str], start: int, end: int, points: list[tuple[str, int]]) -> list[tuple[int, int]]:
    """Cut a span so each piece holds at most SUSPECT_GROUP_CAP suspect lines.

    Suspects that share one line stay together. A span already under the cap
    is unchanged.
    """
    lines = sorted(line for rel, line in points if same_path(rel, paths) and start <= line <= end)
    if len(lines) <= SUSPECT_GROUP_CAP:
        return [(start, end)]
    spans: list[tuple[int, int]] = []
    for index in range(0, len(lines), SUSPECT_GROUP_CAP):
        chunk = lines[index:index + SUSPECT_GROUP_CAP]
        w_start = start if not spans else spans[-1][1] + 1
        more = index + SUSPECT_GROUP_CAP < len(lines)
        w_end = chunk[-1] if more else end
        if w_start > w_end:
            continue
        spans.append((w_start, w_end))
    return spans or [(start, end)]


def windows_for(
    sl: dict,
    row: dict,
    paths: list[str],
    points: list[tuple[str, int]],
) -> list[tuple[dict, bool]]:
    """One method becomes line windows when it is long or holds too many suspects."""
    start, end = slice_bounds(sl, row)
    if start is None or end is None:
        return [(sl, False)]
    spans = [(start, end)]
    if end - start + 1 > METHOD_WINDOW_TRIGGER:
        spans = []
        cursor = start
        while cursor <= end:
            w_end = min(end, cursor + METHOD_WINDOW_LINES - 1)
            spans.append((cursor, w_end))
            cursor = w_end + 1
    refined: list[tuple[int, int]] = []
    for w_start, w_end in spans:
        refined.extend(suspect_windows(paths, w_start, w_end, points))
    parts = []
    for w_start, w_end in refined:
        if len(refined) == 1 and w_start == start and w_end == end:
            piece = sl
        else:
            piece = clip_slice(sl, w_start, w_end)
        parts.append((piece, (w_end - w_start + 1) >= PLAN_FILE_LINES))
    return parts


def split_method_groups(
    groups: list[dict],
    pending: list[dict],
    suspects: dict | None = None,
) -> list[dict]:
    """Split one file's method slices into concurrent groups.

    A method of PLAN_FILE_LINES or more is its own group and keeps the
    checklist. A method longer than METHOD_WINDOW_TRIGGER lines is cut into
    METHOD_WINDOW_LINES-line windows. Any method
    whose suspect lines exceed SUSPECT_GROUP_CAP, is cut into line windows.
    Shorter methods stay in source order, at most METHOD_GROUP_SIZE per
    group and at most SUSPECT_GROUP_CAP suspect lines, with the checklist
    off. Identical-copy paths stay on every child. A single chunk is left
    as the original group so a short file does not change ids. file_scope
    text is not copied again; the method slices are the read, and the
    file_scope id hangs on the first child.
    """
    points = suspect_points(suspects)
    by_id = {
        str(row.get("symbol_id")): row
        for row in pending
        if isinstance(row, dict) and row.get("symbol_id")
    }
    out: list[dict] = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        slices = [item for item in (group.get("slices") or []) if isinstance(item, dict)]
        methods = []
        scopes = []
        for sl in slices:
            row = by_id.get(str(sl.get("symbol_id") or "")) or {}
            if str(row.get("kind") or "") == "file_scope":
                scopes.append(sl)
            else:
                methods.append((sl, row))
        paths = list(group.get("paths") or [])
        large = [
            item for item in methods
            if len(line_set(item[1])) >= PLAN_FILE_LINES
        ]
        small = [
            item for item in methods
            if len(line_set(item[1])) < PLAN_FILE_LINES
        ]
        chunks: list[tuple[str, list, bool]] = []
        for index, item in enumerate(large):
            sl, row = item
            parts = windows_for(sl, row, paths, points)
            for part_index, (piece, plan) in enumerate(parts):
                tag = f"large-{index}" if len(parts) == 1 else f"large-{index}-w{part_index}"
                chunks.append((tag, [(piece, row)], plan))
        current: list[tuple[dict, dict]] = []
        current_n = 0
        rest_index = 0

        def flush_small() -> None:
            nonlocal current, current_n, rest_index
            if not current:
                return
            chunks.append((f"rest-{rest_index}", current, False))
            rest_index += 1
            current = []
            current_n = 0

        for item in small:
            sl, row = item
            start, end = slice_bounds(sl, row)
            owned = count_suspects(paths, start, end, points)
            if owned > SUSPECT_GROUP_CAP:
                flush_small()
                parts = windows_for(sl, row, paths, points)
                for part_index, (piece, plan) in enumerate(parts):
                    tag = f"rest-{rest_index}" if len(parts) == 1 else f"rest-{rest_index}-w{part_index}"
                    chunks.append((tag, [(piece, row)], plan))
                rest_index += 1
                continue
            if current and (
                len(current) >= METHOD_GROUP_SIZE or current_n + owned > SUSPECT_GROUP_CAP
            ):
                flush_small()
            current.append(item)
            current_n += owned
        flush_small()
        if len(chunks) < 2:
            out.append(group)
            continue
        parent = str(group.get("id") or "group")
        opened = str(group.get("opened") or (paths[0] if paths else ""))
        first = True
        for tag, items, plan in chunks:
            ids = [str(sl.get("symbol_id")) for sl, _row in items if sl.get("symbol_id")]
            child_slices = [sl for sl, _row in items]
            if first and scopes:
                for sl in scopes:
                    sid = str(sl.get("symbol_id") or "")
                    if sid:
                        ids.append(sid)
                    child_slices.append({
                        "symbol_id": sl.get("symbol_id"),
                        "start_line": sl.get("start_line"),
                        "end_line": sl.get("end_line"),
                        "covered_by_methods": True,
                    })
                first = False
            out.append({
                "id": f"{parent}#{tag}",
                "paths": paths,
                "opened": opened,
                "symbol_ids": ids,
                "text": "",
                "truncated": any(bool(sl.get("truncated")) for sl in child_slices),
                "slices": child_slices,
                "method_split": True,
                "plan_required": plan,
            })
    return out


def attach_uncovered_lines(groups: list[dict], repo: Path) -> None:
    """Keep field declarations that sit outside every method.

    file_scope is marked covered_by_methods and has no text, so a line such as
    a shared map never reaches a group. Those lines are attached, capped, to
    the first group of that file.
    """
    by_path: dict[str, list[dict]] = {}
    covered: dict[str, set[int]] = {}
    for group in groups:
        path = str(group.get("opened") or "")
        if not path:
            continue
        by_path.setdefault(path, []).append(group)
        for sl in group.get("slices") or []:
            if not isinstance(sl, dict) or sl.get("covered_by_methods"):
                continue
            start, end = sl.get("start_line"), sl.get("end_line")
            if isinstance(start, int) and isinstance(end, int):
                covered.setdefault(path, set()).update(range(start, end + 1))
    for path, owners in by_path.items():
        full = repo / path
        if not full.is_file():
            continue
        try:
            lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        taken = covered.get(path, set())
        picked = []
        for number, text in enumerate(lines, 1):
            if number in taken or not text.strip():
                continue
            if not re.search(r"(=|synchronized\s*\(|\bnew\b)", text):
                continue
            picked.append(f"{number}|{text}")
            if len(picked) >= 40:
                break
        if not picked:
            continue
        owners[0].setdefault("slices", []).append({
            "symbol_id": "uncovered:" + path,
            "start_line": None,
            "end_line": None,
            "text": "\n".join(picked),
            "uncovered_fields": True,
        })


_LOCK = re.compile(r"synchronized\s*\(\s*(\w+)\s*\)")


def cross_method_notes(groups: list[dict]) -> list[dict]:
    """Two methods that take the same locks in opposite orders.

    Windows of one method are merged before the order is compared, so a
    line-window split does not drop a lock that sits in a later window.
    """
    merged: dict[str, dict] = {}
    for group in groups:
        gid = str(group.get("id") or "")
        for sl in group.get("slices") or []:
            if not isinstance(sl, dict) or sl.get("covered_by_methods"):
                continue
            locks = []
            for line in str(sl.get("text") or "").splitlines():
                match = _LOCK.search(line)
                if match and match.group(1) not in locks:
                    locks.append(match.group(1))
            if not locks:
                continue
            sid = str(sl.get("symbol_id") or "")
            slot = merged.setdefault(sid, {"locks": [], "groups": []})
            for lock in locks:
                if lock not in slot["locks"]:
                    slot["locks"].append(lock)
            if gid and gid not in slot["groups"]:
                slot["groups"].append(gid)
    sites = [
        (sid, slot["groups"], slot["locks"])
        for sid, slot in merged.items()
        if len(slot["locks"]) >= 2
    ]
    notes = []
    for left in range(len(sites)):
        for right in range(left + 1, len(sites)):
            a_id, a_groups, a_locks = sites[left]
            b_id, b_groups, b_locks = sites[right]
            if a_locks == list(reversed(b_locks)):
                notes.append({
                    "kind": "lock_order",
                    "symbol_ids": [a_id, b_id],
                    "read_groups": a_groups + [item for item in b_groups if item not in a_groups],
                    "orders": [a_locks, b_locks],
                })
    return notes


def repoint_pending(pending: list[dict], groups: list[dict]) -> None:
    owner: dict[str, str] = {}
    for group in groups:
        gid = str(group.get("id") or "")
        for sid in group.get("symbol_ids") or []:
            owner[str(sid)] = gid
    for row in pending:
        sid = str(row.get("symbol_id") or "")
        if sid in owner:
            row["read_group"] = owner[sid]


def attach_slice_refs(packet: dict) -> None:
    """Point a suspect at the method slice that already contains its line.

    The slice text stays on the read group. A line that no method slice
    covers keeps the queue excerpt; that excerpt is the only copy.
    """
    index = []
    for group in packet.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        paths = [str(item) for item in (group.get("paths") or [])]
        gid = group.get("id")
        for sl in group.get("slices") or []:
            if not isinstance(sl, dict) or sl.get("covered_by_methods"):
                continue
            start = sl.get("start_line")
            end = sl.get("end_line")
            if not isinstance(start, int) or not isinstance(end, int) or end < start:
                continue
            index.append((paths, start, end, sl.get("symbol_id"), gid, end - start))
    suspects = packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {}
    for key in ("packets", "sast_packets"):
        for row in suspects.get(key) or []:
            if not isinstance(row, dict) or not isinstance(row.get("line"), int):
                continue
            rel = str(row.get("file") or "")
            line = int(row["line"])
            matches = [
                item for item in index
                if (not item[0] or rel in item[0]) and item[1] <= line <= item[2]
            ]
            if not matches:
                continue
            matches.sort(key=lambda item: item[5])
            _paths, start, end, sid, gid, _span = matches[0]
            row["slice_ref"] = {
                "symbol_id": sid,
                "read_group": gid,
                "start_line": start,
                "end_line": end,
            }
            row.pop("slice", None)


def neighbor_groups(repo: Path, impacts: list[dict]) -> list[dict]:
    groups = []
    for impact in impacts:
        paths: list[str] = []
        own = str(impact.get("file") or "")
        for caller in impact.get("callers") or []:
            if not isinstance(caller, dict):
                continue
            rel = str(caller.get("from_file") or "").strip()
            if not rel or rel == own or rel in paths:
                continue
            paths.append(rel)
            if len(paths) >= MAX_NEIGHBOR_PATHS:
                break
        if not paths:
            continue
        texts = []
        truncated = False
        for rel in paths:
            text, cut = source_text(repo, rel)
            truncated = truncated or cut
            if text:
                texts.append(text)
        groups.append({
            "symbol_id": impact.get("symbol_id"),
            "file": own,
            "paths": paths,
            "text": "\n".join(texts),
            "truncated": truncated,
        })
    return groups


def stamp_independent(groups: list[dict], neighbors: list[dict]) -> None:
    """File groups that share a path or a caller edge stay in order.

    Method-split groups of one file always run concurrently. Linking them by
    the shared path, or by a caller of that file, would collapse the split
    back into one serial read.
    """
    edges: set[tuple[str, str]] = set()
    for group in neighbors:
        src = str(group.get("file") or "")
        for path in group.get("paths") or []:
            other = str(path)
            edges.add((src, other))
            edges.add((other, src))
    method = {index for index, group in enumerate(groups) if group.get("method_split")}
    for index in method:
        groups[index]["independent"] = True
    rest = [index for index in range(len(groups)) if index not in method]
    paths = [set(group.get("paths") or []) for group in groups]
    linked: set[int] = set()
    for left_i, left in enumerate(rest):
        for right in rest[left_i + 1:]:
            left_paths = paths[left]
            right_paths = paths[right]
            if left_paths & right_paths or any(
                (src, dst) in edges for src in left_paths for dst in right_paths
            ):
                linked.add(left)
                linked.add(right)
    for index, group in enumerate(groups):
        if index in method:
            continue
        group["independent"] = index not in linked


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
            "Read this file once for counts, rules, and report rows. "
            "When judgment-work/group-*.json exists, source text is only there; "
            "do not read it again from this file. "
            "Do not open 01-28, diffs/, impact/, signal JSON, or git. "
            "A touched function is included whole. A file_scope slice is the "
            "changed lines plus context. An untouched function is omitted. "
            "When slices is present, that slice is the whole read. "
            "A slice with covered_by_methods has no text; the method slices "
            "of that file are the read. uncovered_fields lists declarations "
            "between methods. cross_method lists lock orders that disagree. "
            "Do not open paths after the first. A truncated slice is the "
            "whole read: do not open the source file to fill the rest. "
            "neighbor_groups are caller files already inlined. "
            "Method-split groups of one file are independent and judged "
            "concurrently from judgment-work/group-*.json. "
            "A group's plan_required is true only when that group has a "
            "method of at least 50 lines. Other groups skip the checklist. "
            "Short methods are packed at most 12 per group and at most 10 "
            "suspect lines. A method longer than 60 lines is cut into "
            "40-line windows. One method with more than 10 suspect lines "
            "is also cut into line windows. "
            "Each judgment-work group file contains its own rules. "
            "Do not open shared.json or another group's file from that pass. "
            "A finding line must fall inside that window. "
            "The packet plan_required flag applies only when judgment-work "
            "is absent. "
            "A suspect with slice_ref has no source text. The read-group "
            "slice with the same symbol_id is the source. "
            "independent groups need no registry order; the rule list is once. "
            "Judge report.pr_delta and suspects.packets. "
            "identical_to_base matches the current base tip and is not a defect. "
            "plan_required only means the packet is large; it does not make "
            "every file an open defect question. Ask that question only when "
            "tier is T0 from an auth, pay, migration, or IaC path. "
            "A keyword hit in csv, markdown, or txt is not that path. "
            "Confirmed magic_number hits are conventions, not P1. "
            "report.branch_drift is cited at render time. "
            "Non-source samples are not symbols. "
            "rules{} is the business-rule text for applicable ids only. "
            "Do not open business-rule-records.md, the channel prompts, "
            "pr-diff-review steps 1-14, or seal-conclusion.py. "
            "skip_notes are the recorded skips; do not re-read those rules."
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
        "semantic_candidates": semantic_rows(pack),
        "skip_notes": bundle.get("skip_notes") or {},
        "rules": rules_for(applicable_ids(pending), load_rule_policies()),
        "pending": pending,
        "plan_required": plan_required(pending),
        "neighbor_groups": neighbor_groups(repo, impacts),
        "impacts_pr_delta": impacts,
    }
    packet["read_groups"] = split_method_groups(
        read_groups(
            repo,
            bundle if isinstance(bundle, dict) else {},
            three_dot_changed_lines(repo, str(digest.get("diff_base") or "")),
        ),
        pending,
        packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {},
    )
    attach_uncovered_lines(packet["read_groups"], repo)
    packet["cross_method"] = cross_method_notes(packet["read_groups"])
    repoint_pending(pending, packet["read_groups"])
    stamp_independent(packet["read_groups"], packet["neighbor_groups"])
    attach_slice_refs(packet)
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


def semantic_rows(pack: Path) -> list[dict]:
    """Rows the semantic pass used to re-open signal files to find."""
    specs = (
        ("17-contract-signals.json", "error_payload_candidates"),
        ("15-rollout-signals.json", "opaque_status_candidates"),
    )
    rows: list[dict] = []
    for filename, key in specs:
        doc = load_json(pack / filename)
        if not isinstance(doc, dict):
            continue
        for row in doc.get(key) or []:
            if not isinstance(row, dict):
                continue
            rows.append({
                "kind": key,
                "file": row.get("path") or row.get("file"),
                "line": row.get("line"),
                "name": row.get("name") or row.get("symbol"),
                "snippet": str(row.get("snippet") or row.get("text") or row.get("message") or "")[:180],
            })
            if len(rows) >= 40:
                return rows
    return rows


def group_symbol_rows(group: dict, by_symbol: dict[str, dict]) -> list[dict]:
    rows = []
    for symbol_id in group.get("symbol_ids") or []:
        row = by_symbol.get(str(symbol_id))
        if row:
            rows.append(row)
    return rows


def suspects_for_group(suspects: dict, group: dict) -> dict:
    """Suspects whose line falls in this group's slices.

    A windowed method keeps one symbol id on every window. The line, not the
    symbol id, decides which window owns the suspect. Source stays on the slice.
    """
    ranges = []
    for sl in group.get("slices") or []:
        if not isinstance(sl, dict) or sl.get("covered_by_methods"):
            continue
        start, end = sl.get("start_line"), sl.get("end_line")
        if isinstance(start, int) and isinstance(end, int) and end >= start:
            ranges.append((start, end, str(sl.get("symbol_id") or "")))
    ids = {str(item) for item in (group.get("symbol_ids") or [])}

    def take(rows: list) -> list:
        kept = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            ref = row.get("slice_ref") if isinstance(row.get("slice_ref"), dict) else {}
            sid = str(ref.get("symbol_id") or "")
            line = row.get("line")
            if isinstance(line, int) and ranges:
                if any(start <= line <= end and (not sid or symbol == sid) for start, end, symbol in ranges):
                    kept.append(row)
                continue
            if sid and sid in ids:
                kept.append(row)
        return kept

    return {
        "policies": suspects.get("policies") or {},
        "packets": take(suspects.get("packets") or []),
        "sast_packets": take(suspects.get("sast_packets") or []),
    }


def split_work(pack: Path, packet: dict) -> int:
    """Write one work file per independent read group so those groups can be judged concurrently."""
    groups = [row for row in (packet.get("read_groups") or []) if isinstance(row, dict)]
    independent = [row for row in groups if row.get("independent") is True]
    if len(independent) < 2:
        return 0
    work = pack / "judgment-work"
    work.mkdir(exist_ok=True)
    shared_groups = [row for row in groups if row.get("independent") is not True]
    policies = packet.get("rules") if isinstance(packet.get("rules"), dict) else {}
    pending = [row for row in (packet.get("pending") or []) if isinstance(row, dict)]
    by_symbol = {str(row.get("symbol_id")): row for row in pending}
    suspects = packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {}
    method_split = any(row.get("method_split") for row in groups)

    def group_rules(group: dict) -> dict:
        ids: list[str] = []
        for symbol_id in group.get("symbol_ids") or []:
            row = by_symbol.get(str(symbol_id))
            if not row:
                continue
            for rule_id in row.get("applicable") or []:
                text = str(rule_id)
                if text not in ids:
                    ids.append(text)
        return rules_for(ids, policies)

    def group_plan(group: dict) -> bool:
        if "plan_required" in group:
            return bool(group.get("plan_required"))
        return group_plan_required(group_symbol_rows(group, by_symbol))

    tier = packet.get("risk_tier") if isinstance(packet.get("risk_tier"), dict) else {}
    open_question = str(tier.get("tier") or "") == "T0"
    write_json(work / "shared.json", {
        "read_groups": shared_groups,
        "rules": policies,
        "skip_notes": packet.get("skip_notes") or {},
        "suspects": suspects,
        "semantic_candidates": packet.get("semantic_candidates") or [],
        "plan_required": False if method_split else packet.get("plan_required"),
        "open_question": open_question,
        "risk_tier": tier,
        "cross_method": packet.get("cross_method") or [],
        "neighbor_groups": packet.get("neighbor_groups") or [],
    })
    located: dict[str, str] = {}
    for index, group in enumerate(independent):
        name = f"judgment-work/group-{index}.json"
        located[str(group.get("id") or "")] = name
        owned = suspects_for_group(suspects, group)
        rules = group_rules(group)
        notes = packet.get("skip_notes") if isinstance(packet.get("skip_notes"), dict) else {}
        write_json(work / f"group-{index}.json", {
            "read_this": GROUP_READ_THIS,
            "read_groups": [group],
            "rules": rules,
            "skip_notes": {key: notes[key] for key in rules if key in notes},
            "rule_ids": list(rules),
            "plan_required": group_plan(group),
            "open_question": open_question,
            "suspects": owned,
            "required_suspect_ids": [
                str(row.get("derive_suspect_id") or row.get("suspect_id"))
                for row in (owned.get("packets") or []) + (owned.get("sast_packets") or [])
                if isinstance(row, dict) and (row.get("derive_suspect_id") or row.get("suspect_id"))
            ],
            "neighbor_groups": [
                row for row in (packet.get("neighbor_groups") or [])
                if str(row.get("file") or "") in set(group.get("paths") or [])
            ],
        })
    for group in packet.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        body = located.get(str(group.get("id") or ""))
        if not body:
            continue
        group["body"] = body
        group["text"] = ""
        group.pop("slices", None)
    return len(independent)


def write(pack: Path, repo: Path) -> None:
    packet, skeleton = build(pack, repo)
    work_groups = split_work(pack, packet)
    write_json(pack / "29-judgment-packet.json", packet)
    write_json(pack / "30-conclusion-skeleton.json", skeleton)
    print(
        "Judgment packet written: "
        f"groups={len(packet['read_groups'])} "
        f"work_groups={work_groups} "
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
