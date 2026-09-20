import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BINARY_NAME, PACKAGE_NAME, codexqaHooks, compact_node, ensure_binary, nodes_from_parsed } from "../scripts/ensure_codexqa.ts";
import { pick_symbol, query_names } from "../scripts/query_graph.ts";

const defaultWhich = codexqaHooks.which;
const defaultRun = codexqaHooks.run;

describe("ensure_binary", () => {
  beforeEach(() => {
    codexqaHooks.which = defaultWhich;
    codexqaHooks.run = defaultRun;
  });

  afterEach(() => {
    codexqaHooks.which = defaultWhich;
    codexqaHooks.run = defaultRun;
  });

  it("already installed skips install", () => {
    codexqaHooks.which = (name) => (name === BINARY_NAME ? "/usr/bin/codexqa" : defaultWhich(name));
    codexqaHooks.run = () => ({ returncode: 0, stdout: "codexqa 0.1.0\n", stderr: "" });
    const result = ensure_binary(false);
    assert.equal(result.ready, true);
    assert.equal(result.install, null);
    assert.equal(result.binary, "/usr/bin/codexqa");
  });

  it("missing then install success", () => {
    const tmp = mkdtempSync(join(tmpdir(), "diag-cq-"));
    const whichMap: Record<string, string | null> = { codexqa: null, npm: "/usr/bin/npm" };
    codexqaHooks.which = (name) => (name in whichMap ? whichMap[name] : defaultWhich(name));
    codexqaHooks.run = (cmd) => {
      if (cmd[0] === "/usr/bin/npm" && cmd[1] === "install") {
        assert.equal(cmd[3], PACKAGE_NAME);
        whichMap.codexqa = "/usr/bin/codexqa";
        return { returncode: 0, stdout: "ok", stderr: "" };
      }
      if (String(cmd[0]).endsWith("codexqa") && cmd.includes("--version")) {
        return { returncode: 0, stdout: "0.1.0", stderr: "" };
      }
      if (cmd[1] === "prefix") return { returncode: 0, stdout: tmp, stderr: "" };
      return { returncode: 0, stdout: "ok", stderr: "" };
    };
    const result = ensure_binary(false);
    assert.equal(result.ready, true);
    assert.equal(result.install?.ok, true);
    assert.equal(result.install?.manager, "npm");
  });

  it("npm missing returns not ready", () => {
    codexqaHooks.which = (name) => (name === "codexqa" || name === "npm" ? null : defaultWhich(name));
    const result = ensure_binary(false);
    assert.equal(result.ready, false);
    assert.match(result.error || "", /npm not found/);
  });
});

describe("query helpers", () => {
  it("nodes_from_parsed reads Nodes envelope", () => {
    const nodes = nodes_from_parsed({
      kind: "Nodes",
      nodes: [{ id: "1", name: "checkout", file_path: "OrderService.java", start_line: 40, end_line: 50 }],
    });
    assert.equal(nodes.length, 1);
    const compact = compact_node(nodes[0]);
    assert.equal(compact.file, "OrderService.java");
    assert.equal(compact.startLine, 40);
  });

  it("pick_symbol prefers method nodes over the enclosing class", () => {
    const picked = pick_symbol(
      [
        { id: "cls", kind: "class", name: "StacktraceDemo", file_path: "StacktraceDemo.java", start_line: 13, end_line: 102 },
        { id: "m", kind: "method", name: "acquireConnection", file_path: "StacktraceDemo.java", start_line: 71, end_line: 80 },
      ],
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
    );
    assert.equal(picked?.id, "m");
  });

  it("query_names prefers Class#method then a bare method fallback", () => {
    const names = query_names({
      raw: "at",
      language: "java",
      className: "AbstractUnFinishSearch",
      methodName: "query",
      file: "AbstractUnFinishSearch.java",
      line: 42,
      library: false,
      key: "AbstractUnFinishSearch#query",
      causeIndex: 0,
    });
    assert.equal(names[0], "AbstractUnFinishSearch#query");
    assert.ok(names.indexOf("query") > 0);
  });

  it("pick_symbol rejects a same-named method from another class", () => {
    const picked = pick_symbol(
      [
        {
          id: "proxy",
          kind: "method",
          name: "search",
          file_path: "DistributionTaskSearchProxy.java",
          start_line: 53,
          end_line: 63,
          qualifiedName: "com.sankuai.deliverywaybill.desp.rider.proxy::search",
        },
      ],
      {
        raw: "at",
        language: "java",
        className: "com.sankuai.deliverywaybill.desp.rider.thrift.ThriftServiceIfaceImpl",
        methodName: "search",
        file: "ThriftServiceIfaceImpl.java",
        line: 1,
        library: false,
        key: "ThriftServiceIfaceImpl#search",
        causeIndex: 0,
      },
    );
    assert.equal(picked, null);
  });

  it("pick_symbol keeps the stack method when the line sits in a sibling method", () => {
    const picked = pick_symbol(
      [
        {
          id: "filter",
          kind: "method",
          name: "filter",
          file_path: "AbstractSearcher.java",
          start_line: 171,
          end_line: 189,
        },
        {
          id: "search",
          kind: "method",
          name: "search",
          file_path: "AbstractSearcher.java",
          start_line: 205,
          end_line: 230,
        },
      ],
      {
        raw: "at",
        language: "java",
        className: "AbstractSearcher",
        methodName: "search",
        file: "AbstractSearcher.java",
        line: 173,
        library: false,
        key: "AbstractSearcher#search",
        causeIndex: 0,
      },
    );
    assert.equal(picked?.id, "search");
  });
});
