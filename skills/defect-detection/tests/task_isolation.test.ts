import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reset_providers } from "../scripts/providers/registry.ts";
import {
  ContentStore,
  content_store_occupied,
  identities_conflict,
  next_free_task_id,
} from "../scripts/store.ts";

describe("content store isolation", () => {
  let dataDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "dd-iso-"));
    saved.CONTENT_JSON_BASE = process.env.CONTENT_JSON_BASE;
    saved.DETECTION_DATA_DIR = process.env.DETECTION_DATA_DIR;
    process.env.CONTENT_JSON_BASE = dataDir;
    process.env.DETECTION_DATA_DIR = dataDir;
    reset_providers();
  });

  afterEach(() => {
    reset_providers();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function seed(taskId: number, gitUrl: string, branch = "feature/old") {
    const store = new ContentStore(taskId);
    store.set_meta("planName", "previous-run");
    store.add_or_update_service({ gitUrl, branch, language: "java" });
    store.set_diff_files(["src/Old.java"]);
    assert.equal(store.save(), true);
  }

  it("occupied and next_free skip existing dir", () => {
    assert.equal(content_store_occupied(1), false);
    assert.equal(next_free_task_id(), 1);
    seed(1, "git@github.com:acme/old.git");
    assert.equal(content_store_occupied(1), true);
    assert.equal(next_free_task_id(), 2);
    assert.equal(next_free_task_id(1), 2);
  });

  it("identities conflict on different git", () => {
    const existing = { gits: ["git@github.com:acme/old"], branches: ["feature/old"], testPlanId: null };
    assert.equal(identities_conflict(existing, { gitUrl: "git@github.com:acme/new.git", branch: "feature/new" }), true);
    assert.equal(identities_conflict(existing, { gitUrl: "git@github.com:acme/old.git", branch: "feature/old" }), false);
    assert.equal(identities_conflict({ testPlanId: 1001, gits: [] }, { testPlanId: 2002 }), true);
  });
});

describe("local platform skips occupied task dirs", () => {
  it("submit-git remaps away from leftover task 1", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "dd-occ-"));
    process.env.CONTENT_JSON_BASE = dataDir;
    process.env.DETECTION_DATA_DIR = dataDir;
    reset_providers();
    mkdirSync(join(dataDir, "1"), { recursive: true });
    writeFileSync(join(dataDir, "1", "meta.json"), JSON.stringify({
      meta: { taskId: 1, planName: "old" },
      services: [{ gitUrl: "git@github.com:acme/old.git", branch: "old" }],
    }));
    const { spawnSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const { dirname } = await import("node:path");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const proc = spawnSync(process.execPath, [
      join(root, "scripts", "detect.ts"),
      "submit-git",
      "--git", "git@github.com:acme/new.git",
      "--branch", "feature/new",
      "--submit-user", "alice",
    ], {
      encoding: "utf8",
      env: { ...process.env, CONTENT_JSON_BASE: dataDir, DETECTION_DATA_DIR: dataDir },
      cwd: root,
    });
    assert.equal(proc.status, 0, proc.stderr);
    const body = JSON.parse(proc.stdout.trim());
    assert.ok(body.data.taskId !== 1, `expected remapped taskId, got ${body.data.taskId}`);
  });
});
