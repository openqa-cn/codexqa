#!/usr/bin/env node
// Build the inventory-service blind-evaluation fixture as a real git repository:
// `main` holds the known-good service, `feature/reservation-v2` plants seven
// business-logic defects among clean changes plus four decoy functions.
//
// Cross-platform (Node + git only). Usage:
//   node examples/inventory-service/make-git-fixture.mjs [dest-dir]
//
// Prints the absolute path of the fixture repo on stdout (last line).

import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FIXTURE_ROOT, materialize } from "./materialize.mjs";

const DEST = resolve(process.argv[2] || join(tmpdir(), "inventory-service-fixture"));

function git(...args) {
  const r = spawnSync("git", args, { cwd: DEST, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || "");
    throw new Error(`git ${args.join(" ")} failed (exit ${r.status})`);
  }
  return r.stdout;
}

// main: the known-good service.
materialize(DEST, "base");
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@example.com");
git("config", "user.name", "inventory-service");
git("add", "-A");
git("commit", "-q", "-m", "Reservation and refund service (v1)");

// feature/reservation-v2: same tree with the seeded changes applied on top.
git("checkout", "-q", "-b", "feature/reservation-v2");
cpSync(join(FIXTURE_ROOT, "head"), DEST, { recursive: true });
git("add", "-A");
git("commit", "-q", "-m", "Reservation v2: hold windows, expiry sweep, partial refunds");

process.stderr.write(`main:    known-good implementation\nbranch:  feature/reservation-v2 (7 seeded defects, 4 decoys)\n`);
process.stdout.write(DEST + "\n");
