#!/usr/bin/env python3
"""Apply an explicit task status request without inferring business state."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Dict

from inc_common import (
    ALLOWED_STATUSES,
    SkillError,
    dump_json_atomic,
    ensure_within,
    exclusive_lock,
    load_json,
    now_iso,
    print_error,
    print_result,
    sha256_file,
    write_bytes_atomic,
    workspace_from_arg,
)


def _state_hash(value: Dict) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def update(args: argparse.Namespace) -> Dict:
    workspace = workspace_from_arg(args.workspace)
    request = load_json(args.request)
    changes = request.get("changes")
    if not isinstance(changes, list) or not changes:
        raise SkillError(
            "STATUS_CHANGES_REQUIRED",
            "The status request must contain a non-empty changes[] list",
        )

    status_dir = workspace / "status"
    status_path = status_dir / "task-status.json"
    history_path = status_dir / "task-history.jsonl"
    with exclusive_lock(status_dir / ".status.lock"):
        current = (
            load_json(status_path)
            if status_path.exists()
            else {
                "statusContractVersion": "1.0",
                "executionId": load_json(
                    workspace / "workspace-manifest.json"
                ).get("executionId"),
                "overallStatus": "IN_PROGRESS",
                "nodes": [],
            }
        )
        if not isinstance(current.get("nodes"), list):
            raise SkillError(
                "STATUS_FILE_INVALID",
                "task-status.json must contain nodes[]",
            )
        nodes = {
            item["nodeId"]: dict(item)
            for item in current.get("nodes", [])
            if isinstance(item, dict) and isinstance(item.get("nodeId"), str)
        }
        normalized_changes = []
        for change in changes:
            if not isinstance(change, dict) or not isinstance(
                change.get("nodeId"), str
            ):
                raise SkillError(
                    "STATUS_CHANGE_INVALID",
                    "Each status change requires nodeId",
                )
            node_id = change["nodeId"]
            status = change.get("status")
            if status not in ALLOWED_STATUSES:
                raise SkillError(
                    "STATUS_INVALID",
                    "Unsupported task status",
                    {"nodeId": node_id, "status": status},
                )
            updated = dict(nodes.get(node_id, {}))
            updated.update(
                {
                    "nodeId": node_id,
                    "status": status,
                    "updatedAt": now_iso(),
                }
            )
            for field in (
                "reason",
                "artifactPath",
                "artifactSha256",
                "nextActions",
                "dependsOn",
                "invalidatedNodes",
            ):
                if field in change:
                    updated[field] = change[field]
            artifact_path = updated.get("artifactPath")
            if artifact_path is not None:
                if not isinstance(artifact_path, str) or Path(
                    artifact_path
                ).is_absolute():
                    raise SkillError(
                        "ARTIFACT_PATH_INVALID",
                        "artifactPath must be workspace-relative",
                        {"nodeId": node_id, "artifactPath": artifact_path},
                    )
                candidate = ensure_within(workspace / artifact_path, workspace)
                if (
                    candidate.exists()
                    and candidate.is_file()
                    and "artifactSha256" not in updated
                ):
                    updated["artifactSha256"] = sha256_file(candidate)
            nodes[node_id] = updated
            normalized_changes.append(updated)

        before = dict(current)
        current["updatedAt"] = now_iso()
        current["nodes"] = [nodes[key] for key in sorted(nodes)]
        statuses = [node["status"] for node in current["nodes"]]
        if statuses and all(status == "COMPLETED" for status in statuses):
            current["overallStatus"] = "COMPLETED"
        elif any(status == "BLOCKED" for status in statuses):
            current["overallStatus"] = "BLOCKED"
        else:
            current["overallStatus"] = "IN_PROGRESS"

        history = (
            history_path.read_text(encoding="utf-8").splitlines()
            if history_path.exists()
            else []
        )
        history.append(
            json.dumps(
                {
                    "eventAt": now_iso(),
                    "operation": "STATUS_UPDATE",
                    "reason": request.get("reason"),
                    "changes": normalized_changes,
                    "beforeStatusSha256": _state_hash(before),
                    "afterStatusSha256": _state_hash(current),
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        original_status = status_path.read_bytes() if status_path.exists() else None
        original_history = history_path.read_bytes() if history_path.exists() else None
        status_bytes = (
            json.dumps(
                current,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
        history_bytes = ("\n".join(history) + "\n").encode("utf-8")
        try:
            write_bytes_atomic(status_path, status_bytes)
            write_bytes_atomic(history_path, history_bytes)
        except Exception:
            if original_status is None:
                status_path.unlink(missing_ok=True)
            else:
                write_bytes_atomic(status_path, original_status)
            if original_history is None:
                history_path.unlink(missing_ok=True)
            else:
                write_bytes_atomic(history_path, original_history)
            raise

    return {
        "ok": True,
        "workspace": str(workspace),
        "status": str(status_path),
        "history": str(history_path),
        "overallStatus": current["overallStatus"],
        "changes": normalized_changes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        print_result(update(args))
        return 0
    except SkillError as error:
        print_error(error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
