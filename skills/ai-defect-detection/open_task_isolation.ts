import { get_task_status, submit_detection } from "./open_platform.ts";
import {
  content_has_work,
  content_store_identity,
  content_store_occupied,
  identities_conflict,
  parse_iso_timestamp,
} from "./open_store.ts";

export class IsolationError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "IsolationError";
  }
}

function _platform_task(task_id: number): Record<string, any> {
  try {
    const result = get_task_status(task_id);
    if (!result || typeof result !== "object" || ![0, null, undefined].includes(result.code)) {
      return {};
    }
    const data = result.data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function _identity_from_platform(task: Record<string, any>): Record<string, any> {
  if (!task || Object.keys(task).length === 0) return {};
  const services = task.services || [];
  const git = task.git || (services.length ? services[0].git : "") || "";
  const branch =
    task.developBranch ||
    task.branch ||
    (services.length ? services[0].branch || services[0].developBranch : "") ||
    "";
  return {
    testPlanId: task.planId || task.testPlanId,
    planName: task.planName,
    gitUrl: git,
    git,
    branch,
    developBranch: branch,
    userId: task.submitUser,
    createdAt: task.createdAt,
  };
}

function _content_predates_platform(existing: Record<string, any>, platform_task: Record<string, any>): boolean {
  const content_ts = parse_iso_timestamp(existing.startedAt);
  const platform_ts = parse_iso_timestamp(platform_task.createdAt);
  if (content_ts === null || platform_ts === null) return false;
  return content_ts < platform_ts;
}

function _should_isolate(task_id: number, incoming: Record<string, any>): [boolean, string] {
  if (!content_store_occupied(task_id)) return [false, ""];
  const existing = content_store_identity(task_id);
  if (!content_has_work(existing)) return [false, ""];

  const platform_task = _platform_task(task_id);
  const platform_identity = _identity_from_platform(platform_task);
  const merged = {
    ...platform_identity,
    ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== null && v !== undefined && v !== "")),
  };

  if (identities_conflict(existing, merged)) {
    return [true, "local directory belongs to another repo/plan/branch"];
  }
  if (Object.keys(platform_task).length && identities_conflict(existing, platform_identity)) {
    return [true, "platform task identity does not match the local directory"];
  }
  if (Object.keys(platform_task).length && _content_predates_platform(existing, platform_task)) {
    return [true, "platform task is new, but the local directory still belongs to the previous task"];
  }
  if (!Object.keys(platform_task).length && !incoming.gitUrl && !incoming.testPlanId) {
    return [true, "local directory already has a previous task and no reusable platform task"];
  }
  return [false, ""];
}

export function allocate_fresh_task(incoming: Record<string, any> | null = null): Record<string, any> {
  incoming = incoming || {};
  const body: Record<string, any> = {
    submitUser: incoming.userId || incoming.submitUser || "local-user",
  };
  if (incoming.testPlanId) {
    body.detectType = "TEST_PLAN";
    body.planId = incoming.testPlanId;
    body.planType = incoming.planType || 2;
    if (incoming.planName) body.planName = incoming.planName;
    const git = incoming.gitUrl || incoming.git;
    if (git) {
      body.services = [
        {
          git,
          gitUrl: git,
          branch: incoming.branch || incoming.developBranch || "",
        },
      ];
    }
  } else if (incoming.gitUrl || incoming.git) {
    const git = incoming.gitUrl || incoming.git;
    body.detectType = "GIT_BRANCH";
    body.git = git;
    body.developBranch = incoming.branch || incoming.developBranch || "HEAD";
  } else {
    body.detectType = "SKILL_DIRECT";
    body.jobInfos = [{ git: "", developBranch: "" }];
  }

  const result = submit_detection(body);
  if (
    !result ||
    typeof result !== "object" ||
    ![0, null, undefined].includes(result.code) ||
    result._error
  ) {
    throw new IsolationError(result?._error || result?.msg || "submit_detection failed");
  }
  let data = result.data;
  let task_id: any;
  let batch_ids: any[];
  if (typeof data === "number" && Number.isInteger(data)) {
    task_id = data;
    batch_ids = [];
  } else {
    data = data || {};
    task_id = data.taskId;
    batch_ids = data.batchIds || [];
  }
  if (!task_id || typeof task_id !== "number" || !Number.isInteger(task_id) || task_id <= 0) {
    throw new IsolationError(`new task did not return a valid taskId: ${JSON.stringify(task_id)}`);
  }
  return { taskId: task_id, batchIds: batch_ids };
}

export function isolate_if_foreign(
  requested_task_id: number | null | undefined,
  incoming: Record<string, any> | null = null,
): Record<string, any> {
  incoming = incoming || {};
  if (
    !requested_task_id ||
    typeof requested_task_id !== "number" ||
    !Number.isInteger(requested_task_id) ||
    requested_task_id <= 0
  ) {
    const fresh = allocate_fresh_task(incoming);
    return {
      taskId: fresh.taskId,
      batchIds: fresh.batchIds || [],
      remapped: true,
      remappedFrom: null,
      reason: "no valid taskId provided; created a new task directory",
    };
  }

  const [isolate, reason] = _should_isolate(requested_task_id, incoming);
  if (!isolate) {
    return {
      taskId: requested_task_id,
      batchIds: [],
      remapped: false,
      remappedFrom: null,
      reason: "",
    };
  }

  const fresh = allocate_fresh_task(incoming);
  return {
    taskId: fresh.taskId,
    batchIds: fresh.batchIds || [],
    remapped: true,
    remappedFrom: requested_task_id,
    reason,
  };
}

export function log_isolation(prefix: string, iso: Record<string, any>): void {
  if (!iso.remapped) return;
  const old = iso.remappedFrom;
  const neu = iso.taskId;
  const reason = iso.reason || "a new task directory is required";
  if (old) {
    console.error(
      `[${prefix}] ${reason}: kept data/${old}, now using data/${neu}. ` +
        `Use taskId=${neu} for subsequent commands; do not delete the old directory.`,
    );
  } else {
    console.error(`[${prefix}] ${reason}: using data/${neu} for this run.`);
  }
}
