/**
 * Regressions found while running the skill end to end against real repositories:
 * - add-test-case appended duplicates instead of upserting by id
 * - local platform had no pending processes for a diff-built plan (get-pending empty,
 *   check-coverage vacuously true)
 * - summary normalisation stripped underscores out of identifiers
 * - a bare "batch" forbidden rule flagged "batchSize" / "batching"
 * - extract-rules-from-docs turned every hard-wrapped line into its own rule
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { check_summary_forbidden, normalize_summary_for_plaintext } from "../scripts/platform.ts";
import { _rule_paragraphs_from_doc } from "../scripts/cli_auto.ts";
import { load_settings } from "../scripts/providers/config.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "detect.ts");
const FILE_PATH = "src/main/java/com/example/order/OrderService.java";

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
}

function expectOk(proc: ReturnType<typeof spawnSync>, hint = "") {
  assert.equal(proc.status, 0, `${hint}\n${proc.stderr}\n${proc.stdout}`);
  const body = JSON.parse((proc.stdout || "").trim());
  assert.equal(body.code, 0, `${hint}\n${JSON.stringify(body)}`);
  return body;
}

function isolatedEnv() {
  const tmp = mkdtempSync(join(tmpdir(), "dd-review-"));
  const env: NodeJS.ProcessEnv = {
    DETECTION_DATA_DIR: join(tmp, "data"),
    DETECTION_ENTERPRISE_DIR: join(ROOT, "enterprise"),
    CONTENT_JSON_BASE: join(tmp, "content"),
    DETECTION_CLONE_DIR: join(tmp, "repos"),
  };
  return { tmp, env };
}

function git(cwd: string, ...args: string[]) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(proc.status, 0, `git ${args.join(" ")}\n${proc.stderr}`);
}

function makeLocalGitRepo(tmp: string) {
  const repo = join(tmp, "src-repo");
  mkdirSync(join(repo, "src/main/java/com/example/order"), { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "review@example.test");
  git(repo, "config", "user.name", "review");
  writeFileSync(join(repo, FILE_PATH), [
    "package com.example.order;",
    "public class OrderService {",
    "    public String getName() {",
    "        return name;",
    "    }",
    "}",
    "",
  ].join("\n"));
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const branch = "feature/review-fixes";
  git(repo, "checkout", "-b", branch);
  writeFileSync(join(repo, FILE_PATH), [
    "package com.example.order;",
    "public class OrderService {",
    "    public String checkout(String id) {",
    "        User user = map.get(id);",
    "        if (id == null) {",
    "            return null;",
    "        }",
    "        return user.getName();",
    "    }",
    "    public String refund(String id) {",
    "        Order o = orders.get(id);",
    "        return o.refund();",
    "    }",
    "    public String getName() {",
    "        return name;",
    "    }",
    "}",
    "",
  ].join("\n"));
  git(repo, "add", ".");
  git(repo, "commit", "-m", "add checkout and refund");
  return { repo, gitUrl: `file://${repo}`, branch };
}

describe("review fixes: add-test-case upserts by id", () => {
  it("merges a second add-test-case for the same id instead of appending", () => {
    const { env } = isolatedEnv();
    const created = expectOk(run(env, "submit-git", "--git", "git@github.com:acme/x.git", "--branch", "feature/a", "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "upsert", "--git-url", "git@github.com:acme/x.git", "--branch", "feature/a").status, 0);

    const first = expectOk(run(env, "add-test-case", "--task-id", taskId, "--case-json", JSON.stringify({ id: "TC-1", title: "refund cap", steps: "refund twice", expectedResult: "second refund rejected" })));
    assert.equal(first.data.updated, false);
    const second = expectOk(run(env, "add-test-case", "--task-id", taskId, "--case-json", JSON.stringify({ id: "TC-1", semanticReviewSkill: "business-semantic", relatedMethods: ["com/example/order/OrderService#refund"] })));
    assert.equal(second.data.updated, true);

    const cases = JSON.parse(readFileSync(join(env.CONTENT_JSON_BASE!, taskId, "test_cases.json"), "utf8")).testCases;
    assert.equal(cases.length, 1);
    assert.equal(cases[0].title, "refund cap");
    assert.equal(cases[0].semanticReviewSkill, "business-semantic");
    assert.deepEqual(cases[0].relatedMethods, ["com/example/order/OrderService#refund"]);
  });
});

describe("review fixes: local platform seeds pending processes from the diff plan", () => {
  it("clone-and-diff --with-plan makes get-pending and check-coverage reflect the plan", { timeout: 60_000 }, () => {
    const { tmp, env } = isolatedEnv();
    const { gitUrl, branch } = makeLocalGitRepo(tmp);
    const created = expectOk(run(env, "submit-git", "--git", gitUrl, "--branch", branch, "--submit-user", "alice"));
    const taskId = String(created.data.taskId);
    const batchId = String(created.data.batchIds[0]);
    assert.equal(run(env, "init-content", "--task-id", taskId, "--plan-name", "seed", "--git-url", gitUrl, "--branch", branch).status, 0);
    assert.equal(run(env, "add-service-to-content", "--task-id", taskId, "--git-url", gitUrl, "--branch", branch, "--batch-ids", batchId, "--language", "java").status, 0);

    const cloned = expectOk(
      run(env, "clone-and-diff", "--task-id", taskId, "--batch-id", batchId, "--git-url", gitUrl, "--branch", branch, "--base-branch", "main", "--with-plan"),
      "clone-and-diff --with-plan",
    );
    const planTotal = cloned.data.plan?.detectionPlanTotal ?? cloned.data.detectionPlanTotal;
    assert.ok(planTotal >= 2, JSON.stringify(cloned.data).slice(0, 500));

    const plan = JSON.parse(readFileSync(join(env.CONTENT_JSON_BASE!, taskId, "plan.json"), "utf8")).detectionPlan;
    assert.ok(plan.length >= 2);
    for (const item of plan) {
      assert.ok(Number.isInteger(item.processId), `plan item ${item.methodName} has no processId`);
      assert.equal(item.parentBatchId, Number(batchId));
    }

    const pending = expectOk(run(env, "get-pending", "--batch-id", batchId));
    const names = pending.data.map((p: any) => p.methodName).sort();
    assert.ok(names.includes("checkout") && names.includes("refund"), names.join(","));

    const coverage = expectOk(run(env, "check-coverage", "--batch-id", batchId));
    assert.equal(coverage.data.allCompleted, false);
    assert.equal(coverage.data.totalCount, plan.length);
    assert.equal(coverage.data.completedCount, 0);

    // Rebuilding the plan picks the seeded processes up via get-pending (still diff-sourced)
    // and creates no extra ones.
    const rebuilt = expectOk(run(env, "build-detection-plan", "--task-id", taskId, "--batch-ids", batchId));
    assert.equal(rebuilt.data.seededProcesses.seeded, 0);
    assert.equal(rebuilt.data.detectionPlanTotal, plan.length);
    assert.ok(rebuilt.data.detectionPlan.every((i: any) => Number.isInteger(i.processId) && i.source === "diff"));
    const again = expectOk(run(env, "check-coverage", "--batch-id", batchId));
    assert.equal(again.data.totalCount, plan.length);
  });
});

describe("review fixes: summary normalisation and forbidden terms", () => {
  it("keeps underscores inside identifiers while still stripping _italic_ markers", () => {
    const out = normalize_summary_for_plaintext("call _check_token with account_id then snake_case_name and _really_ done");
    assert.equal(out, "call _check_token with account_id then snake_case_name and really done");
  });

  it("flags the word batch but not batchSize / batching", () => {
    assert.equal(check_summary_forbidden("the batchSize and batching of orders").length, 0);
    assert.equal(check_summary_forbidden("processed in one batch").length, 1);
  });
});

describe("review fixes: config paths do not depend on the working directory", () => {
  it("resolves a relative data_dir / enterprise_dir against the config file, not process.cwd()", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-cfg-"));
    const cfgDir = join(tmp, "skill");
    mkdirSync(cfgDir, { recursive: true });
    const cfg = join(cfgDir, "config.yaml");
    writeFileSync(cfg, ["data_dir: ./data", "enterprise_dir: ./enterprise", ""].join("\n"), "utf8");

    const saved = { data: process.env.DETECTION_DATA_DIR, ent: process.env.DETECTION_ENTERPRISE_DIR, cwd: process.cwd() };
    delete process.env.DETECTION_DATA_DIR;
    delete process.env.DETECTION_ENTERPRISE_DIR;
    const elsewhere = join(tmp, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    process.chdir(elsewhere);
    try {
      const s = load_settings(cfg);
      assert.equal(s.data_dir, join(cfgDir, "data"));
      assert.equal(s.enterprise_dir, join(cfgDir, "enterprise"));
      assert.equal(existsSync(join(elsewhere, "data")), false);

      // An explicit env override still wins and resolves like any CLI path.
      process.env.DETECTION_DATA_DIR = join(tmp, "override");
      assert.equal(load_settings(cfg).data_dir, join(tmp, "override"));
    } finally {
      process.chdir(saved.cwd);
      if (saved.data === undefined) delete process.env.DETECTION_DATA_DIR; else process.env.DETECTION_DATA_DIR = saved.data;
      if (saved.ent === undefined) delete process.env.DETECTION_ENTERPRISE_DIR; else process.env.DETECTION_ENTERPRISE_DIR = saved.ent;
    }
  });
});

describe("review fixes: document rule extraction", () => {
  it("folds wrapped lines into one rule and drops commands, tables, fences and metadata", () => {
    const body = [
      "# Requirements",
      "",
      "Owner: Platform · Status: Approved",
      "",
      "```bash",
      "node smoke.mjs",
      "```",
      "",
      "LOG_LEVEL=silent node smoke.mjs",
      "",
      "Hold window. A reservation holds stock for 15 minutes by default. A",
      "caller may request a longer window, but the service must clamp",
      "the effective window to a maximum of 60 minutes.",
      "",
      "| Case | Expectation |",
      "| --- | --- |",
      "| C1 | availability for `X` becomes 0. |",
      "",
      "Seed used by every case:",
      "",
      "- Orders of 10 units or more receive 5% discount.",
      "- Orders of 50 units or more receive 10%.",
    ].join("\n");
    const rules = _rule_paragraphs_from_doc(body);
    assert.deepEqual(rules, [
      "Hold window. A reservation holds stock for 15 minutes by default. A caller may request a longer window, but the service must clamp the effective window to a maximum of 60 minutes.",
      "Orders of 10 units or more receive 5% discount.",
      "Orders of 50 units or more receive 10%.",
    ]);
  });
});
