#!/usr/bin/env node
/** Local mock HTTP API for catalog and distribution slots (stdlib only). */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const STORE_PATH = resolve(fileURLToPath(import.meta.url), "../../testdata/mock-store.json");

type JsonObject = { [key: string]: unknown };
type Store = JsonObject;

const emptyStore = (): Store => ({
  products: {},
  orders: {},
  credits: {},
  distributors: {},
  bindings: {},
  seq: 0,
});

function load(): Store {
  if (!existsSync(STORE_PATH)) return emptyStore();
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Store) : {};
  } catch {
    return emptyStore();
  }
}

function save(data: Store): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function nextId(data: Store, prefix: string): string {
  data.seq = Math.trunc(Number(data.seq || 0)) + 1;
  return `${prefix}_${data.seq}`;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function hasKey(map: JsonObject, key: unknown): boolean {
  if (key === undefined || key === null) return false;
  return Object.prototype.hasOwnProperty.call(map, String(key));
}

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolveBody, reject) => {
    const length = Number(req.headers["content-length"] || 0);
    if (length <= 0) {
      resolveBody({});
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      chunks.push(chunk);
      if (received >= length) {
        req.pause();
        finish(Buffer.concat(chunks).subarray(0, length).toString("utf8"));
      }
    });
    req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);

    function finish(raw: string): void {
      const text = raw || "{}";
      try {
        const data = JSON.parse(text);
        resolveBody(data && typeof data === "object" && !Array.isArray(data) ? data : {});
      } catch {
        resolveBody({});
      }
    }
  });
}

function send(res: ServerResponse, req: IncomingMessage, code: number, payload: JsonObject): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  });
  res.end(body);
  const remote = req.socket.remoteAddress || "";
  process.stderr.write(`${remote} - "${req.method} ${req.url}" ${code} ${body.length}\n`);
}

function dispatch(path: string, body: JsonObject, store: Store): [JsonObject, number] {
  if (path === "/v1/products") {
    const productId = nextId(store, "p");
    const record = {
      productId,
      name: (body.name as string) || "untitled",
      city: (body.city as string) || "demo-city",
      kind: (body.kind as string) || "standard",
      validHours: body.validHours ?? null,
    };
    const products = asRecord(store.products);
    products[productId] = record;
    store.products = products;
    return [record, 200];
  }

  if (path === "/v1/orders") {
    const productId = body.productId;
    if (!hasKey(asRecord(store.products), productId)) {
      return [{ ok: false, error: `unknown productId: ${productId}` }, 404];
    }
    const orderId = nextId(store, "o");
    const record = {
      orderId,
      productId,
      userId: body.userId ?? null,
      fulfillOn: body.fulfillOn ?? null,
      quantity: body.quantity || 1,
      status: "created",
    };
    const orders = asRecord(store.orders);
    orders[orderId] = record;
    store.orders = orders;
    return [record, 200];
  }

  if (path === "/v1/credits/enroll") {
    const productId = body.productId;
    if (!hasKey(asRecord(store.products), productId)) {
      return [{ ok: false, error: `unknown productId: ${productId}` }, 404];
    }
    const record = {
      productId,
      userId: body.userId ?? null,
      enrolled: true,
      creditBalance: Math.trunc(Number(body.credits || 1000)),
    };
    const key = `${productId}:${body.userId}`;
    const credits = asRecord(store.credits);
    credits[key] = record;
    store.credits = credits;
    return [record, 200];
  }

  if (path === "/v1/distributors") {
    const distId = nextId(store, "d");
    const record = {
      distributorId: distId,
      name: (body.name as string) || "untitled",
      region: (body.region as string) || "domestic",
    };
    const distributors = asRecord(store.distributors);
    distributors[distId] = record;
    store.distributors = distributors;
    return [record, 200];
  }

  const parts = path.split("/");
  if (parts.length === 5 && parts[1] === "v1" && parts[2] === "distributors") {
    const distId = parts[3];
    const action = parts[4];
    const distributors = asRecord(store.distributors);
    if (!hasKey(distributors, distId)) {
      return [{ ok: false, error: `unknown distributorId: ${distId}` }, 404];
    }
    if (action === "inventory") {
      const productId = body.productId;
      if (!hasKey(asRecord(store.products), productId)) {
        return [{ ok: false, error: `unknown productId: ${productId}` }, 404];
      }
      const bindId = nextId(store, "b");
      const record = { bindingId: bindId, distributorId: distId, productId };
      const bindings = asRecord(store.bindings);
      bindings[bindId] = record;
      store.bindings = bindings;
      return [record, 200];
    }
    if (action === "commission") {
      const rate = Number(body.rate !== null && body.rate !== undefined ? body.rate : 0.1);
      const row = asRecord(distributors[distId]);
      row.commissionRate = rate;
      distributors[distId] = row;
      store.distributors = distributors;
      return [{ distributorId: distId, rate }, 200];
    }
    if (action === "quote") {
      const productId = body.productId;
      const bound = Object.values(asRecord(store.bindings)).some((raw) => {
        const b = asRecord(raw);
        return b.distributorId === distId && b.productId === productId;
      });
      return [
        {
          distributorId: distId,
          productId,
          available: bound,
          price: bound ? 199 : null,
        },
        200,
      ];
    }
  }
  return [{ ok: false, error: `not found: ${path}` }, 404];
}

let lock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "8765" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node mock_server.ts [--host <host>] [--port <port>]

Local HTTP mock for the catalog / distribution slot executors.

Options:
  --host <host>   Bind address (default: 127.0.0.1)
  --port <port>   Listen port (default: 8765)
  -h, --help      Show this help and exit

Examples:
  node mock_server.ts --port 8765
  node mock_server.ts --host 127.0.0.1 --port 8765
`);
    return 0;
  }
  const host = values.host || "127.0.0.1";
  const port = Number(values.port || 8765);
  mkdirSync(dirname(STORE_PATH), { recursive: true });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const method = req.method || "GET";

    if (method === "GET") {
      if (url.pathname === "/health") {
        send(res, req, 200, { ok: true });
        return;
      }
      send(res, req, 404, { ok: false, error: "not found" });
      return;
    }

    if (method === "POST") {
      const path = url.pathname.replace(/\/+$/, "");
      const body = await readJson(req);
      try {
        const out = await withLock(async () => {
          const store = load();
          const dispatched = dispatch(path, body, store);
          save(store);
          return dispatched;
        });
        send(res, req, out[1], out[0]);
      } catch (exc) {
        send(res, req, 500, { ok: false, error: exc instanceof Error ? exc.message : String(exc) });
      }
      return;
    }

    res.writeHead(501, { "Content-Type": "text/plain" });
    res.end("Unsupported method");
  });

  server.listen(port, host, () => {
    process.stdout.write(`mock server http://${host}:${port}  store=${STORE_PATH}\n`);
  });

  process.on("SIGINT", () => {
    process.stdout.write("\nstopped\n");
    server.close(() => process.exit(0));
  });
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("mock_server.ts")) {
  main();
}
