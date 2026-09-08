import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

describe("cleanup-stale-data keeps reserved data dirs", () => {
  it("never deletes platform/ or issues/, ages out repos/ and stray dirs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-cleanup-"));
    const data = join(tmp, "data");
    // Single data root for platform + content store, like the default install layout.
    const env = { DETECTION_DATA_DIR: data, CONTENT_JSON_BASE: data, DETECTION_ENTERPRISE_DIR: join(ROOT, "enterprise") };

    const created = lastJson(run(env, "submit-git", "--git-url", "https://example.com/a/b.git", "--branch", "main", "--submit-user", "t"));
    assert.equal(created.code, 0, JSON.stringify(created));
    assert.ok(existsSync(join(data, "platform")), "submit-git should create platform/");

    mkdirSync(join(data, "issues"), { recursive: true });
    writeFileSync(join(data, "issues", "index.json"), JSON.stringify({ data: { nextId: 1, items: [] } }), "utf8");
    mkdirSync(join(data, "stray-dir"), { recursive: true });

    const old = new Date(Date.now() - 100 * 3600 * 1000);
    const fresh_repo = join(data, "repos", "fresh000000");
    const stale_repo = join(data, "repos", "stale000000");
    for (const r of [fresh_repo, stale_repo]) {
      mkdirSync(join(r, ".git"), { recursive: true });
      writeFileSync(join(r, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    }
    utimesSync(join(stale_repo, ".git", "HEAD"), old, old);
    utimesSync(join(stale_repo, ".git"), old, old);
    utimesSync(stale_repo, old, old);

    const dry = lastJson(run(env, "cleanup-stale-data", "--dry-run"));
    assert.equal(dry.code, 0, JSON.stringify(dry));
    const invalid = (dry.data.invalidDirsCleaned || []).map((d: any) => d.dir);
    assert.deepEqual(invalid, ["stray-dir"], `only stray dirs may be flagged, got ${JSON.stringify(invalid)}`);
    const repos = (dry.data.reposCleaned || []).map((d: any) => d.repo);
    assert.deepEqual(repos, ["stale000000"], JSON.stringify(dry.data.reposCleaned));

    const real = lastJson(run(env, "cleanup-stale-data"));
    assert.equal(real.code, 0, JSON.stringify(real));
    assert.ok(existsSync(join(data, "platform")), "platform/ must survive cleanup");
    assert.ok(existsSync(join(data, "issues", "index.json")), "issues/ must survive cleanup");
    assert.ok(existsSync(fresh_repo), "fresh clone must survive cleanup");
    assert.ok(!existsSync(stale_repo), "stale clone must be removed");
    assert.ok(!existsSync(join(data, "stray-dir")), "stray dir must be removed");

    const status = lastJson(run(env, "status", "--task-id", String(created.data.taskId)));
    assert.equal(status.code, 0, "task must still be readable after cleanup");
  });
});
