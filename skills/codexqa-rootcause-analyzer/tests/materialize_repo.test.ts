import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { collect_upload_bundle, is_git_repo, materialize_for_codexqa } from "../scripts/materialize_repo.ts";

describe("upload bundle for CodexQA", () => {
  it("includes uploaded file, stack sibling, and top-level sources only", () => {
    const origin = mkdtempSync(join(tmpdir(), "diag-origin-"));
    mkdirSync(join(origin, "nested-project"));
    writeFileSync(join(origin, "OrderService.java"), "class OrderService {}\n");
    writeFileSync(join(origin, "StacktraceDemo.java"), "class StacktraceDemo {}\n");
    writeFileSync(join(origin, "helper.py"), "def x():\n    return 1\n");
    writeFileSync(join(origin, "nested-project", "Other.java"), "class Other {}\n");

    const files = collect_upload_bundle({
      originDir: origin,
      uploadedFile: join(origin, "OrderService.java"),
      frames: [
        {
          raw: "at",
          language: "java",
          className: "StacktraceDemo",
          methodName: "acquireConnection",
          file: "StacktraceDemo.java",
          line: 74,
          library: false,
          key: "StacktraceDemo#acquireConnection",
          causeIndex: 0,
        },
      ],
    });
    const names = files.map((p) => p.split("/").pop());
    assert.ok(names.includes("OrderService.java"));
    assert.ok(names.includes("StacktraceDemo.java"));
    assert.ok(!names.includes("Other.java"));
    assert.ok(!names.includes("helper.py"));
  });

  it("git-inits only the task copy, never the origin", () => {
    const origin = mkdtempSync(join(tmpdir(), "diag-origin2-"));
    const dest = mkdtempSync(join(tmpdir(), "diag-dest-"));
    writeFileSync(join(origin, "Foo.java"), "class Foo { void bar() {} }\n");
    const result = materialize_for_codexqa({
      dest,
      originDir: origin,
      uploadedFile: join(origin, "Foo.java"),
      frames: [],
    });
    assert.equal(result.materialized, true);
    assert.equal(result.source, "materialized");
    assert.ok(is_git_repo(result.localDir));
    assert.equal(is_git_repo(origin), false);
    assert.ok(existsSync(join(dest, "Foo.java")));
  });
});
