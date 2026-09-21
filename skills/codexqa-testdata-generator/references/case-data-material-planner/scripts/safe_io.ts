/** Shared guards for untrusted manifests, executor paths, and JSON blobs. */

import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolvePackRoot, resolveSkillDir, type Json, type JsonObject } from "../../../scripts/adapters/config.ts";
import { listSlotRoots } from "../../../scripts/adapters/slot_roots.ts";

export const MAX_JSON_BYTES = 2_000_000;
export const MAX_FLAT_KEYS = 200;
export const MAX_FLAT_DEPTH = 8;
export const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class InputError extends Error {
  code: string;
  constructor(message: string, code = "EINVAL") {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key) || key.includes("__proto__") || key.includes("\0");
}

export function assertSafeCaseId(caseId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(caseId)) {
    throw new InputError(`invalid caseId: ${JSON.stringify(caseId)}`);
  }
  return caseId;
}

function real(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : resolve(path);
  } catch {
    return resolve(path);
  }
}

export function isPathInside(absPath: string, root: string): boolean {
  const abs = real(absPath);
  const base = real(root);
  const rel = relative(base, abs);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function executorAllowRoots(extraSkillRoot?: string | null): string[] {
  const roots = [resolvePackRoot(), resolveSkillDir(), resolve(process.cwd(), "testdata")];
  const extra = String(process.env.DATA_BUILD_SCRIPT_ROOTS || "")
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean);
  roots.push(...extra);
  try {
    roots.push(...listSlotRoots());
  } catch {
    /* config optional */
  }
  const packSlots = resolve(resolvePackRoot(), "slots");
  if (extraSkillRoot && (isPathInside(extraSkillRoot, packSlots) || roots.some((root) => isPathInside(extraSkillRoot, root)))) {
    roots.push(extraSkillRoot);
  }
  return [...new Set(roots.map((r) => resolve(r)))];
}

export function isAllowedExecutorPath(absPath: string, extraSkillRoot?: string | null): boolean {
  if (!absPath || absPath.includes("\0") || absPath.includes("..")) return false;
  if (!/\.(ts|js)$/i.test(absPath)) return false;
  let resolved = resolve(absPath);
  try {
    if (existsSync(resolved)) resolved = realpathSync(resolved);
  } catch {
    return false;
  }
  try {
    if (existsSync(resolved) && !lstatSync(resolved).isFile()) return false;
  } catch {
    return false;
  }
  return executorAllowRoots(extraSkillRoot).some((root) => isPathInside(resolved, root));
}

export function parseJsonObject(text: string, label = "JSON"): JsonObject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new InputError(`invalid ${label}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InputError(`${label} must be a JSON object`);
  }
  return data as JsonObject;
}

export function extractJsonObject(text: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return parseJsonObject(trimmed, "executor stdout");
  } catch {
    /* prefix logs are common; scan for the first parseable object */
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] !== "{") continue;
    try {
      return parseJsonObject(trimmed.slice(i), "executor stdout");
    } catch {
      continue;
    }
  }
  throw new InputError("executor stdout is not JSON");
}

export function loadJsonObjectFile(path: string, label = "JSON file"): JsonObject {
  if (!path || path.includes("\0")) throw new InputError(`${label} path is invalid`, "EINVAL");
  if (!existsSync(path)) throw new InputError(`${label} not found: ${path}`, "ENOENT");
  const st = statSync(path);
  if (!st.isFile()) throw new InputError(`${label} is not a file: ${path}`, "EINVAL");
  if (st.size > MAX_JSON_BYTES) throw new InputError(`${label} exceeds ${MAX_JSON_BYTES} bytes`, "EFBIG");
  return parseJsonObject(readFileSync(path, "utf8"), label);
}

export function ensureManifestShape(manifest: JsonObject): void {
  if (manifest.entities != null && !Array.isArray(manifest.entities)) {
    throw new InputError("manifest.entities must be an array");
  }
  if (manifest.actions != null && !Array.isArray(manifest.actions)) {
    throw new InputError("manifest.actions must be an array");
  }
}

export function sanitizeParamValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text || text.includes("\0") || /[\r\n]/.test(text)) return null;
  if (text.length > 512) return null;
  return text;
}

export function flattenGuard(key: string, depth: number, size: number): boolean {
  if (isDangerousKey(key)) return false;
  if (depth > MAX_FLAT_DEPTH) return false;
  if (size >= MAX_FLAT_KEYS) return false;
  return true;
}

export type { Json, JsonObject };
