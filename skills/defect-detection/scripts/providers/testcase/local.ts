import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TestCaseProvider } from "./base.ts";

export class LocalTestCaseProvider implements TestCaseProvider {
  root: string;
  constructor(enterprise_dir: string) {
    this.root = join(enterprise_dir, "test-cases");
  }

  _catalog(): Record<string, any> {
    const index = join(this.root, "index.json");
    if (existsSync(index)) return JSON.parse(readFileSync(index, "utf8"));
    const cases: any[] = [];
    if (!existsSync(this.root)) return { groups: [], cases };
    for (const name of readdirSync(this.root).sort()) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      const payload = JSON.parse(readFileSync(join(this.root, name), "utf8"));
      if (Array.isArray(payload)) cases.push(...payload);
      else if (payload && typeof payload === "object") cases.push(payload);
    }
    return { groups: [], cases };
  }

  list_groups(issue_id: string | null = null, plan_id: number | null = null): Record<string, any>[] {
    let groups = [...(this._catalog().groups || [])];
    if (issue_id) groups = groups.filter((g) => String(g.issueId) === String(issue_id));
    if (plan_id) {
      groups = groups.filter((g) => g.planId === plan_id || g.planId === null || g.planId === undefined || !g.planId);
    }
    return groups;
  }

  list_case_ids(group_id: string | null = null, plan_id: number | null = null, issue_id: string | null = null): string[] {
    const catalog = this._catalog();
    let cases = [...(catalog.cases || [])];
    if (group_id) {
      const group = (catalog.groups || []).find((g: any) => String(g.id) === String(group_id));
      if (group && group.caseIds) return group.caseIds.map((x: any) => String(x));
      cases = cases.filter((c) => String(c.groupId) === String(group_id));
    }
    if (plan_id) cases = cases.filter((c) => c.planId === plan_id || c.planId === null || c.planId === undefined);
    if (issue_id) cases = cases.filter((c) => String(c.issueId) === String(issue_id));
    return cases.filter((c) => c.id !== undefined && c.id !== null).map((c) => String(c.id));
  }

  get_case(case_id: string): Record<string, any> {
    const direct = join(this.root, `${case_id}.json`);
    if (existsSync(direct)) {
      const data = JSON.parse(readFileSync(direct, "utf8"));
      if (data.id === undefined) data.id = case_id;
      if (data.fetchStatus === undefined) data.fetchStatus = "success";
      return data;
    }
    for (const c of this._catalog().cases || []) {
      if (String(c.id) === String(case_id)) {
        const result = { ...c };
        if (result.fetchStatus === undefined) result.fetchStatus = "success";
        return result;
      }
    }
    return { id: case_id, title: "", preCondition: "", steps: "", expectedResult: "", fetchStatus: "failed" };
  }
}
