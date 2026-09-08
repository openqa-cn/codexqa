#!/usr/bin/env node
/** Capture README preview PNGs. Needs a Chromium binary (Playwright cache or PLAYWRIGHT_CHROME). */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = dirname(new URL(import.meta.url).pathname);
const shots = [
  ["defect-report.html", "defect-report.png", 1280, 900],
  ["testcase-sample.html", "testcase-sample.png", 1100, 980],
  ["cr-findings.html", "cr-findings.png", 1100, 640],
  ["ra-register.html", "ra-register.png", 1100, 620],
  ["testdata-writeback.html", "testdata-writeback.png", 1100, 720],
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
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
for (const [html, png, w, h] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(resolve(root, html)).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(root, png), fullPage: false });
  await page.close();
  process.stdout.write(`${png}\n`);
}
await browser.close();
