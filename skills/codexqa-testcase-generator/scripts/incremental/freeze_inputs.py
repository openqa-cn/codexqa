#!/usr/bin/env python3
"""Freeze an explicit list of raw inputs into one execution workspace."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Dict, List

from inc_common import (
    SkillError,
    copy_source,
    dump_json_atomic,
    ensure_safe_component,
    exclusive_lock,
    inventory_path,
    load_json,
    now_iso,
    print_error,
    print_result,
    sha256_tree,
    workspace_from_arg,
)

GIT_COMMIT_RE = re.compile(r"^[0-9a-fA-F]{40,64}$")


def _repository_id(item: Dict) -> str:
    git_info = item.get("git")
    if not isinstance(git_info, dict):
        git_info = {}
    return ensure_safe_component(
        git_info.get("repositoryId", item.get("repositoryId")),
        "repositoryId",
    )


def _execution_id(workspace: Path) -> str:
    manifest_path = workspace / "workspace-manifest.json"
    if not manifest_path.exists():
        raise SkillError(
            "WORKSPACE_MANIFEST_REQUIRED",
            "workspace-manifest.json is required before archiving inputs",
        )
    return ensure_safe_component(
        load_json(manifest_path).get("executionId"), "executionId"
    )


def _git_error(command: List[str], completed: subprocess.CompletedProcess) -> SkillError:
    stderr = completed.stderr.decode("utf-8", errors="replace").strip()
    return SkillError(
        "GIT_COMMAND_FAILED",
        "Git command failed while freezing a code input",
        {
            "command": command,
            "stderr": stderr[-1000:],
            "returnCode": completed.returncode,
        },
    )


def _run_git(
    command: List[str],
    *,
    stdout=subprocess.PIPE,
    cwd=None,
) -> bytes:
    completed = subprocess.run(
        command,
        cwd=cwd,
        stdout=stdout,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise _git_error(command, completed)
    if stdout is subprocess.PIPE:
        return completed.stdout
    return b""


def _git_commit_id(source: Path, commit_id: object) -> str:
    if not isinstance(commit_id, str) or not GIT_COMMIT_RE.fullmatch(commit_id):
        raise SkillError(
            "GIT_COMMIT_ID_REQUIRED",
            "GIT inputs require a full immutable commitId",
            {"commitId": commit_id},
        )
    command = [
        "git",
        "-C",
        str(source),
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{commit_id}^{{commit}}",
    ]
    resolved = _run_git(command).decode("ascii", errors="strict").strip()
    if not GIT_COMMIT_RE.fullmatch(resolved):
        raise SkillError(
            "GIT_COMMIT_ID_INVALID",
            "Git did not resolve the requested commitId to a full commit",
            {"commitId": commit_id, "resolvedCommitId": resolved},
        )
    return resolved


def _extract_tar_safely(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive_path, mode="r:") as archive:
        members = archive.getmembers()
        for member in members:
            if member.issym() or member.islnk():
                raise SkillError(
                    "GIT_SNAPSHOT_SYMLINK_FORBIDDEN",
                    "Git commit snapshots must not contain symbolic or hard links",
                    {"path": member.name},
                )
            member_path = Path(member.name)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise SkillError(
                    "GIT_SNAPSHOT_PATH_INVALID",
                    "Git commit snapshot contains an unsafe path",
                    {"path": member.name},
                )
            target = (destination / member_path).resolve()
            try:
                target.relative_to(destination.resolve())
            except ValueError as exc:
                raise SkillError(
                    "GIT_SNAPSHOT_PATH_INVALID",
                    "Git commit snapshot escapes its destination",
                    {"path": member.name},
                ) from exc
            if not (member.isdir() or member.isfile()):
                raise SkillError(
                    "GIT_SNAPSHOT_ENTRY_UNSUPPORTED",
                    "Git commit snapshot contains an unsupported entry",
                    {"path": member.name},
                )
        archive.extractall(destination, members=members)


def _archive_git_source(
    source: Path,
    raw_destination: Path,
    git_destination: Path,
    item: Dict,
) -> Dict:
    if not source.is_dir():
        raise SkillError(
            "GIT_REPOSITORY_REQUIRED",
            "GIT input sourcePath must point to a repository directory",
            {"source": str(source)},
        )
    if source.is_symlink():
        raise SkillError(
            "INPUT_SOURCE_SYMLINK_FORBIDDEN",
            "GIT input repository root must not be a symbolic link",
            {"source": str(source)},
        )
    repository_id = _repository_id(item)
    git_info = item.get("git")
    if not isinstance(git_info, dict):
        git_info = {}
    commit_id = git_info.get("commitId", item.get("commitId"))
    resolved_commit_id = _git_commit_id(source, commit_id)

    probe_command = [
        "git",
        "-C",
        str(source),
        "rev-parse",
        "--is-inside-work-tree",
    ]
    probe = _run_git(probe_command).decode("ascii", errors="strict").strip()
    if probe != "true":
        raise SkillError(
            "GIT_WORKTREE_REQUIRED",
            "GIT input sourcePath must be a non-bare working tree",
            {"source": str(source)},
        )

    git_destination.parent.mkdir(parents=True, exist_ok=True)
    if git_destination.exists():
        if not git_destination.is_dir() or git_destination.is_symlink():
            raise SkillError(
                "GIT_ARCHIVE_PATH_INVALID",
                "Shared Git archive path is not a regular directory",
                {"path": str(git_destination)},
            )
    else:
        clone_command = [
            "git",
            "clone",
            "--bare",
            "--no-local",
            str(source),
            str(git_destination),
        ]
        _run_git(clone_command)
    # A commit may exist only under refs/remotes/*, which clone does not copy.
    _run_git(
        [
            "git",
            "--git-dir",
            str(git_destination),
            "fetch",
            "--no-tags",
            str(source),
            resolved_commit_id,
        ]
    )
    archived_commit_id = _run_git(
        [
            "git",
            "--git-dir",
            str(git_destination),
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{resolved_commit_id}^{{commit}}",
        ]
    ).decode("ascii", errors="strict").strip()
    if archived_commit_id != resolved_commit_id:
        raise SkillError(
            "GIT_COMMIT_FREEZE_MISMATCH",
            "Frozen Git repository does not contain the requested commit",
            {
                "requestedCommitId": resolved_commit_id,
                "archivedCommitId": archived_commit_id,
            },
        )

    archive_path = raw_destination.parent / f".{raw_destination.name}.tar"
    try:
        raw_destination.parent.mkdir(parents=True, exist_ok=True)
        with archive_path.open("wb") as handle:
            _run_git(
                [
                    "git",
                    "--git-dir",
                    str(git_destination),
                    "archive",
                    "--format=tar",
                    resolved_commit_id,
                ],
                stdout=handle,
            )
        _extract_tar_safely(archive_path, raw_destination)
    finally:
        if archive_path.exists():
            archive_path.unlink()

    return {
        "repositoryId": repository_id,
        "requestedCommitId": commit_id,
        "resolvedCommitId": resolved_commit_id,
        "repositoryPath": f"inputs/git/{git_destination.name}",
        "diffSource": "GIT_COMMIT_RANGE",
    }


def archive(args: argparse.Namespace) -> Dict:
    workspace = workspace_from_arg(args.workspace)
    request = load_json(args.manifest)
    items = request.get("inputs")
    if not isinstance(items, list) or not items:
        raise SkillError(
            "INPUT_LIST_REQUIRED",
            "The archive request must contain a non-empty inputs[] list",
        )
    manifest_path = workspace / "inputs" / "input-manifest.json"
    if manifest_path.exists():
        raise SkillError(
            "INPUT_MANIFEST_EXISTS",
            "Raw input manifest is immutable and already exists",
            {"path": str(manifest_path)},
        )

    seen_ids = set()
    archive_root = workspace / "inputs"
    staging_root = Path(tempfile.mkdtemp(prefix=".archive-", dir=str(archive_root)))
    staging_raw_root = staging_root / "raw"
    staging_git_root = staging_root / "git"
    archived = []
    moved_paths = []
    checked_git_destinations = set()
    moved_git_destinations = set()
    try:
        for item in items:
            if not isinstance(item, dict):
                raise SkillError(
                    "INPUT_ENTRY_INVALID",
                    "Each input entry must be an object",
                )
            input_id = ensure_safe_component(item.get("inputId"), "inputId")
            if input_id in seen_ids:
                raise SkillError(
                    "DUPLICATE_INPUT_ID",
                    "inputId must be unique within one archive request",
                    {"inputId": input_id},
                )
            seen_ids.add(input_id)

            source_value = item.get("sourcePath")
            if not isinstance(source_value, str) or not source_value:
                raise SkillError(
                    "INPUT_SOURCE_REQUIRED",
                    "Each input entry requires sourcePath",
                    {"inputId": input_id},
                )
            source = Path(source_value).expanduser()
            source_kind = str(item.get("sourceKind", "PATH")).upper()
            if source_kind not in {"PATH", "GIT"}:
                raise SkillError(
                    "INPUT_SOURCE_KIND_INVALID",
                    "sourceKind must be PATH or GIT",
                    {"inputId": input_id, "sourceKind": source_kind},
                )
            if source_kind == "GIT" and not str(
                item.get("slot") or ""
            ).endswith(".code"):
                raise SkillError(
                    "GIT_SOURCE_CODE_ONLY",
                    "GIT sourceKind is only supported for code inputs",
                    {"inputId": input_id, "slot": item.get("slot")},
                )

            destination = staging_raw_root / input_id
            git_metadata = None
            if source_kind == "GIT":
                git_metadata = _archive_git_source(
                    source,
                    destination,
                    staging_git_root / f"{_repository_id(item)}.git",
                    item,
                )
            else:
                copy_source(source, destination)

            entry = {
                "inputId": input_id,
                "slot": item.get("slot"),
                "platform": item.get("platform"),
                "sourceId": item.get("sourceId"),
                "documentKey": item.get("documentKey"),
                "pairKey": item.get("pairKey"),
                "versionRole": item.get("versionRole"),
                "sourceKind": source_kind,
                "originalRef": item.get("originalRef", str(source)),
                "archivedPath": f"inputs/raw/{input_id}",
                "sha256": sha256_tree(destination),
                "inventory": inventory_path(destination),
                "archivedAt": now_iso(),
            }
            if git_metadata is not None:
                entry["git"] = git_metadata
            archived.append(entry)

        with exclusive_lock(archive_root / ".archive.lock"):
            for entry in archived:
                destination = workspace / entry["archivedPath"]
                if destination.exists():
                    raise SkillError(
                        "INPUT_ID_EXISTS",
                        "The inputId is already archived",
                        {"inputId": entry["inputId"]},
                    )
                git = entry.get("git")
                if isinstance(git, dict):
                    git_destination = workspace / git["repositoryPath"]
                    git_key = str(git_destination)
                    if git_key in checked_git_destinations:
                        continue
                    checked_git_destinations.add(git_key)
                    if git_destination.exists():
                        raise SkillError(
                            "GIT_REPOSITORY_EXISTS",
                            "The Git repository archive already exists",
                            {
                                "inputId": entry["inputId"],
                                "path": str(git_destination),
                            },
                        )
            for entry in archived:
                destination = workspace / entry["archivedPath"]
                (staging_raw_root / entry["inputId"]).rename(destination)
                moved_paths.append(destination)
                git = entry.get("git")
                if isinstance(git, dict):
                    git_destination = workspace / git["repositoryPath"]
                    git_key = str(git_destination)
                    if git_key in moved_git_destinations:
                        continue
                    git_destination.parent.mkdir(parents=True, exist_ok=True)
                    (
                        staging_git_root / Path(git_destination).name
                    ).rename(git_destination)
                    moved_paths.append(git_destination)
                    moved_git_destinations.add(git_key)
            dump_json_atomic(
                manifest_path,
                {
                    "inputContractVersion": "1.1",
                    "executionId": _execution_id(workspace),
                    "archivedAt": now_iso(),
                    "inputs": archived,
                },
            )
    except Exception:
        for destination in moved_paths:
            if destination.exists():
                if destination.is_dir():
                    shutil.rmtree(destination)
                else:
                    destination.unlink()
        raise
    finally:
        if staging_root.exists():
            shutil.rmtree(staging_root)

    return {
        "ok": True,
        "workspace": str(workspace),
        "manifest": str(manifest_path),
        "inputs": archived,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    try:
        print_result(archive(args))
        return 0
    except SkillError as error:
        print_error(error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
