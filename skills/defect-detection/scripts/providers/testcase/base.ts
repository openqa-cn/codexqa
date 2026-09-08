export interface TestCaseProvider {
  list_groups(issue_id?: string | null, plan_id?: number | null): Record<string, any>[];
  list_case_ids(group_id?: string | null, plan_id?: number | null, issue_id?: string | null): string[];
  get_case(case_id: string): Record<string, any>;
}
