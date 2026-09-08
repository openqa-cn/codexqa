import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  _count_total_change_lines,
  _extract_changed_methods_from_diff,
  _parse_git_numstat,
} from "../scripts/cli_auto.ts";
import { astHooks, run_ast_scan } from "../scripts/ast.ts";

const JAVA = `package com.example;

public class Foo {
    public void alpha() {
        System.out.println("a");
    }

    public void beta() {
        System.out.println("b");
    }
}
`;

function git(repo: string, ...args: string[]) {
  const proc = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
}

function revParse(repo: string): string {
  const proc = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  return proc.stdout.trim();
}

describe("changed methods", () => {
  it("new file methods use PR base not last commit", () => {
    const repo = mkdtempSync(join(tmpdir(), "dd-cm-"));
    git(repo, "init");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "README"), "base\n", "utf8");
    git(repo, "add", "README");
    git(repo, "commit", "-m", "base");
    const base = revParse(repo);

    const src = join(repo, "src/main/java/com/example/Foo.java");
    mkdirSync(join(repo, "src/main/java/com/example"), { recursive: true });
    writeFileSync(src, JAVA, "utf8");
    git(repo, "add", "src/main/java/com/example/Foo.java");
    git(repo, "commit", "-m", "add Foo");

    writeFileSync(src, JAVA.replace('"a"', '"A"'), "utf8");
    git(repo, "add", "src/main/java/com/example/Foo.java");
    git(repo, "commit", "-m", "touch alpha");

    const methods = _extract_changed_methods_from_diff(
      repo,
      ["src/main/java/com/example/Foo.java"],
      base,
      "three-dot",
    );
    const names = new Set((methods["com/example/Foo"] || []).map((m: any) => m.methodName));
    assert.deepEqual(names, new Set(["alpha", "beta"]));
  });

  it("parse numstat sums additions and deletions", () => {
    assert.equal(_parse_git_numstat("1906\t0\ta.java\n0\t2\tb.java\n"), 1908);
  });

  it("parse numstat skips binary and junk", () => {
    assert.equal(_parse_git_numstat("-\t-\tlogo.png\n3\t1\tc.java\nnot-a-numstat-line\n"), 4);
  });

  it("count lines uses PR base not last commit", () => {
    const repo = mkdtempSync(join(tmpdir(), "dd-cl-"));
    git(repo, "init");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "README"), "base\n", "utf8");
    git(repo, "add", "README");
    git(repo, "commit", "-m", "base");
    const base = revParse(repo);

    const src = join(repo, "src/main/java/com/example/Foo.java");
    mkdirSync(join(repo, "src/main/java/com/example"), { recursive: true });
    writeFileSync(src, JAVA, "utf8");
    git(repo, "add", "src/main/java/com/example/Foo.java");
    git(repo, "commit", "-m", "add Foo");

    writeFileSync(src, readFileSync(src, "utf8").replace('System.out.println("b");', ""), "utf8");
    git(repo, "add", "src/main/java/com/example/Foo.java");
    git(repo, "commit", "-m", "tiny delete");

    const vsBase = _count_total_change_lines(repo, base, "three-dot");
    const vsLast = _count_total_change_lines(repo, "HEAD~1", "two-dot");
    assert.ok(vsBase > vsLast);
    assert.ok(vsBase >= 10);
    assert.ok(vsLast < 10);
    assert.equal(_count_total_change_lines(repo, null, "three-dot"), vsLast);
  });
});

describe("ast scan", () => {
  it("missing semgrep is not a clean zero hit", () => {
    const raw = mkdtempSync(join(tmpdir(), "dd-ast-"));
    writeFileSync(join(raw, "Foo.java"), "class Foo { void a() {} }\n", "utf8");
    const saved = astHooks.ensure_semgrep_installed;
    astHooks.ensure_semgrep_installed = () => false;
    try {
      const result = run_ast_scan(
        [{
          id: 1,
          category: 1,
          description: '{"semgrepYaml": "rules:\\n- id: x\\n  languages: [java]\\n  message: m\\n  severity: ERROR\\n  pattern: x\\n"}',
        }],
        raw,
        ["Foo.java"],
        null,
        "java",
      );
      assert.equal(result.scanOk, false);
      assert.equal(result.scannedFiles, 0);
      assert.ok(result.errors && result.errors.length);
    } finally {
      astHooks.ensure_semgrep_installed = saved;
    }
  });
});
