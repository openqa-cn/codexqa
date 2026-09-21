#!/usr/bin/env node
/** Capture README preview PNGs at a fixed 4:3 viewport in daytime theme. */

import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = dirname(new URL(import.meta.url).pathname);
const VIEW_W = 1280;
const VIEW_H = 960;
const SCALE = 2;
const PORT = 9333;

const LIGHT = `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      window.scrollTo(0,0);
    `;

const shots = [
  {
    html: "defect-report.html",
    png: "defect-report.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var rules=document.querySelectorAll('.panel');
      if(rules[0]) rules[0].style.display='none';
      window.scrollTo(0,0);
    `,
  },
  {
    html: "review-report.html",
    png: "review-report.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      document.querySelectorAll('article.finding.empty').forEach(function(el){ el.style.display='none'; });
      var first=document.querySelector('article.finding.case:not(.empty)');
      if(first) first.classList.add('open');
      document.querySelectorAll('section').forEach(function(sec){
        var h=sec.querySelector('h2');
        var t=h?h.textContent:'';
        if(t.indexOf('模型语义评审')>=0 || t.indexOf('回归必测')>=0 || t.indexOf('测试缺口')>=0){
          sec.style.display='none';
        }
      });
      document.querySelectorAll('section p.lede, section p.muted').forEach(function(p){ p.style.display='none'; });
      window.scrollTo(0,0);
    `,
  },
  {
    html: "code-wiki.html",
    png: "code-wiki.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var first=document.querySelector('.case');
      if(first) first.classList.add('open');
      window.scrollTo(0,0);
    `,
  },
  {
    html: "code-analyzer.html",
    png: "code-analyzer.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var first=document.querySelector('.case');
      if(first) first.classList.add('open');
      window.scrollTo(0,0);
    `,
  },
  {
    html: "rootcause.html",
    png: "rootcause.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var first=document.querySelector('.case');
      if(first) first.classList.add('open');
      window.scrollTo(0,0);
    `,
  },
  {
    html: "ra-register.html",
    png: "ra-register.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var first=document.querySelector('.case');
      if(first) first.classList.add('open');
      window.scrollTo(0,0);
    `,
  },
  {
    html: "testcase-report.html",
    png: "testcase-report.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var first=document.querySelector('.case[data-pri="P0"]');
      if(first) first.classList.add('open');
      window.scrollTo(0,0);
    `,
  },
  {
    html: "testdata-writeback.html",
    png: "testdata-writeback.png",
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var first=document.querySelector('.case');
      if(first) first.classList.add('open');
      window.scrollTo(0,0);
    `,
  },
  {
    html: "testcase-sample.html",
    png: "testcase-sample.png",
    prepare: LIGHT,
  },
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* chrome still booting */
    }
    await sleep(100);
  }
  throw new Error(`Chrome CDP not ready: ${url}`);
}

function cdpSession(ws) {
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      events.get(msg.method).forEach((fn) => fn(msg.params));
    }
  });
  return {
    send(method, params = {}) {
      const i = ++id;
      return new Promise((resolve, reject) => {
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    },
    on(method, fn) {
      if (!events.has(method)) events.set(method, []);
      events.get(method).push(fn);
    },
  };
}

async function capture(chromePath) {
  const userData = resolve(`/tmp/codexqa-preview-shot-${process.pid}`);
  mkdirSync(userData, { recursive: true });
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userData}`,
      "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  try {
    const version = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const cdp = cdpSession(ws);
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: false }).catch(() => {});
    for (const shot of shots) {
      const htmlPath = resolve(root, shot.html);
      const pngPath = resolve(root, shot.png);
      if (!existsSync(htmlPath)) throw new Error(`missing ${shot.html}`);
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => {
        const i = Math.floor(Math.random() * 1e9);
        return new Promise((resolve, reject) => {
          const handler = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id === i && msg.sessionId === sessionId) {
              ws.removeEventListener("message", handler);
              if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
              else resolve(msg.result);
            }
          };
          ws.addEventListener("message", handler);
          ws.send(JSON.stringify({ id: i, method, params, sessionId }));
        });
      };
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width: VIEW_W,
        height: VIEW_H,
        deviceScaleFactor: SCALE,
        mobile: false,
      });
      const loaded = new Promise((resolve) => {
        const handler = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.method === "Page.loadEventFired" && msg.sessionId === sessionId) {
            ws.removeEventListener("message", handler);
            resolve();
          }
        };
        ws.addEventListener("message", handler);
      });
      await send("Page.navigate", { url: pathToFileURL(htmlPath).href });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(400);
      if (shot.prepare) {
        await send("Runtime.evaluate", { expression: shot.prepare, returnByValue: true });
      }
      await sleep(500);
      const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      writeFileSync(pngPath, Buffer.from(data, "base64"));
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      process.stdout.write(`${shot.png}\n`);
    }
    ws.close();
  } finally {
    child.kill("SIGKILL");
    if (stderr && !stderr.includes("DevTools listening")) {
      process.stderr.write(stderr);
    }
  }
}

const executablePath = findChrome();
if (!executablePath) {
  console.error("No Chromium binary. Set PLAYWRIGHT_CHROME.");
  process.exit(1);
}

capture(executablePath).catch((err) => {
  console.error(err);
  process.exit(1);
});
