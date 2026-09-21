#!/usr/bin/env node
/** Shared module for reading and writing manifest JSON. */

import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { JsonObject } from "../../../scripts/adapters/config.ts";
import { ensureManifestShape, loadJsonObjectFile } from "./safe_io.ts";

export function loadManifest(path: string): JsonObject {
  const data = loadJsonObjectFile(path, "manifest");
  ensureManifestShape(data);
  return data;
}

export function dumpManifest(path: string, data: JsonObject): void {
  const dirName = dirname(path) || ".";
  const tmpPath = join(dirName, `.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmpPath, "w");
  try {
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    writeSync(fd, payload, 0, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export { loadManifest as load_manifest, dumpManifest as dump_manifest };
