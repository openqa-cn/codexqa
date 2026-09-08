import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContentStore,
  find_matching_writeback,
  writeback_identity_match,
  writeback_should_protect,
} from "../scripts/store.ts";

function row(partial: Record<string, any> = {}) {
  return {
    parentBatchId: 1,
    className: "com/example/PaymentType",
    methodName: "getByCode",
    strategyCode: 11,
    bugStatus: 6,
    writeMethod: "update-process",
    ...partial,
  };
}

describe("writeback last-write-wins protect", () => {
  const prevContent = process.env.CONTENT_JSON_BASE;
  const prevData = process.env.DETECTION_DATA_DIR;

  before(() => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-wb-"));
    process.env.CONTENT_JSON_BASE = join(tmp, "content");
    process.env.DETECTION_DATA_DIR = join(tmp, "data");
  });

  after(() => {
    if (prevContent === undefined) delete process.env.CONTENT_JSON_BASE;
    else process.env.CONTENT_JSON_BASE = prevContent;
    if (prevData === undefined) delete process.env.DETECTION_DATA_DIR;
    else process.env.DETECTION_DATA_DIR = prevData;
  });

  it("treats short className and FQCN as the same write-back key", () => {
    assert.equal(
      writeback_identity_match(
        row({ className: "com/example/PaymentType" }),
        row({ className: "PaymentType" }),
      ),
      true,
    );
    assert.equal(
      writeback_identity_match(
        row({ className: "com/example/PaymentType" }),
        row({ className: "com/other/PaymentType" }),
      ),
      false,
    );
  });

  it("protects a confirmed defect from a later no-defect write", () => {
    assert.equal(writeback_should_protect(row({ bugStatus: 6 }), row({ bugStatus: 2 })), true);
    assert.equal(writeback_should_protect(row({ bugStatus: 7 }), row({ bugStatus: 2 })), true);
    assert.equal(writeback_should_protect(row({ bugStatus: 2 }), row({ bugStatus: 6 })), false);
    assert.equal(writeback_should_protect(row({ bugStatus: 6 }), row({ bugStatus: 7 })), false);
  });

  it("keeps bugStatus=6 when a later batch writes bugStatus=2 for the same method", () => {
    const store = new ContentStore(87401);
    const first = store.record_process_writeback(row({ bugStatus: 6, methodName: "getByCode" }));
    assert.equal(first.status, "inserted");

    const second = store.record_process_writeback(row({
      bugStatus: 2,
      methodName: "getByCode",
      writeMethod: "batch-update-process",
    }));
    assert.equal(second.status, "protected");
    assert.equal(second.existingBugStatus, 6);

    const kept = find_matching_writeback(store.load_writebacks_only().processWritebacks, row());
    assert.ok(kept);
    assert.equal(kept.bugStatus, 6);
    assert.match(String(kept.errorInfo || ""), /protected/);
  });

  it("protects FQCN defect from a short-name no-defect overwrite", () => {
    const store = new ContentStore(87402);
    store.record_process_writeback(row({
      className: "com/example/checkout/PricingAdaptor",
      methodName: "doQueryPrice",
      bugStatus: 6,
    }));
    const rec = store.record_process_writeback(row({
      className: "PricingAdaptor",
      methodName: "doQueryPrice",
      bugStatus: 2,
    }));
    assert.equal(rec.status, "protected");
    const kept = store.load_writebacks_only().processWritebacks[0];
    assert.equal(kept.bugStatus, 6);
    assert.equal(kept.methodName, "doQueryPrice");
  });

  it("allows upgrade from no-defect to defect and 6→7", () => {
    const store = new ContentStore(87403);
    store.record_process_writeback(row({ bugStatus: 2, methodName: "handle" }));
    const upgraded = store.record_process_writeback(row({ bugStatus: 6, methodName: "handle" }));
    assert.equal(upgraded.status, "updated");
    assert.equal(store.load_writebacks_only().processWritebacks[0].bugStatus, 6);

    const to7 = store.record_process_writeback(row({ bugStatus: 7, methodName: "handle" }));
    assert.equal(to7.status, "updated");
    assert.equal(store.load_writebacks_only().processWritebacks[0].bugStatus, 7);
  });
});
