import type { AuthProvider } from "../auth/base.ts";
import { client_from_options } from "../http_slots.ts";
import { HttpError } from "../http_util.ts";
import type { DocProvider } from "./base.ts";

export class HttpDocProvider implements DocProvider {
  client: ReturnType<typeof client_from_options>;
  constructor(options: Record<string, any> | null = null, auth: AuthProvider | null = null) {
    this.client = client_from_options(options, auth, "docs.http");
  }

  fetch(url_or_id: string): Record<string, any> {
    try {
      const result = this.client.call("docs", "fetch", {
        path_vars: { doc_id: url_or_id, id: url_or_id },
      });
      let data = result.data !== undefined ? result.data : result;
      if (!data || typeof data !== "object" || Array.isArray(data)) data = { content: String(data) };
      if (data.contentId === undefined) data.contentId = url_or_id;
      if (data.url === undefined) data.url = url_or_id;
      if (data.fetchMethod === undefined) data.fetchMethod = "http";
      if (data.fetchStatus === undefined) data.fetchStatus = "success";
      return data;
    } catch (exc: any) {
      if (exc instanceof HttpError) {
        return {
          contentId: url_or_id,
          title: url_or_id,
          url: url_or_id,
          content: "",
          fetchMethod: "http",
          fetchStatus: "failed",
          fetchError: String(exc.message),
        };
      }
      throw exc;
    }
  }
}
