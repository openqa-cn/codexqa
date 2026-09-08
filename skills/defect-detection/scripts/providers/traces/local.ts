import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ok } from "../http_util.ts";

export class LocalTraceProvider {
  root: string;
  constructor(enterprise_dir: string) {
    this.root = join(enterprise_dir, "traces");
  }

  list_traces(plan_id: number, _plan_type = 2, service_key: string | null = null): Record<string, any> {
    const path = join(this.root, `${plan_id}.json`);
    let items: any[] = [];
    if (existsSync(path)) {
      const payload = JSON.parse(readFileSync(path, "utf8"));
      items = Array.isArray(payload) ? payload : payload.traces || [];
    }
    if (service_key) items = items.filter((t) => t.serviceKey === service_key);
    return ok(items);
  }
}
