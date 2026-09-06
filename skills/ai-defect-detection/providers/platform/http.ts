import type { AuthProvider } from "../auth/base.ts";
import { NoneAuthProvider } from "../auth/none.ts";
import { HttpError, request_json } from "../http_util.ts";
import { BasePlatformProvider } from "./base.ts";

export class HttpPlatformProvider extends BasePlatformProvider {
  base_url: string;
  timeout: number;
  auth: AuthProvider;
  _report_base: string;

  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    super();
    options = options || {};
    this.base_url = String(options.base_url || "").replace(/\/$/, "");
    if (!this.base_url) throw new Error("platform.http requires options.base_url");
    this.timeout = parseInt(String(options.timeout || 30), 10);
    this.auth = auth || new NoneAuthProvider();
    this._report_base = String(options.report_base_url || "");
  }

  _call(method: string, path: string, params: Record<string, any> | null = null, body: any = null): Record<string, any> {
    const url = `${this.base_url}${path}`;
    try {
      const result = request_json(method, url, {
        headers: this.auth.headers(),
        params,
        body,
        timeout: this.timeout,
      });
      if (!("code" in result)) {
        return { code: 0, msg: "success", data: result.data !== undefined ? result.data : result };
      }
      return result;
    } catch (exc: any) {
      if (exc instanceof HttpError) return { _error: String(exc.message), code: -1, msg: String(exc.message) };
      throw exc;
    }
  }

  override report_url(task_id: number): string {
    if (this._report_base) {
      const sep = this._report_base.includes("?") ? "&" : "?";
      return `${this._report_base}${sep}taskId=${task_id}`;
    }
    return `${this.base_url}/ui/report?taskId=${task_id}`;
  }

  override submit_detection(request_body: Record<string, any>) { return this._call("POST", "/v1/tasks", null, request_body); }
  override get_task_status(task_id: number) { return this._call("GET", `/v1/tasks/${task_id}`); }
  override list_my_tasks(submit_user: string, limit = 20) {
    return this._call("GET", "/v1/tasks", { submitUser: submit_user, limit });
  }
  override get_pending_processes(batch_id: number) { return this._call("GET", `/v1/batches/${batch_id}/pending`); }
  override check_detection_coverage(batch_id: number) { return this._call("GET", `/v1/batches/${batch_id}/coverage`); }
  override update_process(request_body: Record<string, any>) { return this._call("POST", "/v1/processes", null, request_body); }
  override batch_dismiss_by_strategy(parent_batch_id: number, strategy_code = 8) {
    return this._call("POST", "/v1/processes/dismiss-by-strategy", null, { parentBatchId: parent_batch_id, strategyCode: strategy_code });
  }
  override batch_dismiss_by_class_names(task_id: number, class_names: string[]) {
    return this._call("POST", `/v1/tasks/${task_id}/dismiss-classes`, null, { classNames: class_names });
  }
  override check_rank_integrity(batch_id: number) { return this._call("GET", `/v1/batches/${batch_id}/rank-integrity`); }
  override finalize_rank(body: Record<string, any>) { return this._call("POST", "/v1/ranks", null, body); }
  override update_rank_content(rank_id: number, content: string) {
    return this._call("POST", `/v1/ranks/${rank_id}/content`, null, { content });
  }
  override update_detection_summary(task_id: number, summary: string) {
    return this._call("POST", `/v1/tasks/${task_id}/summary`, null, { summary });
  }
  override complete_task(task_id: number, failed = false, fail_msg: string | null = null) {
    return this._call("POST", `/v1/tasks/${task_id}/complete`, null, { failed, failMsg: fail_msg });
  }
  override skip_service_batch(parent_batch_id: number, failed = false, reason: string | null = null) {
    return this._call("POST", `/v1/batches/${parent_batch_id}/skip`, null, { failed, reason });
  }
  override force_abort_task(task_id: number, reason: string | null = null) {
    return this._call("POST", `/v1/tasks/${task_id}/abort`, null, { reason });
  }
  override retry_detection(task_id: number, submit_user: string | null = null) {
    return this._call("POST", `/v1/tasks/${task_id}/retry`, null, { submitUser: submit_user });
  }
  override get_rules(git: string | null = null, user_id: string | null = null) {
    return this._call("GET", "/v1/rules", { git, userId: user_id });
  }
  override get_report(task_id: number) { return this._call("GET", `/v1/tasks/${task_id}/report`); }
  override get_confirmed_defect_history(params: Record<string, any>) {
    return this._call("GET", "/v1/history/confirmed", params);
  }
  override get_defect_history_by_commit(params: Record<string, any>) {
    return this._call("GET", "/v1/history/by-commit", params);
  }
  override get_tag_list() { return this._call("GET", "/v1/tags"); }
  override report_progress(body: Record<string, any>) {
    return this._call("POST", `/v1/tasks/${body.taskId}/progress`, null, body);
  }
  override get_detection_flow_by_process(process_id: number) { return this._call("GET", `/v1/processes/${process_id}`); }
  override get_detection_flow_by_rank(rank_id: number) { return this._call("GET", `/v1/ranks/${rank_id}/flow`); }
  override query_detection_records(params: Record<string, any>) { return this._call("GET", "/v1/records", params); }
  override mark_bug(body: Record<string, any>) {
    return this._call("POST", `/v1/ranks/${body.rankId}/mark`, null, body);
  }
  override invalid_record(rank_id: number) { return this._call("POST", `/v1/ranks/${rank_id}/invalidate`); }
}
