import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LocalPlatformProvider } from "../providers/platform/local.ts";
import { flatten_tag_ids } from "../providers/platform/seed_catalog.ts";
import { render_report_html } from "../providers/platform/report_html.ts";
import { LocalPlanProvider } from "../providers/plan/local.ts";
import { LocalTestCaseProvider } from "../providers/testcase/local.ts";
import { LocalDocProvider } from "../providers/docs/local.ts";
import { LocalIssueProvider } from "../providers/issues/local.ts";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("LocalPlatformProvider", () => {
  let platform: LocalPlatformProvider;

  beforeEach(() => {
    platform = new LocalPlatformProvider(mkdtempSync(join(tmpdir(), "dd-plat-")));
  });

  it("runs task lifecycle", () => {
    const created = platform.submit_detection({
      detectType: "GIT_BRANCH",
      git: "git@github.com:acme/order-service.git",
      developBranch: "feature/demo",
      submitUser: "alice",
    });
    assert.equal(created.code, 0);
    const taskId = created.data.taskId;
    const batchId = created.data.batchIds[0];
    assert.equal(platform.get_task_status(taskId).data.status, "in_progress");

    const written = platform.update_process({
      taskId,
      parentBatchId: batchId,
      className: "com/example/order/OrderService",
      methodName: "checkout",
      strategyCode: 11,
      bugStatus: 6,
      thinking: "amount <= 0 is not rejected",
      content: "Defect: Negative amount\nLines: 10-20",
      detectTier: "T1",
    });
    assert.equal(written.code, 0);
    assert.ok(written.data.processId);

    const rank = platform.finalize_rank({
      taskId,
      parentBatchId: batchId,
      className: "com/example/order/OrderService",
      methodName: "checkout",
      bugStatus: 6,
      content: "Defect: Negative amount\nLines: 10-20",
    });
    assert.equal(rank.code, 0);
    assert.equal(platform.check_detection_coverage(batchId).data.allCompleted, true);
    assert.equal(platform.check_rank_integrity(batchId).data.allConsistent, true);

    const tags = platform.get_tag_list();
    const catalogIds = flatten_tag_ids(tags.data);
    assert.ok(catalogIds.includes(6));
    assert.ok(catalogIds.includes(61));
    assert.ok(catalogIds.includes(104));
    assert.ok(!catalogIds.includes(243));

    const report = platform.get_report(taskId);
    assert.equal(report.data.defects.length, 1);
    assert.match(report.data.reportUrl, /^file:\/\//);
    const htmlPath = decodeURIComponent(new URL(report.data.reportUrl).pathname);
    assert.ok(existsSync(htmlPath));
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /Findings/);
    assert.match(html, /Negative amount/);

    assert.equal(platform.complete_task(taskId).data.status, "completed");
    assert.equal(platform.mark_bug({ rankId: rank.data.rankId, bugStatus: 3 }).code, 0);
    assert.ok(platform.get_confirmed_defect_history({ git: null }).data.length >= 1);
  });

  it("keeps warning heading in HTML", () => {
    const html = render_report_html({
      taskId: 9,
      planName: "heading check",
      status: "completed",
      summary: "📋[Requirement changes] Change description    ⚠️[Risks] One risk    ✅[Conclusion] No defect in this code",
    }, []);
    assert.match(html, /⚠️\[Risks\]/);
    assert.ok(!html.includes(">️[Risks]"));
    assert.match(html, /id="sec-risks"/);
    assert.match(html, /class="skip-link"/);
  });
});

describe("enterprise fixtures", () => {
  it("reads plan 1001 and sample case/doc/issue", () => {
    const plan = new LocalPlanProvider(join(ROOT, "enterprise")).get_plan(1001, 2);
    assert.equal(plan.code, 0);
    assert.equal(plan.data.planId, 1001);
    const tc = new LocalTestCaseProvider(join(ROOT, "enterprise")).get_case("TC-1001");
    assert.equal(tc.fetchStatus, "success");
    const doc = new LocalDocProvider(join(ROOT, "enterprise")).fetch("checkout-rules.md");
    assert.equal(doc.fetchStatus, "success");
    const issue = new LocalIssueProvider(join(ROOT, "enterprise")).get_issue("42");
    assert.ok(issue.id === 42 || issue.id === "42" || issue.title);
  });
});
