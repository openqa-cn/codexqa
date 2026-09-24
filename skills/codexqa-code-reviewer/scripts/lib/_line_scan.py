#!/usr/bin/env python3
"""Shared line-scan helpers for codexqa-code-reviewer local derive heuristics.

Comment / Javadoc / block-comment lines must not:
- count as remediation clues (dual_write, feature_flag, rollback, CHANGELOG, …)
- invent problem hits from documentation that merely *names* the risk

C/C++ pointer lines like ``*ptr = x`` are kept (not treated as javadoc).
"""
from __future__ import annotations

import os
import re

# Languages the defect pass can read as code. Data, docs, and config stay in
# the PR digest; they are not queued as residual symbols.
SOURCE_EXTS = {
    ".c", ".cc", ".cpp", ".cs", ".cjs", ".go", ".h", ".hpp", ".java",
    ".js", ".jsx", ".kt", ".kts", ".m", ".mjs", ".mm", ".php", ".py",
    ".rb", ".rs", ".scala", ".svelte", ".swift", ".ts", ".tsx", ".vue",
}


def is_source_path(path: str) -> bool:
    ext = os.path.splitext(path.replace("\\", "/").lower())[1]
    return ext in SOURCE_EXTS

# Javadoc / block continuation: "* text", "*/", "*" — not "*identifier"
_JAVADOC_STAR = re.compile(r"^\*(?:/|\s|$)")


def advance_block_state(stripped: str, in_block: bool) -> tuple[bool, bool]:
    """Return (skip_line, new_in_block) for block + line comments.

    Handles ``/* … */`` (possibly multi-line) and ``//`` / ``#`` line comments.
    Also skips javadoc middle lines (``* …``) when not in a C pointer form.
    """
    if in_block:
        if "*/" in stripped:
            return True, False
        return True, True

    if stripped.startswith("//"):
        return True, False

    # Shell / Python / Ruby comments — keep preprocessor #include
    if stripped.startswith("#") and not stripped.startswith("#include"):
        # liquibase XML-ish headers sometimes use "# liquibase" — still a comment
        return True, False

    if stripped.startswith("/*"):
        if "*/" in stripped:
            return True, False
        return True, True

    if _JAVADOC_STAR.match(stripped):
        return True, False

    return False, False


def iter_code_lines(lines: list[str]):
    """Yield ``(index, raw_line, stripped)`` for non-comment code lines only."""
    in_block = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        skip, in_block = advance_block_state(stripped, in_block)
        if skip:
            continue
        yield i, line, stripped


def window_code_lines(
    lines: list[str], center: int, neighbor: int = 4
) -> str:
    """Neighborhood text with line/block/Javadoc comments removed.

    Same intent as prior ``window_code`` helpers, but also drops ``/* */`` and
    ``* javadoc`` so comment waivers cannot satisfy gap checks.
    """
    start = max(0, center - neighbor)
    end = min(len(lines), center + neighbor + 1)
    # Re-scan from file start so block state is correct at window start
    in_block = False
    kept: list[str] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        skip, in_block = advance_block_state(stripped, in_block)
        if i < start:
            continue
        if i >= end:
            break
        if skip:
            continue
        # Strip trailing // and # inline comments (best-effort)
        s = line
        if "//" in s:
            s = s.split("//", 1)[0]
        if "#" in s and not s.lstrip().startswith("#include"):
            stripped_l = s.lstrip()
            if stripped_l.startswith("#") and not stripped_l.startswith("#include"):
                s = ""
            elif " #" in s or s.startswith("#"):
                if not stripped_l.startswith("#include"):
                    s = re.split(r"\s+#", s, maxsplit=1)[0]
        kept.append(s)
    return "\n".join(kept)


# Heuristic scanner / rule-engine pattern definitions (regex literals, re.compile, …)
# must not be treated as product PII / timeout / secret *usage* hits.
_RE_COMPILE = re.compile(r"(?i)\bre(?:\s*\.\s*compile)?\s*\(")
_RAW_OR_RE_ASSIGN = re.compile(r"""(?x)
    (?:^|[=(,\[])\s*r['"]          # r"…" / r'…'
  | =\s*re\.compile\s*\(
""")
_MULTI_ALT_QUOTED = re.compile(
    r"""['"][^'"]*\|[^'"]*\|[^'"]*\|[^'"]*['"]"""
)


def is_pattern_definition_line(stripped: str) -> bool:
    """True when the line defines a matcher rather than using secrets/IO/PII.

    Stabilizes derive/risk-tier on repos that ship security/SAST scanners: pattern
    source containing ``password|secret|email|fetch(`` must not force T0 or
    hard-gate findings.
    """
    s = (stripped or "").strip()
    if not s:
        return False
    if _RE_COMPILE.search(s) or _RAW_OR_RE_ASSIGN.search(s):
        return True
    # Long alternation strings typical of keyword lists inside quotes
    if s.count("|") >= 3 and _MULTI_ALT_QUOTED.search(s):
        return True
    return False


# Matcher *invocation* / hit bookkeeping / schema keys inside scanner tooling.
# Without this, editing a derive body (FEATURE_FLAG.search, "feature_flag": …)
# falsely lights rollout/privacy surfaces and escalates risk tier.
_HEURISTIC_CALL = re.compile(
    r"(?i)\b("
    r"[A-Z][A-Z0-9_]*(?:HINT|CLUE|FLAG|SURFACE|PATH|DDL|STORE|_RE|MONEY)"
    r")\s*\.\s*(search|match|findall|fullmatch)\s*\("
)
_HIT_BOOKKEEPING = re.compile(
    r"(?i)\b("
    r"feature_flags|schema_migrations|dual_write_gaps|compat_window_gaps|"
    r"breaking_announcement_gaps|rollback_gaps|residual_rollout|"
    r"pii_hits|secret_hits|timeout_hits|sensitive_hits|breaking"
    r")\s*\.\s*(append|extend)\s*\("
)
_SURFACE_SCHEMA_KEY = re.compile(
    r'(?i)["\'](?:feature_flags?|schema_migrations|dual_write(?:_gaps)?|'
    r"rollback_gaps|compat_window(?:_gaps)?|storage_switch|primary_store|"
    r"breaking(?:_announcement(?:_gaps)?|_hints)?|money|migration|"
    r"destructive|kill[_-]?switch|rollout_surfaces)[\"']\s*:"
)
_GAP_NOTE_PROSE = re.compile(
    r'(?i)"note"\s*:\s*"[^"]*\b(without|clue|gap|cutover)[^"]*"'
)
_SURFACE_BOOKKEEPING = re.compile(
    r"(?i)\b("
    r"any_(?:migration|destructive|storage_switch|breaking|flag|dual|"
    r"compat|announce|rollback)|primary_store|money"
    r")\s*="
)


def is_heuristic_meta_line(stripped: str) -> bool:
    """True for scanner/tooling lines that name risks without being product code.

    Covers pattern definitions plus ``HINT.search(...)``, hit-list appends, JSON
    schema keys, gap-note string literals, and surface boolean bookkeeping.
    """
    if is_pattern_definition_line(stripped):
        return True
    s = (stripped or "").strip()
    if not s:
        return False
    if _HEURISTIC_CALL.search(s) or _HIT_BOOKKEEPING.search(s):
        return True
    if _SURFACE_SCHEMA_KEY.search(s) or _GAP_NOTE_PROSE.search(s):
        return True
    if _SURFACE_BOOKKEEPING.search(s):
        return True
    return False


DOC_EXTS = {".md", ".markdown", ".txt", ".rst", ".adoc"}


def is_doc_path(rel: str) -> bool:
    """True for prose/docs paths where SQL/DDL keyword hits are usually English."""
    low = (rel or "").replace("\\", "/").lower()
    base = low.rsplit("/", 1)[-1]
    if "." not in base:
        return False
    ext = "." + base.rsplit(".", 1)[-1]
    return ext in DOC_EXTS
