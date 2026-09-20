import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BINARY_NAME, codexqaHooks } from "../scripts/ensure_codexqa.ts";
import { parse_exception } from "../scripts/parse_exception.ts";
import { analyze_frames, call_path_text, expand_class_suffix_names } from "../scripts/query_graph.ts";
import { read_json } from "../scripts/store.ts";

const defaultWhich = codexqaHooks.which;
const defaultRun = codexqaHooks.run;

const JAVA = `java.lang.NullPointerException: order is null
	at com.example.order.OrderService.checkout(OrderService.java:42)
`;

describe("analyze_frames mocked CodexQA", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "diag-an-"));
    saved.DIAGNOSE_DATA_DIR = process.env.DIAGNOSE_DATA_DIR;
    process.env.DIAGNOSE_DATA_DIR = tmp;
    mkdirSync(join(tmp, "1", "codexqa"), { recursive: true });
    writeFileSync(join(tmp, "repo.java"), "class OrderService {}\n");
    codexqaHooks.which = (name) => (name === BINARY_NAME ? "/usr/bin/codexqa" : defaultWhich(name));
    codexqaHooks.run = (cmd) => {
      const joined = cmd.join(" ");
      if (joined.includes("symbols")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Nodes",
            nodes: [
              {
                id: "n1",
                name: "checkout",
                file_path: "OrderService.java",
                start_line: 40,
                end_line: 50,
                qualifiedName: "com.example.order.OrderService",
              },
            ],
          }),
          stderr: "",
        };
      }
      if (joined.includes("edges")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Edges",
            edges: [{ from_id: "n0", to_id: "n1", kind: "call", from_file: "OrderController.java", to_file: "OrderService.java" }],
          }),
          stderr: "",
        };
      }
      if (joined.includes("reach")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "GraphReach",
            result: {
              root: { id: "n1", name: "checkout", start_line: 40 },
              hops: [
                [
                  { id: "n0", name: "create", start_line: 18, qualifiedName: "OrderController", file_path: "src/main/java/OrderController.java" },
                  { id: "nt", name: "testCheckout", start_line: 10, qualifiedName: "OrderServiceTest", file_path: "src/test/java/OrderServiceTest.java" },
                ],
              ],
              edges: [],
              actual_depth: 1,
            },
          }),
          stderr: "",
        };
      }
      if (joined.includes("source")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Source",
            text: "void checkout(Order o) { o.id(); }",
            start_line: 40,
            end_line: 50,
          }),
          stderr: "",
        };
      }
      if (joined.includes("summary") || joined.includes("stats") || joined.includes("files")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Summary",
            files_total: 1,
            nodes_total: 2,
            edges_total: 1,
            lang_stats: { java: 1 },
            files: ["OrderService.java"],
          }),
          stderr: "",
        };
      }
      return { returncode: 0, stdout: "{}", stderr: "" };
    };
  });

  afterEach(() => {
    codexqaHooks.which = defaultWhich;
    codexqaHooks.run = defaultRun;
    if (saved.DIAGNOSE_DATA_DIR === undefined) delete process.env.DIAGNOSE_DATA_DIR;
    else process.env.DIAGNOSE_DATA_DIR = saved.DIAGNOSE_DATA_DIR;
  });

  it("writes methods slice from query envelopes", async () => {
    const parsed = parse_exception(JAVA);
    const analysis = await analyze_frames(1, tmp, parsed, true);
    assert.equal(analysis.ready, true);
    assert.ok(analysis.methods["OrderService#checkout"]);
    assert.equal(analysis.methods["OrderService#checkout"].node.id, "n1");
    assert.equal(analysis.methods["OrderService#checkout"].source.startLine, 40);
    assert.equal(analysis.frameSlices, undefined);
    const disk = read_json(join(tmp, "1", "codexqa", "analysis.json"));
    assert.equal(disk.methods["OrderService#checkout"].node.name, "checkout");
    assert.equal(disk.frameSlices, undefined);
    assert.deepEqual(disk.repo.files, []);
    assert.ok(disk.methods["OrderService#checkout"].callPath);
    assert.equal((disk.methods["OrderService#checkout"].callPath.match(/→/g) || []).length, 1);
    assert.equal(
      (disk.methods["OrderService#checkout"].callers || []).some((c: any) => c.name === "checkout"),
      false,
    );
    const callerFiles = (disk.methods["OrderService#checkout"].callers || []).map((c: any) => String(c.file || ""));
    assert.equal(callerFiles.some((f: string) => f.includes("/src/test/")), false);
    assert.ok(Array.isArray(disk.brief));
    assert.equal(disk.brief[0].key, "OrderService#checkout");
    assert.ok(disk.brief[0].callPath);
    const briefDisk = read_json(join(tmp, "1", "codexqa", "brief.json"));
    assert.equal(briefDisk[0].key, "OrderService#checkout");
    const hop = (disk.methods["OrderService#checkout"].callers || [])[0];
    if (hop) {
      assert.equal(hop.id, undefined);
      assert.ok(hop.name);
    }
  });

  it("does not chain sibling callers into a fake path", () => {
    const path = call_path_text(
      {
        node: { id: "n1", name: "getByRiderIdAndStatus", qualifiedName: "query::getByRiderIdAndStatus", startLine: 94 },
        callers: [
          { id: "n1", name: "getByRiderIdAndStatus", qualifiedName: "query::getByRiderIdAndStatus", startLine: 94, kind: "method" },
          { id: "a", name: "query", qualifiedName: "preOperate::query", startLine: 71, kind: "method", file: "RiderPreArriveSearcher.java" },
          { id: "b", name: "query", qualifiedName: "unfinish::query", startLine: 40, kind: "method", file: "AbstractUnFinishSearch.java" },
        ],
      },
      ["AbstractUnFinishSearch"],
    );
    assert.equal(path, "unfinish::query(L40)→query::getByRiderIdAndStatus(L94)");
  });

  it("does not treat Searcher class names as a search-method hint", () => {
    const path = call_path_text(
      {
        node: { id: "n2", name: "query", qualifiedName: "unfinish::query", startLine: 40 },
        callers: [
          {
            id: "a",
            name: "query",
            qualifiedName: "unfinish::query",
            startLine: 55,
            kind: "method",
            file: "RiderUnFinishSearcher.java",
          },
          {
            id: "b",
            name: "search",
            qualifiedName: "search::search",
            startLine: 205,
            kind: "method",
            file: "AbstractSearcher.java",
          },
        ],
      },
      ["search", "AbstractSearcher"],
    );
    assert.equal(path, "search::search(L205)→unfinish::query(L40)");
  });

  it("falls back to class node when method is missing instead of grepping", async () => {
    const inner = codexqaHooks.run;
    codexqaHooks.run = (cmd) => {
      const joined = cmd.join(" ");
      if (joined.includes("symbols") && joined.includes("RiderDistributionTaskSearchService#lookupTasks")) {
        return { returncode: 0, stdout: JSON.stringify({ kind: "Nodes", nodes: [] }), stderr: "" };
      }
      if (joined.includes("symbols") && joined.includes("--name") && joined.endsWith("lookupTasks")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Nodes",
            nodes: [
              {
                id: "other",
                kind: "method",
                name: "lookupTasks",
                file_path: "OtherSearcher.java",
                start_line: 1,
                end_line: 2,
              },
            ],
          }),
          stderr: "",
        };
      }
      if (joined.includes("symbols")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Nodes",
            nodes: [
              {
                id: "cls",
                kind: "class",
                name: "RiderDistributionTaskSearchService",
                qualifiedName: "com.sankuai.deliverywaybill.desp.rider.service::RiderDistributionTaskSearchService",
                file_path:
                  "banma_service_desp_rider-server/src/main/java/com/sankuai/deliverywaybill/desp/rider/service/RiderDistributionTaskSearchService.java",
                start_line: 70,
                end_line: 629,
              },
            ],
          }),
          stderr: "",
        };
      }
      return inner(cmd);
    };
    const parsed = parse_exception(`java.sql.SQLException: deadlock
	at com.sankuai.deliverywaybill.desp.rider.service.RiderDistributionTaskSearchService.lookupTasks(RiderDistributionTaskSearchService.java:88)
`);
    const analysis = await analyze_frames(1, tmp, parsed, true);
    const slice = analysis.methods["RiderDistributionTaskSearchService#lookupTasks"];
    assert.equal(slice.weak, true);
    assert.equal(slice.node.kind, "class");
    assert.equal(slice.grep, undefined);
  });

  it("expands abbreviated class-only suffix to the hinted impl", async () => {
    mkdirSync(join(tmp, "src", "main", "java"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "main", "java", "RiderDistributionTaskThriftServiceIfaceImpl.java"),
      "public class RiderDistributionTaskThriftServiceIfaceImpl {}\n",
    );
    writeFileSync(
      join(tmp, "src", "main", "java", "RiderWorkStepThriftServiceIfaceImpl.java"),
      "public class RiderWorkStepThriftServiceIfaceImpl {}\n",
    );
    const inner = codexqaHooks.run;
    codexqaHooks.run = (cmd) => {
      const joined = cmd.join(" ");
      if (joined.includes("symbols") && joined.includes("RiderDistributionTaskThriftServiceIfaceImpl")) {
        return {
          returncode: 0,
          stdout: JSON.stringify({
            kind: "Nodes",
            nodes: [
              {
                id: "thrift",
                kind: "class",
                name: "RiderDistributionTaskThriftServiceIfaceImpl",
                file_path: "src/main/java/RiderDistributionTaskThriftServiceIfaceImpl.java",
                start_line: 1,
                end_line: 10,
              },
            ],
          }),
          stderr: "",
        };
      }
      if (joined.includes("symbols") && joined.includes("ThriftServiceIfaceImpl")) {
        return { returncode: 0, stdout: JSON.stringify({ kind: "Nodes", nodes: [] }), stderr: "" };
      }
      return inner(cmd);
    };
    const expanded = expand_class_suffix_names(tmp, {
      raw: "→ ThriftServiceIfaceImpl",
      language: "java",
      className: "ThriftServiceIfaceImpl",
      methodName: null,
      file: "ThriftServiceIfaceImpl.java",
      line: null,
      library: false,
      key: "ThriftServiceIfaceImpl",
      causeIndex: 0,
    }, ["RiderDistributionTaskSearchService"]);
    assert.equal(expanded[0], "RiderDistributionTaskThriftServiceIfaceImpl");
    const parsed = parse_exception(`java.sql.SQLException: deadlock
	at com.sankuai.deliverywaybill.desp.rider.service.query.BmWaybillService.getByRiderIdAndStatus(BmWaybillService.java:70)
	... (后续同上 → RiderDistributionTaskSearchService → ThriftServiceIfaceImpl)
`);
    const analysis = await analyze_frames(1, tmp, parsed, true);
    const slice = analysis.methods["ThriftServiceIfaceImpl"];
    assert.equal(slice.node.name, "RiderDistributionTaskThriftServiceIfaceImpl");
    assert.equal(slice.weak, true);
  });

  it("degrades to grep when ready=false", async () => {
    const parsed = parse_exception(JAVA);
    const analysis = await analyze_frames(1, tmp, parsed, false);
    assert.equal(analysis.ready, false);
    const slice = analysis.methods["OrderService#checkout"];
    assert.equal(slice.weak, true);
    assert.ok(slice.grep);
  });
});
