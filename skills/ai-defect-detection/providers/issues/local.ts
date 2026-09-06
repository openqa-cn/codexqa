import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, ok } from "../http_util.ts";
import { JsonStore } from "../json_store.ts";

export class LocalIssueProvider {
  store: JsonStore;
  constructor(enterprise_dir: string) {
    this.store = new JsonStore(join(enterprise_dir, "issues"));
    if (!existsSync(this.store.path("index.json"))) {
      this.store.write("index.json", { data: { nextId: 1, items: [] } });
    }
  }

  get_issue(issue_id: string): Record<string, any> {
    const index = this.store.read("index.json", { default: { items: [] } });
    for (const item of index.items || []) {
      if (String(item.id) === String(issue_id)) return item;
    }
    const path = this.store.path(`${issue_id}.json`);
    if (existsSync(path)) return this.store.read(`${issue_id}.json`);
    return { id: issue_id, title: "", description: "", fetchStatus: "failed" };
  }

  create_issue(payload: Record<string, any>): Record<string, any> {
    const record = this.store.update("index.json", {
      default: { nextId: 1, items: [] },
      mutate: (index: any) => {
        const next_id = parseInt(index.nextId || 1, 10);
        index.nextId = next_id + 1;
        const rec = {
          id: next_id,
          title: payload.title || "",
          description: payload.description || "",
          assignee: payload.assignedTo || payload.assignee || "",
          severity: payload.severity,
          serviceKey: payload.serviceKey || "",
          planId: payload.planId,
          url: `local://issues/${next_id}`,
          createdAt: new Date().toISOString().replace(/\.\d+Z$/, "").replace("Z", ""),
        };
        // match Python timespec=seconds with timezone
        rec.createdAt = new Date().toISOString().slice(0, 19);
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
