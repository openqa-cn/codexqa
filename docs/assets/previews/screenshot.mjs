#!/usr/bin/env node
/** Capture README preview PNGs at a fixed 4:3 viewport in daytime theme. */

import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve, extname, join } from "node:path";
import { createServer } from "node:http";

const root = dirname(new URL(import.meta.url).pathname);
const VIEW_W = 1280;
const VIEW_H = 960;
const SCALE = 2;
const PORT = 9333;
const HTTP_PORT = 18767;

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
      document.documentElement.setAttribute('data-lang','zh');
      document.documentElement.lang='zh-CN';
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      document.querySelectorAll('[data-set-lang]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-lang')==='zh' ? 'true' : 'false');
      });
      var first=document.querySelector('#takeaways details.take');
      if(first) first.open=true;
      window.scrollTo(0,0);
    `,
    waitMs: 2500,
    waitMermaid: true,
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
  {
    html: "jev-report.html",
    png: "jev-report.png",
    fullPage: true,
    prepare: `
      document.documentElement.setAttribute('data-theme','light');
      document.documentElement.setAttribute('data-lang','zh');
      document.documentElement.lang='zh-CN';
      document.querySelectorAll('[data-en]').forEach(function(el){
        el.textContent = el.getAttribute('data-zh') || '';
      });
      document.querySelectorAll('[data-set-lang]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-lang')==='zh' ? 'true' : 'false');
      });
      document.querySelectorAll('[data-set-theme]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme')==='light' ? 'true' : 'false');
      });
      var caseEl=document.querySelector('details.case');
      if(caseEl) caseEl.open=true;
      window.scrollTo(0,0);
    `,
  },
];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  const caches = [
    resolve(homedir(), ".cache/ms-playwright"),
    resolve(homedir(), "Library/Caches/ms-playwright"),
  ];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    for (const dir of readdirSync(cache).sort().reverse()) {
      if (!dir.startsWith("chromium")) continue;
      for (const name of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      ]) {
        const candidate = resolve(cache, dir, name);
        if (existsSync(candidate)) return candidate;
      }
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

function startStaticServer(dir, port) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
  };
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || "/").split("?")[0].replace(/^\//, ""));
    const file = join(dir, name);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function capture(chromePath) {
  const userData = resolve(`/tmp/codexqa-preview-shot-${process.pid}`);
  mkdirSync(userData, { recursive: true });
  const httpd = await startStaticServer(root, HTTP_PORT);
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
    for (const shot of selected) {
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
      await send("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/${shot.html}` });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(shot.waitMs || 400);
      if (shot.prepare) {
        await send("Runtime.evaluate", { expression: shot.prepare, returnByValue: true });
      }
      if (shot.waitMermaid) {
        await send("Runtime.evaluate", {
          expression: `(async()=>{for(let i=0;i<40;i++){if(document.querySelector('.mermaid svg'))return true;await new Promise(r=>setTimeout(r,250));}return false;})()`,
          awaitPromise: true,
          returnByValue: true,
        });
      }
      await sleep(shot.waitMs ? 800 : 500);
      let clip = { x: 0, y: 0, width: VIEW_W, height: VIEW_H, scale: 1 };
      if (shot.fullPage) {
        const metrics = await send("Page.getLayoutMetrics");
        const height = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize.height);
        clip = { x: 0, y: 0, width: VIEW_W, height, scale: 1 };
      }
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: Boolean(shot.fullPage),
        clip,
      });
      writeFileSync(pngPath, Buffer.from(data, "base64"));
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      process.stdout.write(`${shot.png}\n`);
    }
    ws.close();
  } finally {
    httpd.close();
    child.kill("SIGKILL");
    if (stderr && !stderr.includes("DevTools listening")) {
      process.stderr.write(stderr);
    }
  }
}

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : "";
const selected = only ? shots.filter((s) => s.html === only || s.png === only) : shots;
if (only && !selected.length) {
  console.error(`No shot matching --only ${only}`);
  process.exit(1);
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
