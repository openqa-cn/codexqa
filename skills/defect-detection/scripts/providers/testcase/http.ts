import type { AuthProvider } from "../auth/base.ts";
import { client_from_options } from "../http_slots.ts";
import { HttpError } from "../http_util.ts";
import type { TestCaseProvider } from "./base.ts";

export class HttpTestCaseProvider implements TestCaseProvider {
  client: ReturnType<typeof client_from_options>;
  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    this.client = client_from_options(options, auth, "testcase.http");
  }

  _data(result: Record<string, any>): any {
    return result.data !== undefined ? result.data : result;
  }

  list_groups(issue_id: string | null = null, plan_id: number | null = null): Record<string, any>[] {
    try {
      const result = this.client.call("testcase", "list_groups", {
        params: { issueId: issue_id, planId: plan_id },
      });
      const data = this._data(result);
      return Array.isArray(data) ? data : data.groups || [];
    } catch (e) {
      if (e instanceof HttpError) return [];
      throw e;
    }
  }

  list_case_ids(group_id: string | null = null, plan_id: number | null = null, issue_id: string | null = null): string[] {
    try {
      const result = this.client.call("testcase", "list_cases", {
        params: { groupId: group_id, planId: plan_id, issueId: issue_id },
      });
      const data = this._data(result);
      const items = Array.isArray(data) ? data : data.caseIds || data.cases || [];
      const ids: string[] = [];
      for (const item of items) {
        if (item && typeof item === "object") {
          if (item.id !== undefined && item.id !== null) ids.push(String(item.id));
        } else ids.push(String(item));
      }
      return ids;
    } catch (e) {
      if (e instanceof HttpError) return [];
      throw e;
    }
  }

  get_case(case_id: string): Record<string, any> {
    try {
      const result = this.client.call("testcase", "get_case", {
        path_vars: { case_id, id: case_id },
      });
      const data = this._data(result);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (data.id === undefined) data.id = case_id;
        if (data.fetchStatus === undefined) data.fetchStatus = "success";
        return data;
      }
      return { id: case_id, fetchStatus: "failed" };
    } catch (e) {
      if (e instanceof HttpError) return { id: case_id, fetchStatus: "failed" };
      throw e;
    }
  }
}
