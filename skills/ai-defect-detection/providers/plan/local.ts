import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, ok } from "../http_util.ts";
import type { PlanProvider } from "./base.ts";

export class LocalPlanProvider implements PlanProvider {
  root: string;
  constructor(enterprise_dir: string) {
    this.root = join(enterprise_dir, "plans");
  }

  get_plan(plan_id: number, plan_type = 2): Record<string, any> {
    const path = join(this.root, `${plan_id}.json`);
    if (!existsSync(path)) {
      return fail(
        `plan ${plan_id} not found under ${this.root}. Add a JSON file or switch providers.plan.kind to http.`,
      );
    }
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data.planId === undefined) data.planId = plan_id;
    if (data.planType === undefined) data.planType = plan_type;
    if (data.services === undefined) data.services = [];
    if (data.testCaseIds === undefined) data.testCaseIds = data.testCaseIds || [];
    if (data.issueList === undefined) data.issueList = [];
    if (data.requirementDocs === undefined) data.requirementDocs = [];
    if (data.technicalDocs === undefined) data.technicalDocs = [];
    return ok(data);
  }

  list_submitted_defects(plan_id: number, _plan_type = 2, page_no = 1, page_size = 100): Record<string, any> {
    const path = join(this.root, `${plan_id}.defects.json`);
    let items: any[] = [];
    if (existsSync(path)) {
      const payload = JSON.parse(readFileSync(path, "utf8"));
      items = Array.isArray(payload) ? payload : payload.list || [];
    }
    const start = Math.max(page_no - 1, 0) * page_size;
    const page = items.slice(start, start + page_size);
    return ok({ list: page, total: items.length, pageNo: page_no, pageSize: page_size });
  }
}
