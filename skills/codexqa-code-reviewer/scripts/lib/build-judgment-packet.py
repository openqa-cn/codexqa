#!/usr/bin/env python3
"""Write the one-file judgment packet and the conclusion skeleton.

The host agent reads 31-model-brief.json once and does not reopen the
packet, the seed, signal files, or seal-conclusion.py. 29 stays for seal.
30-conclusion-skeleton.json holds span hashes, drift line skips, and the
untested-symbol name list. render-review-html.sh merges that skeleton so
those fields are not copied by hand.
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

MAX_SOURCE_LINES = 800
PLAN_FILE_LINES = 50
PLAN_GROUP_LINES = 100
SINGLE_PASS_LINES = 2000
CHUNK_LINES = 800
MAX_PARALLEL_GROUPS = 4
ABSORB_LINES = 100
# A short file stays one read. Question fan-out starts only when the model
# would otherwise re-judge this many suspects that seal cannot close.
QUESTION_FANOUT_MIN = 12
CONVENTION_KINDS = {"magic_number", "rate_literal", "long_file", "eol_import"}
BUSINESS_RULE_PREFIXES = ("BIZ-", "PAY-", "TXN-", "CONC-", "AUTH-", "SEC-")
TRIVIAL_RULES = {"LOGIC-001", "NULL-001", "HYG-001", "API-001", "DES-001", "GLOB-001", "ARCH-001"}
ORACLE_FLAGS = {
    "unsafe_pass": (
        "True only when an assertion requires a sensitive value in rendered output: "
        "HTML, a response body, or a log. A getter round-trip of a value the test just set is false."
    ),
    "boundary_missed": "True when the test name claims a boundary and the asserted value is not that boundary.",
    "branch_uncovered": "True when the test name claims a branch or outcome and no assertion reads that outcome.",
    "locks_private": "True when the test calls a private production member. Copy preset when it is present.",
    "locks_dependency": "True when the test stubs or asserts through a collaborator instead of the method it names.",
    "threshold_pass": "True when the assertion is a loose time or size ceiling that passes without proving the claim.",
    "observability_asserted": "True only when the test asserts a log, metric, or trace.",
}
ORACLE_JUDGMENT = (
    "Judge each test_oracle_open line once. Do not reopen a flag. "
    "A true flag cannot fail validation. "
    "Copy preset onto oracle and do not change those keys. "
    "Judge only questions. boundary_missed stays false unless preset is true. "
    "A name that claims a reject code, gateway failover, or acceptance, while the assertion reads a different result, is branch_uncovered. "
    "Omit a row when every flag is false. "
    "A test absent from test_oracle_open is closed. Do not investigate why. "
    "A closed shape does not close an open oracle line. "
    "Write the seven flags only under oracle, once. Do not narrate flags and do not revisit a line. "
    'Example: {"line":12,"file":"src/A.java","derive_suspect_id":"test_oracle:src/A.java:12",'
    '"oracle":{"unsafe_pass":false,"boundary_missed":true,"branch_uncovered":false,'
    '"locks_private":false,"locks_dependency":false,"threshold_pass":false,'
    '"observability_asserted":false}}.'
)
_ASSERT_CALL = re.compile(r"(?i)\b(?:org\.junit\.Assert\.)?(?:assert\w+|fail)\s*\(")
_SERVICE_CALL = re.compile(
    r"\b(?:submit\w*|settle\w*|notify\w*|persist|reverse\w*|purge\w*|convert|compensate|checkAccess|handle\w*|build\w*Html)\s*\("
)
_DEPENDENCY = re.compile(r"(?i)\b(?:mockito|mock|when|verify|stub|spy|@Mock|fake)\b")
_OBS_ASSERT = re.compile(r"(?i)assert\w*\s*\([\s\S]{0,180}\b(?:log|metric|trace|span)\b")
_ASSERT_TRUE_SENSITIVE = re.compile(
    r"(?i)assert(?:True|Equals)\s*\([^;]{0,240}contains\s*\(\s*\"[^\"]*(?:\d{13,19}|@)[^\"]*\""
)
_SINK_WORD = re.compile(r"(?i)\b(?:html|log|logger|response|body)\b")
_CONTAINS_CALL = re.compile(r"(?i)contains\s*\(")
_CLAIM_PATTERNS = (
    ("reject", r"getCode\s*\("),
    ("gateway", r"(?i)gateway|notifyMerchant"),
    ("failover", r"(?i)gateway|notifyMerchant|failover"),
    ("accept", r"(?i)submit\w*\s*\(|\baccept"),
    ("denied", r"(?i)assertFalse\s*\(|checkAccess\s*\("),
    ("timeout", r"(?i)timeout|gateway"),
    ("quietly", r"(?i)gateway|notifyMerchant"),
)
_ORACLE_FLAG_KEYS = (
    "unsafe_pass",
    "boundary_missed",
    "branch_uncovered",
    "locks_private",
    "locks_dependency",
    "threshold_pass",
    "observability_asserted",
)
_BOUNDARY_NAME = re.compile(r"(?i)(?:^|(?<=[a-z]))(?:boundary|limit|edge)(?=[A-Z]|$)")
_COMPARES_NAMED_LIMIT = re.compile(
    r"compareTo\s*\(\s*[A-Z][A-Z0-9_]+|[A-Z][A-Z0-9_]+\s*\.\s*compareTo\s*\("
)
_SETS_NUMERIC = re.compile(r"set[A-Z]\w*\s*\(\s*(?:new\s+\w+\s*\(\s*)?\"?\d")
_SETS_CONSTANT = re.compile(r"set[A-Z]\w*\s*\(\s*[A-Z][A-Z0-9_]+\s*\)")
_LOOSE_TIME = re.compile(r"(?i)\b(?:elapsed|duration)\b[^;\n]{0,80}[<]=?\s*\d{3,}")
# Shapes the brief can locate. A shape absent from this map stays in still_open.
RULE_SHAPES = {
    "BIZ-001": ("write_without_idempotency", "retry_without_idempotency"),
    "BIZ-003": ("null_amount", "negative_amount", "zero_amount", "fee_omitted", "default_zone_cutoff"),
    "BIZ-004": ("no_precondition", "failure_continues"),
    "BIZ-005": ("deprecated_balance",),
    "PAY-001": ("id_not_unique",),
    "PAY-002": ("client_rate",),
    "PAY-004": ("webhook_without_signature",),
    "PAY-005": ("post_before_ack", "compensation_mismatch"),
    "PAY-006": ("reverse_without_state",),
    "PAY-007": ("truncating_round",),
    "TXN-001": ("multi_write",),
    "CONC-001": ("check_then_act",),
    "CONC-003": ("collection_write",),
    "AUTH-001": ("unchecked_party", "unrestricted_object"),
    "AUTH-002": ("role_substring",),
    "SEC-001": ("route_without_authz",),
    "API-001": ("purge_returns_success",),
    "BND-001": ("unread_expiry",),
    "NULL-001": ("unguarded_parse",),
    "LOGIC-001": ("off_by_one_slice", "inverted_condition"),
    "HYG-001": ("identifier_in_output",),
}
SHORT_CALLEE_MAX = 40
_FINALLY_RELEASE = re.compile(
    r"(?i)finally[\s\S]{0,800}(?:\.close\s*\(|\.disconnect\s*\()"
)
_STREAM_CTOR = re.compile(
    r"new\s+(?:[\w.]+\.)?(?:File(?:Input|Output)Stream|File(?:Reader|Writer)|"
    r"Buffered(?:Reader|Writer)|PrintWriter)\s*\("
)
_LEAK_ALLOC = re.compile(
    r"(?i)DriverManager|createStatement|prepareStatement|executeQuery|"
    r"ResultSet|getOutputStream|getInputStream|Executors\.new"
)
_RESOURCE_HOST = re.compile(
    r"(?i)("
    r"DriverManager|getConnection\s*\(|createStatement|prepareStatement|executeQuery|"
    r"ResultSet|FileOutputStream|FileInputStream|getOutputStream|getInputStream|"
    r"Executors\.new|new\s+\w*(?:Stream|Socket|Connection|Reader|Writer)\b|"
    r"HttpsURLConnection|openConnection\s*\("
    r")"
)
_NESTED_TEST_CLASS = re.compile(r"\bclass\s+\w*Test\b")
_TEST_PATH = re.compile(
    r"(?i)(^|/)(test|tests|__tests__|spec)(/|$)|Test\.java$|_test\.go$|^test_.*\.py$"
)
_REVERSAL_NAME = re.compile(r"(?i)(?:reverse|refund|chargeback)")
_EXTRA_ID_LOOKUP = re.compile(
    r"(?i)\b(?:find|load|fetch)\w*\s*\(|\bget\w*(?:Account|Record|Transfer)\w*\s*\("
)
_KIND_TO_SHAPE = {
    "retry_side_effect": "retry_without_idempotency",
    "null_deref_after_load": "unguarded_load",
    "shared_mutable": "unsafe_static",
    "process_default_write": "process_default",
    "unguarded_parse": "unguarded_parse",
    "disabled_bound": "disabled_bound",
}
BRIEF_READ_THIS = (
    "Read this file once. Write judgment.json. Run render-review-html.sh. "
    "Do not open 01-30, judgment-seed.json, seal-conclusion.py, validate-conclusion.py, "
    "templates, examples, dimension docs, channel prompts, or the repository. "
    "closed_report lists lines that are already cards. "
    "closed_shapes groups those lines by shape. A listed shape is closed for the whole file, "
    "including same_shape_lines. Do not reclassify a closed shape. "
    "A different shape of the same rule_id stays open. "
    "judgment.json findings are already copied from candidate_hits. Do not rewrite them. "
    "Do not list findings in prose. If still_open is empty, do not add a finding. "
    "If still_open is not empty, append only those shapes. "
    "Do not scan a rule that is absent from both. "
    "One shape is one finding. The same shape on several lines uses same_fix true and also_lines. "
    "Different shapes stay separate findings, even on the same line. Do not reopen a finding. "
    "methods[].source is the method text. callee_of true means a short callee body is included; read it. "
    "A callee still missing from methods is filed once, on the call line, and that choice is finished. "
    "Line numbers are the N| prefix. title, risk, and fix are Chinese. Leave English fields empty. "
    "Copy each candidate line, severity, also_lines, and derive_suspect_id. Do not pick a different line. "
    "A test_oracle row is not a finding. Put it only in test_oracle, and its id only in suspect_hits. "
    "Judge each test_oracle_open line once. Do not reopen a flag. A true flag cannot fail validation. "
    "Copy preset onto oracle and do not change those keys. Judge only questions. "
    "boundary_missed stays false unless preset is true. "
    "unsafe_pass is true only for a sensitive value in HTML, a response body, or a log. "
    "A getter round-trip of a value the test just set is false. "
    "Write the test_oracle JSON once. Do not narrate flags and do not revisit a line. "
    "Omit a test_oracle row when every flag is false. "
    "A test absent from test_oracle_open is closed. Do not investigate why. "
    "A closed shape does not close an open oracle line. "
    "Write the seven flags only under oracle. "
    "If still_open is empty, read only methods that own a test_oracle_open line. "
    "If still_open, open_suspects, and test_oracle_open are all empty, do not read methods or judgment-work groups. "
    "An id already in judgment.json suspect_hits is closed. Do not re-judge it. "
    "review-conclusion.json is already in the pack. Run render. Do not write or edit that file. "
    "Identifiers in one log statement are one finding, on the line with the strongest identifier. "
    "A money check that omits a fee posted in the same method is the fee_omitted shape. "
    "Do not drop SEC-001 because PAY-004 or AUTH-001 also matches. "
    "Seed hits and one-line getters are omitted. Do not run merge-llm-findings.py. "
    "still_open is one row per shape, with hosts. Judge each shape once. "
    "Read only those hosts. Do not list the same shape twice. "
    "Do not restate look_for, do_not_report, or closed_lines. "
    "closed_lines are already cards. Do not open review-conclusion or rule-construction. "
    "A different shape is its own finding. Do not decide whether it is the same defect as a closed line. "
    "chain_dimensions.chains is every call chain CodexQA recorded. "
    "Judge each chain once against chain_dimensions.rules. "
    "File a hit on that chain step's line. Do not invent a caller or a chain. "
    "An empty chains list means this channel is closed. "
    "A line already in closed_shapes or candidate_hits stays closed."
)
MATCH_OUTSIDE_APPLICABLE = (
    "applicable is the first list to judge, not an exclusion list. "
    "A look_for that matches the method body is filed even when that rule_id is absent from applicable. "
    "Do not open the rule router and do not retract the match. "
    "Different rule_ids on the same line stay separate findings. Do not merge them. "
    "A line listed under a rule_id in closed_report is not filed again. "
    "Another line of that rule_id is still filed when it is a different shape. "
    "Do not open fill_shapes or check_shapes. "
    "State each finding once. Do not reopen a merge. "
    "Identifiers in one log statement are one finding on the line with the strongest identifier. "
    "Name the others in risk. "
    "A money check that omits a fee posted in the same method is one BIZ-003 finding. "
    "Do not try other rule ids for that check. "
    "A different rule_id that also matches is its own finding. "
    "Do not drop SEC-001 because PAY-004 or AUTH-001 also matches. "
    "A failed render names the sentence to edit. "
    "Do not grep seal-conclusion.py or validate-conclusion.py for fields."
)
GROUP_READ_THIS = (
    "Read this file for source, field declarations, and lock-order notes. "
    "Rule text for rule_ids is in shared.json; read that file once. "
    "Do not open another judgment-work group file, judgment-groups, "
    "or the source tree. Place every required_suspect_ids id and write this "
    "group's result before adding more findings. "
    "Do not open a previous judgment.json, REVIEW-REPORT.html, or an earlier review pack. "
    "title, risk, and fix are Chinese. Leave the English fields empty. "
    "A look_for with several shapes is one finding per shape. "
    "The first shape does not close the others. "
    + MATCH_OUTSIDE_APPLICABLE
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


def _same_brief_path(suspect_file: str, method_path: str) -> bool:
    if not suspect_file or not method_path:
        return False
    return (
        suspect_file == method_path
        or method_path.endswith("/" + suspect_file)
        or suspect_file.endswith("/" + method_path)
    )


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


def unit_lines(item: tuple[dict, dict]) -> int:
    sl, row = item
    start, end = slice_bounds(sl, row)
    if start is None or end is None:
        return len(line_set(row))
    return end - start + 1


def pack_units(units: list[tuple[dict, dict]], budget: int) -> list[list[tuple[dict, dict]]]:
    chunks: list[list[tuple[dict, dict]]] = []
    current: list[tuple[dict, dict]] = []
    current_n = 0
    for unit in units:
        span = unit_lines(unit)
        if current and current_n + span > budget:
            chunks.append(current)
            current = []
            current_n = 0
        current.append(unit)
        current_n += span
    if current:
        chunks.append(current)
    return chunks


def units_for_budget(
    methods: list[tuple[dict, dict]],
    budget: int,
) -> list[tuple[dict, dict]]:
    """Keep each method whole. Cut a method only when it is longer than budget."""
    units: list[tuple[dict, dict]] = []
    for sl, row in methods:
        start, end = slice_bounds(sl, row)
        span = 0 if start is None or end is None else end - start + 1
        if start is None or span <= budget:
            units.append((sl, row))
            continue
        cursor = start
        while cursor <= end:
            w_end = min(end, cursor + budget - 1)
            units.append((clip_slice(sl, cursor, w_end), row))
            cursor = w_end + 1
    return units


def fit_chunks(methods: list[tuple[dict, dict]]) -> list[list[tuple[dict, dict]]]:
    """About CHUNK_LINES per chunk, and never more than MAX_PARALLEL_GROUPS."""
    total = sum(unit_lines(unit) for unit in units_for_budget(methods, CHUNK_LINES))
    if total <= 0:
        return []

    def attempt(budget: int) -> list[list[tuple[dict, dict]]]:
        return pack_units(units_for_budget(methods, budget), budget)

    chunks = attempt(CHUNK_LINES)
    if len(chunks) <= MAX_PARALLEL_GROUPS:
        return chunks
    lo, hi = CHUNK_LINES, max(CHUNK_LINES, total)
    best = attempt(hi)
    while lo <= hi:
        mid = (lo + hi) // 2
        trial = attempt(mid)
        if len(trial) <= MAX_PARALLEL_GROUPS:
            best = trial
            hi = mid - 1
        else:
            lo = mid + 1
    return best


def chunk_suspects(
    chunk: list[tuple[dict, dict]],
    paths: list[str],
    points: list[tuple[str, int]],
) -> int:
    owned = 0
    for sl, row in chunk:
        start, end = slice_bounds(sl, row)
        owned += count_suspects(paths, start, end, points)
    return owned


def absorb_small_chunks(
    chunks: list[list[tuple[dict, dict]]],
    paths: list[str],
    points: list[tuple[str, int]],
) -> list[list[tuple[dict, dict]]]:
    """A short chunk with no suspects joins its neighbor instead of starting an agent."""
    changed = True
    while changed and len(chunks) > 1:
        changed = False
        for index, chunk in enumerate(chunks):
            span = sum(unit_lines(unit) for unit in chunk)
            if span >= ABSORB_LINES or chunk_suspects(chunk, paths, points) > 0:
                continue
            target = index - 1 if index else index + 1
            chunks[target].extend(chunk)
            del chunks[index]
            changed = True
            break
    return chunks


def file_needs_split(methods: list[tuple[dict, dict]]) -> bool:
    lines: set[int] = set()
    max_span = 0
    for sl, row in methods:
        lines.update(line_set(row) or line_set({"start_line": sl.get("start_line"), "end_line": sl.get("end_line")}))
        start, end = slice_bounds(sl, row)
        if start is not None and end is not None:
            max_span = max(max_span, end - start + 1)
    return len(lines) > SINGLE_PASS_LINES or max_span > CHUNK_LINES


def caller_edges(neighbors: list[dict]) -> set[tuple[str, str]]:
    edges: set[tuple[str, str]] = set()
    for group in neighbors:
        src = str(group.get("file") or "")
        for path in group.get("paths") or []:
            other = str(path)
            if src and other:
                edges.add((src, other))
                edges.add((other, src))
    return edges


def paths_linked(left: list[str], right: list[str], edges: set[tuple[str, str]]) -> bool:
    if set(left) & set(right):
        return True
    return any((src, dst) in edges for src in left for dst in right)


def group_directory(group: dict) -> str:
    opened = str(group.get("opened") or "")
    if not opened:
        paths = group.get("paths") or []
        opened = str(paths[0]) if paths else ""
    if "/" not in opened:
        return ""
    return opened.rsplit("/", 1)[0]


def group_line_count(group: dict, by_id: dict[str, dict]) -> int:
    lines: set[int] = set()
    for sid in group.get("symbol_ids") or []:
        lines.update(line_set(by_id.get(str(sid)) or {}))
    if lines:
        return len(lines)
    total = 0
    for sl in group.get("slices") or []:
        if not isinstance(sl, dict):
            continue
        start, end = sl.get("start_line"), sl.get("end_line")
        if isinstance(start, int) and isinstance(end, int) and end >= start:
            total += end - start + 1
    return total


def merge_read_groups(left: dict, right: dict) -> dict:
    paths = list(dict.fromkeys([*(left.get("paths") or []), *(right.get("paths") or [])]))
    text = "\n".join(part for part in (left.get("text") or "", right.get("text") or "") if part)
    return {
        "id": f"{left.get('id')}+{right.get('id')}",
        "paths": paths,
        "opened": left.get("opened") or right.get("opened") or (paths[0] if paths else ""),
        "symbol_ids": [*(left.get("symbol_ids") or []), *(right.get("symbol_ids") or [])],
        "text": text,
        "truncated": bool(left.get("truncated") or right.get("truncated")),
        "slices": [*(left.get("slices") or []), *(right.get("slices") or [])],
    }


def pack_directory_groups(
    groups: list[dict],
    by_id: dict[str, dict],
    edges: set[tuple[str, str]],
) -> list[dict]:
    """Files in one directory share a chunk until it is full.

    Caller-linked files stay apart so stamp_independent can keep them together
    as one serial read. Coarse chunks of a long file are already sized.
    """
    packed: list[dict] = []
    buckets: dict[str, list[dict]] = {}
    for group in groups:
        if group.get("method_split"):
            packed.append(group)
            continue
        buckets.setdefault(group_directory(group), []).append(group)
    for _directory, bucket in buckets.items():
        current: dict | None = None
        current_n = 0
        for group in bucket:
            paths = [str(item) for item in (group.get("paths") or [])]
            span = group_line_count(group, by_id)
            if current is not None and (
                paths_linked(current.get("paths") or [], paths, edges)
                or current_n + span > CHUNK_LINES
            ):
                packed.append(current)
                current = None
                current_n = 0
            if current is None:
                current = group
                current_n = span
            else:
                current = merge_read_groups(current, group)
                current_n += span
        if current is not None:
            packed.append(current)
    return packed


def cap_parallel_groups(
    groups: list[dict],
    by_id: dict[str, dict],
    edges: set[tuple[str, str]],
) -> list[dict]:
    """One wave stays at MAX_PARALLEL_GROUPS by joining the smallest free groups."""
    while len(groups) > MAX_PARALLEL_GROUPS:
        order = sorted(range(len(groups)), key=lambda index: group_line_count(groups[index], by_id))
        merged = False
        for left_i, left in enumerate(order):
            for right in order[left_i + 1:]:
                if paths_linked(groups[left].get("paths") or [], groups[right].get("paths") or [], edges):
                    continue
                if groups[left].get("method_split") and groups[right].get("method_split"):
                    if groups[left].get("opened") != groups[right].get("opened"):
                        continue
                nxt = []
                pair = {left, right}
                acc = None
                for index, group in enumerate(groups):
                    if index not in pair:
                        nxt.append(group)
                        continue
                    acc = group if acc is None else merge_read_groups(acc, group)
                if acc is not None:
                    acc["method_split"] = bool(groups[left].get("method_split") or groups[right].get("method_split"))
                    nxt.append(acc)
                groups = nxt
                merged = True
                break
            if merged:
                break
        if not merged:
            break
    return groups


def split_method_groups(
    groups: list[dict],
    pending: list[dict],
    suspects: dict | None = None,
    neighbors: list[dict] | None = None,
) -> list[dict]:
    """Keep one read until the file no longer fits, then cut on method boundaries.

    Unique pending lines at or under SINGLE_PASS_LINES stay one group, including
    an ~800-line file. Past that, or when one method is longer than CHUNK_LINES,
    whole methods pack into chunks of about CHUNK_LINES. A method is cut only
    when it is itself longer than the chunk budget. At most MAX_PARALLEL_GROUPS
    chunks are emitted. Identical-copy paths stay on every child. file_scope
    text is not copied again.
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
        if len(methods) < 2 or not file_needs_split(methods):
            out.append(group)
            continue
        raw_chunks = absorb_small_chunks(fit_chunks(methods), paths, points)
        if len(raw_chunks) < 2:
            out.append(group)
            continue
        parent = str(group.get("id") or "group")
        opened = str(group.get("opened") or (paths[0] if paths else ""))
        first = True
        for index, items in enumerate(raw_chunks):
            plan = any(len(line_set(row)) >= PLAN_FILE_LINES for _sl, row in items)
            tag = f"chunk-{index}"
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
    edges = caller_edges(neighbors or [])
    out = pack_directory_groups(out, by_id, edges)
    return cap_parallel_groups(out, by_id, edges)


def attach_uncovered_lines(groups: list[dict], repo: Path) -> None:
    """Keep field declarations that sit outside every method.

    file_scope is marked covered_by_methods and has no text, so a line such as
    a shared map never reaches a group. Those lines are attached, capped, to
    every chunk of that file.
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
        field_slice = {
            "symbol_id": "uncovered:" + path,
            "start_line": None,
            "end_line": None,
            "text": "\n".join(picked),
            "uncovered_fields": True,
        }
        for owner in owners:
            owner.setdefault("slices", []).append(dict(field_slice))


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


def attach_cross_summaries(groups: list[dict], notes: list[dict]) -> None:
    """Every coarse chunk of a file sees the same lock-order summary."""
    if not notes:
        return
    by_opened: dict[str, list[dict]] = {}
    for group in groups:
        opened = str(group.get("opened") or "")
        if opened:
            by_opened.setdefault(opened, []).append(group)
    for owners in by_opened.values():
        symbols: set[str] = set()
        for group in owners:
            symbols.update(str(item) for item in (group.get("symbol_ids") or []))
        relevant = [
            note for note in notes
            if symbols.intersection(str(item) for item in (note.get("symbol_ids") or []))
        ]
        if not relevant:
            continue
        for group in owners:
            group["cross_method"] = relevant


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
                if (not item[0] or same_path(rel, item[0])) and item[1] <= line <= item[2]
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
            "Model read is 31-model-brief.json. Do not mine this packet for "
            "counts, rules, report rows, or source. "
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
            "A file of about 800 lines, or any review of at most 2000 "
            "pending lines, stays one read. There is no judgment-work "
            "directory and one judgment.json is the whole pass. "
            "Past 2000 lines, or when one method is longer than 800 lines, "
            "whole methods pack into chunks of about 800 lines, at most "
            "four chunks. A method is cut only when it is longer than that "
            "chunk. Files in one directory share a chunk until it is full. "
            "Each chunk includes uncovered field lines and the lock-order "
            "summary. Rule text stays in this file or in shared.json, once. "
            "A finding line must fall inside that chunk. "
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
            "rules{} holds look_for text. applicable is the first list, not an exclusion list. "
            + MATCH_OUTSIDE_APPLICABLE
            + " "
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
        packet.get("neighbor_groups") if isinstance(packet.get("neighbor_groups"), list) else [],
    )
    attach_uncovered_lines(packet["read_groups"], repo)
    packet["cross_method"] = cross_method_notes(packet["read_groups"])
    attach_cross_summaries(packet["read_groups"], packet["cross_method"])
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
        write_json(work / f"group-{index}.json", {
            "read_this": GROUP_READ_THIS,
            "read_groups": [group],
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


def suspect_public_id(row: dict) -> str:
    return str(row.get("derive_suspect_id") or row.get("suspect_id") or "")


def peel_conventions(packet: dict) -> list[str]:
    """Magic numbers and rate literals are conventions. Seal confirms the seed.

    The model does not re-judge them. decision_literal stays, because a fee,
    timeout, or account limit is still a defect.
    """
    suspects = packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {}
    kept: list[dict] = []
    seed: list[str] = []
    for row in suspects.get("packets") or []:
        if not isinstance(row, dict):
            continue
        sid = suspect_public_id(row)
        if str(row.get("kind") or "") in CONVENTION_KINDS and sid:
            if sid not in seed:
                seed.append(sid)
            continue
        kept.append(row)
    suspects["packets"] = kept
    suspects["convention_hits"] = seed
    packet["suspects"] = suspects
    return seed


def symbol_span(row: dict) -> int:
    start, end = row.get("start_line"), row.get("end_line")
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        return end - start + 1
    return 0


def owning_method(pending: list[dict], file_name: str, line) -> str:
    """Smallest method whose declared range contains this line."""
    if not isinstance(line, int):
        return ""
    best = ""
    best_span = None
    for row in pending:
        if str(row.get("kind") or "") == "file_scope":
            continue
        path = str(row.get("path") or "")
        if file_name and path and not same_path(file_name, [path]):
            continue
        start, end = row.get("start_line"), row.get("end_line")
        if not isinstance(start, int) or not isinstance(end, int) or end < start:
            continue
        if not start <= line <= end:
            continue
        span = end - start
        if best_span is None or span < best_span:
            best = str(row.get("symbol_id") or "")
            best_span = span
    return best


def symbol_needs_model(row: dict, suspect_symbols: set[str]) -> bool:
    """Getters with only trivial rules stay out of the model prompt.

    A business, auth, or concurrency rule, a suspect, or a method of at
    least four lines still goes to a question group.
    """
    sid = str(row.get("symbol_id") or "")
    if sid in suspect_symbols:
        return True
    if str(row.get("kind") or "") == "file_scope":
        return False
    applicable = {str(item) for item in (row.get("applicable") or [])}
    if any(item.startswith(BUSINESS_RULE_PREFIXES) for item in applicable):
        return True
    # One-line getters are often tagged with broad rules. A real off-by-one
    # or resource leak sits in a method of at least four lines.
    return bool(applicable) and symbol_span(row) >= 4


def _packet_source_lines(packet: dict) -> int:
    """Lines of source the model would read if the packet stays one pass."""
    total = 0
    for group in packet.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        text = str(group.get("text") or "")
        if text.strip():
            total += text.count("\n") + 1
            continue
        for sl in group.get("slices") or []:
            if isinstance(sl, dict) and str(sl.get("text") or "").strip():
                total += str(sl["text"]).count("\n") + 1
    return total


_REMOTE_CALL = re.compile(
    r"getConnection\s*\(|createStatement\s*\(|prepareStatement\s*\(|"
    r"executeQuery\s*\(|executeUpdate\s*\(|openConnection\s*\(|"
    r"setConnectTimeout\s*\(\s*0|setReadTimeout\s*\(\s*0|"
    r"Https?URLConnection|RestTemplate|WebClient",
    re.I,
)
_LOCAL_TASK = re.compile(r"Executor|\.execute\s*\(\s*new\s+|newSingleThreadExecutor|\.submit\s*\(", re.I)
_POSITIVE_TIMEOUT = re.compile(
    r"setQueryTimeout\s*\(\s*[1-9]|setConnectTimeout\s*\(\s*[1-9]|setReadTimeout\s*\(\s*[1-9]"
)
_FEE_WORD = re.compile(r"(?i)\b(fee|timeout|deadline|limit|quota|ttl|rate)\b")
_RAW_NUMBER = re.compile(r"(?<![\w.])\d")
_RATE_EXPR = re.compile(r"new\s+BigDecimal\s*\(\s*\"0\.\d+|=\s*0\.\d+")
_TLS_OFF = re.compile(
    r"checkServerTrusted|checkClientTrusted|HostnameVerifier|useSSL\s*=\s*false|"
    r"TrustAll|X509TrustManager|return\s+true",
    re.I,
)
_WEAK_TLS = re.compile(r"getInstance\s*\(\s*\"(?:TLS|SSL)\"\s*\)")
_REDACT = re.compile(r"\b(redact|mask|last4)\b", re.I)
_PII_LOG = re.compile(r"(?i)\b(card|account|email|phone|mobile|idNo|pan)\b|getCardNo|getAccountNo")
_LOG_CALL = re.compile(r"(?i)\b(log|logger|auditLogger|info|warn|error)\s*\(")
_ABSENCE_TOKEN = {
    "dual_write_gap": re.compile(r"dual[_ ]?write|backfill", re.I),
    "feature_flag_gap": re.compile(r"featureFlag|feature_flag|killSwitch|toggle", re.I),
    "breaking_announcement_gap": re.compile(r"CHANGELOG|migration guide|sunset", re.I),
    "rollback_gap": re.compile(r"rollback|canary|blue-?green", re.I),
}


def _read_lines(repo: Path, rel: str) -> list[str]:
    full = repo / rel
    if not rel or not full.is_file():
        return []
    try:
        return full.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []


def _line_at(lines: list[str], number: int) -> str:
    if number < 1 or number > len(lines):
        return ""
    return lines[number - 1]


def _window(lines: list[str], number: int, after: int = 6) -> str:
    if number < 1:
        return ""
    return "\n".join(lines[number - 1 : min(len(lines), number - 1 + after)])


def _in_test(lines: list[str], number: int) -> bool:
    start = max(0, number - 40)
    return any("@Test" in lines[i] or "@test" in lines[i] for i in range(start, min(number, len(lines))))


def _signal_index(pack: Path) -> dict[str, dict]:
    """Suspect id to the signal row, so a script can see close/anchors/snippet."""
    found: dict[str, dict] = {}

    def walk(node) -> None:
        if isinstance(node, dict):
            sid = str(node.get("derive_suspect_id") or node.get("suspect_id") or "")
            if sid and isinstance(node.get("line"), int) and sid not in found:
                found[sid] = node
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    for path in sorted(pack.glob("*.json")):
        if path.name.startswith(("29-", "30-", "judgment")):
            continue
        doc = load_json(path)
        if doc is not None:
            walk(doc)
    return found


def _quote(text: str) -> str:
    return " ".join(text.strip().split())[:120]


def decide_suspect(kind: str, line: str, window: str, in_test: bool) -> tuple[str, str] | None:
    """Return hit/skip when the policy is a closed predicate. None stays with the model.

    test_oracle and business rules stay with the model: the predicate needs
    the claim of the test or the money path, not a keyword.
    """
    if kind == "decision_literal":
        if (_FEE_WORD.search(line) and _RAW_NUMBER.search(line)) or _RATE_EXPR.search(line):
            return "hit", ""
        return "skip", "该字面量决定的是循环次数、状态码或已命名常量，手续费、超时和账户限额另有规则。"
    if kind == "missing_timeout":
        if _POSITIVE_TIMEOUT.search(window):
            return "skip", "这一行所在调用设置了大于 0 的超时。"
        if _LOCAL_TASK.search(line) and not _REMOTE_CALL.search(line):
            return "skip", "这一行提交的是本地任务。"
        if _REMOTE_CALL.search(line):
            return "hit", ""
        return None
    if kind == "insecure_tls":
        if in_test:
            return "skip", "证书校验关闭出现在测试方法里。"
        if _TLS_OFF.search(line) or _TLS_OFF.search(window):
            return "hit", ""
        return None
    if kind in {"", "weak-ssl-context"} and _WEAK_TLS.search(line):
        return "hit", ""
    if kind == "compat_window_gap":
        if "@Deprecated" in line and "forRemoval" not in line and "since" not in line:
            return "hit", ""
        if "@Deprecated" in line:
            return "skip", "废弃声明已经写了替代版本。"
        return None
    if kind == "breaking_hint" and "@Deprecated" in line:
        return "skip", "同一行的废弃声明由兼容窗口规则记录。"
    if kind == "todo_fixme":
        return "skip", "这行是待办注释，同方法里的失败另有记录。"
    if kind in _ABSENCE_TOKEN:
        if _ABSENCE_TOKEN[kind].search(line):
            return None
        return "skip", "这一行没有该发布规则要看的双写、开关、公告或回滚标记。"
    if kind == "log_exposure":
        if _REDACT.search(window):
            return "skip", "写入日志前已经做了脱敏。"
        if _LOG_CALL.search(window) and _PII_LOG.search(window):
            return "hit", ""
        return None
    if kind == "retention_or_dsar_gap":
        if re.search(r"(?i)retention|dsar|erase|deleteAfter", window):
            return "skip", "这一行附近已经有保留或删除期限。"
        return "hit", ""
    if kind == "catch_without_obs":
        if in_test:
            return "skip", "空 catch 位于测试方法中。"
        body = window
        if re.search(r"\bthrow\b", body):
            return "skip", "catch 把异常重新抛出。"
        if re.search(r"(?i)\b(log|logger|audit|metric|trace)\b", body):
            return "skip", "catch 里已经写了日志或指标。"
        return "hit", ""
    return None


def _scripted_finding(kind: str, rel: str, number: int, line: str) -> dict | None:
    """A card for a scripted hit that seal does not build from a per_line row."""
    shown = _quote(line) or kind
    if kind == "compat_window_gap":
        return {
            "title": "废弃接口没有下线版本",
            "line": number,
            "kind": kind,
            "category": "rollout",
            "severity": "p1",
            "file": rel,
            "source": "scripted_policy",
            "location": f"{rel}:{number}",
            "risk": f"在第 {number} 行检测到 `{shown}`。接口标了废弃，旁边没有替代方法和移除版本。",
            "fix": f"将第 {number} 行 `{shown}` 改为：`@Deprecated(since = \"2\", forRemoval = true)`，并写上替代方法。",
        }
    if kind == "insecure_tls":
        return {
            "title": "证书校验被关闭",
            "line": number,
            "kind": kind,
            "category": "security",
            "severity": "p0",
            "file": rel,
            "source": "scripted_policy",
            "location": f"{rel}:{number}",
            "risk": f"在第 {number} 行检测到 `{shown}`。对端证书或主机名校验被跳过，网关流量可以被冒充。",
            "fix": f"将第 {number} 行 `{shown}` 改为：使用平台信任库并校验主机名。",
        }
    if _WEAK_TLS.search(line):
        return {
            "title": "弱 TLS 协议",
            "line": number,
            "kind": "weak-ssl-context",
            "category": "security",
            "severity": "p2",
            "file": rel,
            "source": "scripted_policy",
            "location": f"{rel}:{number}",
            "risk": f"在第 {number} 行检测到 `{shown}`。协议名 TLS 仍可协商到 TLS 1.0 和 1.1。",
            "fix": f"将第 {number} 行 `{shown}` 改为：`SSLContext.getInstance(\"TLSv1.2\")`。",
        }
    return None


def _mechanical_oracles(pack: Path) -> dict[int, set[str]]:
    """Test lines whose failure is already a report row. The model does not re-answer them."""
    found: dict[int, set[str]] = {}
    doc = load_json(pack / "18-maintainability-signals.json")
    if not isinstance(doc, dict):
        return found
    for row in doc.get("test_oracle_hits") or []:
        if not isinstance(row, dict) or not isinstance(row.get("line"), int):
            continue
        kind = str(row.get("kind") or "")
        if kind not in {"test_no_join", "test_tautology", "test_unreachable"}:
            continue
        found.setdefault(int(row["line"]), set()).add(kind)
    return found


def _oracle_answer(number: int, kinds: set[str]) -> dict:
    flags = {
        "unsafe_pass": "test_no_join" in kinds or "test_tautology" in kinds,
        "boundary_missed": False,
        "branch_uncovered": "test_unreachable" in kinds,
        "locks_private": False,
        "locks_dependency": False,
        "threshold_pass": "test_no_join" in kinds or "test_tautology" in kinds,
        "observability_asserted": False,
    }
    note = "脚本按已报告的测试缺陷填写预言。"
    return {"line": number, "oracle": flags, "note": note}


def _lock_order_findings(packet: dict) -> list[dict]:
    """Opposite lock orders are already on the packet. Emit one card, do not ask the model."""
    findings = []
    seen = set()
    for note in packet.get("cross_method") or []:
        if not isinstance(note, dict) or note.get("kind") != "lock_order":
            continue
        orders = note.get("orders") or []
        symbols = [str(item) for item in (note.get("symbol_ids") or []) if item]
        if len(orders) < 2 or not symbols:
            continue
        key = tuple(sorted(symbols))
        if key in seen:
            continue
        seen.add(key)
        line_no, shown, rel = _lock_site(packet, symbols[0])
        if not isinstance(line_no, int):
            continue
        shown = shown or "synchronized"
        findings.append({
            "title": "锁顺序相反",
            "line": line_no,
            "rule_id": "CONC-002",
            "category": "concurrency",
            "severity": "p0",
            "symbol_id": symbols[0],
            "file": rel,
            "source": "scripted_policy",
            "location": f"{rel}:{line_no}",
            "risk": (
                f"在第 {line_no} 行检测到 `{shown}`。"
                f"另一处以相反顺序获取同一组锁，两条路径同时执行会互相等待。"
            ),
            "fix": f"将第 {line_no} 行 `{shown}` 改为：与另一处使用同一获取顺序。",
        })
    return findings


def _lock_site(packet: dict, symbol_id: str) -> tuple[int | None, str, str]:
    for group in packet.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        rel = ""
        paths = group.get("paths") or []
        if paths:
            rel = str(paths[0])
        for sl in group.get("slices") or []:
            if not isinstance(sl, dict) or str(sl.get("symbol_id") or "") != symbol_id:
                continue
            for raw in str(sl.get("text") or "").splitlines():
                if "synchronized" not in raw:
                    continue
                number, _, body = raw.partition("|")
                if number.isdigit():
                    return int(number), " ".join(body.split()), rel
    return None, "", ""


def preclose_scripted(pack: Path, packet: dict, repo: Path) -> dict:
    """Close suspects whose policy is a predicate. The model never sees them.

    Hits on per_line rows stay in the seed so seal writes the card. Other
    hits get one finding here. Skips become seed notes and, for absence
    anchors, skeleton line_skips.
    """
    suspects = packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {}
    signals = _signal_index(pack)
    reported = {
        (str(row.get("rule") or ""), int(row["line"]))
        for row in (packet.get("report") or {}).get("pr_delta") or []
        if isinstance(row, dict) and isinstance(row.get("line"), int)
    }
    hits: list[str] = []
    skips: list[dict] = []
    findings: list[dict] = []
    line_skips: list[dict] = []
    oracles: list[dict] = []
    cache: dict[str, list[str]] = {}
    mechanical = _mechanical_oracles(pack)

    def lines_of(rel: str) -> list[str]:
        if rel not in cache:
            cache[rel] = _read_lines(repo, rel)
        return cache[rel]

    def keep(row: dict) -> bool:
        if not isinstance(row, dict):
            return False
        sid = suspect_public_id(row)
        kind = str(row.get("kind") or "")
        number = row.get("line")
        rel = str(row.get("file") or "")
        if not sid or not isinstance(number, int):
            return True
        file_lines = lines_of(rel)
        line = _line_at(file_lines, number)
        signal = signals.get(sid) or {}
        if not line:
            line = str(signal.get("snippet") or "")
        window = _window(file_lines, number) or line
        if kind == "test_oracle" and number in mechanical:
            if sid not in hits:
                hits.append(sid)
            oracles.append(_oracle_answer(number, mechanical[number]))
            return False
        decided = decide_suspect(kind, line, window, _in_test(file_lines, number))
        if decided is None and kind == "" and _WEAK_TLS.search(line):
            decided = ("hit", "")
        if decided is None:
            return True
        verdict, note = decided
        if verdict == "hit":
            if sid not in hits:
                hits.append(sid)
            per_line = signal.get("close") == "per_line"
            already = (kind, number) in reported or ("insecure_tls", number) in reported
            if not per_line and not already:
                finding = _scripted_finding(kind, rel, number, line)
                if finding and not any(item.get("line") == number and item.get("kind") == finding.get("kind") for item in findings):
                    findings.append(finding)
        else:
            skips.append({"id": sid, "note": note or "脚本按规则跳过。"})
            if signal.get("visible_absence") is True or signal.get("close") == "per_line":
                anchors = [number]
                for anchor in signal.get("anchors") or []:
                    if isinstance(anchor, int) and anchor not in anchors:
                        anchors.append(anchor)
                for anchor in anchors:
                    line_skips.append({"kind": kind, "line": anchor, "note": note or "脚本按规则跳过。"})
        return False

    for key in ("packets", "sast_packets"):
        suspects[key] = [row for row in (suspects.get(key) or []) if keep(row)]
    packet["suspects"] = suspects
    findings.extend(_lock_order_findings(packet))
    packet["scripted_closed"] = {"hits": len(hits), "skips": len(skips), "oracles": len(oracles)}
    return {
        "hits": hits,
        "skips": skips,
        "findings": findings,
        "line_skips": line_skips,
        "test_oracle": oracles,
    }


def split_question_work(pack: Path, packet: dict, repo: Path) -> int:
    """Fan out only when the source left for the model exceeds one pass.

    Scripted suspects are already removed. A file of at most 2000 lines stays
    one read even if unscripted suspects remain: four prompts would repeat
    the same rules and the same business methods. Past that budget, each
    group receives only the methods that own a model suspect, a business
    rule, or a lock-order pair.
    """
    groups = [row for row in (packet.get("read_groups") or []) if isinstance(row, dict)]
    if any(row.get("method_split") for row in groups):
        return 0
    if _packet_source_lines(packet) <= SINGLE_PASS_LINES:
        return 0
    suspects = packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {}
    model_rows = [
        row for row in (suspects.get("packets") or []) + (suspects.get("sast_packets") or [])
        if isinstance(row, dict)
    ]
    if len(model_rows) < QUESTION_FANOUT_MIN:
        return 0
    pending = [row for row in (packet.get("pending") or []) if isinstance(row, dict)]
    by_symbol_suspects: dict[str, list[dict]] = {}
    suspect_symbols: set[str] = set()
    for row in model_rows:
        ref = row.get("slice_ref") if isinstance(row.get("slice_ref"), dict) else {}
        sid = str(ref.get("symbol_id") or "")
        if not sid:
            sid = owning_method(pending, str(row.get("file") or ""), row.get("line")) or ""
        if not sid:
            sid = f"line:{row.get('line')}"
        suspect_symbols.add(sid)
        by_symbol_suspects.setdefault(sid, []).append(row)
    by_symbol = {str(row.get("symbol_id")): row for row in pending}
    cross_ids: list[str] = []
    for note in packet.get("cross_method") or []:
        if not isinstance(note, dict):
            continue
        for sid in note.get("symbol_ids") or []:
            text = str(sid)
            if text and text not in cross_ids:
                cross_ids.append(text)
    seen: set[str] = set()
    units: list[dict] = []

    def add(sid: str, cross: bool = False) -> None:
        if not sid or sid in seen:
            return
        seen.add(sid)
        row = by_symbol.get(sid) or {"symbol_id": sid}
        units.append({
            "symbol_id": sid,
            "row": row,
            "suspects": by_symbol_suspects.get(sid, []),
            "lines": max(symbol_span(row), 1),
            "cross": cross or sid in cross_ids,
        })

    for sid in cross_ids:
        add(sid, True)
    for row in pending:
        if symbol_needs_model(row, suspect_symbols):
            add(str(row.get("symbol_id") or ""))
    for sid in by_symbol_suspects:
        add(sid)
    if len(units) < 2:
        return 0
    slices_by_sid: dict[str, dict] = {}
    uncovered: list[dict] = []
    for group in groups:
        for sl in group.get("slices") or []:
            if not isinstance(sl, dict):
                continue
            if sl.get("uncovered_fields"):
                uncovered.append(sl)
                continue
            if sl.get("covered_by_methods"):
                continue
            sid = str(sl.get("symbol_id") or "")
            if sid and sid not in slices_by_sid:
                slices_by_sid[sid] = sl
    for sid in list(by_symbol_suspects):
        if sid in slices_by_sid or not sid.startswith("line:"):
            continue
        try:
            number = int(sid.split(":", 1)[1])
        except ValueError:
            continue
        sample = by_symbol_suspects[sid][0]
        rel = str(sample.get("file") or "")
        full = repo / rel
        if not full.is_file():
            continue
        try:
            lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        if number < 1 or number > len(lines):
            continue
        slices_by_sid[sid] = {
            "symbol_id": sid,
            "start_line": number,
            "end_line": number,
            "text": f"{number}|{lines[number - 1]}",
        }
    for unit in units:
        sid = unit["symbol_id"]
        if sid in slices_by_sid or sid.startswith("line:"):
            continue
        row = unit["row"]
        start, end = row.get("start_line"), row.get("end_line")
        rel = str(row.get("path") or "")
        if not isinstance(start, int) or not isinstance(end, int) or end < start or not rel:
            continue
        full = repo / rel
        if not full.is_file():
            continue
        try:
            lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        body = [
            f"{number}|{lines[number - 1]}"
            for number in range(start, end + 1)
            if 1 <= number <= len(lines)
        ]
        if not body:
            continue
        slices_by_sid[sid] = {
            "symbol_id": sid,
            "start_line": start,
            "end_line": end,
            "text": "\n".join(body),
        }
    fresh_notes = cross_method_notes([{"id": "question", "slices": list(slices_by_sid.values())}])
    if fresh_notes:
        packet["cross_method"] = fresh_notes
    cross_ids = []
    for note in packet.get("cross_method") or []:
        if not isinstance(note, dict):
            continue
        for sid in note.get("symbol_ids") or []:
            text = str(sid)
            if text and text not in cross_ids:
                cross_ids.append(text)
    cross_set = set(cross_ids)
    for unit in units:
        unit["cross"] = unit["symbol_id"] in cross_set
    bins: list[list[dict]] = [[] for _ in range(MAX_PARALLEL_GROUPS)]
    load = [0] * MAX_PARALLEL_GROUPS
    for unit in units:
        if not unit["cross"]:
            continue
        bins[0].append(unit)
        load[0] += unit["lines"]
    rest = sorted((unit for unit in units if not unit["cross"]), key=lambda unit: unit["lines"], reverse=True)
    # The lock-order group stays a separate task. Other methods fill the remaining slots.
    slots = range(1, MAX_PARALLEL_GROUPS) if bins[0] else range(MAX_PARALLEL_GROUPS)
    for unit in rest:
        slot = min(slots, key=lambda index: (load[index], index))
        bins[slot].append(unit)
        load[slot] += unit["lines"]
    bins = [bucket for bucket in bins if bucket]
    if len(bins) < 2:
        return 0
    work = pack / "judgment-work"
    work.mkdir(exist_ok=True)
    policies = packet.get("rules") if isinstance(packet.get("rules"), dict) else {}
    tier = packet.get("risk_tier") if isinstance(packet.get("risk_tier"), dict) else {}
    write_json(work / "shared.json", {
        "rules": policies,
        "skip_notes": packet.get("skip_notes") or {},
        "uncovered_fields": uncovered,
        "convention_hits": suspects.get("convention_hits") or [],
        "semantic_candidates": packet.get("semantic_candidates") or [],
        "cross_method": packet.get("cross_method") or [],
        "open_question": str(tier.get("tier") or "") == "T0",
        "closed_by_seal": True,
        "question_fanout": True,
        "read_this": (
            "Read this file once. Report rows are already cards. "
            "Convention hits are seeded for seal. "
            "Judge group files concurrently, at most four, and union the findings. "
            "Do not drop a hit from another group. "
            "Do not open a previous judgment.json, REVIEW-REPORT.html, or an earlier review pack. "
            "title, risk, and fix are Chinese. Leave the English fields empty. "
            "A look_for with several shapes is one finding per shape. "
            "The first shape does not close the others. "
            "A line listed under a rule_id in closed_report is not filed again. Another line of that rule_id is still filed when it is a different shape. "
            + MATCH_OUTSIDE_APPLICABLE
        ),
    })
    question_groups = []
    for index, bucket in enumerate(bins):
        slices = []
        ids = []
        required = []
        rule_ids: list[str] = []
        paths: list[str] = []
        for unit in bucket:
            sid = unit["symbol_id"]
            ids.append(sid)
            sl = slices_by_sid.get(sid)
            if sl:
                slices.append(sl)
            path = str(unit["row"].get("path") or "")
            if path and path not in paths:
                paths.append(path)
            for rule_id in unit["row"].get("applicable") or []:
                text = str(rule_id)
                if text not in rule_ids:
                    rule_ids.append(text)
            for srow in unit["suspects"]:
                sid_hit = suspect_public_id(srow)
                if sid_hit and sid_hit not in required:
                    required.append(sid_hit)
        notes = [
            note for note in (packet.get("cross_method") or [])
            if isinstance(note, dict) and set(str(item) for item in (note.get("symbol_ids") or [])) & set(ids)
        ]
        opened = paths[0] if paths else ""
        group = {
            "id": f"question-{index}",
            "paths": paths,
            "opened": opened,
            "symbol_ids": ids,
            "text": "",
            "slices": slices,
            "question_split": True,
            "independent": True,
            "method_split": False,
            "cross_method": notes,
            "body": f"judgment-work/group-{index}.json",
        }
        question_groups.append(group)
        write_json(work / f"group-{index}.json", {
            "read_this": (
                GROUP_READ_THIS
                + " This group is one question slice. "
                + "Report rows are closed by seal; do not re-file them. "
                + "Union findings across groups."
            ),
            "read_groups": [group],
            "rule_ids": rule_ids,
            "plan_required": False,
            "open_question": str(tier.get("tier") or "") == "T0",
            "cross_method": notes,
            "suspects": {
                "policies": {
                    key: value
                    for key, value in (suspects.get("policies") or {}).items()
                    if key in {str(row.get("kind") or "") for unit in bucket for row in unit["suspects"]}
                },
                "packets": [row for unit in bucket for row in unit["suspects"]],
                "sast_packets": [],
            },
            "required_suspect_ids": required,
        })
    for row in packet.get("report", {}).get("pr_delta") or []:
        if isinstance(row, dict):
            row.pop("snippet", None)
            row["closed_by_seal"] = True
    report = packet.get("report") if isinstance(packet.get("report"), dict) else {}
    report["closed_by_seal"] = True
    packet["report"] = report
    packet["question_fanout"] = True
    packet["read_groups"] = [
        {
            "id": group["id"],
            "paths": group["paths"],
            "opened": group["opened"],
            "symbol_ids": group["symbol_ids"],
            "text": "",
            "question_split": True,
            "independent": True,
            "body": group["body"],
        }
        for group in question_groups
    ]
    packet["read_this"] = str(packet.get("read_this") or "") + (
        " question_fanout is true: the single-read sentence does not apply. "
        "Source text is only in judgment-work/group-*.json. Read shared.json once. "
        "Report rows are closed by seal. Convention hits are in judgment-seed.json. "
        "Judge the groups concurrently, at most four, and union the findings."
    )
    return len(question_groups)


def _write_conclusion_stub(pack: Path, packet: dict) -> None:
    """Header for render. The model does not draft this file or the group JSON.

    A unit-test pack has no manifest, so this stays absent there.
    Collectors call this again with --conclusion-stub-only after manifest.json exists.
    """
    path = pack / "review-conclusion.json"
    manifest = load_json(pack / "manifest.json")
    if path.is_file() or not isinstance(manifest, dict):
        return
    lang = packet.get("language") if isinstance(packet.get("language"), dict) else {}
    primary = str(lang.get("primary_language") or manifest.get("primary_language") or "")
    write_json(path, {
        "mode": manifest.get("mode") or "pr",
        "skill": "codexqa-code-reviewer",
        "analysis_backend": "codexqa-cli",
        "repo": manifest.get("repo") or "",
        "repo_label": Path(str(manifest.get("repo") or pack)).name,
        "diff_base": manifest.get("diff_base") or "",
        "evidence_dir": str(pack),
        "codexqa_version": manifest.get("codexqa_version") or "",
        "primary_language": primary,
        "review_language_focus": str(lang.get("review_language_focus") or primary),
        "language_confidence": str(lang.get("confidence") or "high"),
        "summary": "扫描结论和可判定嫌疑已由脚本写入。模型只补充业务规则的新缺陷，然后重新渲染。",
        "summary_en": "Scanner cards and closed predicates are already included. The model adds only new business findings, then render again.",
        "p0": [],
        "p1": [],
        "p2": [],
        "dimensions_covered": [
            "risk_tier", "design", "complexity", "dependencies", "correctness",
            "resilience", "security", "privacy", "contract", "rollout", "concurrency",
            "regression", "test_gaps", "observability", "maintainability",
            "performance", "llm_judgment",
        ],
    })


def _rule_name(row: dict) -> str:
    rule = row.get("rule")
    if isinstance(rule, str) and rule:
        return rule
    if isinstance(rule, dict):
        return str(rule.get("rule_id") or rule.get("kind") or "report")
    return str(row.get("rule_id") or row.get("kind") or "report")


def _slice_text(packet: dict) -> dict[str, str]:
    """Shortest non-empty slice per symbol. The file-scope copy is not a method."""
    found: dict[str, str] = {}
    for group in packet.get("read_groups") or []:
        if not isinstance(group, dict):
            continue
        for sl in group.get("slices") or []:
            if not isinstance(sl, dict):
                continue
            sid = str(sl.get("symbol_id") or "")
            text = sl.get("text") or ""
            if not sid or not text:
                continue
            prev = found.get(sid)
            if prev is None or len(text) < len(prev):
                found[sid] = text
    return found


def _suspect_id(row: dict) -> str:
    explicit = str(row.get("derive_suspect_id") or row.get("suspect_id") or "")
    if explicit:
        return explicit
    return f"{row.get('kind') or ''}:{row.get('file') or row.get('path') or ''}:{row.get('line')}"


def _numbered_lines(source: str) -> list[tuple[int, str]]:
    rows = []
    for raw in (source or "").splitlines():
        match = re.match(r"^(\d+)\|(.*)$", raw)
        if match:
            rows.append((int(match.group(1)), match.group(2)))
    return rows


def _quote_line(text: str) -> str:
    return " ".join(text.strip().split())[:140]


def _trivial_getter(source: str) -> bool:
    """A single field return. Short callees with a decision stay in the brief."""
    body = []
    for _number, text in _numbered_lines(source):
        stripped = text.strip()
        if not stripped or stripped in {"{", "}"}:
            continue
        if stripped.startswith(("public ", "private ", "protected ", "@")):
            continue
        body.append(stripped)
    if len(body) != 1:
        return False
    if re.search(r"\b(if|for|while|switch|try)\b", body[0]):
        return False
    return bool(re.match(r"return\s+[\w.]+\s*;", body[0]))


def _file_lines(repo: Path | None, rel: str) -> list[str]:
    if repo is None or not rel:
        return []
    path = Path(repo) / rel
    if not path.is_file():
        return []
    try:
        return path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []


def _disabling_inits(lines: list[str]) -> dict[str, int]:
    found = {}
    pattern = re.compile(r"\b([A-Z][A-Z0-9_]{2,})\s*=\s*(?:0|-1|false)\b")
    for number, line in enumerate(lines, 1):
        match = pattern.search(line)
        if match and match.group(1) not in found:
            found[match.group(1)] = number
    return found


def _infer_shape(rule_id: str, snippet: str, kind: str) -> str:
    """Packet rows keep rule and snippet. Recover the shape the scanner used."""
    if kind and kind not in {"report", ""}:
        return _KIND_TO_SHAPE.get(kind, kind)
    text = snippet or ""
    if rule_id == "BND-001":
        return "disabled_bound"
    if rule_id == "CONC-003":
        if re.search(r"DateFormat|Calendar|Random|SimpleDateFormat", text):
            return "unsafe_static"
        return "collection_write"
    if rule_id == "BIZ-001":
        if re.search(r"notify|retry", text):
            return "retry_without_idempotency"
        return "write_without_idempotency"
    if rule_id == "NULL-001":
        if re.search(r"new\s+BigDecimal|Integer\.parse|parse\s*\(", text):
            return "unguarded_parse"
        return "unguarded_load"
    if rule_id == "GLOB-001":
        return "process_default"
    return "report"


def _closed_shapes(rows: list[dict], repo: Path | None) -> list[dict]:
    """Group already-reported lines by rule and shape, and attach disabling declarations."""
    grouped: dict[tuple[str, str], dict] = {}
    files: dict[str, list[str]] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("line"), int):
            continue
        rule_id = _rule_name(row)
        shape = _infer_shape(rule_id, str(row.get("snippet") or ""), str(row.get("kind") or ""))
        slot = grouped.setdefault((rule_id, shape), {
            "rule_id": rule_id,
            "shape": shape,
            "lines": [],
            "same_shape_lines": [],
        })
        if row["line"] not in slot["lines"]:
            slot["lines"].append(row["line"])
        if shape != "disabled_bound":
            continue
        rel = str(row.get("file") or row.get("path") or "")
        if rel not in files:
            files[rel] = _file_lines(repo, rel)
        inits = _disabling_inits(files[rel])
        snippet = str(row.get("snippet") or "")
        if not snippet and files[rel] and 1 <= row["line"] <= len(files[rel]):
            snippet = files[rel][row["line"] - 1]
        for name in re.findall(r"\b[A-Z][A-Z0-9_]{2,}\b", snippet):
            declared = inits.get(name)
            if declared and declared not in slot["lines"] and declared not in slot["same_shape_lines"]:
                slot["same_shape_lines"].append(declared)
    shapes = list(grouped.values())
    for slot in shapes:
        slot["lines"].sort()
        slot["same_shape_lines"].sort()
    shapes.sort(key=lambda slot: (slot["rule_id"], slot["shape"]))
    return shapes


def _closed_line_set(shapes: list[dict]) -> dict[str, set[int]]:
    found: dict[str, set[int]] = {}
    for slot in shapes:
        lines = found.setdefault(slot["rule_id"], set())
        lines.update(slot["lines"])
        lines.update(slot["same_shape_lines"])
    return found


def _shape_closed(shapes: list[dict], rule_id: str, shape: str) -> bool:
    return any(slot["rule_id"] == rule_id and slot["shape"] == shape for slot in shapes)


def _coded_rule_ids() -> set[str]:
    """Rules the script already matches. They do not go to the model as look_for."""
    return set(RULE_SHAPES) | {"BIZ-002"}


_LOOK_FOR_IDS: set[str] | None = None


def _look_for_rule_ids() -> set[str]:
    """Catalog rules whose text the model can judge."""
    global _LOOK_FOR_IDS
    if _LOOK_FOR_IDS is not None:
        return _LOOK_FOR_IDS
    found = set()
    for rule_id, policy in load_rule_policies().items():
        if policy.get("look_for") and policy.get("do_not_report"):
            found.add(rule_id)
    _LOOK_FOR_IDS = found
    return found


def _closed_lines_for(closed: list[dict], rule_id: str) -> list[int]:
    lines: list[int] = []
    for slot in closed:
        if slot.get("rule_id") != rule_id:
            continue
        for number in (slot.get("lines") or []) + (slot.get("same_shape_lines") or []):
            if isinstance(number, int) and number not in lines:
                lines.append(number)
    return lines


def _res_still_open(source: str) -> bool:
    """A resource the scanner did not already close.

    A finally that closes or disconnects covers ResultSet and the request
    stream. A stream constructed on the success path, with no release in
    finally, stays open.
    """
    if not _RESOURCE_HOST.search(source or ""):
        return False
    if (
        _STREAM_CTOR.search(source)
        and not re.search(r"\btry\s*\(", source)
        and not _FINALLY_RELEASE.search(source)
    ):
        return True
    if _FINALLY_RELEASE.search(source):
        return False
    return _LEAK_ALLOC.search(source) is not None


def _keep_open_shape(method: dict, shape: str) -> bool:
    """Drop shapes a host cannot carry. DES-001 is filed once for the file."""
    if shape == "DES-001:look_for":
        return False
    start = method.get("start_line")
    end = method.get("end_line")
    if isinstance(start, int) and start == end:
        return False
    if shape == "RES-001:look_for":
        return _res_still_open(method.get("source") or "")
    return True


def _group_still_open(rows: list[dict], closed: list[dict], filed: set[tuple[str, str]]) -> list[dict]:
    """One row per shape. Identical method lists are not repeated."""
    buckets: dict[str, list[dict]] = {}
    for row in rows:
        host = {
            "method": row.get("method"),
            "path": row.get("path"),
            "start_line": row.get("start_line"),
            "end_line": row.get("end_line"),
        }
        for shape in row.get("shapes") or []:
            rule_id, _, name = shape.partition(":")
            if name != "look_for" and (rule_id, name) in filed:
                continue
            buckets.setdefault(shape, [])
            key = (host["method"], host["path"])
            seen = {(item["method"], item["path"]) for item in buckets[shape]}
            if key not in seen:
                buckets[shape].append(host)
    grouped = []
    for shape, hosts in buckets.items():
        if not hosts:
            continue
        rule_id = shape.split(":", 1)[0]
        grouped.append({
            "shape": shape,
            "closed_lines": _closed_lines_for(closed, rule_id),
            "hosts": hosts,
        })
    return grouped


def _nested_test_hits(repo: Path | None, paths: list[str], closed_lines: set[int]) -> list[dict]:
    """A production file that nests a test type. The import row is already closed."""
    if repo is None:
        return []
    hits = []
    seen: set[tuple[str, int]] = set()
    for rel in paths:
        if not rel or _TEST_PATH.search(rel.replace("\\", "/")):
            continue
        full = repo / rel
        if not full.is_file():
            continue
        try:
            text = full.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if number in closed_lines or not _NESTED_TEST_CLASS.search(line):
                continue
            key = (rel, number)
            if key in seen:
                continue
            seen.add(key)
            hits.append({
                "rule_id": "DES-001",
                "shape": "nested_test",
                "line": number,
                "file": rel,
                "method": "",
                "quote": _quote_line(line),
            })
    return hits


def _rule_reported_in_method(closed_lines: dict[str, set[int]], rule_id: str, method: dict) -> bool:
    """A report line closes the rule only inside the method that contains it."""
    lines = closed_lines.get(rule_id)
    if not lines:
        return False
    start = method.get("start_line")
    end = method.get("end_line")
    if not isinstance(start, int) or not isinstance(end, int):
        return False
    return any(start <= line <= end for line in lines)


def _has_uncoded_rule(method: dict, coded: set[str], look_for_ids: set[str]) -> bool:
    for rule_id in method.get("applicable") or []:
        if rule_id not in coded and rule_id in look_for_ids:
            return True
    return False


def _first_line(lines: list[tuple[int, str]], pattern: re.Pattern[str]) -> tuple[int, str] | None:
    for number, text in lines:
        if pattern.search(text):
            return number, text
    return None


def _method_candidates(
    method: dict,
    peers: dict[str, str],
    closed: list[dict],
) -> tuple[list[dict], list[str]]:
    """High-precision shapes for one method. Unmatched shapes of a known rule stay open."""
    source = method.get("source") or ""
    lines = _numbered_lines(source)
    blob = "\n".join(text for _number, text in lines)
    name = str(method.get("name") or "")
    hits: list[dict] = []
    open_shapes: list[str] = []
    if "@Test" in blob or "org.junit" in blob:
        return hits, open_shapes

    def add(rule_id: str, shape: str, found: tuple[int, str] | None, triggered: bool) -> None:
        if not triggered or _shape_closed(closed, rule_id, shape):
            return
        if found is not None and found[0] in {
            line
            for slot in closed
            if slot["rule_id"] == rule_id
            for line in slot["lines"] + slot["same_shape_lines"]
        }:
            return
        if found is None:
            if shape not in open_shapes:
                open_shapes.append(shape)
            return
        number, text = found
        hits.append({
            "rule_id": rule_id,
            "shape": shape,
            "line": number,
            "file": method.get("path"),
            "method": name,
            "quote": _quote_line(text),
        })

    posts_money = bool(re.search(r"setAvailableBalance|persist\s*\(|\.subtract\s*\(|\.add\s*\(", blob))
    amount = posts_money and ("getAmount" in blob or re.search(r"\bamount\b", blob) is not None)
    sign_guard = bool(re.search(r"signum\s*\(|<\s*0|<=\s*0|compareTo\(\s*BigDecimal\.ZERO", blob))
    null_guard = bool(re.search(r"amount\s*==\s*null|amount\s*!=\s*null", blob))
    add("BIZ-003", "fee_omitted", _first_line(lines, re.compile(r"compareTo\(\s*amount\s*\)")),
        "compareTo(amount)" in blob and ("totalDebit" in blob or ".add(fee)" in blob))
    add("BIZ-003", "negative_amount", _first_line(lines, re.compile(r"getAmount\s*\(|\bamount\b")),
        amount and not sign_guard)
    add("BIZ-003", "zero_amount",
        _first_line(lines, re.compile(r"compareTo\(\s*amount\s*\)|getAmount\s*\(|\.add\s*\(\s*amount\s*\)")),
        amount and not sign_guard and "BigDecimal.ZERO" not in blob)
    add("BIZ-003", "null_amount", _first_line(lines, re.compile(r"amount\.equals\s*\(")),
        "amount.equals" in blob and not null_guard)
    for peer_name, peer_source in peers.items():
        if peer_name == name or "getInstance" not in peer_source or "ZoneId" in peer_source:
            continue
        if "Calendar" not in peer_source and "LocalDateTime.now" not in peer_source:
            continue
        called = _first_line(lines, re.compile(r"\b" + re.escape(peer_name) + r"\s*\("))
        if called:
            add("BIZ-003", "default_zone_cutoff", called, True)
            break
    add("AUTH-002", "role_substring",
        _first_line(lines, re.compile(r"""\.contains\(\s*["']ADMIN["']\)|indexOf\(\s*["']ADMIN["']\)""")),
        "contains(" in blob or "indexOf(" in blob)
    add("AUTH-001", "unrestricted_object",
        _first_line(lines, re.compile(r"\|\|\s*!\s*\w*\.?isRestricted\s*\(")),
        "isRestricted" in blob)
    add("AUTH-001", "unchecked_party",
        _first_line(lines, re.compile(r"persist\(\s*to\s*\)|to\.set\w+\(")),
        "checkAccess" in blob and "getToAccountNo" in blob and "checkAccess" not in "".join(
            text for _n, text in lines if "getToAccountNo" in text or "to," in text
        ))
    entry = bool(re.match(r"(?i)(purge|settle|handle)[A-Z]", name)) and "public" in blob
    authed = bool(re.search(r"(?i)\b(checkAccess|authorize|isAuthorized|hasRole)\s*\(", blob))
    signature = _first_line(lines, re.compile(r"\bpublic\b"))
    add("SEC-001", "route_without_authz", signature, entry and not authed)
    add("API-001", "purge_returns_success", _first_line(lines, re.compile(r"return\s+0\s*;")),
        "purge" in name.lower() and "return 0" in blob)
    add("PAY-001", "id_not_unique",
        _first_line(lines, re.compile(r"(?<!void )persist\s*\(|setAvailableBalance")),
        posts_money and "getTransferId" in blob and "reverse" not in name.lower()
        and "callback" not in name.lower() and not re.search(r"(?i)idempoten|alreadyExists", blob))
    add("PAY-002", "client_rate", _first_line(lines, re.compile(r"getFxRate\s*\(")), "getFxRate" in blob)
    add("PAY-007", "truncating_round", _first_line(lines, re.compile(r"RoundingMode\.DOWN")),
        "RoundingMode.DOWN" in blob)
    persist_at = blob.find("persist(")
    notify_at = blob.find("notify")
    add("PAY-005", "post_before_ack", _first_line(lines, re.compile(r"persist\s*\(")),
        persist_at >= 0 and notify_at >= 0 and persist_at < notify_at)
    add("PAY-005", "compensation_mismatch", _first_line(lines, re.compile(r"compensate\s*\(")),
        "compensate(" in blob)
    add("PAY-004", "webhook_without_signature",
        _first_line(lines, re.compile(r"setAvailableBalance")),
        ("callback" in name.lower() or "params.get" in blob) and "setAvailableBalance" in blob
        and not re.search(r"(?i)signature|hmac|verifySign", blob))
    add("PAY-006", "reverse_without_state",
        _first_line(lines, re.compile(r"setAvailableBalance")),
        "reverse" in name.lower() and "setAvailableBalance" in blob and not re.search(r"(?i)status", blob))
    add("BIZ-005", "deprecated_balance",
        _first_line(lines, re.compile(r"AvailableBalanceLegacy")),
        "AvailableBalanceLegacy" in blob and name not in {"loadAccount", "persist"}
        and bool(re.search(r"compareTo|subtract|\.add\s*\(", blob)))
    add("CONC-001", "check_then_act",
        _first_line(lines, re.compile(r"compareTo\s*\(")),
        "compareTo" in blob and "setAvailableBalance" in blob and "synchronized" not in blob)
    add("TXN-001", "multi_write", _first_line(lines, re.compile(r"persist\s*\(")),
        blob.count("persist(") >= 2)
    add("BND-001", "unread_expiry", _first_line(lines, re.compile(r"getRate\s*\(")),
        "getRate(" in blob and "fetchedAt" not in blob and not re.search(r"(?i)ttl|expir", blob))
    add("HYG-001", "identifier_in_output", _first_line(lines, re.compile(r"getCardNo\s*\(")),
        "getCardNo(" in blob)
    add("HYG-001", "identifier_in_output", _first_line(lines, re.compile(r"getCustomerName\s*\(")),
        "getCustomerName(" in blob and "html" in blob.lower())
    add("CONC-003", "collection_write", _first_line(lines, re.compile(r"\.put\s*\(")),
        ".put(" in blob and "synchronized" not in blob and re.search(r"(?i)map|cache", blob))
    add("NULL-001", "unguarded_parse",
        _first_line(lines, re.compile(r"new\s+BigDecimal\s*\([^)]*\.get\s*\(")),
        "new BigDecimal" in blob and ".get(" in blob)
    add("LOGIC-001", "inverted_condition",
        _first_line(lines, re.compile(r"\|\|\s*!\s*\w*\.?isRestricted\s*\(")),
        "isRestricted" in blob)
    own_slice = _first_line(lines, re.compile(r"subList\s*\("))
    if own_slice and re.search(r"-\s*\w+\s*-\s*1", own_slice[1]):
        add("LOGIC-001", "off_by_one_slice", own_slice, True)
    else:
        for peer_name, peer_source in peers.items():
            if peer_name == name or not re.search(r"\b" + re.escape(peer_name) + r"\s*\(", blob):
                continue
            sliced = _first_line(_numbered_lines(peer_source), re.compile(r"subList\s*\("))
            if not sliced or not re.search(r"-\s*\w+\s*-\s*1", sliced[1]):
                continue
            add("LOGIC-001", "off_by_one_slice", sliced, True)
            if hits and hits[-1]["shape"] == "off_by_one_slice":
                hits[-1]["method"] = peer_name
            break
    retry = _first_line(lines, re.compile(r"\bfor\s*\("))
    add("BIZ-001", "retry_without_idempotency", retry,
        "for (" in blob and "notify" in blob and not re.search(r"(?i)idempoten", blob))
    add("BIZ-001", "write_without_idempotency", _first_line(lines, re.compile(r"(?<!void )persist\s*\(")),
        name != "persist" and re.search(r"(?<!void )persist\s*\(", blob) and not re.search(r"(?i)idempoten", blob))
    add("BIZ-002", "missing_previous_status", _first_line(lines, re.compile(r"persist\s*\(")),
        "settle" in name.lower() and "persist(" in blob and not re.search(r"(?i)\bstatus\b", blob))
    loop_persist = _first_line(lines, re.compile(r"persist\s*\("))
    batch = "settle" in name.lower()
    add("BIZ-004", "failure_continues", loop_persist, batch and "for (" in blob and "persist(" in blob)
    add("BIZ-004", "no_precondition", _first_line(lines, re.compile(r"\.subtract\s*\(")),
        batch and "for (" in blob and ".subtract(" in blob and "compareTo" not in blob)
    closed_ids = {
        line
        for slot in closed
        if slot.get("rule_id") == "TEN-005"
        for line in (slot.get("lines") or []) + (slot.get("same_shape_lines") or [])
    }
    if _REVERSAL_NAME.search(name):
        for number, text in lines:
            if number in closed_ids or not _EXTRA_ID_LOOKUP.search(text):
                continue
            add("TEN-005", "id_lookup_omits_tenant", (number, text), True)
    # A triggered shape that was not located stays open. Applicable rules
    # without a coded shape stay open as look_for so the model still judges them.
    # A report line closes that rule only for the method that contains the line.
    mapped = _coded_rule_ids()
    look_for_ids = _look_for_rule_ids()
    closed_lines = _closed_line_set(closed)
    for rule_id in method.get("applicable") or []:
        if rule_id in mapped or rule_id not in look_for_ids:
            continue
        if any(hit["rule_id"] == rule_id for hit in hits):
            continue
        if _rule_reported_in_method(closed_lines, rule_id, method):
            continue
        open_shapes.append(f"{rule_id}:look_for")
    if entry and not authed and not any(hit["rule_id"] == "SEC-001" for hit in hits):
        if not _shape_closed(closed, "SEC-001", "route_without_authz"):
            open_shapes.append("SEC-001:route_without_authz")
    qualified = []
    for item in open_shapes:
        if ":" in item:
            qualified.append(item)
            continue
        owner = next((rule_id for rule_id, shapes in list(RULE_SHAPES.items()) + [("BIZ-002", ("missing_previous_status",))] if item in shapes), "")
        if owner:
            qualified.append(f"{owner}:{item}")
    deduped = []
    for item in qualified:
        if item not in deduped:
            deduped.append(item)
    return hits, deduped


_CARD_TEXT = {
    ("AUTH-001", "unchecked_party"): (
        "转入账户缺少权限校验",
        "在第 {line} 行检测到 `{quote}`。这次写入的另一个账户没有经过与转出账户相同的权限校验。{also}",
        "将第 {line} 行 `{quote}` 改为：先对该账户做权限校验，通过后再入账。",
    ),
    ("AUTH-001", "unrestricted_object"): (
        "未受限账户被跨网点放行",
        "在第 {line} 行检测到 `{quote}`。网点不一致时，账户只要未标记受限，操作员仍获得权限。{also}",
        "将第 {line} 行 `{quote}` 改为：`&& !account.isRestricted()`，网点一致且账户未受限才放行。",
    ),
    ("AUTH-002", "role_substring"): (
        "管理员角色按子串匹配",
        "在第 {line} 行检测到 `{quote}`。角色串里出现 ADMIN 这四个字符就会获得全部权限。{also}",
        "将第 {line} 行 `{quote}` 改为：按分隔后的角色集合做相等比较，仅当存在完整角色 ADMIN 时放行。",
    ),
    ("SEC-001", "route_without_authz"): (
        "资金与清理入口缺少鉴权",
        "在第 {line} 行检测到 `{quote}`。变更余额或删除记录之前没有操作员校验。{also}",
        "将第 {line} 行 `{quote}` 改为：方法开始处校验已认证主体及其权限，未通过时返回拒绝且不改余额。",
    ),
    ("PAY-001", "id_not_unique"): (
        "转账号可以重复入账",
        "在第 {line} 行检测到 `{quote}`。业务单号只出现在日志或列表里，写入前没有按该号拒绝第二笔。{also}",
        "将第 {line} 行 `{quote}` 改为：以转账号做唯一约束，已存在的单号直接返回原结果。",
    ),
    ("PAY-002", "client_rate"): (
        "入账汇率来自请求参数",
        "在第 {line} 行检测到 `{quote}`。客户端传入的汇率直接决定贷记金额。{also}",
        "将第 {line} 行 `{quote}` 改为：使用服务端牌价换算，汇率只从牌价服务获取。",
    ),
    ("PAY-004", "webhook_without_signature"): (
        "商户回调未验签即入账",
        "在第 {line} 行检测到 `{quote}`。请求里的金额被直接加到账户，没有核对渠道签名，同一次通知可以反复入账。{also}",
        "将第 {line} 行 `{quote}` 改为：先验渠道签名和事件号唯一性，通过后再按服务端订单金额入账一次。",
    ),
    ("PAY-005", "post_before_ack"): (
        "网关确认前已完成入账",
        "在第 {line} 行检测到 `{quote}`。本地余额在外部确认之前已经落库，中间没有待确认或冻结状态。{also}",
        "将第 {line} 行 `{quote}` 改为：先写入待确认状态并冻结金额，外部确认成功后再提交为已入账。",
    ),
    ("PAY-005", "compensation_mismatch"): (
        "冲正记到了错误账户",
        "在第 {line} 行检测到 `{quote}`。冲正使用的账户或金额与刚才借记、贷记的那一笔不一致。{also}",
        "将第 {line} 行 `{quote}` 改为：按原付款账户加回借记额，并按原收款账户扣回贷记额。",
    ),
    ("PAY-006", "reverse_without_state"): (
        "冲正未核对原交易状态",
        "在第 {line} 行检测到 `{quote}`。找到记录后直接加减余额，没有核对原状态，也没有重新执行限额和权限校验。{also}",
        "将第 {line} 行 `{quote}` 改为：仅当原状态属于可冲正集合时，重新执行限额、权限和余额校验，再按原借记金额回退。",
    ),
    ("PAY-007", "truncating_round"): (
        "换汇乘法向下截断且尾差未入账",
        "在第 {line} 行检测到 `{quote}`。乘法结果向零截断，被去掉的尾差没有记入任何账户。{also}",
        "将第 {line} 行 `{quote}` 改为：`setScale(2, RoundingMode.HALF_UP)`，并把舍去的余数记入尾差账户。",
    ),
    ("TXN-001", "multi_write"): (
        "多笔余额更新没有事务",
        "在第 {line} 行检测到 `{quote}`。多笔余额更新没有放在同一个事务里。{also}",
        "将第 {line} 行 `{quote}` 改为：与同一次业务的其他余额更新放在同一数据库事务中，任一失败则整笔回滚。",
    ),
    ("BIZ-002", "missing_previous_status"): (
        "批量清算未读取先前状态",
        "在第 {line} 行检测到 `{quote}`。扣减前没有读取该笔是否已经清算或处于允许的状态。{also}",
        "将第 {line} 行 `{quote}` 改为：先读取转账状态，仅允许从待清算迁到已清算后再扣减余额。",
    ),
    ("BIZ-003", "fee_omitted"): (
        "余额校验未计入手续费",
        "在第 {line} 行检测到 `{quote}`。余额只和本金比较，同一方法里实际借记的是本金加手续费。{also}",
        "将第 {line} 行 `{quote}` 改为：在算出手续费并得到应借记总额之后，再与可用余额比较，不足时拒绝。",
    ),
    ("BIZ-003", "negative_amount"): (
        "负数金额会调换借贷方向",
        "在第 {line} 行检测到 `{quote}`。负数可以通过限额和余额判断，付款侧减法会变成加款，收款侧加法会变成扣款。{also}",
        "将第 {line} 行 `{quote}` 改为：在比较前拒绝 `amount.signum() < 0`。",
    ),
    ("BIZ-003", "zero_amount"): (
        "零金额转账仍会入账",
        "在第 {line} 行检测到 `{quote}`。金额为 0 时比较通过，随后仍计算手续费并入账。{also}",
        "将第 {line} 行 `{quote}` 改为：金额等于 0 时返回拒绝。",
    ),
    ("BIZ-003", "null_amount"): (
        "空金额被记成系统错误",
        "在第 {line} 行检测到 `{quote}`。金额为空时这里抛出异常，并被收成笼统的系统错误。{also}",
        "将第 {line} 行 `{quote}` 改为：金额为空时返回明确的拒绝码。",
    ),
    ("BIZ-003", "default_zone_cutoff"): (
        "清算截止时间使用默认时区",
        "在第 {line} 行检测到 `{quote}`。截止判断走服务器默认时区，部署区域变化后截止时刻会错位。{also}",
        "将第 {line} 行 `{quote}` 改为：用清算业务时区 `Asia/Shanghai` 比较当前时刻与截止时刻。",
    ),
    ("BIZ-004", "no_precondition"): (
        "批量清算逐笔没有前置条件",
        "在第 {line} 行检测到 `{quote}`。循环对每一笔直接扣减，没有逐笔核对可用余额、转账状态和权限。{also}",
        "将第 {line} 行 `{quote}` 改为：该笔先通过余额、状态和权限校验，失败时记下该笔并停止后续扣减。",
    ),
    ("BIZ-004", "failure_continues"): (
        "单笔落库失败后批次继续",
        "在第 {line} 行检测到 `{quote}`。落库失败被吞掉后调用方继续处理后续请求。{also}",
        "将第 {line} 行 `{quote}` 改为：让落库失败向上抛出，循环在该笔失败时停止并回滚已扣款项。",
    ),
    ("BIZ-005", "deprecated_balance"): (
        "入账读取已废弃余额",
        "在第 {line} 行检测到 `{quote}`。借记和贷记通过已废弃的余额字段决定。{also}",
        "将第 {line} 行 `{quote}` 改为：读取当前可用余额，并在写入点改用现行 setter。",
    ),
    ("CONC-001", "check_then_act"): (
        "余额先读后写缺少原子保护",
        "在第 {line} 行检测到 `{quote}`。比较通过后到写回新余额之间，没有在同一条语句里重读校验。{also}",
        "将第 {line} 行 `{quote}` 改为：用带余额条件的单条更新语句扣减，影响行数为 0 时拒绝。",
    ),
    ("CONC-003", "collection_write"): (
        "汇率缓存被并发写入",
        "在第 {line} 行检测到 `{quote}`。普通 Map 在转账线程里写入时没有锁。{also}",
        "将第 {line} 行 `{quote}` 改为：换用并发 Map，或在同一把锁内完成读取与写入。",
    ),
    ("BND-001", "unread_expiry"): (
        "缓存汇率不按有效期失效",
        "在第 {line} 行检测到 `{quote}`。条目保存了获取时间，这里直接使用汇率，没有和有效期比较。{also}",
        "将第 {line} 行 `{quote}` 改为：当前时间减去获取时间超过有效期时重新拉取牌价，再用新汇率计算。",
    ),
    ("LOGIC-001", "off_by_one_slice"): (
        "审计轨迹尾部截取越界",
        "在第 {line} 行检测到 `{quote}`。按长度减去条数再减一会多取一条，轨迹更短时起点为负并抛出越界异常。{also}",
        "将第 {line} 行 `{quote}` 改为：起点使用 `Math.max(0, steps.size() - tailSize)`，只返回末尾指定条数。",
    ),
    ("LOGIC-001", "inverted_condition"): (
        "权限条件把网点校验接成了或",
        "在第 {line} 行检测到 `{quote}`。网点相等与账户未受限用或连接，网点不同的操作员在账户未受限时得到通过结果。{also}",
        "将第 {line} 行 `{quote}` 改为：`&& !account.isRestricted()`。",
    ),
    ("API-001", "purge_returns_success"): (
        "清理失败时返回零行",
        "在第 {line} 行检测到 `{quote}`。公开清理在失败时返回 0，调用方把它和删除了 0 行看成同一种结果。{also}",
        "将第 {line} 行 `{quote}` 改为：抛出带明确错误码的异常，并在执行删除前校验调用方具备清理权限。",
    ),
    ("HYG-001", "identifier_in_output"): (
        "日志和回单写出了卡号",
        "在第 {line} 行检测到 `{quote}`。卡号、姓名或商户号被写入日志或回单。{also}",
        "将第 {line} 行 `{quote}` 改为：只记录卡号末四位和账号掩码，回单与日志同样掩码后再写。",
    ),
    ("TEN-005", "id_lookup_omits_tenant"): (
        "冲正按账号读取未校验租户",
        "在第 {line} 行检测到 `{quote}`。冲正按账号读取账户时没有带上租户。{also}",
        "将第 {line} 行 `{quote}` 改为：按服务端租户和账号一起读取，租户不一致时按未找到拒绝冲正。",
    ),
    ("DES-001", "nested_test"): (
        "生产类内嵌测试",
        "在第 {line} 行检测到 `{quote}`。结算生产类型中嵌套了测试类，测试框架随生产类一起进入编译单元。",
        "将第 {line} 行 `{quote}` 改为：把该测试类移到独立的测试源码文件。",
    ),
}


def _fill_candidate_card(hit: dict) -> None:
    also_lines = hit.get("also_lines") or []
    also = ""
    if also_lines:
        joined = "、".join(f"第 {number} 行" for number in also_lines)
        also = f"{joined}与第 {hit['line']} 行同一处修复。"
    title, risk, fix = _CARD_TEXT.get(
        (hit["rule_id"], hit["shape"]),
        (
            hit["shape"],
            "在第 {line} 行检测到 `{quote}`。{also}",
            "将第 {line} 行 `{quote}` 改为：按该形状的安全写法处理。",
        ),
    )
    fields = {"line": hit["line"], "quote": hit.get("quote") or "", "also": also}
    hit["title"] = title
    hit["risk"] = risk.format(**fields)
    hit["fix"] = fix.format(**fields)
    hit["title_en"] = ""
    hit["risk_en"] = ""
    hit["fix_en"] = ""


def _write_prefilled_judgment(pack: Path, candidate_hits: list[dict], resolved_oracles: list[dict] | None = None) -> None:
    """Write findings once. The model adds only still-open test_oracle rows."""
    findings = []
    suspect_hits = []
    for hit in candidate_hits:
        row = {
            "title": hit.get("title") or "",
            "title_en": "",
            "line": hit.get("line"),
            "file": hit.get("file") or "",
            "severity": hit.get("severity") or "p1",
            "rule_id": hit.get("rule_id") or "",
            "shape": hit.get("shape") or "",
            "risk": hit.get("risk") or "",
            "risk_en": "",
            "fix": hit.get("fix") or "",
            "fix_en": "",
        }
        if hit.get("same_fix") and hit.get("also_lines"):
            row["same_fix"] = True
            row["also_lines"] = list(hit["also_lines"])
        suspect_id = hit.get("derive_suspect_id")
        if suspect_id:
            row["derive_suspect_id"] = suspect_id
            suspect_hits.append(suspect_id)
        findings.append(row)
    for row in resolved_oracles or []:
        if not isinstance(row, dict):
            continue
        suspect_id = row.get("derive_suspect_id")
        if suspect_id and suspect_id not in suspect_hits and any((row.get("oracle") or {}).values()):
            suspect_hits.append(suspect_id)
    write_json(pack / "judgment.json", {
        "findings": findings,
        "suspect_hits": suspect_hits,
        "test_oracle": [row for row in (resolved_oracles or []) if isinstance(row, dict)],
        "note": (
            "Findings are copied from candidate_hits. Add test_oracle only for test_oracle_open. "
            "Do not rewrite findings. Copy preset and judge only questions."
        ),
    })


def _oracle_presets(name: str, source: str) -> dict:
    """Flags a scan can decide without a second pass. Empty keys stay with the model.

    boundary_missed: the name claims a boundary and the asserted value is a
    numeric literal compared with a different named limit.
    threshold_pass: the assertion is a loose elapsed/duration ceiling.
    branch_uncovered stays open only when the name claims an outcome the assertion does not read.
    """
    preset: dict[str, bool] = {}
    if (
        _BOUNDARY_NAME.search(name)
        and _COMPARES_NAMED_LIMIT.search(source)
        and _SETS_NUMERIC.search(source)
        and not _SETS_CONSTANT.search(source)
    ):
        preset["boundary_missed"] = True
    if _LOOSE_TIME.search(source):
        preset["threshold_pass"] = True
    return preset


def _assertion_text(source: str) -> str:
    """Assertion lines only. The method name is not evidence that the claim was read."""
    kept = []
    for line in source.splitlines():
        match = re.match(r"^\d+\|(.*)$", line)
        body = match.group(1) if match else line
        if _ASSERT_CALL.search(body):
            kept.append(body)
    return "\n".join(kept)


def _claim_status(name: str, source: str) -> str:
    """satisfied when every claimed token is read by an assertion."""
    folded = name.lower()
    asserted = _assertion_text(source)
    saw = False
    for token, pattern in _CLAIM_PATTERNS:
        if token not in folded:
            continue
        saw = True
        if not re.search(pattern, asserted):
            return "unmatched"
    return "satisfied" if saw else "none"


def _unsafe_pass(source: str) -> bool | None:
    """True for an asserted sensitive literal in HTML, a body, or a log. None stays open."""
    if not _SINK_WORD.search(source):
        return False
    if _ASSERT_TRUE_SENSITIVE.search(source):
        return True
    if _CONTAINS_CALL.search(source):
        return None
    return False


def _branch_uncovered(name: str, source: str, flags: dict) -> bool | None:
    """None only when the name makes no listed claim and still calls the service."""
    if not _ASSERT_CALL.search(source):
        return True
    if flags.get("boundary_missed") or flags.get("threshold_pass") or flags.get("unsafe_pass"):
        return False
    if flags.get("locks_private"):
        return False
    status = _claim_status(name, source)
    if status == "unmatched":
        return True
    if status == "satisfied":
        return False
    if _ASSERT_CALL.search(source) and not _SERVICE_CALL.search(source):
        return False
    return None


def _oracle_classify(name: str, source: str, private_names: set[str]) -> tuple[dict, list[str]]:
    """Decided flags, plus the keys the model still has to set.

    An empty question list means the row is closed. All-false rows are omitted.
    A true flag is written onto judgment.json so seal keeps the hit.
    """
    flags = {key: False for key in _ORACLE_FLAG_KEYS}
    if any(
        re.search(r"\b" + re.escape(member) + r"\s*\(", source) and member != name
        for member in private_names
    ):
        flags["locks_private"] = True
    flags.update(_oracle_presets(name, source))
    if _OBS_ASSERT.search(source):
        flags["observability_asserted"] = True
    pending: list[str] = []
    if _DEPENDENCY.search(source):
        pending.append("locks_dependency")
    unsafe = _unsafe_pass(source)
    if unsafe is None:
        pending.append("unsafe_pass")
    else:
        flags["unsafe_pass"] = unsafe
    branch = _branch_uncovered(name, source, flags)
    if branch is None:
        pending.append("branch_uncovered")
    else:
        flags["branch_uncovered"] = branch
    return flags, pending


def _drop_judged_suspects(suspects: list[dict], pack: Path) -> list[dict]:
    """Ids already copied onto judgment.json are closed. The model does not re-read them."""
    written = load_json(pack / "judgment.json") or {}
    judged = {str(item) for item in (written.get("suspect_hits") or []) if item}
    if not judged:
        return suspects
    return [
        suspect
        for suspect in suspects
        if str(suspect.get("derive_suspect_id") or "") not in judged
    ]


def _methods_for_open_lines(methods: list[dict], lines: set[int]) -> list[dict]:
    if not lines:
        return []
    return [
        method
        for method in methods
        if any(method["start_line"] <= line <= method["end_line"] for line in lines)
    ]


def _private_method_names(methods: list[dict]) -> set[str]:
    names = set()
    for method in methods:
        for _number, text in _numbered_lines(method.get("source") or ""):
            match = re.search(r"\bprivate\b[^;{=\n]*\b(\w+)\s*\(", text)
            if match:
                names.add(match.group(1))
    return names


CHAIN_DIMENSION_RULES = (
    {
        "id": "resilience",
        "title": "韧性",
        "look_for": "这条链上的数据库、网关或远程调用没有超时；重试没有退避或幂等；异常被吞掉后仍入账或继续批处理。",
        "do_not_report": "链上已有超时、退避和补偿，或该行已在 closed_shapes、candidate_hits 中。",
    },
    {
        "id": "privacy",
        "title": "隐私",
        "look_for": "这条链把卡号、证件、邮箱或姓名写入日志、回单、文件或响应。",
        "do_not_report": "链上只保留掩码或令牌，或该行已有卡片。",
    },
    {
        "id": "performance",
        "title": "性能",
        "look_for": "这条链在循环里逐条访问数据库或远程接口，或在热路径上无界增长缓存。",
        "do_not_report": "访问在循环外合并，或缓存有上限和失效。",
    },
    {
        "id": "observability",
        "title": "可观测性",
        "look_for": "这条链捕获失败后没有日志、指标或链路标识。",
        "do_not_report": "失败路径已写日志、指标或链路标识。",
    },
    {
        "id": "contract",
        "title": "契约",
        "look_for": "这条链把调用方文本拼进 HTML，或把失败返回成成功。",
        "do_not_report": "输出已转义，失败用明确拒绝码返回。",
    },
    {
        "id": "rollout",
        "title": "变更与发布",
        "look_for": "这条链同时写新旧两套状态，却没有开关、迁移或回滚。",
        "do_not_report": "链上能看出开关、迁移步骤或回滚路径。",
    },
    {
        "id": "design",
        "title": "架构契合",
        "look_for": "这条链从入口直接拼 SQL 或直接打开连接，或生产类型里嵌着测试。",
        "do_not_report": "入口经过已有的数据访问边界，测试在独立源码中。",
    },
    {
        "id": "complexity",
        "title": "复杂度",
        "look_for": "这条链上一个方法同时做校验、入账、通知和审计，失败路径被分支挡住。",
        "do_not_report": "这些步骤已拆到链上不同的方法，且失败路径看得清。",
    },
    {
        "id": "dependencies",
        "title": "依赖",
        "look_for": "这条链要靠过期库或快照版本才能编译或运行。",
        "do_not_report": "链上没有过期库或快照版本。",
    },
    {
        "id": "maintainability",
        "title": "可维护性",
        "look_for": "这条链用魔法数或未完成的 TODO 决定金额、超时或限额。",
        "do_not_report": "金额、超时和限额来自命名常量或配置，且该字面量已在规范项。",
    },
)
_CHAIN_LIMIT = 24
_CHAIN_DEPTH = 6
_CHAIN_SOURCE_LINES = 40


def _symbol_table(pack: Path) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for name in ("05-coverage-universe.json", "05-changed-symbols.json"):
        doc = load_json(pack / name)
        if not isinstance(doc, dict):
            continue
        nodes = doc.get("nodes") or (doc.get("result") or {}).get("nodes") or []
        for node in nodes:
            if not isinstance(node, dict) or not node.get("id"):
                continue
            found[str(node["id"])] = node
    return found


def _impact_edges(pack: Path) -> list[dict]:
    impact = pack / "impact"
    if not impact.is_dir():
        return []
    rows = []
    seen = set()
    for path in sorted(impact.glob("*/edges-in.json")):
        doc = load_json(path)
        if not isinstance(doc, dict):
            continue
        for edge in doc.get("edges") or []:
            if not isinstance(edge, dict):
                continue
            key = (
                str(edge.get("from_id") or ""),
                str(edge.get("to_id") or ""),
                str(edge.get("call_info") or ""),
            )
            if key in seen or not key[0] or not key[1]:
                continue
            seen.add(key)
            rows.append(edge)
    return rows


def _call_info(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _step_source(method: dict | None, repo: Path | None, file_path: str, start, end) -> str:
    if method and method.get("source"):
        lines = method["source"].splitlines()
        return "\n".join(lines[:_CHAIN_SOURCE_LINES])
    if repo is None or not file_path or not isinstance(start, int):
        return ""
    full = repo / file_path
    if not full.is_file():
        return ""
    try:
        text = full.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    stop = end if isinstance(end, int) and end >= start else start
    stop = min(stop, start + _CHAIN_SOURCE_LINES - 1, len(text))
    return "\n".join(f"{number}|{text[number - 1]}" for number in range(start, stop + 1))


def _walk_chains(outgoing: dict[str, list[tuple[str, dict]]], roots: list[str]) -> list[list[tuple[str, dict]]]:
    """Each chain starts at a CodexQA caller and ends at the last callee."""
    chains = []

    def walk(node: str, path: list[tuple[str, dict]]) -> None:
        if len(chains) >= _CHAIN_LIMIT:
            return
        nxt = outgoing.get(node) or []
        if not nxt or len(path) >= _CHAIN_DEPTH:
            if len(path) >= 2:
                chains.append(path)
            return
        extended = False
        for to_id, info in nxt:
            if any(step[0] == to_id for step in path):
                continue
            extended = True
            walk(to_id, path + [(to_id, info)])
        if not extended and len(path) >= 2:
            chains.append(path)

    for root in roots:
        if len(chains) >= _CHAIN_LIMIT:
            break
        walk(root, [(root, {})])
    return chains


def build_chain_dimensions(pack: Path, methods: list[dict], repo: Path | None) -> dict:
    """CodexQA call chains plus the dimension semantic rules for one LLM pass."""
    symbols = _symbol_table(pack)
    edges = _impact_edges(pack)
    outgoing: dict[str, list[tuple[str, dict]]] = {}
    incoming = set()
    for edge in edges:
        info = _call_info(edge.get("call_info"))
        info["from_file"] = edge.get("from_file") or ""
        info["to_file"] = edge.get("to_file") or ""
        from_id = str(edge.get("from_id") or "")
        to_id = str(edge.get("to_id") or "")
        outgoing.setdefault(from_id, []).append((to_id, info))
        incoming.add(to_id)
    roots = [node for node in outgoing if node not in incoming]
    if not roots:
        roots = list(outgoing)
    by_name = {
        (str(method.get("name") or ""), str(method.get("path") or "")): method
        for method in methods
    }
    chains = []
    seen = set()
    for path in _walk_chains(outgoing, roots):
        steps = []
        for index, (node_id, info) in enumerate(path):
            node = symbols.get(node_id) or {}
            name = str(node.get("name") or info.get("callee") or "")
            file_path = str(
                node.get("file_path") or node.get("path") or info.get("to_file") or info.get("from_file") or ""
            )
            start = node.get("start_line")
            end = node.get("end_line")
            method = by_name.get((name, file_path))
            call = path[index + 1][1] if index + 1 < len(path) else {}
            line = call.get("line")
            if not isinstance(line, int):
                line = start if isinstance(start, int) else None
            calls = str(call.get("callee") or "")
            if not calls and index + 1 < len(path):
                nxt = symbols.get(path[index + 1][0]) or {}
                calls = str(nxt.get("name") or "")
            steps.append({
                "name": name,
                "file": file_path,
                "line": line,
                "calls": calls,
                "source": _step_source(method, repo, file_path, start, end),
            })
        key = tuple((step["name"], step["file"], step["line"]) for step in steps)
        if not steps or key in seen:
            continue
        seen.add(key)
        chains.append({"id": f"chain-{len(chains) + 1}", "steps": steps})
    return {
        "kind": "ChainDimensions",
        "rules": [dict(rule) for rule in CHAIN_DIMENSION_RULES],
        "chains": chains,
        "note": "Judge only these CodexQA call chains. Do not invent a caller.",
    }


def write_model_brief(pack: Path, packet: dict, repo: Path | None = None) -> None:
    """One deterministic read for the model. Seal still owns report cards.

    Counts, closed report rows, seed hits, and getter bodies are folded here
    so the model does not re-parse 29, the seed, or seal-conclusion.py.
    """
    seed = load_json(pack / "judgment-seed.json") or {}
    closed_ids = {str(item) for item in (seed.get("suspect_hits") or []) if item}
    closed_oracle_lines = {
        int(row["line"])
        for row in (seed.get("test_oracle") or [])
        if isinstance(row, dict) and isinstance(row.get("line"), int)
    }
    report_lines: dict[str, list[int]] = {}
    report = packet.get("report") if isinstance(packet.get("report"), dict) else {}
    for row in report.get("pr_delta") or []:
        if not isinstance(row, dict) or not isinstance(row.get("line"), int):
            continue
        bucket = report_lines.setdefault(_rule_name(row), [])
        if row["line"] not in bucket:
            bucket.append(row["line"])
    for lines in report_lines.values():
        lines.sort()
    closed_shapes = _closed_shapes(report.get("pr_delta") or [], repo)
    if any(isinstance(row, dict) and row.get("rule_id") == "CONC-002" for row in (seed.get("findings") or [])):
        closed_shapes.append({
            "rule_id": "CONC-002",
            "shape": "opposite_lock_order",
            "lines": [],
            "same_shape_lines": [],
        })

    slices = _slice_text(packet)
    policies = {}
    suspects = packet.get("suspects") if isinstance(packet.get("suspects"), dict) else {}
    if isinstance(suspects.get("policies"), dict):
        policies = suspects["policies"]
    open_suspects = []
    seen_ids: set[str] = set()
    for key in ("packets", "sast_packets"):
        for row in suspects.get(key) or []:
            if not isinstance(row, dict):
                continue
            sid = _suspect_id(row)
            if sid in closed_ids or sid in seen_ids:
                continue
            line = row.get("line")
            if row.get("kind") == "test_oracle" and isinstance(line, int) and line in closed_oracle_lines:
                continue
            seen_ids.add(sid)
            ref = row.get("slice_ref") if isinstance(row.get("slice_ref"), dict) else {}
            policy = policies.get(str(row.get("kind") or ""))
            look = ""
            if isinstance(policy, dict):
                look = str(policy.get("look_for") or "")
            open_suspects.append({
                "derive_suspect_id": sid,
                "kind": row.get("kind"),
                "file": row.get("file") or row.get("path"),
                "line": line,
                "look_for": look,
                "source": slices.get(str(ref.get("symbol_id") or ""), ""),
            })

    open_lines = {int(row["line"]) for row in open_suspects if isinstance(row.get("line"), int)}
    catalog = []
    for row in packet.get("pending") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("kind") or "") == "file_scope" or str(row.get("symbol_id") or "").startswith("file-scope:"):
            continue
        start = row.get("start_line")
        end = row.get("end_line")
        if not isinstance(start, int) or not isinstance(end, int):
            continue
        catalog.append({
            "name": row.get("name"),
            "path": row.get("path"),
            "start_line": start,
            "end_line": end,
            "applicable": [str(item) for item in (row.get("applicable") or [])],
            "source": slices.get(str(row.get("symbol_id") or ""), ""),
        })
    coded = _coded_rule_ids()
    look_for_ids = _look_for_rule_ids()
    methods = []
    for method in catalog:
        holds_open = any(method["start_line"] <= line <= method["end_line"] for line in open_lines)
        span = method["end_line"] - method["start_line"]
        if span >= 8 or holds_open or _has_uncoded_rule(method, coded, look_for_ids):
            methods.append(method)
    for method in catalog:
        if method in methods:
            continue
        span = method["end_line"] - method["start_line"]
        callee_name = str(method.get("name") or "")
        if not callee_name or span < 2 or span > 15:
            continue
        callee_source = method.get("source") or ""
        if _trivial_getter(callee_source):
            continue
        if not re.search(r"\b(if|for|while|try|catch|subList)\b|getInstance\s*\(|loadAccount\s*\(", callee_source):
            continue
        if any(re.search(r"\b" + re.escape(callee_name) + r"\s*\(", kept.get("source") or "") for kept in methods):
            method["callee_of"] = True
            methods.append(method)
    needed_rules: set[str] = set()
    for method in methods:
        needed_rules.update(method.get("applicable") or [])
    for suspect in open_suspects:
        line = suspect.get("line")
        path = str(suspect.get("file") or "")
        if not isinstance(line, int):
            continue
        cover = next(
            (
                method for method in methods
                if _same_brief_path(path, str(method.get("path") or ""))
                and method["start_line"] <= line <= method["end_line"]
                and method.get("source")
            ),
            None,
        )
        if cover is None:
            continue
        suspect["source_ref"] = {
            "where": "methods",
            "name": cover.get("name"),
            "path": cover.get("path"),
            "start_line": cover["start_line"],
            "end_line": cover["end_line"],
        }
        suspect["source"] = ""

    rules_in = packet.get("rules") if isinstance(packet.get("rules"), dict) else {}
    rules = {}
    for rid in sorted(needed_rules):
        body = rules_in.get(rid)
        if not isinstance(body, dict):
            continue
        rules[rid] = {key: body.get(key) for key in RULE_FIELDS if body.get(key)}

    maintain = load_json(pack / "18-maintainability-signals.json") or {}
    test_oracle_open = []
    resolved_oracles = []
    private_names = _private_method_names(methods)
    for row in maintain.get("test_oracle_inventory") or []:
        if not isinstance(row, dict) or row.get("skip_llm") is True:
            continue
        line = row.get("line")
        if not isinstance(line, int) or line in closed_oracle_lines:
            continue
        owner = next(
            (
                method for method in methods
                if method["start_line"] <= line <= method["end_line"]
            ),
            None,
        )
        owner_source = (owner or {}).get("source") or ""
        owner_name = str((owner or {}).get("name") or "")
        opened = {
            "line": line,
            "file": row.get("path") or row.get("file"),
            "derive_suspect_id": row.get("derive_suspect_id"),
            "questions": row.get("questions") or [],
        }
        if not owner_source:
            test_oracle_open.append(opened)
            continue
        flags, pending = _oracle_classify(owner_name, owner_source, private_names)
        if not pending:
            if any(flags.values()):
                resolved_oracles.append({
                    "line": line,
                    "file": opened["file"],
                    "derive_suspect_id": opened["derive_suspect_id"],
                    "oracle": flags,
                    "note": "脚本按测试正文填写预言。",
                })
            continue
        preset = {key: flags[key] for key in _ORACLE_FLAG_KEYS if key not in pending}
        if preset:
            opened["preset"] = preset
        opened["questions"] = pending
        test_oracle_open.append(opened)

    semantic_closed = 0
    reported = {line for lines in report_lines.values() for line in lines}
    semantic_open = []
    for row in packet.get("semantic_candidates") or []:
        if not isinstance(row, dict):
            continue
        line = row.get("line")
        if isinstance(line, int) and line in reported:
            semantic_closed += 1
            continue
        semantic_open.append({
            "kind": row.get("kind"),
            "file": row.get("file"),
            "line": line,
            "snippet": row.get("snippet"),
        })

    peers = {str(method.get("name") or ""): method.get("source") or "" for method in methods}
    lock_order_closed = any(
        isinstance(row, dict) and row.get("rule_id") == "CONC-002"
        for row in (seed.get("findings") or [])
    )
    candidate_hits = []
    still_open = []
    seen_hits = set()
    for method in methods:
        if method.get("callee_of"):
            continue
        hits, pending_shapes = _method_candidates(method, peers, closed_shapes)
        for hit in hits:
            key = (hit["rule_id"], hit["shape"], hit["line"], hit.get("file"))
            if key in seen_hits:
                continue
            seen_hits.add(key)
            candidate_hits.append(hit)
        if lock_order_closed:
            pending_shapes = [item for item in pending_shapes if not item.startswith("CONC-002:")]
        pending_shapes = [item for item in pending_shapes if _keep_open_shape(method, item)]
        if pending_shapes:
            still_open.append({
                "method": method.get("name"),
                "path": method.get("path"),
                "start_line": method.get("start_line"),
                "end_line": method.get("end_line"),
                "shapes": pending_shapes,
            })
    nested_closed = set(_closed_lines_for(closed_shapes, "DES-001"))
    nested_paths = []
    for method in methods:
        path = str(method.get("path") or "")
        if path and path not in nested_paths:
            nested_paths.append(path)
    for hit in _nested_test_hits(repo, nested_paths, nested_closed):
        key = (hit["rule_id"], hit["shape"], hit["line"], hit.get("file"))
        if key in seen_hits:
            continue
        seen_hits.add(key)
        candidate_hits.append(hit)
    merged_hits = []
    merged_index: dict[tuple[str, str], dict] = {}
    for hit in candidate_hits:
        key = (hit["rule_id"], hit["shape"])
        primary = merged_index.get(key)
        if primary is None:
            merged_index[key] = hit
            merged_hits.append(hit)
            continue
        extra = primary.setdefault("also_lines", [])
        if hit["line"] not in extra and hit["line"] != primary["line"]:
            extra.append(hit["line"])
    candidate_hits = merged_hits
    p1_shapes = {
        "zero_amount", "null_amount", "default_zone_cutoff", "unread_expiry",
        "collection_write", "off_by_one_slice", "inverted_condition", "truncating_round",
    }
    p2_shapes = {"nested_test"}
    for hit in candidate_hits:
        if hit["shape"] in p2_shapes:
            hit["severity"] = "p2"
        elif hit["shape"] in p1_shapes:
            hit["severity"] = "p1"
        else:
            hit["severity"] = "p0"
    filed_shapes = {(hit["rule_id"], hit["shape"]) for hit in candidate_hits}
    still_open = _group_still_open(still_open, closed_shapes, filed_shapes)
    for hit in candidate_hits:
        if hit.get("also_lines"):
            hit["same_fix"] = True
    for suspect in open_suspects:
        if suspect.get("kind") != "log_exposure" or not isinstance(suspect.get("line"), int):
            continue
        for hit in candidate_hits:
            if hit["rule_id"] != "HYG-001":
                continue
            if suspect["line"] != hit["line"]:
                extra = hit.setdefault("also_lines", [])
                if suspect["line"] not in extra:
                    extra.append(suspect["line"])
            hit["derive_suspect_id"] = suspect.get("derive_suspect_id")
            if hit.get("also_lines"):
                hit["same_fix"] = True
    for hit in candidate_hits:
        _fill_candidate_card(hit)
    _write_prefilled_judgment(pack, candidate_hits, resolved_oracles)

    work = pack / "judgment-work"
    groups = sorted(path.name for path in work.glob("group-*.json")) if work.is_dir() else []
    open_suspects = _drop_judged_suspects(open_suspects, pack)
    open_oracle_lines = {
        int(row["line"])
        for row in test_oracle_open
        if isinstance(row.get("line"), int)
    }
    open_suspects = [
        suspect for suspect in open_suspects
        if str(suspect.get("kind") or "") != "test_oracle" or suspect.get("line") in open_oracle_lines
    ]
    oracle_only = not still_open and not groups
    if oracle_only:
        methods = _methods_for_open_lines(methods, open_oracle_lines)
        open_suspects = []
    if groups:
        for method in methods:
            method["source"] = ""
        for suspect in open_suspects:
            ref = suspect.get("source_ref")
            if isinstance(ref, dict) and ref.get("where") == "methods":
                ref["where"] = "judgment-work"
    perf = {}
    dimensions = packet.get("dimensions") if isinstance(packet.get("dimensions"), dict) else {}
    perf_card = dimensions.get("performance") if isinstance(dimensions.get("performance"), dict) else {}
    if isinstance(perf_card.get("counts"), dict):
        perf = perf_card["counts"]
    tier = packet.get("risk_tier") if isinstance(packet.get("risk_tier"), dict) else {}
    language = packet.get("language") if isinstance(packet.get("language"), dict) else {}
    read_this = BRIEF_READ_THIS
    if oracle_only:
        read_this += (
            " still_open is empty. This brief omits closed_shapes, candidate_hits, and rules. "
            "Findings are already in judgment.json."
        )
    brief = {
        "kind": "ModelBrief",
        "schema_version": 1,
        "generated_by": "build-judgment-packet.py",
        "read_this": read_this,
        "scale": {
            "primary_language": language.get("primary_language"),
            "tier": tier.get("tier"),
            "evidence_floor": tier.get("evidence_floor"),
            "pending_symbols": len(packet.get("pending") or []),
            "report_rows": sum(len(lines) for lines in report_lines.values()),
            "methods": len(methods),
            "callees": sum(1 for method in methods if method.get("callee_of")),
            "candidate_hits": len(candidate_hits),
            "still_open": len(still_open),
            "open_suspects": len(open_suspects),
            "question_fanout": bool(packet.get("question_fanout")) or bool(groups),
            "performance": perf,
        },
        "closed_report": {} if oracle_only else report_lines,
        "closed_shapes": [] if oracle_only else closed_shapes,
        "candidate_hits": [] if oracle_only else candidate_hits,
        "still_open": still_open,
        "oracle_flags": ORACLE_FLAGS,
        "lock_order_closed": lock_order_closed,
        "semantic_closed": semantic_closed,
        "semantic_open": [] if oracle_only else semantic_open,
        "open_suspects": open_suspects,
        "test_oracle_open": test_oracle_open,
        "rules": {} if oracle_only else rules,
        "methods": methods,
        "groups": groups,
        "output": {
            "file": "judgment.json",
            "findings": (
                "Already written in judgment.json from candidate_hits. Do not rewrite title, risk, fix, line, or severity. "
                "still_open is one row per shape. Judge each row once and read only its hosts. "
                "Do not restate look_for, do_not_report, or closed_lines. "
                "A different shape is a separate finding. "
                "Test rows go to test_oracle and suspect_hits only."
            ),
            "suspect_hits": (
                "derive_suspect_id values from open_suspects judged true. "
                "An id already in judgment.json suspect_hits is closed."
            ),
            "test_oracle": (
                "One object per test_oracle_open line that has a true flag. "
                "Copy preset onto oracle. Judge only questions. "
                + ORACLE_JUDGMENT
            ),
            "card": "Candidate cards are already in judgment.json. Do not rewrite them.",
            "chain_dimensions": (
                "Judge each chain once against rules. "
                "A hit is one finding on that step line. "
                "Leave source empty. Do not invent a chain."
            ),
            "then": "Add test_oracle rows and chain findings, then render-review-html.sh --dir <pack>. Do not rewrite findings.",
        },
    }
    chain_dimensions = build_chain_dimensions(pack, methods, repo)
    write_json(pack / "32-chain-dimensions.json", chain_dimensions)
    brief["chain_dimensions"] = {
        "rules": chain_dimensions["rules"],
        "chains": chain_dimensions["chains"],
        "note": chain_dimensions["note"],
    }
    write_json(pack / "31-model-brief.json", brief)
    print(
        "Model brief written: "
        f"methods={len(methods)} candidates={len(candidate_hits)} "
        f"still_open={len(still_open)} open_suspects={len(open_suspects)} "
        f"oracle_open={len(test_oracle_open)} groups={len(groups)} "
        f"chains={len(chain_dimensions['chains'])}"
    )


def write(pack: Path, repo: Path) -> None:
    packet, skeleton = build(pack, repo)
    seed = peel_conventions(packet)
    scripted = preclose_scripted(pack, packet, repo)
    for sid in scripted["hits"]:
        if sid not in seed:
            seed.append(sid)
    for row in scripted["line_skips"]:
        skeleton["line_skips"].append(row)
    seed_path = pack / "judgment-seed.json"
    if seed or scripted["skips"] or scripted["findings"] or scripted["test_oracle"]:
        write_json(seed_path, {
            "suspect_hits": seed,
            "suspect_skips": scripted["skips"],
            "findings": scripted["findings"],
            "test_oracle": scripted["test_oracle"],
            "source": "convention_kinds+scripted_policy",
            "note": (
                "magic_number and rate_literal are conventions. "
                "Scripted hits, skips, lock-order cards, and mechanical test oracles are closed. "
                "Seal merges them. The model does not re-judge these ids."
            ),
        })
    elif seed_path.is_file():
        seed_path.unlink()
    work_groups = split_work(pack, packet)
    if work_groups == 0:
        work_groups = split_question_work(pack, packet, repo)
    if work_groups == 0:
        stale = pack / "judgment-work"
        if stale.is_dir():
            for child in stale.iterdir():
                if child.is_file():
                    child.unlink()
            stale.rmdir()
    write_json(pack / "29-judgment-packet.json", packet)
    write_json(pack / "30-conclusion-skeleton.json", skeleton)
    _write_conclusion_stub(pack, packet)
    write_model_brief(pack, packet, repo)
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
    parser.add_argument(
        "--conclusion-stub-only",
        action="store_true",
        help="Write review-conclusion.json once manifest.json exists. Do not rebuild the packet.",
    )
    args = parser.parse_args()
    pack = Path(args.dir)
    if not pack.is_dir():
        print(f"error: pack dir missing: {pack}", file=sys.stderr)
        return 2
    if args.conclusion_stub_only:
        packet = load_json(pack / "29-judgment-packet.json") or {}
        _write_conclusion_stub(pack, packet)
        if not (pack / "review-conclusion.json").is_file():
            print("error: review-conclusion.json was not written", file=sys.stderr)
            return 1
        return 0
    write(pack, Path(args.repo))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
