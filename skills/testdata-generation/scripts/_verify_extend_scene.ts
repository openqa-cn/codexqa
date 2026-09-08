#!/usr/bin/env node
/**
 * Full enterprise extension flow: scaffold a new domain scene, register it,
 * construct via slot scenes, then bind it through the case pipeline.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
export type ExtendResult = {
  id: string;
  command: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
};

const results: ExtendResult[] = [];
const work = mkdtempSync(join(tmpdir(), "dgs-extend-"));
const slotsRoot = join(work, "slots");
const openapiDir = join(work, "openapi");
const walletSlot = join(slotsRoot, "wallet");
const materials = join(work, "cases");
const toolsDir = join(work, "tools");
mkdirSync(openapiDir, { recursive: true });
mkdirSync(slotsRoot, { recursive: true });
mkdirSync(materials, { recursive: true });
mkdirSync(toolsDir, { recursive: true });

const configPath = join(work, "config.yaml");
writeFileSync(
  configPath,
  [
    "workspace:",
    "  testdata_dir: ./testdata",
    "  slot_roots:",
    `    - ${slotsRoot}`,
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

function writeWalletMockScript(dest: string): void {
  writeFileSync(
    dest,
    `#!/usr/bin/env node
import { createServer } from "node:http";
const port = Number(process.env.PORT || 18791);
const store = { wallets: {}, seq: 0 };
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
    if (url === "/v1/wallets" && req.method === "POST") {
      store.seq += 1;
      const walletId = "w_" + store.seq;
      const row = { walletId, name: body.name || "untitled", status: "active", balance: 0, currency: "CNY" };
      store.wallets[walletId] = row;
      return write(200, row);
    }
    if (url.includes("/topup") && req.method === "POST") {
      const walletId = decodeURIComponent(url.split("/")[3] || "");
      const row = store.wallets[walletId];
      if (!row) return write(404, { ok: false, error: "unknown walletId: " + walletId });
      const amount = Math.trunc(Number(body.amount || 100));
      row.balance = Number(row.balance || 0) + amount;
      return write(200, { walletId, balance: row.balance, currency: row.currency, toppedUp: true });
    }
    return write(404, { ok: false, error: "not found: " + url });
  });
});
server.listen(port, "127.0.0.1", () => process.stderr.write("wallet-mock " + port + "\\n"));
`,
    "utf8",
  );
}

async function startWalletMock(port: number): Promise<ChildProcess> {
  const script = join(work, "wallet_mock.ts");
  writeWalletMockScript(script);
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
  throw new Error("wallet mock did not start");
}

function writeWalletExecutors(): void {
  const execDir = join(walletSlot, "scripts", "executors");
  writeFileSync(
    join(execDir, "createwallet.ts"),
    `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";
export async function main(params) {
  if (!params.name) return { success: false, data: null, error: "missing required param: name" };
  const resp = await fetch(BASE_URL + "/v1/wallets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: params.name }),
    signal: AbortSignal.timeout(15000),
  });
  const data = JSON.parse((await resp.text()) || "{}");
  if (!resp.ok) return { success: false, data: null, error: "HTTP " + resp.status };
  return { success: true, data, error: null };
}
function isDirectRun() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return String(process.argv[1] || "").endsWith("createwallet.ts"); }
}
if (isDirectRun() || process.argv.includes("--json")) {
  const idx = process.argv.indexOf("--json");
  const params = idx >= 0 ? JSON.parse(process.argv[idx + 1]) : {};
  const result = await main(params);
  process.stdout.write(JSON.stringify(result, null, 2) + "\\n");
}
`,
    "utf8",
  );
  writeFileSync(
    join(execDir, "topupwallet.ts"),
    `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";
export async function main(params) {
  if (!params.walletId) return { success: false, data: null, error: "missing required param: walletId" };
  const amount = Number(params.amount || 100);
  const resp = await fetch(BASE_URL + "/v1/wallets/" + params.walletId + "/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
    signal: AbortSignal.timeout(15000),
  });
  const data = JSON.parse((await resp.text()) || "{}");
  if (!resp.ok) return { success: false, data: null, error: "HTTP " + resp.status };
  return { success: true, data, error: null };
}
function isDirectRun() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return String(process.argv[1] || "").endsWith("topupwallet.ts"); }
}
if (isDirectRun() || process.argv.includes("--json")) {
  const idx = process.argv.indexOf("--json");
  const params = idx >= 0 ? JSON.parse(process.argv[idx + 1]) : {};
  const result = await main(params);
  process.stdout.write(JSON.stringify(result, null, 2) + "\\n");
}
`,
    "utf8",
  );
}

function writeWalletSlotDocs(): void {
  writeFileSync(
    join(walletSlot, "slot.yaml"),
    [
      "name: wallet",
      "domain: wallet",
      'version: "1.0"',
      "entities:",
      "  - id: wallet-account",
      "    action: create",
      "    executor: scripts/executors/createwallet.ts",
      "    aliases: [wallet, 钱包]",
      "    invokeParams: [name]",
      "actions:",
      "  - id: topup-wallet",
      "    executor: scripts/executors/topupwallet.ts",
      "    aliases: [topup, 充值]",
      "    params: [walletId, amount]",
      "scenes:",
      "  - id: recharge-ready-wallet",
      "    steps:",
      "      - wallet-account::create",
      "      - topup-wallet",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(walletSlot, "SKILL.md"),
    `---
name: wallet
description: >-
  Wallet domain data-build slot. Use when constructing a wallet account
  or a recharge-ready wallet scene (account then topup).
license: Apache-2.0
---

# Wallet data-build slot

## Single-step routing

| User intent | Executor |
|---|---|
| Create wallet account | \`scripts/executors/createwallet.ts\` |
| Top up wallet | \`scripts/executors/topupwallet.ts\` |

## Scene: recharge-ready-wallet

1. Create wallet → \`walletId\`
2. Top up → \`balance\`
3. Return \`walletId\`, \`balance\`, \`currency\`
`,
    "utf8",
  );
  writeFileSync(
    join(walletSlot, "references", "tools-guide.md"),
    `# Wallet tools

| Tool | Method / path | Required params | Output |
|---|---|---|---|
| create wallet | POST /v1/wallets | name | walletId, name, status |
| topup wallet | POST /v1/wallets/{id}/topup | walletId | walletId, balance, currency |
`,
    "utf8",
  );
}

export async function runExtendSceneSuite(): Promise<ExtendResult[]> {
  writeFileSync(
    join(openapiDir, "wallet.yaml"),
    [
      "openapi: 3.0.3",
      "info:",
      "  title: Wallet",
      '  version: "1.0.0"',
      "paths:",
      "  /v1/wallets:",
      "    post:",
      "      operationId: createWallet",
      "      summary: Create a wallet account",
      "      responses:",
      '        "200":',
      "          description: ok",
      "  /v1/wallets/{walletId}/topup:",
      "    post:",
      "      operationId: topupWallet",
      "      summary: Top up a wallet",
      "      parameters:",
      "        - name: walletId",
      "          in: path",
      "          required: true",
      "          schema:",
      "            type: string",
      "      responses:",
      '        "200":',
      "          description: ok",
      "",
    ].join("\n"),
    "utf8",
  );

  const scaffold = run("slot-scaffolder/scripts/scaffold_slot.ts", [
    "--domain",
    "wallet",
    "--openapi",
    openapiDir,
    "--output",
    walletSlot,
  ]);
  const sj = parseJson(scaffold.stdout);
  record(
    "EX01",
    "scaffold wallet slot from OpenAPI",
    "{ok:true} SKILL.md + slot.yaml + 2 stubs",
    scaffold.code === 0 &&
      isObj(sj) &&
      sj.ok === true &&
      existsSync(join(walletSlot, "SKILL.md")) &&
      existsSync(join(walletSlot, "slot.yaml")) &&
      existsSync(join(walletSlot, "scripts", "executors", "createwallet.ts")) &&
      existsSync(join(walletSlot, "scripts", "executors", "topupwallet.ts")),
    scaffold.stdout.slice(0, 200),
  );

  writeWalletExecutors();
  writeWalletSlotDocs();
  record(
    "EX02",
    "fill executors + slot.yaml scene + tools-guide",
    "recharge-ready-wallet scene and aliases present",
    readFileSync(join(walletSlot, "slot.yaml"), "utf8").includes("recharge-ready-wallet") &&
      readFileSync(join(walletSlot, "references", "tools-guide.md"), "utf8").includes("walletId"),
    "docs written",
  );

  const search = run("scripts/search_data_build.ts", [
    "--keywords",
    "wallet",
    "--query",
    "create a wallet account",
    "--registry-key",
    "wallet-account::create",
    "--entry-type",
    "entity",
    "--domain",
    "wallet",
    "--json",
  ]);
  const searchj = parseJson(search.stdout);
  const skills = isObj(searchj) && Array.isArray(searchj.skill_matches) ? searchj.skill_matches : [];
  const hit = skills.find((s) => isObj(s) && s.name === "wallet");
  record(
    "EX03",
    "search after workspace.slot_roots includes new slot",
    "skill_matches.wallet with skillPath",
    search.code === 0 && isObj(hit) && String(hit.skillPath).includes("wallet"),
    search.stdout.slice(0, 220),
  );

  const dest = join(work, "installed-skills");
  mkdirSync(dest, { recursive: true });
  const inst = run("scripts/adapters/cli.ts", ["skill_marketplace.install", "wallet", dest]);
  const instj = parseJson(inst.stdout);
  record(
    "EX04",
    "install wallet slot",
    "{ok:true} copied SKILL.md",
    inst.code === 0 && isObj(instj) && instj.ok === true && existsSync(join(dest, "wallet", "SKILL.md")),
    inst.stdout.slice(0, 180),
  );

  const apis = run("scripts/adapters/cli.ts", ["api_catalog.search", "wallet"]);
  const apiItems = parseJson(apis.stdout);
  record(
    "EX05",
    "api_catalog indexes new OpenAPI",
    "search hits createWallet or topupWallet",
    apis.code === 0 &&
      Array.isArray(apiItems) &&
      apiItems.some((i) => isObj(i) && /wallet/i.test(String(i.operationId || i.path || ""))),
    apis.stdout.slice(0, 180),
  );

  {
    const licenseDir = join(slotsRoot, "license");
    mkdirSync(join(licenseDir, "scripts", "executors"), { recursive: true });
    mkdirSync(join(licenseDir, "assets", "openapi"), { recursive: true });
    writeFileSync(
      join(licenseDir, "SKILL.md"),
      "---\nname: license\ndescription: License domain construction skill\n---\n\n# License\n",
      "utf8",
    );
    writeFileSync(
      join(licenseDir, "assets", "openapi", "license.yaml"),
      [
        "openapi: 3.0.3",
        "info:",
        "  title: License",
        '  version: "1.0.0"',
        "paths:",
        "  /v1/licenses:",
        "    post:",
        "      operationId: createLicense",
        "      summary: Create a license",
        "      responses:",
        '        "200":',
        "          description: ok",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(licenseDir, "scripts", "executors", "createlicense.ts"), "export async function main() { return { success: true, data: {}, error: null }; }\n", "utf8");
    const licenseSearch = run("scripts/search_data_build.ts", ["--keywords", "license", "--json"]);
    const licensej = parseJson(licenseSearch.stdout);
    const licenseHit = isObj(licensej) && Array.isArray(licensej.skill_matches)
      ? licensej.skill_matches.find((s) => isObj(s) && s.name === "license")
      : undefined;
    const inferMan = join(work, "infer-license.json");
    writeFileSync(
      inferMan,
      `${JSON.stringify({
        version: "v5",
        policyVersion: "2.0.0",
        caseId: "infer-license",
        caseSource: { type: "local-file", original: configPath },
        pipelines: { parse: { status: "done" } },
        entities: [
          {
            entityId: "E01",
            entityType: "license",
            constructionStrategy: "tool-build",
            fields: {},
            queries: { angleA: "create a license", angleB: "许可证" },
            toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
          },
        ],
        actions: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const inferSel = run("references/case-data-material-planner/scripts/select_tool.ts", [
      "--manifest",
      inferMan,
      "--type",
      "entity",
      "--id",
      "E01",
    ]);
    const inferj = parseJson(inferSel.stdout);
    const inferBind = isObj(inferj) && isObj(inferj.toolBinding) ? inferj.toolBinding : {};
    record(
      "EX13",
      "drop-in skill without slot.yaml (infer bind)",
      "search finds license; select_tool binds createlicense, no extra marketplace/api paths",
      licenseSearch.code === 0 &&
        isObj(licenseHit) &&
        inferSel.code === 0 &&
        isObj(inferj) &&
        inferj.bound === true &&
        String(inferBind.invokeCmd || "").includes("createlicense"),
      `search=${licenseSearch.stdout.slice(0, 80)} sel=${inferSel.stdout.slice(0, 160)}`,
    );
  }

  const port = 18791;
  const env = { ...isolatedEnv, DATA_BUILD_API_BASE: `http://127.0.0.1:${port}` };
  let mock2: ChildProcess | null = null;
  try {
    mock2 = await startWalletMock(port);
  } catch (err) {
    record("EX-mock", "wallet mock", "health ok", false, err instanceof Error ? err.message : String(err));
    return results;
  }
  try {
    const create = spawnSync(process.execPath, [join(walletSlot, "scripts/executors/createwallet.ts"), "--json", '{"name":"Travel Wallet"}'], {
      cwd: TS_ROOT,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
    const cj = parseJson(create.stdout);
    const cd = isObj(cj) && isObj(cj.data) ? cj.data : {};
    record(
      "EX06",
      "single-step create wallet",
      "walletId + name + status=active",
      create.status === 0 && isObj(cj) && cj.success === true && Boolean(cd.walletId) && cd.name === "Travel Wallet" && cd.status === "active",
      (create.stdout || create.stderr).slice(0, 220),
    );

    const topup = spawnSync(
      process.execPath,
      [join(walletSlot, "scripts/executors/topupwallet.ts"), "--json", JSON.stringify({ walletId: cd.walletId, amount: 250 })],
      { cwd: TS_ROOT, env, encoding: "utf8", timeout: 20_000 },
    );
    const tj = parseJson(topup.stdout);
    const td = isObj(tj) && isObj(tj.data) ? tj.data : {};
    record(
      "EX07",
      "scene recharge-ready-wallet",
      "reuse walletId, return balance=250 and currency",
      topup.status === 0 &&
        isObj(tj) &&
        tj.success === true &&
        td.walletId === cd.walletId &&
        td.balance === 250 &&
        Boolean(td.currency),
      topup.stdout.slice(0, 220),
    );

    const miss = spawnSync(process.execPath, [join(walletSlot, "scripts/executors/topupwallet.ts"), "--json", '{"amount":10}'], {
      cwd: TS_ROOT,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
    const mj = parseJson(miss.stdout);
    record(
      "EX08",
      "topup without walletId",
      "refuse to invent walletId",
      isObj(mj) && mj.success === false && String(mj.error || "").includes("walletId"),
      miss.stdout.slice(0, 160),
    );

    const caseSrc = join(work, "wallet-case.md");
    writeFileSync(
      caseSrc,
      "# 用例标题：钱包充值成功\n\n## 前置条件\n1. 系统中存在一个可用的钱包账户\n\n## 步骤\n1. 对该钱包账户充值 250 元\n\n## 预期\n- 返回 walletId、balance\n",
      "utf8",
    );
    const init = run(
      "references/case-data-material-planner/scripts/pipeline.ts",
      ["--case-id", "wallet-1", "--source", caseSrc, "--materials-root", materials],
      env,
    );
    const need = parseJson(init.stdout);
    record("EX09", "case pipeline first run", "exit 11 parse-case", init.code === 11 && isObj(need) && need.need === "parse-case", init.stdout.slice(0, 160));

    const manPath = join(materials, "wallet-1", "manifest.json");
    const man = JSON.parse(readFileSync(manPath, "utf8")) as JsonObject;
    man.entities = [
      {
        entityId: "E01",
        entityType: "wallet",
        constructionStrategy: "tool-build",
        constraints: "可用的钱包账户",
        fields: { walletId: null },
        queries: { angleA: "创建一个钱包账户", angleB: "wallet account create" },
        toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
        entityStatus: null,
        targetLocation: "precondition.list[0]",
      },
      {
        entityId: "E02",
        entityType: "amount",
        constructionStrategy: "static-value",
        fields: { amount: 250 },
        entityStatus: "verified",
        dataConfidence: 0.85,
        targetLocation: "steps.list[0]",
      },
    ];
    man.actions = [
      {
        actionId: "A01",
        stepIdx: 1,
        actionDesc: "对钱包账户充值",
        queries: { angleA: "wallet topup", angleB: "钱包充值" },
        toolBinding: { toolType: null, resourceId: null, cmdTemplate: null, toolStatus: null },
        paramsFromEntities: [
          { paramName: "walletId", sourceEntityId: "E01", sourceField: "walletId" },
          { paramName: "amount", sourceEntityId: "E02", sourceField: "amount" },
        ],
        outputs: { balance: { description: "余额" } },
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
      "EX10",
      "select_tool binds new wallet slot from slot.yaml",
      "resourceId=wallet invokeCmd createwallet, no LLM",
      select.code === 0 &&
        isObj(selj) &&
        selj.bound === true &&
        selj.needLlm !== true &&
        bind.resourceId === "wallet" &&
        String(bind.invokeCmd).includes("createwallet.ts"),
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
    const exe = existsSync(join(materials, "wallet-1", "case-executable.md"))
      ? readFileSync(join(materials, "wallet-1", "case-executable.md"), "utf8")
      : "";
    record(
      "EX11",
      "case construct+writeback for new scene",
      "fields walletId/name/status; filledCmd has walletId; exe has 产出 balance and no node",
      resumed.code === 0 &&
        Boolean(fields.walletId) &&
        Boolean(fields.name) &&
        fields.status === "active" &&
        isObj(a01) &&
        a01.cmdStatus === "filled" &&
        String(a01.filledCmd).includes(String(fields.walletId)) &&
        exe.includes("walletId=") &&
        exe.includes("产出：") &&
        !exe.includes("node "),
      `exit ${resumed.code} fields=${JSON.stringify(fields)} exe=${exe.slice(0, 160)}`,
    );

    const pub = run(
      "scripts/adapters/cli.ts",
      [
        "tool_registry.publish",
        "wallet-create",
        "Create a wallet account",
        join(walletSlot, "scripts/executors/createwallet.ts"),
        '[{"name":"name","type":"string","required":true}]',
      ],
      env,
    );
    const pubj = parseJson(pub.stdout);
    const exeTool = run("scripts/adapters/cli.ts", ["tool_registry.execute", "wallet-create", '{"name":"Published Wallet"}'], env);
    const exj = parseJson(exeTool.stdout);
    const nested = isObj(exj) && isObj(exj.data) ? (isObj(exj.data.data) ? exj.data.data : exj.data) : {};
    record(
      "EX12",
      "publish + execute new wallet tool",
      "execute returns walletId",
      pub.code === 0 && isObj(pubj) && pubj.ok === true && exeTool.code === 0 && isObj(nested) && Boolean(nested.walletId),
      `pub=${pub.stdout.slice(0, 80)} exe=${exeTool.stdout.slice(0, 140)}`,
    );
  } finally {
    mock2.kill();
  }

  return results;
}

function printReport(): number {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  process.stdout.write("\n=== extend-scene flow report ===\n");
  process.stdout.write(`work dir: ${work}\n`);
  process.stdout.write(`total=${results.length} pass=${pass} fail=${fail}\n\n`);
  const show = new Set(["EX06", "EX07", "EX10", "EX11", "EX12", "EX13"]);
  for (const r of results) {
    process.stdout.write(`${r.status}\t${r.id}\t${r.command}\n`);
    if (r.status === "FAIL" || show.has(r.id)) {
      process.stdout.write(`  expected: ${r.expected}\n`);
      process.stdout.write(`  actual:   ${r.actual}\n`);
    }
  }
  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("_verify_extend_scene.ts")) {
  await runExtendSceneSuite();
  process.exit(printReport());
}
