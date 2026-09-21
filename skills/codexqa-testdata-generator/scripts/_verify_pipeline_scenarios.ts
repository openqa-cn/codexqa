#!/usr/bin/env node
/**
 * Result-correctness suite for every user-facing pipeline / construct path
 * after the code-orchestration rewrite.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PIPE = "references/case-data-material-planner/scripts/pipeline.ts";
const SELECT = "references/case-data-material-planner/scripts/select_tool.ts";
const INVOKE = "references/case-data-material-planner/scripts/invoke_entity.ts";
const BIND = "references/case-data-material-planner/scripts/bind_action.ts";
const MERGE_PATCH = "references/case-data-material-planner/scripts/merge_patch.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type RunResult = { code: number; stdout: string; stderr: string };
export type ScenarioResult = {
  id: string;
  command: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
};

const results: ScenarioResult[] = [];
const work = mkdtempSync(join(tmpdir(), "dgs-pipe-scen-"));
const materials = join(work, "cases");
const toolsDir = join(work, "tools");
mkdirSync(materials, { recursive: true });
mkdirSync(toolsDir, { recursive: true });

const configPath = join(work, "config.yaml");
writeFileSync(
  configPath,
  [
    "workspace:",
    "  testdata_dir: ./testdata",
    "adapters:",
    "  skill_marketplace:",
    "    type: local",
    "    paths:",
    `      - ${TS_ROOT}/slots`,
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

function run(script: string, args: string[], env: NodeJS.ProcessEnv = isolatedEnv): RunResult {
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
    const start = trimmed.lastIndexOf("\n{") >= 0 ? trimmed.lastIndexOf("\n{") + 1 : trimmed.indexOf("{");
    if (start < 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(start)) as Json;
    } catch {
      return undefined;
    }
  }
}

function isObj(v: unknown): v is JsonObject {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function record(id: string, command: string, expected: string, ok: boolean, actual: string): void {
  results.push({ id, command, expected, actual, status: ok ? "PASS" : "FAIL", detail: ok ? undefined : actual });
  if (!ok) process.stderr.write(`FAIL ${id}: ${actual}\n`);
}

function writeJson(path: string, data: JsonObject): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return path;
}

function readObj(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function entityOf(manifest: JsonObject, id: string): JsonObject | undefined {
  return Array.isArray(manifest.entities) ? manifest.entities.find((e) => isObj(e) && e.entityId === id) as JsonObject | undefined : undefined;
}

function actionOf(manifest: JsonObject, id: string): JsonObject | undefined {
  return Array.isArray(manifest.actions) ? manifest.actions.find((a) => isObj(a) && a.actionId === id) as JsonObject | undefined : undefined;
}

function caseSource(caseId: string, body: string): string {
  const path = join(materials, `${caseId}-src.md`);
  writeFileSync(path, body, "utf8");
  return path;
}

function catalogCase(title: string): string {
  return `# 用例标题：${title}\n\n## 前置条件\n1. 系统中存在一个可售的标准商品\n2. 存在测试用户 u_1001\n\n## 步骤\n1. 使用用户 u_1001 对上述商品创建一笔标准商品订单\n\n## 预期\n- 返回 productId、orderId\n`;
}

function baseManifest(overrides: JsonObject): JsonObject {
  return {
    version: "v5",
    policyVersion: "2.0.0",
    caseId: "case",
    knowledgeInputs: { prdSource: null, techDesignSource: null, testPlanId: null },
    pipelines: {
      "knowledge-build": { status: "pending" },
      parse: { status: "pending" },
      preprocess: { status: "pending" },
      "data-track": { status: "pending", phase: "plan" },
      "action-track": { status: "pending", phase: "plan" },
      "lint-gate": { status: "pending", round: 0, verdict: null, failingIds: { entities: [], actions: [] } },
      writeback: { status: "pending" },
    },
    entities: [],
    actions: [],
    confirmations: [],
    lintRounds: [],
    ...overrides,
  };
}

function catalogEntity(id = "E01"): JsonObject {
  return {
    entityId: id,
    entityType: "product",
    constructionStrategy: "tool-build",
    constraints: "可售的标准商品",
    fields: { productId: null },
    queries: { angleA: "创建一个可售的标准商品", angleB: "目录标准商品上架" },
    toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
    dependencies: [],
    entityStatus: null,
    targetLocation: "precondition.list[0]",
  };
}

function userEntity(id = "E02"): JsonObject {
  return {
    entityId: id,
    entityType: "user",
    constructionStrategy: "static-value",
    constraints: "测试用户",
    fields: { userId: "u_1001" },
    queries: { angleA: null, angleB: null },
    toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
    entityStatus: "verified",
    dataConfidence: 0.85,
    targetLocation: "precondition.list[1]",
  };
}

function orderAction(id = "A01"): JsonObject {
  return {
    actionId: id,
    stepIdx: 1,
    actionDesc: "使用用户对可售标准商品创建一笔标准商品订单",
    queries: { angleA: "调用下单接口创建标准商品订单", angleB: "用户预订标准商品下单" },
    toolBinding: { toolType: null, resourceId: null, cmdTemplate: null, toolStatus: null },
    paramsFromEntities: [
      { paramName: "productId", sourceEntityId: "E01", sourceField: "productId" },
      { paramName: "userId", sourceEntityId: "E02", sourceField: "userId" },
    ],
    paramsFromGenerators: [],
    paramsFromPriorActions: [],
    outputs: { orderId: { description: "订单ID" } },
    cmdStatus: null,
    targetLocation: "steps.list[0]",
  };
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

async function withMock<T>(port: number, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T | undefined> {
  const env = { ...isolatedEnv, DATA_BUILD_API_BASE: `http://127.0.0.1:${port}` };
  const child: ChildProcess = spawn(process.execPath, [join(TS_ROOT, "slots/mock_server.ts"), "--port", String(port)], {
    cwd: TS_ROOT,
    env,
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
    record("SC-mock", `mock :${port}`, "health ok", false, "mock did not start");
    child.kill();
    return undefined;
  }
  try {
    return await fn(env);
  } finally {
    child.kill();
  }
}

function assertNeed(id: string, got: RunResult, code: number, need: string): JsonObject | undefined {
  const json = parseJson(got.stdout);
  const ok = got.code === code && isObj(json) && json.need === need;
  record(id, `pipeline/select exit ${code}`, `need:${need}`, ok, `exit ${got.code} ${got.stdout.slice(0, 220)}`);
  return isObj(json) ? json : undefined;
}

export async function runPipelineScenarioSuite(): Promise<ScenarioResult[]> {
  {
    const miss = run(PIPE, []);
    record("SC01", "pipeline no args", "exit 2", miss.code === 2 && miss.stderr.includes("--manifest"), `exit ${miss.code} ${miss.stderr.slice(0, 120)}`);
    const bad = run(PIPE, ["--scope", "explode", "--manifest", join(work, "nope.json")]);
    record("SC02", "pipeline bad --scope", "exit 2", bad.code === 2 && bad.stderr.includes("full|parse-only"), `exit ${bad.code} ${bad.stderr.slice(0, 120)}`);
  }

  {
    const src = caseSource("path-a", catalogCase("知识构建后解析"));
    writeFileSync(join(work, "prd.md"), "# PRD\n目录标准商品下单", "utf8");
    const first = run(PIPE, ["--case-id", "path-a", "--source", src, "--materials-root", materials]);
    assertNeed("SC03", first, 11, "parse-case");
    const manPath = join(materials, "path-a", "manifest.json");
    const prdFirst = run(PIPE, [
      "--case-id",
      "path-a-prd",
      "--source",
      src,
      "--materials-root",
      materials,
      "--prd",
      join(work, "prd.md"),
    ]);
    assertNeed("SC04b", prdFirst, 12, "knowledge-build");
    const man = readObj(manPath);
    (man.knowledgeInputs as JsonObject).prdSource = join(work, "prd.md");
    writeJson(manPath, man);
    const kb = run(PIPE, ["--manifest", manPath, "--resume"]);
    assertNeed("SC04", kb, 12, "knowledge-build");
    const ctx = writeJson(join(materials, "business-context.json"), {
      configMap: { "promo.enabled": { serviceId: "promo-svc" } },
    });
    const afterCtx = run(PIPE, ["--manifest", manPath, "--context", ctx, "--resume"]);
    assertNeed("SC05", afterCtx, 11, "parse-case");
    const afterKb = readObj(manPath);
    record(
      "SC06",
      "Path A with context file",
      "knowledge-build status=done",
      isObj(afterKb.pipelines) && isObj(afterKb.pipelines["knowledge-build"]) && afterKb.pipelines["knowledge-build"].status === "done",
      JSON.stringify(afterKb.pipelines).slice(0, 200),
    );
  }

  await withMock(18771, async (env) => {
    const src = caseSource("path-b-scopes", catalogCase("范围变体"));
    const init = run(PIPE, ["--case-id", "path-b-scopes", "--source", src, "--materials-root", materials], env);
    assertNeed("SC07", init, 11, "parse-case");
    const manPath = join(materials, "path-b-scopes", "manifest.json");
    const man = readObj(manPath);
    man.entities = [catalogEntity(), userEntity()];
    man.actions = [orderAction()];
    (man.pipelines as JsonObject).parse = { status: "done" };
    writeJson(manPath, man);

    const parseOnly = run(PIPE, ["--manifest", manPath, "--scope", "parse-only"], env);
    const po = parseJson(parseOnly.stdout);
    const afterParseOnly = readObj(manPath);
    const e01po = entityOf(afterParseOnly, "E01");
    record(
      "SC08",
      "scope=parse-only after parse",
      "exit 0 stage=parse and E01 not invoked",
      parseOnly.code === 0 && isObj(po) && po.stage === "parse" && isObj(e01po) && (e01po.entityStatus === null || e01po.entityStatus === undefined),
      `exit ${parseOnly.code} status=${String(e01po?.entityStatus)} ${parseOnly.stdout.slice(0, 160)}`,
    );
    record(
      "SC09",
      "parse-only does not write case-executable",
      "file absent",
      !existsSync(join(materials, "path-b-scopes", "case-executable.md")),
      "present",
    );

    const execEmpty = run(PIPE, [
      "--case-id",
      "exec-unparsed",
      "--source",
      src,
      "--materials-root",
      materials,
      "--scope",
      "execution",
    ], env);
    assertNeed("SC10", execEmpty, 11, "parse-case");

    const full = run(PIPE, ["--manifest", manPath, "--resume", "--scope", "full"], env);
    const fullj = parseJson(full.stdout);
    const done = readObj(manPath);
    const e01 = entityOf(done, "E01");
    const e02 = entityOf(done, "E02");
    const a01 = actionOf(done, "A01");
    const exe = existsSync(join(materials, "path-b-scopes", "case-executable.md"))
      ? readFileSync(join(materials, "path-b-scopes", "case-executable.md"), "utf8")
      : "";
    const fields = isObj(e01) && isObj(e01.fields) ? e01.fields : {};
    record(
      "SC11",
      "Path B full construct+writeback",
      "verified product fields + filled order + clean executable",
      full.code === 0 &&
        isObj(fullj) &&
        fullj.ok === true &&
        fields.kind === "standard" &&
        Boolean(fields.productId) &&
        Boolean(fields.name) &&
        fields.city === "demo-city" &&
        isObj(e02) &&
        isObj(e02.fields) &&
        e02.fields.userId === "u_1001" &&
        isObj(a01) &&
        a01.cmdStatus === "filled" &&
        String(a01.filledCmd).includes(String(fields.productId)) &&
        String(a01.filledCmd).includes("u_1001") &&
        exe.includes("kind=standard") &&
        exe.includes("入参：") &&
        !exe.includes("node ") &&
        !exe.includes("8765") &&
        !exe.includes("18771"),
      `exit ${full.code} product=${JSON.stringify(fields)} cmd=${String(a01?.filledCmd).slice(0, 80)} exe=${exe.slice(0, 160)}`,
    );

    const wbOnly = run(PIPE, ["--manifest", manPath, "--scope", "writeback-only"], env);
    const wbj = parseJson(wbOnly.stdout);
    record(
      "SC12",
      "scope=writeback-only",
      "exit 0 stage=writeback",
      wbOnly.code === 0 && isObj(wbj) && wbj.stage === "writeback",
      `exit ${wbOnly.code} ${wbOnly.stdout.slice(0, 160)}`,
    );

    {
      const reuseSrc = caseSource("reuse", "# 用例\n\n## 前置条件\n1. 商品\n2. 复用商品\n\n## 步骤\n1. 校验\n");
      run(PIPE, ["--case-id", "reuse", "--source", reuseSrc, "--materials-root", materials], env);
      const reusePath = join(materials, "reuse", "manifest.json");
      const rm = readObj(reusePath);
      rm.entities = [
        catalogEntity("E01"),
        {
          entityId: "E10",
          entityType: "product-ref",
          constructionStrategy: "tool-build",
          constraints: "复用已构造商品",
          fields: { productId: null },
          queries: { angleA: "reuse existing product", angleB: "copy product fields" },
          toolBinding: { toolType: "reuse", resourceId: "E01.productId", invokeCmd: null, toolStatus: null },
          entityStatus: null,
          targetLocation: "precondition.list[1]",
        },
      ];
      rm.actions = [];
      (rm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(reusePath, rm);
      const reuseRun = run(PIPE, ["--manifest", reusePath, "--resume"], env);
      const reuseMan = readObj(reusePath);
      const srcProduct = entityOf(reuseMan, "E01");
      const copied = entityOf(reuseMan, "E10");
      const srcFields = isObj(srcProduct) && isObj(srcProduct.fields) ? srcProduct.fields : {};
      const copyFields = isObj(copied) && isObj(copied.fields) ? copied.fields : {};
      record(
        "SC13",
        "toolType=reuse copies source fields without LLM",
        "E10.productId == E01.productId, exit 0",
        reuseRun.code === 0 && Boolean(srcFields.productId) && copyFields.productId === srcFields.productId && copyFields.kind === "standard",
        `exit ${reuseRun.code} src=${JSON.stringify(srcFields)} copy=${JSON.stringify(copyFields)} ${reuseRun.stdout.slice(0, 120)}`,
      );
    }

    {
      const apiSrc = caseSource("api-setup", "# 用例\n\n## 前置条件\n1. 待提交配置\n");
      run(PIPE, ["--case-id", "api-setup", "--source", apiSrc, "--materials-root", materials], env);
      const apiPath = join(materials, "api-setup", "manifest.json");
      const am = readObj(apiPath);
      am.entities = [
        {
          entityId: "E20",
          entityType: "flag",
          constructionStrategy: "tool-build",
          constraints: "仅生成命令不提交",
          fields: { flag: "draft" },
          queries: { angleA: "prepare api setup command", angleB: "do not submit" },
          toolBinding: { toolType: "api-setup", resourceId: "promo-flag", invokeCmd: "node SHOULD_NOT_RUN.ts", toolStatus: null },
          entityStatus: null,
          targetLocation: "precondition.list[0]",
        },
      ];
      (am.pipelines as JsonObject).parse = { status: "done" };
      writeJson(apiPath, am);
      const apiRun = run(PIPE, ["--manifest", apiPath, "--resume"], env);
      const apiMan = readObj(apiPath);
      const e20 = entityOf(apiMan, "E20");
      record(
        "SC14",
        "toolType=api-setup",
        "unverified, fields unchanged, no executor run",
        apiRun.code === 0 && isObj(e20) && e20.entityStatus === "unverified" && isObj(e20.fields) && e20.fields.flag === "draft" && String(e20.verifyNote).includes("deferred"),
        `exit ${apiRun.code} ${JSON.stringify(e20)}`,
      );
    }

    {
      const scriptPath = join(work, "local-script.ts");
      writeFileSync(
        scriptPath,
        `#!/usr/bin/env node
const i = process.argv.indexOf("--json");
const params = JSON.parse(process.argv[i + 1] || "{}");
console.log(JSON.stringify({ success: true, data: { licenseId: "c_9", name: params.name || "spring", discount: 0.2 } }));
`,
        "utf8",
      );
      const scSrc = caseSource("script", "# 用例\n\n## 前置条件\n1. 许可证\n");
      run(PIPE, ["--case-id", "script", "--source", scSrc, "--materials-root", materials], env);
      const scPath = join(materials, "script", "manifest.json");
      const sm = readObj(scPath);
      sm.entities = [
        {
          entityId: "E30",
          entityType: "license",
          constructionStrategy: "tool-build",
          fields: { licenseId: null },
          queries: { angleA: "create license", angleB: "issue license" },
          toolBinding: {
            toolType: "script",
            resourceId: "local-script",
            invokeCmd: `node ${scriptPath} --json '{"name":"spring"}'`,
            toolStatus: "available",
          },
          entityStatus: null,
          targetLocation: "precondition.list[0]",
        },
      ];
      (sm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(scPath, sm);
      const scRun = run(PIPE, ["--manifest", scPath, "--resume"], env);
      const scMan = readObj(scPath);
      const e30 = entityOf(scMan, "E30");
      const sf = isObj(e30) && isObj(e30.fields) ? e30.fields : {};
      record(
        "SC15",
        "toolType=script local executor",
        "licenseId=c_9 discount=0.2 merged",
        scRun.code === 0 && sf.licenseId === "c_9" && sf.discount === 0.2 && sf.name === "spring",
        `exit ${scRun.code} ${JSON.stringify(sf)} ${scRun.stderr.slice(0, 80)}`,
      );
    }

    {
      const cfgSrc = caseSource("config", "# 用例\n\n## 前置条件\n1. 打开促销开关\n");
      const ctx = writeJson(join(work, "cfg-context.json"), { configMap: { "promo.enabled": { serviceId: "promo-svc" } } });
      run(PIPE, ["--case-id", "config", "--source", cfgSrc, "--materials-root", materials, "--context", ctx], env);
      const cfgPath = join(materials, "config", "manifest.json");
      const cm = readObj(cfgPath);
      cm.entities = [
        {
          entityId: "E40",
          entityType: "配置项",
          constructionStrategy: "config",
          constraints: "促销开关",
          fields: {},
          targetValues: { "promo.enabled": { value: "true" } },
          queries: { angleA: "打开促销", angleB: "promo flag" },
          entityStatus: null,
          targetLocation: "precondition.list[0]",
        },
      ];
      (cm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(cfgPath, cm);
      const cfgRun = run(PIPE, ["--manifest", cfgPath, "--context", ctx, "--resume"], env);
      const cfgMan = readObj(cfgPath);
      const e40 = entityOf(cfgMan, "E40");
      const exe = existsSync(join(materials, "config", "case-executable.md"))
        ? readFileSync(join(materials, "config", "case-executable.md"), "utf8")
        : "";
      record(
        "SC16",
        "constructionStrategy=config via --context",
        "fields contain config-store set, executable has no node/config-store",
        cfgRun.code === 0 &&
          isObj(e40) &&
          isObj(e40.fields) &&
          String(e40.fields["promo.enabled"]).includes("config-store set promo-svc promo.enabled true") &&
          exe.includes("promo.enabled") &&
          !exe.includes("node ") &&
          !exe.includes("config-store"),
        `exit ${cfgRun.code} fields=${JSON.stringify(e40?.fields)} exe=${exe.slice(0, 180)}`,
      );
    }

    {
      const rtSrc = caseSource("runtime", "# 用例\n\n## 前置条件\n1. 可售标准商品\n2. 订单号运行时产出\n3. 测试用户\n\n## 步骤\n1. 下单\n");
      run(PIPE, ["--case-id", "runtime", "--source", rtSrc, "--materials-root", materials], env);
      const rtPath = join(materials, "runtime", "manifest.json");
      const rtm = readObj(rtPath);
      rtm.entities = [
        catalogEntity(),
        {
          entityId: "E50",
          entityType: "订单号",
          constructionStrategy: "runtime",
          fields: { orderId: null },
          runtimeSource: { sourceActionId: "A01", sourceOutputField: "orderId" },
          entityStatus: "runtime-deferred",
          targetLocation: "precondition.list[1]",
        },
        { ...userEntity(), targetLocation: "precondition.list[2]" },
      ];
      rtm.actions = [orderAction()];
      (rtm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(rtPath, rtm);
      const rtRun = run(PIPE, ["--manifest", rtPath, "--resume"], env);
      const exe = existsSync(join(materials, "runtime", "case-executable.md"))
        ? readFileSync(join(materials, "runtime", "case-executable.md"), "utf8")
        : "";
      record(
        "SC17",
        "constructionStrategy=runtime",
        "executable 由步骤 A01 执行时产出 orderId",
        rtRun.code === 0 && exe.includes("由步骤") && exe.includes("orderId") && !exe.includes("node "),
        `exit ${rtRun.code} exe=${exe.slice(0, 200)}`,
      );
    }

    {
      const depSrc = caseSource("deps", "# 用例\n\n## 前置条件\n1. 商品\n2. 额度\n3. 用户\n");
      run(PIPE, ["--case-id", "deps", "--source", depSrc, "--materials-root", materials], env);
      const depPath = join(materials, "deps", "manifest.json");
      const dm = readObj(depPath);
      dm.entities = [
        catalogEntity("E01"),
        userEntity("E02"),
        {
          entityId: "E03",
          entityType: "credit",
          constructionStrategy: "tool-build",
          constraints: "账户额度入账",
          fields: { productId: null, userId: "u_1001", creditBalance: null },
          queries: { angleA: "给用户开通商品账户额度", angleB: "账户额度" },
          toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
          dependencies: [{ entityId: "E01", field: "productId", asParam: "productId" }],
          entityStatus: null,
          targetLocation: "precondition.list[1]",
        },
      ];
      (dm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(depPath, dm);
      const blocked = run(INVOKE, ["--manifest", depPath, "--entity-id", "E03"], env);
      const blockedj = parseJson(blocked.stdout);
      record(
        "SC18",
        "invoke dependent entity before source",
        "missing-dependency",
        blocked.code === 1 && isObj(blockedj) && blockedj.entityStatus === "missing-dependency",
        `exit ${blocked.code} ${blocked.stdout.slice(0, 200)}`,
      );
      const depRun = run(PIPE, ["--manifest", depPath, "--resume"], env);
      const depMan = readObj(depPath);
      const productRow = entityOf(depMan, "E01");
      const credit = entityOf(depMan, "E03");
      const hf = isObj(productRow) && isObj(productRow.fields) ? productRow.fields : {};
      const pf = isObj(credit) && isObj(credit.fields) ? credit.fields : {};
      record(
        "SC19",
        "pipeline topo + credit depend on productId",
        "E03.productId == E01.productId and creditBalance from enroll",
        depRun.code === 0 && Boolean(hf.productId) && pf.productId === hf.productId && Number(pf.creditBalance) >= 500,
        `exit ${depRun.code} product=${JSON.stringify(hf)} credit=${JSON.stringify(pf)} ${depRun.stderr.slice(0, 80)}`,
      );
    }

    {
      const limitedSrc = caseSource("limited", "# 用例\n\n## 前置条件\n1. 限量商品\n");
      run(PIPE, ["--case-id", "limited", "--source", limitedSrc, "--materials-root", materials], env);
      const hp = join(materials, "limited", "manifest.json");
      const hm = readObj(hp);
      hm.entities = [
        {
          entityId: "E01",
          entityType: "product",
          constructionStrategy: "tool-build",
          constraints: "可售限量商品",
          fields: { productId: null },
          queries: { angleA: "创建一个限量商品", angleB: "limited product product" },
          toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
          entityStatus: null,
          targetLocation: "precondition.list[0]",
        },
      ];
      (hm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(hp, hm);
      const sel = run(SELECT, ["--manifest", hp, "--type", "entity", "--id", "E01"], env);
      const selj = parseJson(sel.stdout);
      const invokeCmd = isObj(selj) && isObj(selj.toolBinding) ? String(selj.toolBinding.invokeCmd || "") : "";
      record(
        "SC20",
        "select_tool limited heuristic",
        "create_limited_product.ts",
        sel.code === 0 && invokeCmd.includes("create_limited_product.ts"),
        `exit ${sel.code} ${sel.stdout.slice(0, 220)}`,
      );
      const limitedRun = run(PIPE, ["--manifest", hp, "--resume"], env);
      const limitedMan = readObj(hp);
      const he = entityOf(limitedMan, "E01");
      const hf = isObj(he) && isObj(he.fields) ? he.fields : {};
      record(
        "SC21",
        "limited product construct",
        "kind=limited validHours=4",
        limitedRun.code === 0 && hf.kind === "limited" && hf.validHours === 4,
        `exit ${limitedRun.code} ${JSON.stringify(hf)}`,
      );
    }

    {
      const distSrc = caseSource("dist", "# 用例\n\n## 前置条件\n1. 分销商\n2. 商品\n\n## 步骤\n1. 绑定库存并报价\n");
      run(PIPE, ["--case-id", "dist", "--source", distSrc, "--materials-root", materials], env);
      const dp = join(materials, "dist", "manifest.json");
      const dm = readObj(dp);
      dm.entities = [
        {
          entityId: "E01",
          entityType: "distributor",
          constructionStrategy: "tool-build",
          constraints: "测试分销商",
          fields: { distributorId: null },
          queries: { angleA: "创建一个测试分销商", angleB: "distributor onboard" },
          toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
          entityStatus: null,
          targetLocation: "precondition.list[0]",
        },
        catalogEntity("E02"),
      ];
      dm.actions = [
        {
          actionId: "A01",
          stepIdx: 1,
          actionDesc: "把商品库存绑定到分销商后浏览报价",
          queries: { angleA: "分销商绑定库存后报价", angleB: "browse and quote" },
          toolBinding: { toolType: null, resourceId: null, cmdTemplate: null, toolStatus: null },
          paramsFromEntities: [
            { paramName: "distributorId", sourceEntityId: "E01", sourceField: "distributorId" },
            { paramName: "productId", sourceEntityId: "E02", sourceField: "productId" },
          ],
          paramsFromGenerators: [],
          paramsFromPriorActions: [],
          outputs: { price: { description: "报价" } },
          cmdStatus: null,
          targetLocation: "steps.list[0]",
        },
      ];
      (dm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(dp, dm);
      const distRun = run(PIPE, ["--manifest", dp, "--resume"], env);
      const distMan = readObj(dp);
      const d1 = entityOf(distMan, "E01");
      const h2 = entityOf(distMan, "E02");
      const a1 = actionOf(distMan, "A01");
      const exe = existsSync(join(materials, "dist", "case-executable.md"))
        ? readFileSync(join(materials, "dist", "case-executable.md"), "utf8")
        : "";
      record(
        "SC22",
        "distribution scene construct+bind",
        "distributorId + productId + filled quote cmd, clean exe",
        distRun.code === 0 &&
          isObj(d1) &&
          isObj(d1.fields) &&
          Boolean(d1.fields.distributorId) &&
          isObj(h2) &&
          isObj(h2.fields) &&
          Boolean(h2.fields.productId) &&
          isObj(a1) &&
          a1.cmdStatus === "filled" &&
          String(a1.filledCmd).includes(String(d1.fields.distributorId)) &&
          exe.includes("distributorId=") &&
          !exe.includes("node "),
        `exit ${distRun.code} ${distRun.stderr.slice(0, 120)} d=${JSON.stringify(d1?.fields)} a=${String(a1?.filledCmd).slice(0, 80)}`,
      );
    }
  });

  {
    const src = caseSource("bind-gen", catalogCase("绑定变体"));
    run(PIPE, ["--case-id", "bind-gen", "--source", src, "--materials-root", materials]);
    const bp = join(materials, "bind-gen", "manifest.json");
    const bm = readObj(bp);
    bm.entities = [
      { ...catalogEntity(), entityStatus: "verified", dataConfidence: 0.85, fields: { productId: "p_fixed" }, toolBinding: { toolType: "skill", resourceId: "catalog", invokeCmd: "node x.ts", toolStatus: "available" } },
      userEntity(),
    ];
    bm.actions = [
      {
        ...orderAction("A01"),
        toolBinding: {
          toolType: "skill",
          resourceId: "catalog",
          cmdTemplate: `node scripts/executors/create_order.ts --json '{"productId":"__productId__","userId":"__userId__","traceId":"__traceId__"}'`,
          toolStatus: "available",
        },
        paramsFromGenerators: [{ paramName: "traceId", generator: "UUID" }],
      },
    ];
    writeJson(bp, bm);
    const bind = run(BIND, ["--manifest", bp, "--action-id", "A01"]);
    const bj = parseJson(bind.stdout);
    record(
      "SC23",
      "bind paramsFromEntities + UUID generator",
      "filledCmd has p_fixed/u_1001 and $(uuidgen)",
      bind.code === 0 &&
        isObj(bj) &&
        bj.cmdStatus === "filled" &&
        String(bj.filledCmd).includes("p_fixed") &&
        String(bj.filledCmd).includes("u_1001") &&
        String(bj.filledCmd).includes("$(uuidgen)"),
      bind.stdout.slice(0, 240),
    );

    const prior = {
      ...orderAction("A02"),
      stepIdx: 2,
      actionDesc: "用上一步订单号查询",
      toolBinding: {
        toolType: "skill",
        resourceId: "catalog",
        cmdTemplate: `node scripts/executors/create_order.ts --json '{"productId":"__productId__","userId":"__userId__","orderId":"__orderId__"}'`,
        toolStatus: "available",
      },
      paramsFromEntities: [
        { paramName: "productId", sourceEntityId: "E01", sourceField: "productId" },
        { paramName: "userId", sourceEntityId: "E02", sourceField: "userId" },
      ],
      paramsFromPriorActions: [{ paramName: "orderId", sourceActionId: "A01", sourceOutputField: "orderId" }],
      outputs: { ok: { description: "ok" } },
      targetLocation: "steps.list[1]",
    };
    const bm2 = readObj(bp);
    (bm2.actions as Json[]).push(prior);
    writeJson(bp, bm2);
    const bind2 = run(BIND, ["--manifest", bp, "--action-id", "A02"]);
    const b2 = parseJson(bind2.stdout);
    record(
      "SC24",
      "bind paramsFromPriorActions",
      "filledCmd contains <<A01.orderId>>",
      bind2.code === 0 && isObj(b2) && b2.cmdStatus === "filled" && String(b2.filledCmd).includes("<<A01.orderId>>"),
      bind2.stdout.slice(0, 220),
    );

    const residual = {
      ...orderAction("A03"),
      toolBinding: {
        toolType: "skill",
        resourceId: "catalog",
        cmdTemplate: `node x.ts --json '{"missing":"__notBound__"}'`,
        toolStatus: "available",
      },
      paramsFromEntities: [],
    };
    const bm3 = readObj(bp);
    (bm3.actions as Json[]).push(residual);
    writeJson(bp, bm3);
    const bind3 = run(BIND, ["--manifest", bp, "--action-id", "A03"]);
    const b3 = parseJson(bind3.stdout);
    record(
      "SC25",
      "bind residual placeholder",
      "cmdStatus=gen-failed",
      bind3.code === 1 && isObj(b3) && b3.cmdStatus === "gen-failed" && String(b3.failReason).includes("residual"),
      bind3.stdout.slice(0, 220),
    );

    const missing = {
      ...orderAction("A04"),
      toolBinding: {
        toolType: "skill",
        resourceId: "catalog",
        cmdTemplate: `node x.ts --json '{"productId":"__productId__"}'`,
        toolStatus: "available",
      },
      paramsFromEntities: [{ paramName: "productId", sourceEntityId: "E99", sourceField: "productId" }],
    };
    const bm4 = readObj(bp);
    (bm4.actions as Json[]).push(missing);
    writeJson(bp, bm4);
    const bind4 = run(BIND, ["--manifest", bp, "--action-id", "A04"]);
    const b4 = parseJson(bind4.stdout);
    record(
      "SC26",
      "bind missing source entity",
      "cmdStatus=missing-param or gen-failed",
      bind4.code === 1 && isObj(b4) && (b4.cmdStatus === "missing-param" || b4.cmdStatus === "gen-failed"),
      bind4.stdout.slice(0, 220),
    );
  }

  {
    const cachePath = writeJson(join(work, "tool-binding-cache.json"), {
      version: "2.0",
      entityBindings: {
        "product::create": {
          status: "proven",
          toolBinding: {
            toolType: "skill",
            resourceId: "catalog",
            invokeCmd: "node scripts/executors/create_product.ts --json '{\"name\":\"${name}\",\"city\":\"from-cache\"}'",
            toolStatus: "available",
          },
          provenInvocation: {
            invokeCmdTemplate: "node scripts/executors/create_product.ts --json '{\"name\":\"${name}\",\"city\":\"from-cache\"}'",
          },
        },
      },
      actionBindings: {},
    });
    const src = caseSource("cache", catalogCase("缓存命中"));
    run(PIPE, ["--case-id", "cache", "--source", src, "--materials-root", materials]);
    const cp = join(materials, "cache", "manifest.json");
    const cm = readObj(cp);
    cm.entities = [catalogEntity()];
    writeJson(cp, cm);
    const sel = run(SELECT, ["--manifest", cp, "--type", "entity", "--id", "E01", "--cache", cachePath]);
    const sj = parseJson(sel.stdout);
    record(
      "SC27",
      "select_tool cache proven",
      "bound invokeCmd city=from-cache, no LLM",
      sel.code === 0 && isObj(sj) && sj.bound === true && String(isObj(sj.toolBinding) ? sj.toolBinding.invokeCmd : "").includes("from-cache"),
      sel.stdout.slice(0, 240),
    );
  }

  {
    const srcA = caseSource("batch-a", catalogCase("批次A"));
    const srcB = caseSource("batch-b", "# 用例标题：批次B\n\n## 前置条件\n1. 存在测试用户 u_9\n\n## 步骤\n1. 校验用户\n");
    await withMock(18772, async (env) => {
      const aInit = run(PIPE, ["--case-id", "batch-a", "--source", srcA, "--materials-root", materials], env);
      const bInit = run(PIPE, ["--case-id", "batch-b", "--source", srcB, "--materials-root", materials], env);
      assertNeed("SC28a", aInit, 11, "parse-case");
      assertNeed("SC28b", bInit, 11, "parse-case");
      const ap = join(materials, "batch-a", "manifest.json");
      const bp = join(materials, "batch-b", "manifest.json");
      const am = readObj(ap);
      am.entities = [catalogEntity(), userEntity()];
      am.actions = [orderAction()];
      (am.pipelines as JsonObject).parse = { status: "done" };
      writeJson(ap, am);
      const bm = readObj(bp);
      bm.entities = [
        {
          ...userEntity("E01"),
          fields: { userId: "u_9" },
          targetLocation: "precondition.list[0]",
        },
      ];
      (bm.pipelines as JsonObject).parse = { status: "done" };
      writeJson(bp, bm);
      const aRun = run(PIPE, ["--manifest", ap, "--resume"], env);
      const bRun = run(PIPE, ["--manifest", bp, "--resume"], env);
      const aMan = readObj(ap);
      const bMan = readObj(bp);
      const aProduct = entityOf(aMan, "E01");
      const bUser = entityOf(bMan, "E01");
      record(
        "SC28",
        "Path C two isolated pipelines",
        "A has productId, B has userId=u_9 and no product; both exit 0",
        aRun.code === 0 &&
          bRun.code === 0 &&
          isObj(aProduct) &&
          isObj(aProduct.fields) &&
          Boolean(aProduct.fields.productId) &&
          isObj(bUser) &&
          isObj(bUser.fields) &&
          bUser.fields.userId === "u_9" &&
          !("productId" in bUser.fields),
        `A=${aRun.code} B=${bRun.code} aFields=${JSON.stringify(aProduct?.fields)} bFields=${JSON.stringify(bUser?.fields)}`,
      );
    });
  }

  {
    const src = caseSource("merge-acl", catalogCase("patch ACL"));
    run(PIPE, ["--case-id", "merge-acl", "--source", src, "--materials-root", materials]);
    const mp = join(materials, "merge-acl", "manifest.json");
    const mm = readObj(mp);
    mm.entities = [catalogEntity()];
    writeJson(mp, mm);
    const goodPatch = writeJson(join(materials, "merge-acl", "patches", "select-tool.E01.patch.json"), {
      agent: "select-tool",
      targetType: "entity",
      targetId: "E01",
      timestamp: new Date().toISOString(),
      fields: {
        toolBinding: {
          toolType: "skill",
          resourceId: "catalog",
          invokeCmd: "node scripts/executors/create_product.ts --json '{\"name\":\"${name}\"}'",
          toolStatus: "available",
        },
      },
    });
    const good = run(MERGE_PATCH, ["--manifest", mp, "--patch", goodPatch]);
    const goodj = parseJson(good.stdout);
    const after = entityOf(readObj(mp), "E01");
    record(
      "SC29",
      "merge_patch select-tool toolBinding only",
      "merged=1 and invokeCmd written",
      good.code === 0 && isObj(goodj) && goodj.merged === 1 && isObj(after) && isObj(after.toolBinding) && String(after.toolBinding.invokeCmd).includes("create_product.ts"),
      good.stdout.slice(0, 200),
    );
    const badPatch = writeJson(join(materials, "merge-acl", "patches", "select-tool.E01.bad.patch.json"), {
      agent: "select-tool",
      targetType: "entity",
      targetId: "E01",
      timestamp: new Date().toISOString(),
      fields: { toolBinding: { toolType: "skill" }, fields: { productId: "hacked" } },
    });
    const bad = run(MERGE_PATCH, ["--manifest", mp, "--patch", badPatch]);
    const badj = parseJson(bad.stdout);
    record(
      "SC30",
      "merge_patch select-tool cannot write fields",
      "errors and productId not hacked",
      bad.code !== 0 || (isObj(badj) && Array.isArray(badj.errors) && badj.errors.length > 0),
      bad.stdout.slice(0, 220),
    );
    const afterBad = entityOf(readObj(mp), "E01");
    record(
      "SC31",
      "overreaching select-tool patch rejected",
      "fields.productId still null",
      isObj(afterBad) && isObj(afterBad.fields) && afterBad.fields.productId == null,
      JSON.stringify(afterBad?.fields),
    );
  }

  {
    const envSrc = caseSource("envelope", catalogCase("剥 envelope"));
    const man = writeJson(join(work, "envelope-manifest.json"), baseManifest({
      caseId: "envelope",
      caseSource: { type: "local-file", original: envSrc },
      entities: [
        {
          entityId: "E01",
          entityType: "product",
          constructionStrategy: "tool-build",
          fields: { productId: null, note: null },
          toolBinding: {
            toolType: "script",
            resourceId: "env",
            invokeCmd: `node ${join(work, "env-script.ts")} --json '{}'`,
            toolStatus: "available",
          },
        },
      ],
    }));
    writeFileSync(
      join(work, "env-script.ts"),
      `#!/usr/bin/env node
console.log(JSON.stringify({
  success: true,
  ok: true,
  message: "ignore me",
  data: { productId: "p_env", name: "Env Item", success: true, cmd: "node evil.ts --json '{}'" }
}));
`,
      "utf8",
    );
    const inv = run(INVOKE, ["--manifest", man, "--entity-id", "E01"]);
    const ij = parseJson(inv.stdout);
    const fields = isObj(ij) && isObj(ij.fields) ? ij.fields : {};
    record(
      "SC32",
      "invoke strips envelope + implementation cmd",
      "productId/name kept; success/message/cmd dropped",
      inv.code === 0 && fields.productId === "p_env" && fields.name === "Env Item" && !("success" in fields) && !("message" in fields) && !("cmd" in fields),
      inv.stdout.slice(0, 240),
    );
  }

  {
    const emptySrc = caseSource("empty-actions", "# 用例\n\n## 前置条件\n1. 商品\n");
    await withMock(18773, async (env) => {
      run(PIPE, ["--case-id", "empty-actions", "--source", emptySrc, "--materials-root", materials], env);
      const ep = join(materials, "empty-actions", "manifest.json");
      const em = readObj(ep);
      em.entities = [catalogEntity()];
      em.actions = [];
      (em.pipelines as JsonObject).parse = { status: "done" };
      writeJson(ep, em);
      const emptyRun = run(PIPE, ["--manifest", ep, "--resume"], env);
      const exe = existsSync(join(materials, "empty-actions", "case-executable.md"))
        ? readFileSync(join(materials, "empty-actions", "case-executable.md"), "utf8")
        : "";
      const man = readObj(ep);
      const e01 = entityOf(man, "E01");
      record(
        "SC33",
        "entities-only case (empty action track)",
        "product fields written, no 入参 required",
        emptyRun.code === 0 && isObj(e01) && isObj(e01.fields) && Boolean(e01.fields.productId) && exe.includes("kind=standard") && !exe.includes("node "),
        `exit ${emptyRun.code} exe=${exe.slice(0, 160)}`,
      );
    });
  }

  {
    const toolScript = join(work, "unique-widget.ts");
    writeFileSync(
      toolScript,
      `#!/usr/bin/env node
console.log(JSON.stringify({ success: true, data: { widgetId: "w_1", color: "red" } }));
`,
      "utf8",
    );
    const pub = run("scripts/adapters/cli.ts", [
      "tool_registry.publish",
      "unique-widget-factory",
      "construct a unique widget factory item",
      toolScript,
      '[{"name":"name","type":"string","required":false}]',
    ]);
    const pubj = parseJson(pub.stdout);
    record("SC34", "publish unique widget tool", "{ok:true}", pub.code === 0 && isObj(pubj) && pubj.ok === true, pub.stdout.slice(0, 160));
    const src = caseSource("unique-tool", "# 用例\n\n## 前置条件\n1. widget\n");
    run(PIPE, ["--case-id", "unique-tool", "--source", src, "--materials-root", materials]);
    const up = join(materials, "unique-tool", "manifest.json");
    const um = readObj(up);
    um.entities = [
      {
        entityId: "E01",
        entityType: "widget",
        constructionStrategy: "tool-build",
        constraints: "unique widget factory",
        fields: { widgetId: null },
        queries: { angleA: "construct a unique widget factory item", angleB: "unique widget factory" },
        toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
        entityStatus: null,
        targetLocation: "precondition.list[0]",
      },
    ];
    (um.pipelines as JsonObject).parse = { status: "done" };
    writeJson(up, um);
    const sel = run(SELECT, ["--manifest", up, "--type", "entity", "--id", "E01"]);
    const sj = parseJson(sel.stdout);
    record(
      "SC35",
      "select_tool unique registry tool",
      "toolType=tool bound, exit 0",
      sel.code === 0 && isObj(sj) && sj.bound === true && isObj(sj.toolBinding) && sj.toolBinding.toolType === "tool",
      sel.stdout.slice(0, 240),
    );
    const inv = run(INVOKE, ["--manifest", up, "--entity-id", "E01"]);
    const ij = parseJson(inv.stdout);
    record(
      "SC36",
      "invoke unique tool",
      "widgetId=w_1 color=red",
      inv.code === 0 && isObj(ij) && isObj(ij.fields) && ij.fields.widgetId === "w_1" && ij.fields.color === "red",
      inv.stdout.slice(0, 220),
    );
  }

  {
    const src = caseSource("hard-fail", catalogCase("invoke 失败"));
    run(PIPE, ["--case-id", "hard-fail", "--source", src, "--materials-root", materials]);
    const fp = join(materials, "hard-fail", "manifest.json");
    const fm = readObj(fp);
    fm.entities = [
      {
        ...catalogEntity(),
        toolBinding: {
          toolType: "skill",
          resourceId: "catalog",
          invokeCmd: "node scripts/executors/DOES_NOT_EXIST.ts --json '{}'",
          toolStatus: "available",
        },
      },
    ];
    (fm.pipelines as JsonObject).parse = { status: "done" };
    writeJson(fp, fm);
    const fail = run(PIPE, ["--manifest", fp, "--resume"]);
    record(
      "SC37",
      "pipeline invoke executor missing",
      "hard fail exit 1, not silent writeback",
      fail.code === 1 && fail.stderr.includes("DOES_NOT_EXIST"),
      `exit ${fail.code} ${fail.stderr.slice(0, 200)}`,
    );
  }

  {
    const src = caseSource("rb-src", catalogCase("对抗"));
    const traversal = run(PIPE, ["--case-id", "../etc-passwd", "--source", src, "--materials-root", materials]);
    record("RB01", "caseId path traversal", "exit 2 invalid caseId", traversal.code === 2 && traversal.stderr.includes("invalid caseId"), `exit ${traversal.code} ${traversal.stderr.slice(0, 160)}`);

    const missingSrc = run(PIPE, ["--case-id", "rb-missing", "--source", join(work, "no-such.md"), "--materials-root", materials]);
    record("RB02", "missing source file", "exit 2 source not found", missingSrc.code === 2 && /source not found|not found/.test(missingSrc.stderr), `exit ${missingSrc.code} ${missingSrc.stderr.slice(0, 160)}`);

    const badJson = join(work, "bad-manifest.json");
    writeFileSync(badJson, "{not json", "utf8");
    const corrupt = run(PIPE, ["--manifest", badJson, "--resume"]);
    record("RB03", "corrupt manifest JSON", "exit 2 no throw", corrupt.code === 2 && corrupt.stderr.includes("invalid"), `exit ${corrupt.code} ${corrupt.stderr.slice(0, 160)}`);

    const notArr = writeJson(join(work, "entities-obj.json"), {
      version: "v5",
      policyVersion: "2.0.0",
      caseId: "rb-shape",
      entities: { entityId: "E01" },
      actions: [],
    });
    const shape = run(PIPE, ["--manifest", notArr, "--resume"]);
    record("RB04", "entities is object not array", "exit 2", shape.code === 2 && shape.stderr.includes("entities must be an array"), `exit ${shape.code} ${shape.stderr.slice(0, 160)}`);

    const outside = join(tmpdir(), `dgs-evil-${Date.now()}.ts`);
    writeFileSync(outside, `#!/usr/bin/env node\nconsole.log(JSON.stringify({success:true,data:{productId:"hacked"}}));\n`, "utf8");
    const evSrc = caseSource("rb-exec", catalogCase("越权脚本"));
    run(PIPE, ["--case-id", "rb-exec", "--source", evSrc, "--materials-root", materials]);
    const evPath = join(materials, "rb-exec", "manifest.json");
    const evm = readObj(evPath);
    evm.entities = [
      {
        ...catalogEntity(),
        toolBinding: {
          toolType: "script",
          resourceId: "evil",
          invokeCmd: `node ${outside} --json '{}'`,
          toolStatus: "available",
        },
      },
    ];
    (evm.pipelines as JsonObject).parse = { status: "done" };
    writeJson(evPath, evm);
    const evRun = run(INVOKE, ["--manifest", evPath, "--entity-id", "E01"]);
    const evj = parseJson(evRun.stdout);
    record(
      "RB05",
      "invoke refuses executor outside allow roots",
      "failed capability-mismatch, no productId=hacked",
      evRun.code === 1 && isObj(evj) && evj.entityStatus === "failed" && String(evj.failReason).includes("executor not found"),
      evRun.stdout.slice(0, 240),
    );

    const proto = run("references/case-data-material-planner/scripts/merge_executor_fields.ts", [
      "--declared",
      '{"productId":null}',
      "--response",
      '{"success":true,"data":{"productId":"h_ok","__proto__":{"polluted":true},"constructor":"nope"}}',
    ]);
    const protoj = parseJson(proto.stdout);
    const pf = isObj(protoj) && isObj(protoj.fields) ? protoj.fields : {};
    record(
      "RB06",
      "merge drops __proto__/constructor",
      "productId kept, dangerous keys absent",
      proto.code === 0 &&
        pf.productId === "h_ok" &&
        !Object.hasOwn(pf, "__proto__") &&
        !Object.hasOwn(pf, "constructor") &&
        !Object.hasOwn(pf, "polluted"),
      proto.stdout.slice(0, 220),
    );

    const bindSrc = caseSource("rb-bind", catalogCase("换行入参"));
    run(PIPE, ["--case-id", "rb-bind", "--source", bindSrc, "--materials-root", materials]);
    const bp = join(materials, "rb-bind", "manifest.json");
    const bm = readObj(bp);
    bm.entities = [{ ...catalogEntity(), entityStatus: "verified", fields: { productId: "p_1\nrm -rf /" }, dataConfidence: 0.85 }];
    bm.actions = [
      {
        ...orderAction(),
        toolBinding: {
          toolType: "skill",
          resourceId: "catalog",
          cmdTemplate: `node scripts/executors/create_order.ts --json '{"productId":"__productId__","userId":"u_1"}'`,
          toolStatus: "available",
        },
        paramsFromEntities: [{ paramName: "productId", sourceEntityId: "E01", sourceField: "productId" }],
      },
    ];
    writeJson(bp, bm);
    const unsafe = run(BIND, ["--manifest", bp, "--action-id", "A01"]);
    const uj = parseJson(unsafe.stdout);
    record(
      "RB07",
      "bind rejects newline in param value",
      "gen-failed unsafe value",
      unsafe.code === 1 && isObj(uj) && String(uj.failReason).includes("unsafe value"),
      unsafe.stdout.slice(0, 220),
    );

    const noisy = join(work, "noisy.ts");
    writeFileSync(
      noisy,
      `#!/usr/bin/env node
console.log("debug starting");
console.log(JSON.stringify({ success: true, data: { productId: "h_noisy", name: "Noisy" } }));
`,
      "utf8",
    );
    const nSrc = caseSource("rb-noisy", catalogCase("噪音stdout"));
    run(PIPE, ["--case-id", "rb-noisy", "--source", nSrc, "--materials-root", materials]);
    const np = join(materials, "rb-noisy", "manifest.json");
    const nm = readObj(np);
    nm.entities = [
      {
        ...catalogEntity(),
        toolBinding: {
          toolType: "script",
          resourceId: "noisy",
          invokeCmd: `node ${noisy} --json '{}'`,
          toolStatus: "available",
        },
      },
    ];
    writeJson(np, nm);
    const nInv = run(INVOKE, ["--manifest", np, "--entity-id", "E01"]);
    const nj = parseJson(nInv.stdout);
    record(
      "RB08",
      "invoke extracts JSON after log prefix",
      "productId=h_noisy",
      nInv.code === 0 && isObj(nj) && isObj(nj.fields) && nj.fields.productId === "h_noisy",
      nInv.stdout.slice(0, 240),
    );

    const emptyId = writeJson(join(work, "empty-id.json"), {
      version: "v5",
      policyVersion: "2.0.0",
      caseId: "rb-empty",
      caseSource: { type: "local-file", original: src },
      pipelines: {
        parse: { status: "done" },
        preprocess: { status: "done" },
        "data-track": { status: "pending" },
        "action-track": { status: "done" },
        "knowledge-build": { status: "skipped" },
        "lint-gate": { status: "pending", round: 0 },
        writeback: { status: "pending" },
      },
      entities: [{ constructionStrategy: "tool-build", fields: { productId: null }, toolBinding: { toolType: "skill", toolStatus: "available", invokeCmd: "node x.ts" } }],
      actions: [],
    });
    const emptyRun = run(PIPE, ["--manifest", emptyId, "--scope", "execution"]);
    record("RB09", "tool-build missing entityId", "exit 1", emptyRun.code === 1 && emptyRun.stderr.includes("entityId"), `exit ${emptyRun.code} ${emptyRun.stderr.slice(0, 160)}`);

    const wbSrcMissing = writeJson(join(work, "wb-missing.json"), {
      version: "v5",
      policyVersion: "2.0.0",
      caseId: "rb-wb",
      caseSource: { type: "local-file", original: join(work, "gone.md") },
      entities: [],
      actions: [],
    });
    const wb = run(PIPE, ["--manifest", wbSrcMissing, "--scope", "writeback-only"]);
    record("RB10", "writeback missing source", "exit 1 not crash", wb.code === 1 && wb.stderr.includes("writeback failed"), `exit ${wb.code} ${wb.stderr.slice(0, 160)}`);
  }

  return results;
}

function printReport(): number {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  process.stdout.write("\n=== pipeline scenario correctness report ===\n");
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

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("_verify_pipeline_scenarios.ts")) {
  await runPipelineScenarioSuite();
  process.exit(printReport());
}
