import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const FILE_PATH = "src/main/java/com/example/order/OrderService.java";
const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const ENGLISH_SUMMARY =
  "📋[Requirement changes] Checkout now rejects a negative amount in OrderService.checkout.    " +
  "🔍[Analysis scope] Covers order-service, 1 class, 1 method; focus chain OrderController.create → OrderService.checkout.    " +
  "⚠️[Risks]▎This change ▸(1)❗ OrderService.checkout lines 24-28｜trigger: missing user id｜impact: API 500 on checkout.    " +
  "📌[Notes]►Test: submit checkout with a missing user id and expect no 500.►Release: no config change.    " +
  "✅[Conclusion] One high-risk null dereference in this change; fix before release.";

const NO_DEFECT_SUMMARY =
  "📋[Requirement changes] Checkout guard added.    " +
  "🔍[Analysis scope] order-service OrderService.checkout only.    " +
  "⚠️[Risks]▎This change none.    " +
  "📌[Notes]►No extra test.    " +
  "✅[Conclusion] No defect in this code.";

const RANK_CONTENT = [
  "Defect: checkout does not null-check user",
  "",
  "Lines:24-28",
  "",
  "Problem description: line 24 user = map.get(id) may be null; line 28 calls user.getName() and can NPE.",
  "",
  "Problem tags: [Null pointer][This change]",
  "",
  "Test case ID: [TC-1001](https://example.test/TC-1001)",
  "",
  "Impact scope: checkout API",
  "",
  "Affected business: a missing user id makes checkout return 500",
  "",
  "Call chain: OrderController#create → OrderService#checkout → UserDao#query",
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

const IMPROVEMENT_CONTENT = [
  "Improvement: log the missing user id before returning",
  "",
  "Lines:24-28",
  "",
  "Problem description: checkout swallows a missing user without an audit log.",
  "",
  "Problem tags: [Observability][This change]",
  "",
  "Test case ID: [TC-1001](https://example.test/TC-1001)",
  "",
  "Impact scope: checkout API troubleshooting",
  "",
  "Affected business: on-call cannot tell which id failed",
  "",
  "Reproduction path: call checkout with a missing id and inspect logs",
  "",
  "Improvement plan: log the id at warn level then return a friendly error",
  "",
  "```java",
  "log.warn(\"missing user {}\", id);",
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

function expectOk(proc: ReturnType<typeof spawnSync>, hint = "") {
  assert.equal(proc.status, 0, `${hint}\n${proc.stderr}\n${proc.stdout}`);
  const body = lastJson(proc);
  assert.equal(body.code, 0, `${hint}\n${JSON.stringify(body)}`);
  return body;
}

function isolatedEnv() {
  const tmp = mkdtempSync(join(tmpdir(), "dd-core-"));
  return {
    tmp,
    env: {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(ROOT, "enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    } as NodeJS.ProcessEnv,
  };
}

function isolatedEmptyEnterprise() {
  const tmp = mkdtempSync(join(tmpdir(), "dd-core-empty-"));
  return {
    tmp,
    env: {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(tmp, "empty_enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    } as NodeJS.ProcessEnv,
  };
}

function thinkingFor(method = METHOD) {
  return (
    `Walk the call chain OrderController#create → OrderService#${method} → UserDao#query: ` +
    `${method} line 28 uses a map.get result without a null check. [Confidence:HIGH] ` +
    `A missing id under concurrency can NPE and fail checkout.`
  );
}

function fileCodes() {
  return [
    { filePath: FILE_PATH, methodNames: [METHOD], git: GIT, branch: BRANCH, commitId: COMMIT },
    {
      filePath: "src/main/java/com/example/order/OrderController.java",
      methodNames: ["create"],
      git: GIT,
      branch: BRANCH,
      commitId: COMMIT,
    },
  ];
}

function processSteps(hasBug: boolean, extra: Record<string, any> = {}) {
  return [
    {
      step: "first_round_detection",
      stepKey: "first_round_detection",
      stepStatus: "executed",
      hasBug,
      conclusion: hasBug
        ? "checkout line 28 calls user.getName() without a null check — NPE risk"
        : "checkout parameter checks are sufficient and exception handling is complete",
      question: "Does checkout null-check map.get(id) and handle a missing user?",
      referencedSources: [{ sourceType: "test_case", sourceId: "TC-1001", sourceName: "Reject negative checkout amount" }],
      ...extra,
    },
  ];
}

function writebackItem(batchId: number, bugStatus: number, content: string) {
  return {
    parentBatchId: batchId,
    className: CLASS_NAME,
    methodName: METHOD,
    strategyCode: 11,
    bugStatus,
    detectTier: "T3",
    tagId: bugStatus === 2 ? undefined : 105,
    confidenceScore: 0.9,
    thinking: thinkingFor(),
    content,
    fileCodes: fileCodes(),
    processSteps: processSteps(bugStatus !== 2),
  };
}

function bootstrapGitTask(env: NodeJS.ProcessEnv, tmp: string, opts: { method?: string } = {}) {
  const method = opts.method || METHOD;
  const submitted = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"), "submit-git");
  const taskId = String(submitted.data.taskId);
  const batchId = String(submitted.data.batchIds[0]);
  assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "Core branches", "--git-url", GIT, "--branch", BRANCH).status, 0);
  assert.equal(
    run(env, "add-service-to-content", "--task-id", taskId, "--git-url", GIT, "--branch", BRANCH, "--batch-ids", batchId, "--language", "java").status,
    0,
  );

  const localDir = join(tmpdir(), "defect-detection", `core-${submitted.data.taskId}`);
  mkdirSync(join(localDir, "src/main/java/com/example/order"), { recursive: true });
  writeFileSync(
    join(localDir, FILE_PATH),
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
    run(env, "register-repo-clone", "--task-id", taskId, "--batch-id", batchId, "--git-url", GIT, "--local-dir", localDir, "--branch", BRANCH, "--commit-id", COMMIT).status,
    0,
  );
  assert.equal(
    run(env, "register-code-read", "--task-id", taskId, "--batch-id", batchId, "--class-name", CLASS_NAME, "--file-path", FILE_PATH, "--code-snippet", "public String checkout(String id) { return user.getName(); }").status,
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
        methodName: method,
        strategyCode: 11,
        batchId: Number(batchId),
        filePath: FILE_PATH,
        status: "pending",
      }),
    ).status,
    0,
  );
  return { taskId, batchId, localDir, numericTaskId: submitted.data.taskId as number, numericBatchId: submitted.data.batchIds[0] as number };
}

function processIdFrom(written: any): string {
  const first = written.results?.[0] || written.data?.results?.[0] || {};
  return String(first.data?.processId || first.processId || written.data?.processIds?.[0] || "");
}

function platformDir(dataDir: string) {
  return join(dataDir, "platform");
}

function seedPendingProcess(dataDir: string, taskId: number, batchId: number, methodName = "pendingMethod") {
  const dir = join(platformDir(dataDir), "processes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "9001.json"),
    JSON.stringify({
      processId: 9001,
      taskId,
      parentBatchId: batchId,
      className: CLASS_NAME,
      methodName,
      strategyCode: 11,
      bugStatus: 0,
    }, null, 2),
  );
}

function git(cwd: string, ...args: string[]) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(proc.status, 0, `git ${args.join(" ")}\n${proc.stderr}`);
  return proc;
}

function makeLocalGitRepo(tmp: string, extraLines = 0) {
  const repo = join(tmp, "src-repo");
  mkdirSync(join(repo, "src/main/java/com/example/order"), { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "core@example.test");
  git(repo, "config", "user.name", "core-branch");
  writeFileSync(
    join(repo, FILE_PATH),
    ["package com.example.order;", "public class OrderService {", "    public String getName() {", "        return name;", "    }", "}", ""].join("\n"),
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const branch = `feature/core-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  git(repo, "checkout", "-b", branch);
  writeFileSync(
    join(repo, FILE_PATH),
    [
      "package com.example.order;",
      "public class OrderService {",
      "    public String checkout(String id) {",
      ...Array.from({ length: extraLines }, () => "        // padding"),
      "        User user = map.get(id);",
      "        if (id == null) {",
      "            return null;",
      "        }",
      "        return user.getName();",
      "    }",
      "    public String getName() {",
      "        return name;",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "add checkout");
  return { repo, gitUrl: `file://${repo}`, branch };
}

describe("core trigger and lifecycle branches", () => {
  it("B1 submit-skill-direct creates SKILL_DIRECT task", () => {
    const { env } = isolatedEnv();
    const body = expectOk(
      run(env, "submit-skill-direct", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"),
      "submit-skill-direct",
    );
    assert.ok(body.data.taskId > 0);
    assert.equal(body.data.batchIds.length, 1);
    const status = expectOk(run(env, "status", "--task-id", String(body.data.taskId)));
    assert.equal(status.data.status, "in_progress");
  });

  it("B2 multi-service submit-skill-direct yields two batches", () => {
    const { env } = isolatedEnv();
    const body = expectOk(
      run(
        env,
        "submit-skill-direct",
        "--services-json",
        JSON.stringify([
          { git: GIT, developBranch: BRANCH, serviceKey: "order" },
          { git: "git@github.com:acme/pay-service.git", developBranch: "feature/pay", serviceKey: "pay" },
        ]),
        "--submit-user",
        "alice",
      ),
      "multi-service",
    );
    assert.equal(body.data.batchIds.length, 2);
    assert.notEqual(body.data.batchIds[0], body.data.batchIds[1]);
  });

  it("B3 delivery planType 4 submit-plan records planType=4", () => {
    const { env } = isolatedEmptyEnterprise();
    const body = expectOk(
      run(
        env,
        "submit-plan",
        "--plan-id",
        "4001",
        "--plan-type",
        "4",
        "--submit-user",
        "alice",
        "--plan-name",
        "Delivery checkout",
        "--services-json",
        JSON.stringify([{ git: GIT, branch: BRANCH, serviceKey: "order", language: "java" }]),
      ),
      "submit-plan type 4",
    );
    const status = expectOk(run(env, "status", "--task-id", String(body.data.taskId)));
    assert.equal(status.data.status, "in_progress");
    assert.equal(status.data.planType, 4);
    assert.equal(status.data.detectType, "TEST_PLAN");
  });

  it("B4 check-materials blocks without git and starts with git", () => {
    const { env } = isolatedEmptyEnterprise();
    const missing = expectOk(run(env, "check-materials", "--plan-id", "99999", "--plan-type", "2"), "materials missing");
    assert.equal(missing.data.canStart, false);
    assert.ok(missing.data.blocking.length >= 1);

    const ready = expectOk(
      run(env, "check-materials", "--plan-id", "99999", "--plan-type", "2", "--git", GIT, "--branch", BRANCH),
      "materials with git",
    );
    assert.equal(ready.data.canStart, true);
    assert.deepEqual(ready.data.blocking, []);
  });

  it("B5-B6 force-abort then retry creates a new in_progress task", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    const aborted = expectOk(run(env, "force-abort-task", "--task-id", taskId, "--reason", "user cancelled"), "force-abort");
    assert.equal(aborted.data.status, "aborted");
    assert.equal(expectOk(run(env, "status", "--task-id", taskId)).data.status, "aborted");

    const retried = expectOk(run(env, "retry", "--task-id", taskId, "--submit-user", "alice"), "retry");
    assert.ok(retried.data.taskId > 0);
    assert.notEqual(retried.data.taskId, created.data.taskId);
    assert.equal(expectOk(run(env, "status", "--task-id", String(retried.data.taskId))).data.status, "in_progress");
    assert.equal(expectOk(run(env, "status", "--task-id", taskId)).data.status, "aborted");
  });

  it("B7 complete-task --failed --force marks the task failed", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const done = expectOk(
      run(env, "complete-task", "--task-id", String(created.data.taskId), "--failed", "--fail-msg", "clone failed", "--force"),
      "complete failed",
    );
    assert.equal(done.data.status, "failed");
    assert.equal(expectOk(run(env, "status", "--task-id", String(created.data.taskId))).data.status, "failed");
  });

  it("B8 list-my-tasks and get-detection-records include the submitted task", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const listed = expectOk(run(env, "list-my-tasks", "--submit-user", "alice", "--limit", "20"));
    const tasks = listed.data.tasks || listed.data || [];
    const ids = (Array.isArray(tasks) ? tasks : []).map((t: any) => t.taskId);
    assert.ok(ids.includes(created.data.taskId));

    const records = expectOk(run(env, "get-detection-records", "--git", GIT, "--develop-branch", BRANCH));
    const recs = records.data || [];
    assert.ok(Array.isArray(recs));
    assert.ok(recs.some((t: any) => t.taskId === created.data.taskId));
  });
});

describe("core phase-1/2 analysis branches", () => {
  it("B9-B10 clone-and-diff + changed methods: light vs strict plan", { timeout: 60_000 }, () => {
    const { tmp, env } = isolatedEnv();
    const { repo, gitUrl, branch } = makeLocalGitRepo(tmp, 0);
    const created = expectOk(run(env, "submit-git", "--git", gitUrl, "--branch", branch, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    const batchId = String(created.data.batchIds[0]);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "Local clone", "--git-url", gitUrl, "--branch", branch).status, 0);
    assert.equal(
      run(env, "add-service-to-content", "--task-id", taskId, "--git-url", gitUrl, "--branch", branch, "--batch-ids", batchId, "--language", "java").status,
      0,
    );

    const cloned = expectOk(
      run(
        env,
        "clone-and-diff",
        "--task-id",
        taskId,
        "--batch-id",
        batchId,
        "--git-url",
        gitUrl,
        "--branch",
        branch,
        "--base-branch",
        "main",
        "--language",
        "javascript",
      ),
      "clone-and-diff",
    );
    assert.equal(cloned.data.remappedFrom, undefined);
    assert.ok(cloned.data.localDir);
    assert.ok((cloned.data.diffFiles || []).some((f: string) => f.endsWith("OrderService.java")));
    assert.ok(cloned.data.diffFileCount >= 1);

    const methods = expectOk(
      run(env, "get-changed-methods", "--task-id", taskId, "--local-dir", cloned.data.localDir),
      "get-changed-methods",
    );
    assert.ok(methods.data.changedMethodCount >= 1);
    assert.ok((methods.data.changedMethods || []).some((m: any) => m.methodName === "checkout" && typeof m.bodyLineCount === "number"));
    assert.ok(methods.data.totalChangeLines > 0);
    assert.ok(methods.data.totalChangeLines < 200);

    const light = expectOk(run(env, "build-detection-plan", "--task-id", taskId, "--batch-ids", batchId), "light plan");
    assert.equal(light.data.mode, "light");
    assert.ok(light.data.detectionPlanTotal >= 1);
    assert.ok(light.data.detectionPlan.some((i: any) => i.methodName === "checkout" && typeof i.bodyLineCount === "number"));
    assert.match(String(light.data.mode), /light/);

    const metaPath = join(env.CONTENT_JSON_BASE!, taskId, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.diff.totalChangeLines = 250;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    const strict = expectOk(run(env, "build-detection-plan", "--task-id", taskId, "--batch-ids", batchId), "strict plan");
    assert.equal(strict.data.mode, "strict");
    assert.equal(strict.data.totalChangeLines, 250);

    const mapped = expectOk(
      run(
        env,
        "verify-line-method-mapping",
        "--task-id",
        taskId,
        "--class-name",
        CLASS_NAME,
        "--method-name",
        "checkout",
        "--content",
        "Defect: NPE\n\nLines:3-8\n",
        "--local-dir",
        cloned.data.localDir,
      ),
      "verify-line-method-mapping",
    );
    assert.equal(mapped.data.verified, true);

    rmSync(cloned.data.localDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("B11 check-phase2-readiness blocks before clone and passes after fetch+clone", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    const batchId = String(created.data.batchIds[0]);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "Ready", "--git-url", GIT, "--branch", BRANCH).status, 0);
    assert.equal(
      run(env, "add-service-to-content", "--task-id", taskId, "--git-url", GIT, "--branch", BRANCH, "--batch-ids", batchId, "--language", "java").status,
      0,
    );

    const notReady = run(env, "check-phase2-readiness", "--task-id", taskId);
    const blocked = lastJson(notReady);
    assert.equal(blocked.code, 1, notReady.stderr + notReady.stdout);
    assert.equal(blocked.data.ready, false);
    assert.ok((blocked.data.blocking || []).length >= 1);

    const localDir = join(tmpdir(), "defect-detection", `ready-${created.data.taskId}`);
    mkdirSync(localDir, { recursive: true });
    assert.equal(
      run(env, "register-repo-clone", "--task-id", taskId, "--batch-id", batchId, "--git-url", GIT, "--local-dir", localDir, "--branch", BRANCH, "--commit-id", COMMIT).status,
      0,
    );
    assert.equal(run(env, "set-diff-files", "--task-id", taskId, "--files-json", JSON.stringify([FILE_PATH])).status, 0);
    expectOk(run(env, "phase1-fetch-all", "--task-id", taskId, "--git-url", GIT, "--user-id", "alice"), "phase1-fetch-all");

    const ready = expectOk(run(env, "check-phase2-readiness", "--task-id", taskId), "phase2 ready");
    assert.equal(ready.data.ready, true);
    rmSync(localDir, { recursive: true, force: true });
  });

  it("B12 add-document / add-test-case / extract-rules / req-coverage / cross-view", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const skipped = expectOk(run(env, "check-req-coverage", "--task-id", boot.taskId), "req-coverage skip");
    assert.equal(skipped.data.skipped, true);

    assert.equal(
      run(
        env,
        "add-document",
        "--task-id",
        boot.taskId,
        "--doc-type",
        "prdDocs",
        "--doc-json",
        JSON.stringify({
          title: "checkout rules",
          businessRules: "checkout must reject a missing user; amount must be greater than zero",
          content: "OrderService.checkout validates the user id",
        }),
      ).status,
      0,
    );
    assert.equal(
      run(
        env,
        "add-test-case",
        "--task-id",
        boot.taskId,
        "--case-json",
        JSON.stringify({
          id: "TC-1001",
          title: "checkout rejects missing user",
          steps: "call OrderService.checkout with a missing id",
          expectedResult: "return a friendly error instead of NPE",
          preCondition: "user map is empty",
          fetchStatus: "success",
          relatedMethods: [`${CLASS_NAME}#${METHOD}`],
        }),
      ).status,
      0,
    );

    const docSummary = join(tmp, "DOC_SUMMARY.md");
    writeFileSync(
      docSummary,
      [
        "| Rule | Text | Source |",
        "| --- | --- | --- |",
        "| R1 | checkout must reject a missing user | DOC_SUMMARY |",
        "| R2 | amount must be greater than zero | DOC_SUMMARY |",
        "",
      ].join("\n"),
    );
    assert.equal(run(env, "set-doc-summary", "--task-id", boot.taskId, "--path", docSummary).status, 0);
    const extracted = expectOk(
      run(env, "extract-rules-from-docs", "--task-id", boot.taskId, "--doc-summary-path", docSummary),
      "extract-rules",
    );
    assert.ok(extracted.data.extractedRulesCount >= 2);
    assert.ok(extracted.data.extractedRules.some((r: any) => /checkout/i.test(r.text)));

    const coverage = expectOk(run(env, "check-req-coverage", "--task-id", boot.taskId), "req-coverage");
    assert.equal(coverage.data.skipped, undefined);
    assert.ok((coverage.data.coveredCount || 0) + (coverage.data.uncoveredCount || 0) >= 2);
    assert.equal(coverage.data.totalRules, coverage.data.coveredCount + coverage.data.uncoveredCount);

    const cross = expectOk(run(env, "cross-view-check", "--task-id", boot.taskId), "cross-view");
    assert.ok((cross.data.directionsExecuted || []).includes("case_to_code"));
    assert.ok((cross.data.directionsExecuted || []).includes("doc_to_code"));
    assert.equal(cross.data.role, "first_pass");
    assert.equal(cross.data.blocking, false);
    assert.equal(cross.data.gate_passed, true);

    expectOk(
      run(
        env,
        "register-finding",
        "--task-id",
        boot.taskId,
        "--phase",
        "analysis",
        "--category",
        "cross-view",
        "--source",
        "cross-view-doc_to_code",
        "--text",
        "checkout rule is implemented in OrderService.checkout",
      ),
    );
    const findings = expectOk(run(env, "get-findings", "--task-id", boot.taskId, "--category", "cross-view"));
    assert.ok(findings.data.count >= 1);
    assert.ok(findings.data.findings.some((f: any) => f.category === "cross-view"));
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B13 trivial-method-filter marks getter/setter trivial and checkout deep", () => {
    const { env } = isolatedEnv();
    const body = expectOk(
      run(
        env,
        "trivial-method-filter",
        "--methods",
        JSON.stringify([
          { className: CLASS_NAME, methodName: "getName", params: "", bodyLineCount: 1 },
          { className: CLASS_NAME, methodName: "setName", params: "String", bodyLineCount: 1 },
          { className: CLASS_NAME, methodName: "isEmpty", params: "", bodyLineCount: 2 },
          { className: CLASS_NAME, methodName: "checkout", params: "String id", bodyLineCount: 12 },
        ]),
      ),
    );
    assert.equal(body.data.totalCount, 4);
    assert.equal(body.data.trivialCount, 3);
    assert.equal(body.data.deepAnalysisCount, 1);
    const byName = Object.fromEntries(body.data.results.map((r: any) => [r.methodName, r]));
    assert.equal(byName.getName.trivial, true);
    assert.equal(byName.getName.trivialReason, "GETTER");
    assert.equal(byName.setName.trivialReason, "SETTER");
    assert.equal(byName.isEmpty.trivialReason, "GETTER");
    assert.equal(byName.checkout.trivial, false);
    assert.equal(byName.checkout.suggestedTier, "T2");
  });

  it("B13b trivial-method-filter --task-id uses stored bodyLineCount instead of a fake default", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "Filter", "--git-url", GIT, "--branch", BRANCH).status, 0);
    expectOk(
      run(
        env,
        "set-changed-methods",
        "--task-id",
        taskId,
        "--class-name",
        CLASS_NAME,
        "--methods-json",
        JSON.stringify([
          { methodName: "getName", params: "", bodyLineCount: 1 },
          { methodName: "setName", params: "String name", bodyLineCount: 1 },
          { methodName: "checkout", params: "String id", bodyLineCount: 12 },
        ]),
      ),
    );
    for (const methodName of ["getName", "setName", "checkout"]) {
      expectOk(
        run(
          env,
          "add-detection-plan-item",
          "--task-id",
          taskId,
          "--item-json",
          JSON.stringify({
            className: CLASS_NAME,
            methodName,
            strategyCode: 11,
            status: "pending",
          }),
        ),
      );
    }

    const guessed = expectOk(
      run(
        env,
        "trivial-method-filter",
        "--methods",
        JSON.stringify([
          { className: CLASS_NAME, methodName: "getName", bodyLineCount: 5 },
          { className: CLASS_NAME, methodName: "setName", bodyLineCount: 5 },
          { className: CLASS_NAME, methodName: "checkout", bodyLineCount: 5 },
        ]),
      ),
    );
    const guessedByName = Object.fromEntries(guessed.data.results.map((r: any) => [r.methodName, r]));
    assert.equal(guessedByName.getName.trivial, false, "a fake bodyLineCount=5 must not mark a getter trivial");

    const filled = expectOk(run(env, "trivial-method-filter", "--task-id", taskId));
    assert.equal(filled.data.source, "detection-plan");
    assert.ok(filled.data.backfilledBodyLineCount >= 2);
    assert.equal(filled.data.trivialCount, 2);
    assert.equal(filled.data.deepAnalysisCount, 1);
    const byName = Object.fromEntries(filled.data.results.map((r: any) => [r.methodName, r]));
    assert.equal(byName.getName.trivial, true);
    assert.equal(byName.getName.trivialReason, "GETTER");
    assert.equal(byName.setName.trivialReason, "SETTER");
    assert.equal(byName.checkout.trivial, false);
  });

  it("B13b2 build-detection-plan stamps getters as trivial immediately", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "Stamp", "--git-url", GIT, "--branch", BRANCH).status, 0);
    expectOk(
      run(
        env,
        "set-changed-methods",
        "--task-id",
        taskId,
        "--class-name",
        CLASS_NAME,
        "--methods-json",
        JSON.stringify([
          { methodName: "getName", params: "", bodyLineCount: 1 },
          { methodName: "checkout", params: "String id", bodyLineCount: 12 },
        ]),
      ),
    );
    const plan = expectOk(run(env, "build-detection-plan", "--task-id", taskId));
    assert.ok(plan.data.trivialCount >= 1);
    const byName = Object.fromEntries(plan.data.detectionPlan.map((i: any) => [i.methodName, i]));
    assert.equal(byName.getName.trivial, true);
    assert.equal(byName.getName.trivialReason, "GETTER");
    assert.equal(byName.getName.detectTier, "T3");
    assert.equal(byName.checkout.trivial, false);
    assert.ok((plan.data.deepAnalysis || []).some((i: any) => i.methodName === "checkout"));
    assert.ok(!(plan.data.deepAnalysis || []).some((i: any) => i.methodName === "getName"));
  });

  it("B13c trivial-method-filter --submit writes getters as bugStatus=2", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp, { method: "getName" });
    seedPendingProcess(env.DETECTION_DATA_DIR!, boot.numericTaskId, boot.numericBatchId, "getName");
    expectOk(
      run(
        env,
        "set-changed-methods",
        "--task-id",
        boot.taskId,
        "--class-name",
        CLASS_NAME,
        "--methods-json",
        JSON.stringify([{ methodName: "getName", params: "", bodyLineCount: 1 }]),
      ),
    );
    expectOk(
      run(
        env,
        "add-detection-plan-item",
        "--task-id",
        boot.taskId,
        "--item-json",
        JSON.stringify({
          className: CLASS_NAME,
          methodName: "getName",
          strategyCode: 11,
          parentBatchId: boot.numericBatchId,
          processId: 9001,
          status: "pending",
          bodyLineCount: 1,
          params: "",
        }),
      ),
    );
    const submitted = expectOk(
      run(env, "trivial-method-filter", "--task-id", boot.taskId, "--submit"),
      "trivial submit",
    );
    assert.equal(submitted.data.trivialCount, 1);
    assert.equal(submitted.data.submit.submitted, true, JSON.stringify(submitted.data.submit));
    assert.ok(submitted.data.submit.success >= 1, JSON.stringify(submitted.data.submit));
    const coverage = expectOk(run(env, "check-coverage", "--batch-id", boot.batchId));
    assert.equal(coverage.data.allCompleted, true);
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B13d prep-and-plan extracts methods, marks getters trivial, and skips deep list", { timeout: 60_000 }, () => {
    const { tmp, env } = isolatedEnv();
    const { repo, gitUrl, branch } = makeLocalGitRepo(tmp, 0);
    const created = expectOk(run(env, "submit-git", "--git", gitUrl, "--branch", branch, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    const batchId = String(created.data.batchIds[0]);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "Prep", "--git-url", gitUrl, "--branch", branch).status, 0);
    assert.equal(
      run(env, "add-service-to-content", "--task-id", taskId, "--git-url", gitUrl, "--branch", branch, "--batch-ids", batchId, "--language", "java").status,
      0,
    );
    const cloned = expectOk(
      run(
        env,
        "clone-and-diff",
        "--task-id",
        taskId,
        "--batch-id",
        batchId,
        "--git-url",
        gitUrl,
        "--branch",
        branch,
        "--base-branch",
        "main",
        "--language",
        "javascript",
      ),
      "clone-and-diff",
    );
    const planned = expectOk(
      run(env, "prep-and-plan", "--task-id", taskId, "--local-dir", cloned.data.localDir),
      "prep-and-plan",
    );
    assert.ok(planned.data.changedMethodCount >= 1);
    assert.ok(planned.data.detectionPlanTotal >= 1);
    assert.ok((planned.data.deepAnalysis || []).some((i: any) => i.methodName === "checkout"));
    assert.equal(planned.data.persisted, true);
    const quality = expectOk(run(env, "check-analysis-quality", "--task-id", taskId));
    assert.equal(quality.data.passed, true);
    rmSync(cloned.data.localDir, { recursive: true, force: true });
  });

  it("B13e check-analysis-quality skips T3 and blocks T1 without context reads", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "t3.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 2, "No defect in this code")]));
    expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile), "t3 writeback");
    const t3 = expectOk(run(env, "check-analysis-quality", "--task-id", boot.taskId));
    assert.equal(t3.data.passed, true);

    expectOk(
      run(
        env,
        "add-detection-plan-item",
        "--task-id",
        boot.taskId,
        "--item-json",
        JSON.stringify({
          className: CLASS_NAME,
          methodName: METHOD,
          strategyCode: 11,
          detectTier: "T1",
          status: "pending",
        }),
      ),
    );
    const t1 = run(env, "check-analysis-quality", "--task-id", boot.taskId);
    const t1Body = lastJson(t1);
    assert.equal(t1Body.data.passed, false);
    assert.ok((t1Body.data.issues || []).some((i: any) => /detectTier=T1/.test(i.issue || i.expected || "")));
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B14 get-pending is empty then lists a seeded unfinished process", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const empty = expectOk(run(env, "get-pending", "--batch-id", String(created.data.batchIds[0])));
    const emptyItems = empty.data || [];
    assert.ok(Array.isArray(emptyItems));
    assert.equal(emptyItems.length, 0);

    seedPendingProcess(env.DETECTION_DATA_DIR!, created.data.taskId, created.data.batchIds[0]);
    const pending = expectOk(run(env, "get-pending", "--batch-id", String(created.data.batchIds[0])));
    const items = pending.data || [];
    assert.ok(items.some((p: any) => p.methodName === "pendingMethod" && (p.bugStatus === 0 || p.bugStatus == null)));
  });
});

describe("core write-back and close-gate branches", () => {
  it("B15 no-defect write-back completes with empty defect list", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "nobug.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 2, "No defect in this code")]));
    const written = expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile), "no-defect writeback");
    assert.ok(written.summary?.success >= 1 || processIdFrom(written));

    const coverage = expectOk(run(env, "check-coverage", "--batch-id", boot.batchId));
    assert.equal(coverage.data.allCompleted, true);
    const integrity = expectOk(run(env, "check-rank-integrity", "--batch-id", boot.batchId));
    assert.equal(integrity.data.allConsistent, true);
    assert.deepEqual(integrity.data.missingRankItems, []);

    const done = expectOk(
      run(env, "complete-task", "--task-id", boot.taskId, "--batch-ids", boot.batchId, "--summary", NO_DEFECT_SUMMARY),
      "complete no-defect",
    );
    assert.equal(done.data.status, "completed");
    assert.equal(done._summary_status, "OK");
    const report = expectOk(run(env, "get-report", "--task-id", boot.taskId));
    assert.equal((report.data.defects || []).length, 0);
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B16 improvement + inline finalize-rank + update-rank-content + mark-bug 5", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "improve.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 7, IMPROVEMENT_CONTENT)]));
    const written = expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile));
    const processId = processIdFrom(written);

    const ranked = expectOk(
      run(
        env,
        "finalize-rank",
        "--task-id",
        boot.taskId,
        "--batch-id",
        boot.batchId,
        "--class-name",
        CLASS_NAME,
        "--method-name",
        METHOD,
        "--bug-status",
        "7",
        "--content",
        IMPROVEMENT_CONTENT,
        ...(processId ? ["--process-ids", processId] : []),
      ),
      "finalize-rank --content",
    );
    assert.ok(ranked.data.rankId > 0);

    const updated = expectOk(
      run(env, "update-rank-content", "--rank-id", String(ranked.data.rankId), "--content", IMPROVEMENT_CONTENT + "\n\nUpdated after review."),
      "update-rank-content",
    );
    assert.equal(updated.code, 0);

    const marked = expectOk(
      run(env, "mark-bug", "--rank-id", String(ranked.data.rankId), "--bug-status", "5", "--task-id", boot.taskId),
      "mark-bug 5",
    );
    assert.equal(marked.data.bugStatus, 5);
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B17 incomplete coverage blocks complete-task", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    seedPendingProcess(env.DETECTION_DATA_DIR!, created.data.taskId, created.data.batchIds[0]);

    const coverage = expectOk(run(env, "check-coverage", "--batch-id", String(created.data.batchIds[0])));
    assert.equal(coverage.data.allCompleted, false);
    assert.ok(coverage.data.missedItems.length >= 1);
    assert.equal(coverage.data.missedItems[0].methodName, "pendingMethod");

    const blocked = run(
      env,
      "complete-task",
      "--task-id",
      String(created.data.taskId),
      "--batch-ids",
      String(created.data.batchIds[0]),
      "--summary",
      ENGLISH_SUMMARY,
    );
    assert.equal(blocked.status, 1);
    const body = lastJson(blocked);
    assert.equal(body.code, 1);
    assert.equal(body.data.blocked, true);
    assert.ok((body.data.blockers || []).some((b: string) => /not fully written back/i.test(b)));
  });

  it("B18 missing rank blocks complete-task", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "defect.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 6, RANK_CONTENT)]));
    expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile));

    const integrity = expectOk(run(env, "check-rank-integrity", "--batch-id", boot.batchId));
    assert.equal(integrity.data.allConsistent, false);
    assert.ok(integrity.data.missingRankItems.some((i: any) => i.methodName === METHOD));

    const blocked = run(env, "complete-task", "--task-id", boot.taskId, "--batch-ids", boot.batchId, "--summary", ENGLISH_SUMMARY);
    assert.equal(blocked.status, 1);
    const body = lastJson(blocked);
    assert.equal(body.data.blocked, true);
    assert.ok((body.data.blockers || []).some((b: string) => /not written to the report/i.test(b)));
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B19 complete-task without --batch-ids exits 2; preview validates summary", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const missingIds = run(env, "complete-task", "--task-id", String(created.data.taskId), "--summary", ENGLISH_SUMMARY);
    assert.equal(missingIds.status, 2);
    assert.match(missingIds.stderr, /--batch-ids was not passed/);

    const badPreview = run(
      env,
      "complete-task",
      "--task-id",
      String(created.data.taskId),
      "--preview",
      "--summary",
      "no sections here",
    );
    const bad = lastJson(badPreview);
    assert.equal(bad.code, 1, badPreview.stderr + badPreview.stdout);
    assert.ok(bad.data.issues.some((i: string) => /Missing section markers/i.test(i)));
    assert.ok(bad.data.issues.some((i: string) => /Conclusion/i.test(i)));

    const goodPreview = expectOk(
      run(env, "complete-task", "--task-id", String(created.data.taskId), "--preview", "--summary", ENGLISH_SUMMARY),
    );
    assert.deepEqual(goodPreview.data.sections, ["Requirement changes", "Analysis scope", "Risks", "Notes", "Conclusion"]);
  });

  it("B20 validate-summary rejects missing Conclusion and accepts a full summary", () => {
    const { env } = isolatedEnv();
    const bad = run(env, "validate-summary", "--summary", "📋[Requirement changes] x    🔍[Analysis scope] y    ⚠️[Risks] z    📌[Notes] n");
    assert.equal(bad.status, 1);
    const body = lastJson(bad);
    assert.deepEqual(body.data.missingSections, ["Conclusion"]);

    const good = expectOk(run(env, "validate-summary", "--summary", ENGLISH_SUMMARY));
    assert.ok(good.data.sections.includes("Conclusion"));
  });

  it("B21 batch-no-bug --submit writes bugStatus=2", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "bnb.json");
    writeFileSync(
      itemsFile,
      JSON.stringify([
        {
          className: CLASS_NAME,
          methods: [{ methodName: METHOD, detectTier: "T3", processes: [{ strategyCode: 11, parentBatchId: boot.numericBatchId, detectTier: "T3" }] }],
        },
      ]),
    );
    const submitted = expectOk(
      run(
        env,
        "batch-no-bug",
        "--task-id",
        boot.taskId,
        "--batch-id",
        boot.batchId,
        "--items-json",
        itemsFile,
        "--strategy",
        "11",
        "--git",
        GIT,
        "--branch",
        BRANCH,
        "--commit",
        COMMIT,
        "--ref-source-id",
        "TC-1001",
        "--ref-source-name",
        "Reject negative checkout amount",
        "--skip-code-read-check",
        "--submit",
      ),
      "batch-no-bug",
    );
    assert.equal(submitted.data.submitted, true);
    assert.ok(submitted.data.success >= 1);
    const coverage = expectOk(run(env, "check-coverage", "--batch-id", boot.batchId));
    assert.equal(coverage.data.allCompleted, true);
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B22 dismiss-class and batch-dismiss-by-strategy branches", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    seedPendingProcess(env.DETECTION_DATA_DIR!, boot.numericTaskId, boot.numericBatchId, "getName");

    const dismissed = expectOk(
      run(
        env,
        "dismiss-class",
        "--task-id",
        boot.taskId,
        "--batch-id",
        boot.batchId,
        "--git-url",
        GIT,
        "--class-names",
        CLASS_NAME,
        "--class-type",
        "dto_vo",
      ),
      "dismiss-class",
    );
    assert.equal(dismissed.data.classType, "dto_vo");
    assert.ok(dismissed.data.affected >= 1);

    const wrongStrategy = run(
      env,
      "batch-dismiss-by-strategy",
      "--parent-batch-id",
      boot.batchId,
      "--strategy-code",
      "11",
      "--ast-findings-count",
      "0",
    );
    assert.notEqual(wrongStrategy.status, 0);
    assert.match(wrongStrategy.stderr + wrongStrategy.stdout, /only for the AST strategy/);

    const needsVerify = run(
      env,
      "batch-dismiss-by-strategy",
      "--parent-batch-id",
      boot.batchId,
      "--strategy-code",
      "8",
      "--ast-findings-count",
      "3",
    );
    assert.notEqual(needsVerify.status, 0);
    assert.match(needsVerify.stderr + needsVerify.stdout, /verified-count/);

    const astDismiss = expectOk(
      run(env, "batch-dismiss-by-strategy", "--parent-batch-id", boot.batchId, "--strategy-code", "8", "--ast-findings-count", "0"),
      "batch-dismiss ast 0",
    );
    assert.equal(astDismiss.data.strategyCode, 8);
    assert.ok(astDismiss.data.affected >= 0);
    rmSync(boot.localDir, { recursive: true, force: true });
  });
});

describe("core feedback and reuse branches", () => {
  it("B23 mark-bug 4 writes USER_REJECTED history; mark-bug 8 is accepted", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "defect.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 6, RANK_CONTENT)]));
    const written = expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile));
    const processId = processIdFrom(written);
    const ranked = expectOk(
      run(
        env,
        "finalize-rank",
        "--task-id",
        boot.taskId,
        "--batch-id",
        boot.batchId,
        "--class-name",
        CLASS_NAME,
        "--method-name",
        METHOD,
        "--bug-status",
        "6",
        "--content",
        RANK_CONTENT,
        ...(processId ? ["--process-ids", processId] : []),
      ),
    );

    const rejected = expectOk(
      run(env, "mark-bug", "--rank-id", String(ranked.data.rankId), "--bug-status", "4", "--task-id", boot.taskId, "--extra", "false positive"),
      "mark-bug 4",
    );
    assert.equal(rejected.data.bugStatus, 4);
    const history = JSON.parse(readFileSync(join(platformDir(env.DETECTION_DATA_DIR!), "history.json"), "utf8"));
    const rows = Array.isArray(history) ? history : history.data || [];
    assert.ok(rows.some((h: any) => h.bugStatus === 4 && h.feedbackConclusion === "USER_REJECTED"));

    const ranked2 = expectOk(
      run(
        env,
        "finalize-rank",
        "--task-id",
        boot.taskId,
        "--batch-id",
        boot.batchId,
        "--class-name",
        CLASS_NAME,
        "--method-name",
        METHOD,
        "--bug-status",
        "6",
        "--content",
        RANK_CONTENT,
      ),
    );
    const dup = expectOk(run(env, "mark-bug", "--rank-id", String(ranked2.data.rankId), "--bug-status", "8", "--task-id", boot.taskId));
    assert.equal(dup.data.bugStatus, 8);
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B24 create-issue returns issueId; skip-service-batch --failed marks failed", () => {
    const { env } = isolatedEmptyEnterprise();
    const created = expectOk(run(env, "submit-git", "--git", GIT, "--branch", BRANCH, "--submit-user", "alice"));
    const issue = expectOk(
      run(env, "create-issue", "--plan-id", "1001", "--title", "checkout NPE", "--description", "missing user id"),
      "create-issue",
    );
    assert.ok(issue.data.issueId > 0);
    assert.match(String(issue.data.defectUrl), /local:\/\/issues\//);

    const skipped = expectOk(
      run(env, "skip-service-batch", "--parent-batch-id", String(created.data.batchIds[0]), "--failed", "--reason", "repo unreachable"),
    );
    assert.equal(skipped.data.status, "failed");
    const status = expectOk(run(env, "status", "--task-id", String(created.data.taskId)));
    assert.equal(status.data.status, "failed");
  });

  it("B25 retry after complete reuses the completed task as a new in_progress run", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "nobug.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 2, "No defect in this code")]));
    expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile));
    const done = expectOk(run(env, "complete-task", "--task-id", boot.taskId, "--batch-ids", boot.batchId, "--summary", NO_DEFECT_SUMMARY));
    assert.equal(done.data.status, "completed");

    const retried = expectOk(run(env, "retry", "--task-id", boot.taskId, "--submit-user", "alice"));
    assert.notEqual(retried.data.taskId, boot.numericTaskId);
    assert.equal(expectOk(run(env, "status", "--task-id", String(retried.data.taskId))).data.status, "in_progress");
    assert.equal(expectOk(run(env, "status", "--task-id", boot.taskId)).data.status, "completed");
    rmSync(boot.localDir, { recursive: true, force: true });
  });

  it("B26 update-rank-content still works after complete-task", () => {
    const { tmp, env } = isolatedEnv();
    const boot = bootstrapGitTask(env, tmp);
    const itemsFile = join(tmp, "defect.json");
    writeFileSync(itemsFile, JSON.stringify([writebackItem(boot.numericBatchId, 6, RANK_CONTENT)]));
    const written = expectOk(run(env, "batch-update-process", "--task-id", boot.taskId, "--items-json", itemsFile));
    const processId = processIdFrom(written);
    const ranked = expectOk(
      run(
        env,
        "finalize-rank",
        "--task-id",
        boot.taskId,
        "--batch-id",
        boot.batchId,
        "--class-name",
        CLASS_NAME,
        "--method-name",
        METHOD,
        "--bug-status",
        "6",
        "--content",
        RANK_CONTENT,
        ...(processId ? ["--process-ids", processId] : []),
      ),
    );
    expectOk(run(env, "complete-task", "--task-id", boot.taskId, "--batch-ids", boot.batchId, "--summary", ENGLISH_SUMMARY));
    const updated = expectOk(
      run(env, "update-rank-content", "--rank-id", String(ranked.data.rankId), "--content", RANK_CONTENT + "\n\nPost-complete clarification."),
    );
    assert.equal(updated.code, 0);
    rmSync(boot.localDir, { recursive: true, force: true });
  });
});
