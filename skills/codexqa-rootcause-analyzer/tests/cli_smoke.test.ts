import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import { validate_report, SECTION_CHAR_LIMIT, SECTION_CHAR_LIMIT_STORY } from "../scripts/report.ts";
import { resolve_repo } from "../scripts/resolve_repo.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIAGNOSE = join(ROOT, "scripts", "diagnose.ts");

function run(args: string[], env: Record<string, string | undefined> = {}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [DIAGNOSE, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, ...env },
    timeout: 15_000,
  });
}

function parse_stdout(proc: ReturnType<typeof spawnSync>): any {
  const text = String(proc.stdout || "").trim();
  assert.ok(text, `empty stdout. stderr=${proc.stderr}`);
  return JSON.parse(text);
}

describe("cli help", () => {
  it("lists diagnosis commands", () => {
    const proc = run(["-h"]);
    assert.equal(proc.status, 0);
    assert.match(proc.stdout, /submit/);
    assert.match(proc.stdout, /ensure-codexqa/);
    assert.match(proc.stdout, /parse-exception/);
    assert.match(proc.stdout, /analyze-frames/);
    assert.match(proc.stdout, /write-report/);
    assert.match(proc.stdout, /draft-report/);
    assert.match(proc.stdout, /run/);
    assert.match(proc.stdout, /happy path/);
    assert.match(proc.stdout, /submit/);
  });
});

describe("submit + parse + report", () => {
  let dataDir: string;
  let codeDir: string;
  const saved = process.env.DIAGNOSE_DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "diag-data-"));
    codeDir = mkdtempSync(join(tmpdir(), "diag-code-"));
    writeFileSync(join(codeDir, "OrderService.java"), "class OrderService { void checkout() {} }\n");
    process.env.DIAGNOSE_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DIAGNOSE_DATA_DIR;
    else process.env.DIAGNOSE_DATA_DIR = saved;
  });

  it("submits local dir, parses exception, writes report", () => {
    const stack = join(codeDir, "npe.txt");
    writeFileSync(
      stack,
      `java.lang.NullPointerException: order is null
	at com.example.order.OrderService.checkout(OrderService.java:42)
	at java.base/java.lang.Thread.run(Thread.java:840)
`,
    );

    const submitted = run(["submit", "--exception-file", stack, "--dir", codeDir], {
      DIAGNOSE_DATA_DIR: dataDir,
    });
    assert.equal(submitted.status, 0, submitted.stderr + submitted.stdout);
    const body = parse_stdout(submitted);
    assert.equal(body.ok, true);
    assert.equal(body.taskId, 1);
    assert.equal(body.parsed.appFrameCount, 1);
    assert.equal(body.nextCli.cmd, "ensure-codexqa");
    assert.equal(body.source, "materialized");
    assert.equal(body.materialized, true);
    assert.ok(body.copiedFiles.includes("OrderService.java"));
    assert.equal(existsSync(join(codeDir, ".git")), false);
    assert.ok(existsSync(join(dataDir, "1", "repo", ".git")));

    const parsed = run(["parse-exception", "--task-id", "1"], { DIAGNOSE_DATA_DIR: dataDir });
    assert.equal(parsed.status, 0, parsed.stderr + parsed.stdout);
    const parsedBody = parse_stdout(parsed);
    assert.equal(parsedBody.exceptionType, "java.lang.NullPointerException");

    const status = run(["status", "--task-id", "1"], { DIAGNOSE_DATA_DIR: dataDir });
    assert.equal(status.status, 0);
    assert.equal(parse_stdout(status).meta.codexqa.attempted, false);

    const report = `# Exception diagnosis

## Executive summary
NPE in OrderService.checkout.

## Symptom and exception facts
- Type: NullPointerException

## Mapped call path
unverified

## Root cause
null order

## Trigger
OrderService#checkout L42

## Contributing factors
- missing guard

## Suggested fix and verification
1. null check

## Confidence and gaps
- Confidence: low
`;
    const written = run(["write-report", "--task-id", "1", "--markdown", report], {
      DIAGNOSE_DATA_DIR: dataDir,
    });
    assert.equal(written.status, 0, written.stderr + written.stdout);
    const writtenBody = parse_stdout(written);
    assert.equal(writtenBody.validated, true);
    assert.match(readFileSync(writtenBody.reportPath, "utf8"), /Root cause/);
    assert.match(readFileSync(writtenBody.reportEnPath, "utf8"), /Root cause/);
    assert.equal(writtenBody.reportZhPath, null);
    assert.equal(existsSync(join(dataDir, "1", "report.zh.md")), false);
  });

  it("fails submit without exception", () => {
    const proc = run(["submit", "--dir", codeDir], { DIAGNOSE_DATA_DIR: dataDir });
    assert.equal(proc.status, 1);
    assert.match(parse_stdout(proc).error, /exception/);
  });
});

describe("resolve_repo", () => {
  it("uses existing --dir and does not clone", () => {
    const dir = mkdtempSync(join(tmpdir(), "diag-dir-"));
    const cloneDir = join(dir, "would-clone");
    const result = resolve_repo({ dir, cloneDir, cwd: dir });
    assert.equal(result.source, "dir");
    assert.equal(result.cloned, false);
    assert.equal(result.localDir, dir);
    assert.equal(existsSync(cloneDir), false);
  });

  it("treats existing local --git path as dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "diag-gitpath-"));
    const result = resolve_repo({ git: dir, cloneDir: join(dir, "repo"), cwd: dir });
    assert.equal(result.source, "dir");
    assert.equal(result.cloned, false);
  });
});

describe("report template", () => {
  const englishDoc = `# Exception diagnosis

## Executive summary
x

## Symptom and exception facts
x

## Mapped call path
x

## Root cause
x

## Trigger
x

## Contributing factors
x

## Suggested fix and verification
x

## Confidence and gaps
x
`;

  it("rejects missing headings", () => {
    const check = validate_report("# nope");
    assert.equal(check.ok, false);
    assert.ok(check.missing.some((h) => h.includes("Root cause")));
    assert.equal(check.missing.some((h) => h.includes("根因")), false);
  });

  it("accepts English headings and does not require Chinese", () => {
    const check = validate_report(englishDoc);
    assert.equal(check.ok, true);
    assert.deepEqual(check.overLimit, []);
    assert.deepEqual(check.missing, []);
  });

  it("does not reject a section over the prompt hint", () => {
    const long = "字".repeat(SECTION_CHAR_LIMIT + 1);
    const check = validate_report(englishDoc.replace("\nx\n\n## Symptom", `\n${long}\n\n## Symptom`));
    assert.equal(check.ok, true);
    assert.deepEqual(check.overLimit, []);
  });

  it("does not reject Root cause over the 300-字 prompt hint", () => {
    const tooLong = "字".repeat(SECTION_CHAR_LIMIT_STORY + 1);
    const check = validate_report(englishDoc.replace("## Root cause\nx", `## Root cause\n${tooLong}`));
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(check.overLimit, []);
  });
});
