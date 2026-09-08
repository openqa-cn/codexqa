#!/usr/bin/env node
/** Case-materials dashboard HTTP + SSE server. */

import { createReadStream, existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    dir: { type: "string" },
    manifest: { type: "string" },
    port: { type: "string", default: "6848" },
  },
});

if (values.help) {
  process.stdout.write(`Usage: node server.ts --dir <case-materials-dir> [--port <port>]
       node server.ts --manifest <path> [--port <port>]  (legacy)

Case-materials dashboard HTTP + SSE server.

Options:
  --dir <dir>         Directory that contains per-case folders (required unless --manifest)
  --manifest <path>   Legacy single-manifest path (implies its parent dir)
  --port <port>       Listen port (default: 6848)
  -h, --help          Show this help and exit

Examples:
  node server.ts --dir ./testdata/case-materials --port 6848
  node server.ts --manifest ./testdata/case-materials/case-1/manifest.json
`);
  process.exit(0);
}

let manifestPath = values.manifest || null;
let dirPath = values.dir || null;
const port = Number.parseInt(values.port || "6848", 10);

if (!manifestPath && !dirPath) {
  process.stderr.write("Usage: node server.ts --dir <case-materials-dir> [--port <port>]\n");
  process.stderr.write("       node server.ts --manifest <path> [--port <port>]  (legacy)\n");
  process.exit(1);
}

if (manifestPath) {
  manifestPath = resolve(manifestPath);
  if (!existsSync(manifestPath)) {
    process.stderr.write(`Manifest not found: ${manifestPath}\n`);
    process.exit(1);
  }
  dirPath = dirname(manifestPath);
} else {
  dirPath = resolve(dirPath as string);
  if (!existsSync(dirPath)) {
    process.stderr.write(`Directory not found: ${dirPath}\n`);
    process.exit(1);
  }
}

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "index.html");
const watchedDir = dirPath;

function scanManifests(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  try {
    const entries = readdirSync(watchedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const mp = join(watchedDir, entry.name, "manifest.json");
      if (existsSync(mp)) {
        try {
          result[entry.name] = JSON.parse(readFileSync(mp, "utf8"));
        } catch {
          result[entry.name] = null;
        }
      }
    }
  } catch {
    /* ignore unreadable watch dir */
  }
  return result;
}

function readAllData(): Record<string, unknown> {
  const dispatcherPath = join(watchedDir, "dispatcher-state.json");
  let dispatcherState: unknown = null;
  if (existsSync(dispatcherPath)) {
    try {
      dispatcherState = JSON.parse(readFileSync(dispatcherPath, "utf8"));
    } catch {
      dispatcherState = null;
    }
  }
  return {
    cases: scanManifests(),
    dispatcherState,
    watchedDir,
    ts: Date.now(),
  };
}

const sseClients = new Set<ServerResponse>();

function pushAll(): void {
  const payload = `data: ${JSON.stringify(readAllData())}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePush(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(pushAll, 200);
}

watch(watchedDir, { recursive: true }, (_evt, filename) => {
  if (
    filename &&
    (String(filename).endsWith("manifest.json") || String(filename).endsWith("dispatcher-state.json"))
  ) {
    schedulePush();
  }
});

const server = createServer((req, res) => {
  const url = (req.url || "").split("?")[0];

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(htmlPath).pipe(res);
    return;
  }

  if (url === "/api/all") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(readAllData()));
    return;
  }

  if (url === "/api/manifest") {
    const cases = scanManifests();
    const first = Object.values(cases)[0] || null;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(first));
    return;
  }

  if (url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(readAllData())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(port, () => {
  process.stdout.write(`Dashboard: http://localhost:${port}\n`);
  process.stdout.write(`Watching:  ${watchedDir}\n`);
});
