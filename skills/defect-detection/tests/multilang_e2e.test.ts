/**
 * Multi-language end-to-end: a Python + Go + TypeScript repo goes through
 * submit-git → clone-and-diff → get-changed-methods → build-detection-plan →
 * read-method-code → verify-line-method-mapping → gen-writeback-template without
 * any Java assumption leaking in (language detection, class names, file paths,
 * trivial filter, code fences).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AST_RULES } from "../scripts/providers/platform/seed_catalog.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "detect.ts");

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
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

function git(cwd: string, ...args: string[]) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(proc.status, 0, `git ${args.join(" ")}\n${proc.stderr}`);
}

function isolatedEnv() {
  const tmp = mkdtempSync(join(tmpdir(), "dd-multi-"));
  return {
    tmp,
    env: {
      DETECTION_DATA_DIR: join(tmp, "data"),
      DETECTION_ENTERPRISE_DIR: join(ROOT, "enterprise"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    } as NodeJS.ProcessEnv,
  };
}

function makePolyglotRepo(tmp: string) {
  const repo = join(tmp, "poly-repo");
  mkdirSync(join(repo, "app/api"), { recursive: true });
  mkdirSync(join(repo, "internal/pay"), { recursive: true });
  mkdirSync(join(repo, "web/src"), { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "multi@example.test");
  git(repo, "config", "user.name", "multi-lang");
  writeFileSync(join(repo, "app/api/users.py"), ["def list_users():", "    return []", ""].join("\n"));
  writeFileSync(join(repo, "internal/pay/charge.go"), ["package pay", "", "func Charge(id string) error {", "\treturn nil", "}", ""].join("\n"));
  writeFileSync(join(repo, "web/src/cart.ts"), ["export function total(items: number[]): number {", "  return items.length;", "}", ""].join("\n"));
  writeFileSync(join(repo, "README.md"), "# poly\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const branch = `feature/multi-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  git(repo, "checkout", "-b", branch);
  writeFileSync(join(repo, "app/api/users.py"), [
    "import os",
    "",
    "def list_users():",
    "    return []",
    "",
    "def get_name(user):",
    "    return user.name",
    "",
    "def create_user(payload, repo):",
    "    name = payload.get('name')",
    "    if not name:",
    "        raise ValueError('name required')",
    "    user = repo.save(name)",
    "    return user.id",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "internal/pay/charge.go"), [
    "package pay",
    "",
    "func Charge(id string) error {",
    "\treturn nil",
    "}",
    "",
    "func (s *Service) Refund(id string, amount int) (bool, error) {",
    "\tif amount <= 0 {",
    "\t\treturn false, nil",
    "\t}",
    "\treturn true, nil",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "web/src/cart.ts"), [
    "export function total(items: number[]): number {",
    "  return items.length;",
    "}",
    "export const applyCoupon = async (cart: Cart, code: string) => {",
    "  const c = await lookup(code);",
    "  return cart.total - c.amount;",
    "};",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "README.md"), "# poly\nchanged\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "multi-language change");
  return { repo, gitUrl: `file://${repo}`, branch };
}

/** Kotlin + C# + C++: the three profiles whose pipeline had only unit-level coverage. */
function makeJvmDotnetNativeRepo(tmp: string) {
  const repo = join(tmp, "kcs-repo");
  mkdirSync(join(repo, "src/main/kotlin/com/acme"), { recursive: true });
  mkdirSync(join(repo, "src/Orders"), { recursive: true });
  mkdirSync(join(repo, "src/net"), { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "multi@example.test");
  git(repo, "config", "user.name", "multi-lang");

  const kt = (extra: string[]) => [
    "package com.acme",
    "",
    "class Cart(private val items: List<Item>) {",
    "    fun size(): Int = items.size",
    ...extra,
    "}",
    "",
  ].join("\n");
  const cs = (extra: string[]) => [
    "namespace Acme.Orders",
    "{",
    "    public class OrderService",
    "    {",
    "        public int Total(int[] items) { return items.Length; }",
    ...extra,
    "    }",
    "}",
    "",
  ].join("\n");
  const cpp = (extra: string[]) => [
    '#include "sock.h"',
    "",
    "int Sock::Send(const char* b, size_t n) {",
    "  return write(fd_, b, n);",
    "}",
    ...extra,
    "",
  ].join("\n");

  writeFileSync(join(repo, "src/main/kotlin/com/acme/Cart.kt"), kt([]));
  writeFileSync(join(repo, "src/Orders/OrderService.cs"), cs([]));
  writeFileSync(join(repo, "src/net/sock.cpp"), cpp([]));
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const branch = `feature/kcs-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  git(repo, "checkout", "-b", branch);

  writeFileSync(join(repo, "src/main/kotlin/com/acme/Cart.kt"), kt([
    "",
    "    fun applyCoupon(code: String): Int {",
    "        val c = lookup(code)",
    "        return total() - c.amount",
    "    }",
  ]));
  writeFileSync(join(repo, "src/Orders/OrderService.cs"), cs([
    "",
    "        public bool Refund(int amount)",
    "        {",
    "            if (amount <= 0)",
    "            {",
    "                return false;",
    "            }",
    "            return true;",
    "        }",
  ]));
  writeFileSync(join(repo, "src/net/sock.cpp"), cpp([
    "",
    "bool Sock::Reconnect(int retries) {",
    "  for (int i = 0; i < retries; ++i) {",
    "    if (Connect()) {",
    "      return true;",
    "    }",
    "  }",
    "  return false;",
    "}",
  ]));
  git(repo, "add", ".");
  git(repo, "commit", "-m", "kotlin + csharp + cpp change");
  return { repo, gitUrl: `file://${repo}`, branch };
}

describe("multi-language pipeline", () => {
  it("detects language, extracts units, plans, reads and verifies across Python/Go/TS", { timeout: 120_000 }, () => {
    const { tmp, env } = isolatedEnv();
    const { repo, gitUrl, branch } = makePolyglotRepo(tmp);

    const created = expectOk(run(env, "submit-git", "--git", gitUrl, "--branch", branch, "--submit-user", "alice"), "submit-git");
    const taskId = String(created.data.taskId);
    const batchId = String(created.data.batchIds[0]);
    expectOk(run(env, "init-content", "--task-id", taskId, "--plan-name", "Poly", "--git-url", gitUrl, "--branch", branch), "init-content");
    // No --language anywhere: the pipeline must work it out.
    expectOk(run(env, "add-service-to-content", "--task-id", taskId, "--git-url", gitUrl, "--branch", branch, "--batch-ids", batchId), "add-service");

    const cloned = expectOk(
      run(env, "clone-and-diff", "--task-id", taskId, "--batch-id", batchId, "--git-url", gitUrl, "--branch", branch, "--base-branch", "main"),
      "clone-and-diff",
    );
    assert.equal(cloned.data.languageSource, "detected");
    assert.equal(cloned.data.polyglot, true);
    assert.deepEqual(cloned.data.languageBreakdown, { python: 1, go: 1, typescript: 1 });
    assert.ok(["python", "go", "typescript"].includes(cloned.data.language));
    assert.deepEqual(
      [...cloned.data.gotchasDocs].sort(),
      ["references/rules/frontend-gotchas.md", "references/rules/go-gotchas.md", "references/rules/python-gotchas.md"],
    );

    const meta = JSON.parse(readFileSync(join(env.CONTENT_JSON_BASE!, taskId, "meta.json"), "utf8"));
    const svc = meta.services.find((s: any) => s.gitUrl === gitUrl);
    assert.equal(svc.language, cloned.data.language);
    assert.equal(svc.languageSource, "detected");
    assert.notEqual(svc.language, "java");

    const methods = expectOk(run(env, "get-changed-methods", "--task-id", taskId, "--local-dir", cloned.data.localDir), "get-changed-methods");
    const byName = Object.fromEntries((methods.data.changedMethods || []).map((m: any) => [m.methodName, m]));
    for (const name of ["get_name", "create_user", "Refund", "applyCoupon"]) {
      assert.ok(byName[name], `expected changed method ${name} in ${Object.keys(byName)}`);
    }
    assert.equal(byName.create_user.className, "app/api/users");
    assert.equal(byName.create_user.filePath, "app/api/users.py");
    assert.equal(byName.create_user.language, "python");
    assert.equal(byName.Refund.className, "internal/pay/charge");
    assert.equal(byName.Refund.language, "go");
    assert.equal(byName.applyCoupon.filePath, "web/src/cart.ts");
    assert.equal(byName.applyCoupon.language, "typescript");
    assert.ok(!Object.values(byName).some((m: any) => String(m.filePath).endsWith(".java")));
    assert.deepEqual(methods.data.diffFilesByLanguage, { python: 1, go: 1, typescript: 1 });
    assert.deepEqual(methods.data.nonSourceDiffFiles, ["README.md"]);

    const plan = expectOk(run(env, "build-detection-plan", "--task-id", taskId, "--batch-ids", batchId), "build-detection-plan");
    const items = plan.data.detectionPlan as any[];
    assert.deepEqual(plan.data.languages, ["go", "python", "typescript"]);
    assert.equal(plan.data.gotchasDocs.length, 3);
    const getName = items.find((i) => i.methodName === "get_name");
    const createUser = items.find((i) => i.methodName === "create_user");
    assert.equal(getName.language, "python");
    assert.equal(getName.trivial, true, "python get_ accessor must be trivial");
    assert.equal(getName.trivialReason, "GETTER");
    assert.equal(createUser.trivial, false);
    assert.equal(createUser.filePath, "app/api/users.py");

    const read = expectOk(
      run(env, "read-method-code", "--task-id", taskId, "--batch-id", batchId, "--class-name", "app/api/users", "--method-name", "create_user", "--local-dir", cloned.data.localDir),
      "read-method-code",
    );
    assert.equal(read.data.filePath, "app/api/users.py");
    assert.equal(read.data.language, "python");
    assert.equal(read.data.codeFence, "python");
    assert.equal(read.data.methodStartLine, 9);
    assert.equal(read.data.methodEndLine, 14);
    assert.match(read.data.methodCode, /raise ValueError/);

    const verified = expectOk(
      run(env, "verify-line-method-mapping", "--task-id", taskId, "--class-name", "internal/pay/charge", "--method-name", "Refund", "--content", "Defect: x\n\nLines:8-10\n", "--local-dir", cloned.data.localDir),
      "verify-line-method-mapping go",
    );
    assert.equal(verified.data.verified, true);

    const wrong = run(env, "verify-line-method-mapping", "--task-id", taskId, "--class-name", "internal/pay/charge", "--method-name", "Charge", "--content", "Defect: x\n\nLines:8-10\n", "--local-dir", cloned.data.localDir);
    const wrongBody = lastJson(wrong);
    assert.equal(wrongBody.data.verified, false);
    assert.equal(wrongBody.data.mismatches[0].actualMethod, "Refund");

    // AST scan over the polyglot diff: every language's pack is loaded, not just the dominant one.
    const rules_file = join(tmp, "rules.json");
    writeFileSync(rules_file, JSON.stringify(AST_RULES));
    const ast = run(env, "run-ast-scan", "--code-dir", cloned.data.localDir, "--rules-json", rules_file, "--task-id", taskId);
    const astBody = JSON.parse((ast.stdout || "").trim());
    assert.notEqual(astBody.skipped, true, JSON.stringify(astBody).slice(0, 400));
    assert.deepEqual(astBody.languages, ["go", "python", "typescript"]);
    assert.ok(astBody.ruleCount >= 40, `expected go+python+js+ts packs, got ${astBody.ruleCount}`);
    assert.ok(astBody.skippedRuleCount >= 40, "java / kotlin / scala / c / cpp / csharp packs are filtered out");
    if (astBody.scanOk !== false) {
      assert.equal(astBody.scannedFiles, 3, "README.md is not a scan target");
    }

    const tpl = expectOk(
      run(env, "gen-writeback-template", "--task-id", taskId, "--strategy-code", "11", "--bug-status", "6", "--class-name", "app/api/users", "--method-name", "create_user"),
      "gen-writeback-template",
    );
    assert.equal(tpl.data.fileCodes[0].filePath, "app/api/users.py");
    assert.match(tpl.data.content, /```python/);
    assert.doesNotMatch(tpl.data.content, /```java/);

    // A Go method in a Python-majority task: the item's own language wins over service.language.
    const tplGo = expectOk(
      run(env, "gen-writeback-template", "--task-id", taskId, "--strategy-code", "8", "--bug-status", "6", "--class-name", "internal/pay/charge", "--method-name", "Refund"),
      "gen-writeback-template (go)",
    );
    assert.equal(tplGo.data.fileCodes[0].filePath, "internal/pay/charge.go");
    assert.match(tplGo.data.content, /```go/);
    assert.doesNotMatch(tplGo.data.content, /```python/);

    rmSync(cloned.data.localDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("carries Kotlin/C#/C++ through the same pipeline with their own class-name schemes", { timeout: 120_000 }, () => {
    const { tmp, env } = isolatedEnv();
    const { repo, gitUrl, branch } = makeJvmDotnetNativeRepo(tmp);

    const created = expectOk(run(env, "submit-git", "--git", gitUrl, "--branch", branch, "--submit-user", "alice"), "submit-git");
    const taskId = String(created.data.taskId);
    const batchId = String(created.data.batchIds[0]);
    expectOk(run(env, "init-content", "--task-id", taskId, "--plan-name", "KCS", "--git-url", gitUrl, "--branch", branch), "init-content");
    expectOk(run(env, "add-service-to-content", "--task-id", taskId, "--git-url", gitUrl, "--branch", branch, "--batch-ids", batchId), "add-service");

    const cloned = expectOk(
      run(env, "clone-and-diff", "--task-id", taskId, "--batch-id", batchId, "--git-url", gitUrl, "--branch", branch, "--base-branch", "main"),
      "clone-and-diff",
    );
    assert.equal(cloned.data.languageSource, "detected");
    assert.deepEqual(cloned.data.languageBreakdown, { kotlin: 1, csharp: 1, cpp: 1 });
    assert.deepEqual(
      [...cloned.data.gotchasDocs].sort(),
      ["references/rules/c-cpp-gotchas.md", "references/rules/csharp-gotchas.md", "references/rules/kotlin-gotchas.md"],
    );
    assert.notEqual(cloned.data.language, "java");

    const methods = expectOk(run(env, "get-changed-methods", "--task-id", taskId, "--local-dir", cloned.data.localDir), "get-changed-methods");
    const byName = Object.fromEntries((methods.data.changedMethods || []).map((m: any) => [m.methodName, m]));
    for (const name of ["applyCoupon", "Refund", "Reconnect"]) {
      assert.ok(byName[name], `expected changed method ${name} in ${Object.keys(byName)}`);
    }
    // Kotlin is fqcn (source root stripped); C# and C++ keep the repo path.
    assert.equal(byName.applyCoupon.className, "com/acme/Cart");
    assert.equal(byName.applyCoupon.filePath, "src/main/kotlin/com/acme/Cart.kt");
    assert.equal(byName.applyCoupon.language, "kotlin");
    assert.equal(byName.Refund.className, "src/Orders/OrderService");
    assert.equal(byName.Refund.language, "csharp");
    assert.equal(byName.Reconnect.className, "src/net/sock");
    assert.equal(byName.Reconnect.language, "cpp");
    assert.ok(!Object.values(byName).some((m: any) => String(m.filePath).endsWith(".java")));

    const plan = expectOk(run(env, "build-detection-plan", "--task-id", taskId, "--batch-ids", batchId), "build-detection-plan");
    assert.deepEqual(plan.data.languages, ["cpp", "csharp", "kotlin"]);
    const items = plan.data.detectionPlan as any[];
    for (const [name, language] of [["applyCoupon", "kotlin"], ["Refund", "csharp"], ["Reconnect", "cpp"]]) {
      const item = items.find((i) => i.methodName === name);
      assert.ok(item, `plan missing ${name}`);
      assert.equal(item.language, language);
      assert.equal(item.trivial, false, `${name} is real logic, not boilerplate`);
    }

    const read = expectOk(
      run(env, "read-method-code", "--task-id", taskId, "--batch-id", batchId, "--class-name", "src/Orders/OrderService", "--method-name", "Refund", "--local-dir", cloned.data.localDir),
      "read-method-code (csharp)",
    );
    assert.equal(read.data.filePath, "src/Orders/OrderService.cs");
    assert.equal(read.data.codeFence, "csharp");
    assert.match(read.data.methodCode, /amount <= 0/);

    const verified = expectOk(
      run(env, "verify-line-method-mapping", "--task-id", taskId, "--class-name", "com/acme/Cart", "--method-name", "applyCoupon", "--content", "Defect: x\n\nLines:7-8\n", "--local-dir", cloned.data.localDir),
      "verify-line-method-mapping kotlin",
    );
    assert.equal(verified.data.verified, true);

    const rules_file = join(tmp, "rules.json");
    writeFileSync(rules_file, JSON.stringify(AST_RULES));
    const ast = run(env, "run-ast-scan", "--code-dir", cloned.data.localDir, "--rules-json", rules_file, "--task-id", taskId);
    const astBody = JSON.parse((ast.stdout || "").trim());
    if (astBody.skipped !== true) {
      assert.deepEqual(astBody.languages, ["cpp", "csharp", "kotlin"]);
      assert.ok(astBody.ruleCount > 0, "kotlin / csharp / cpp packs must load");
      assert.ok(astBody.skippedRuleCount > 0, "java / python / go packs are filtered out");
    }

    for (const [class_name, method, fence, other] of [
      ["com/acme/Cart", "applyCoupon", "kotlin", "csharp"],
      ["src/net/sock", "Reconnect", "cpp", "kotlin"],
    ] as const) {
      const tpl = expectOk(
        run(env, "gen-writeback-template", "--task-id", taskId, "--strategy-code", "11", "--bug-status", "6", "--class-name", class_name, "--method-name", method),
        `gen-writeback-template (${fence})`,
      );
      assert.ok(tpl.data.content.includes("```" + fence), `${method} must use the ${fence} fence`);
      assert.ok(!tpl.data.content.includes("```" + other));
      assert.ok(!tpl.data.content.includes("```java"));
    }

    rmSync(cloned.data.localDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
});
