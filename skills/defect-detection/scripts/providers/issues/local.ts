import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, ok } from "../http_util.ts";
import { JsonStore } from "../json_store.ts";

/**
 * Local issues provider.
 * Seeds are read from enterprise/issues/; creates go to data_dir/issues/ so
 * shipped fixture files under enterprise/ are never mutated by mark-bug /
 * create-issue during local runs or tests.
 */
export class LocalIssueProvider {
  seedStore: JsonStore;
  runtimeStore: JsonStore;

  constructor(enterprise_dir: string, data_dir?: string) {
    this.seedStore = new JsonStore(join(enterprise_dir, "issues"));
    const runtime_root = data_dir && data_dir !== enterprise_dir
      ? join(data_dir, "issues")
      : join(enterprise_dir, "issues");
    this.runtimeStore = new JsonStore(runtime_root);
    if (!existsSync(this.runtimeStore.path("index.json"))) {
      const seed_next = this._seed_next_id();
      this.runtimeStore.write("index.json", { data: { nextId: seed_next, items: [] } });
    }
  }

  _seed_next_id(): number {
    try {
      if (existsSync(this.seedStore.path("index.json"))) {
        const index = this.seedStore.read("index.json", { default: { nextId: 1, items: [] } });
        return parseInt(String(index.nextId || 1), 10) || 1;
      }
    } catch {
      // ignore
    }
    return 1;
  }

  get_issue(issue_id: string): Record<string, any> {
    for (const store of [this.runtimeStore, this.seedStore]) {
      try {
        if (!existsSync(store.path("index.json"))) continue;
        const index = store.read("index.json", { default: { items: [] } });
        for (const item of index.items || []) {
          if (String(item.id) === String(issue_id)) return item;
        }
      } catch {
        // continue
      }
      const path = store.path(`${issue_id}.json`);
      if (existsSync(path)) return store.read(`${issue_id}.json`);
    }
    return { id: issue_id, title: "", description: "", fetchStatus: "failed" };
  }

  create_issue(payload: Record<string, any>): Record<string, any> {
    const record = this.runtimeStore.update("index.json", {
      default: { nextId: this._seed_next_id(), items: [] },
      mutate: (index: any) => {
        const seed_next = this._seed_next_id();
        let next_id = parseInt(index.nextId || 1, 10);
        if (next_id < seed_next) next_id = seed_next;
        index.nextId = next_id + 1;
        const rec: Record<string, any> = {
          id: next_id,
          title: payload.title || "",
          description: payload.description || "",
          assignee: payload.assignedTo || payload.assignee || "",
          severity: payload.severity,
          serviceKey: payload.serviceKey || "",
          planId: payload.planId,
          url: `local://issues/${next_id}`,
        };
        const offset = -new Date().getTimezoneOffset();
        const sign = offset >= 0 ? "+" : "-";
        const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
        const mm = String(Math.abs(offset) % 60).padStart(2, "0");
        rec.createdAt = `${new Date().toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
        const items = [...(index.items || [])];
        items.push(rec);
        index.items = items;
        return rec;
      },
    });
    if (!record) return fail("failed to create issue");
    return ok({
      issueId: record.id,
      defectUrl: record.url,
      assignedTo: record.assignee,
    });
  }
}
