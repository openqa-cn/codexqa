// Shared helper: materialise one branch of the inventory-service fixture.
//
// The fixture is stored as `base/` (the complete known-good service, committed
// to `main`) plus `head/` (only the files the feature branch changes). Keeping
// the changed files in their own directory makes the seeded defects reviewable
// as a plain diff instead of hiding them inside a generator script.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Write one variant of the fixture into `dest`.
 *
 * @param {string} dest       target directory (created; existing content removed)
 * @param {"base"|"head"} variant
 */
export function materialize(dest, variant) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(FIXTURE_ROOT, "base"), dest, { recursive: true });
  if (variant === "head") {
    cpSync(join(FIXTURE_ROOT, "head"), dest, { recursive: true });
  }
  return dest;
}
