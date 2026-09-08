#!/usr/bin/env node
/**
 * Durable assertion harness for the TypeScript rewrite of testdata-generation.
 * Every scenario asserts exit code, stdout/stderr shape, JSON keys, and artifacts.
 * Optional Python parity checks run when the original skill is present.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";
import { extractZip, resolveSafeDest, stageTree } from "./pack_skills.ts";
import { runPipelineScenarioSuite, type ScenarioResult as PipeScenarioResult } from "./_verify_pipeline_scenarios.ts";
import { runUserJourneySuite, type JourneyResult } from "./_verify_user_journeys.ts";
import { runExtendSceneSuite, type ExtendResult } from "./_verify_extend_scene.ts";
import { runEnterpriseOnboardSuite, type OnboardResult } from "./_verify_enterprise_onboard.ts";

const TS_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
// Historical Python original install path (not this skill's published id).
// Optional: point at the original Python implementation to run parity checks.
const PY_ROOT = process.env.DATA_BUILD_PY_ROOT ?? "";
const PY_AVAILABLE = PY_ROOT !== "" && existsSync(join(PY_ROOT, "SKILL.md"));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

type RunResult = { code: number; stdout: string; stderr: string };

type ScenarioResult = {
  id: string;
  command: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
};

const results: ScenarioResult[] = [];
const work = mkdtempSync(join(tmpdir(), "dgs-verify-"));
const favPath = join(work, "favorites.json");
const packOut = join(work, "dist");
const plannerDir = join(work, "planner");
const openapiDir = join(work, "openapi");
const scaffoldOut = join(work, "slot-out");
const sqlitePath = join(work, "store.db");
const configPath = join(work, "config.yaml");

mkdirSync(plannerDir, { recursive: true });
mkdirSync(openapiDir, { recursive: true });
mkdirSync(packOut, { recursive: true });

const isolatedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATA_BUILD_FAVORITES_PATH: favPath,
  DATA_GENERATE_SKILL_DIR: TS_ROOT,
  DATA_GENERATE_SKILLS_ROOT: TS_ROOT,
  DATA_BUILD_CONFIG: configPath,
  DATA_BUILD_SCRIPT_ROOTS: work,
};

function writeConfig(extra = ""): void {
  writeFileSync(
    configPath,
    [
      "workspace:",
      "  testdata_dir: ./testdata",
      "  contributor: verify-harness",
      "adapters:",
      "  skill_marketplace:",
      "    type: local",
      `    paths:`,
      `      - ${TS_ROOT}/slots`,
      "  tool_registry:",
      "    type: local",
      `    path: ${join(work, "tools")}`,
      "  experience_store:",
      "    type: local",
      `    path: ${join(work, "experience")}`,
      "  data_store:",
      "    type: none",
      "    dsn_env: DATABASE_DSN",
      "  config_store:",
      "    type: file",
      `    path: ${join(work, "config-store.yaml")}`,
      "  feature_flags:",
      "    type: noop",
      extra,
      "",
    ].join("\n"),
    "utf8",
  );
}

writeConfig();

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): RunResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || TS_ROOT,
    env: opts.env || isolatedEnv,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
  });
  return {
    code: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout || "",
    stderr: (result.stderr || "") + (result.error ? `\n${result.error.message}` : ""),
  };
}

function nodeTs(script: string, args: string[], env?: NodeJS.ProcessEnv): RunResult {
  return run(process.execPath, [join(TS_ROOT, script), ...args], { env });
}

function py(script: string, args: string[], env?: NodeJS.ProcessEnv): RunResult {
  return run("python3", [join(PY_ROOT, script), ...args], {
    env: {
      ...(env || isolatedEnv),
      PYTHONPATH: `${join(PY_ROOT, "scripts")}${env?.PYTHONPATH ? `:${env.PYTHONPATH}` : ""}`,
    },
    cwd: PY_ROOT,
  });
}

function record(
  id: string,
  command: string,
  expected: string,
  okOrActual: boolean | string,
  actualOrOk?: boolean | string,
  detail?: string,
): void {
  let ok: boolean;
  let actual: string;
  if (typeof okOrActual === "boolean") {
    ok = okOrActual;
    actual = actualOrOk === undefined ? String(ok) : String(actualOrOk);
  } else {
    actual = okOrActual;
    ok = typeof actualOrOk === "boolean" ? actualOrOk : Boolean(actualOrOk);
  }
  results.push({ id, command, expected, actual, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) process.stderr.write(`FAIL ${id}: ${detail || actual}\n`);
}

function skip(id: string, command: string, expected: string, why: string): void {
  results.push({ id, command, expected, actual: why, status: "SKIP", detail: why });
}

function parseJson(text: string): Json | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as Json;
  } catch {
    const start = trimmed.indexOf("{");
    const startArr = trimmed.indexOf("[");
    const idx = start >= 0 && (startArr < 0 || start < startArr) ? start : startArr;
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

function assertExit(id: string, command: string, got: RunResult, code: number, extra?: string): boolean {
  const ok = got.code === code;
  record(
    id,
    command,
    `exit ${code}${extra ? `; ${extra}` : ""}`,
    `exit ${got.code}${got.stderr.trim() ? `; stderr=${got.stderr.trim().slice(0, 200)}` : ""}`,
    ok,
    ok ? extra : `expected exit ${code}, got ${got.code}; stdout=${got.stdout.slice(0, 240)}; stderr=${got.stderr.slice(0, 240)}`,
  );
  return ok;
}

function assertContains(id: string, command: string, hay: string, needle: string, expected: string): boolean {
  const ok = hay.includes(needle);
  record(id, command, expected, ok ? `contains ${JSON.stringify(needle)}` : hay.slice(0, 300), ok);
  return ok;
}

function assertJsonKeys(
  id: string,
  command: string,
  text: string,
  keys: string[],
  expected: string,
): Json | undefined {
  const parsed = parseJson(text);
  if (!isObj(parsed)) {
    record(id, command, expected, `not JSON object: ${text.slice(0, 240)}`, false);
    return undefined;
  }
  const missing = keys.filter((k) => !(k in parsed));
  record(
    id,
    command,
    expected,
    missing.length ? `missing keys ${missing.join(",")}` : `keys ${keys.join(",")}`,
    missing.length === 0,
  );
  return parsed;
}

function writeManifest(name: string, data: JsonObject): string {
  const path = join(plannerDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return path;
}

function emptyManifest(overrides: JsonObject = {}): JsonObject {
  return {
    version: "v5",
    policyVersion: "1.0.0",
    caseId: "case-1",
    entities: [],
    actions: [],
    pipelines: {
      "lint-gate": { status: "pending", round: 0, verdict: null, failingIds: { entities: [], actions: [] } },
      writeback: { status: "pending" },
    },
    confirmations: [],
    lintRounds: [],
    ...overrides,
  };
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitUntil(fn: () => Promise<boolean> | boolean, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await waitFor(100);
  }
  return false;
}

function killProc(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

function zipHasMethod8(zipPath: string): boolean {
  const buf = readFileSync(zipPath);
  let offset = 0;
  let saw = false;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    if (method !== 8) return false;
    saw = true;
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const compSize = buf.readUInt32LE(offset + 18);
    offset += 30 + nameLen + extraLen + compSize;
  }
  return saw;
}

function listZipNames(zipPath: string): string[] {
  const listed = spawnSync("unzip", ["-Z", "-1", zipPath], { encoding: "utf8" });
  if (listed.status === 0) return listed.stdout.split(/\r?\n/).filter(Boolean);
  const listed2 = spawnSync("zipinfo", ["-1", zipPath], { encoding: "utf8" });
  return listed2.stdout.split(/\r?\n/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Core CLIs
// ---------------------------------------------------------------------------

function verifySearch(): void {
  const search = "scripts/search_data_build.ts";

  {
    const got = nodeTs(search, ["--keywords", "catalog", "--json", "--no-favorites"]);
    const cmd = "node scripts/search_data_build.ts --keywords catalog --json --no-favorites";
    assertExit("C01", cmd, got, 0, "JSON search keys");
    const json = assertJsonKeys("C01-json", cmd, got.stdout, ["pinned_matches", "proven_matches", "skill_matches", "config_source"], "search JSON shape");
    if (isObj(json)) {
      const skills = Array.isArray(json.skill_matches) ? json.skill_matches : [];
      const names = skills.map((s) => (isObj(s) ? String(s.name || "") : ""));
      record("C01-catalog", cmd, "skill_matches includes catalog", `names=${names.join(",")}`, names.includes("catalog"));
      const firstSkill = skills[0];
      if (isObj(firstSkill)) {
        const required = ["name", "source", "skillPath"];
        const missing = required.filter((k) => !(k in firstSkill));
        record("C01-skill-shape", cmd, `skill item keys ${required.join(",")}`, missing.length ? `missing ${missing}` : "ok", missing.length === 0);
      }
    }
    if (PY_AVAILABLE) {
      const pyg = py("scripts/search_data_build.py", ["--keywords", "catalog", "--json", "--no-favorites"]);
      const pyj = parseJson(pyg.stdout);
      const ok =
        pyg.code === 0 &&
        isObj(pyj) &&
        isObj(json) &&
        ["pinned_matches", "proven_matches", "skill_matches"].every((k) => k in pyj && k in json);
      record("C01-py", cmd, "Python/TS same top-level keys", ok ? "parity" : `py=${pyg.stdout.slice(0, 160)}`, ok);
    }
  }

  {
    const got = nodeTs(search, [
      "--keywords",
      "catalog",
      "--query",
      "create a catalog product",
      "--registry-key",
      "catalog-product::create",
      "--entry-type",
      "entity",
      "--domain",
      "catalog",
      "--json",
      "--no-favorites",
    ]);
    const cmd = "search_data_build.ts workflow example --json";
    assertExit("C02", cmd, got, 0);
    assertJsonKeys("C02-json", cmd, got.stdout, ["pinned_matches", "proven_matches", "skill_matches"], "workflow search JSON");
  }

  {
    const got = nodeTs(search, ["--keywords", "distributor", "--entry-type", "action", "--json", "--no-favorites"]);
    assertExit("C03", "search --entry-type action --json", got, 0);
    assertJsonKeys("C03-json", "search --entry-type action", got.stdout, ["skill_matches"], "action search");
  }

  {
    const got = nodeTs(search, ["--entry-type", "bogus", "--json"]);
    const cmd = "search --entry-type bogus";
    assertExit("C04", cmd, got, 2, "invalid entry-type");
    assertContains("C04-err", cmd, got.stderr, "entry-type must be entity or action", "stderr explains invalid entry-type");
  }

  {
    const got = nodeTs(search, ["--json", "--no-favorites"]);
    const cmd = "search --json (empty keywords, full scan)";
    assertExit("C05", cmd, got, 0);
    const json = assertJsonKeys("C05-json", cmd, got.stdout, ["pinned_matches", "proven_matches", "skill_matches"], "full-scan JSON");
    if (isObj(json)) {
      const skills = Array.isArray(json.skill_matches) ? json.skill_matches : [];
      const names = skills.map((s) => (isObj(s) ? String(s.name || "") : ""));
      record("C05-scan", cmd, "full scan returns catalog + distribution", `names=${names.join(",")}`, names.includes("catalog") && names.includes("distribution"));
    }
  }

  {
    const got = nodeTs(search, ["--keywords", "catalog", "--no-favorites"]);
    const cmd = "search human output";
    assertExit("C06", cmd, got, 0);
    assertContains("C06-human", cmd, got.stdout, "Skill matches", "human listing header");
  }
}

function verifyFavorites(): void {
  const fav = "scripts/favorites.ts";

  {
    const got = nodeTs(fav, []);
    assertExit("F01", "favorites.ts (no command)", got, 2);
    assertContains("F01-usage", "favorites.ts", got.stderr, "usage: favorites.ts add|list|rm|verify", "usage on stderr");
  }

  {
    const got = nodeTs(fav, ["add"]);
    assertExit("F02", "favorites.ts add (no --name)", got, 2);
    assertContains("F02-err", "favorites add", got.stderr, "error: --name is required", "--name required");
    if (PY_AVAILABLE) {
      const pyg = py("scripts/favorites.py", ["add"], { ...isolatedEnv, DATA_BUILD_FAVORITES_PATH: join(work, "py-fav.json") });
      record("F02-py", "python favorites.py add", "exit 2 without --name", `exit ${pyg.code}`, pyg.code === 2);
    }
  }

  {
    const got = nodeTs(fav, [
      "add",
      "--name",
      "catalog",
      "--desc",
      "catalog product and order construction",
      "--path",
      join(TS_ROOT, "slots", "catalog"),
      "--scope",
      "project",
    ]);
    const cmd = "favorites.ts add --name catalog";
    assertExit("F03", cmd, got, 0);
    assertContains("F03-out", cmd, got.stdout, "pinned catalog", "pin confirmation");
    record("F03-file", cmd, `writes ${favPath}`, existsSync(favPath) ? "file exists" : "missing", existsSync(favPath));
    if (existsSync(favPath)) {
      const data = JSON.parse(readFileSync(favPath, "utf8")) as JsonObject;
      const favs = Array.isArray(data.favorites) ? data.favorites : [];
      const row = favs.find((f) => isObj(f) && f.skillName === "catalog");
      record("F03-shape", cmd, "favorite has id,skillName,skillPath,description", isObj(row) ? "ok" : "missing row", Boolean(isObj(row) && row.id && row.skillPath));
    }
  }

  {
    const got = nodeTs(fav, ["list"]);
    assertExit("F04", "favorites.ts list", got, 0);
    assertContains("F04-out", "favorites list", got.stdout, "catalog", "lists pinned name");
  }

  {
    const got = nodeTs(fav, ["list", "--json"]);
    const json = parseJson(got.stdout);
    assertExit("F05", "favorites.ts list --json", got, 0);
    const ok = Array.isArray(json) && json.some((f) => isObj(f) && f.skillName === "catalog");
    record("F05-json", "favorites list --json", "JSON array with catalog", ok ? "ok" : got.stdout.slice(0, 200), ok);
  }

  {
    const got = nodeTs(fav, ["verify", "--json"]);
    const json = parseJson(got.stdout);
    assertExit("F06", "favorites.ts verify --json", got, 0);
    const row = Array.isArray(json) ? json.find((f) => isObj(f) && f.skillName === "catalog") : undefined;
    record("F06-avail", "favorites verify", "catalog available=true", isObj(row) ? `available=${row.available}` : "missing", isObj(row) && row.available === true);
  }

  {
    const got = nodeTs(fav, ["rm"]);
    assertExit("F07", "favorites.ts rm (no selector)", got, 1);
    assertContains("F07-err", "favorites rm", got.stderr, "provide --id, --uuid, or --name", "missing selector");
  }

  {
    const got = nodeTs(fav, ["rm", "--name", "does-not-exist"]);
    assertExit("F08", "favorites.ts rm --name missing", got, 1);
    assertContains("F08-out", "favorites rm missing", got.stdout, "no matching pinned skill", "not-found message");
  }

  {
    const got = nodeTs(fav, ["rm", "--name", "catalog"]);
    assertExit("F09", "favorites.ts rm --name catalog", got, 0);
    assertContains("F09-out", "favorites rm", got.stdout, "removed", "removed confirmation");
  }
}

function verifyExperienceClient(): void {
  const cli = "scripts/experience_client.ts";

  {
    const got = nodeTs(cli, []);
    assertExit("E01", "experience_client.ts (no command)", got, 2);
    assertContains("E01-usage", "experience_client", got.stderr, "usage: experience_client.ts fetch|report|feedback", "usage");
  }

  {
    const got = nodeTs(cli, ["fetch"]);
    assertExit("E02", "experience_client.ts fetch (no --queries)", got, 2);
    assertContains("E02-err", "experience_client fetch", got.stderr, "error: --queries is required", "--queries required");
  }

  {
    const got = nodeTs(cli, ["report"]);
    assertExit("E03", "experience_client.ts report (no --body)", got, 2);
    assertContains("E03-err", "experience_client report", got.stderr, "error: --body is required", "--body required");
  }

  {
    const got = nodeTs(cli, ["feedback"]);
    assertExit("E04", "experience_client.ts feedback (no --body)", got, 2);
    assertContains("E04-err", "experience_client feedback", got.stderr, "error: --body is required", "--body required");
  }

  {
    const queries = JSON.stringify([{ key: "catalog-product::create", type: "entity", query_text: "create catalog product" }]);
    const got = nodeTs(cli, ["fetch", "--queries", queries, "--domain", "catalog"]);
    const cmd = "experience_client.ts fetch --queries ...";
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && isObj(json) && json.ok === true && isObj(json.data);
    record("E05", cmd, "exit 0, {ok:true, data.results}", ok ? "ok" : `exit ${got.code} ${got.stdout.slice(0, 200)}`, ok);
  }

  {
    const body = JSON.stringify({
      registry_key: "catalog-product::create",
      domain: "catalog",
      contributor: "verify-harness",
      tool_binding: { toolType: "skill", resourceId: "catalog" },
    });
    const got = nodeTs(cli, ["report", "--body", body]);
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && isObj(json) && json.ok === true && isObj(json.data) && Boolean(json.data.experience_id);
    record("E06", "experience_client.ts report", "exit 0 {ok, data.experience_id}", ok ? "ok" : got.stdout.slice(0, 200), ok);
    if (ok && isObj(json) && isObj(json.data)) {
      const fb = nodeTs(cli, [
        "feedback",
        "--body",
        JSON.stringify({ experience_id: json.data.experience_id, outcome: "success", contributor: "verify-harness" }),
      ]);
      const fbj = parseJson(fb.stdout);
      const fbOk = fb.code === 0 && isObj(fbj) && fbj.ok === true;
      record("E07", "experience_client.ts feedback", "exit 0 {ok:true}", fbOk ? "ok" : `exit ${fb.code} ${fb.stdout.slice(0, 200)}`, fbOk);
    }
  }

  {
    const got = run(process.execPath, [
      "--input-type=module",
      "-e",
      `import ${JSON.stringify(join(TS_ROOT, "scripts/experience_client.ts"))}; console.log("imported-ok")`,
    ]);
    const cmd = "import experience_client.ts (must not run main)";
    const ok = got.code === 0 && got.stdout.includes("imported-ok") && !got.stdout.includes("usage:");
    record("E08", cmd, "prints imported-ok, no usage, exit 0", `exit ${got.code} stdout=${got.stdout.trim()}`, ok);
  }
}

function isJunkZipName(name: string): boolean {
  return name.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"));
}

function writeRawZip(zipPath: string, entries: { name: string; data: Buffer; symlink?: boolean }[]): void {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = deflateRawSync(entry.data);
    const nameBuf = Buffer.from(entry.name, "utf8");
    let crc = 0xffffffff;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    for (const b of entry.data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localStart = offset;
    chunks.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(entry.symlink ? (3 << 8) | 20 : 20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(entry.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    if (entry.symlink) cen.writeUInt32LE((0o120777 << 16) >>> 0, 38);
    cen.writeUInt32LE(localStart, 42);
    central.push(cen, nameBuf);
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  writeFileSync(zipPath, Buffer.concat([...chunks, ...central, eocd]));
}

function verifyPackSkills(): void {
  const got = nodeTs("scripts/pack_skills.ts", ["--output", packOut]);
  const cmd = "node scripts/pack_skills.ts --output <tmp>";
  const json = parseJson(got.stdout);
  assertExit("P01", cmd, got, 0);
  const okShape = isObj(json) && json.ok === true && Array.isArray(json.zips) && json.zips.length === 2;
  record("P01-json", cmd, "{ok:true, zips:[skill, plugin]}", okShape ? String(json.zips) : got.stdout.slice(0, 240), okShape);

  const skillZip = join(packOut, "testdata-generation.zip");
  const pluginZip = join(packOut, "testdata-generation-claude-plugin.zip");
  record("P02", cmd, "both zip files exist", `skill=${existsSync(skillZip)} plugin=${existsSync(pluginZip)}`, existsSync(skillZip) && existsSync(pluginZip));

  if (existsSync(skillZip)) {
    record("P03", "skill zip", "DEFLATE method 8", zipHasMethod8(skillZip) ? "method 8" : "not method 8", zipHasMethod8(skillZip));
    const test = spawnSync("unzip", ["-t", skillZip], { encoding: "utf8" });
    record("P04", "unzip -t skill zip", "exit 0, No errors", `exit ${test.status} ${test.stdout.slice(-80)}`, test.status === 0 && /No errors/i.test(test.stdout + test.stderr));
    const names = listZipNames(skillZip);
    record("P05", "skill zip names", "root folder testdata-generation/", names.some((n) => n.startsWith("testdata-generation/")) ? "ok" : names.slice(0, 5).join(","), names.some((n) => n.startsWith("testdata-generation/")));
    record("P06", "skill zip", "contains .ts files", names.some((n) => n.endsWith(".ts")) ? "has .ts" : "no .ts", names.some((n) => n.endsWith(".ts")));
    record("P07", "skill zip", "contains package.json", names.some((n) => n.endsWith("package.json")) ? "has package.json" : "missing", names.some((n) => n.endsWith("package.json")));
    record("P08", "skill zip", "no leftover .py", names.some((n) => n.endsWith(".py")) ? names.filter((n) => n.endsWith(".py")).join(",") : "no .py", !names.some((n) => n.endsWith(".py")));
    record("P09", "skill zip", "contains SKILL.md", names.some((n) => n.endsWith("SKILL.md")) ? "ok" : "missing", names.some((n) => n.endsWith("SKILL.md")));
    record("P14", "skill zip", "no __MACOSX / .DS_Store / ._*", names.filter(isJunkZipName).join(",") || "clean", !names.some(isJunkZipName));
  }

  if (existsSync(pluginZip)) {
    record("P10", "plugin zip", "DEFLATE method 8", zipHasMethod8(pluginZip) ? "method 8" : "not", zipHasMethod8(pluginZip));
    const test = spawnSync("unzip", ["-t", pluginZip], { encoding: "utf8" });
    record("P11", "unzip -t plugin zip", "exit 0", `exit ${test.status}`, test.status === 0);
    const names = listZipNames(pluginZip);
    record("P12", "plugin zip", "contains .claude-plugin/plugin.json", names.some((n) => n.includes(".claude-plugin/plugin.json")) ? "ok" : names.slice(0, 8).join(","), names.some((n) => n.includes(".claude-plugin/plugin.json")));
    record("P13", "plugin zip", "contains skills/testdata-generation/SKILL.md", names.some((n) => n.includes("skills/testdata-generation/SKILL.md")) ? "ok" : "missing", names.some((n) => n.includes("skills/testdata-generation/SKILL.md")));
    record("P15", "plugin zip", "no __MACOSX / .DS_Store / ._*", names.filter(isJunkZipName).join(",") || "clean", !names.some(isJunkZipName));
  }

  {
    const src = join(work, "stage-src");
    mkdirSync(join(src, "__MACOSX"), { recursive: true });
    mkdirSync(join(src, "keep-dir"), { recursive: true });
    writeFileSync(join(src, "__MACOSX", "foo"), "junk", "utf8");
    writeFileSync(join(src, ".DS_Store"), "ds", "utf8");
    writeFileSync(join(src, "._hidden"), "appledouble", "utf8");
    writeFileSync(join(src, "keep-dir", "hello.txt"), "hello", "utf8");
    symlinkSync("/tmp/outside-target", join(src, "evil-link"));
    const dest = join(work, "stage-dest");
    const written = stageTree(src, dest);
    const hasKeep = existsSync(join(dest, "keep-dir", "hello.txt"));
    const leaked =
      existsSync(join(dest, "__MACOSX")) ||
      existsSync(join(dest, ".DS_Store")) ||
      existsSync(join(dest, "._hidden")) ||
      existsSync(join(dest, "evil-link"));
    const linkWritten = existsSync(join(dest, "evil-link")) && lstatSync(join(dest, "evil-link")).isSymbolicLink();
    record(
      "P16",
      "stageTree skips __MACOSX/.DS_Store/._*/symlink",
      "keep hello.txt; no junk or live symlink",
      `written=${written.join(",")} leaked=${leaked} symlink=${linkWritten}`,
      hasKeep && !leaked && !linkWritten && written.includes("keep-dir/hello.txt"),
    );
  }

  {
    const zipPath = join(work, "junk-link.zip");
    writeRawZip(zipPath, [
      { name: "keep.txt", data: Buffer.from("ok") },
      { name: "__MACOSX/foo", data: Buffer.from("junk") },
      { name: ".DS_Store", data: Buffer.from("ds") },
      { name: "._hidden", data: Buffer.from("apple") },
      { name: "evil-link", data: Buffer.from("/tmp/outside-target"), symlink: true },
    ]);
    const dest = join(work, "extract-dest");
    const written = extractZip(zipPath, dest);
    const leaked =
      existsSync(join(dest, "__MACOSX")) ||
      existsSync(join(dest, ".DS_Store")) ||
      existsSync(join(dest, "._hidden")) ||
      existsSync(join(dest, "evil-link"));
    record(
      "P17",
      "extractZip skips __MACOSX/.DS_Store/._*/symlink",
      "keep.txt only; no junk or live symlink",
      `written=${written.join(",")} leaked=${leaked}`,
      written.includes("keep.txt") && !leaked,
    );
  }

  {
    let threw = false;
    try {
      resolveSafeDest(work, "../escape.txt");
    } catch {
      threw = true;
    }
    record("P18", "resolveSafeDest", "rejects .. zip-slip path", threw ? "threw" : "accepted", threw);
    const slipZip = join(work, "slip.zip");
    const slipDest = join(work, "slip-dest");
    mkdirSync(slipDest, { recursive: true });
    writeRawZip(slipZip, [{ name: "../escape.txt", data: Buffer.from("nope") }]);
    let extractThrew = false;
    try {
      extractZip(slipZip, slipDest);
    } catch {
      extractThrew = true;
    }
    record(
      "P19",
      "extractZip zip-slip",
      "rejects .. and does not write outside dest",
      `threw=${extractThrew} escaped=${existsSync(join(work, "escape.txt"))}`,
      extractThrew && !existsSync(join(work, "escape.txt")),
    );
  }
}

function verifyAdaptersCli(): void {
  const cli = "scripts/adapters/cli.ts";

  {
    const got = nodeTs(cli, []);
    assertExit("A01", "adapters/cli.ts (no args)", got, 2);
    assertContains("A01-usage", "adapters cli", got.stderr, "usage: node scripts/adapters/cli.ts", "usage");
  }

  {
    const got = nodeTs(cli, ["--help"]);
    assertExit("A02", "adapters/cli.ts --help", got, 0);
    assertContains("A02-ex", "adapters --help", got.stderr, "tool_registry.query", "examples");
  }

  {
    const got = nodeTs(cli, ["not-a-method"]);
    assertExit("A03", "adapters/cli.ts not-a-method", got, 2);
    assertContains("A03-err", "invalid target", got.stderr, "invalid target:", "invalid target");
  }

  {
    const got = nodeTs(cli, ["tool_registry.does_not_exist"]);
    assertExit("A04", "adapters/cli.ts unknown method", got, 2);
    assertContains("A04-err", "unknown method", got.stderr, "unknown method:", "unknown method");
  }

  {
    const got = nodeTs(cli, ["skill_marketplace.search", "catalog"]);
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && Array.isArray(json) && json.some((s) => isObj(s) && s.name === "catalog");
    record("A05", "skill_marketplace.search catalog", "JSON array including catalog", ok ? `len=${Array.isArray(json) ? json.length : 0}` : got.stdout.slice(0, 200), ok);
  }

  {
    const dest = join(work, "installed-skills");
    mkdirSync(dest, { recursive: true });
    const got = nodeTs(cli, ["skill_marketplace.install", "catalog", dest]);
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && isObj(json) && json.ok === true && isObj(json.data) && existsSync(join(dest, "catalog", "SKILL.md"));
    record("A06", "skill_marketplace.install catalog", "{ok:true} and SKILL.md copied", ok ? String(json) : got.stdout.slice(0, 200), ok);
  }

  {
    const got = nodeTs(cli, ["tool_registry.query", "create a catalog test product"]);
    const ok = got.code === 0 && Array.isArray(parseJson(got.stdout));
    record("A07", "tool_registry.query", "exit 0 JSON array", ok ? "array" : got.stdout.slice(0, 200), ok);
  }

  {
    const got = nodeTs(cli, ["tool_registry.get", "missing-tool-id"]);
    const json = parseJson(got.stdout);
    record("A08", "tool_registry.get missing", "exit 0 null", got.code === 0 && json === null, `exit ${got.code} ${got.stdout.trim()}`);
  }

  {
    const got = nodeTs(cli, [
      "tool_registry.publish",
      "verify-catalog-product",
      "Create a catalog product",
      "./testdata/create_product.ts",
      '[{"name":"name","type":"string","required":true}]',
    ]);
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && isObj(json) && json.ok === true && isObj(json.data) && json.data.resourceId === "verify-catalog-product";
    record("A09", "tool_registry.publish", "{ok:true, data.resourceId}", ok ? String(json.data) : got.stdout.slice(0, 200), ok);

    const get = nodeTs(cli, ["tool_registry.get", "verify-catalog-product"]);
    const gotj = parseJson(get.stdout);
    record("A10", "tool_registry.get after publish", "object with id/name", get.code === 0 && isObj(gotj) && gotj.id === "verify-catalog-product", get.stdout.slice(0, 160));

    const inputs = nodeTs(cli, ["tool_registry.query_input_list", "verify-catalog-product"]);
    const inj = parseJson(inputs.stdout);
    record("A11", "tool_registry.query_input_list", "array with required name", inputs.code === 0 && Array.isArray(inj) && inj.some((i) => isObj(i) && i.name === "name"), inputs.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["tool_registry.execute", "missing-exec", "{}"]);
    const json = parseJson(got.stdout);
    record("A12", "tool_registry.execute missing", "{ok:false, error}", got.code === 0 && isObj(json) && json.ok === false && typeof json.error === "string", got.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["api_catalog.search", "product"]);
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && Array.isArray(json);
    record("A13", "api_catalog.search product", "exit 0 JSON array", ok ? `len=${Array.isArray(json) ? json.length : 0}` : got.stdout.slice(0, 200), ok);
    if (Array.isArray(json) && json[0] && isObj(json[0])) {
      const item = json[0];
      record("A13-shape", "api_catalog.search item", "operationId/path/method", Boolean(item.operationId || item.path), JSON.stringify(item).slice(0, 160));
    }
  }

  {
    const got = nodeTs(cli, ["api_catalog.detail", "createCatalogProduct"]);
    const json = parseJson(got.stdout);
    record("A14", "api_catalog.detail createCatalogProduct", "object or null", got.code === 0 && (json === null || isObj(json)), got.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["api_catalog.search_plan_changes", "plan-does-not-exist"]);
    record("A15", "api_catalog.search_plan_changes", "exit 0 JSON array", got.code === 0 && Array.isArray(parseJson(got.stdout)), got.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["api_catalog.list_by_service", "unknown-service"]);
    record("A16", "api_catalog.list_by_service", "exit 0 JSON array", got.code === 0 && Array.isArray(parseJson(got.stdout)), got.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["data_store.query", "SELECT 1"]);
    const json = parseJson(got.stdout);
    record(
      "A17",
      "data_store.query when type=none",
      '{ok:false, error contains "not configured"}',
      got.code === 0 && isObj(json) && json.ok === false && String(json.error).includes("not configured"),
      got.stdout.slice(0, 200),
    );
  }

  {
    const got = nodeTs(cli, ["data_store.query", "INSERT INTO t VALUES (1)"]);
    const json = parseJson(got.stdout);
    record(
      "A18",
      "data_store.query INSERT",
      '{ok:false, error: "data_store allows SELECT only"}',
      got.code === 0 && isObj(json) && json.error === "data_store allows SELECT only",
      got.stdout.slice(0, 200),
    );
  }

  {
    const db = new DatabaseSync(sqlitePath);
    db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO products (name) VALUES ('Northwind');");
    db.close();
    writeConfig(`  data_store:\n    type: dsn\n    dsn_env: DATABASE_DSN`);
    const env = { ...isolatedEnv, DATABASE_DSN: `sqlite:///${sqlitePath}` };
    const got = nodeTs(cli, ["data_store.query", "SELECT name FROM products"], env);
    const json = parseJson(got.stdout);
    const ok = got.code === 0 && isObj(json) && json.ok === true && Array.isArray(json.data);
    record("A19", "data_store.query sqlite SELECT", "{ok:true, data: rows}", ok ? JSON.stringify(json.data) : got.stdout.slice(0, 200), ok);
    if (ok && isObj(json) && Array.isArray(json.data) && isObj(json.data[0])) {
      record("A19-row", "sqlite row", "name=Northwind", json.data[0].name === "Northwind", JSON.stringify(json.data[0]));
    }

    const abs = nodeTs(cli, ["data_store.query", "SELECT 1 as n"], { ...env, DATABASE_DSN: `sqlite:////${sqlitePath.replace(/^\//, "")}` });
    const absj = parseJson(abs.stdout);
    record("A20", "sqlite:////abs path", "{ok:true}", abs.code === 0 && isObj(absj) && absj.ok === true, abs.stdout.slice(0, 160));

    writeConfig();
  }

  {
    const got = nodeTs(cli, ["config_store.set", "demo.key", "demo-value"]);
    const json = parseJson(got.stdout);
    record("A21", "config_store.set", "{ok:true}", got.code === 0 && isObj(json) && json.ok === true, got.stdout.slice(0, 160));
    const get = nodeTs(cli, ["config_store.get", "demo.key"]);
    const getj = parseJson(get.stdout);
    record("A22", "config_store.get", "{ok:true, data: demo-value}", get.code === 0 && isObj(getj) && getj.ok === true && getj.data === "demo-value", get.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["feature_flags.detail", "flag-x", "test"]);
    const json = parseJson(got.stdout);
    record(
      "A23",
      "feature_flags.detail noop",
      '{ok:false, error contains "noop"}',
      got.code === 0 && isObj(json) && json.ok === false && String(json.error).includes("noop"),
      got.stdout.slice(0, 200),
    );
  }

  {
    const doc = join(work, "req.md");
    writeFileSync(doc, "# Requirement\nCreate catalog product\n", "utf8");
    const got = nodeTs(cli, ["doc_source.get", doc]);
    const json = parseJson(got.stdout);
    record("A24", "doc_source.get local file", "{ok:true, data.content}", got.code === 0 && isObj(json) && json.ok === true && isObj(json.data) && String(json.data.content).includes("catalog"), got.stdout.slice(0, 160));
  }

  {
    const got = nodeTs(cli, ["case_writeback.write", "case-verify", "# executable\n"]);
    const json = parseJson(got.stdout);
    const path = isObj(json) && isObj(json.data) ? String(json.data.path || "") : "";
    record("A25", "case_writeback.write", "{ok:true} writes case-executable.md", got.code === 0 && isObj(json) && json.ok === true && path.endsWith("case-executable.md") && existsSync(path), got.stdout.slice(0, 200));
  }

  {
    const got = nodeTs(cli, ["workspace_context.load"]);
    const json = parseJson(got.stdout);
    record("A26", "workspace_context.load", "{ok:true, data}", got.code === 0 && isObj(json) && json.ok === true && isObj(json.data), got.stdout.slice(0, 160));
  }

  {
    const got = run(process.execPath, [
      "--input-type=module",
      "-e",
      `import { buildRuntime } from ${JSON.stringify(join(TS_ROOT, "scripts/adapters/index.ts"))}; const r = buildRuntime(); console.log(JSON.stringify({ok:true, adapters: Object.keys(r).filter(k=>k!=="cfg")}));`,
    ]);
    const json = parseJson(got.stdout);
    const needed = ["skill_marketplace", "tool_registry", "api_catalog", "experience_store", "data_store"];
    const ok = got.code === 0 && isObj(json) && json.ok === true && Array.isArray(json.adapters) && needed.every((n) => (json.adapters as string[]).includes(n));
    record("A27", "import adapters/index.ts (must not run CLI)", "{ok:true, adapters:[...]}", ok ? String(json) : `exit ${got.code} ${got.stdout} ${got.stderr}`.slice(0, 240), ok);
  }
}

async function verifySlots(): Promise<void> {
  const port = 18765;
  const env = { ...isolatedEnv, DATA_BUILD_API_BASE: `http://127.0.0.1:${port}` };
  const child = spawn(process.execPath, [join(TS_ROOT, "slots/mock_server.ts"), "--port", String(port)], {
    cwd: TS_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let started = "";
  child.stdout?.on("data", (buf: Buffer) => {
    started += buf.toString("utf8");
  });
  const up = await waitUntil(async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      return resp.ok;
    } catch {
      return started.includes("mock server");
    }
  }, 8000);
  record("S01", "node slots/mock_server.ts --port 18765", "health {ok:true}", up ? "up" : started || "did not start", up);
  if (!up) {
    killProc(child);
    skip("S02", "executors", "run against mock", "mock server failed to start");
    return;
  }

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await health.json()) as JsonObject;
    record("S01-health", "GET /health", "{ok:true}", health.ok && body.ok === true, JSON.stringify(body));

    const exec = (rel: string, json: string, extraEnv = env) =>
      run(process.execPath, [join(TS_ROOT, rel), "--json", json], { env: extraEnv });

    {
      const got = exec("slots/catalog/scripts/executors/create_product.ts", '{"name":"Northwind Standard","city":"demo-city"}');
      const json = parseJson(got.stdout);
      const ok = got.code === 0 && isObj(json) && json.success === true && isObj(json.data) && typeof json.data.productId === "string" && json.data.kind === "standard";
      record("S02", "create_product.ts --json {name,city}", "{success:true, data.productId, kind:standard}", ok ? JSON.stringify(json.data) : got.stdout.slice(0, 200), ok);
      const productId = ok && isObj(json) && isObj(json.data) ? String(json.data.productId) : "";

      const miss = exec("slots/catalog/scripts/executors/create_product.ts", "{}");
      const missj = parseJson(miss.stdout);
      record("S03", "create_product.ts missing name", '{success:false, error:"missing required param: name"}', isObj(missj) && missj.success === false && missj.error === "missing required param: name", miss.stdout.slice(0, 200));

      const badJson = run(process.execPath, [join(TS_ROOT, "slots/catalog/scripts/executors/create_product.ts"), "--json", "{not-json"], { env });
      record("S04", "create_product.ts invalid JSON", "non-zero or thrown parse error", badJson.code !== 0, `exit ${badJson.code} ${badJson.stderr.slice(0, 120)}`);

      const limited = exec("slots/catalog/scripts/executors/create_limited_product.ts", '{"name":"Limited SKU","validHours":3}');
      const hj = parseJson(limited.stdout);
      record("S05", "create_limited_product.ts", "{success:true, kind:limited, validHours:3}", limited.code === 0 && isObj(hj) && hj.success === true && isObj(hj.data) && hj.data.kind === "limited" && hj.data.validHours === 3, limited.stdout.slice(0, 200));

      const orderMiss = exec("slots/catalog/scripts/executors/create_order.ts", '{"name":"x"}');
      const om = parseJson(orderMiss.stdout);
      record("S06", "create_order.ts missing productId/userId", "success=false missing required", isObj(om) && om.success === false && String(om.error).includes("productId"), orderMiss.stdout.slice(0, 200));

      const order = exec("slots/catalog/scripts/executors/create_order.ts", JSON.stringify({ productId, userId: "u-1", quantity: 2 }));
      const oj = parseJson(order.stdout);
      const orderOk = order.code === 0 && isObj(oj) && oj.success === true && isObj(oj.data) && typeof oj.data.orderId === "string";
      record("S07", "create_order.ts", "{success:true, data.orderId}", orderOk ? JSON.stringify(oj.data) : order.stdout.slice(0, 200), orderOk);

      const credit = exec("slots/catalog/scripts/executors/setup_account_credit.ts", JSON.stringify({ productId, userId: "u-1", credits: 500 }));
      const pj = parseJson(credit.stdout);
      record("S08", "setup_account_credit.ts", "{success:true, enrolled:true, creditBalance:500}", credit.code === 0 && isObj(pj) && pj.success === true && isObj(pj.data) && pj.data.enrolled === true && pj.data.creditBalance === 500, credit.stdout.slice(0, 200));

      const dist = exec("slots/distribution/scripts/executors/create_distributor.ts", '{"name":"North Channel"}');
      const dj = parseJson(dist.stdout);
      const distOk = dist.code === 0 && isObj(dj) && dj.success === true && isObj(dj.data) && typeof dj.data.distributorId === "string";
      record("S09", "create_distributor.ts", "{success:true, data.distributorId}", distOk ? JSON.stringify(dj.data) : dist.stdout.slice(0, 200), distOk);
      const distributorId = distOk && isObj(dj) && isObj(dj.data) ? String(dj.data.distributorId) : "";

      const bind = exec("slots/distribution/scripts/executors/bind_inventory.ts", JSON.stringify({ distributorId, productId }));
      const bj = parseJson(bind.stdout);
      record("S10", "bind_inventory.ts", "{success:true, data.bindingId}", bind.code === 0 && isObj(bj) && bj.success === true && isObj(bj.data) && typeof bj.data.bindingId === "string", bind.stdout.slice(0, 200));

      const comm = exec("slots/distribution/scripts/executors/set_commission.ts", JSON.stringify({ distributorId, rate: 0.15 }));
      const cj = parseJson(comm.stdout);
      record("S11", "set_commission.ts", "{success:true, data.rate=0.15}", comm.code === 0 && isObj(cj) && cj.success === true && isObj(cj.data) && cj.data.rate === 0.15, comm.stdout.slice(0, 200));

      const quote = exec("slots/distribution/scripts/executors/browse_and_quote.ts", JSON.stringify({ distributorId, productId }));
      const qj = parseJson(quote.stdout);
      record("S12", "browse_and_quote.ts", "{success:true, available:true, price:199}", quote.code === 0 && isObj(qj) && qj.success === true && isObj(qj.data) && qj.data.available === true && qj.data.price === 199, quote.stdout.slice(0, 200));

      const bindMiss = exec("slots/distribution/scripts/executors/bind_inventory.ts", "{}");
      const bm = parseJson(bindMiss.stdout);
      record("S13", "bind_inventory.ts missing ids", "success=false", isObj(bm) && bm.success === false, bindMiss.stdout.slice(0, 160));
    }
  } finally {
    killProc(child);
  }

  {
    const got = nodeTs("slot-scaffolder/scripts/scaffold_slot.ts", []);
    assertExit("S14", "scaffold_slot.ts missing --domain", got, 2);
    assertContains("S14-err", "scaffold missing domain", got.stderr, "need_user_input: missing --domain", "missing domain");
  }
  {
    const got = nodeTs("slot-scaffolder/scripts/scaffold_slot.ts", ["--domain", "payments"]);
    assertExit("S15", "scaffold_slot.ts missing --openapi", got, 2);
    assertContains("S15-err", "scaffold missing openapi", got.stderr, "need_user_input: missing --openapi", "missing openapi");
  }
  {
    const empty = join(work, "empty-oa");
    mkdirSync(empty, { recursive: true });
    const got = nodeTs("slot-scaffolder/scripts/scaffold_slot.ts", ["--domain", "payments", "--openapi", empty, "--output", join(work, "empty-out")]);
    assertExit("S16", "scaffold_slot.ts empty OpenAPI dir", got, 2);
    assertContains("S16-err", "empty openapi", got.stderr, "need_user_input: missing OpenAPI files", "missing OpenAPI files");
  }
  {
    writeFileSync(
      join(openapiDir, "demo.yaml"),
      [
        "openapi: 3.0.3",
        "info:",
        "  title: Demo",
        '  version: "1.0.0"',
        "paths:",
        "  /v1/payments:",
        "    post:",
        "      operationId: createPayment",
        "      summary: Create a payment",
        "      responses:",
        '        "200":',
        "          description: ok",
        "",
      ].join("\n"),
      "utf8",
    );
    const got = nodeTs("slot-scaffolder/scripts/scaffold_slot.ts", ["--domain", "payments", "--openapi", openapiDir, "--output", scaffoldOut]);
    const json = parseJson(got.stdout);
    const stub = join(scaffoldOut, "scripts", "executors", "createpayment.ts");
    const alt = join(scaffoldOut, "scripts", "executors", "create-payment.ts");
    const stubPath = existsSync(stub) ? stub : alt;
    const ok = got.code === 0 && isObj(json) && json.ok === true && Number(json.executors) >= 1 && existsSync(join(scaffoldOut, "SKILL.md")) && existsSync(join(scaffoldOut, "slot.yaml"));
    record("S17", "scaffold_slot.ts --domain payments", "{ok:true} SKILL.md + slot.yaml + TS stubs", ok ? `${json} stub=${stubPath}` : got.stdout + got.stderr, ok);
    if (existsSync(stubPath)) {
      const text = readFileSync(stubPath, "utf8");
      record("S18", "scaffolded executor", "TS stub with export async function main", text.includes("export async function main") && text.includes("#!/usr/bin/env node"), text.slice(0, 80));
    } else {
      const files = existsSync(join(scaffoldOut, "scripts", "executors")) ? readdirSync(join(scaffoldOut, "scripts", "executors")) : [];
      record("S18", "scaffolded executor", "at least one .ts stub", files.some((f) => f.endsWith(".ts")), files.join(","));
    }
  }
}

function verifyPlanner(): void {
  const lint = "references/case-data-material-planner/scripts/lint_manifest.ts";
  const hash = "references/case-data-material-planner/scripts/hash_manifest.ts";
  const topo = "references/case-data-material-planner/scripts/topo_sort_batch.ts";
  const fin = "references/case-data-material-planner/scripts/finalize.ts";
  const cache = "references/case-data-material-planner/scripts/cache_tool_binding.ts";
  const render = "references/case-data-material-planner/scripts/slot_render.ts";

  {
    const got = nodeTs(lint, []);
    assertExit("L01", "lint_manifest.ts missing --manifest", got, 2);
    assertContains("L01-err", "lint missing manifest", got.stderr, "ERROR: --manifest is required", "required");
  }
  {
    const got = nodeTs(lint, ["--manifest", join(plannerDir, "nope.json")]);
    assertExit("L02", "lint_manifest.ts missing file", got, 2);
    assertContains("L02-err", "lint missing file", got.stderr, "ERROR: manifest not found:", "not found");
  }

  {
    const path = writeManifest("pass.json", emptyManifest());
    const got = nodeTs(lint, ["--manifest", path]);
    const json = parseJson(got.stdout);
    record("L03", "lint empty manifest", '{verdict:"PASS", failingIds empty}', got.code === 0 && isObj(json) && json.verdict === "PASS" && isObj(json.failingIds), got.stdout.slice(0, 200));
  }

  {
    const path = writeManifest("zh-unreach.json", emptyManifest({
      actions: [
        { actionId: "A1", verifyNote: "验证工具不可达/不可用: tool down", toolBinding: {} },
        { actionId: "A2", verifyNote: "ok", toolBinding: {} },
      ],
    }));
    const got = nodeTs(lint, ["--manifest", path]);
    const json = parseJson(got.stdout);
    const details = isObj(json) && Array.isArray(json.details) ? json.details : [];
    const hit = details.some((d) => isObj(d) && d.reason === "verify unreachable");
    record("L04", "lint Chinese verify-tool-unreachable", 'verdict FAIL + reason "verify unreachable"', got.code === 0 && isObj(json) && json.verdict === "FAIL" && hit, got.stdout.slice(0, 240));
    if (PY_AVAILABLE) {
      const pyg = py("references/case-data-material-planner/scripts/lint_manifest.py", ["--manifest", path]);
      const pyj = parseJson(pyg.stdout);
      record("L04-py", "python lint Chinese unreachable", "also FAIL", pyg.code === 0 && isObj(pyj) && pyj.verdict === "FAIL", pyg.stdout.slice(0, 160));
    }
  }

  {
    const path = writeManifest("en-unreach.json", emptyManifest({
      actions: [
        { actionId: "A1", verifyNote: "verify tool unreachable/unavailable: down", toolBinding: {} },
        { actionId: "A2", verifyNote: "ok", toolBinding: {} },
      ],
    }));
    const got = nodeTs(lint, ["--manifest", path]);
    const json = parseJson(got.stdout);
    const details = isObj(json) && Array.isArray(json.details) ? json.details : [];
    const hit = details.some((d) => isObj(d) && d.reason === "verify unreachable");
    record("L05", "lint English verify-tool-unreachable", 'verdict FAIL + "verify unreachable"', got.code === 0 && isObj(json) && json.verdict === "FAIL" && hit, got.stdout.slice(0, 240));
  }

  {
    const path = writeManifest("writeback.json", emptyManifest({
      entities: [{ entityId: "E1", entityStatus: "missing-dependency", dependencies: [] }],
    }));
    const got = nodeTs(lint, ["--manifest", path, "--write-back"]);
    const json = parseJson(got.stdout);
    const disk = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    const gate = isObj(disk.pipelines) && isObj(disk.pipelines["lint-gate"]) ? disk.pipelines["lint-gate"] : {};
    record("L06", "lint --write-back", "stdout FAIL and pipelines.lint-gate written", got.code === 0 && isObj(json) && json.verdict === "FAIL" && gate.verdict === "FAIL" && gate.round === 1, JSON.stringify(gate).slice(0, 160));
  }

  {
    const got = nodeTs(hash, []);
    assertExit("H01", "hash_manifest.ts missing --manifest", got, 2);
  }
  {
    const path = writeManifest("hash-me.json", emptyManifest({ caseId: "hash-1" }));
    const got = nodeTs(hash, ["--manifest", path]);
    const ok = got.code === 0 && /^sha256:[0-9a-f]{64}\n$/.test(got.stdout);
    record("H02", "hash_manifest.ts", "stdout sha256:<64 hex>", ok ? got.stdout.trim() : got.stdout, ok);
    if (PY_AVAILABLE) {
      const pyg = py("references/case-data-material-planner/scripts/hash_manifest.py", ["--manifest", path]);
      record("H02-py", "python/ts hash parity", "same sha256", pyg.code === 0 && pyg.stdout.trim() === got.stdout.trim(), `ts=${got.stdout.trim()} py=${pyg.stdout.trim()}`);
    }
  }
  {
    const got = nodeTs(hash, ["--manifest", join(plannerDir, "missing-hash.json")]);
    assertExit("H03", "hash missing file", got, 2);
  }
  {
    const bad = join(plannerDir, "bad-hash.json");
    writeFileSync(bad, "{not-json", "utf8");
    const got = nodeTs(hash, ["--manifest", bad]);
    assertExit("H04", "hash invalid JSON", got, 3);
    assertContains("H04-err", "hash invalid JSON", got.stderr, "ERROR: invalid JSON in manifest:", "invalid JSON");
    if (PY_AVAILABLE) {
      const pyg = py("references/case-data-material-planner/scripts/hash_manifest.py", ["--manifest", bad]);
      record("H04-py", "python hash invalid JSON", "exit 3", `exit ${pyg.code}`, pyg.code === 3);
    }
  }

  {
    const path = writeManifest("topo-empty.json", emptyManifest());
    const got = nodeTs(topo, ["--manifest", path]);
    const json = parseJson(got.stdout);
    record("T01", "topo empty entities", "{totalEntities:0,totalBatches:0,changed:0}", got.code === 0 && isObj(json) && json.totalEntities === 0 && json.totalBatches === 0, got.stdout);
  }
  {
    const path = writeManifest("topo-ok.json", emptyManifest({
      entities: [
        { entityId: "E1", dependencies: [] },
        { entityId: "E2", dependencies: [{ entityId: "E1" }] },
      ],
    }));
    const got = nodeTs(topo, ["--manifest", path]);
    const json = parseJson(got.stdout);
    const disk = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    const ents = Array.isArray(disk.entities) ? disk.entities : [];
    const e1 = ents.find((e) => isObj(e) && e.entityId === "E1");
    const e2 = ents.find((e) => isObj(e) && e.entityId === "E2");
    record("T02", "topo E1→E2", "batches 1 then 2 written", got.code === 0 && isObj(json) && json.totalBatches === 2 && isObj(e1) && e1.executionBatch === 1 && isObj(e2) && e2.executionBatch === 2, got.stdout);
  }
  {
    const path = writeManifest("topo-cycle.json", emptyManifest({
      entities: [
        { entityId: "A", dependencies: [{ entityId: "B" }] },
        { entityId: "B", dependencies: [{ entityId: "A" }] },
      ],
    }));
    const got = nodeTs(topo, ["--manifest", path]);
    assertExit("T03", "topo circular", got, 1);
    assertContains("T03-err", "topo cycle", got.stderr, "circular dependency detected", "cycle error");
  }

  {
    const path = writeManifest("fin.json", emptyManifest({
      entities: [{ entityId: "E1", constructionStrategy: "tool-build", dataConfidence: 0.8 }],
      actions: [{ actionId: "A1", cmdConfidence: 0.5 }],
    }));
    const got = nodeTs(fin, ["--manifest", path]);
    const json = parseJson(got.stdout);
    const expected = Math.round((0.6 * 0.8 + 0.4 * 0.5) * 10000) / 10000;
    record("N01", "finalize.ts", `caseConfidence=${expected}`, got.code === 0 && isObj(json) && json.caseConfidence === expected && typeof json.generatedAt === "string", got.stdout);
    const disk = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    record("N02", "finalize write-back", "caseConfidence + generatedAt on disk", disk.caseConfidence === expected && typeof disk.generatedAt === "string", JSON.stringify({ c: disk.caseConfidence, g: disk.generatedAt }));
  }

  {
    const got = nodeTs(cache, ["test"]);
    assertExit("K01", "cache_tool_binding.ts test", got, 0);
    assertContains("K01-out", "cache test", got.stdout, "All tests passed.", "self-test passed");
  }
  {
    const got = nodeTs(cache, []);
    record("K02", "cache_tool_binding.ts no command", "exit 1 + usage", got.code === 1 && got.stderr.includes("usage: cache_tool_binding.ts"), `exit ${got.code} ${got.stderr.slice(0, 120)}`);
  }
  {
    const cachePath = join(plannerDir, "cache.json");
    writeFileSync(cachePath, `${JSON.stringify({ version: "2.0", entityBindings: {}, actionBindings: {} }, null, 2)}\n`, "utf8");
    const write = nodeTs(cache, ["write", "--cache", cachePath, "--type", "entity", "--key", "product::create", "--binding", '{"toolType":"skill","resourceId":"catalog"}']);
    const wj = parseJson(write.stdout);
    record("K03", "cache write", "{written:true}", write.code === 0 && isObj(wj) && wj.written === true, write.stdout);
    const look = nodeTs(cache, ["lookup", "--cache", cachePath, "--type", "entity", "--key", "product::create"]);
    const lj = parseJson(look.stdout);
    record("K04", "cache lookup", "{hit:true}", look.code === 0 && isObj(lj) && lj.hit === true, look.stdout);
    const promo = nodeTs(cache, [
      "promote",
      "--cache",
      cachePath,
      "--type",
      "entity",
      "--key",
      "product::create",
      "--confidence",
      "0.9",
      "--invocation",
      '{"invokeCmdTemplate":"node x.ts","paramMapping":[],"outputFields":["productId"]}',
    ]);
    const pj = parseJson(promo.stdout);
    record("K05", "cache promote", "{promoted:true}", promo.code === 0 && isObj(pj) && pj.promoted === true, promo.stdout);
    const inv = nodeTs(cache, ["invalidate", "--cache", cachePath, "--key", "product::create"]);
    const ij = parseJson(inv.stdout);
    record("K06", "cache invalidate", "{invalidated:true}", inv.code === 0 && isObj(ij) && ij.invalidated === true, inv.stdout);
    const badType = nodeTs(cache, ["lookup", "--cache", cachePath, "--type", "nope", "--key", "x"]);
    record("K07", "cache lookup bad --type", "exit 2", badType.code === 2 && badType.stderr.includes("--type must be entity or action"), `exit ${badType.code}`);
  }

  {
    const src = join(plannerDir, "case.md");
    writeFileSync(src, "# 前置条件\n- 商品\n\n# 操作步骤\n1. 创建订单\n", "utf8");
    const path = writeManifest("render.json", emptyManifest({
      caseSource: { type: "local-file", original: src },
      entities: [
        {
          entityId: "E1",
          entityType: "商品",
          constructionStrategy: "tool-build",
          fields: { productId: "p_1", name: "Northwind Standard", city: "demo-city", kind: "standard" },
          constraints: "标准商品",
          targetLocation: "precondition.list[0]",
        },
        {
          entityId: "E2",
          entityType: "配置项",
          constructionStrategy: "config",
          fields: { flag: "config-store get S flag\nconfig-store set S flag 1" },
          targetLocation: "precondition.list[0].entity[1]",
        },
        {
          entityId: "E3",
          entityType: "订单号",
          constructionStrategy: "runtime",
          runtimeSource: { sourceActionId: "A1", sourceOutputField: "orderId" },
          targetLocation: "precondition.list[0].entity[2]",
        },
      ],
      actions: [
        {
          actionId: "A1",
          stepIdx: 1,
          cmdStatus: "filled",
          filledCmd: "node scripts/executors/create_order.ts --json '{\"productId\":\"p_1\",\"userId\":\"u_1\"}'",
          paramsFromEntities: [{ paramName: "productId", sourceEntityId: "E1", sourceField: "productId" }],
          paramsFromPriorActions: [],
          outputs: { orderId: { description: "订单ID" } },
          targetLocation: "steps.list[0]",
        },
      ],
    }));
    const got = nodeTs(render, ["--manifest", path, "--preview-only"]);
    const json = parseJson(got.stdout);
    const disk = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    const ents = Array.isArray(disk.entities) ? disk.entities : [];
    const acts = Array.isArray(disk.actions) ? disk.actions : [];
    const e1 = ents.find((e) => isObj(e) && e.entityId === "E1");
    const e2 = ents.find((e) => isObj(e) && e.entityId === "E2");
    const e3 = ents.find((e) => isObj(e) && e.entityId === "E3");
    const a1 = acts.find((a) => isObj(a) && a.actionId === "A1");
    record("R01", "slot_render --preview-only", "{updated>=1}", got.code === 0 && isObj(json) && Number(json.updated) >= 1, got.stdout);
    const e1p = isObj(e1) ? String(e1.renderPreview) : "";
    record(
      "R02",
      "slot_render Chinese tool-build",
      "all constructed fields productId/name/city/kind",
      e1p.includes("productId=p_1") && e1p.includes("name=Northwind Standard") && e1p.includes("city=demo-city") && e1p.includes("kind=standard") && e1p.includes("，"),
      e1p || "missing",
    );
    const e2p = isObj(e2) ? String(e2.renderPreview) : "";
    record("R03", "slot_render config entity", "配置项（flag） without bash/node", e2p.includes("配置项") && e2p.includes("flag") && !e2p.includes("```") && !e2p.includes("config-store"), e2p || "missing");
    record("R04", "slot_render runtime Chinese", "contains 由步骤 and 执行时产出", isObj(e3) && String(e3.renderPreview).includes("由步骤") && String(e3.renderPreview).includes("执行时产出"), isObj(e3) ? String(e3.renderPreview) : "missing");
    const a1p = isObj(a1) ? String(a1.renderPreview) : "";
    record(
      "R09",
      "slot_render action is business-only",
      "（入参：productId=p_1；产出：orderId） and no node/bash",
      a1p.includes("入参：productId=p_1") && a1p.includes("产出：orderId") && !a1p.includes("node") && !a1p.includes("```"),
      a1p || "missing",
    );
    {
      const priorPath = writeManifest("render-prior.json", emptyManifest({
        caseSource: { type: "local-file", original: src },
        actions: [
          {
            actionId: "A1",
            stepIdx: 1,
            outputs: { orderId: { description: "订单ID" } },
          },
          {
            actionId: "A2",
            stepIdx: 2,
            cmdStatus: "filled",
            filledCmd: "node scripts/executors/check_order.ts --json '{\"orderId\":\"<<A1.orderId>>\"}'",
            paramsFromPriorActions: [{ paramName: "orderId", sourceActionId: "A1", sourceOutputField: "orderId" }],
            outputs: {},
            targetLocation: "steps.list[0]",
          },
        ],
      }));
      const priorGot = nodeTs(render, ["--manifest", priorPath, "--preview-only"]);
      const priorDisk = JSON.parse(readFileSync(priorPath, "utf8")) as JsonObject;
      const priorActs = Array.isArray(priorDisk.actions) ? priorDisk.actions : [];
      const a2 = priorActs.find((a) => isObj(a) && a.actionId === "A2");
      const a2p = isObj(a2) ? String(a2.renderPreview) : "";
      record(
        "R10",
        "slot_render prior-action is business-only",
        "第1步产出的 orderId and no <<A1.orderId>> / node",
        priorGot.code === 0 && a2p.includes("第1步产出的 orderId") && !a2p.includes("<<") && !a2p.includes("node"),
        a2p || priorGot.stderr || "missing",
      );
    }
    const commit = nodeTs(render, ["--manifest", path, "--commit"]);
    const cj = parseJson(commit.stdout);
    const exe = join(plannerDir, "case-executable.md");
    const exeText = existsSync(exe) ? readFileSync(exe, "utf8") : "";
    record(
      "R07",
      "slot_render --commit",
      "{done>=1} writes clean case-executable.md",
      commit.code === 0 && isObj(cj) && Number(cj.done) >= 1 && exeText.includes("productId=p_1") && exeText.includes("name=Northwind Standard") && exeText.includes("kind=standard") && exeText.includes("入参：productId=p_1") && !exeText.includes("```bash") && !exeText.includes("node scripts"),
      commit.stdout + exeText.slice(0, 200),
    );
    const both = nodeTs(render, ["--manifest", path, "--preview-only", "--commit"]);
    assertExit("R08", "slot_render mutually exclusive flags", both, 2);
  }
  {
    const got = nodeTs(render, []);
    assertExit("R05", "slot_render missing --manifest", got, 2);
  }
  {
    const path = writeManifest("render-flags.json", emptyManifest());
    const got = nodeTs(render, ["--manifest", path]);
    assertExit("R06", "slot_render neither preview nor commit", got, 2);
    assertContains("R06-err", "slot_render flags", got.stderr, "one of --preview-only or --commit is required", "flag error");
  }

  {
    const path = writeManifest("cfg-ent.json", emptyManifest({
      entities: [
        {
          entityId: "E1",
          constructionStrategy: "config",
          targetValues: { featureX: { value: "1", serviceId: "svc-1" } },
        },
      ],
    }));
    const ctx = join(plannerDir, "ctx.json");
    writeFileSync(ctx, `${JSON.stringify({ configMap: { featureX: { serviceId: "svc-1" } } }, null, 2)}\n`, "utf8");
    const got = nodeTs("references/case-data-material-planner/scripts/generate_config_commands.ts", ["--manifest", path, "--context", ctx]);
    const json = parseJson(got.stdout);
    const disk = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    const ent = Array.isArray(disk.entities) ? disk.entities[0] : null;
    record("G01", "generate_config_commands.ts", "{processed:1} and set command written", got.code === 0 && isObj(json) && json.processed === 1 && isObj(ent) && isObj(ent.fields) && String(ent.fields.featureX).includes("config-store set"), got.stdout);
    const miss = nodeTs("references/case-data-material-planner/scripts/generate_config_commands.ts", []);
    assertExit("G02", "generate_config_commands missing args", miss, 2);
  }

  {
    const path = writeManifest("merge.json", emptyManifest({ entities: [{ entityId: "E1", fields: {} }] }));
    const patch = join(plannerDir, "patch.json");
    writeFileSync(
      patch,
      `${JSON.stringify({
        agent: "invoke-data",
        targetType: "entity",
        targetId: "E1",
        timestamp: "2026-01-01T00:00:00Z",
        fields: { fields: { productId: "p_9" }, entityStatus: "unverified", dataConfidence: 0.8 },
      }, null, 2)}\n`,
      "utf8",
    );
    const got = nodeTs("references/case-data-material-planner/scripts/merge_patch.ts", ["--manifest", path, "--patch", patch]);
    const json = parseJson(got.stdout);
    const disk = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    const ent = Array.isArray(disk.entities) ? disk.entities[0] : null;
    record(
      "M01",
      "merge_patch.ts",
      "{merged:1} and fields.productId=p_9",
      got.code === 0 && isObj(json) && json.merged === 1 && isObj(ent) && isObj(ent.fields) && ent.fields.productId === "p_9",
      `exit ${got.code} ${got.stdout} ${got.stderr}`.slice(0, 240),
    );
    const miss = nodeTs("references/case-data-material-planner/scripts/merge_patch.ts", []);
    assertExit("M02", "merge_patch missing args", miss, 2);
  }

  {
    const path = writeManifest("rb.json", emptyManifest({
      entities: [{ entityId: "E1", entityStatus: "failed", toolBinding: { resourceId: "product::create" } }],
    }));
    const got = nodeTs("references/case-data-material-planner/scripts/rollback.ts", ["--manifest", path]);
    const json = parseJson(got.stdout);
    record("B01", "rollback.ts", "{affected:...}", got.code === 0 && isObj(json) && isObj(json.affected), got.stdout.slice(0, 200));
  }

  {
    const path = writeManifest("vtil.json", emptyManifest({
      actions: [{ actionId: "A1", cmdStatus: "filled", toolBinding: { toolType: "tool", resourceId: "verify-catalog-product" }, filledParams: { name: "x" } }],
    }));
    const got = nodeTs("references/case-data-material-planner/scripts/verify_tool_input_list.ts", ["--manifest", path]);
    const json = parseJson(got.stdout);
    record("V01", "verify_tool_input_list.ts", "{results:[{actionId,outcome,reason}]}", got.code === 0 && isObj(json) && Array.isArray(json.results), got.stdout.slice(0, 200));
  }

  {
    const got = nodeTs("references/case-data-material-planner/scripts/parallel_search.ts", ["--queries", '["create catalog product"]', "--keywords", '["catalog"]', "--json"]);
    const json = parseJson(got.stdout);
    record("PS01", "parallel_search.ts --json", "{pinned, tools, skill}", got.code === 0 && isObj(json) && "tools" in json && "skill" in json, got.stdout.slice(0, 200));
    const bad = nodeTs("references/case-data-material-planner/scripts/parallel_search.ts", ["--queries", "not-json"]);
    record("PS02", "parallel_search invalid --queries", "exit 1 + ERROR", bad.code === 1 && bad.stderr.includes("ERROR: --queries must be valid JSON array"), `exit ${bad.code}`);
  }

  {
    const got = nodeTs("references/case-data-material-planner/scripts/search_data_build_skill.ts", ["--keywords", "catalog", "--json"]);
    const json = parseJson(got.stdout);
    record("SS01", "search_data_build_skill.ts --json", "search JSON shape", got.code === 0 && isObj(json) && Array.isArray(json.skill_matches), got.stdout.slice(0, 160));
  }

  {
    const path = writeManifest("gate.json", emptyManifest({
      entities: [{ entityId: "E1", toolBinding: { toolStatus: "available" }, entityStatus: null, fields: {} }],
    }));
    const got = nodeTs("references/case-data-material-planner/scripts/gate_check_cdata.ts", ["--manifest", path]);
    const json = parseJson(got.stdout);
    record("C-GATE", "gate_check_cdata.ts incomplete invoke", "exit 1 {pass:false}", got.code === 1 && isObj(json) && json.pass === false && Array.isArray(json.failures), got.stdout);
  }

  {
    const got = nodeTs("references/case-data-material-planner/scripts/experience_compat.ts", []);
    assertExit("EC01", "experience_compat.ts no command", got, 2);
    const fetch = nodeTs("references/case-data-material-planner/scripts/experience_compat.ts", [
      "fetch",
      "--queries",
      JSON.stringify([{ key: "catalog-product::create", type: "entity", query_text: "create catalog product" }]),
    ]);
    const fj = parseJson(fetch.stdout);
    record("EC02", "experience_compat.ts fetch", "{ok:true}", fetch.code === 0 && isObj(fj) && fj.ok === true, fetch.stdout.slice(0, 160));
    const missQ = nodeTs("references/case-data-material-planner/scripts/experience_compat.ts", ["fetch"]);
    record(
      "EC03",
      "experience_compat.ts fetch missing --queries",
      "exit 2; error: --queries is required",
      missQ.code === 2 && missQ.stderr.includes("error: --queries is required"),
      `exit ${missQ.code} ${missQ.stderr.slice(0, 160)}`,
    );
    const missB = nodeTs("references/case-data-material-planner/scripts/experience_compat.ts", ["report"]);
    record(
      "EC04",
      "experience_compat.ts report missing --body",
      "exit 2; error: --body is required",
      missB.code === 2 && missB.stderr.includes("error: --body is required"),
      `exit ${missB.code} ${missB.stderr.slice(0, 160)}`,
    );
  }
}

async function verifyDashboard(): Promise<void> {
  const dir = join(plannerDir, "dash");
  mkdirSync(join(dir, "case-1"), { recursive: true });
  writeFileSync(join(dir, "case-1", "manifest.json"), `${JSON.stringify(emptyManifest({ caseId: "case-1" }), null, 2)}\n`, "utf8");
  const port = 16848;
  const child = spawn(process.execPath, [join(TS_ROOT, "references/case-data-material-planner/scripts/dashboard/server.ts"), "--dir", dir, "--port", String(port)], {
    cwd: TS_ROOT,
    env: isolatedEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (b: Buffer) => {
    out += b.toString("utf8");
  });
  const up = await waitUntil(async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/all`);
      return resp.ok;
    } catch {
      return out.includes("Dashboard:");
    }
  }, 8000);
  record("D01", "dashboard/server.ts --dir", "starts and /api/all is JSON", up, out.slice(0, 120));
  if (up) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/all`);
      const data = (await resp.json()) as JsonObject;
      record("D02", "GET /api/all", "cases.case-1 present", isObj(data.cases) && isObj(data.cases["case-1"]), JSON.stringify(Object.keys(isObj(data.cases) ? data.cases : {})).slice(0, 120));
    } catch (exc) {
      record("D02", "GET /api/all", "JSON cases", false, String(exc));
    }
  }
  {
    const miss = nodeTs("references/case-data-material-planner/scripts/dashboard/server.ts", []);
    record("D03", "dashboard no --dir/--manifest", "exit 1 + Usage", miss.code === 1 && miss.stderr.includes("Usage:"), `exit ${miss.code}`);
  }
  killProc(child);
}

function verifyDocsWorkflow(): void {
  const search = nodeTs("scripts/search_data_build.ts", ["--keywords", "catalog", "--json", "--no-favorites"]);
  const sj = parseJson(search.stdout);
  const skills = isObj(sj) && Array.isArray(sj.skill_matches) ? sj.skill_matches : [];
  const catalog = skills.find((s) => isObj(s) && s.name === "catalog");
  record("W01", "SKILL.md step1 search catalog", "catalog in skill_matches", Boolean(catalog), isObj(catalog) ? String(catalog.skillPath) : "missing");

  const pin = nodeTs("scripts/favorites.ts", [
    "add",
    "--name",
    "catalog",
    "--desc",
    "catalog domain slot",
    "--path",
    join(TS_ROOT, "slots", "catalog"),
  ]);
  record("W02", "SKILL.md pin favorite", "exit 0 pinned", pin.code === 0 && pin.stdout.includes("pinned catalog"), pin.stdout);

  const listed = nodeTs("scripts/search_data_build.ts", ["--keywords", "zzz-no-match", "--json"]);
  const lj = parseJson(listed.stdout);
  const pinned = isObj(lj) && Array.isArray(lj.pinned_matches) ? lj.pinned_matches : [];
  record(
    "W03",
    "search injects pinned favorites without keyword filter",
    "pinned_matches includes catalog",
    pinned.some((p) => isObj(p) && p.name === "catalog"),
    JSON.stringify(pinned.map((p) => (isObj(p) ? p.name : p))).slice(0, 160),
  );

  const pack = nodeTs("scripts/pack_skills.ts", ["--output", join(work, "workflow-pack")]);
  const pj = parseJson(pack.stdout);
  record("W04", "INSTALL.md pack after search/pin", "{ok:true, zips:2}", pack.code === 0 && isObj(pj) && pj.ok === true && Array.isArray(pj.zips) && pj.zips.length === 2, pack.stdout.slice(0, 160));

  const tmpl = run(process.execPath, [join(TS_ROOT, "references/script-template.ts"), "--json", '{"name":"Workflow Item"}'], {
    env: { ...isolatedEnv, DATA_BUILD_API_BASE: "http://127.0.0.1:9" },
  });
  const tj = parseJson(tmpl.stdout);
  record(
    "W05",
    "script-template.ts --json",
    "{success:boolean, data, error}",
    isObj(tj) && typeof tj.success === "boolean" && "data" in tj && "error" in tj,
    tmpl.stdout.slice(0, 200),
  );
}

function verifySqlitePathHelper(): void {
  const got = run(process.execPath, [
    "--input-type=module",
    "-e",
    `import { sqliteFilePath } from ${JSON.stringify(join(TS_ROOT, "scripts/adapters/data_store.ts"))};
     const cases = [
       ["sqlite:///rel.db", "rel.db"],
       ["sqlite:////tmp/db.db", "/tmp/db.db"],
       ["sqlite:///tmp/db.db", "/tmp/db.db"],
       ["sqlite:///./local.db", "./local.db"],
     ];
     const bad = cases.filter(([dsn, exp]) => sqliteFilePath(dsn) !== exp);
     console.log(JSON.stringify({ ok: bad.length === 0, bad, got: Object.fromEntries(cases.map(([d]) => [d, sqliteFilePath(d)])) }));`,
  ]);
  const json = parseJson(got.stdout);
  record(
    "SQL01",
    "sqliteFilePath edge cases",
    "rel / abs / tmp / ./ mappings",
    got.code === 0 && isObj(json) && json.ok === true,
    got.stdout.slice(0, 240),
  );
}

function printReport(): number {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  process.stdout.write("\n=== testdata-generation rewrite assertion report ===\n");
  process.stdout.write(`work dir: ${work}\n`);
  process.stdout.write(`python original: ${PY_AVAILABLE ? PY_ROOT : "unavailable"}\n`);
  process.stdout.write(`total=${results.length} pass=${pass} fail=${fail} skip=${skipped}\n\n`);
  for (const r of results) {
    process.stdout.write(`${r.status}\t${r.id}\t${r.command}\n`);
    process.stdout.write(`  expected: ${r.expected}\n`);
    process.stdout.write(`  actual:   ${r.actual}\n`);
    if (r.detail && r.status === "FAIL") process.stdout.write(`  detail:   ${r.detail}\n`);
  }
  const reportPath = join(work, "assertion-report.json");
  writeFileSync(reportPath, `${JSON.stringify({ pass, fail, skipped, results }, null, 2)}\n`, "utf8");
  process.stdout.write(`\nJSON report: ${reportPath}\n`);
  return fail === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  verifySearch();
  verifyFavorites();
  verifyExperienceClient();
  verifyPackSkills();
  verifyAdaptersCli();
  await verifySlots();
  verifyPlanner();
  await verifyPipeline();
  const pipeScenarios = await runPipelineScenarioSuite();
  for (const row of pipeScenarios as PipeScenarioResult[]) {
    results.push({
      id: row.id,
      command: row.command,
      expected: row.expected,
      actual: row.actual,
      status: row.status,
      detail: row.detail,
    });
    if (row.status === "FAIL") process.stderr.write(`FAIL ${row.id}: ${row.detail || row.actual}\n`);
  }
  const journeys = await runUserJourneySuite();
  for (const row of journeys as JourneyResult[]) {
    results.push({
      id: row.id,
      command: row.command,
      expected: row.expected,
      actual: row.actual,
      status: row.status,
    });
    if (row.status === "FAIL") process.stderr.write(`FAIL ${row.id}: ${row.actual}\n`);
  }
  const extendRows = await runExtendSceneSuite();
  for (const row of extendRows as ExtendResult[]) {
    results.push({
      id: row.id,
      command: row.command,
      expected: row.expected,
      actual: row.actual,
      status: row.status,
    });
    if (row.status === "FAIL") process.stderr.write(`FAIL ${row.id}: ${row.actual}\n`);
  }
  const onboardRows = await runEnterpriseOnboardSuite();
  for (const row of onboardRows as OnboardResult[]) {
    results.push({
      id: row.id,
      command: row.command,
      expected: row.expected,
      actual: row.actual,
      status: row.status,
    });
    if (row.status === "FAIL") process.stderr.write(`FAIL ${row.id}: ${row.actual}\n`);
  }
  await verifyDashboard();
  verifyDocsWorkflow();
  verifySqlitePathHelper();
  return printReport();
}

async function verifyPipeline(): Promise<void> {
  const pipe = "references/case-data-material-planner/scripts/pipeline.ts";
  const select = "references/case-data-material-planner/scripts/select_tool.ts";
  const invoke = "references/case-data-material-planner/scripts/invoke_entity.ts";
  const bind = "references/case-data-material-planner/scripts/bind_action.ts";
  const mergeFields = "references/case-data-material-planner/scripts/merge_executor_fields.ts";

  {
    const got = nodeTs(pipe, ["--help"]);
    assertExit("PL00", "pipeline.ts --help", got, 0);
    assertContains("PL00-help", "pipeline help", got.stdout, "Exit codes", "mentions exit codes");
  }

  {
    const planner = readFileSync(join(TS_ROOT, "references/case-data-material-planner/planner.md"), "utf8");
    const dispatcher = readFileSync(join(TS_ROOT, "references/case-data-material-planner/case-dispatcher.md"), "utf8");
    const banned = ["Launch writeback Agent", "Launch data-pipeline Agent", "Launch action-pipeline Agent"];
    const hit = banned.filter((s) => planner.includes(s) || dispatcher.includes(s));
    record("PL01", "docs cut over", "no Launch data/action/writeback Agent", hit.length === 0, hit.join(" | ") || "clean");
  }

  {
    const got = nodeTs(mergeFields, [
      "--declared",
      '{"productId":null}',
      "--response",
      '{"success":true,"data":{"productId":"p_9","name":"Northwind Standard","city":"demo-city","kind":"standard","success":true}}',
    ]);
    const json = parseJson(got.stdout);
    const fields = isObj(json) && isObj(json.fields) ? json.fields : {};
    record(
      "PL02",
      "merge_executor_fields all business scalars",
      "productId/name/city/kind, no success",
      got.code === 0 && fields.productId === "p_9" && fields.name === "Northwind Standard" && fields.kind === "standard" && !("success" in fields),
      got.stdout.slice(0, 240),
    );
  }

  const src = join(plannerDir, "pipe-src.md");
  writeFileSync(
    src,
    "# 用例标题：标准商品下单成功\n\n## 前置条件\n1. 系统中存在一个可售的标准商品\n2. 存在测试用户 u_1001\n\n## 步骤\n1. 使用用户 u_1001 对上述商品创建一笔标准商品订单\n2. 校验订单状态为已创建\n\n## 预期\n- 返回 productId、orderId\n",
    "utf8",
  );
  const first = nodeTs(pipe, [
    "--case-id",
    "pipe-catalog",
    "--source",
    src,
    "--materials-root",
    plannerDir,
    "--scope",
    "full",
  ]);
  assertExit("PL03", "pipeline.ts before parse", first, 11);
  const need = parseJson(first.stdout);
  record("PL03-need", "pipeline exit 11 payload", 'need:"parse-case"', isObj(need) && need.need === "parse-case", first.stdout.slice(0, 200));

  const manifestPath = join(plannerDir, "pipe-catalog", "manifest.json");
  record("PL04", "init_manifest created", "manifest.json exists", existsSync(manifestPath), manifestPath);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as JsonObject;
  manifest.entities = [
    {
      entityId: "E01",
      entityType: "product",
      constructionStrategy: "tool-build",
      constraints: "可售的标准商品，处于上架可售状态",
      fields: { productId: null },
      queries: { angleA: "创建一个可售的标准商品", angleB: "目录标准商品上架" },
      toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
      dependencies: [],
      entityStatus: null,
      targetLocation: "precondition.list[0]",
    },
    {
      entityId: "E02",
      entityType: "user",
      constructionStrategy: "static-value",
      constraints: "测试用户，用户ID已在用例文本中给出",
      fields: { userId: "u_1001" },
      queries: { angleA: null, angleB: null },
      toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
      entityStatus: "verified",
      dataConfidence: 0.85,
      targetLocation: "precondition.list[1]",
    },
  ];
  manifest.actions = [
    {
      actionId: "A01",
      stepIdx: 1,
      actionDesc: "使用用户 u_1001 对可售的标准商品创建一笔标准商品订单",
      queries: { angleA: "调用下单接口创建标准商品订单", angleB: "用户预订标准商品下单" },
      toolBinding: { toolType: null, resourceId: null, cmdTemplate: null, toolStatus: null },
      paramsFromEntities: [
        { paramName: "productId", sourceEntityId: "E01", sourceField: "productId" },
        { paramName: "userId", sourceEntityId: "E02", sourceField: "userId" },
      ],
      paramsFromGenerators: [],
      paramsFromPriorActions: [],
      outputs: { orderId: { description: "订单ID" }, productId: { description: "商品ID" } },
      cmdStatus: null,
      targetLocation: "steps.list[0]",
    },
  ];
  (manifest.pipelines as JsonObject).parse = { status: "done" };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const port = 18766;
  const env = { ...isolatedEnv, DATA_BUILD_API_BASE: `http://127.0.0.1:${port}` };
  const child = spawn(process.execPath, [join(TS_ROOT, "slots/mock_server.ts"), "--port", String(port)], {
    cwd: TS_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const up = await waitUntil(async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      return resp.ok;
    } catch {
      return false;
    }
  });
  if (!up) {
    record("PL05", "pipeline mock server", "health ok", false, "mock did not start");
    child.kill();
    return;
  }

  try {
    const sel = nodeTs(select, ["--manifest", manifestPath, "--type", "entity", "--id", "E01"], env);
    const selj = parseJson(sel.stdout);
    record(
      "PL05",
      "select_tool.ts product entity",
      "bound skill create_product, exit 0",
      sel.code === 0 && isObj(selj) && selj.bound === true && String(isObj(selj.toolBinding) ? selj.toolBinding.invokeCmd : "").includes("create_product.ts"),
      sel.stdout.slice(0, 240),
    );

    const inv = nodeTs(invoke, ["--manifest", manifestPath, "--entity-id", "E01"], env);
    const invj = parseJson(inv.stdout);
    const fields = isObj(invj) && isObj(invj.fields) ? invj.fields : {};
    record(
      "PL06",
      "invoke_entity.ts skill executor",
      "verified + productId/name/city/kind",
      inv.code === 0 && isObj(invj) && invj.entityStatus === "verified" && Boolean(fields.productId) && fields.kind === "standard" && Boolean(fields.name) && fields.city === "demo-city",
      inv.stdout.slice(0, 280),
    );

    const toolScript = join(plannerDir, "fake-tool.ts");
    writeFileSync(
      toolScript,
      `#!/usr/bin/env node
const i = process.argv.indexOf("--json");
const params = JSON.parse(process.argv[i + 1] || "{}");
console.log(JSON.stringify({ success: true, data: { productId: "p_tool", name: params.name || "from-tool", city: "demo-city", kind: "standard" } }));
`,
      "utf8",
    );
    const pub = nodeTs("scripts/adapters/cli.ts", [
      "tool_registry.publish",
      "pipe-catalog-tool",
      "create catalog product via registry",
      toolScript,
      '[{"name":"name","type":"string","required":true}]',
    ], env);
    const pubj = parseJson(pub.stdout);
    record("PL07", "publish local tool", "{ok:true}", pub.code === 0 && isObj(pubj) && pubj.ok === true, pub.stdout.slice(0, 200));

    const toolManifest = writeManifest("pipe-tool.json", emptyManifest({
      policyVersion: "2.0.0",
      entities: [
        {
          entityId: "E01",
          entityType: "product",
          constructionStrategy: "tool-build",
          fields: { productId: null },
          toolBinding: {
            toolType: "tool",
            resourceId: "pipe-catalog-tool",
            invokeCmd: null,
            toolStatus: "available",
          },
          entityStatus: null,
          dependencies: [],
        },
      ],
    }));
    const toolInv = nodeTs(invoke, ["--manifest", toolManifest, "--entity-id", "E01"], env);
    const toolj = parseJson(toolInv.stdout);
    const tf = isObj(toolj) && isObj(toolj.fields) ? toolj.fields : {};
    record(
      "PL08",
      "invoke_entity.ts toolType=tool",
      "merges registry data productId=p_tool",
      toolInv.code === 0 && isObj(toolj) && tf.productId === "p_tool" && tf.kind === "standard",
      toolInv.stdout.slice(0, 280),
    );

    const httpCfg = join(work, "http-empty.yaml");
    writeFileSync(
      httpCfg,
      [
        "workspace:",
        "  testdata_dir: ./testdata",
        "adapters:",
        "  tool_registry:",
        "    type: http",
        `    path: ${join(work, "tools")}`,
        "    http:",
        "      base_url: \"\"",
      ].join("\n"),
      "utf8",
    );
    const httpInv = nodeTs(invoke, ["--manifest", toolManifest, "--entity-id", "E01"], { ...env, DATA_BUILD_CONFIG: httpCfg });
    const httpj = parseJson(httpInv.stdout);
    const hf = isObj(httpj) && isObj(httpj.fields) ? httpj.fields : {};
    record(
      "PL09",
      "tool_registry type=http empty base falls back",
      "local execute; productId=p_tool",
      httpInv.code === 0 && isObj(httpj) && hf.productId === "p_tool",
      httpInv.stdout.slice(0, 240),
    );

    const resumed = nodeTs(pipe, ["--manifest", manifestPath, "--resume", "--scope", "full"], env);
    const resumedj = parseJson(resumed.stdout);
    const disk = JSON.parse(readFileSync(manifestPath, "utf8")) as JsonObject;
    const e01 = Array.isArray(disk.entities) ? disk.entities.find((e) => isObj(e) && e.entityId === "E01") : undefined;
    const a01 = Array.isArray(disk.actions) ? disk.actions.find((a) => isObj(a) && a.actionId === "A01") : undefined;
    const exe = join(plannerDir, "pipe-catalog", "case-executable.md");
    const exeText = existsSync(exe) ? readFileSync(exe, "utf8") : "";
    record(
      "PL10",
      "pipeline.ts --resume Path B",
      "exit 0 writeback + all product fields + no node/8765",
      resumed.code === 0 &&
        isObj(resumedj) &&
        resumedj.ok === true &&
        isObj(e01) &&
        isObj(e01.fields) &&
        Boolean(e01.fields.productId) &&
        e01.fields.kind === "standard" &&
        isObj(a01) &&
        a01.cmdStatus === "filled" &&
        exeText.includes("kind=standard") &&
        exeText.includes("userId=u_1001") &&
        exeText.includes("入参：") &&
        !exeText.includes("node ") &&
        !exeText.includes("8765"),
      `exit ${resumed.code} ${resumed.stdout.slice(0, 220)} exe=${exeText.slice(0, 180)}`,
    );

    const bindHelp = nodeTs(bind, ["--help"]);
    assertExit("PL11", "bind_action.ts --help", bindHelp, 0);

    const lintFail = writeManifest("pipe-lint.json", emptyManifest({
      policyVersion: "2.0.0",
      caseId: "pipe-lint",
      caseSource: { type: "local-file", original: src },
      pipelines: {
        "knowledge-build": { status: "skipped" },
        parse: { status: "done" },
        preprocess: { status: "done" },
        "data-track": { status: "done" },
        "action-track": { status: "done" },
        "lint-gate": { status: "pending", round: 0, verdict: null, failingIds: { entities: [], actions: [] } },
        writeback: { status: "pending" },
      },
      entities: [
        {
          entityId: "E99",
          entityType: "product",
          constructionStrategy: "tool-build",
          fields: { productId: null },
          toolBinding: { toolType: "skill", resourceId: "catalog", invokeCmd: "node x.ts", toolStatus: "available" },
          entityStatus: null,
        },
      ],
    }));
    const lintRun = nodeTs(pipe, ["--manifest", lintFail, "--resume", "--scope", "full"], env);
    const lintj = parseJson(lintRun.stdout);
    record(
      "PL12",
      "pipeline.ts lint FAIL",
      "exit 20 need:c3",
      lintRun.code === 20 && isObj(lintj) && lintj.need === "c3",
      `exit ${lintRun.code} ${lintRun.stdout.slice(0, 200)}`,
    );

    const unknown = writeManifest("pipe-unknown.json", emptyManifest({
      policyVersion: "2.0.0",
      entities: [
        {
          entityId: "E77",
          entityType: "widget",
          constructionStrategy: "tool-build",
          constraints: "an unmapped widget with no slot executor",
          fields: { widgetId: null },
          queries: { angleA: "construct a widget that does not exist", angleB: "unknown widget factory" },
          toolBinding: { toolType: null, resourceId: null, invokeCmd: null, toolStatus: null },
          entityStatus: null,
        },
      ],
    }));
    const needLlm = nodeTs(select, ["--manifest", unknown, "--type", "entity", "--id", "E77"], env);
    const needj = parseJson(needLlm.stdout);
    record(
      "PL13",
      "select_tool.ts unknown entity",
      "exit 10 needLlm",
      needLlm.code === 10 && isObj(needj) && needj.needLlm === true,
      `exit ${needLlm.code} ${needLlm.stdout.slice(0, 200)}`,
    );
  } finally {
    child.kill();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("_verify_rewrite.ts")) {
  process.exit(await main());
}
