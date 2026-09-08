import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENTERPRISE_HTTP_SLOTS, format_slot_path, HttpSlotClient } from "../scripts/providers/http_slots.ts";

describe("enterprise HTTP slots", () => {
  it("registers all systems", () => {
    assert.deepEqual(new Set(Object.keys(ENTERPRISE_HTTP_SLOTS)), new Set(["plan", "testcase", "issues", "docs", "traces"]));
    assert.equal(ENTERPRISE_HTTP_SLOTS.plan.get_plan.path, "/v1/plans/{plan_id}");
    assert.equal(ENTERPRISE_HTTP_SLOTS.docs.fetch.path, "/v1/documents/{doc_id}");
  });

  it("overrides path and keeps default", () => {
    const client = new HttpSlotClient({
      base_url: "https://qa.example.com",
      paths: { get_plan: "/api/test-apply/{plan_id}" },
    });
    const [method, path] = client.resolve("plan", "get_plan", { plan_id: 1001, id: 1001 });
    assert.equal(method, "GET");
    assert.equal(path, "/api/test-apply/1001");
    const [, path2] = client.resolve("plan", "list_submitted_defects", { plan_id: 1001, id: 1001 });
    assert.equal(path2, "/v1/plans/1001/defects");
  });

  it("requires base_url", () => {
    assert.throws(() => new HttpSlotClient({ base_url: "", name: "plan.http" }), /base_url/);
  });

  it("encodes path segment", () => {
    assert.equal(format_slot_path("/v1/documents/{doc_id}", { doc_id: "a b" }), "/v1/documents/a%20b");
  });
});
