import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("pack + install", () => {
  it("frontmatter is agent-skills compatible", () => {
    const text = readFileSync(join(ROOT, "SKILL.md"), "utf8");
    assert.ok(text.startsWith("---\n"));
    assert.match(text, /^name: defect-detection$/m);
    // Agent Skills spec allows description up to 1024 chars; folded YAML is OK.
    const fmEnd = text.indexOf("\n---", 4);
    assert.ok(fmEnd > 0, "missing YAML frontmatter end");
    const fmLines = text.slice(4, fmEnd).split("\n");
    const descIdx = fmLines.findIndex((l) => l.startsWith("description:"));
    assert.ok(descIdx >= 0, "missing description");
    let descText = "";
    if (/^description:\s*>-?\s*$/.test(fmLines[descIdx])) {
      for (let i = descIdx + 1; i < fmLines.length; i++) {
        if (/^[a-zA-Z]/.test(fmLines[i])) break;
        descText += ` ${fmLines[i].trim()}`;
      }
    } else {
      descText = fmLines[descIdx].replace(/^description:\s*/, "");
    }
    descText = descText.replace(/\s+/g, " ").trim();
    assert.ok(descText.length > 0 && descText.length <= 1024, `description length ${descText.length}`);
    assert.match(descText, /git|branch|PR|defect|bug/i);
    assert.match(text, /metadata:/);
    assert.match(text, /"node"/);
  });

  it("zip install then run from other cwd", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-pack-"));
    const pack = spawnSync("bash", [join(ROOT, "pack-skill.sh"), tmp], { encoding: "utf8" });
    assert.equal(pack.status, 0, pack.stderr + pack.stdout);
    const zipPath = join(tmp, "defect-detection.zip");
    assert.ok(existsSync(zipPath));
    const listing = spawnSync("unzip", ["-l", zipPath], { encoding: "utf8" });
    assert.match(listing.stdout, /defect-detection\/SKILL.md/);
    assert.match(listing.stdout, /defect-detection\/scripts\/detect.ts/);
    assert.doesNotMatch(listing.stdout, /\.jar/);
    assert.doesNotMatch(listing.stdout, /\/tests\//);
    assert.doesNotMatch(listing.stdout, /(open_)?detect\.py/);
    assert.doesNotMatch(listing.stdout, /__MACOSX/);
    assert.doesNotMatch(listing.stdout, /\/\._/);
    assert.doesNotMatch(listing.stdout, /\.DS_Store/);

    const skills = join(tmp, "skills");
    spawnSync("unzip", ["-q", zipPath, "-d", skills], { encoding: "utf8" });
    const installed = join(skills, "defect-detection");
    assert.ok(existsSync(join(installed, "SKILL.md")));

    const other = join(tmp, "unrelated-project");
    spawnSync("mkdir", ["-p", other]);
    const proc = spawnSync(process.execPath, [
      join(installed, "scripts", "detect.ts"),
      "get-plan-info", "--plan-id", "1001", "--plan-type", "2",
    ], {
      cwd: other,
      encoding: "utf8",
      env: {
        ...process.env,
        DETECTION_ENTERPRISE_DIR: join(installed, "enterprise"),
        DETECTION_DATA_DIR: join(tmp, "data"),
        CONTENT_JSON_BASE: join(tmp, "content"),
      },
    });
    assert.equal(proc.status, 0, proc.stderr);
    const body = JSON.parse(proc.stdout.trim());
    assert.equal(body.code, 0);
    assert.equal(body.data.planId, 1001);
    assert.equal(body.source, "provider");
  });
});
