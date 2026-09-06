export interface PlanProvider {
  get_plan(plan_id: number, plan_type?: number): Record<string, any>;
  list_submitted_defects(
    plan_id: number,
    plan_type?: number,
    page_no?: number,
    page_size?: number,
  ): Record<string, any>;
}
