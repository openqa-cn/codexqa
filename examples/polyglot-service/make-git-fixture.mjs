#!/usr/bin/env node
// Build a small polyglot git repo (Python API + Go payment package + TypeScript cart)
// whose feature branch plants one seeded defect per language, so defect-detection can
// run submit-git → clone-and-diff → get-changed-methods → build-detection-plan →
// run-ast-scan against a change set that is not Java.
//
// Cross-platform (Node + git only). Usage:
//   node examples/polyglot-service/make-git-fixture.mjs [dest-dir]
//
// Prints the absolute path of the fixture repo on stdout (last line).

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEST = resolve(process.argv[2] || join(tmpdir(), "polyglot-service-fixture"));

function git(...args) {
  const r = spawnSync("git", args, { cwd: DEST, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || "");
    throw new Error(`git ${args.join(" ")} failed (exit ${r.status})`);
  }
  return r.stdout;
}

function write(rel, lines) {
  const abs = join(DEST, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, lines.join("\n") + "\n", "utf8");
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@example.com");
git("config", "user.name", "polyglot-service");

// ---- main: known-good -------------------------------------------------------
write("app/api/users.py", [
  "from db import cursor",
  "",
  "",
  "def get_name(user):",
  "    return user.name",
  "",
  "",
  "def find_user(user_id):",
  "    return cursor.execute('select * from users where id = %s', (user_id,))",
]);
write("internal/pay/charge.go", [
  "package pay",
  "",
  "import \"errors\"",
  "",
  "// Charge debits amount from the account; amount must be strictly positive.",
  "func Charge(accountID string, amount int) error {",
  "\tif amount <= 0 {",
  "\t\treturn errors.New(\"amount must be positive\")",
  "\t}",
  "\treturn debit(accountID, amount)",
  "}",
]);
write("web/src/cart.ts", [
  "export function total(items: number[]): number {",
  "  return items.reduce((a, b) => a + b, 0);",
  "}",
]);
write("README.md", ["# polyglot-service", "", "Python API, Go payments, TypeScript cart."]);
git("add", ".");
git("commit", "-qm", "known-good: parameterised query, positive-amount guard, strict total");

// ---- feature branch: one seeded defect per language -------------------------
git("checkout", "-qb", "feature/polyglot-defects");
write("app/api/users.py", [
  "from db import cursor",
  "",
  "",
  "def get_name(user):",
  "    return user.name",
  "",
  "",
  "def find_user(user_id):",
  "    # seeded: SQL built by concatenation (AST-PY-001)",
  "    return cursor.execute('select * from users where id = ' + str(user_id))",
  "",
  "",
  "def load_users(payload, cache=[]):",
  "    # seeded: mutable default shared across calls (AST-PY-MUT-001)",
  "    for u in payload.get('users', []):",
  "        cache.append(u)",
  "    return cache",
]);
write("internal/pay/charge.go", [
  "package pay",
  "",
  "import (",
  "\t\"errors\"",
  "\t\"os\"",
  ")",
  "",
  "// Charge debits amount from the account; amount must be strictly positive.",
  "func Charge(accountID string, amount int) error {",
  "\t// seeded: boundary bug, zero is accepted",
  "\tif amount < 0 {",
  "\t\treturn errors.New(\"amount must be positive\")",
  "\t}",
  "\treturn debit(accountID, amount)",
  "}",
  "",
  "func Refund(accountID string, amount int) error {",
  "\t// seeded: open error discarded, receipt may be nil (AST-GO-004)",
  "\treceipt, _ := os.Open(receiptPath(accountID))",
  "\tdefer receipt.Close()",
  "\treturn credit(accountID, amount)",
  "}",
]);
write("web/src/cart.ts", [
  "export function total(items: number[]): number {",
  "  return items.reduce((a, b) => a + b, 0);",
  "}",
  "",
  "export function applyCoupon(total: number, code: string): number {",
  "  // seeded: loose equality on a value (AST-JS-EQ-001) and eval of input (AST-JS-001)",
  "  if (code == 'FREE') return 0;",
  "  return total - Number(eval(code));",
  "}",
]);
git("add", ".");
git("commit", "-qm", "seeded-defects: sql concat, mutable default, zero boundary, discarded error, loose eq + eval");

// Last line for scripts to capture
console.log(DEST);
