import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { request_json } from "../http_util.ts";

function glob_hits(root: string, pattern: string): string[] {
  if (!existsSync(root)) return [];
  const hits: string[] = [];
  const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : null;
  for (const name of readdirSync(root)) {
    if (prefix !== null) {
      if (name.startsWith(prefix) || name === prefix) hits.push(join(root, name));
    } else if (name === pattern) {
      hits.push(join(root, name));
    }
  }
  return hits;
}

export class LocalDocProvider {
  root: string;
  constructor(enterprise_dir: string) {
    this.root = join(enterprise_dir, "docs");
  }

  fetch(url_or_id: string): Record<string, any> {
    const local_hits: string[] = [];
    if (existsSync(url_or_id) && statSync(url_or_id).isFile()) local_hits.push(url_or_id);
    else {
      const stem = url_or_id.replace(/\/$/, "").split("/").pop() || url_or_id;
      for (const pattern of [`${url_or_id}*`, `${stem}*`, `${stem}.md`, `${stem}.txt`]) {
        local_hits.push(...glob_hits(this.root, pattern));
      }
      const direct = join(this.root, url_or_id);
      if (existsSync(direct)) local_hits.push(direct);
    }
    if (local_hits.length) {
      const path = local_hits[0];
      const stem = basename(path).replace(/\.[^.]+$/, "");
      return {
        contentId: stem,
        title: stem,
        url: path,
        content: readFileSync(path, "utf8"),
        fetchMethod: "local",
        fetchStatus: "success",
      };
    }
    if (/^https?:\/\//i.test(url_or_id)) {
      try {
        const result = request_json("GET", url_or_id, { timeout: 20 });
        const raw = typeof result === "string" ? result : JSON.stringify(result);
        const leaf = url_or_id.replace(/\/$/, "").split("/").pop() || url_or_id;
        return {
          contentId: leaf,
          title: leaf,
          url: url_or_id,
          content: raw,
          fetchMethod: "http",
          fetchStatus: "success",
        };
      } catch (exc: any) {
        return {
          contentId: url_or_id,
          title: url_or_id,
          url: url_or_id,
          content: "",
          fetchMethod: "http",
          fetchStatus: "failed",
          fetchError: String(exc.message || exc),
        };
      }
    }
    return {
      contentId: url_or_id,
      title: url_or_id,
      url: url_or_id,
      content: "",
      fetchMethod: "local",
      fetchStatus: "failed",
      fetchError: "document not found",
    };
  }
}
