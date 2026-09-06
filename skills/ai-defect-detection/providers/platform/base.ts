export interface PlatformProvider {
  submit_detection(request_body: Record<string, any>): Record<string, any>;
  get_task_status(task_id: number): Record<string, any>;
  list_my_tasks(submit_user: string, limit?: number): Record<string, any>;
  get_pending_processes(batch_id: number): Record<string, any>;
  check_detection_coverage(batch_id: number): Record<string, any>;
  update_process(request_body: Record<string, any>): Record<string, any>;
  batch_dismiss_by_strategy(parent_batch_id: number, strategy_code?: number): Record<string, any>;
  batch_dismiss_by_class_names(task_id: number, class_names: string[]): Record<string, any>;
  check_rank_integrity(batch_id: number): Record<string, any>;
  finalize_rank(body: Record<string, any>): Record<string, any>;
  update_rank_content(rank_id: number, content: string): Record<string, any>;
  update_detection_summary(task_id: number, summary: string): Record<string, any>;
  complete_task(task_id: number, failed?: boolean, fail_msg?: string | null): Record<string, any>;
  skip_service_batch(parent_batch_id: number, failed?: boolean, reason?: string | null): Record<string, any>;
  force_abort_task(task_id: number, reason?: string | null): Record<string, any>;
  retry_detection(task_id: number, submit_user?: string | null): Record<string, any>;
  get_rules(git?: string | null, user_id?: string | null): Record<string, any>;
  get_report(task_id: number): Record<string, any>;
  get_confirmed_defect_history(params: Record<string, any>): Record<string, any>;
  get_defect_history_by_commit(params: Record<string, any>): Record<string, any>;
  get_tag_list(): Record<string, any>;
  report_progress(body: Record<string, any>): Record<string, any>;
  get_detection_flow_by_process(process_id: number): Record<string, any>;
  get_detection_flow_by_rank(rank_id: number): Record<string, any>;
  query_detection_records(params: Record<string, any>): Record<string, any>;
  mark_bug(body: Record<string, any>): Record<string, any>;
  invalid_record(rank_id: number): Record<string, any>;
  report_url(task_id: number): string;
}

export class BasePlatformProvider implements PlatformProvider {
  submit_detection(_b: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  get_task_status(_t: number): Record<string, any> { throw new Error("not implemented"); }
  list_my_tasks(_u: string, _l = 20): Record<string, any> { throw new Error("not implemented"); }
  get_pending_processes(_b: number): Record<string, any> { throw new Error("not implemented"); }
  check_detection_coverage(_b: number): Record<string, any> { throw new Error("not implemented"); }
  update_process(_b: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  batch_dismiss_by_strategy(_p: number, _s = 8): Record<string, any> { throw new Error("not implemented"); }
  batch_dismiss_by_class_names(_t: number, _c: string[]): Record<string, any> { throw new Error("not implemented"); }
  check_rank_integrity(_b: number): Record<string, any> { throw new Error("not implemented"); }
  finalize_rank(_b: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  update_rank_content(_r: number, _c: string): Record<string, any> { throw new Error("not implemented"); }
  update_detection_summary(_t: number, _s: string): Record<string, any> { throw new Error("not implemented"); }
  complete_task(_t: number, _f = false, _m: string | null = null): Record<string, any> { throw new Error("not implemented"); }
  skip_service_batch(_p: number, _f = false, _r: string | null = null): Record<string, any> { throw new Error("not implemented"); }
  force_abort_task(_t: number, _r: string | null = null): Record<string, any> { throw new Error("not implemented"); }
  retry_detection(_t: number, _u: string | null = null): Record<string, any> { throw new Error("not implemented"); }
  get_rules(_g: string | null = null, _u: string | null = null): Record<string, any> { throw new Error("not implemented"); }
  get_report(_t: number): Record<string, any> { throw new Error("not implemented"); }
  get_confirmed_defect_history(_p: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  get_defect_history_by_commit(_p: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  get_tag_list(): Record<string, any> { throw new Error("not implemented"); }
  report_progress(_b: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  get_detection_flow_by_process(_p: number): Record<string, any> { throw new Error("not implemented"); }
  get_detection_flow_by_rank(_r: number): Record<string, any> { throw new Error("not implemented"); }
  query_detection_records(_p: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  mark_bug(_b: Record<string, any>): Record<string, any> { throw new Error("not implemented"); }
  invalid_record(_r: number): Record<string, any> { throw new Error("not implemented"); }
  report_url(task_id: number): string {
    return `file://local-report?taskId=${task_id}`;
  }
}
