#!/usr/bin/env node
// Build a tiny git repo from the known-good / seeded-defect pair so defect-detection
// can submit-git + clone-and-diff + run-ast-scan against a real branch.
//
// Cross-platform (Node + git only, no bash). Usage:
//   node examples/checkout-boundary/make-git-fixture.mjs [dest-dir]
//
// Prints the absolute path of the fixture repo on stdout (last line).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(process.argv[2] || join(tmpdir(), "checkout-boundary-fixture"));

function git(...args) {
  const r = spawnSync("git", args, { cwd: DEST, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || "");
    throw new Error(`git ${args.join(" ")} failed (exit ${r.status})`);
  }
  return r.stdout;
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@example.com");
git("config", "user.name", "checkout-boundary");

// Known-good on main
copyFileSync(join(ROOT, "good.mjs"), join(DEST, "checkout.mjs"));
writeFileSync(join(DEST, "index.mjs"), "export { checkout } from './checkout.mjs';\n", "utf8");
git("add", "checkout.mjs", "index.mjs");
git("commit", "-qm", "known-good: reject amount <= 0");

// Seeded defect on a feature branch
git("checkout", "-qb", "feature/zero-accepted");
copyFileSync(join(ROOT, "defective.mjs"), join(DEST, "checkout.mjs"));
git("add", "checkout.mjs");
git("commit", "-qm", "seeded-defect: accept amount === 0");

// Last line for scripts to capture
console.log(DEST);
