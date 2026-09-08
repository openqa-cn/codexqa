/**
 * Regressions found by running the skill against its own source tree:
 * - a write-back closed every plan item whose className shared a basename
 *   (providers/docs/http#constructor closed providers/traces/http#constructor)
 * - get_plan_gaps folded the same way, so close gates passed over pending units
 * - update_process injected only detectTier, leaving hard rules 21/22 inert
 * - fetch_document_body joined an unchecked filePath onto the clone directory
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ContentStore, matching_plan_units } from "../scripts/store.ts";
import { inject_plan_depth_fields } from "../scripts/platform.ts";
import { fetch_document_body } from "../scripts/ingest.ts";
import { reset_providers } from "../scripts/providers/registry.ts";

const DOCS_HTTP = "scripts/providers/docs/http";
const TRACES_HTTP = "scripts/providers/traces/http";

function planItem(className: string, extra: Record<string, any> = {}) {
  return {
    className,
    methodName: "constructor",
    strategyCode: 11,
    status: "pending",
    detectTier: "T3",
    ...extra,
  };
}

function writeback(className: string, extra: Record<string, any> = {}) {
  return {
    className,
    methodName: "constructor",
    strategyCode: 11,
    bugStatus: 2,
    writeMethod: "batch",
    ...extra,
  };
}

describe("self-scan: plan matching does not fold different paths onto a basename", () => {
  it("keeps same-named units in different directories apart", () => {
    const plan = [planItem(DOCS_HTTP), planItem(TRACES_HTTP)];
    assert.deepEqual(matching_plan_units(plan, writeback(DOCS_HTTP)), [plan[0]]);
    assert.deepEqual(matching_plan_units(plan, writeback(TRACES_HTTP)), [plan[1]]);
  });

  it("still matches a bare simple name against the one full path that carries it", () => {
    const plan = [planItem(DOCS_HTTP)];
    assert.deepEqual(matching_plan_units(plan, writeback("http")), [plan[0]]);
  });

  it("refuses an ambiguous simple name rather than closing the wrong unit", () => {
    const plan = [planItem(DOCS_HTTP), planItem(TRACES_HTTP)];
    assert.deepEqual(matching_plan_units(plan, writeback("http")), []);
  });

  it("a business write-back does not close a pending AST item on the same method", () => {
    const plan = [planItem(DOCS_HTTP, { strategyCode: 8 }), planItem(DOCS_HTTP)];
    assert.deepEqual(matching_plan_units(plan, writeback(DOCS_HTTP)), [plan[1]]);
  });
});

describe("self-scan: store gates honour the full className", () => {
  let dataDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "dd-self-"));
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

  it("writing one provider constructor leaves the other one a gap", () => {
    const store = new ContentStore(1);
    store.add_detection_plan_item(planItem(DOCS_HTTP));
    store.add_detection_plan_item(planItem(TRACES_HTTP));
    store.record_process_writeback(writeback(DOCS_HTTP));

    const gaps = store.get_plan_gaps();
    assert.deepEqual(gaps.map((g) => g.className), [TRACES_HTTP]);

    const plan = store.load_plan_only().detectionPlan;
    assert.equal(plan.find((p: any) => p.className === DOCS_HTTP).status, "written");
    assert.equal(plan.find((p: any) => p.className === TRACES_HTTP).status, "pending");
  });

  it("closes the gap once the second constructor is written too", () => {
    const store = new ContentStore(2);
    store.add_detection_plan_item(planItem(DOCS_HTTP));
    store.add_detection_plan_item(planItem(TRACES_HTTP));
    store.record_process_writeback(writeback(DOCS_HTTP));
    store.record_process_writeback(writeback(TRACES_HTTP));
    assert.deepEqual(store.get_plan_gaps(), []);
  });
});

describe("self-scan: write-back inherits the plan's depth fields", () => {
  let dataDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "dd-depth-"));
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

  function seedPlan(taskId: number) {
    const store = new ContentStore(taskId);
    store.add_detection_plan_item({
      className: "com/example/order/OrderService",
      methodName: "refund",
      strategyCode: 11,
      status: "pending",
      detectTier: "T2",
      minDetectLevel: "L2+TC",
      mode: "strict",
    });
    store.save();
    return store;
  }

  const request = (taskId: number, extra: Record<string, any> = {}) => ({
    taskId,
    className: "com/example/order/OrderService",
    methodName: "refund",
    strategyCode: 11,
    ...extra,
  });

  it("copies detectTier, minDetectLevel, mode and the context-read count", () => {
    seedPlan(3);
    const body = inject_plan_depth_fields(request(3));
    assert.equal(body.detectTier, "T2");
    assert.equal(body._minDetectLevel, "L2+TC");
    assert.equal(body._mode, "strict");
    assert.equal(body._contextReadsCount, 0);
  });

  it("counts distinct registered context reads for the class", () => {
    const store = seedPlan(4);
    store.add_context_read({
      className: "com/example/order/OrderService",
      filePath: "src/main/java/com/example/order/OrderDao.java",
      purpose: "callee",
    });
    store.add_context_read({
      className: "com/example/order/OrderService",
      filePath: "src/main/java/com/example/order/OrderController.java",
      purpose: "caller",
    });
    store.save();
    assert.equal(inject_plan_depth_fields(request(4))._contextReadsCount, 2);
  });

  it("never overrides a value the agent supplied", () => {
    seedPlan(5);
    const body = inject_plan_depth_fields(request(5, { detectTier: "T1", _mode: "light", _contextReadsCount: 9 }));
    assert.equal(body.detectTier, "T1");
    assert.equal(body._mode, "light");
    assert.equal(body._contextReadsCount, 9);
  });

  it("leaves the body alone when the method is not on the plan", () => {
    seedPlan(6);
    const body = inject_plan_depth_fields(request(6, { methodName: "unplanned" }));
    assert.equal(body._minDetectLevel, undefined);
    assert.equal(body._contextReadsCount, undefined);
  });
});

describe("self-scan: in-repo document reads stay inside the clone", () => {
  it("refuses a filePath that escapes the clone with parent-directory segments", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-doc-"));
    const clone = join(tmp, "repo");
    mkdirSync(join(clone, "docs"), { recursive: true });
    writeFileSync(join(tmp, "host-secret.txt"), "SECRET", "utf8");
    writeFileSync(join(clone, "docs", "rules.md"), "Refunds are capped at the original amount.", "utf8");

    const escaped = fetch_document_body({ filePath: "../host-secret.txt", repoSource: "local_repo" }, [clone]);
    assert.equal(escaped.fetchStatus, "failed");
    assert.equal(escaped.content, undefined);

    const inside = fetch_document_body({ filePath: "docs/rules.md", repoSource: "local_repo" }, [clone]);
    assert.equal(inside.fetchStatus, "success");
    assert.match(inside.content, /Refunds are capped/);
  });
});
