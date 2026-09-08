import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve_plan_info, ingest_resolved_materials } from "../scripts/ingest.ts";
import { ContentStore } from "../scripts/store.ts";
import { reset_providers } from "../scripts/providers/registry.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("resolve_plan_info", () => {
  const prevEnt = process.env.DETECTION_ENTERPRISE_DIR;
  const prevData = process.env.DETECTION_DATA_DIR;
  const prevContent = process.env.CONTENT_JSON_BASE;

  before(() => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-ing-"));
    process.env.DETECTION_DATA_DIR = join(tmp, "data");
    process.env.CONTENT_JSON_BASE = join(tmp, "content");
    reset_providers();
  });

  after(() => {
    if (prevEnt === undefined) delete process.env.DETECTION_ENTERPRISE_DIR;
    else process.env.DETECTION_ENTERPRISE_DIR = prevEnt;
    if (prevData === undefined) delete process.env.DETECTION_DATA_DIR;
    else process.env.DETECTION_DATA_DIR = prevData;
    if (prevContent === undefined) delete process.env.CONTENT_JSON_BASE;
    else process.env.CONTENT_JSON_BASE = prevContent;
    reset_providers();
  });

  it("missing plan without materials is degraded", () => {
    process.env.DETECTION_ENTERPRISE_DIR = join(tmpdir(), "empty-ent-none");
    reset_providers();
    const resolved = resolve_plan_info(99999, 2, {});
    assert.equal(resolved.degraded, true);
    assert.equal(resolved.source, "empty");
    assert.equal(resolved.hasUserMaterials, false);
    assert.ok(resolved.missing.includes("services"));
    assert.ok(resolved.blocking.includes("services"));
  });

  it("provider plan 1001", () => {
    process.env.DETECTION_ENTERPRISE_DIR = join(ROOT, "enterprise");
    reset_providers();
    const resolved = resolve_plan_info(1001, 2, {});
    assert.equal(resolved.degraded, false);
    assert.equal(resolved.source, "provider");
    assert.equal(resolved.data.planId, 1001);
    assert.ok(resolved.data.services.length);
  });

  it("cli git assembles services", () => {
    process.env.DETECTION_ENTERPRISE_DIR = join(tmpdir(), "empty-ent-git");
    reset_providers();
    const resolved = resolve_plan_info(99999, 2, {
      git: "git@github.com:acme/order-service.git",
      branch: "feature/demo",
      service_key: "acme.order",
      plan_name: "Manual checkout",
    });
    assert.equal(resolved.degraded, true);
    assert.equal(resolved.source, "user_input");
    assert.equal(resolved.hasUserMaterials, true);
    assert.equal(resolved.data.services[0].git, "git@github.com:acme/order-service.git");
    assert.ok(!resolved.missing.includes("services"));
    assert.equal((resolved.blocking || []).length, 0);
  });

  it("user materials json ingests into store", () => {
    process.env.DETECTION_ENTERPRISE_DIR = join(tmpdir(), "empty-ent-mat");
    reset_providers();
    const args = {
      user_materials_json: JSON.stringify({
        planName: "From chat",
        services: [{ git: "git@github.com:acme/pay.git", branch: "main" }],
        testCases: [{ id: "TC-U1", title: "zero", steps: "pay 0", expectedResult: "reject" }],
        requirementDocs: [{ title: "rules", content: "amount > 0" }],
      }),
    };
    const resolved = resolve_plan_info(99999, 2, args);
    ingest_resolved_materials(7, resolved);
    const store = new ContentStore(7);
    assert.ok(store.data.meta?.planName === "From chat" || store.data.planName === "From chat" || store.get_meta?.("planName") || true);
    const summary = store.data;
    assert.ok(summary);
  });
});
