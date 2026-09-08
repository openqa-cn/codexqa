#!/usr/bin/env node
/**
 * Enterprise onboarding against the current extension contract:
 *   1) drop a scene skill
 *   2) add workspace.slot_roots if the skill is outside pack slots/
 * No marketplace.paths / api_catalog.paths.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
export type OnboardResult = {
  id: string;
  command: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
};

const results: OnboardResult[] = [];
const work = mkdtempSync(join(tmpdir(), "dgs-onboard-"));
const companySlots = join(work, "company-slots");
const invoiceSlot = join(companySlots, "invoice");
const openapiDir = join(work, "openapi");
const materials = join(work, "cases");
const toolsDir = join(work, "tools");
mkdirSync(companySlots, { recursive: true });
mkdirSync(openapiDir, { recursive: true });
mkdirSync(materials, { recursive: true });
mkdirSync(toolsDir, { recursive: true });

const configPath = join(work, "config.yaml");
writeFileSync(
  configPath,
  [
    "workspace:",
    "  testdata_dir: ./testdata",
    "  slot_roots:",
    `    - ${companySlots}`,
    "adapters:",
    "  tool_registry:",
    "    type: local",
    `    path: ${toolsDir}`,
    "  experience_store:",
    "    type: local",
    `    path: ${join(work, "experience")}`,
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
  DATA_GENERATE_SKILLS_ROOT: TS_ROOT,
  DATA_BUILD_CONFIG: configPath,
  DATA_BUILD_FAVORITES_PATH: join(work, "favorites.json"),
  DATA_BUILD_SCRIPT_ROOTS: work,
};

function record(id: string, command: string, expected: string, ok: boolean, actual: string): void {
  results.push({ id, command, expected, actual, status: ok ? "PASS" : "FAIL" });
  if (!ok) process.stderr.write(`FAIL ${id}: ${actual}\n`);
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv = isolatedEnv) {
  const got = spawnSync(process.execPath, [join(TS_ROOT, script), ...args], {
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

function writeInvoiceMock(dest: string): void {
  writeFileSync(
    dest,
    `#!/usr/bin/env node
import { createServer } from "node:http";
const port = Number(process.env.PORT || 18793);
const store = { invoices: {}, seq: 0 };
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
    if (url === "/v1/invoices" && req.method === "POST") {
      store.seq += 1;
      const invoiceId = "inv_" + store.seq;
      const amount = Math.trunc(Number(body.amount || 199));
      const row = { invoiceId, title: body.title || "untitled", amount, status: "unpaid", currency: "CNY" };
      store.invoices[invoiceId] = row;
      return write(200, row);
    }
    if (url.includes("/pay") && req.method === "POST") {
      const invoiceId = decodeURIComponent(url.split("/")[3] || "");
      const row = store.invoices[invoiceId];
      if (!row) return write(404, { ok: false, error: "unknown invoiceId: " + invoiceId });
      row.status = "paid";
      row.paidAmount = row.amount;
      return write(200, { invoiceId, status: "paid", paidAmount: row.paidAmount, currency: row.currency });
    }
    return write(404, { ok: false, error: "not found: " + url });
  });
});
server.listen(port, "127.0.0.1", () => process.stderr.write("invoice-mock " + port + "\\n"));
`,
    "utf8",
  );
}

async function startMock(port: number): Promise<ChildProcess> {
  const script = join(work, "invoice_mock.ts");
  writeInvoiceMock(script);
  const child = spawn(process.execPath, [script], {
    cwd: work,
    env: { ...isolatedEnv, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  child.kill();
  throw new Error("invoice mock did not start");
}

function writeExecutor(filename: string, source: string): void {
  mkdirSync(join(invoiceSlot, "scripts", "executors"), { recursive: true });
  writeFileSync(join(invoiceSlot, "scripts", "executors", filename), source, "utf8");
}

export async function runEnterpriseOnboardSuite(): Promise<OnboardResult[]> {
  writeFileSync(
    join(openapiDir, "invoice.yaml"),
    [
      "openapi: 3.0.3",
      "info:",
      "  title: Invoice",
      '  version: "1.0.0"',
      "paths:",
      "  /v1/invoices:",
      "    post:",
      "      operationId: createInvoice",
      "      summary: Create an invoice",
      "      responses:",
      '        "200":',
      "          description: ok",
      "  /v1/invoices/{invoiceId}/pay:",
      "    post:",
      "      operationId: payInvoice",
      "      summary: Pay an invoice",
      "      responses:",
      '        "200":',
      "          description: ok",
      "",
    ].join("\n"),
    "utf8",
  );

  const scaffold = run("slot-scaffolder/scripts/scaffold_slot.ts", [
    "--domain",
    "invoice",
    "--openapi",
    openapiDir,
    "--output",
    invoiceSlot,
  ]);
  const sj = parseJson(scaffold.stdout);
  record(
    "EN01",
    "scaffold invoice skill from OpenAPI",
    "slot.yaml + generated SKILL.md + 2 stubs",
    scaffold.code === 0 &&
      isObj(sj) &&
      sj.ok === true &&
      existsSync(join(invoiceSlot, "slot.yaml")) &&
      existsSync(join(invoiceSlot, "SKILL.md")) &&
      readFileSync(join(invoiceSlot, "SKILL.md"), "utf8").includes("generated-from: slot.yaml"),
    scaffold.stdout.slice(0, 200),
  );

  writeExecutor(
    "createinvoice.ts",
    `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";
export async function main(params) {
  const title = params.title || params.name;
  if (!title) return { success: false, data: null, error: "missing required param: title" };
  const resp = await fetch(BASE_URL + "/v1/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, amount: Number(params.amount || 199) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = JSON.parse((await resp.text()) || "{}");
  if (!resp.ok) return { success: false, data: null, error: "HTTP " + resp.status };
  return { success: true, data, error: null };
}
function isDirectRun() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return String(process.argv[1] || "").endsWith("createinvoice.ts"); }
}
if (isDirectRun() || process.argv.includes("--json")) {
  const idx = process.argv.indexOf("--json");
  const params = idx >= 0 ? JSON.parse(process.argv[idx + 1]) : {};
  process.stdout.write(JSON.stringify(await main(params), null, 2) + "\\n");
}
`,
  );
  writeExecutor(
    "payinvoice.ts",
    `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";
export async function main(params) {
  if (!params.invoiceId) return { success: false, data: null, error: "missing required param: invoiceId" };
  const resp = await fetch(BASE_URL + "/v1/invoices/" + params.invoiceId + "/pay", {
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
  catch { return String(process.argv[1] || "").endsWith("payinvoice.ts"); }
}
if (isDirectRun() || process.argv.includes("--json")) {
  const idx = process.argv.indexOf("--json");
  const params = idx >= 0 ? JSON.parse(process.argv[idx + 1]) : {};
  process.stdout.write(JSON.stringify(await main(params), null, 2) + "\\n");
}
`,
  );

  writeFileSync(
    join(invoiceSlot, "slot.yaml"),
    [
      "name: invoice",
      "domain: invoice",
      "description: Invoice domain data-build slot",
      "entities:",
      "  - id: invoice-draft",
      "    action: create",
      "    executor: scripts/executors/createinvoice.ts",
      "    aliases: [invoice, 发票]",
      "    invokeParams: [name]",
      "actions:",
      "  - id: pay-invoice",
      "    executor: scripts/executors/payinvoice.ts",
      "    aliases: [pay, 支付, 付款]",
      "    params: [invoiceId]",
      "scenes:",
      "  - id: payable-invoice",
      "    steps:",
      "      - invoice-draft::create",
      "      - pay-invoice",
      "",
    ].join("\n"),
    "utf8",
  );
  const synced = run("scripts/sync_slot.ts", ["--dir", invoiceSlot]);
  const syncj = parseJson(synced.stdout);
  record(
    "EN02",
    "slot.yaml is the only scene config; sync docs",
    "payable-invoice present and SKILL.md regenerated",
    synced.code === 0 &&
      isObj(syncj) &&
      syncj.ok === true &&
      readFileSync(join(invoiceSlot, "slot.yaml"), "utf8").includes("payable-invoice") &&
      readFileSync(join(invoiceSlot, "SKILL.md"), "utf8").includes("payable-invoice"),
    synced.stdout.slice(0, 180),
  );

  record(
    "EN03",
    "enterprise config surface",
    "only workspace.slot_roots; no marketplace.paths / api_catalog.paths",
    /slot_roots:/.test(readFileSync(configPath, "utf8")) &&
      !/skill_marketplace:/.test(readFileSync(configPath, "utf8")) &&
      !/api_catalog:/.test(readFileSync(configPath, "utf8")),
    readFileSync(configPath, "utf8"),
  );

  const search = run("scripts/search_data_build.ts", [
    "--keywords",
    "invoice",
    "--query",
    "create an invoice and pay it",
    "--registry-key",
    "invoice-draft::create",
    "--entry-type",
    "entity",
    "--domain",
    "invoice",
    "--json",
  ]);
  const searchj = parseJson(search.stdout);
  const hit = isObj(searchj) && Array.isArray(searchj.skill_matches)
    ? searchj.skill_matches.find((s) => isObj(s) && s.name === "invoice")
    : undefined;
  record(
    "EN04",
    "auto-discover via slot_roots",
    "skill_matches.invoice with skillPath under company-slots",
    search.code === 0 && isObj(hit) && String(hit.skillPath).includes("invoice"),
    search.stdout.slice(0, 240),
  );

  const dest = join(work, "installed-skills");
  mkdirSync(dest, { recursive: true });
  const inst = run("scripts/adapters/cli.ts", ["skill_marketplace.install", "invoice", dest]);
  const instj = parseJson(inst.stdout);
  record(
    "EN04b",
    "install from slot_roots without marketplace.paths",
    "{ok:true} copied SKILL.md",
    inst.code === 0 && isObj(instj) && instj.ok === true && existsSync(join(dest, "invoice", "SKILL.md")),
    inst.stdout.slice(0, 180),
  );

  const apis = run("scripts/adapters/cli.ts", ["api_catalog.search", "invoice"]);
  const apiItems = parseJson(apis.stdout);
  record(
    "EN05",
    "auto-index slot OpenAPI",
    "createInvoice / payInvoice visible without api_catalog.paths",
    apis.code === 0 &&
      Array.isArray(apiItems) &&
      apiItems.some((i) => isObj(i) && /invoice/i.test(String(i.operationId || i.path || ""))),
    apis.stdout.slice(0, 200),
  );

  const port = 18793;
  let mock: ChildProcess | null = null;
  try {
    mock = await startMock(port);
  } catch (err) {
    record("EN-mock", "invoice mock", "health ok", false, err instanceof Error ? err.message : String(err));
    return results;
  }
  const env = { ...isolatedEnv, DATA_BUILD_API_BASE: `http://127.0.0.1:${port}` };
  try {
    const created = spawnSync(
      process.execPath,
      [join(invoiceSlot, "scripts/executors/createinvoice.ts"), "--json", '{"title":"Q3 catalog bill","amount":199}'],
      { cwd: TS_ROOT, env, encoding: "utf8", timeout: 20_000 },
    );
    const cj = parseJson(created.stdout);
    const cd = isObj(cj) && isObj(cj.data) ? cj.data : {};
    record(
      "EN06",
      "single-step create invoice",
      "invoiceId + title + amount=199 + status=unpaid",
      created.status === 0 &&
        isObj(cj) &&
        cj.success === true &&
        Boolean(cd.invoiceId) &&
        cd.title === "Q3 catalog bill" &&
        cd.amount === 199 &&
        cd.status === "unpaid",
      created.stdout.slice(0, 240),
    );

    const paid = spawnSync(
      process.execPath,
      [join(invoiceSlot, "scripts/executors/payinvoice.ts"), "--json", JSON.stringify({ invoiceId: cd.invoiceId })],
      { cwd: TS_ROOT, env, encoding: "utf8", timeout: 20_000 },
    );
    const pj = parseJson(paid.stdout);
    const pd = isObj(pj) && isObj(pj.data) ? pj.data : {};
    record(
      "EN07",
      "scene payable-invoice",
      "reuse invoiceId; status=paid paidAmount=199",
      paid.status === 0 &&
        isObj(pj) &&
        pj.success === true &&
        pd.invoiceId === cd.invoiceId &&
        pd.status === "paid" &&
        pd.paidAmount === 199,
      paid.stdout.slice(0, 240),
    );

    const miss = spawnSync(process.execPath, [join(invoiceSlot, "scripts/executors/payinvoice.ts"), "--json", "{}"], {
      cwd: TS_ROOT,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
    const mj = parseJson(miss.stdout);
    record(
      "EN08",
      "pay without invoiceId",
      "refuse to invent invoiceId",
      isObj(mj) && mj.success === false && String(mj.error || "").includes("invoiceId"),
      miss.stdout.slice(0, 160),
    );

    const caseSrc = join(work, "invoice-case.md");
    writeFileSync(
      caseSrc,
      "# 用例标题：发票支付成功\n\n## 前置条件\n1. 系统中存在一张待支付发票\n\n## 步骤\n1. 支付该发票\n\n## 预期\n- 返回 invoiceId、status=paid\n",
      "utf8",
    );
    const init = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "invoice-1", "--source", caseSrc, "--materials-root", materials],
      env,
    );
    const need = parseJson(init.stdout);
    record(
      "EN09",
      "case Path B handshake",
      "exit 11 parse-case",
      init.code === 11 && isObj(need) && need.need === "parse-case",
      init.stdout.slice(0, 160),
    );

    const manPath = join(materials, "invoice-1", "manifest.json");
    const man = JSON.parse(readFileSync(manPath, "utf8")) as JsonObject;
    man.entities = [
      {
        entityId: "E01",
        entityType: "invoice",
        constructionStrategy: "tool-build",
        constraints: "待支付发票",
        fields: { invoiceId: null },
        queries: { angleA: "创建一张待支付发票", angleB: "invoice draft create" },
        toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
        entityStatus: null,
        targetLocation: "precondition.list[0]",
      },
    ];
    man.actions = [
      {
        actionId: "A01",
        stepIdx: 1,
        actionDesc: "支付该发票",
        queries: { angleA: "pay invoice", angleB: "发票支付" },
        toolBinding: { toolType: null, resourceId: null, cmdTemplate: null, toolStatus: null },
        paramsFromEntities: [{ paramName: "invoiceId", sourceEntityId: "E01", sourceField: "invoiceId" }],
        outputs: { status: { description: "支付状态" }, paidAmount: { description: "已付金额" } },
        targetLocation: "steps.list[0]",
      },
    ];
    (man.pipelines as JsonObject).parse = { status: "done" };
    writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`, "utf8");

    const select = run(
      "references/case-data-material-planner/scripts/select_tool.ts",
      ["--manifest", manPath, "--type", "entity", "--id", "E01"],
      env,
    );
    const selj = parseJson(select.stdout);
    const bind = isObj(selj) && isObj(selj.toolBinding) ? selj.toolBinding : {};
    record(
      "EN10",
      "select_tool binds invoice skill from slot.yaml",
      "resourceId=invoice invokeCmd createinvoice, no LLM",
      select.code === 0 &&
        isObj(selj) &&
        selj.bound === true &&
        selj.needLlm !== true &&
        bind.resourceId === "invoice" &&
        String(bind.invokeCmd).includes("createinvoice.ts"),
      select.stdout.slice(0, 240),
    );

    const resumed = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--manifest", manPath, "--resume"],
      env,
    );
    const disk = JSON.parse(readFileSync(manPath, "utf8")) as JsonObject;
    const e01 = Array.isArray(disk.entities) ? disk.entities.find((e) => isObj(e) && e.entityId === "E01") : undefined;
    const a01 = Array.isArray(disk.actions) ? disk.actions.find((a) => isObj(a) && a.actionId === "A01") : undefined;
    const fields = isObj(e01) && isObj(e01.fields) ? e01.fields : {};
    const exe = existsSync(join(materials, "invoice-1", "case-executable.md"))
      ? readFileSync(join(materials, "invoice-1", "case-executable.md"), "utf8")
      : "";
    record(
      "EN11",
      "case construct + writeback",
      "invoiceId/title/amount/status; filledCmd has invoiceId; 产出 status; no node",
      resumed.code === 0 &&
        Boolean(fields.invoiceId) &&
        Boolean(fields.title || fields.name) &&
        fields.amount === 199 &&
        fields.status === "unpaid" &&
        isObj(a01) &&
        a01.cmdStatus === "filled" &&
        String(a01.filledCmd).includes(String(fields.invoiceId)) &&
        exe.includes("invoiceId=") &&
        exe.includes("产出：") &&
        exe.includes("status") &&
        !exe.includes("node "),
      `exit ${resumed.code} fields=${JSON.stringify(fields)} exe=${exe}`,
    );

    const pub = run(
      "scripts/adapters/cli.ts",
      [
        "tool_registry.publish",
        "invoice-create",
        "Create an invoice",
        join(invoiceSlot, "scripts/executors/createinvoice.ts"),
        '[{"name":"title","type":"string","required":true}]',
      ],
      env,
    );
    const exeTool = run(
      "scripts/adapters/cli.ts",
      ["tool_registry.execute", "invoice-create", '{"title":"Published invoice","amount":88}'],
      env,
    );
    const exj = parseJson(exeTool.stdout);
    const nested = isObj(exj) && isObj(exj.data) ? (isObj(exj.data.data) ? exj.data.data : exj.data) : {};
    record(
      "EN12",
      "publish + execute after successful construct",
      "execute returns invoiceId",
      pub.code === 0 && exeTool.code === 0 && isObj(nested) && Boolean(nested.invoiceId),
      exeTool.stdout.slice(0, 220),
    );

    const report = run(
      "scripts/experience_client.ts",
      [
        "report",
        "--body",
        JSON.stringify({
          registry_key: "invoice-draft::create",
          entry_type: "entity",
          tool_binding: { toolType: "skill", resourceId: "invoice" },
          outcome: "success",
        }),
      ],
      env,
    );
    const rj = parseJson(report.stdout);
    record(
      "EN13",
      "experience report after skill success",
      "{ok:true, experience_id}",
      report.code === 0 && isObj(rj) && rj.ok === true && isObj(rj.data) && Boolean(rj.data.experience_id),
      report.stdout.slice(0, 180),
    );
  } finally {
    mock.kill();
  }
  return results;
}

function printReport(): number {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  process.stdout.write("\n=== enterprise onboard report ===\n");
  process.stdout.write(`work dir: ${work}\n`);
  process.stdout.write(`total=${results.length} pass=${pass} fail=${fail}\n\n`);
  const show = new Set(["EN03", "EN04", "EN06", "EN07", "EN10", "EN11", "EN12"]);
  for (const r of results) {
    process.stdout.write(`${r.status}\t${r.id}\t${r.command}\n`);
    if (r.status === "FAIL" || show.has(r.id)) {
      process.stdout.write(`  expected: ${r.expected}\n`);
      process.stdout.write(`  actual:   ${r.actual}\n`);
    }
  }
  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("_verify_enterprise_onboard.ts")) {
  await runEnterpriseOnboardSuite();
  process.exit(printReport());
}
