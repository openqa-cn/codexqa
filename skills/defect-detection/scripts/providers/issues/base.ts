export interface IssueProvider {
  get_issue(issue_id: string): Record<string, any>;
  create_issue(payload: Record<string, any>): Record<string, any>;
}
