#!/usr/bin/env python3
"""Generate deterministic diff evidence candidates from frozen raw inputs."""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import difflib
import hashlib
import json
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from inc_common import (
    SkillError,
    dump_json_atomic,
    ensure_within,
    load_json,
    now_iso,
    print_error,
    print_result,
    sha256_bytes,
    workspace_from_arg,
)

MAX_INLINE_DIFF_CHARACTERS = 500_000
MAX_INLINE_DIFF_LINES = 20_000


def _normalize_text(data: bytes) -> Optional[str]:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def _line_similarity(before_text: str, after_text: str) -> float:
    """Calculate bounded, linear-time similarity for mechanical ranking."""
    if before_text == after_text:
        return 1.0
    before_lines = before_text.splitlines()
    after_lines = after_text.splitlines()
    if not before_lines and not after_lines:
        return 1.0
    if not before_lines or not after_lines:
        return 0.0
    before_counts = Counter(before_lines)
    after_counts = Counter(after_lines)
    common_lines = sum((before_counts & after_counts).values())
    return (2.0 * common_lines) / (len(before_lines) + len(after_lines))


def _progress(message: str) -> None:
    print(f"[diff-candidates] {message}", file=sys.stderr, flush=True)


def _files(root: Path) -> Dict[str, Path]:
    return {
        path.relative_to(root).as_posix(): path
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _source_root(workspace: Path, entry: Dict) -> Path:
    relative = entry.get("archivedPath")
    if not isinstance(relative, str):
        raise SkillError(
            "INPUT_MANIFEST_INVALID",
            "Each input must contain archivedPath",
            {"inputId": entry.get("inputId")},
        )
    root = ensure_within(workspace / relative, workspace)
    if not root.exists():
        raise SkillError(
            "ARCHIVED_INPUT_MISSING",
            "Archived input path does not exist",
            {"inputId": entry.get("inputId"), "path": str(root)},
        )
    return root


def _source_kind(entry: Dict) -> str:
    return str(entry.get("sourceKind") or "PATH").upper()


def _source_family(entry: Dict) -> str:
    slot = str(entry.get("slot") or "")
    suffix = slot.split(".", 1)[1] if "." in slot else slot
    normalized = suffix.replace("_", "").replace("-", "").lower()
    if normalized == "prd":
        return "PRD"
    if normalized in {"techdesign", "technicalplan", "design"}:
        return "TECH_DESIGN"
    if normalized == "code":
        return "CODE"
    raise SkillError(
        "SOURCE_FAMILY_UNSUPPORTED",
        "Diff candidates support PRD, TECH_DESIGN and CODE input slots",
        {"slot": slot, "sourceFamily": suffix},
    )


def _source_info(
    baseline: Dict,
    target: Dict,
    transport: str,
) -> Dict:
    baseline_family = _source_family(baseline)
    target_family = _source_family(target)
    if baseline_family != target_family:
        raise SkillError(
            "SOURCE_FAMILY_PAIR_MISMATCH",
            "Baseline and target inputs must use the same source family",
            {
                "baselineSourceFamily": baseline_family,
                "targetSourceFamily": target_family,
            },
        )
    baseline_source_id = baseline.get("sourceId")
    target_source_id = target.get("sourceId")
    if (
        baseline_source_id is not None
        and target_source_id is not None
        and baseline_source_id != target_source_id
    ):
        raise SkillError(
            "SOURCE_ID_PAIR_MISMATCH",
            "Baseline and target inputs must use the same sourceId",
            {
                "baselineSourceId": baseline_source_id,
                "targetSourceId": target_source_id,
            },
        )
    baseline_document_key = baseline.get("documentKey")
    target_document_key = target.get("documentKey")
    if (
        baseline_document_key is not None
        and target_document_key is not None
        and baseline_document_key != target_document_key
    ):
        raise SkillError(
            "DOCUMENT_KEY_PAIR_MISMATCH",
            "Baseline and target inputs must use the same documentKey",
            {
                "baselineDocumentKey": baseline_document_key,
                "targetDocumentKey": target_document_key,
            },
        )
    return {
        "family": baseline_family,
        "transport": transport,
        "sourceId": (
            baseline_source_id
            if baseline_source_id is not None
            else target_source_id
        ),
        "documentKey": (
            baseline_document_key
            if baseline_document_key is not None
            else target_document_key
        ),
        "baselineInputId": baseline.get("inputId"),
        "targetInputId": target.get("inputId"),
    }


def _is_code_entry(entry: Dict) -> bool:
    return str(entry.get("slot") or "").endswith(".code")


def _pair_key(entry: Dict) -> Tuple:
    if entry.get("pairKey"):
        return "explicit", entry.get("pairKey")
    slot = str(entry.get("slot") or "")
    family = slot.split(".", 1)[1] if "." in slot else slot
    return "derived", family, entry.get("platform"), entry.get("sourceId")


def _candidate_id(
    pair_key: str,
    source: Dict,
    baseline_relative: Optional[str],
    target_relative: Optional[str],
    change_type: str,
    before: Optional[bytes],
    after: Optional[bytes],
    identity: Optional[str] = None,
) -> str:
    payload = {
        "pairKey": pair_key,
        "source": source,
        "baselineRelativePath": baseline_relative,
        "targetRelativePath": target_relative,
        "changeType": change_type,
        "baselineSha256": sha256_bytes(before) if before is not None else None,
        "targetSha256": sha256_bytes(after) if after is not None else None,
        "identity": identity,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _sha256_ref(data: bytes) -> str:
    return f"sha256:{sha256_bytes(data)}"


def _location(
    entry: Dict,
    relative: Optional[str],
    content: Optional[bytes],
) -> Dict:
    input_id = entry.get("inputId")
    if content is None:
        return {
            "inputId": input_id,
            "relativePath": None,
            "workspacePath": None,
            "present": False,
            "sha256": None,
        }
    archived_path = str(entry.get("archivedPath") or "").rstrip("/")
    if not archived_path or not relative:
        raise SkillError(
            "INPUT_MANIFEST_INVALID",
            "Present candidate locations require archivedPath and relativePath",
            {"inputId": input_id, "relativePath": relative},
        )
    return {
        "inputId": input_id,
        "relativePath": relative,
        "workspacePath": f"{archived_path}/{relative}",
        "present": True,
        "sha256": _sha256_ref(content),
    }


def _file_candidate(
    pair_key: str,
    source: Dict,
    baseline: Dict,
    target: Dict,
    baseline_relative: Optional[str],
    target_relative: Optional[str],
    before: Optional[bytes],
    after: Optional[bytes],
    forced_change_type: Optional[str] = None,
    candidate_identity: Optional[str] = None,
    include_text_diff: bool = True,
) -> Dict:
    if forced_change_type is None:
        if before is None:
            change_type = "ADDED"
        elif after is None:
            change_type = "REMOVED"
        elif before == after:
            return {}
        else:
            change_type = "CHANGED"
    else:
        change_type = forced_change_type

    before_text = _normalize_text(before) if before is not None else None
    after_text = _normalize_text(after) if after is not None else None
    similarity = None
    diff_text = None
    limitations = []
    if before_text is not None and after_text is not None:
        similarity = _line_similarity(before_text, after_text)
    elif before is None or after is None:
        similarity = 0.0

    present_texts = [
        text
        for content, text in ((before, before_text), (after, after_text))
        if content is not None
    ]
    has_non_utf8_content = any(text is None for text in present_texts)
    if has_non_utf8_content:
        limitations.append("binary-or-non-utf8-content")
    elif include_text_diff:
        before_lines = before_text.splitlines() if before_text is not None else []
        after_lines = after_text.splitlines() if after_text is not None else []
        total_characters = len(before_text or "") + len(after_text or "")
        total_lines = len(before_lines) + len(after_lines)
        if (
            total_characters > MAX_INLINE_DIFF_CHARACTERS
            or total_lines > MAX_INLINE_DIFF_LINES
        ):
            limitations.append("text-diff-omitted-size-limit")
        else:
            diff_text = "\n".join(
                difflib.unified_diff(
                    before_lines,
                    after_lines,
                    fromfile=f"baseline/{baseline_relative}",
                    tofile=f"target/{target_relative}",
                    lineterm="",
                )
            )

    return {
        "candidateId": _candidate_id(
            pair_key,
            source,
            baseline_relative,
            target_relative,
            change_type,
            before,
            after,
            identity=candidate_identity,
        ),
        "kind": "candidate-material",
        "notAConclusion": True,
        "pairKey": pair_key,
        "source": source,
        "changeType": change_type,
        "locations": {
            "baseline": _location(baseline, baseline_relative, before),
            "target": _location(target, target_relative, after),
        },
        "baselineNormalized": before_text,
        "targetNormalized": after_text,
        "normalizedSimilarity": similarity,
        "candidateConfidence": round(similarity, 6) if similarity is not None else 0.0,
        "diff": diff_text,
        "evidenceRefs": [],
        "limitations": limitations,
    }


def _git_error(command: List[str], completed: subprocess.CompletedProcess) -> SkillError:
    stderr = completed.stderr.decode("utf-8", errors="replace").strip()
    return SkillError(
        "GIT_DIFF_FAILED",
        "Git command failed while generating code diff candidates",
        {
            "command": command,
            "stderr": stderr[-1000:],
            "returnCode": completed.returncode,
        },
    )


def _run_git(git_dir: Path, args: List[str]) -> bytes:
    command = ["git", "--git-dir", str(git_dir)] + args
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise _git_error(command, completed)
    return completed.stdout


def _decode_git_path(value: bytes) -> str:
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SkillError(
            "GIT_PATH_NOT_UTF8",
            "Git changed paths must be valid UTF-8 for candidate JSON",
        ) from exc


def _git_changed_paths(git_dir: Path, baseline_commit: str, target_commit: str) -> List[Dict]:
    output = _run_git(
        git_dir,
        [
            "diff",
            "--no-ext-diff",
            "--find-renames",
            "--find-copies",
            "--name-status",
            "-z",
            baseline_commit,
            target_commit,
            "--",
        ],
    )
    parts = output.split(b"\0")
    changes = []
    index = 0
    while index < len(parts):
        status_bytes = parts[index]
        index += 1
        if not status_bytes:
            continue
        if index >= len(parts) or not parts[index]:
            raise SkillError(
                "GIT_DIFF_OUTPUT_INVALID",
                "Git name-status output is missing a changed path",
            )
        status = status_bytes.decode("ascii", errors="strict")
        first_path = _decode_git_path(parts[index])
        index += 1
        status_code = status[:1]
        if status_code in {"R", "C"}:
            if index >= len(parts) or not parts[index]:
                raise SkillError(
                    "GIT_DIFF_OUTPUT_INVALID",
                    "Git rename/copy output is missing its target path",
                )
            second_path = _decode_git_path(parts[index])
            index += 1
            old_path = first_path
            new_path = second_path
        else:
            old_path = first_path
            new_path = first_path
        changes.append(
            {
                "status": status,
                "statusCode": status_code,
                "oldPath": old_path,
                "newPath": new_path,
            }
        )
    return changes


def _git_blob(git_dir: Path, commit_id: str, relative: str) -> Optional[bytes]:
    object_spec = f"{commit_id}:{relative}"
    object_type = _run_git(git_dir, ["cat-file", "-t", object_spec])
    object_type = object_type.decode("ascii", errors="strict").strip()
    if object_type != "blob":
        return None
    return _run_git(git_dir, ["cat-file", "blob", object_spec])


def _git_patch(
    git_dir: Path,
    baseline_commit: str,
    target_commit: str,
    old_path: str,
    new_path: str,
) -> str:
    paths = [old_path] if old_path == new_path else [old_path, new_path]
    patch = _run_git(
        git_dir,
        [
            "diff",
            "--no-ext-diff",
            "--binary",
            "--full-index",
            "--find-renames",
            baseline_commit,
            target_commit,
            "--",
        ]
        + paths,
    )
    return patch.decode("utf-8", errors="replace")


def _git_has_commit(git_dir: Path, commit_id: str) -> bool:
    command = [
        "git",
        "--git-dir",
        str(git_dir),
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{commit_id}^{{commit}}",
    ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return completed.returncode == 0


def _git_pair_repository(
    workspace: Path,
    baseline: Dict,
    target: Dict,
) -> Tuple[Path, str, str, str]:
    baseline_git = baseline.get("git")
    target_git = target.get("git")
    if not isinstance(baseline_git, dict) or not isinstance(target_git, dict):
        raise SkillError(
            "GIT_METADATA_REQUIRED",
            "GIT code pairs require Git metadata in both input manifest entries",
        )
    repository_id = baseline_git.get("repositoryId")
    if repository_id != target_git.get("repositoryId"):
        raise SkillError(
            "GIT_REPOSITORY_PAIR_MISMATCH",
            "Baseline and target Git inputs must use the same repositoryId",
            {
                "baselineRepositoryId": repository_id,
                "targetRepositoryId": target_git.get("repositoryId"),
            },
        )
    baseline_commit = baseline_git.get("resolvedCommitId")
    target_commit = target_git.get("resolvedCommitId")
    if not isinstance(baseline_commit, str) or not isinstance(
        target_commit, str
    ):
        raise SkillError(
            "GIT_COMMIT_METADATA_INVALID",
            "GIT inputs must contain resolved baseline and target commit IDs",
        )
    repositories = []
    for entry in (baseline_git, target_git):
        repository_path = entry.get("repositoryPath")
        if not isinstance(repository_path, str):
            raise SkillError(
                "GIT_REPOSITORY_PATH_REQUIRED",
                "GIT input metadata must contain repositoryPath",
            )
        repository = ensure_within(workspace / repository_path, workspace)
        if repository not in repositories:
            repositories.append(repository)
    for repository in repositories:
        if _git_has_commit(repository, baseline_commit) and _git_has_commit(
            repository, target_commit
        ):
            return repository, str(repository_id), baseline_commit, target_commit
    raise SkillError(
        "GIT_OBJECT_MISSING",
        "Frozen Git repositories do not contain both commits required for diff",
        {
            "repositoryId": repository_id,
            "baselineCommitId": baseline_commit,
            "targetCommitId": target_commit,
        },
    )


def _git_pair_candidates(
    workspace: Path,
    baseline: Dict,
    target: Dict,
    pair_key: str,
    source: Dict,
) -> Tuple[List[Dict], List[Dict]]:
    started_at = time.monotonic()
    repository, repository_id, baseline_commit, target_commit = _git_pair_repository(
        workspace,
        baseline,
        target,
    )
    candidates = []
    limitations = []
    changes = sorted(
        _git_changed_paths(repository, baseline_commit, target_commit),
        key=lambda item: (
            item["newPath"],
            item["oldPath"],
            item["status"],
        ),
    )
    _progress(
        f"pair={pair_key} source={source['family']}/{source['transport']} "
        f"changedPaths={len(changes)}"
    )
    for change_index, change in enumerate(changes, start=1):
        status_code = change["statusCode"]
        old_path = change["oldPath"]
        new_path = change["newPath"]
        change_type = {
            "A": "ADDED",
            "D": "REMOVED",
            "R": "RENAMED",
            "C": "COPIED",
        }.get(status_code, "CHANGED")
        before = (
            None
            if status_code == "A"
            else _git_blob(repository, baseline_commit, old_path)
        )
        after = (
            None
            if status_code == "D"
            else _git_blob(repository, target_commit, new_path)
        )
        identity = (
            f"{old_path}->{new_path}"
            if old_path != new_path
            else new_path
        )
        candidate = _file_candidate(
            pair_key,
            source,
            baseline,
            target,
            old_path,
            new_path,
            before,
            after,
            forced_change_type=change_type,
            candidate_identity=identity,
            include_text_diff=False,
        )
        candidate["git"] = {
            "repositoryId": repository_id,
            "baselineCommitId": baseline_commit,
            "targetCommitId": target_commit,
            "status": change["status"],
            "repositoryPath": str(repository.relative_to(workspace)),
        }
        candidate["diff"] = _git_patch(
            repository,
            baseline_commit,
            target_commit,
            old_path,
            new_path,
        )
        candidate["diffSource"] = "git-diff"
        if (
            change_index == 1
            or change_index % 25 == 0
            or change_index == len(changes)
        ):
            _progress(
                f"pair={pair_key} progress={change_index}/{len(changes)} "
                f"path={new_path} elapsedMs="
                f"{int((time.monotonic() - started_at) * 1000)}"
            )
        if status_code not in {"A", "D"} and (before is None or after is None):
            limitations.append(
                {
                    "pair": pair_key,
                    "kind": "NON_BLOB_GIT_ENTRY",
                    "candidateId": candidate["candidateId"],
                    "message": "One side of the Git change is not a regular blob",
                }
            )
        candidates.append(candidate)
    if not candidates:
        limitations.append(
            {
                "pair": pair_key,
                "kind": "NO_DIFFERENCE_CANDIDATE",
                "message": "Git reported no changed paths for this commit pair",
            }
        )
    _progress(
        f"pair={pair_key} candidates={len(candidates)} "
        f"elapsedMs={int((time.monotonic() - started_at) * 1000)}"
    )
    return candidates, limitations


def _paired_inputs(entries: List[Dict]) -> Tuple[List[Tuple[Dict, Dict]], List[Dict]]:
    groups = {}  # type: Dict[Tuple, Dict[str, List[Dict]]]
    for entry in entries:
        role = str(entry.get("versionRole") or "").upper()
        if role not in {"BASELINE", "TARGET"}:
            continue
        groups.setdefault(_pair_key(entry), {}).setdefault(role, []).append(entry)

    pairs = []
    limitations = []
    for key, roles in sorted(groups.items(), key=lambda item: repr(item[0])):
        baseline = roles.get("BASELINE", [])
        target = roles.get("TARGET", [])
        if len(baseline) != 1 or len(target) != 1:
            if baseline or target:
                limitations.append(
                    {
                        "kind": "AMBIGUOUS_BASELINE_TARGET_PAIR",
                        "pairKey": key,
                        "baselineInputIds": [
                            item.get("inputId") for item in baseline
                        ],
                        "targetInputIds": [
                            item.get("inputId") for item in target
                        ],
                        "message": (
                            "Provide a unique pairKey for each baseline/target "
                            "document pair"
                        ),
                    }
                )
            continue
        pairs.append((baseline[0], target[0]))
    return pairs, limitations


def _generate_pair(
    workspace: Path,
    baseline: Dict,
    target: Dict,
) -> Dict:
    pair_key = "|".join(
        "" if value is None else str(value)
        for value in _pair_key(baseline)
    )
    baseline_kind = _source_kind(baseline)
    target_kind = _source_kind(target)
    if baseline_kind != target_kind:
        raise SkillError(
            "SOURCE_KIND_PAIR_MISMATCH",
            "Baseline and target inputs must use the same sourceKind",
            {
                "pairKey": pair_key,
                "baselineSourceKind": baseline_kind,
                "targetSourceKind": target_kind,
            },
        )
    if "GIT" in {baseline_kind, target_kind} and not (
        _is_code_entry(baseline) and _is_code_entry(target)
    ):
        raise SkillError(
            "GIT_SOURCE_CODE_ONLY",
            "GIT sourceKind is only supported for code input pairs",
            {"pairKey": pair_key},
        )

    source = _source_info(baseline, target, baseline_kind)
    if baseline_kind == "GIT":
        pair_candidates, pair_limitations = _git_pair_candidates(
            workspace,
            baseline,
            target,
            pair_key,
            source,
        )
    else:
        started_at = time.monotonic()
        before_files = _files(_source_root(workspace, baseline))
        after_files = _files(_source_root(workspace, target))
        _progress(
            f"pair={pair_key} source={source['family']}/{source['transport']} "
            f"baselineFiles={len(before_files)} targetFiles={len(after_files)}"
        )
        pair_candidates = []
        pair_limitations = []
        for relative in sorted(set(before_files) | set(after_files)):
            before = (
                before_files[relative].read_bytes()
                if relative in before_files
                else None
            )
            after = (
                after_files[relative].read_bytes()
                if relative in after_files
                else None
            )
            candidate = _file_candidate(
                pair_key,
                source,
                baseline,
                target,
                relative,
                relative,
                before,
                after,
            )
            if not candidate:
                continue
            pair_candidates.append(candidate)
        if not pair_candidates:
            pair_limitations.append(
                {
                    "pair": pair_key,
                    "kind": "NO_DIFFERENCE_CANDIDATE",
                    "message": "No byte-level difference was found for this pair",
                }
            )
        _progress(
            f"pair={pair_key} candidates={len(pair_candidates)} "
            f"elapsedMs={int((time.monotonic() - started_at) * 1000)}"
        )

    pair = {
        "pairKey": pair_key,
        "source": source,
        "baselineInputId": baseline.get("inputId"),
        "targetInputId": target.get("inputId"),
        "candidateIds": [item["candidateId"] for item in pair_candidates],
        "baselineSha256": baseline.get("sha256"),
        "targetSha256": target.get("sha256"),
    }
    return {
        "pair": pair,
        "candidates": pair_candidates,
        "limitations": pair_limitations,
    }


def generate(args: argparse.Namespace) -> Dict:
    started_at = time.monotonic()
    workspace = workspace_from_arg(args.workspace)
    manifest = load_json(workspace / "inputs" / "input-manifest.json")
    entries = manifest.get("inputs")
    if not isinstance(entries, list):
        raise SkillError(
            "INPUT_MANIFEST_INVALID",
            "input-manifest.json must contain inputs[]",
        )

    paired_inputs, pair_limitations = _paired_inputs(entries)
    limitations = list(pair_limitations)
    ordered_pairs = sorted(
        paired_inputs,
        key=lambda pair: repr(_pair_key(pair[0])),
    )
    pair_results = []
    max_workers = 0
    if ordered_pairs:
        requested_workers = args.max_workers
        if requested_workers < 0:
            raise SkillError(
                "INVALID_MAX_WORKERS",
                "max-workers must be 0 or between 1 and 32",
                {"maxWorkers": requested_workers},
            )
        if requested_workers == 0:
            requested_workers = min(4, len(ordered_pairs))
        if requested_workers > 32:
            raise SkillError(
                "INVALID_MAX_WORKERS",
                "max-workers must be 0 or between 1 and 32",
                {"maxWorkers": requested_workers},
            )
        max_workers = min(requested_workers, len(ordered_pairs))
        with ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="diff-candidate",
        ) as executor:
            futures = [
                executor.submit(_generate_pair, workspace, baseline, target)
                for baseline, target in ordered_pairs
            ]
            for future in futures:
                pair_results.append(future.result())
    pairs = [result["pair"] for result in pair_results]
    candidates = [
        candidate
        for result in pair_results
        for candidate in result["candidates"]
    ]
    candidate_index = [
        {
            "candidateId": candidate["candidateId"],
            "pairKey": candidate["pairKey"],
            "source": candidate["source"],
            "changeType": candidate["changeType"],
            "locations": candidate["locations"],
            "git": candidate.get("git"),
            "baselineSha256": candidate["locations"]["baseline"]["sha256"],
            "targetSha256": candidate["locations"]["target"]["sha256"],
        }
        for candidate in candidates
    ]
    limitations.extend(
        limitation
        for result in pair_results
        for limitation in result["limitations"]
    )

    if not pairs:
        limitations.append(
            {
                "kind": "NO_BASELINE_TARGET_PAIR",
                "message": "No matching BASELINE/TARGET input pair was provided",
            }
        )

    generated_at = now_iso()
    elapsed_ms = int((time.monotonic() - started_at) * 1000)
    result = {
        "candidateContractVersion": "2.0",
        "kind": "candidate-material",
        "owner": "deterministic-script",
        "notAConclusion": True,
        "generatedAt": generated_at,
        "parallelism": {
            "mode": "PAIR_TASKS",
            "maxWorkers": max_workers,
            "taskCount": len(ordered_pairs),
        },
        "timing": {
            "elapsedMs": elapsed_ms,
            "similarityAlgorithm": "line-multiset-dice",
        },
        "pairs": pairs,
        "candidates": candidates,
        "limitations": limitations,
    }
    manifest_output = {
        "candidateContractVersion": "2.0",
        "updatedAt": generated_at,
        "inputManifest": "inputs/input-manifest.json",
        "algorithm": {
            "name": "pair-parallel-linear-line-similarity-and-bounded-diff",
            "version": "2.1",
            "candidateConfidenceMeaning": "mechanical similarity only",
        },
        "parallelism": result["parallelism"],
        "timing": result["timing"],
        "indexFile": "candidates/candidate-index.json",
        "contentFile": "candidates/diff-candidates.json",
        "candidateCount": len(candidates),
        "pairCount": len(pairs),
    }
    dump_json_atomic(workspace / "candidates" / "diff-candidates.json", result)
    dump_json_atomic(
        workspace / "candidates" / "candidate-index.json",
        {
            "candidateContractVersion": "2.0",
            "kind": "candidate-index",
            "owner": "deterministic-script",
            "notAConclusion": True,
            "updatedAt": generated_at,
            "contentFile": "candidates/diff-candidates.json",
            "candidateCount": len(candidate_index),
            "entries": candidate_index,
        },
    )
    dump_json_atomic(
        workspace / "candidates" / "candidate-manifest.json",
        manifest_output,
    )
    return {
        "ok": True,
        "workspace": str(workspace),
        "candidateManifest": str(
            workspace / "candidates" / "candidate-manifest.json"
        ),
        "candidateIndex": str(
            workspace / "candidates" / "candidate-index.json"
        ),
        "diffCandidates": str(workspace / "candidates" / "diff-candidates.json"),
        "candidateCount": len(candidates),
        "pairCount": len(pairs),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument(
        "--max-workers",
        type=int,
        default=0,
        help="Bounded pair-level worker count; defaults to min(4, task count)",
    )
    args = parser.parse_args()
    try:
        print_result(generate(args))
        return 0
    except SkillError as error:
        print_error(error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
