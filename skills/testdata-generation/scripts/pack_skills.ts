#!/usr/bin/env node
/** Pack this repository as one Agent Skill zip. */

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SKILL_NAME = "testdata-generation";
// Agent Skills spec: 1-64 chars, lowercase a-z / 0-9 / single hyphens, no leading, trailing, or consecutive hyphens.
const NAME_RE = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKIP_NAMES = new Set([
  ".git",
  "__pycache__",
  ".venv",
  "testdata",
  "dist",
  "node_modules",
  ".idea",
  ".vscode",
  "__MACOSX",
  ".DS_Store",
]);
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function frontmatter(skillMd: string): Record<string, string> {
  const text = readFileSync(skillMd, "utf8");
  if (!text.startsWith("---")) throw new Error(`${skillMd}: missing YAML frontmatter`);
  const end = text.indexOf("\n---", 3);
  if (end < 0) throw new Error(`${skillMd}: unclosed frontmatter`);
  const meta: Record<string, string> = {};
  let current = "";
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith(" ") && current) {
      meta[current] = `${meta[current] || ""} ${line.trim()}`.trim();
      continue;
    }
    if (line.includes(":")) {
      const idx = line.indexOf(":");
      current = line.slice(0, idx).trim();
      let cleaned = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if ([">", ">-", "|", "|-"].includes(cleaned)) cleaned = "";
      meta[current] = cleaned;
    }
  }
  return meta;
}

export function validateSkill(skillDir: string): Record<string, string> {
  const skillMd = join(skillDir, "SKILL.md");
  if (!statSync(skillMd, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`SKILL.md not found: ${skillDir}`);
  }
  const meta = frontmatter(skillMd);
  const name = (meta.name || "").trim();
  const desc = (meta.description || "").trim();
  if (!name || !NAME_RE.test(name)) {
    throw new Error(`${skillMd}: invalid name ${JSON.stringify(name)} (lowercase a-z, digits, and single hyphens only; max 64 chars)`);
  }
  const dirName = skillDir.split(/[/\\]/).pop();
  if (name !== dirName) throw new Error(`${skillMd}: name ${JSON.stringify(name)} != directory ${JSON.stringify(dirName)}`);
  if (!desc) throw new Error(`${skillMd}: empty description`);
  if (name.length > 64 || desc.length > 1024) throw new Error(`${skillMd}: name or description exceeds Agent Skills limits`);
  for (const required of ["scripts", "references", "assets", "slots"]) {
    if (!statSync(join(skillDir, required), { throwIfNoEntry: false })) {
      throw new Error(`${skillDir}: missing standard folder ${required}/`);
    }
  }
  return meta;
}

export function isSkippedName(name: string): boolean {
  return SKIP_NAMES.has(name) || name.startsWith("._") || name.endsWith(".pyc");
}

export function isSkippedPath(relPosix: string): boolean {
  return posixParts(relPosix).some(isSkippedName);
}

function posixParts(relPosix: string): string[] {
  return relPosix.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
}

export function resolveSafeDest(destRoot: string, relPosix: string): string {
  const parts = posixParts(relPosix);
  if (!parts.length || parts.includes("..")) throw new Error(`unsafe archive path: ${relPosix}`);
  const root = resolve(destRoot);
  const dest = resolve(root, ...parts);
  const rel = relative(root, dest);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`unsafe archive path: ${relPosix}`);
  return dest;
}

function isUnixSymlink(versionMadeBy: number, extAttr: number): boolean {
  if (versionMadeBy >> 8 !== 3) return false;
  return ((extAttr >>> 16) & S_IFMT) === S_IFLNK;
}

export function stageTree(src: string, destRoot: string): string[] {
  const written: string[] = [];
  const walk = (dir: string, relBase: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isSkippedName(entry.name) || entry.isSymbolicLink()) continue;
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (isSkippedPath(rel)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const dest = resolveSafeDest(destRoot, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(full));
      written.push(relative(destRoot, dest).split("\\").join("/"));
    }
  };
  mkdirSync(destRoot, { recursive: true });
  walk(src, "");
  return written.sort();
}

export function extractZip(zipPath: string, destRoot: string): string[] {
  const buf = readFileSync(zipPath);
  let off = findEocd(buf);
  const count = buf.readUInt16LE(off + 10);
  off = buf.readUInt32LE(off + 16);
  const written: string[] = [];
  mkdirSync(destRoot, { recursive: true });
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error("invalid zip: bad central header");
    }
    const versionMadeBy = buf.readUInt16LE(off + 4);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const extAttr = buf.readUInt32LE(off + 38);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || isSkippedPath(name) || isUnixSymlink(versionMadeBy, extAttr)) continue;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error(`invalid zip: bad local header for ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    let data: Buffer;
    if (method === 0) data = Buffer.from(buf.subarray(dataOff, dataOff + uncompSize));
    else if (method === 8) data = inflateRawSync(buf.subarray(dataOff, dataOff + compSize));
    else throw new Error(`unsupported zip method ${method} for ${name}`);
    const dest = resolveSafeDest(destRoot, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    written.push(relative(destRoot, dest).split("\\").join("/"));
  }
  return written.sort();
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("invalid zip: no EOCD");
}

function copyTree(src: string, dest: string): void {
  stageTree(src, dest);
}

function chmodScripts(root: string): void {
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isSkippedName(entry.name) || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        const mode = lstatSync(full).mode;
        chmodSync(full, mode | 0o111);
      }
    }
  };
  walk(root);
}

function collectFiles(src: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isSkippedName(entry.name) || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(src, full).split("\\").join("/");
      if (isSkippedPath(rel) || posixParts(rel).includes("..")) continue;
      out.push(full);
    }
  };
  walk(src);
  return out.sort();
}

async function zipDir(src: string, zipPath: string, arcRoot: string | null): Promise<void> {
  mkdirSync(dirname(zipPath), { recursive: true });
  await writeZip(src, zipPath, collectFiles(src), arcRoot);
}

async function writeZip(src: string, zipPath: string, files: string[], arcRoot: string | null): Promise<void> {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const crcTable = makeCrcTable();
  const crc32 = (buf: Buffer) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const dosDate = () => {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  };
  const { time, date } = dosDate();
  const entries: string[] = [];
  for (const file of files) {
    const rel = relative(src, file).split("\\").join("/");
    const name = arcRoot ? `${arcRoot}/${rel}` : rel;
    if (isSkippedPath(name) || posixParts(name).includes("..")) continue;
    entries.push(file);
    const data = readFileSync(file);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localStart = offset;
    chunks.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(localStart, 42);
    central.push(cen, nameBuf);
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  writeFileSync(zipPath, Buffer.concat([...chunks, ...central, eocd]));
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

export async function packSkill(destDir: string): Promise<string> {
  const staging = mkdtempSync(join(tmpdir(), "ov-skill-"));
  try {
    const skill = join(staging, SKILL_NAME);
    copyTree(ROOT, skill);
    chmodScripts(skill);
    validateSkill(skill);
    const zipPath = join(destDir, `${SKILL_NAME}.zip`);
    await zipDir(skill, zipPath, SKILL_NAME);
    return zipPath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function packClaudePlugin(destDir: string): Promise<string> {
  const staging = mkdtempSync(join(tmpdir(), "ov-plugin-"));
  try {
    const plugin = join(staging, "plugin");
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    mkdirSync(join(plugin, "skills", SKILL_NAME), { recursive: true });
    const skillMeta = frontmatter(join(ROOT, "SKILL.md"));
    writeFileSync(
      join(plugin, ".claude-plugin", "plugin.json"),
      `${JSON.stringify({
        name: SKILL_NAME,
        description: skillMeta.description || "Constructs test data and case-material preconditions",
        version: "1.0.0",
      }, null, 2)}\n`,
      "utf8",
    );
    copyTree(ROOT, join(plugin, "skills", SKILL_NAME));
    chmodScripts(plugin);
    const zipPath = join(destDir, `${SKILL_NAME}-claude-plugin.zip`);
    await zipDir(plugin, zipPath, null);
    return zipPath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      output: { type: "string", default: join(ROOT, "dist") },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node pack_skills.ts [--output <dir>]

Pack this repository as one Agent Skill zip (and a Claude plugin zip).

Options:
  --output <dir>   Destination directory (default: <skill-root>/dist)
  -h, --help       Show this help and exit

Examples:
  node pack_skills.ts --output ./dist
  node pack_skills.ts
`);
    return 0;
  }
  const dest = resolve(expandUserSafe(String(values.output)));
  mkdirSync(dest, { recursive: true });
  const built = [await packSkill(dest), await packClaudePlugin(dest)];
  process.stdout.write(`${JSON.stringify({ ok: true, zips: built }, null, 2)}\n`);
  return 0;
}

function expandUserSafe(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    const { homedir } = requireOs();
    return path === "~" ? homedir() : join(homedir(), path.slice(2));
  }
  return path;
}

function requireOs(): { homedir: () => string } {
  return { homedir: () => process.env.HOME || process.env.USERPROFILE || "" };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("pack_skills.ts")) {
  process.exit(await main());
}
