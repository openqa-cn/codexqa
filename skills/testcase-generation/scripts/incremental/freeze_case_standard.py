#!/usr/bin/env python3
"""Freeze only Section 3 from the three explicit testcase-generation templates."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Dict, List, Tuple

from inc_common import (
    SkillError,
    dump_json_atomic,
    ensure_safe_component,
    print_error,
    print_result,
    sha256_bytes,
    workspace_from_arg,
    write_bytes_atomic,
)


SECTION_3_RE = re.compile(r"^##(?!#)[ \t]+3(?:[.)：:\s]|$)")
TOP_LEVEL_SECTION_RE = re.compile(r"^##(?!#)[ \t]+")
EXPECTED_SOURCE_SKILL_NAME = "testcase-generation"
PLATFORM_FILES = {
    "server": "case-tpl-server.md",
    "app": "case-tpl-app.md",
    "web": "case-tpl-web.md",
}


def _reference_dir(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise SkillError(
            "ABSOLUTE_PATH_REQUIRED",
            "sourceReferenceDir must be an absolute path",
            {"field": "sourceReferenceDir", "value": value},
        )
    if path.is_symlink():
        raise SkillError(
            "STANDARD_REFERENCE_SYMLINK_FORBIDDEN",
            "The source reference directory must not be a symbolic link",
            {"path": str(path)},
        )
    if not path.exists() or not path.is_dir():
        raise SkillError(
            "STANDARD_REFERENCE_DIR_REQUIRED",
            "sourceReferenceDir must point to an existing directory",
            {"path": str(path)},
        )
    resolved = path.resolve()
    if resolved.name != "references":
        raise SkillError(
            "STANDARD_REFERENCE_DIR_INVALID",
            "sourceReferenceDir must be this Skill's references directory",
            {"path": str(resolved)},
        )
    return resolved


def _read_section_three(path: Path) -> Tuple[bytes, bytes, int, int]:
    if path.is_symlink():
        raise SkillError(
            "STANDARD_REFERENCE_SYMLINK_FORBIDDEN",
            "The source standard file must not be a symbolic link",
            {"path": str(path)},
        )
    if not path.exists() or not path.is_file():
        raise SkillError(
            "STANDARD_REFERENCE_FILE_REQUIRED",
            "The required source standard file does not exist",
            {"path": str(path)},
        )

    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SkillError(
            "STANDARD_REFERENCE_UTF8_REQUIRED",
            "The source standard file must be valid UTF-8",
            {"path": str(path)},
        ) from exc

    lines = text.splitlines(keepends=True)
    starts = [
        index
        for index, line in enumerate(lines)
        if SECTION_3_RE.match(line)
    ]
    if len(starts) != 1:
        raise SkillError(
            "STANDARD_SECTION_3_INVALID",
            "The source standard file must contain exactly one top-level Section 3",
            {"path": str(path), "section3Count": len(starts)},
        )

    start = starts[0]
    end = len(lines)
    for index in range(start + 1, len(lines)):
        if TOP_LEVEL_SECTION_RE.match(lines[index]):
            end = index
            break

    section_lines = lines[start:end]
    while section_lines and section_lines[-1].strip() in {"", "---"}:
        section_lines.pop()
    if not section_lines:
        raise SkillError(
            "STANDARD_SECTION_3_EMPTY",
            "Section 3 must contain readable content",
            {"path": str(path)},
        )

    section = "".join(section_lines).encode("utf-8")
    return raw, section, start + 1, end + 1


def extract(args: argparse.Namespace) -> Dict:
    workspace = workspace_from_arg(args.workspace)
    source_reference_dir = _reference_dir(args.source_reference_dir)
    source_skill_name = ensure_safe_component(
        args.source_skill_name,
        "sourceSkillName",
    )
    if source_skill_name != EXPECTED_SOURCE_SKILL_NAME:
        raise SkillError(
            "STANDARD_SOURCE_SKILL_MISMATCH",
            "sourceSkillName must be the canonical testcase-generation name",
            {
                "expected": EXPECTED_SOURCE_SKILL_NAME,
                "actual": source_skill_name,
            },
        )
    source_skill_version = ensure_safe_component(
        args.source_skill_version,
        "sourceSkillVersion",
    )

    artifacts_root = workspace / "artifacts"
    if artifacts_root.is_symlink():
        raise SkillError(
            "ARTIFACTS_ROOT_SYMLINK_FORBIDDEN",
            "The artifacts directory must not be a symbolic link",
            {"path": str(artifacts_root)},
        )
    artifacts_root.mkdir(parents=True, exist_ok=True)
    standards_root = artifacts_root / "standards"
    if standards_root.is_symlink():
        raise SkillError(
            "STANDARD_ARTIFACT_SYMLINK_FORBIDDEN",
            "The standards artifact directory must not be a symbolic link",
            {"path": str(standards_root)},
        )
    standards_root.mkdir(parents=True, exist_ok=True)
    source_root = standards_root / "source"
    if source_root.exists() or source_root.is_symlink():
        raise SkillError(
            "STANDARD_SNAPSHOT_EXISTS",
            "The standard source snapshot is immutable within an execution",
            {"path": str(source_root)},
        )

    extracted: List[Dict] = []
    staged_root = Path(
        tempfile.mkdtemp(
            prefix=".standard-source-",
            dir=str(standards_root),
        )
    )
    try:
        for platform, file_name in PLATFORM_FILES.items():
            source_path = source_reference_dir / file_name
            source_bytes, section_bytes, start_line, end_line = _read_section_three(
                source_path
            )
            relative_path = (
                Path("artifacts")
                / "standards"
                / "source"
                / "sections"
                / platform
                / f"{file_name}.section-3.md"
            )
            staged_path = (
                staged_root
                / "sections"
                / platform
                / f"{file_name}.section-3.md"
            )
            write_bytes_atomic(staged_path, section_bytes)
            extracted.append(
                {
                    "platform": platform,
                    "fileName": file_name,
                    "sourceRef": f"references/{file_name}",
                    "sourcePath": str(source_path),
                    "sourceSha256": sha256_bytes(source_bytes),
                    "sourceByteLength": len(source_bytes),
                    "section": "3",
                    "sectionHeadingLine": start_line,
                    "sectionEndLineExclusive": end_line,
                    "sectionSha256": sha256_bytes(section_bytes),
                    "sectionByteLength": len(section_bytes),
                    "sectionSnapshot": relative_path.as_posix(),
                }
            )

        manifest = {
            "standardSourceContractVersion": "1.0",
            "sourceDiscovery": "LOCAL_SKILL",
            "sourceSkillName": source_skill_name,
            "sourceSkillVersion": source_skill_version,
            "sourceReferenceDir": str(source_reference_dir),
            "allowedFiles": [
                {
                    "platform": item["platform"],
                    "fileName": item["fileName"],
                    "sourceRef": item["sourceRef"],
                    "sourceSha256": item["sourceSha256"],
                    "sourceByteLength": item["sourceByteLength"],
                    "section": item["section"],
                    "sectionHeadingLine": item["sectionHeadingLine"],
                    "sectionEndLineExclusive": item["sectionEndLineExclusive"],
                    "sectionSha256": item["sectionSha256"],
                    "sectionByteLength": item["sectionByteLength"],
                    "sectionSnapshot": item["sectionSnapshot"],
                }
                for item in extracted
            ],
            "readPolicy": {
                "allowedReferenceFiles": [
                    PLATFORM_FILES["server"],
                    PLATFORM_FILES["app"],
                    PLATFORM_FILES["web"],
                ],
                "semanticSections": ["3"],
                "ignoredSections": ["1", "2", "4", "5", "other"],
                "extraction": "TOP_LEVEL_SECTION_3_ONLY",
                "rawFullFilesPersisted": False,
            },
        }
        dump_json_atomic(staged_root / "standard-source-manifest.json", manifest)
        os.replace(staged_root, source_root)
        staged_root = None
    except Exception:
        if staged_root is not None and staged_root.exists():
            shutil.rmtree(staged_root)
        raise

    return {
        "ok": True,
        "workspace": str(workspace),
        "sourceManifest": str(
            source_root / "standard-source-manifest.json"
        ),
        "sourceSkillName": source_skill_name,
        "sourceSkillVersion": source_skill_version,
        "semanticSections": ["3"],
        "platformSnapshots": [
            {
                "platform": item["platform"],
                "path": str(
                    source_root
                    / "sections"
                    / item["platform"]
                    / f"{item['fileName']}.section-3.md"
                ),
                "sectionSha256": item["sectionSha256"],
            }
            for item in extracted
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-reference-dir", required=True)
    parser.add_argument("--source-skill-name", required=True)
    parser.add_argument("--source-skill-version", default="UNKNOWN")
    args = parser.parse_args()
    try:
        print_result(extract(args))
        return 0
    except SkillError as error:
        print_error(error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
