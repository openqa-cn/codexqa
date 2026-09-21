#!/usr/bin/env python3
"""Create one empty incremental execution workspace and its identity manifest."""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from pathlib import Path
from typing import Dict

from inc_common import (
    SkillError,
    dump_json_atomic,
    ensure_safe_component,
    exclusive_lock,
    now_iso,
    print_error,
    print_result,
    resolve_run_context,
)


def initialize(args: argparse.Namespace) -> Dict:
    execution_id = ensure_safe_component(args.execution_id, "executionId")
    context = resolve_run_context(
        args.run_dir,
        args.run_id,
        args.run_root,
    )
    public_dir = Path(context["runDir"])
    run_id = context["runId"]
    testcase_root = public_dir / "testcase"
    if testcase_root.is_symlink():
        raise SkillError(
            "TESTCASE_ROOT_SYMLINK_FORBIDDEN",
            "testcase must not be a symbolic link",
            {"path": str(testcase_root)},
        )
    testcase_root.mkdir(parents=True, exist_ok=True)
    case_enhance = testcase_root / ".case-enhance"
    if case_enhance.is_symlink():
        raise SkillError(
            "WORKSPACE_ROOT_SYMLINK_FORBIDDEN",
            ".case-enhance must not be a symbolic link",
            {"path": str(case_enhance)},
        )
    formal_workspace = case_enhance / execution_id
    case_enhance.mkdir(parents=True, exist_ok=True)
    lock_path = case_enhance / ".workspace.lock"
    created_at = now_iso()
    manifest = {
        "workspaceContractVersion": "1.1",
        "runDir": str(public_dir),
        "runRoot": str(public_dir),
        "runId": run_id,
        "testcaseRoot": str(testcase_root),
        "executionId": execution_id,
        "workspaceRef": f"testcase/.case-enhance/{execution_id}",
        "startedAt": created_at,
        "skillName": args.skill_name,
        "skillVersion": args.skill_version,
        "status": "IN_PROGRESS",
    }
    committed_workspace = False
    try:
        with exclusive_lock(lock_path):
            if formal_workspace.exists() or formal_workspace.is_symlink():
                raise SkillError(
                    "EXECUTION_EXISTS",
                    "The execution workspace already exists",
                    {
                        "workspace": str(formal_workspace),
                        "executionId": execution_id,
                    },
                )
            staging = Path(
                tempfile.mkdtemp(
                    prefix=f".staging-{execution_id}-",
                    dir=str(case_enhance),
                )
            )
            for relative in (
                "inputs/raw",
                "candidates",
                "artifacts",
                "outputs/cases",
                "outputs/reports",
                "publication/backup",
                "status",
            ):
                (staging / relative).mkdir(parents=True, exist_ok=True)
            dump_json_atomic(staging / "workspace-manifest.json", manifest)
            dump_json_atomic(
                staging / "status" / "task-status.json",
                {
                    "statusContractVersion": "1.0",
                    "executionId": execution_id,
                    "overallStatus": "IN_PROGRESS",
                    "updatedAt": created_at,
                    "nodes": [],
                },
            )
            (staging / "status" / "task-history.jsonl").write_text(
                "",
                encoding="utf-8",
            )
            os.replace(staging, formal_workspace)
            committed_workspace = True
    except Exception:
        if "staging" in locals() and staging.exists():
            shutil.rmtree(staging)
        if committed_workspace and formal_workspace.exists():
            shutil.rmtree(formal_workspace)
        raise

    return {
        "ok": True,
        "workspace": str(formal_workspace),
        "workspaceRef": manifest["workspaceRef"],
        "runDir": str(public_dir),
        "runRoot": str(public_dir),
        "runId": run_id,
        "testcaseRoot": str(testcase_root),
        "executionId": execution_id,
        "createdAt": created_at,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--execution-id", required=True)
    parser.add_argument("--run-root", default=None)
    parser.add_argument("--skill-name", default="codexqa-testcase-generator")
    parser.add_argument("--skill-version", default="V56")
    args = parser.parse_args()
    try:
        print_result(initialize(args))
        return 0
    except SkillError as error:
        print_error(error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
