export interface TraceProvider {
  list_traces(plan_id: number, plan_type?: number, service_key?: string | null): Record<string, any>;
}
