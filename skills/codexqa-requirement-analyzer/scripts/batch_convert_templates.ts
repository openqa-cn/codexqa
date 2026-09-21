import { mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { convertFile } from "./convert_formats.ts";
import { hasFlag, isDirectRun, takeFlag } from "./office_io.ts";

function detectFrom(filePath: string): string {
  if (filePath.endsWith(".word.md")) return "markdown";
  return (
    {
      ".md": "markdown",
      ".markdown": "markdown",
      ".json": "json",
      ".csv": "csv",
      ".tsv": "excel",
      ".docx": "word",
      ".xlsx": "excel",
      ".xmind": "xmind",
    }[extname(filePath).toLowerCase()] ?? "markdown"
  );
}

export function runBatch(argvIn: string[]): void {
  const argv = [...argvIn];
  const templatesDir = resolve(takeFlag(argv, "--templates-dir") ?? "output-templates");
  const artifactsDir = resolve(takeFlag(argv, "--artifacts-dir") ?? "artifacts");
  const targetsRaw = takeFlag(argv, "--targets") ?? "word,excel,xmind,json,csv,markdown";
  const skipSame = hasFlag(argv, "--skip-same");
  const targets = targetsRaw.split(",").map((item) => item.trim()).filter(Boolean);

  mkdirSync(artifactsDir, { recursive: true });
  let files: string[];
  try {
    files = readdirSync(templatesDir)
      .map((name) => join(templatesDir, name))
      .filter((filePath) => statSync(filePath).isFile())
      .sort();
  } catch {
    throw new Error(`templates directory not found: ${templatesDir}`);
  }

  const outExt: Record<string, string> = {
    json: ".json",
    csv: ".csv",
    excel: ".tsv",
    markdown: ".md",
    word: ".word.md",
    xmind: ".xmind.md",
  };

  let total = 0;
  let failed = 0;
  for (const src of files) {
    const srcFmt = detectFrom(src);
    const name = src.split(/[/\\]/).pop() ?? src;
    const stem = name.replace(/\.[^.]+$/, "");
    for (const toFmt of targets) {
      if (skipSame && srcFmt === toFmt) continue;
      const out = join(artifactsDir, `${stem}.to-${toFmt}${outExt[toFmt]}`);
      total += 1;
      try {
        convertFile(src, srcFmt, toFmt, out);
        console.log(`[OK] ${name} -> ${out.split(/[/\\]/).pop()}`);
      } catch {
        failed += 1;
        console.log(`[FAILED] ${name} -> ${toFmt}`);
      }
    }
  }
  console.log(`\nDone. total=${total}, failed=${failed}, artifacts=${artifactsDir}`);
  if (failed) process.exit(1);
}

if (isDirectRun(import.meta.url)) {
  try {
    runBatch(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
