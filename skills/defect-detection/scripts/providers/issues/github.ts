import type { AuthProvider } from "../auth/base.ts";
import { NoneAuthProvider } from "../auth/none.ts";
import { fail, HttpError, ok, request_json } from "../http_util.ts";

export class GitHubIssueProvider {
  repo: string;
  base_url: string;
  timeout: number;
  auth: AuthProvider;
  _extra_headers: Record<string, string>;

  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    options = options || {};
    this.repo = options.repo || process.env.DETECTION_GITHUB_REPO || "";
    this.base_url = (options.base_url || "https://api.github.com").replace(/\/$/, "");
    this.timeout = parseInt(String(options.timeout || 30), 10);
    this.auth = auth || new NoneAuthProvider();
    const token = options.token || process.env.GITHUB_TOKEN || "";
    this._extra_headers = { Accept: "application/vnd.github+json" };
    if (token) this._extra_headers.Authorization = `Bearer ${token}`;
  }

  _headers(): Record<string, string> {
    const headers = { ...this._extra_headers };
    try {
      Object.assign(headers, this.auth.headers());
    } catch {
      /* ignore */
    }
    return headers;
  }

  get_issue(issue_id: string): Record<string, any> {
    if (!this.repo) return { id: issue_id, fetchStatus: "failed", title: "" };
    try {
      const result = request_json("GET", `${this.base_url}/repos/${this.repo}/issues/${issue_id}`, {
        headers: this._headers(),
        timeout: this.timeout,
      });
      return {
        id: result.number || issue_id,
        title: result.title || "",
        description: result.body || "",
        url: result.html_url || "",
        fetchStatus: "success",
      };
    } catch (e) {
      if (e instanceof HttpError) return { id: issue_id, fetchStatus: "failed", title: "" };
      throw e;
    }
  }

  create_issue(payload: Record<string, any>): Record<string, any> {
    if (!this.repo) return fail("DETECTION_GITHUB_REPO or providers.issues.options.repo is required");
    const body: Record<string, any> = {
      title: payload.title || "Untitled defect",
      body: payload.description || "",
    };
    if (payload.assignedTo) body.assignees = [payload.assignedTo];
    try {
      const result = request_json("POST", `${this.base_url}/repos/${this.repo}/issues`, {
        headers: this._headers(),
        body,
        timeout: this.timeout,
      });
      return ok({
        issueId: result.number,
        defectUrl: result.html_url,
        assignedTo: result.assignee && typeof result.assignee === "object" ? result.assignee.login : "",
      });
    } catch (e: any) {
      if (e instanceof HttpError) return fail(String(e.message));
      throw e;
    }
  }
}
