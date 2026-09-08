#!/usr/bin/env node
/**
 * User-journey suite for the generic skill contract in SKILL.md.
 * Domain nouns live in a temp fixture slot, not in the skill runtime.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type RunResult = { code: number; stdout: string; stderr: string };
export type JourneyResult = {
  id: string;
  command: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
};

const results: JourneyResult[] = [];
const work = mkdtempSync(join(tmpdir(), "dgs-journey-"));
const fixtureRoot = join(work, "slots");
const recordSlot = join(fixtureRoot, "record");
const openapiDir = join(recordSlot, "assets", "openapi");
const materials = join(work, "cases");
mkdirSync(join(recordSlot, "scripts", "executors"), { recursive: true });
mkdirSync(openapiDir, { recursive: true });
mkdirSync(materials, { recursive: true });
mkdirSync(join(work, "tools"), { recursive: true });

const configPath = join(work, "config.yaml");
writeFileSync(
  configPath,
  [
    "workspace:",
    "  testdata_dir: ./testdata",
    "  slot_roots:",
    `    - ${fixtureRoot}`,
    "adapters:",
    "  skill_marketplace:",
    "    type: local",
    "    paths:",
    `      - ${fixtureRoot}`,
    "  tool_registry:",
    "    type: local",
    `    path: ${join(work, "tools")}`,
    "  experience_store:",
    "    type: local",
    `    path: ${join(work, "experience")}`,
    "  api_catalog:",
    "    type: local",
    `    openapi_dir: ${openapiDir}`,
    "  data_store:",
    "    type: none",
    "  config_store:",
    "    type: file",
    `    path: ${join(work, "config-store.yaml")}`,
    "  feature_flags:",
    "    type: noop",
    "",
  ].join("\n"),
  "utf8",
);

const isolatedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATA_GENERATE_SKILL_DIR: TS_ROOT,
  DATA_GENERATE_SKILLS_ROOT: work,
  DATA_BUILD_CONFIG: configPath,
  DATA_BUILD_FAVORITES_PATH: join(work, "favorites.json"),
  DATA_BUILD_SCRIPT_ROOTS: work,
};

function run(script: string, args: string[], env: NodeJS.ProcessEnv = isolatedEnv): RunResult {
  const file = script.startsWith("/") ? script : join(TS_ROOT, script);
  const got = spawnSync(process.execPath, [file, ...args], {
    cwd: TS_ROOT,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    code: got.status ?? (got.error ? 1 : 0),
    stdout: got.stdout || "",
    stderr: (got.stderr || "") + (got.error ? `\n${got.error.message}` : ""),
  };
}

function parseJson(text: string): Json | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as Json;
  } catch {
    const start = trimmed.indexOf("{");
    const arr = trimmed.indexOf("[");
    const idx = start >= 0 && (arr < 0 || start < arr) ? start : arr;
    if (idx < 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(idx)) as Json;
    } catch {
      return undefined;
    }
  }
}

function isObj(v: unknown): v is JsonObject {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function record(id: string, command: string, expected: string, ok: boolean, actual: string): void {
  results.push({ id, command, expected, actual, status: ok ? "PASS" : "FAIL" });
  if (!ok) process.stderr.write(`FAIL ${id}: ${actual}\n`);
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(fn: () => Promise<boolean> | boolean, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await waitFor(100);
  }
  return false;
}

function execJson(env: NodeJS.ProcessEnv, rel: string, params: JsonObject): JsonObject {
  const got = run(rel, ["--json", JSON.stringify(params)], env);
  const json = parseJson(got.stdout);
  return isObj(json) ? json : { success: false, error: got.stderr || got.stdout, exit: got.code };
}

function writeFixture(): void {
  writeFileSync(
    join(openapiDir, "record.yaml"),
    [
      "openapi: 3.0.3",
      "info:",
      "  title: Record",
      '  version: "1.0.0"',
      "paths:",
      "  /v1/records:",
      "    post:",
      "      operationId: createRecord",
      "      summary: Create a record",
      "      responses:",
      '        "200":',
      "          description: ok",
      "  /v1/records/{recordId}/close:",
      "    post:",
      "      operationId: closeRecord",
      "      summary: Close a record",
      "      responses:",
      '        "200":',
      "          description: ok",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(recordSlot, "slot.yaml"),
    [
      "name: record",
      "domain: record",
      "description: Generic record fixture for skill-contract journeys.",
      'version: "1.0"',
      "entities:",
      "  - id: data-record",
      "    action: create",
      "    executor: scripts/executors/create_record.ts",
      "    aliases: [record, 记录]",
      "    invokeParams: [name]",
      "actions:",
      "  - id: close-record",
      "    executor: scripts/executors/close_record.ts",
      "    aliases: [close, 关闭]",
      "    params: [recordId]",
      "scenes:",
      "  - id: closable-record",
      "    steps:",
      "      - data-record::create",
      "      - close-record",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(recordSlot, "SKILL.md"),
    `---
name: record
description: >-
  Generic record fixture. Use when constructing a record or a
  create-then-close scene. Internal fixture; do not invoke independently.
license: Apache-2.0
---

# Record fixture slot
`,
    "utf8",
  );
  writeFileSync(
    join(recordSlot, "scripts", "executors", "create_record.ts"),
    `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";
export async function main(params) {
  const name = params.name;
  if (!name) return { success: false, data: null, error: "missing required param: name" };
  const body = { name, status: params.status || "open" };
  const resp = await fetch(BASE_URL + "/v1/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = JSON.parse((await resp.text()) || "{}");
  if (!resp.ok) return { success: false, data: null, error: "HTTP " + resp.status };
  return { success: true, data, error: null };
}
function isDirectRun() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return String(process.argv[1] || "").endsWith("create_record.ts"); }
}
if (isDirectRun() || process.argv.includes("--json")) {
  const idx = process.argv.indexOf("--json");
  const params = idx >= 0 ? JSON.parse(process.argv[idx + 1]) : {};
  process.stdout.write(JSON.stringify(await main(params), null, 2) + "\\n");
}
`,
    "utf8",
  );
  writeFileSync(
    join(recordSlot, "scripts", "executors", "close_record.ts"),
    `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";
export async function main(params) {
  if (!params.recordId) return { success: false, data: null, error: "missing required param: recordId" };
  const resp = await fetch(BASE_URL + "/v1/records/" + params.recordId + "/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });
  const data = JSON.parse((await resp.text()) || "{}");
  if (!resp.ok) return { success: false, data: null, error: "HTTP " + resp.status };
  return { success: true, data, error: null };
}
function isDirectRun() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return String(process.argv[1] || "").endsWith("close_record.ts"); }
}
if (isDirectRun() || process.argv.includes("--json")) {
  const idx = process.argv.indexOf("--json");
  const params = idx >= 0 ? JSON.parse(process.argv[idx + 1]) : {};
  process.stdout.write(JSON.stringify(await main(params), null, 2) + "\\n");
}
`,
    "utf8",
  );
}

function writeFixtureMock(dest: string): void {
  writeFileSync(
    dest,
    `#!/usr/bin/env node
import { createServer } from "node:http";
const port = Number(process.env.PORT || 18781);
const store = { records: {}, seq: 0 };
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch {}
    const url = String(req.url || "");
    const write = (code, payload) => {
      const raw = Buffer.from(JSON.stringify(payload), "utf8");
      res.writeHead(code, { "Content-Type": "application/json", "Content-Length": String(raw.length) });
      res.end(raw);
    };
    if (url === "/health") return write(200, { ok: true });
    if ((url === "/v1/records" || url === "/v1/resource") && req.method === "POST") {
      store.seq += 1;
      const recordId = "r_" + store.seq;
      const row = { recordId, name: body.name || "untitled", status: body.status || "open" };
      store.records[recordId] = row;
      return write(200, row);
    }
    if (url.includes("/close") && req.method === "POST") {
      const recordId = decodeURIComponent(url.split("/")[3] || "");
      const row = store.records[recordId];
      if (!row) return write(404, { ok: false, error: "unknown recordId: " + recordId });
      row.status = "closed";
      return write(200, { recordId, status: "closed", name: row.name });
    }
    return write(404, { ok: false, error: "not found: " + url });
  });
});
server.listen(port, "127.0.0.1", () => process.stderr.write("record-mock " + port + "\\n"));
`,
    "utf8",
  );
}

export async function runUserJourneySuite(): Promise<JourneyResult[]> {
  writeFixture();

  {
    const search = run("scripts/search_data_build.ts", [
      "--keywords",
      "record",
      "--query",
      "create a record",
      "--registry-key",
      "data-record::create",
      "--entry-type",
      "entity",
      "--domain",
      "record",
      "--json",
      "--no-favorites",
    ]);
    const sj = parseJson(search.stdout);
    const skills = isObj(sj) && Array.isArray(sj.skill_matches) ? sj.skill_matches : [];
    const hit = skills.find((s) => isObj(s) && s.name === "record");
    record(
      "UJ01",
      "SKILL step1 search finds fixture slot",
      "skill_matches.record has skillPath + SKILL.md",
      search.code === 0 &&
        isObj(sj) &&
        Array.isArray(sj.pinned_matches) &&
        Array.isArray(sj.proven_matches) &&
        isObj(hit) &&
        typeof hit.skillPath === "string" &&
        existsSync(join(String(hit.skillPath), "SKILL.md")),
      search.stdout.slice(0, 240),
    );

    const pin = run("scripts/favorites.ts", [
      "add",
      "--name",
      "record",
      "--desc",
      "generic record fixture",
      "--path",
      recordSlot,
    ]);
    const listed = run("scripts/search_data_build.ts", ["--keywords", "zzz-nomatch", "--json"]);
    const lj = parseJson(listed.stdout);
    const pinned = isObj(lj) && Array.isArray(lj.pinned_matches) ? lj.pinned_matches : [];
    record(
      "UJ02",
      "SKILL step1 pin then search injects favorite",
      "pinned_matches includes record",
      pin.code === 0 && pinned.some((p) => isObj(p) && p.name === "record"),
      JSON.stringify(pinned.map((p) => (isObj(p) ? p.name : p))).slice(0, 160),
    );

    const dest = join(work, "installed-skills");
    mkdirSync(dest, { recursive: true });
    const inst = run("scripts/adapters/cli.ts", ["skill_marketplace.install", "record", dest]);
    const ij = parseJson(inst.stdout);
    record(
      "UJ03",
      "SKILL step1 install fixture slot",
      "{ok:true} and copied SKILL.md",
      inst.code === 0 && isObj(ij) && ij.ok === true && existsSync(join(dest, "record", "SKILL.md")),
      inst.stdout.slice(0, 200),
    );

    const provenBody = JSON.stringify({
      registry_key: "data-record::create",
      domain: "record",
      contributor: "journey",
      tool_binding: { toolType: "skill", resourceId: "record" },
      proven_invocation: {
        invokeCmdTemplate: "node scripts/executors/create_record.ts --json '{\"name\":\"${name}\"}'",
        paramMapping: { name: "name" },
      },
    });
    const reported = run("scripts/experience_client.ts", ["report", "--body", provenBody]);
    const reportedj = parseJson(reported.stdout);
    const expId = isObj(reportedj) && isObj(reportedj.data) ? reportedj.data.experience_id : null;
    const provenSearch = run("scripts/search_data_build.ts", [
      "--keywords",
      "record",
      "--query",
      "create a record",
      "--registry-key",
      "data-record::create",
      "--entry-type",
      "entity",
      "--domain",
      "record",
      "--json",
    ]);
    const psj = parseJson(provenSearch.stdout);
    const proven = isObj(psj) && Array.isArray(psj.proven_matches) ? psj.proven_matches : [];
    const provenHit = proven.find((p) => isObj(p) && p.registry_key === "data-record::create");
    record(
      "UJ03b",
      "SKILL step1 proven_matches after report",
      "proven_matches includes data-record::create + experience_id",
      reported.code === 0 && Boolean(expId) && provenSearch.code === 0 && isObj(provenHit),
      provenSearch.stdout.slice(0, 220),
    );
  }

  const port = 18781;
  const env = { ...isolatedEnv, DATA_BUILD_API_BASE: `http://127.0.0.1:${port}` };
  writeFixtureMock(join(work, "record_mock.ts"));
  const child: ChildProcess = spawn(process.execPath, [join(work, "record_mock.ts")], {
    cwd: work,
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const up = await waitUntil(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      return false;
    }
  });
  if (!up) {
    record("UJ-mock", "fixture mock", "health ok", false, "did not start");
    child.kill();
    return results;
  }

  try {
    const created = execJson(env, join(recordSlot, "scripts/executors/create_record.ts"), {
      name: "Journey Record",
    });
    const hd = isObj(created.data) ? created.data : {};
    record(
      "UJ04",
      "single-step construct via fixture executor",
      "backend recordId + name + default status",
      created.success === true && Boolean(hd.recordId) && hd.name === "Journey Record" && hd.status === "open",
      JSON.stringify(created).slice(0, 220),
    );

    const explicit = execJson(env, join(recordSlot, "scripts/executors/create_record.ts"), {
      name: "Draft Record",
      status: "draft",
    });
    const ex = isObj(explicit.data) ? explicit.data : {};
    record(
      "UJ05",
      "optional field not overwritten",
      "status=draft kept",
      explicit.success === true && ex.status === "draft",
      JSON.stringify(explicit).slice(0, 180),
    );

    const sceneCreate = execJson(env, join(recordSlot, "scripts/executors/create_record.ts"), {
      name: "Closable",
    });
    const sc = isObj(sceneCreate.data) ? sceneCreate.data : {};
    const closed = execJson(env, join(recordSlot, "scripts/executors/close_record.ts"), {
      recordId: sc.recordId,
    });
    const cd = isObj(closed.data) ? closed.data : {};
    record(
      "UJ06",
      "scene closable-record reuses upstream id",
      "recordId reused; status=closed",
      sceneCreate.success === true &&
        closed.success === true &&
        cd.recordId === sc.recordId &&
        cd.status === "closed",
      JSON.stringify({ create: sc, close: cd }).slice(0, 260),
    );

    const missing = execJson(env, join(recordSlot, "scripts/executors/close_record.ts"), {});
    record(
      "UJ08b",
      "material gate: follow-on step without upstream id",
      "executor refuses; do not invent recordId",
      missing.success === false && String(missing.error || "").includes("recordId"),
      JSON.stringify(missing).slice(0, 180),
    );

    const q1 = run("scripts/adapters/cli.ts", ["tool_registry.query", "create a test record"], env);
    const q2 = run("scripts/adapters/cli.ts", ["tool_registry.query", "close an existing record"], env);
    record(
      "UJ09",
      "SKILL step2 two-angle tool query",
      "both exit 0 JSON arrays",
      q1.code === 0 && q2.code === 0 && Array.isArray(parseJson(q1.stdout)) && Array.isArray(parseJson(q2.stdout)),
      `a=${q1.stdout.slice(0, 80)} b=${q2.stdout.slice(0, 80)}`,
    );

    const tmpl = run("references/script-template.ts", ["--json", '{"name":"Template Record"}'], env);
    const tj = parseJson(tmpl.stdout);
    const td = isObj(tj) && isObj(tj.data) ? tj.data : {};
    record(
      "UJ10",
      "SKILL step4 script-template against fixture mock",
      "{success:true, data.recordId, name}",
      tmpl.code === 0 && isObj(tj) && tj.success === true && Boolean(td.recordId) && td.name === "Template Record",
      tmpl.stdout.slice(0, 220),
    );

    const pubScript = join(work, "published-record.ts");
    writeFileSync(pubScript, readFileSync(join(recordSlot, "scripts", "executors", "create_record.ts"), "utf8"), "utf8");
    const pub = run(
      "scripts/adapters/cli.ts",
      [
        "tool_registry.publish",
        "journey-record-create",
        "Create a record via the configured HTTP API",
        pubScript,
        '[{"name":"name","type":"string","required":true}]',
      ],
      env,
    );
    const pubj = parseJson(pub.stdout);
    const inputs = run("scripts/adapters/cli.ts", ["tool_registry.query_input_list", "journey-record-create"], env);
    const inj = parseJson(inputs.stdout);
    const exe = run("scripts/adapters/cli.ts", ["tool_registry.execute", "journey-record-create", '{"name":"Published Record"}'], env);
    const exj = parseJson(exe.stdout);
    const nested =
      isObj(exj) && isObj(exj.data) ? (isObj(exj.data.data) ? exj.data.data : exj.data) : {};
    record(
      "UJ11",
      "SKILL step2/4 publish → input_list → execute",
      "required name + execute returns recordId",
      pub.code === 0 &&
        isObj(pubj) &&
        pubj.ok === true &&
        Array.isArray(inj) &&
        inj.some((i) => isObj(i) && i.name === "name" && i.required === true) &&
        exe.code === 0 &&
        isObj(exj) &&
        (exj.ok === true || exj.success === true) &&
        isObj(nested) &&
        Boolean(nested.recordId),
      `pub=${pub.stdout.slice(0, 100)} exe=${exe.stdout.slice(0, 160)}`,
    );
    record(
      "UJ11b",
      "published tool execute payload",
      "data.recordId present",
      isObj(nested) && Boolean(nested.recordId),
      JSON.stringify({ exit: exe.code, nested }).slice(0, 220),
    );
    const gotTool = run("scripts/adapters/cli.ts", ["tool_registry.get", "journey-record-create"], env);
    const gtj = parseJson(gotTool.stdout);
    record(
      "UJ11c",
      "SKILL step2 tool_registry.get exact id",
      "id/name journey-record-create",
      gotTool.code === 0 && isObj(gtj) && (gtj.id === "journey-record-create" || gtj.name === "journey-record-create"),
      gotTool.stdout.slice(0, 180),
    );

    const report = run(
      "scripts/experience_client.ts",
      [
        "report",
        "--body",
        JSON.stringify({
          registry_key: "data-record::create",
          entry_type: "entity",
          tool_binding: { toolType: "skill", resourceId: "record" },
          outcome: "success",
        }),
      ],
      env,
    );
    const rj = parseJson(report.stdout);
    record(
      "UJ12",
      "SKILL success follow-up report",
      "{ok:true, data.experience_id}",
      report.code === 0 && isObj(rj) && rj.ok === true && isObj(rj.data) && Boolean(rj.data.experience_id || rj.data.experienceId),
      report.stdout.slice(0, 200),
    );

    const apis = run("scripts/adapters/cli.ts", ["api_catalog.search", "record"], env);
    const apiItems = parseJson(apis.stdout);
    const detail = run("scripts/adapters/cli.ts", ["api_catalog.detail", "createRecord"], env);
    const dj = parseJson(detail.stdout);
    const plan = run("scripts/adapters/cli.ts", ["api_catalog.search_plan_changes", "plan-demo"], env);
    const listed = run("scripts/adapters/cli.ts", ["api_catalog.list_by_service", "record"], env);
    record(
      "UJ13",
      "SKILL step3 api_catalog A+B",
      "search + detail(createRecord) + plan changes + list_by_service",
      apis.code === 0 &&
        Array.isArray(apiItems) &&
        apiItems.length > 0 &&
        detail.code === 0 &&
        isObj(dj) &&
        (dj.operationId === "createRecord" || Boolean(dj.path || dj.method)) &&
        plan.code === 0 &&
        Array.isArray(parseJson(plan.stdout)) &&
        listed.code === 0 &&
        Array.isArray(parseJson(listed.stdout)),
      `search=${apis.stdout.slice(0, 80)} detail=${detail.stdout.slice(0, 80)}`,
    );

    const caseSrc = join(work, "case-b.md");
    writeFileSync(
      caseSrc,
      "# 用例标题：记录关闭成功\n\n## 前置条件\n1. 系统中存在一条可关闭的记录\n2. 存在测试用户 u_1001\n\n## 步骤\n1. 关闭上述记录\n\n## 预期\n- 返回 recordId、status\n",
      "utf8",
    );
    const init = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "journey-b", "--source", caseSrc, "--materials-root", materials],
      env,
    );
    const need = parseJson(init.stdout);
    record("UJ14", "case Path B first run", "exit 11 need parse-case", init.code === 11 && isObj(need) && need.need === "parse-case", init.stdout.slice(0, 160));
    const manPath = join(materials, "journey-b", "manifest.json");
    const man = JSON.parse(readFileSync(manPath, "utf8")) as JsonObject;
    man.entities = [
      {
        entityId: "E01",
        entityType: "record",
        constructionStrategy: "tool-build",
        constraints: "可关闭的记录",
        fields: { recordId: null },
        queries: { angleA: "创建一条记录", angleB: "新建记录" },
        toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
        entityStatus: null,
        targetLocation: "precondition.list[0]",
      },
      {
        entityId: "E02",
        entityType: "user",
        constructionStrategy: "static-value",
        fields: { userId: "u_1001" },
        entityStatus: "verified",
        dataConfidence: 0.85,
        targetLocation: "precondition.list[1]",
      },
    ];
    man.actions = [
      {
        actionId: "A01",
        stepIdx: 1,
        actionDesc: "关闭记录",
        queries: { angleA: "调用关闭接口关闭记录", angleB: "关闭已有记录" },
        toolBinding: { toolType: null, resourceId: null, cmdTemplate: null, toolStatus: null },
        paramsFromEntities: [
          { paramName: "recordId", sourceEntityId: "E01", sourceField: "recordId" },
        ],
        outputs: { recordId: { description: "记录ID" }, status: { description: "状态" } },
        targetLocation: "steps.list[0]",
      },
    ];
    (man.pipelines as JsonObject).parse = { status: "done" };
    writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`, "utf8");
    const resumed = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--manifest", manPath, "--resume"],
      env,
    );
    const disk = JSON.parse(readFileSync(manPath, "utf8")) as JsonObject;
    const e01 = Array.isArray(disk.entities) ? disk.entities.find((e) => isObj(e) && e.entityId === "E01") : undefined;
    const a01 = Array.isArray(disk.actions) ? disk.actions.find((a) => isObj(a) && a.actionId === "A01") : undefined;
    const exePath = join(materials, "journey-b", "case-executable.md");
    const exeText = existsSync(exePath) ? readFileSync(exePath, "utf8") : "";
    const fields = isObj(e01) && isObj(e01.fields) ? e01.fields : {};
    record(
      "UJ15",
      "case Path B construct+writeback contract",
      "fields recordId/name/status; filledCmd has id; exe 入参/产出 and no node",
      resumed.code === 0 &&
        Boolean(fields.recordId) &&
        Boolean(fields.name) &&
        fields.status === "open" &&
        isObj(a01) &&
        a01.cmdStatus === "filled" &&
        String(a01.filledCmd).includes(String(fields.recordId)) &&
        exeText.includes("recordId=") &&
        exeText.includes("userId=u_1001") &&
        exeText.includes("入参：") &&
        exeText.includes("产出：") &&
        !exeText.includes("node ") &&
        !exeText.includes(String(port)),
      `exit ${resumed.code} fields=${JSON.stringify(fields)} exe=${exeText.slice(0, 180)}`,
    );

    const prd = join(work, "prd.md");
    writeFileSync(prd, "# PRD\n关闭记录", "utf8");
    const pathA = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "journey-a", "--source", caseSrc, "--materials-root", materials, "--prd", prd],
      env,
    );
    const paj = parseJson(pathA.stdout);
    record(
      "UJ16",
      "case Path A --prd + case",
      "exit 12 need knowledge-build before parse",
      pathA.code === 12 && isObj(paj) && paj.need === "knowledge-build",
      pathA.stdout.slice(0, 180),
    );
    const waitA = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "journey-a-wait", "--prd", prd, "--materials-root", materials],
      env,
    );
    const waitAj = parseJson(waitA.stdout);
    record(
      "UJ16b",
      "Path A PRD without cases",
      "exit 12 knowledge-build; do not invent case text",
      waitA.code === 12 && isObj(waitAj) && waitAj.need === "knowledge-build",
      waitA.stdout.slice(0, 180),
    );
    const waitMan = join(materials, "journey-a-wait", "manifest.json");
    const ctx = join(work, "business-context.json");
    writeFileSync(ctx, `${JSON.stringify({ configMap: {} }, null, 2)}\n`, "utf8");
    const waited = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--manifest", waitMan, "--context", ctx, "--resume"],
      env,
    );
    const waitedj = parseJson(waited.stdout);
    const waitDisk = existsSync(waitMan) ? (JSON.parse(readFileSync(waitMan, "utf8")) as JsonObject) : {};
    record(
      "UJ16c",
      "Path A after knowledge-build, still no cases",
      "exit 0 waiting=cases; parse/invoke not started",
      waited.code === 0 &&
        isObj(waitedj) &&
        waitedj.waiting === "cases" &&
        isObj(waitDisk.pipelines) &&
        isObj(waitDisk.pipelines.parse) &&
        waitDisk.pipelines.parse.status !== "done" &&
        !existsSync(join(materials, "journey-a-wait", "case-executable.md")),
      `exit ${waited.code} ${waited.stdout.slice(0, 180)}`,
    );
    const attached = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--manifest", waitMan, "--source", caseSrc, "--resume"],
      env,
    );
    const attachedj = parseJson(attached.stdout);
    record(
      "UJ16d",
      "Path A attach cases after wait",
      "exit 11 need parse-case with sourceDoc",
      attached.code === 11 && isObj(attachedj) && attachedj.need === "parse-case" && Boolean(attachedj.sourceDoc),
      attached.stdout.slice(0, 180),
    );

    const pasteSrc = join(work, "pasted-case.md");
    writeFileSync(pasteSrc, "# 用例标题：粘贴用例\n\n## 前置条件\n1. 存在用户 u_1\n\n## 步骤\n1. 校验\n", "utf8");
    const paste = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "journey-paste", "--source", pasteSrc, "--source-type", "paste", "--materials-root", materials],
      env,
    );
    const pasteMan = existsSync(join(materials, "journey-paste", "manifest.json"))
      ? (JSON.parse(readFileSync(join(materials, "journey-paste", "manifest.json"), "utf8")) as JsonObject)
      : {};
    const pasteSrcType = isObj(pasteMan.caseSource) ? pasteMan.caseSource.type : null;
    record(
      "UJ16e",
      "case source-type paste",
      "exit 11 and caseSource.type=paste",
      paste.code === 11 && pasteSrcType === "paste",
      `exit ${paste.code} type=${String(pasteSrcType)}`,
    );

    const srcC2 = join(work, "case-c2.md");
    writeFileSync(srcC2, "# 用例标题：批次C2\n\n## 前置条件\n1. 存在测试用户 u_9\n\n## 步骤\n1. 校验用户\n", "utf8");
    const c1init = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "journey-c1", "--source", caseSrc, "--materials-root", materials],
      env,
    );
    const c2init = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "journey-c2", "--source", srcC2, "--materials-root", materials],
      env,
    );
    const c1p = join(materials, "journey-c1", "manifest.json");
    const c2p = join(materials, "journey-c2", "manifest.json");
    const c1m = JSON.parse(readFileSync(c1p, "utf8")) as JsonObject;
    c1m.entities = [
      {
        entityId: "E01",
        entityType: "record",
        constructionStrategy: "tool-build",
        fields: { recordId: null },
        queries: { angleA: "创建一条记录", angleB: "新建记录" },
        toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
        entityStatus: null,
        targetLocation: "precondition.list[0]",
      },
    ];
    (c1m.pipelines as JsonObject).parse = { status: "done" };
    writeFileSync(c1p, `${JSON.stringify(c1m, null, 2)}\n`, "utf8");
    const c2m = JSON.parse(readFileSync(c2p, "utf8")) as JsonObject;
    c2m.entities = [
      {
        entityId: "E01",
        entityType: "user",
        constructionStrategy: "static-value",
        fields: { userId: "u_9" },
        entityStatus: "verified",
        dataConfidence: 0.85,
        targetLocation: "precondition.list[0]",
      },
    ];
    (c2m.pipelines as JsonObject).parse = { status: "done" };
    writeFileSync(c2p, `${JSON.stringify(c2m, null, 2)}\n`, "utf8");
    const c1run = run("references/case-data-material-planner/scripts/pipeline.ts", ["--manifest", c1p, "--resume"], env);
    const c2run = run("references/case-data-material-planner/scripts/pipeline.ts", ["--manifest", c2p, "--resume"], env);
    const c1disk = JSON.parse(readFileSync(c1p, "utf8")) as JsonObject;
    const c2disk = JSON.parse(readFileSync(c2p, "utf8")) as JsonObject;
    const c1e = Array.isArray(c1disk.entities) ? c1disk.entities.find((e) => isObj(e) && e.entityId === "E01") : undefined;
    const c2e = Array.isArray(c2disk.entities) ? c2disk.entities.find((e) => isObj(e) && e.entityId === "E01") : undefined;
    const c1fields = isObj(c1e) && isObj(c1e.fields) ? c1e.fields : {};
    const c2fields = isObj(c2e) && isObj(c2e.fields) ? c2e.fields : {};
    record(
      "UJ16f",
      "Path C two isolated pipelines",
      "each case keeps its own recordId/userId; both exit 0",
      c1init.code === 11 &&
        c2init.code === 11 &&
        c1run.code === 0 &&
        c2run.code === 0 &&
        Boolean(c1fields.recordId) &&
        c2fields.userId === "u_9" &&
        c1fields.recordId !== c2fields.userId,
      `c1=${c1run.code} record=${String(c1fields.recordId)} c2=${c2run.code} user=${String(c2fields.userId)}`,
    );

    const c3man = join(materials, "journey-c3", "manifest.json");
    mkdirSync(dirname(c3man), { recursive: true });
    writeFileSync(
      c3man,
      `${JSON.stringify({
        version: "v5",
        policyVersion: "2.0.0",
        caseId: "journey-c3",
        caseSource: { type: "local-file", original: caseSrc },
        pipelines: {
          "knowledge-build": { status: "skipped" },
          parse: { status: "done" },
          preprocess: { status: "done" },
          "data-track": { status: "done" },
          "action-track": { status: "done" },
          "lint-gate": { status: "pending", round: 0 },
          writeback: { status: "pending" },
        },
        entities: [
          {
            entityId: "E99",
            constructionStrategy: "tool-build",
            fields: { recordId: "r_force" },
            toolBinding: { toolType: "skill", invokeCmd: "node x.ts", toolStatus: "available" },
            entityStatus: null,
            targetLocation: "precondition.list[0]",
          },
        ],
        actions: [],
        confirmations: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const c3 = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--manifest", c3man, "--resume"],
      env,
    );
    const c3j = parseJson(c3.stdout);
    record("UJ17", "case C3 lint FAIL", "exit 20 need:c3", c3.code === 20 && isObj(c3j) && c3j.need === "c3", c3.stdout.slice(0, 180));
    const c3disk = JSON.parse(readFileSync(c3man, "utf8")) as JsonObject;
    const confs = Array.isArray(c3disk.confirmations) ? c3disk.confirmations : [];
    confs.push({ decision: "force-pass", at: new Date().toISOString() });
    c3disk.confirmations = confs;
    writeFileSync(c3man, `${JSON.stringify(c3disk, null, 2)}\n`, "utf8");
    const forced = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--manifest", c3man, "--scope", "writeback-only"],
      env,
    );
    const forcedj = parseJson(forced.stdout);
    record(
      "UJ18",
      "case C3 force-pass writeback-only",
      "exit 0 writes case-executable with recordId",
      forced.code === 0 &&
        isObj(forcedj) &&
        forcedj.ok === true &&
        existsSync(join(materials, "journey-c3", "case-executable.md")) &&
        readFileSync(join(materials, "journey-c3", "case-executable.md"), "utf8").includes("recordId=r_force"),
      `exit ${forced.code} ${forced.stdout.slice(0, 160)}`,
    );

    const scaffold = run("slot-scaffolder/scripts/scaffold_slot.ts", [
      "--domain",
      "payments",
      "--openapi",
      openapiDir,
      "--output",
      join(work, "slot-payments"),
    ]);
    const scj = parseJson(scaffold.stdout);
    record(
      "UJ19",
      "material gate 5 new domain slot",
      "{ok:true} SKILL.md exists",
      scaffold.code === 0 && isObj(scj) && scj.ok === true && existsSync(join(work, "slot-payments", "SKILL.md")),
      scaffold.stdout.slice(0, 200),
    );

    const noSrc = run("references/case-data-material-planner/scripts/pipeline.ts", [
      "--case-id",
      "no-source",
      "--source",
      join(work, "missing-case.md"),
      "--materials-root",
      materials,
    ]);
    record(
      "UJ20",
      "material gate 4 missing case source",
      "exit 2, do not invent case text",
      noSrc.code === 2 && /source not found|not found/.test(noSrc.stderr),
      `exit ${noSrc.code} ${noSrc.stderr.slice(0, 140)}`,
    );
  } finally {
    child.kill();
  }

  return results;
}

function printReport(): number {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  process.stdout.write("\n=== user-journey completeness report ===\n");
  process.stdout.write(`work dir: ${work}\n`);
  process.stdout.write(`total=${results.length} pass=${pass} fail=${fail}\n\n`);
  for (const r of results) {
    process.stdout.write(`${r.status}\t${r.id}\t${r.command}\n`);
    if (r.status === "FAIL") {
      process.stdout.write(`  expected: ${r.expected}\n`);
      process.stdout.write(`  actual:   ${r.actual}\n`);
    }
  }
  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("_verify_user_journeys.ts")) {
  await runUserJourneySuite();
  process.exit(printReport());
}
