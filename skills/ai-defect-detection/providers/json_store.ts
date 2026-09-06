import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function with_file_lock<T>(lock_path: string, fn: () => T): T {
  const lockDir = `${lock_path}.d`;
  mkdirSync(dirname(lock_path), { recursive: true });
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      if (Date.now() - start > 30_000) throw new Error(`lock timeout: ${lock_path}`);
      sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export class JsonStore {
  root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(this.root, { recursive: true });
  }

  path(...parts: string[]): string {
    const target = join(this.root, ...parts);
    mkdirSync(dirname(target), { recursive: true });
    return target;
  }

  read(...args: any[]): any {
    const defaultValue = typeof args[args.length - 1] === "object" && !Array.isArray(args[args.length - 1]) && args[args.length - 1] && ("default" in args[args.length - 1])
      ? args.pop().default
      : undefined;
    // support read(*parts, { default })
    let parts: string[] = args;
    let fallback: any = defaultValue;
    if (args.length && typeof args[args.length - 1] === "object" && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1]) && "default" in args[args.length - 1]) {
      fallback = args[args.length - 1].default;
      parts = args.slice(0, -1);
    }
    const path = this.path(...parts);
    if (!existsSync(path)) return fallback !== undefined ? fallback : {};
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return fallback !== undefined ? fallback : {};
    }
  }

  write(...args: any[]): void {
    let data: any = undefined;
    let parts: string[] = args;
    if (args.length && typeof args[args.length - 1] === "object" && args[args.length - 1] !== null && "data" in args[args.length - 1] && Object.keys(args[args.length - 1]).every((k) => k === "data")) {
      data = args[args.length - 1].data;
      parts = args.slice(0, -1);
    } else if (args.length >= 2 && typeof args[args.length - 2] !== "string") {
      // not used
    }
    // Python: write(*parts, data=...)
    if (args.length && typeof args[args.length - 1] === "object" && args[args.length - 1] !== null && Object.prototype.hasOwnProperty.call(args[args.length - 1], "data") && (args.length === 1 || typeof args[0] === "string")) {
      const last = args[args.length - 1];
      if (last && typeof last === "object" && "data" in last && Object.keys(last).length === 1) {
        data = last.data;
        parts = args.slice(0, -1);
      }
    }
    const path = this.path(...(parts as string[]));
    const tmp = join(dirname(path), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    renameSync(tmp, path);
  }

  update(...args: any[]): any {
    // update(*parts, { mutate, default })
    const opts = args[args.length - 1] as { mutate: (cur: any) => any; default?: any };
    const parts = args.slice(0, -1) as string[];
    const path = this.path(...parts);
    const lock_path = path + ".lock";
    return with_file_lock(lock_path, () => {
      const current = this.read(...parts, { default: opts.default !== undefined ? opts.default : {} });
      const result = opts.mutate(current);
      this.write(...parts, { data: current });
      return result !== undefined && result !== null ? result : current;
    });
  }

  list_json(...parts: string[]): Record<string, any>[] {
    const folder = this.path(...parts);
    if (!existsSync(folder)) return [];
    const items: Record<string, any>[] = [];
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(".json")) continue;
      try {
        const payload = JSON.parse(readFileSync(join(folder, name), "utf8"));
        if (payload && typeof payload === "object" && !Array.isArray(payload)) items.push(payload);
      } catch {
        continue;
      }
    }
    return items;
  }
}

void tmpdir;
