import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "detect.ts");

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function lastJson(proc: ReturnType<typeof spawnSync>) {
  const text = (proc.stdout || "").trim();
  assert.ok(text, proc.stderr || "empty stdout");
  return JSON.parse(text);
}

describe("cli smoke", () => {
  it("help lists key commands", () => {
    const proc = run({}, "--help");
    assert.equal(proc.status, 0);
    assert.match(proc.stdout, /submit-git/);
    assert.match(proc.stdout, /gitnexus-impact/);
  });

  it("plan tags rules and git task", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-"));
    const env = {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(ROOT, "enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    };
    const plan = run(env, "get-plan-info", "--plan-id", "1001", "--plan-type", "2");
    assert.equal(plan.status, 0, plan.stderr);
    const planJson = lastJson(plan);
    assert.equal(planJson.code, 0);
    assert.equal(planJson.data.planId, 1001);
    assert.equal(planJson.source, "provider");
    const golden = JSON.parse(readFileSync(join(ROOT, "tests/golden/get-plan-info.1001.json"), "utf8"));
    assert.deepEqual(planJson, golden);

    const tags = run(env, "get-tag-list");
    assert.equal(tags.status, 0, tags.stderr);
    const tagJson = lastJson(tags);
    assert.ok((tagJson.data || []).length >= 12);
    assert.ok(tagJson.data.some((t: any) => t.children));

    const rules = run(env, "get-rules", "--git", "git@github.com:acme/order-service.git", "--user-id", "alice");
    assert.equal(rules.status, 0, rules.stderr);
    const custom = lastJson(rules).data.customRules;
    assert.ok(custom.some((r: any) => r.category === 1 && r.description));

    const submitted = run(env, "submit-git", "--git", "git@github.com:acme/order-service.git", "--branch", "feature/demo", "--submit-user", "alice");
    assert.equal(submitted.status, 0, submitted.stderr);
    const taskId = lastJson(submitted).data.taskId;
    assert.ok(taskId > 0);

    const status = run(env, "status", "--task-id", String(taskId));
    assert.equal(status.status, 0, status.stderr);
    assert.equal(lastJson(status).data.status, "in_progress");

    const defects = run(env, "get-delivery-defects", "--plan-id", "1001", "--plan-type", "2");
    assert.equal(defects.status, 0, defects.stderr);
  });

  it("degrades when plan file is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-"));
    const env = {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(tmp, "empty_enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    };
    const missing = run(env, "get-plan-info", "--plan-id", "99999", "--plan-type", "2");
    assert.equal(missing.status, 0, missing.stderr);
    const body = lastJson(missing);
    assert.equal(body.code, 0);
    assert.equal(body.degraded, true);
    assert.equal(body.source, "empty");
    assert.ok(body.missing.includes("services"));
    assert.ok(body.blocking.includes("services"));
    assert.ok(body.askUser.length);
    assert.equal(body.hasUserMaterials, false);

    const checked = run(env, "check-materials", "--plan-id", "99999", "--plan-type", "2");
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(lastJson(checked).data.canStart, false);

    const assembled = run(
      env,
      "get-plan-info",
      "--plan-id",
      "99999",
      "--plan-type",
      "2",
      "--git",
      "git@github.com:acme/order-service.git",
      "--branch",
      "feature/demo",
      "--user-materials-json",
      JSON.stringify({
        planName: "Ad-hoc checkout",
        testCases: [{ id: "TC-U1", title: "reject zero amount", steps: "pay 0" }],
        requirementDocs: [{ title: "rules", content: "amount must be greater than zero" }],
      }),
    );
    assert.equal(assembled.status, 0, assembled.stderr);
    const assembledJson = lastJson(assembled);
    assert.equal(assembledJson.degraded, true);
    assert.match(String(assembledJson.source), /user_input/);
    assert.equal(assembledJson.hasUserMaterials, true);
    assert.equal(assembledJson.data.services[0].git, "git@github.com:acme/order-service.git");
    assert.ok(!assembledJson.missing.includes("services"));
  });
});
