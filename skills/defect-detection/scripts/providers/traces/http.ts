import type { AuthProvider } from "../auth/base.ts";
import { client_from_options } from "../http_slots.ts";
import { fail, HttpError } from "../http_util.ts";
import type { TraceProvider } from "./base.ts";

export class HttpTraceProvider implements TraceProvider {
  client: ReturnType<typeof client_from_options>;
  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    this.client = client_from_options(options, auth, "traces.http");
  }

  list_traces(plan_id: number, plan_type = 2, service_key: string | null = null): Record<string, any> {
    try {
      return this.client.call("traces", "list_traces", {
        path_vars: { plan_id, id: plan_id },
        params: { planType: plan_type, serviceKey: service_key },
      });
    } catch (e: any) {
      if (e instanceof HttpError) return fail(String(e.message));
      throw e;
    }
  }
}
