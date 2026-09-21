#!/usr/bin/env node
/** Capture README preview PNGs. Uses Playwright Chromium cache or PLAYWRIGHT_CHROME. */

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = dirname(new URL(import.meta.url).pathname);
const shots = [
  ["defect-report.html", "defect-report.png", 1280, 1600],
  ["review-report.html", "review-report.png", 1280, 900],
  ["code-wiki.html", "code-wiki.png", 1280, 900],
  ["code-analyzer.html", "code-analyzer.png", 1480, 900],
  ["rootcause.html", "rootcause.png", 1100, 900],
  ["ra-register.html", "ra-register.png", 1100, 620],
  ["testcase-report.html", "testcase-report.png", 1280, 900],
  ["testdata-writeback.html", "testdata-writeback.png", 1100, 720],
  ["testcase-sample.html", "testcase-sample.png", 1100, 980],
];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  const cache = resolve(homedir(), ".cache/ms-playwright");
  if (!existsSync(cache)) return undefined;
  for (const dir of readdirSync(cache).sort().reverse()) {
    if (!dir.startsWith("chromium")) continue;
    for (const name of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = resolve(cache, dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const executablePath = findChrome();
if (!executablePath) {
  console.error("No Chromium binary. Set PLAYWRIGHT_CHROME.");
  process.exit(1);
}

for (const [html, png, w, h] of shots) {
  const htmlPath = resolve(root, html);
  const pngPath = resolve(root, png);
  if (!existsSync(htmlPath)) {
    console.error(`missing ${html}`);
    process.exit(1);
  }
  const r = spawnSync(
    executablePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=${w},${h}`,
      `--screenshot=${pngPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || `chrome exit ${r.status}\n`);
    process.exit(r.status || 1);
  }
  process.stdout.write(`${png}\n`);
}
