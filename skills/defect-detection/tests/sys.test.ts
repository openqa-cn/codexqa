import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

import { IS_WINDOWS, run, scratch_dir, to_posix, which } from "../scripts/sys.ts";
import { repo_clone_base_dir } from "../scripts/store.ts";

describe("sys platform layer", () => {
  it("which() finds node and git on PATH and returns absolute paths", () => {
    const node = which("node");
    assert.ok(node && isAbsolute(node), `node not resolved: ${node}`);
    const git = which("git");
    assert.ok(git && isAbsolute(git), `git not resolved: ${git}`);
    assert.equal(which("definitely-not-a-binary-xyz"), null);
  });

  it("run() executes a resolved command and captures stdout", () => {
    const r = run([process.execPath, "-e", "process.stdout.write('hi')"], { timeout_s: 30 });
    assert.equal(r.returncode, 0);
    assert.equal(r.stdout, "hi");
    assert.equal(r.notFound, false);
    assert.equal(r.timedOut, false);
  });

  it("run() reports a missing binary as notFound with an ENOENT-coded error instead of throwing", () => {
    const r = run(["definitely-not-a-binary-xyz", "--version"]);
    assert.equal(r.returncode, -1);
    assert.equal(r.notFound, true);
    assert.equal(r.error?.code, "ENOENT");
  });

  it("run() flags timeouts", () => {
    const r = run([process.execPath, "-e", "setTimeout(()=>{}, 5000)"], { timeout_s: 1 });
    assert.equal(r.timedOut, true);
  });

  it("scratch_dir() lives under the data dir, not /tmp, and is created on demand", () => {
    const data = mkdtempSync(join(tmpdir(), "dd-sys-"));
    const prev = { c: process.env.CONTENT_JSON_BASE, d: process.env.DETECTION_DATA_DIR };
    process.env.CONTENT_JSON_BASE = data;
    try {
      const s = scratch_dir("probe");
      assert.equal(s, join(data, "_tmp", "probe"));
      assert.ok(existsSync(s));
      assert.equal(repo_clone_base_dir(), join(data, "repos"));
    } finally {
      if (prev.c === undefined) delete process.env.CONTENT_JSON_BASE; else process.env.CONTENT_JSON_BASE = prev.c;
      if (prev.d === undefined) delete process.env.DETECTION_DATA_DIR; else process.env.DETECTION_DATA_DIR = prev.d;
    }
  });

  it("DETECTION_CLONE_DIR overrides the clone root", () => {
    const prev = process.env.DETECTION_CLONE_DIR;
    process.env.DETECTION_CLONE_DIR = join(tmpdir(), "dd-clones");
    try {
      assert.equal(repo_clone_base_dir(), join(tmpdir(), "dd-clones"));
    } finally {
      if (prev === undefined) delete process.env.DETECTION_CLONE_DIR; else process.env.DETECTION_CLONE_DIR = prev;
    }
  });

  it("to_posix() normalises separators for persisted paths", () => {
    assert.equal(to_posix("src\\main\\java\\Foo.java"), "src/main/java/Foo.java");
    assert.equal(to_posix("src/main/Foo.java"), "src/main/Foo.java");
    assert.equal(to_posix(join("a", "b", "c.ts")), "a/b/c.ts");
    assert.equal(IS_WINDOWS, sep === "\\");
  });
});
