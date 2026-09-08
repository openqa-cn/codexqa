import type { AuthProvider } from "../auth/base.ts";
import { client_from_options } from "../http_slots.ts";
import { HttpError } from "../http_util.ts";
import type { PlanProvider } from "./base.ts";

export class HttpPlanProvider implements PlanProvider {
  client: ReturnType<typeof client_from_options>;
  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    this.client = client_from_options(options, auth, "plan.http");
  }

  get_plan(plan_id: number, plan_type = 2): Record<string, any> {
    try {
      return this.client.call("plan", "get_plan", {
        path_vars: { plan_id, id: plan_id },
        params: { planType: plan_type },
      });
    } catch (exc: any) {
      if (exc instanceof HttpError) return { code: -1, msg: String(exc.message), data: null };
      throw exc;
    }
  }

  list_submitted_defects(plan_id: number, plan_type = 2, page_no = 1, page_size = 100): Record<string, any> {
    try {
      return this.client.call("plan", "list_submitted_defects", {
        path_vars: { plan_id, id: plan_id },
        params: { planType: plan_type, pageNo: page_no, pageSize: page_size },
      });
    } catch (exc: any) {
      if (exc instanceof HttpError) return { code: -1, msg: String(exc.message), data: null };
      throw exc;
    }
  }
}
