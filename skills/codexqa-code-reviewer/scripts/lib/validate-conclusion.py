#!/usr/bin/env python3
"""Block REVIEW-REPORT.html unless the conclusion closes the pack.

Three generic gates, independent of any one repository:

1. Line ledger. Every behavioral signal or SAST row with disposition "report"
   must be a finding's primary line, or an also_lines entry with same_fix.
   A number written only in prose does not close the row. One finding cannot
   close two rule_id or pattern_class values. Magic numbers, long files, and
   stale imports close in conventions, not in p0/p1/p2. A sentence that
   defers a defect to another card must name a line that some finding lists.
2. Test oracle. Each inventory row answers three defect questions. Skip is
   legal only when all three answers are no.
3. Set difference. Production symbols with no accepted test edge must be
   listed or waived. A rule whose look-for has more than one shape must
   record every shape; the first hit does not close the rest.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

SIGNAL_GLOBS = (
    "1*-*signals.json",
    "2*-*signals.json",
)
SKIP_KEYS = {
    "derive_suspects",
    "triage",
    "notes",
    "evidence_refs",
    "thresholds",
    "confidence_caps",
    "summary",
    "surfaces",
    "llm_report_policy",
}

DEFER = re.compile(
    r"已由[^。\n]{0,80}覆盖|另记|不并入本卡|不单列|already covered|covered by another",
    re.I,
)
RANGE = re.compile(
    r"(?:第\s*)?(\d{1,6})\s*[–\-—~到至]\s*(\d{1,6})\s*行"
    r"|lines?\s+(\d{1,6})\s*[–\-—~]\s*(\d{1,6})",
    re.I,
)
ENUM = re.compile(
    r"(?:第\s*)(\d{1,6}(?:\s*[、,，和与]\s*\d{1,6})+)\s*行"
    r"|lines?\s+(\d{1,6}(?:\s*[,，、]\s*\d{1,6})+)",
    re.I,
)
# "行：86、167" and "行：149（说明）、178、513" until the sentence ends.
ROW_COLON = re.compile(r"行[:：]([^。\n]{0,220})")
SINGLE = re.compile(
    r"第\s*(\d{1,6})\s*行|(?:(?<=\s)|^)L(\d{1,6})\b|line\s+(\d{1,6})\b|:(\d{1,6})\b",
    re.I,
)

ORACLE_KEYS = ("unsafe_pass", "boundary_missed", "branch_uncovered")
NONE_WORDS = {"", "none", "无"}
CONVENTION_KINDS = {"magic_number", "long_file", "eol_import"}


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def walk_report_rows(node, out: list[dict]) -> None:
    if isinstance(node, dict):
        if node.get("disposition") == "report" and isinstance(node.get("line"), int):
            out.append(node)
        for key, child in node.items():
            if key in SKIP_KEYS:
                continue
            walk_report_rows(child, out)
    elif isinstance(node, list):
        for child in node:
            walk_report_rows(child, out)


def lines_in_text(text: str) -> set[int]:
    found: set[int] = set()
    if not text:
        return found
    for match in RANGE.finditer(text):
        a, b = next(
            (int(match.group(i)), int(match.group(i + 1)))
            for i in (1, 3)
            if match.group(i) and match.group(i + 1)
        )
        if 0 < b - a <= 30:
            found.update(range(a, b + 1))
        else:
            found.add(a)
            found.add(b)
    for match in ENUM.finditer(text):
        blob = match.group(1) or match.group(2) or ""
        for piece in re.split(r"\s*[、,，和与]\s*", blob):
            if piece.isdigit():
                found.add(int(piece))
    for match in ROW_COLON.finditer(text):
        for piece in re.findall(r"\d{1,4}", match.group(1)):
            number = int(piece)
            if number > 0:
                found.add(number)
    for match in SINGLE.finditer(text):
        for group in match.groups():
            if group and group.isdigit():
                found.add(int(group))
    return found


def int_set(raw) -> set[int]:
    found: set[int] = set()
    if isinstance(raw, list):
        for number in raw:
            if isinstance(number, int):
                found.add(number)
            elif isinstance(number, str) and number.isdigit():
                found.add(int(number))
    return found


def finding_structured_lines(finding: dict) -> set[int]:
    """Primary line, plus also_lines only when the fix is the same.

    Numbers that appear in title, risk, or evidence do not close a row.
    """
    found: set[int] = set()
    if isinstance(finding.get("line"), int):
        found.add(finding["line"])
    if finding.get("same_fix") is True:
        found |= int_set(finding.get("also_lines"))
    return found


def finding_lines(finding: dict) -> set[int]:
    return finding_structured_lines(finding)


def findings_of(conclusion: dict) -> list[dict]:
    rows = []
    for sev in ("p0", "p1", "p2"):
        for item in conclusion.get(sev) or []:
            if isinstance(item, dict):
                rows.append(item)
    return rows


def cited_lines(conclusion: dict) -> set[int]:
    found: set[int] = set()
    for finding in findings_of(conclusion):
        found |= finding_structured_lines(finding)
    return found


def norm_path(value: str) -> str:
    return value.replace("\\", "/").strip().lstrip("./")


def finding_paths(finding: dict) -> list[str]:
    """Cited file first. Snippet checks must not open another path ahead of it."""
    ordered: list[str] = []

    def add(raw: str) -> None:
        path = norm_path(raw)
        if path and path not in ordered:
            ordered.append(path)

    file_name = finding.get("file")
    if isinstance(file_name, str):
        add(file_name)
    extra = finding.get("path")
    if isinstance(extra, str):
        add(extra)
    location = finding.get("location")
    if isinstance(location, str) and location.strip():
        token = location.split("（")[0].split(",")[0].strip()
        token = re.split(r":\d+\b", token)[0].strip()
        if "/" in token or re.search(r"\.[A-Za-z0-9]+$", token):
            add(token)
    return ordered


def paths_compatible(finding: dict, row: dict) -> bool:
    row_path = norm_path(str(row.get("path") or row.get("file") or ""))
    if not row_path:
        return True
    paths = finding_paths(finding)
    if not paths:
        return True
    return any(
        row_path == path or row_path.endswith("/" + path) or path.endswith("/" + row_path)
        for path in paths
    )


def row_relation(row: dict) -> str:
    rule = str(row.get("rule_id") or "").strip()
    if rule:
        return "rule:" + rule
    klass = str(row.get("pattern_class") or "").strip()
    if klass:
        return "class:" + klass
    kind = str(row.get("kind") or "").strip()
    if kind and kind not in CONVENTION_KINDS:
        return "kind:" + kind
    return ""


def finding_relation(finding: dict) -> str:
    rule = str(finding.get("rule_id") or "").strip()
    if rule:
        return "rule:" + rule
    klass = str(finding.get("pattern_class") or "").strip()
    if klass:
        return "class:" + klass
    kind = str(finding.get("kind") or "").strip()
    if kind and kind not in CONVENTION_KINDS:
        return "kind:" + kind
    return ""


def relations_match(finding: dict, row: dict) -> bool:
    left = finding_relation(finding)
    right = row_relation(row)
    if not right:
        return True
    return bool(left) and left == right


def is_convention_row(row: dict) -> bool:
    return str(row.get("kind") or "") in CONVENTION_KINDS


def convention_lines(conclusion: dict) -> set[int]:
    found: set[int] = set()
    for item in conclusion.get("conventions") or []:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("line"), int):
            found.add(item["line"])
        found |= int_set(item.get("lines"))
        found |= int_set(item.get("also_lines"))
    return found


def row_is_drift(row: dict, conclusion: dict) -> bool:
    """A branch-drift skip closes that path only. A skip without a path keeps the old line-wide behavior."""
    line = row.get("line")
    if not isinstance(line, int):
        return False
    path = norm_path(str(row.get("path") or row.get("file") or ""))
    for skip in conclusion.get("line_skips") or []:
        if not isinstance(skip, dict) or str(skip.get("kind") or "") != "branch_drift":
            continue
        if skip.get("line") != line:
            continue
        skip_path = norm_path(str(skip.get("path") or skip.get("file") or ""))
        if not skip_path or skip_path == path:
            return True
    return False


def squash_ws(text: str) -> str:
    """Code identity ignores spacing. A space inside a call is still that call."""
    return re.sub(r"\s+", "", text)


def snippet_of(finding: dict) -> str:
    raw = finding.get("existing_code")
    if not isinstance(raw, str):
        return ""
    return raw.strip()


def source_lines(pack: Path, finding: dict) -> list[str]:
    paths = finding_paths(finding)
    ledger = load(pack / "24-coverage-ledger.json")
    root = str(ledger.get("source_root") or "") if isinstance(ledger, dict) else ""
    if not root or not paths:
        return []
    for rel in paths:
        full = Path(root) / rel
        if not full.is_file():
            continue
        try:
            return full.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
    return []


def cited_window(lines: list[str], finding: dict, snippet: str) -> str:
    """The cited line, plus the following lines when the snippet wraps."""
    number = finding.get("line")
    if not isinstance(number, int) or number < 1:
        return "\n".join(lines)
    extra = snippet.count("\n")
    start = number - 1
    end = min(len(lines), start + 1 + extra)
    if start >= len(lines):
        return ""
    return "\n".join(lines[start:end])


def diff_text_for(pack: Path, finding: dict) -> str:
    paths = finding_paths(finding)
    chunks: list[str] = []
    diffs = pack / "diffs"
    if not diffs.is_dir():
        return ""
    for path in sorted(diffs.glob("*.diff.json")):
        doc = load(path)
        if not isinstance(doc, dict):
            continue
        result = doc.get("result") if isinstance(doc.get("result"), dict) else doc
        if not isinstance(result, dict):
            continue
        file_path = norm_path(str(result.get("file_path") or ""))
        if paths and file_path and not any(
            file_path == item or file_path.endswith("/" + item) or item.endswith("/" + file_path)
            for item in paths
        ):
            continue
        diff = result.get("diff")
        if isinstance(diff, str) and diff.strip():
            chunks.append(diff)
    return "\n".join(chunks)


def check_snippets(pack: Path, conclusion: dict, errors: list[str]) -> None:
    """A snippet must sit on the cited line, or in that file's diff when source is absent."""
    for finding in findings_of(conclusion):
        snippet = snippet_of(finding)
        if not snippet:
            continue
        lines = source_lines(pack, finding)
        if lines:
            haystack = cited_window(lines, finding, snippet)
        else:
            haystack = diff_text_for(pack, finding)
        if not haystack.strip():
            continue
        if squash_ws(snippet) not in squash_ws(haystack):
            title = str(finding.get("title") or finding.get("id") or "finding")
            errors.append(
                "existing_code is not in the file diff or source: "
                + title[:80]
            )


def finding_closes(finding: dict, row: dict) -> bool:
    line = row.get("line")
    if not isinstance(line, int) or line not in finding_structured_lines(finding):
        return False
    if not paths_compatible(finding, row):
        return False
    return relations_match(finding, row)


def sentence_at(text: str, start: int) -> str:
    left = max(text.rfind("。", 0, start), text.rfind("\n", 0, start), text.rfind(". ", 0, start))
    right_candidates = [text.find(mark, start) for mark in ("。", "\n", ". ")]
    right_candidates = [n for n in right_candidates if n >= 0]
    right = min(right_candidates) if right_candidates else len(text)
    return text[left + 1 : right + 1]


def shape_count(look_for: str) -> int:
    text = look_for or ""
    if re.search(r"Two shapes", text, re.I):
        return 2
    if re.search(r"Either shape is a hit", text, re.I):
        return 2
    if re.search(r"one shape does not close|does not close another", text, re.I):
        return 2
    if re.search(r"Either the .+?, or ", text):
        return 2
    return 1


def load_shape_counts(skill_root: Path) -> dict[str, int]:
    path = skill_root / "references" / "business-rule-records.md"
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8")
    counts: dict[str, int] = {}
    rule_id = ""
    for line in text.splitlines():
        heading = re.match(r"^##\s+([A-Z]+-\d+)\s*$", line.strip())
        if heading:
            rule_id = heading.group(1)
            continue
        if rule_id and line.startswith("- look_for:"):
            counts[rule_id] = shape_count(line.split(":", 1)[1])
            rule_id = ""
    return counts


def is_test_method(node: dict, by_idx: dict[int, dict]) -> bool:
    name = str(node.get("name") or "")
    if name in {"setUp", "tearDown", "setup", "teardown"} or name.startswith("test"):
        return True
    current = node
    seen = 0
    while current is not None and seen < 8:
        seen += 1
        parent = current.get("parent_idx")
        if not isinstance(parent, int):
            break
        current = by_idx.get(parent)
        if current and str(current.get("name") or "").endswith("Test"):
            return True
    return False


def production_methods(symbols_doc: dict) -> list[dict]:
    nodes = symbols_doc.get("nodes") or symbols_doc.get("result", {}).get("nodes") or []
    if not isinstance(nodes, list):
        return []
    by_idx = {}
    for index, node in enumerate(nodes):
        if isinstance(node, dict):
            by_idx[node.get("node_idx", index)] = node
    methods = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("kind") not in {"method", "function"}:
            continue
        if is_test_method(node, by_idx):
            continue
        tested = node.get("tested_count")
        if isinstance(tested, int) and tested > 0:
            continue
        methods.append(node)
    return methods


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


def check_ledger(pack: Path, conclusion: dict, errors: list[str]) -> None:
    rows: list[dict] = []
    for pattern in SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            doc = load(path)
            if doc is not None:
                walk_report_rows(doc, rows)
    if not rows:
        return
    findings = findings_of(conclusion)
    conventions = convention_lines(conclusion)
    missing = []
    convention_missing = []
    closed_by: list[tuple[dict, list[str]]] = [(finding, []) for finding in findings]
    for row in rows:
        line = int(row["line"])
        label_rule = row.get("rule_id") or row.get("pattern_class") or row.get("kind") or "report"
        label_path = row.get("path") or row.get("file") or ""
        label = f"{label_path}:{line} ({label_rule})"
        if is_convention_row(row):
            if line not in conventions:
                convention_missing.append(label)
            for finding, rels in closed_by:
                if finding_closes(finding, row):
                    errors.append(f"convention row is filed as a defect: {label}")
            continue
        if row_is_drift(row, conclusion):
            continue
        closers = [finding for finding in findings if finding_closes(finding, row)]
        if not closers:
            missing.append(label)
            continue
        relation = row_relation(row)
        if not relation:
            continue
        for finding, rels in closed_by:
            if finding in closers and relation not in rels:
                rels.append(relation)
    if missing:
        errors.append(
            "report rows missing from finding line lists: " + "; ".join(missing[:40])
        )
    if convention_missing:
        errors.append(
            "convention rows missing from conventions: " + "; ".join(convention_missing[:40])
        )
    for finding, rels in closed_by:
        if len(rels) > 1:
            title = str(finding.get("title") or finding.get("id") or "finding")
            errors.append(
                "one finding closes two relations (" + ", ".join(rels) + "): " + title[:120]
            )
    cited = cited_lines(conclusion)
    for finding in findings_of(conclusion):
        for key in ("title", "title_en", "risk", "risk_en", "evidence", "evidence_en", "fix", "fix_en"):
            text = finding.get(key)
            if not isinstance(text, str):
                continue
            for match in DEFER.finditer(text):
                sentence = sentence_at(text, match.start())
                named = lines_in_text(sentence)
                if not named or not named <= cited:
                    errors.append(
                        "deferral without a real card line: "
                        + sentence.strip()[:180]
                    )


def check_oracle(pack: Path, conclusion: dict, errors: list[str]) -> None:
    path = pack / "18-maintainability-signals.json"
    doc = load(path) if path.is_file() else None
    inventory = []
    if isinstance(doc, dict):
        inventory = [row for row in (doc.get("test_oracle_inventory") or []) if isinstance(row, dict)]
    coverage = [row for row in (conclusion.get("test_oracle_coverage") or []) if isinstance(row, dict)]
    if not inventory and not coverage:
        return
    by_line = {}
    for row in coverage:
        if isinstance(row.get("line"), int):
            by_line[row["line"]] = row
    for row in inventory:
        line = row.get("line")
        if not isinstance(line, int):
            continue
        got = by_line.get(line)
        if got is None:
            errors.append(f"test_oracle_coverage missing inventory line {line}")
            continue
        oracle = got.get("oracle")
        if not isinstance(oracle, dict) or any(key not in oracle for key in ORACLE_KEYS):
            errors.append(
                f"test line {line} must answer unsafe_pass, boundary_missed, branch_uncovered"
            )
            continue
        flags = []
        for key in ORACLE_KEYS:
            if not isinstance(oracle.get(key), bool):
                errors.append(f"test line {line} oracle.{key} must be boolean")
                flags = []
                break
            flags.append(oracle[key])
        if len(flags) != 3:
            continue
        extra_flags = []
        for key in row.get("questions") or []:
            if key not in oracle or not isinstance(oracle.get(key), bool):
                errors.append(
                    f"test line {line} must answer {key}; one oracle flag does not skip the others"
                )
                extra_flags = []
                break
            extra_flags.append(oracle[key])
        else:
            flags.extend(extra_flags)
        want = "hit" if any(flags) else "skip"
        if got.get("result") != want:
            errors.append(
                f"test line {line} result is {got.get('result')}, three answers require {want}"
            )
        if want == "skip" and not str(got.get("note") or "").strip():
            errors.append(f"test line {line} skip needs a note; a true local assertion is not enough")


def check_symbol_diff(pack: Path, conclusion: dict, errors: list[str]) -> None:
    path = pack / "05-changed-symbols.json"
    doc = load(path) if path.is_file() else None
    if not isinstance(doc, dict):
        return
    names = gap_names(conclusion)
    missing = []
    for node in production_methods(doc):
        name = str(node.get("name") or "")
        if name and name not in names:
            missing.append(f"{name}:{node.get('start_line')}")
    if missing:
        errors.append(
            "production symbols with no accepted test edge missing from test_gaps: "
            + "; ".join(missing[:40])
        )


def check_shapes(pack: Path, conclusion: dict, skill_root: Path, errors: list[str]) -> None:
    counts = load_shape_counts(skill_root)
    coverage = [row for row in (conclusion.get("rule_coverage") or []) if isinstance(row, dict)]
    by_id = {str(row.get("rule_id")): row for row in coverage}
    needed = set()
    for pattern in SIGNAL_GLOBS:
        for path in pack.glob(pattern):
            doc = load(path)
            rows: list[dict] = []
            if doc is not None:
                walk_report_rows(doc, rows)
            for row in rows:
                rule_id = str(row.get("rule_id") or "")
                if rule_id:
                    needed.add(rule_id)
    for finding in findings_of(conclusion):
        rule_id = str(finding.get("rule_id") or "")
        if rule_id and not rule_id.startswith("sast:"):
            needed.add(rule_id)
    for rule_id in sorted(needed):
        count = counts.get(rule_id, 1)
        row = by_id.get(rule_id)
        if row is None:
            errors.append(f"rule_coverage missing {rule_id}")
            continue
        if count <= 1:
            continue
        shapes = row.get("shapes")
        if not isinstance(shapes, list) or len(shapes) < count:
            errors.append(
                f"{rule_id} look_for has {count} shapes; coverage lists {0 if not isinstance(shapes, list) else len(shapes)}"
            )
            continue
        hit_lines = set()
        for index, shape in enumerate(shapes, 1):
            if not isinstance(shape, dict):
                errors.append(f"{rule_id} shape {index} is not an object")
                continue
            result = shape.get("result")
            if result not in {"hit", "skip"}:
                errors.append(f"{rule_id} shape {index} result must be hit or skip")
            if result == "hit":
                lines = shape.get("lines")
                if not isinstance(lines, list) or not lines:
                    errors.append(f"{rule_id} shape {index} hit needs lines")
                else:
                    hit_lines.update(int(n) for n in lines if isinstance(n, int))
            if result == "skip" and not str(shape.get("note") or "").strip():
                errors.append(f"{rule_id} shape {index} skip needs a note")
        if hit_lines and not hit_lines <= cited_lines(conclusion):
            missing = sorted(hit_lines - cited_lines(conclusion))
            errors.append(f"{rule_id} shape lines not on a finding: {missing}")


def ledger_allowed_lines(doc: dict) -> set[int]:
    allowed: set[int] = set()
    for row in doc.get("symbols") or []:
        if not isinstance(row, dict):
            continue
        start = row.get("start_line")
        end = row.get("end_line")
        if isinstance(start, int) and isinstance(end, int) and 0 <= end - start <= 20000:
            allowed.update(range(start, end + 1))
        for hit in row.get("hits") or []:
            if isinstance(hit, dict) and isinstance(hit.get("line"), int):
                allowed.add(hit["line"])
    for hit in doc.get("orphan_hits") or []:
        if isinstance(hit, dict) and isinstance(hit.get("line"), int):
            allowed.add(hit["line"])
    return allowed


def symbol_ranges(row: dict) -> list[tuple[int, int]]:
    ranges = row.get("ranges")
    parsed: list[tuple[int, int]] = []
    if isinstance(ranges, list):
        for pair in ranges:
            if (
                isinstance(pair, list)
                and len(pair) == 2
                and isinstance(pair[0], int)
                and isinstance(pair[1], int)
                and pair[1] >= pair[0]
            ):
                parsed.append((pair[0], pair[1]))
    if parsed:
        return parsed
    start = row.get("start_line")
    end = row.get("end_line")
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        return [(start, end)]
    return []


def span_text(lines: list[str], ranges: list[tuple[int, int]]) -> str:
    picked: list[str] = []
    for start, end in ranges:
        for number in range(start, end + 1):
            if 1 <= number <= len(lines):
                picked.append(lines[number - 1])
    return "\n".join(picked)


def span_hash(lines: list[str], ranges: list[tuple[int, int]]) -> str:
    return hashlib.sha256(span_text(lines, ranges).encode("utf-8")).hexdigest()


def source_file(doc: dict, row: dict) -> Path | None:
    root = str(doc.get("source_root") or "")
    rel = str(row.get("path") or "")
    if not root or not rel:
        return None
    full = Path(root) / rel
    return full if full.is_file() else None


def skip_notes(conclusion: dict) -> dict[tuple[str, int], str]:
    notes: dict[tuple[str, int], str] = {}
    for row in conclusion.get("line_skips") or []:
        if not isinstance(row, dict) or not isinstance(row.get("line"), int):
            continue
        notes[(str(row.get("kind") or ""), int(row["line"]))] = str(row.get("note") or "").strip()
    return notes


def walk_marked(node, out: list[dict]) -> None:
    if isinstance(node, dict):
        marked = node.get("close") == "per_line" or node.get("visible_absence") is True
        if marked and isinstance(node.get("line"), int):
            out.append(node)
        for key, child in node.items():
            if key in SKIP_KEYS:
                continue
            walk_marked(child, out)
    elif isinstance(node, list):
        for child in node:
            walk_marked(child, out)


def check_family_lines(pack: Path, conclusion: dict, errors: list[str]) -> None:
    """One hit does not close the next line. A package-line skip does not either."""
    rows: list[dict] = []
    for pattern in SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            doc = load(path)
            if doc is not None:
                walk_marked(doc, rows)
    if not rows:
        return
    cited = cited_lines(conclusion)
    skips = skip_notes(conclusion)
    for row in rows:
        kind = str(row.get("kind") or row.get("rule_id") or "")
        lines = []
        if isinstance(row.get("line"), int):
            lines.append(row["line"])
        for number in row.get("anchors") or []:
            if isinstance(number, int) and number not in lines:
                lines.append(number)
        for number in lines:
            if number <= 1:
                errors.append(
                    f"{kind} is anchored at line {number}; attach a symbol line, not the package line"
                )
                continue
            note = skips.get((kind, number)) or skips.get(("", number)) or ""
            if number not in cited and number not in convention_lines(conclusion) and not note:
                errors.append(
                    f"{kind} line {number} needs a finding line or a line_skips note; "
                    "a nearby finding does not close it"
                )


def field_is_none(value) -> bool:
    if value is None:
        return True
    return str(value).strip().lower() in NONE_WORDS


def check_absence_cards(pack: Path, conclusion: dict, errors: list[str]) -> None:
    """A card may say none only after every visible absence row is skipped."""
    checks = (
        ("14-resilience-signals.json", "protection_gaps", "resilience", "degradation"),
        ("15-rollout-signals.json", "dual_write_gaps", "rollout", "dual_write"),
        ("15-rollout-signals.json", "feature_flag_gaps", "rollout", "feature_flags"),
        ("13-privacy-signals.json", "retention_gaps", "privacy", "retention"),
    )
    cited = cited_lines(conclusion)
    skips = skip_notes(conclusion)
    for filename, array_name, card, field in checks:
        doc = load(pack / filename)
        if not isinstance(doc, dict):
            continue
        pending = []
        for row in doc.get(array_name) or []:
            if not isinstance(row, dict) or row.get("visible_absence") is not True:
                continue
            if not isinstance(row.get("line"), int) or row["line"] <= 1:
                continue
            kind = str(row.get("kind") or "")
            note = skips.get((kind, row["line"])) or skips.get(("", row["line"])) or ""
            if row["line"] not in cited and not note:
                pending.append(row["line"])
        block = conclusion.get(card)
        value = block.get(field) if isinstance(block, dict) else None
        if pending and field_is_none(value):
            errors.append(
                f"{card}.{field} is none while {filename} {array_name} still has lines {pending[:8]}"
            )


def check_coverage_ledger(pack: Path, conclusion: dict, errors: list[str]) -> None:
    path = pack / "24-coverage-ledger.json"
    if not path.is_file():
        return
    doc = load(path)
    if not isinstance(doc, dict):
        errors.append("24-coverage-ledger.json is not an object")
        return
    pending_rows = []
    for row in doc.get("symbols") or []:
        if isinstance(row, dict) and row.get("status") == "pending" and row.get("symbol_id"):
            pending_rows.append(row)
    closure = [row for row in (conclusion.get("coverage_closure") or []) if isinstance(row, dict)]
    by_id = {str(row.get("symbol_id") or ""): row for row in closure}
    missing = []
    for row in pending_rows:
        symbol_id = str(row["symbol_id"])
        got = by_id.get(symbol_id)
        if got is None:
            missing.append(symbol_id)
            continue
        status = got.get("status")
        if status not in {"reviewed", "failed"}:
            errors.append(f"coverage_closure {symbol_id} status must be reviewed or failed")
            continue
        if status == "failed":
            if not str(got.get("reason") or "").strip():
                errors.append(f"coverage_closure {symbol_id} failed needs a reason")
            continue
        src = source_file(doc, row)
        if src is None:
            if got.get("span_check") != "unverified":
                errors.append(f"coverage_closure {symbol_id} needs span_check unverified when source is absent")
            continue
        ranges = symbol_ranges(row)
        try:
            lines = src.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            if got.get("span_check") != "unverified":
                errors.append(f"coverage_closure {symbol_id} needs span_check unverified when source is absent")
            continue
        expect = span_hash(lines, ranges)
        if got.get("span_hash") != expect:
            errors.append(f"coverage_closure {symbol_id} span_hash does not match the source lines")
    if missing:
        errors.append(
            "pending symbols missing from coverage_closure: " + "; ".join(missing[:40])
        )
    allowed = ledger_allowed_lines(doc)
    if not allowed:
        return
    outside = []
    for finding in findings_of(conclusion):
        cited = set()
        if isinstance(finding.get("line"), int):
            cited.add(finding["line"])
        raw = finding.get("lines")
        if isinstance(raw, list):
            cited.update(int(n) for n in raw if isinstance(n, int))
        if finding.get("same_fix") is True:
            cited |= int_set(finding.get("also_lines"))
        for line in sorted(cited):
            if line not in allowed:
                outside.append(str(line))
    if outside:
        errors.append("finding lines outside coverage ledger: " + ", ".join(outside[:40]))


def check_required_suspects(pack: Path, errors: list[str]) -> None:
    """A required suspect id needs a hit or an explicit skip. Omission is not a skip."""
    required: list[str] = []
    work = pack / "judgment-work"
    if work.is_dir():
        for path in sorted(work.glob("group-*.json")):
            doc = load(path)
            if not isinstance(doc, dict):
                continue
            for item in doc.get("required_suspect_ids") or []:
                text = str(item)
                if text and text not in required:
                    required.append(text)
    if not required:
        return
    hits: set[str] = set()
    skips: set[str] = set()

    def take(doc: dict) -> None:
        for item in doc.get("suspect_hits") or []:
            hits.add(str(item))
        for item in doc.get("suspect_skips") or []:
            if isinstance(item, str) and item:
                skips.add(item)
            elif isinstance(item, dict):
                sid = str(item.get("id") or item.get("derive_suspect_id") or item.get("suspect_id") or "")
                if sid:
                    skips.add(sid)

    judgment = load(pack / "judgment.json")
    if isinstance(judgment, dict):
        take(judgment)
    folder = pack / "judgment-groups"
    if folder.is_dir():
        for path in sorted(folder.glob("*.json")):
            doc = load(path)
            if isinstance(doc, dict):
                take(doc)
    missing = [sid for sid in required if sid not in hits and sid not in skips]
    if missing:
        errors.append(
            "required suspects unanswered: " + ", ".join(missing[:20])
        )


def pack_has_gate_inputs(pack: Path) -> bool:
    if (pack / "24-coverage-ledger.json").is_file():
        return True
    if (pack / "05-changed-symbols.json").is_file():
        return True
    return any(pack.glob(pattern) for pattern in SIGNAL_GLOBS)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: validate-conclusion.py <pack-dir> <conclusion.json>", file=sys.stderr)
        return 2
    pack = Path(sys.argv[1])
    conclusion_path = Path(sys.argv[2])
    if not pack_has_gate_inputs(pack):
        return 0
    conclusion = load(conclusion_path)
    if not isinstance(conclusion, dict):
        print(f"error: conclusion is not a JSON object: {conclusion_path}", file=sys.stderr)
        return 1
    skill_root = Path(__file__).resolve().parents[2]
    errors: list[str] = []
    check_ledger(pack, conclusion, errors)
    check_snippets(pack, conclusion, errors)
    check_oracle(pack, conclusion, errors)
    check_family_lines(pack, conclusion, errors)
    check_absence_cards(pack, conclusion, errors)
    check_symbol_diff(pack, conclusion, errors)
    check_shapes(pack, conclusion, skill_root, errors)
    check_coverage_ledger(pack, conclusion, errors)
    check_required_suspects(pack, errors)
    if errors:
        print("error: review conclusion failed closure gates:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("conclusion closure gates: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
