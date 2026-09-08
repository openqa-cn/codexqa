import type { AuthProvider } from "../auth/base.ts";
import { client_from_options } from "../http_slots.ts";
import { fail, HttpError } from "../http_util.ts";
import type { IssueProvider } from "./base.ts";

export class HttpIssueProvider implements IssueProvider {
  client: ReturnType<typeof client_from_options>;
  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    this.client = client_from_options(options, auth, "issues.http");
  }

  get_issue(issue_id: string): Record<string, any> {
    try {
      const result = this.client.call("issues", "get_issue", {
        path_vars: { issue_id, id: issue_id },
      });
      const data = result.data !== undefined ? result.data : result;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (data.id === undefined) data.id = issue_id;
        if (data.fetchStatus === undefined) data.fetchStatus = "success";
        return data;
      }
      return { id: issue_id, fetchStatus: "failed" };
    } catch (e) {
      if (e instanceof HttpError) return { id: issue_id, fetchStatus: "failed" };
      throw e;
    }
  }

  create_issue(payload: Record<string, any>): Record<string, any> {
    try {
      return this.client.call("issues", "create_issue", { body: payload });
    } catch (e: any) {
      if (e instanceof HttpError) return fail(String(e.message));
      throw e;
    }
  }
}
