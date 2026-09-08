import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "detect.ts");

const GIT = "git@github.com:acme/order-service.git";
const BRANCH = "feature/checkout-guard";
const CLASS_NAME = "com/example/order/OrderService";
const METHOD = "checkout";

const ENGLISH_SUMMARY =
  "📋[Requirement changes] Checkout now rejects a negative amount in OrderService.checkout.    " +
  "🔍[Analysis scope] Covers order-service, 1 class, 1 method; focus chain OrderController.create → OrderService.checkout.    " +
  "⚠️[Risks]▎This change ▸(1)❗ OrderService.checkout lines 24-28｜trigger: missing user id｜impact: API 500 on checkout.    " +
  "📌[Notes]►Test: submit checkout with a missing user id and expect no 500.►Release: no config change.    " +
  "✅[Conclusion] One high-risk null dereference in this change; fix before release.";

const RANK_CONTENT = [
  "Defect: checkout does not null-check user",
  "",
  "Lines:24-28",
  "",
  "Problem description: line 24 user = map.get(id) may be null; line 28 calls user.getName() and can NPE.",
  "",
  "Problem tags: [Null pointer][This change]",
  "",
  "Impact scope: checkout API",
  "",
  "Affected business: a missing user id makes checkout return 500",
  "",
  "Reproduction path: call checkout → pass a missing id → map.get returns null → getName() throws",
  "",
  "Trigger conditions:",
  "1. user id is not in the map",
  "2. checkout is called",
  "",
  "Expected vs actual:",
  "- expected: return a friendly error",
  "- actual: NullPointerException, API 500",
  "",
  "Fix suggestion: null-check user before reading fields",
  "",
  "```java",
  "if (user == null) { return Result.empty(); }",
  "```",
].join("\n");

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

function isolatedEnv() {
  const tmp = mkdtempSync(join(tmpdir(), "dd-hf-"));
  return {
    tmp,
    env: {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(ROOT, "enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    } as NodeJS.ProcessEnv,
  };
}

describe("highest-frequency user scenarios", () => {
  it("S1 git branch: submit-git creates a task", () => {
    const { env } = isolatedEnv();
    const submitted = run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice");
    assert.equal(submitted.status, 0, submitted.stderr);
    const body = lastJson(submitted);
    assert.equal(body.code, 0);
    assert.ok(body.data.taskId > 0);
    assert.ok(Array.isArray(body.data.batchIds) && body.data.batchIds.length >= 1);
    const status = run(env, "status", "--task-id", String(body.data.taskId));
    assert.equal(status.status, 0, status.stderr);
    assert.equal(lastJson(status).data.status, "in_progress");
  });

  it("S2 test plan: get-plan-info 1001 then submit-plan", () => {
    const { env } = isolatedEnv();
    const plan = run(env, "get-plan-info", "--plan-id", "1001", "--plan-type", "2");
    assert.equal(plan.status, 0, plan.stderr);
    const planJson = lastJson(plan);
    assert.equal(planJson.code, 0);
    assert.equal(planJson.data.planId, 1001);
    assert.equal(planJson.data.planName, "Order checkout validation");
    assert.equal(planJson.data.services[0].git, GIT);
    assert.ok(planJson.data.testCaseIds.includes("TC-1001"));

    const submitted = run(env, "submit-plan", "--plan-id", "1001", "--plan-type", "2", "--submit-user", "alice");
    assert.equal(submitted.status, 0, submitted.stderr);
    const task = lastJson(submitted);
    assert.equal(task.code, 0);
    assert.ok(task.data.taskId > 0);
  });

  it("S3 missing plan degrades, chat materials assemble services", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-hf-empty-"));
    const env = {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(tmp, "empty_enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    };
    const missing = run(env, "get-plan-info", "--plan-id", "99999", "--plan-type", "2");
    assert.equal(missing.status, 0, missing.stderr);
    const body = lastJson(missing);
    assert.equal(body.degraded, true);
    assert.equal(body.hasUserMaterials, false);

    const assembled = run(
      env,
      "get-plan-info",
      "--plan-id",
      "99999",
      "--plan-type",
      "2",
      "--git",
      GIT,
      "--branch",
      BRANCH,
      "--user-materials-json",
      JSON.stringify({
        planName: "Ad-hoc checkout",
        testCases: [{ id: "TC-U1", title: "reject zero amount", steps: "pay 0" }],
        requirementDocs: [{ title: "rules", content: "amount must be greater than zero" }],
      }),
    );
    assert.equal(assembled.status, 0, assembled.stderr);
    const assembledJson = lastJson(assembled);
    assert.equal(assembledJson.hasUserMaterials, true);
    assert.equal(assembledJson.data.services[0].git, GIT);
  });

  it("S4 tags and rules stay English after localization", () => {
    const { env } = isolatedEnv();
    const tags = run(env, "get-tag-list");
    assert.equal(tags.status, 0, tags.stderr);
    const list = lastJson(tags).data as Array<any>;
    const names = list.flatMap((t) => [t.name, t.tagName, ...(t.children || []).map((c: any) => c.name)]);
    assert.ok(names.includes("Null pointer / null value"));
    assert.ok(names.includes("Spec vs implementation mismatch"));
    assert.ok(names.includes("Swallowed exception"));
    assert.ok(!names.some((n: string) => /[\u4e00-\u9fff]/.test(String(n || ""))));

    const rules = run(env, "get-rules", "--git", GIT, "--user-id", "alice");
    assert.equal(rules.status, 0, rules.stderr);
    const custom = lastJson(rules).data.customRules;
    assert.ok(custom.some((r: any) => r.category === 1));
  });

  it("S5-S8 write-back, finalize-rank, complete-task, confirm", () => {
    const { tmp, env } = isolatedEnv();
    const submitted = run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice");
    assert.equal(submitted.status, 0, submitted.stderr);
    const created = lastJson(submitted).data;
    const taskId = String(created.taskId);
    const batchId = String(created.batchIds[0]);

    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "HF checkout", "--git-url", GIT, "--branch", BRANCH).status, 0);
    assert.equal(
      run(env, "add-service-to-content", "--task-id", taskId, "--git-url", GIT, "--branch", BRANCH, "--batch-ids", batchId, "--language", "java").status,
      0,
    );

    const localDir = join(tmpdir(), "defect-detection", `hf-${created.taskId}`);
    mkdirSync(localDir, { recursive: true });
    mkdirSync(join(localDir, "src/main/java/com/example/order"), { recursive: true });
    writeFileSync(
      join(localDir, "src/main/java/com/example/order/OrderService.java"),
      [
        "package com.example.order;",
        "public class OrderService {",
        "    public String checkout(String id) {",
        ...Array.from({ length: 20 }, () => "        // padding"),
        "        User user = map.get(id);",
        "        if (id == null) {",
        "            return null;",
        "        }",
        "        return user.getName();",
        "    }",
        "}",
        "",
      ].join("\n"),
    );
    assert.equal(
      run(
        env,
        "register-repo-clone",
        "--task-id",
        taskId,
        "--batch-id",
        batchId,
        "--git-url",
        GIT,
        "--local-dir",
        localDir,
        "--branch",
        BRANCH,
        "--commit-id",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ).status,
      0,
    );
    assert.equal(
      run(env, "register-code-read", "--task-id", taskId, "--batch-id", batchId, "--class-name", CLASS_NAME, "--file-path", "src/main/java/com/example/order/OrderService.java", "--code-snippet", "public void checkout() {}").status,
      0,
    );
    assert.equal(
      run(env, "register-context-read", "--task-id", taskId, "--batch-id", batchId, "--class-name", "com/example/order/OrderController", "--file-path", "src/main/java/com/example/order/OrderController.java", "--purpose", "caller").status,
      0,
    );
    assert.equal(
      run(
        env,
        "add-detection-plan-item",
        "--task-id",
        taskId,
        "--item-json",
        JSON.stringify({
          className: CLASS_NAME,
          methodName: METHOD,
          strategyCode: 11,
          batchId: Number(batchId),
          filePath: "src/main/java/com/example/order/OrderService.java",
          status: "pending",
        }),
      ).status,
      0,
    );

    const item = {
      parentBatchId: Number(batchId),
      className: CLASS_NAME,
      methodName: METHOD,
      strategyCode: 11,
      bugStatus: 6,
      detectTier: "T3",
      tagId: 105,
      confidenceScore: 0.9,
      thinking:
        "Walk the call chain OrderController#create → OrderService#checkout → UserDao#query: " +
        "checkout line 28 uses a map.get result without a null check. [Confidence:HIGH] " +
        "A missing id under concurrency can NPE and fail checkout.",
      content: RANK_CONTENT.replace(
        "Reproduction path:",
        "Call chain: OrderController#create → OrderService#checkout → UserDao#query\n\nReproduction path:",
      ).replace(
        "Impact scope:",
        "Test case ID: [TC-1001](https://example.test/TC-1001)\n\nImpact scope:",
      ),
      fileCodes: [
        {
          filePath: "src/main/java/com/example/order/OrderService.java",
          methodNames: [METHOD],
          git: GIT,
          branch: BRANCH,
          commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        {
          filePath: "src/main/java/com/example/order/OrderController.java",
          methodNames: ["create"],
          git: GIT,
          branch: BRANCH,
          commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      processSteps: [
        {
          step: "first_round_detection",
          stepKey: "first_round_detection",
          stepStatus: "executed",
          hasBug: true,
          conclusion: "checkout line 28 calls user.getName() without a null check — NPE risk",
          question: "Does checkout null-check map.get(id)?",
          referencedSources: [{ sourceType: "test_case", sourceId: "TC-1001", sourceName: "Reject negative checkout amount" }],
        },
      ],
    };
    const itemsFile = join(tmp, "items.json");
    writeFileSync(itemsFile, JSON.stringify([item]));
    const written = run(env, "batch-update-process", "--task-id", taskId, "--items-json", itemsFile);
    assert.equal(written.status, 0, written.stderr + written.stdout);
    const writtenJson = lastJson(written);
    assert.equal(writtenJson.code, 0);
    const processId = String(writtenJson.data?.results?.[0]?.processId || writtenJson.data?.processIds?.[0] || "");

    const neither = run(env, "finalize-rank", "--task-id", taskId, "--batch-id", batchId, "--class-name", CLASS_NAME, "--method-name", METHOD, "--bug-status", "6");
    assert.equal(neither.status, 2);
    assert.match(neither.stderr, /one of the arguments --content --content-file is required/);

    const both = run(
      env,
      "finalize-rank",
      "--task-id",
      taskId,
      "--batch-id",
      batchId,
      "--class-name",
      CLASS_NAME,
      "--method-name",
      METHOD,
      "--bug-status",
      "6",
      "--content",
      RANK_CONTENT,
      "--content-file",
      itemsFile,
    );
    assert.equal(both.status, 2);
    assert.match(both.stderr, /not allowed with argument/);

    const rankFile = join(tmp, "rank.txt");
    writeFileSync(rankFile, RANK_CONTENT);
    const ranked = run(
      env,
      "finalize-rank",
      "--task-id",
      taskId,
      "--batch-id",
      batchId,
      "--class-name",
      CLASS_NAME,
      "--method-name",
      METHOD,
      "--bug-status",
      "6",
      "--content-file",
      rankFile,
      ...(processId ? ["--process-ids", processId] : []),
    );
    assert.equal(ranked.status, 0, ranked.stderr + ranked.stdout);
    const rankJson = lastJson(ranked);
    assert.equal(rankJson.code, 0);
    assert.ok(rankJson.data.rankId > 0);

    const coverage = run(env, "check-coverage", "--batch-id", batchId);
    assert.equal(coverage.status, 0, coverage.stderr);
    assert.equal(lastJson(coverage).data.allCompleted, true);

    const integrity = run(env, "check-rank-integrity", "--batch-id", batchId);
    assert.equal(integrity.status, 0, integrity.stderr);
    assert.equal(lastJson(integrity).data.allConsistent, true);

    const preview = run(env, "validate-summary", "--summary", ENGLISH_SUMMARY);
    assert.equal(preview.status, 0, preview.stderr + preview.stdout);
    assert.equal(lastJson(preview).code, 0);

    const completed = run(env, "complete-task", "--task-id", taskId, "--batch-ids", batchId, "--summary", ENGLISH_SUMMARY);
    assert.equal(completed.status, 0, completed.stderr + completed.stdout);
    const done = lastJson(completed);
    assert.equal(done.code, 0);
    assert.equal(done.data.status, "completed");
    assert.equal(done._summary_status, "OK");
    assert.equal(done._reconcile_status, "CONSISTENT");
    assert.match(String(done.data.reportUrl), /^file:\/\//);

    const report = run(env, "get-report", "--task-id", taskId);
    assert.equal(report.status, 0, report.stderr);
    const reportJson = lastJson(report);
    assert.ok(reportJson.data.defects.length >= 1);
    assert.match(String(reportJson.data.defects[0].content || RANK_CONTENT), /Defect:/);

    const marked = run(env, "mark-bug", "--rank-id", String(rankJson.data.rankId), "--bug-status", "3", "--task-id", taskId);
    assert.equal(marked.status, 0, marked.stderr + marked.stdout);
    assert.equal(lastJson(marked).code, 0);
    rmSync(localDir, { recursive: true, force: true });
  });
});
