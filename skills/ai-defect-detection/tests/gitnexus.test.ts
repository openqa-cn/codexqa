import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensure, gitnexusHooks, run_cli } from "../open_gitnexus.ts";

const defaultWhich = gitnexusHooks.which;
const defaultRun = gitnexusHooks.run;

describe("gitnexus ensure", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dd-gn-"));
    saved.CONTENT_JSON_BASE = process.env.CONTENT_JSON_BASE;
    saved.DETECTION_DATA_DIR = process.env.DETECTION_DATA_DIR;
    process.env.CONTENT_JSON_BASE = tmp;
    process.env.DETECTION_DATA_DIR = tmp;
    gitnexusHooks.which = defaultWhich;
    gitnexusHooks.run = defaultRun;
  });

  afterEach(() => {
    gitnexusHooks.which = defaultWhich;
    gitnexusHooks.run = defaultRun;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("already installed skips install", () => {
    gitnexusHooks.which = (name) => (name === "gitnexus" ? "/usr/bin/gitnexus" : defaultWhich(name));
    gitnexusHooks.run = () => ({ returncode: 0, stdout: "gitnexus 1.1.9\n", stderr: "" });
    const result = ensure(false, null, false);
    assert.equal(result.ready, true);
    assert.equal(result.callGraph, "gitnexus");
    assert.equal(result.install, null);
  });

  it("missing then install success", () => {
    const whichMap: Record<string, string | null> = { gitnexus: null, npm: "/usr/bin/npm" };
    gitnexusHooks.which = (name) => (name in whichMap ? whichMap[name] : defaultWhich(name));
    gitnexusHooks.run = (cmd) => {
      if (cmd[0] === "/usr/bin/npm" && cmd[1] === "install") {
        whichMap.gitnexus = "/usr/bin/gitnexus";
        return { returncode: 0, stdout: "ok", stderr: "" };
      }
      if (String(cmd[0]).endsWith("gitnexus") && cmd.includes("--version")) {
        return { returncode: 0, stdout: "1.2.0", stderr: "" };
      }
      return { returncode: 0, stdout: "ok", stderr: "" };
    };
    const result = ensure(false, null, false);
    assert.equal(result.ready, true);
    assert.equal(result.install.ok, true);
    assert.equal(result.install.manager, "npm");
  });

  it("install fail falls back to grep and does not retry", () => {
    gitnexusHooks.which = (name) => (name === "npm" ? "/usr/bin/npm" : null);
    gitnexusHooks.run = () => ({ returncode: 1, stdout: "", stderr: "EACCES" });
    const first = ensure(false, null, false);
    const second = ensure(false, null, false);
    assert.equal(first.ready, false);
    assert.equal(first.fallback, "grep");
    assert.equal(first.install.attempted, true);
    assert.equal(second.install.skipped, true);
  });

  it("no npm falls back", () => {
    gitnexusHooks.which = () => null;
    const result = ensure(false, null, false);
    assert.equal(result.ready, false);
    assert.equal(result.fallback, "grep");
    assert.match(String(result.install.error), /Node/);
  });

  it("skips analyze when stamp matches HEAD", () => {
    writeFileSync(join(tmp, ".gitnexus-analyze.json"), JSON.stringify({ ok: true, commitId: "abc123" }));
    gitnexusHooks.which = (name) => (name === "gitnexus" ? "/usr/bin/gitnexus" : defaultWhich(name));
    gitnexusHooks.run = (cmd) => {
      if (cmd.includes("rev-parse")) return { returncode: 0, stdout: "abc123\n", stderr: "" };
      if (cmd.includes("analyze")) {
        throw new Error("analyze should be skipped when stamp matches HEAD");
      }
      return { returncode: 0, stdout: "ok", stderr: "" };
    };
    const result = ensure(false, tmp, true);
    assert.equal(result.ready, true);
    assert.equal(result.analyze.skipped, true);
    assert.match(String(result.analyze.reason), /already built/);
  });

  it("run_cli impact uses local dir", () => {
    const calls: { cmd: string[]; cwd: string | null }[] = [];
    gitnexusHooks.which = (name) => (name === "gitnexus" ? "/usr/bin/gitnexus" : defaultWhich(name));
    gitnexusHooks.run = (cmd, _timeout, cwd = null) => {
      calls.push({ cmd, cwd });
      return { returncode: 0, stdout: "upstream: Caller#foo\n", stderr: "" };
    };
    const result = run_cli("impact", ["Foo#bar", "--direction", "upstream"], tmp);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].cmd.slice(0, 2), ["/usr/bin/gitnexus", "impact"]);
    assert.equal(calls[0].cwd, tmp);
  });
});
