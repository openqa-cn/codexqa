#!/usr/bin/env python3
"""Small deterministic helpers shared by the incremental Skill scripts."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Union

# Parent scripts/ is not always on sys.path when this file is imported as inc_common.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from py_version import require_py310  # noqa: E402

require_py310()


BEIJING_TIMEZONE = timezone(timedelta(hours=8))
ALLOWED_STATUSES = {
    "PENDING",
    "IN_PROGRESS",
    "WAITING_CONFIRMATION",
    "BLOCKED",
    "COMPLETED",
    "INVALIDATED",
}


class SkillError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: Optional[Dict] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_dict(self) -> Dict:
        return {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


def now_iso() -> str:
    return datetime.now(BEIJING_TIMEZONE).isoformat(timespec="seconds")


def load_json(path: Union[Path, str]) -> Dict:
    source = Path(path)
    try:
        with source.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError as exc:
        raise SkillError(
            "JSON_FILE_MISSING",
            "JSON file does not exist",
            {"path": str(source)},
        ) from exc
    except json.JSONDecodeError as exc:
        raise SkillError(
            "JSON_INVALID",
            "JSON file is not valid",
            {"path": str(source), "line": exc.lineno, "column": exc.colno},
        ) from exc
    if not isinstance(value, dict):
        raise SkillError("JSON_OBJECT_REQUIRED", "JSON root must be an object")
    return value


def dump_json_atomic(path: Union[Path, str], value: object) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.",
        suffix=".tmp",
        dir=str(target.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def write_bytes_atomic(path: Union[Path, str], data: bytes) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.",
        suffix=".tmp",
        dir=str(target.parent),
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Union[Path, str]) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_tree(root: Union[Path, str]) -> str:
    base = Path(root)
    if base.is_file():
        return sha256_file(base)
    digest = hashlib.sha256()
    for path in sorted(
        item for item in base.rglob("*") if item.is_file() and not item.is_symlink()
    ):
        relative = path.relative_to(base).as_posix().encode("utf-8")
        data = path.read_bytes()
        digest.update(relative)
        digest.update(b"\0")
        digest.update(str(len(data)).encode("ascii"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(data).digest())
        digest.update(b"\n")
    return digest.hexdigest()


def ensure_absolute_dir(value: str, field_name: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise SkillError(
            "ABSOLUTE_PATH_REQUIRED",
            f"{field_name} must be an absolute path",
            {"field": field_name, "value": value},
        )
    if not path.exists() or not path.is_dir():
        raise SkillError(
            "DIRECTORY_REQUIRED",
            f"{field_name} must point to an existing directory",
            {"field": field_name, "value": value},
        )
    return path


def ensure_within(path: Path, root: Path) -> Path:
    candidate = path.resolve(strict=False)
    base = root.resolve(strict=True)
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise SkillError(
            "PATH_OUTSIDE_WORKSPACE",
            "Path must remain inside the workspace",
            {"path": str(path), "workspace": str(root)},
        ) from exc
    return candidate


def ensure_safe_component(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not value or value in {".", ".."}:
        raise SkillError(
            "INVALID_PATH_COMPONENT",
            f"{field_name} must be a non-empty single path component",
            {"field": field_name, "value": value},
        )
    if "/" in value or "\\" in value or "\x00" in value:
        raise SkillError(
            "INVALID_PATH_COMPONENT",
            f"{field_name} must not contain path separators",
            {"field": field_name, "value": value},
        )
    return value


def _user_config_path(run_dir: Path) -> Path:
    return run_dir / "testcase" / "testdocs" / "userConfig.json"


def resolve_run_context(
    run_dir: Union[str, Path],
    run_id: str,
    run_root: Union[str, Path, None] = None,
) -> Dict[str, str]:
    """Validate Agent-provided identity against userConfig.json."""
    if not isinstance(run_id, str) or not run_id:
        raise SkillError(
            "RUN_ID_REQUIRED",
            "runId must be the userConfig.runid already confirmed by the Agent",
        )
    safe_run_id = ensure_safe_component(run_id, "runId")
    public_dir = ensure_absolute_dir(os.fspath(run_dir), "run_dir")
    if public_dir.is_symlink():
        raise SkillError(
            "RUN_DIR_SYMLINK_FORBIDDEN",
            "run_dir must not be a symbolic link",
            {"runDir": str(public_dir)},
        )
    public_dir = public_dir.resolve()

    root_value = os.fspath(run_root) if run_root else str(public_dir)
    root = ensure_absolute_dir(root_value, "runRoot")
    if root.is_symlink():
        raise SkillError(
            "RUN_ROOT_SYMLINK_FORBIDDEN",
            "runRoot must not be a symbolic link",
            {"runRoot": str(root)},
        )
    root = root.resolve()
    if root != public_dir:
        raise SkillError(
            "RUN_ROOT_MISMATCH",
            "runRoot must equal userConfig.runDir",
            {"runDir": str(public_dir), "runRoot": str(root)},
        )

    config_path = _user_config_path(public_dir)
    config = load_json(config_path)
    config_run_dir = config.get("runDir")
    config_run_id = config.get("runid")
    if not isinstance(config_run_dir, str) or not config_run_dir:
        raise SkillError(
            "USER_CONFIG_RUN_DIR_MISSING",
            "userConfig.json must contain runDir",
            {"path": str(config_path)},
        )
    if not isinstance(config_run_id, str) or not config_run_id:
        raise SkillError(
            "USER_CONFIG_RUN_ID_MISSING",
            "userConfig.json must contain runid",
            {"path": str(config_path)},
        )
    resolved_config_dir = Path(config_run_dir).expanduser().resolve()
    if resolved_config_dir != public_dir:
        raise SkillError(
            "USER_CONFIG_RUN_DIR_MISMATCH",
            "Agent-provided run_dir must match userConfig.runDir",
            {
                "runDir": str(public_dir),
                "userConfigRunDir": str(resolved_config_dir),
            },
        )
    if config_run_id != safe_run_id:
        raise SkillError(
            "USER_CONFIG_RUN_ID_MISMATCH",
            "Agent-provided runId must match userConfig.runid",
            {"runId": safe_run_id, "userConfigRunid": config_run_id},
        )
    return {
        "runDir": str(public_dir),
        "runRoot": str(public_dir),
        "runId": safe_run_id,
    }


def workspace_from_arg(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise SkillError(
            "ABSOLUTE_PATH_REQUIRED",
            "workspace must be an absolute path",
            {"workspace": value},
        )
    if not path.exists() or not path.is_dir():
        raise SkillError(
            "WORKSPACE_REQUIRED",
            "workspace must point to an existing execution directory",
            {"workspace": value},
        )
    if path.is_symlink():
        raise SkillError(
            "WORKSPACE_SYMLINK_FORBIDDEN",
            "workspace must not be a symbolic link",
            {"workspace": value},
        )
    workspace = path.resolve()
    manifest = load_json(workspace / "workspace-manifest.json")
    run_dir_value = manifest.get("runDir")
    run_root_value = manifest.get("runRoot") or run_dir_value
    run_id_value = manifest.get("runId")
    execution_id = ensure_safe_component(
        manifest.get("executionId"), "executionId"
    )
    if not isinstance(run_dir_value, str):
        raise SkillError(
            "WORKSPACE_MANIFEST_INVALID",
            "workspace-manifest.json must contain runDir",
        )
    context = resolve_run_context(
        run_dir_value,
        run_id_value,
        run_root_value,
    )
    expected = (
        Path(context["runDir"])
        / "testcase"
        / ".case-enhance"
        / execution_id
    )
    expected_testcase_root = str(Path(context["runDir"]) / "testcase")
    if manifest.get("testcaseRoot") != expected_testcase_root:
        raise SkillError(
            "WORKSPACE_IDENTITY_MISMATCH",
            "testcaseRoot does not match runDir/testcase",
            {
                "manifestTestcaseRoot": manifest.get("testcaseRoot"),
                "expectedTestcaseRoot": expected_testcase_root,
            },
        )
    if workspace != expected:
        raise SkillError(
            "WORKSPACE_IDENTITY_MISMATCH",
            "workspace path does not match runDir, testcase and executionId",
            {
                "workspace": str(workspace),
                "expected": str(expected),
            },
        )
    expected_ref = f"testcase/.case-enhance/{execution_id}"
    if manifest.get("workspaceRef") != expected_ref:
        raise SkillError(
            "WORKSPACE_IDENTITY_MISMATCH",
            "workspaceRef does not match the testcase workspace layout",
            {
                "manifestWorkspaceRef": manifest.get("workspaceRef"),
                "expectedWorkspaceRef": expected_ref,
            },
        )
    return workspace


@contextmanager
def exclusive_lock(lock_path: Path) -> Iterator[None]:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise SkillError(
            "WORKSPACE_BUSY",
            "Another operation is writing the same workspace",
            {"lockPath": str(lock_path)},
        ) from exc
    try:
        os.write(fd, f"{os.getpid()} {now_iso()}\n".encode("utf-8"))
        os.close(fd)
        yield
    finally:
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def copy_source(source: Path, destination: Path) -> None:
    if not source.is_absolute():
        raise SkillError(
            "INPUT_SOURCE_ABSOLUTE_PATH_REQUIRED",
            "Input source must be an absolute path",
            {"source": str(source)},
        )
    if not source.exists():
        raise SkillError(
            "INPUT_SOURCE_MISSING",
            "Input source does not exist",
            {"source": str(source)},
        )
    if source.is_symlink():
        raise SkillError(
            "INPUT_SOURCE_SYMLINK_FORBIDDEN",
            "Input source root must not be a symbolic link",
            {"source": str(source)},
        )
    if source.is_dir():
        for path in source.rglob("*"):
            if path.is_symlink():
                raise SkillError(
                    "INPUT_SOURCE_SYMLINK_FORBIDDEN",
                    "Input source tree must not contain symbolic links",
                    {"source": str(path)},
                )
        shutil.copytree(source, destination, symlinks=False)
        return
    if not source.is_file():
        raise SkillError(
            "INPUT_SOURCE_UNSUPPORTED",
            "Input source must be a regular file or directory",
            {"source": str(source)},
        )
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copy2(source, destination / source.name)


def inventory_path(root: Path) -> List[Dict]:
    if root.is_file():
        data = root.read_bytes()
        return [
            {
                "path": root.name,
                "kind": "file",
                "size": len(data),
                "sha256": sha256_bytes(data),
            }
        ]
    entries = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise SkillError(
                "INPUT_SOURCE_SYMLINK_FORBIDDEN",
                "Input source tree must not contain symbolic links",
                {"source": str(path)},
            )
        if path.is_file():
            data = path.read_bytes()
            entries.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "kind": "file",
                    "size": len(data),
                    "sha256": sha256_bytes(data),
                }
            )
    return entries


def print_result(value: Dict, output: Optional[str] = None) -> None:
    if output:
        dump_json_atomic(output, value)
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def print_error(error: SkillError) -> None:
    print(json.dumps(error.as_dict(), ensure_ascii=False, indent=2, sort_keys=True))
