import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  class_names_match,
  has_code_been_read,
  register_code_read,
  simple_class_name,
} from "../open_state.ts";
import { context_read_min, validate_update_process } from "../open_validate.ts";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "open_detect.ts");

function isolatedEnv() {
  const tmp = mkdtempSync(join(tmpdir(), "dd-cr-"));
  process.env.DETECTION_DATA_DIR = join(tmp, "data");
  process.env.CONTENT_JSON_BASE = join(tmp, "content");
  return tmp;
}

describe("class_names_match", () => {
  it("matches slash and dot FQCN, and short name vs full path", () => {
    assert.equal(
      class_names_match(
        "com/sankuai/meituan/banma/staff/rider/securitycode/biz/SecurityCodeBiz",
        "com.sankuai.meituan.banma.staff.rider.securitycode.biz.SecurityCodeBiz",
      ),
      true,
    );
    assert.equal(
      class_names_match(
        "SecurityCodeBiz",
        "com/sankuai/meituan/banma/staff/rider/securitycode/biz/SecurityCodeBiz",
      ),
      true,
    );
    assert.equal(
      class_names_match(
        "com/sankuai/meituan/banma/staff/rider/securitycode/biz/SecurityCodeBiz",
        "SecurityCodeBiz",
      ),
      true,
    );
    assert.equal(simple_class_name("com.example.order.OrderService"), "OrderService");
  });

  it("does not match different packages that only share a simple name", () => {
    assert.equal(
      class_names_match("com/example/order/OrderService", "com/example/pay/OrderService"),
      false,
    );
    assert.equal(class_names_match("SecurityCodeBiz", "RiderBiz"), false);
    assert.equal(class_names_match("OrderService", "Order.tsx"), false);
  });
});

describe("code-read gate className formats", () => {
  it("has_code_been_read accepts the write-back FQCN after a short-name registration", () => {
    isolatedEnv();
    const taskId = 91001;
    const batchId = 91001;
    const full = "com/sankuai/meituan/banma/staff/rider/securitycode/biz/SecurityCodeBiz";
    register_code_read(taskId, batchId, "SecurityCodeBiz", "src/main/java/" + full + ".java", "public class SecurityCodeBiz {}");

    assert.equal(has_code_been_read(batchId, "SecurityCodeBiz", taskId), true);
    assert.equal(has_code_been_read(batchId, full, taskId), true);
    assert.equal(
      has_code_been_read(batchId, "com.sankuai.meituan.banma.staff.rider.securitycode.biz.SecurityCodeBiz", taskId),
      true,
    );
    assert.equal(has_code_been_read(batchId, "com/example/other/SecurityCodeBiz", taskId), true, "short registration matches any FQCN with that simple name");
    assert.equal(has_code_been_read(batchId, "RiderBiz", taskId), false);
  });

  it("has_code_been_read accepts a short write-back name after an FQCN registration", () => {
    isolatedEnv();
    const taskId = 91002;
    const batchId = 91002;
    const full = "com/example/order/OrderService";
    register_code_read(taskId, batchId, full, "src/main/java/com/example/order/OrderService.java", "public class OrderService {}");

    assert.equal(has_code_been_read(batchId, "OrderService", taskId), true);
    assert.equal(has_code_been_read(batchId, "com.example.order.OrderService", taskId), true);
    // Querying the short alias must not cache it; a different package must still miss.
    assert.equal(has_code_been_read(batchId, "com/example/pay/OrderService", taskId), false);
    assert.equal(has_code_been_read(batchId, "com.example.pay.OrderService", taskId), false);
  });

  it("Hard rule14 accepts a write-back FQCN after CLI registered the short class name", () => {
    const tmp = isolatedEnv();
    const env = {
      ...process.env,
      DETECTION_DATA_DIR: join(tmp, "data"),
      CONTENT_JSON_BASE: join(tmp, "content"),
    };
    const taskId = 91003;
    const batchId = 1;
    const shortName = "SecurityCodeBiz";
    const full = "com/sankuai/meituan/banma/staff/rider/securitycode/biz/SecurityCodeBiz";
    const proc = spawnSync(
      process.execPath,
      [
        CLI,
        "register-code-read",
        "--task-id",
        String(taskId),
        "--batch-id",
        String(batchId),
        "--class-name",
        shortName,
        "--file-path",
        `src/main/java/${full}.java`,
        "--code-snippet",
        "public class SecurityCodeBiz { public void handle() {} }",
      ],
      { cwd: dirname(CLI), env, encoding: "utf8" },
    );
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);

    assert.equal(has_code_been_read(batchId, full, taskId), true);
    assert.equal(has_code_been_read(String(batchId) as any, full, taskId), true);

    const gate = validate_update_process(
      {
        detectTier: "T3",
        thinking: "方法体 L271 handle：requiredType==1 走查询。判定无缺陷。 Call chain: Iface#get → SecurityCodeBiz#handle",
        processSteps: [{ stepName: "first_round_detection", stepStatus: "executed", conclusion: "ok" }],
        bugStatus: 2,
        strategyCode: 11,
        className: full,
        methodName: "handle",
        parentBatchId: batchId,
        taskId,
        content: "No defect in this code",
        fileCodes: [
          {
            filePath: `src/main/java/${full}.java`,
            methodNames: ["handle"],
            git: "git@example.com:acme/staff.git",
            branch: "feature/x",
            commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        ],
      },
      taskId,
    );
    assert.ok(!gate || !String(gate).includes("Hard rule14"), String(gate));
  });
});

describe("T3 context-read exemption", () => {
  it("Hard rule22 skips T3 even when _contextReadsCount is 0", () => {
    assert.equal(context_read_min("T3", false), null);
    assert.equal(context_read_min("T2", false), 1);
    assert.equal(context_read_min("T1", false), 2);
    assert.equal(context_read_min("T1", true), 1);

    const err = validate_update_process(
      {
        detectTier: "T3",
        thinking: "方法体 L1 getName：return name。判定无缺陷。 Call chain: OrderService#getName",
        processSteps: [{
          stepName: "first_round_detection",
          stepStatus: "executed",
          conclusion: "getter only",
          question: "Is getName a trivial accessor?",
          referencedSources: [{ sourceType: "tech_doc", sourceId: "trivial-method-filter", sourceName: "Local pre-filter" }],
        }],
        bugStatus: 2,
        strategyCode: 11,
        className: "com/example/order/OrderService",
        methodName: "getName",
        content: "No defect in this code Call chain: OrderService#getName",
        fileCodes: [{
          filePath: "src/main/java/com/example/order/OrderService.java",
          methodNames: ["getName"],
          git: "git@example.com:acme/order.git",
          branch: "feature/x",
          commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }],
        _contextReadsCount: 0,
      },
    );
    assert.ok(!err || !String(err).includes("Hard rule22"), String(err));
  });

  it("Hard rule22 still blocks T1 with zero context reads", () => {
    const err = validate_update_process(
      {
        detectTier: "T1",
        thinking: "Walk the call chain OrderController#create → OrderService#checkout and check nulls. Call chain: OrderController#create→OrderService#checkout",
        processSteps: [{
          stepName: "first_round_detection",
          stepStatus: "executed",
          conclusion: "needs more context",
          question: "Does checkout null-check map.get(id)?",
          referencedSources: [{ sourceType: "tech_doc", sourceId: "DOC-1", sourceName: "Checkout rules" }],
        }],
        bugStatus: 2,
        strategyCode: 11,
        className: "com/example/order/OrderService",
        methodName: "checkout",
        content: "No defect in this code Call chain: OrderController#create→OrderService#checkout",
        fileCodes: [{
          filePath: "src/main/java/com/example/order/OrderService.java",
          methodNames: ["checkout"],
          git: "git@example.com:acme/order.git",
          branch: "feature/x",
          commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }],
        _contextReadsCount: 0,
      },
    );
    assert.ok(err && String(err).includes("Hard rule22"), String(err));
  });
});
