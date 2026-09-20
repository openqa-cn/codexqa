#!/usr/bin/env python3
"""Bounded local change / rollout heuristics for ai-code-reviewer.

Zero network. Zero extra CodexQA. Reads changed-file list + on-disk sources
under --repo. Single-pass line scan with O(n) regex checks and fixed caps.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# Shared comment / Javadoc skip (same package dir)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import (  # noqa: E402
    iter_code_lines,
    window_code_lines,
    is_heuristic_meta_line,
    is_doc_path,
)

MAX_FILES = 40
MAX_LINES = 4000
NEIGHBOR = 4
ROOT_ENUM_LIMIT = 24

SOURCE_EXTS = {
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".m",
    ".mm",
    ".scala",
    ".rs",
    ".sql",
    ".xml",
    ".yml",
    ".yaml",
    ".properties",
    ".toml",
    ".json",
    ".md",
    ".txt",
}

SKIP_DIR_PARTS = {
    "node_modules",
    "vendor",
    ".git",
    "dist",
    "build",
    ".codexqa-review",
    "target",
    "__pycache__",
}

SECURITY_OWNED = re.compile(
    r"(?i)\b(password|passwd|secret|token|api[_-]?key|auth(entication)?|bearer|private[_-]?key|inject)\b"
)

# Schema / migration surfaces
MIGRATION_PATH = re.compile(
    r"(?i)(db/migrate|flyway|liquibase|prisma/migrations|alembic/versions|"
    r"migrations?/|schema\.prisma|changelog.*\.xml|V\d+__)"
)
MIGRATION_HINT = re.compile(
    r"(?i)\b(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|DROP\s+COLUMN|"
    r"flyway|liquibase|prisma\s+migrate|alembic|SchemaMigration|"
    r"@Flyway|db\.migrate|changeSet|addColumn|dropColumn|renameColumn|"
    r"CREATE\s+INDEX|DROP\s+INDEX|TRUNCATE\s+TABLE)\b"
)
DESTRUCTIVE_DDL = re.compile(
    r"(?i)\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE\s+TABLE|DELETE\s+FROM|"
    r"dropColumn|dropTable|removeColumn)\b"
)

# Dual-write / expand-contract
DUAL_WRITE_CLUE = re.compile(
    r"(?i)\b(dual[_-]?write|dual[_-]?read|double[_-]?write|write[_-]?both|"
    r"expand[_-]?contract|backfill|shadow[_-]?write|read[_-]?new[_-]?write[_-]?old|"
    r"write[_-]?old[_-]?and[_-]?new|migrate[_-]?then[_-]?cutover)\b"
)
STORAGE_SWITCH = re.compile(
    r"(?i)\b(new[_-]?store|old[_-]?store|migrate[_-]?data|cutover|"
    r"replace[_-]?storage|primary[_-]?store|secondary[_-]?store|"
    r"source[_-]?of[_-]?truth|data[_-]?migration)\b"
)

# Feature flags / kill switch (positive)
FEATURE_FLAG = re.compile(
    r"(?i)\b(feature[_-]?flag|feature[_-]?toggle|kill[_-]?switch|"
    r"LaunchDarkly|Unleash|Flagsmith|Split\.io|flipt|"
    r"@Value\s*\(.*flag|config[_-]?gate|rollout[_-]?flag|"
    r"isEnabled\s*\(|isFeatureEnabled|FeatureGate|GateKeeper|"
    r"experimental[_-]?flag|dark[_-]?launch)\b"
)

# Compat / deprecation / breaking — problem signals only (not the remedy clues)
# Avoid bare "breaking"/"BREAKING"/"deprecated" (vars, JSON help, titles).
BREAKING_HINT = re.compile(
    r"(?i)("
    r"@Deprecated|"
    r"\bdeprecated\s*[:=([]|"
    r"\bbreaking[_-]?change\b|"
    r"\bBREAKING[_ -]?CHANGE\b|"
    r"\bBREAKING:|"
    r"\bremove(d)?\s+(public\s+)?(api|endpoint|field|column)\b|"
    r"\bobsolete\b|"
    r"\bwill[_-]?be[_-]?removed\b"
    r")"
)
COMPAT_CLUE = re.compile(
    r"(?i)\b(compat(ibility)?[_-]?(window|layer|mode|shim)|"
    r"sunset|deprecation[_-]?period|grace[_-]?period|"
    r"version[_-]?coexist|api[_-]?v\d+|backward[_-]?compat|"
    r"forwards?[_-]?compat|adapter[_-]?layer|compat[_-]?shim)\b"
)

# Breaking announcement — docs/notice only (never treat "BREAKING" code as the announce)
ANNOUNCE_CLUE = re.compile(
    r"(?i)\b(CHANGELOG|MIGRATION[_-]?GUIDE|NOTICE|"
    r"migration[_-]?notes|release[_-]?notes|UPGRADING)\b"
)
ANNOUNCE_PATH = re.compile(
    r"(?i)(CHANGELOG|CHANGES|MIGRATION|UPGRADING|NOTICE|RELEASE[_-]?NOTES)"
)

# Rollback / canary
ROLLBACK_CLUE = re.compile(
    r"(?i)\b(rollback|roll[_-]?back|revert|undo[_-]?migration|"
    r"canary|blue[_-]?green|bluegreen|traffic[_-]?split|"
    r"progressive[_-]?delivery|gradual[_-]?rollout|"
    r"down\s*\(|migrateDown|flyway.*undo|liquibase.*rollback)\b"
)

# Avoid bare pay/order (English "pay attention" / "in order to") and bare
# primary/master/production (ubiquitous in non-money / non-store code).
MONEY_SURFACE = re.compile(
    r"(?i)\b(payment|payments|checkout|charge|refund|wallet|"
    r"billing|ledger|invoice|sku|"
    r"pay(ment)?[_-]?(api|service|client|gateway|provider)|"
    r"order[_-]?(id|total|amount|service|manager|repo)|"
    r"inventory[_-]?(service|count|item|sku))\b"
)
PRIMARY_STORE = re.compile(
    r"(?i)\b(primary[_-]?(db|database|store|shard)|master[_-]?(db|database)|"
    r"production[_-]?(db|database|store)|prod[_-]?(db|database|store)|"
    r"source[_-]?of[_-]?truth)\b"
)


def load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def file_paths(obj) -> list[str]:
    arr = (
        obj.get("nodes")
        or obj.get("result", {}).get("nodes")
        or obj.get("files")
        or obj.get("result", {}).get("files")
        or []
    )
    out = []
    if not isinstance(arr, list):
        return out
    for x in arr:
        if isinstance(x, str) and x:
            out.append(x)
        elif isinstance(x, dict):
            p = x.get("path") or x.get("file") or x.get("name")
            if isinstance(p, str) and p:
                out.append(p)
    return out


def is_source(rel: str) -> bool:
    low = rel.replace("\\", "/").lower()
    parts = set(low.split("/"))
    if parts & SKIP_DIR_PARTS:
        return False
    _, ext = os.path.splitext(low)
    if ext in SOURCE_EXTS:
        return True
    # migration path without extension still counts
    return bool(MIGRATION_PATH.search(low))


def read_lines(abs_path: str) -> list[str]:
    try:
        lines = []
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                if i >= MAX_LINES:
                    break
                lines.append(line.rstrip("\n"))
        return lines
    except Exception:
        return []


def window_code(lines: list[str], i: int, n: int = NEIGHBOR) -> str:
    return window_code_lines(lines, i, n)


def hit(rel: str, line: int, kind: str, snippet: str) -> dict:
    return {
        "path": rel,
        "line": line,
        "kind": kind,
        "snippet": snippet.strip()[:160],
    }


def scan_file(rel: str, lines: list[str]) -> dict:
    schema_migrations = []
    dual_write_gaps = []
    feature_flags = []
    compat_window_gaps = []
    breaking_announcement_gaps = []
    rollback_gaps = []

    any_migration = bool(MIGRATION_PATH.search(rel))
    any_destructive = False
    any_storage_switch = False
    any_breaking = False
    any_flag = False
    any_dual = False
    any_compat = False
    any_announce = bool(ANNOUNCE_PATH.search(rel))
    any_rollback = False
    money = False
    primary_store = False

    if any_migration:
        schema_migrations.append(
            hit(rel, 1, "migration_path", rel)
        )

    # Prose/docs: path-based migration / announce only — English "truncate" /
    # "deprecated" / "pay attention" must not force rollout T0 surfaces.
    doc = is_doc_path(rel)

    for i, line, stripped in iter_code_lines(lines):
        _ = stripped
        if is_heuristic_meta_line(line) or is_heuristic_meta_line(stripped):
            continue
        if SECURITY_OWNED.search(line) and not (
            FEATURE_FLAG.search(line) or MIGRATION_HINT.search(line)
        ):
            continue

        if not doc:
            if MONEY_SURFACE.search(line):
                money = True
            if PRIMARY_STORE.search(line):
                primary_store = True

            if MIGRATION_HINT.search(line):
                any_migration = True
                schema_migrations.append(hit(rel, i + 1, "migration_hint", line))

            if DESTRUCTIVE_DDL.search(line):
                any_destructive = True
                any_migration = True
                schema_migrations.append(hit(rel, i + 1, "destructive_ddl", line))

            if DUAL_WRITE_CLUE.search(line):
                any_dual = True

            if STORAGE_SWITCH.search(line):
                any_storage_switch = True

            if FEATURE_FLAG.search(line):
                any_flag = True
                feature_flags.append(hit(rel, i + 1, "feature_flag", line))

            if BREAKING_HINT.search(line):
                any_breaking = True
                w = window_code(lines, i, n=6)
                if not COMPAT_CLUE.search(w):
                    compat_window_gaps.append(
                        hit(rel, i + 1, "compat_window_gap", line)
                    )
                if COMPAT_CLUE.search(line):
                    any_compat = True

            if COMPAT_CLUE.search(line):
                any_compat = True

            if ROLLBACK_CLUE.search(line):
                any_rollback = True

        # Announce clues are intentionally allowed in docs (CHANGELOG etc.)
        if ANNOUNCE_CLUE.search(line):
            any_announce = True

    # Dual-write gap: migration or storage switch without dual-write clues
    if (any_migration or any_storage_switch) and not any_dual:
        if any_storage_switch or any_destructive:
            dual_write_gaps.append(
                {
                    "kind": "dual_write_gap",
                    "path": rel,
                    "note": "schema/storage change without dual-write/dual-read/backfill clue",
                    "destructive": any_destructive,
                    "storage_switch": any_storage_switch,
                }
            )

    # Breaking announce gap: breaking/destructive without announce
    if (any_breaking or any_destructive) and not any_announce:
        breaking_announcement_gaps.append(
            {
                "kind": "breaking_announcement_gap",
                "path": rel,
                "note": "breaking/destructive surface without CHANGELOG/migration-guide/NOTICE clue",
            }
        )

    # Rollback gap: destructive migration without rollback
    if (any_destructive or (any_migration and any_storage_switch)) and not any_rollback:
        rollback_gaps.append(
            {
                "kind": "rollback_gap",
                "path": rel,
                "note": "destructive/cutover migration without rollback/canary/blue-green clue",
                "destructive": any_destructive,
            }
        )

    # Flag gap is handled globally in main via residual + dual path; local flag hits only

    return {
        "schema_migrations": schema_migrations[:20],
        "dual_write_gaps": dual_write_gaps[:5],
        "feature_flags": feature_flags[:20],
        "compat_window_gaps": compat_window_gaps[:20],
        "breaking_announcement_gaps": breaking_announcement_gaps[:5],
        "rollback_gaps": rollback_gaps[:5],
        "any_migration": any_migration,
        "any_destructive": any_destructive,
        "any_storage_switch": any_storage_switch,
        "any_breaking": any_breaking,
        "any_flag": any_flag,
        "any_dual": any_dual,
        "any_compat": any_compat,
        "any_announce": any_announce,
        "any_rollback": any_rollback,
        "money": money,
        "primary_store": primary_store,
    }


def enumerate_root(repo: str) -> list[str]:
    if not repo or not os.path.isdir(repo):
        return []
    out = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_PARTS and not d.startswith(".")]
        rel_root = os.path.relpath(root, repo)
        depth = 0 if rel_root == "." else rel_root.count(os.sep) + 1
        if depth > 4:
            dirs.clear()
            continue
        for name in files:
            rel = name if rel_root == "." else os.path.join(rel_root, name)
            rel = rel.replace("\\", "/")
            if is_source(rel):
                out.append(rel)
            if len(out) >= ROOT_ENUM_LIMIT:
                return out
    return out


def dedupe(hits: list[dict], lim: int = 30) -> list[dict]:
    seen = set()
    out = []
    for h in hits:
        key = (h.get("path"), h.get("line"), h.get("kind"), h.get("note"))
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
        if len(out) >= lim:
            break
    return out


def main() -> None:
    pack_dir, repo, files_json, _lang_json, out_path = sys.argv[1:6]
    _ = pack_dir
    files_obj = load(files_json)
    all_paths = [p for p in file_paths(files_obj) if is_source(p)][:MAX_FILES]

    if not all_paths and repo and os.path.isdir(repo):
        all_paths = enumerate_root(repo)[:MAX_FILES]

    schema_migrations = []
    dual_write_gaps = []
    feature_flags = []
    compat_window_gaps = []
    breaking_announcement_gaps = []
    rollback_gaps = []
    any_migration = False
    any_destructive = False
    any_storage_switch = False
    any_breaking = False
    any_flag = False
    any_dual = False
    any_compat = False
    any_announce = False
    any_rollback = False
    money = False
    primary_store = False
    files_scanned = 0

    for rel in all_paths:
        abs_p = os.path.join(repo, rel) if repo else ""
        if not abs_p or not os.path.isfile(abs_p):
            # path-only migration clue
            if MIGRATION_PATH.search(rel):
                any_migration = True
                schema_migrations.append(hit(rel, 1, "migration_path", rel))
            continue
        lines = read_lines(abs_p)
        if not lines:
            continue
        files_scanned += 1
        sc = scan_file(rel, lines)
        schema_migrations.extend(sc["schema_migrations"])
        dual_write_gaps.extend(sc["dual_write_gaps"])
        feature_flags.extend(sc["feature_flags"])
        compat_window_gaps.extend(sc["compat_window_gaps"])
        breaking_announcement_gaps.extend(sc["breaking_announcement_gaps"])
        rollback_gaps.extend(sc["rollback_gaps"])
        any_migration = any_migration or sc["any_migration"]
        any_destructive = any_destructive or sc["any_destructive"]
        any_storage_switch = any_storage_switch or sc["any_storage_switch"]
        any_breaking = any_breaking or sc["any_breaking"]
        any_flag = any_flag or sc["any_flag"]
        any_dual = any_dual or sc["any_dual"]
        any_compat = any_compat or sc["any_compat"]
        any_announce = any_announce or sc["any_announce"]
        any_rollback = any_rollback or sc["any_rollback"]
        money = money or sc["money"]
        primary_store = primary_store or sc["primary_store"]

    schema_migrations = dedupe(schema_migrations)
    dual_write_gaps = dedupe(dual_write_gaps)
    feature_flags = dedupe(feature_flags)
    compat_window_gaps = dedupe(compat_window_gaps)
    breaking_announcement_gaps = dedupe(breaking_announcement_gaps)
    rollback_gaps = dedupe(rollback_gaps)

    # Global flag gap for risky cutover without flag (as residual-style gap list item)
    flag_gaps = []
    if (any_migration or any_breaking or any_destructive) and not any_flag:
        flag_gaps.append(
            {
                "kind": "feature_flag_gap",
                "note": "migration/breaking cutover without feature-flag/toggle/kill-switch clue",
            }
        )

    residual_rollout = []
    if any_migration and not any_flag and not any_rollback:
        residual_rollout.append(
            {
                "kind": "migration_without_flag_or_rollback",
                "note": "migration surface without flag or rollback clues — residual only",
            }
        )

    # feature_flags are positive clues (like resilience degrade) — do not alone clear thin
    signals_thin = (
        len(schema_migrations) == 0
        and len(dual_write_gaps) == 0
        and len(compat_window_gaps) == 0
        and len(breaking_announcement_gaps) == 0
        and len(rollback_gaps) == 0
        and len(flag_gaps) == 0
    )

    payload = {
        "body_ok": True,
        "repo_resolved": bool(repo and os.path.isdir(repo)),
        "signals_thin": signals_thin,
        "schema_migrations": schema_migrations,
        "dual_write_gaps": dual_write_gaps,
        "feature_flags": feature_flags,
        "feature_flag_gaps": flag_gaps,
        "compat_window_gaps": compat_window_gaps,
        "breaking_announcement_gaps": breaking_announcement_gaps,
        "rollback_gaps": rollback_gaps,
        "residual_rollout": residual_rollout,
        "thresholds": {
            "max_files": MAX_FILES,
            "max_lines": MAX_LINES,
            "neighbor": NEIGHBOR,
        },
        "files_considered": len(all_paths),
        "files_scanned": files_scanned,
        "surfaces": {
            "migration": any_migration,
            "destructive": any_destructive,
            "storage_switch": any_storage_switch,
            "breaking": any_breaking,
            "feature_flag": any_flag,
            "dual_write": any_dual,
            "compat": any_compat,
            "announce": any_announce,
            "rollback": any_rollback,
            "money": money,
            "primary_store": primary_store,
        },
    }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
