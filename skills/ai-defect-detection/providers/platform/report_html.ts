/** Render a standalone HTML detection report that browsers can open. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const _HEADING = /(📋\[[^\]]+\]|🔍\[[^\]]+\]|⚠\ufe0f?\[[^\]]+\]|📌\[[^\]]+\]|✅\[[^\]]+\]|🔔\[[^\]]+\])/;
const _KIND_LABELS: Record<number, string> = {
  6: "Suspected defect",
  7: "Improvement",
  3: "Confirmed, needs fix",
  4: "Marked invalid",
  5: "Later",
  8: "Duplicate",
};
const _KIND_FILTER: Record<number, string> = {
  6: "bug",
  7: "opt",
  3: "bug",
  4: "other",
  5: "opt",
  8: "other",
};
const _SECTION_META: Record<string, [string, string]> = {
  "Requirement changes": ["change", "clipboard"],
  "Analysis scope": ["scope", "scope"],
  Risks: ["risks", "alert"],
  "Pending confirmation": ["confirm", "help"],
  Notes: ["notes", "pin"],
  Conclusion: ["verdict", "check"],
};
const _FINDING_LABELS = [
  "Problem description",
  "Lines",
  "Test case ID",
  "Problem tags",
  "Impact scope",
  "Affected business",
  "Call chain",
  "Reproduction path",
  "Trigger conditions",
  "Expected vs actual",
  "Fix suggestion",
  "Improvement plan",
  "Current impact",
  "Rationale",
];
const _NOTE_KEYS = ["Test", "Release", "Compatibility", "Monitoring", "Prerequisite limit"];
const _SEV_LABEL: Record<string, string> = { "❗": "High", "⚡": "Med", "💡": "Low" };
const _SEV_KEY: Record<string, string> = { "❗": "high", "⚡": "med", "💡": "low" };

function html_escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function _strip_chars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start += 1;
  while (end > start && chars.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

export function write_report_html(path: string, task: Record<string, any>, defects: Record<string, any>[]): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, render_report_html(task, defects), "utf8");
  return path;
}

export function render_report_html(task: Record<string, any>, defects: Record<string, any>[]): string {
  const task_id = task.taskId || "";
  const title = html_escape(String(task.planName || "Defect detection report"));
  const status = html_escape(_status_label(task.status));
  const status_key = html_escape(String(task.status || "unknown"));
  const git = String(task.git || "Not set");
  const branch = html_escape(String(task.developBranch || "Not set"));
  const contrast = html_escape(String(task.contrastBranch || "Not set"));
  const submitter = html_escape(String(task.submitUser || "Not set"));
  const created = html_escape(_short_time(task.createdAt));
  const updated = html_escape(_short_time(task.updatedAt));
  const parsed_sections = _parse_summary_sections(String(task.summary || ""));
  const confirm_hints = _confirm_hints(parsed_sections);
  const nav = _nav_html(parsed_sections, Boolean(defects.length));
  const sections = _render_summary_sections(parsed_sections);
  let findings = _findings_table_html(defects, confirm_hints);
  if (!findings) {
    findings = '<p class="empty">No defects or improvements to list separately.</p>';
  }
  const counts = _count_defects(defects, confirm_hints);
  const kpi = _kpi_html(counts, parsed_sections);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Task ${html_escape(String(task_id))}</title>
  <style>${_REPORT_CSS}</style>
</head>
<body>
  <a class="skip-link" href="#findings">Skip to findings</a>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">${_icon("shield")}</span>
        <div>
          <p class="eyebrow">Defect detection report - Task ${html_escape(String(task_id))}</p>
          <h1>${title}</h1>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="badge status-${status_key}">${status}</span>
        <button type="button" class="icon-btn" id="theme-toggle" aria-label="Toggle dark mode">${_icon("moon")}</button>
      </div>
    </div>
    ${nav}
  </header>
  <main id="main">
    <section class="meta-grid" aria-label="Task info">
      <div class="meta-item"><span>Repo</span><code title="${html_escape(git)}">${html_escape(_short_git(git))}</code></div>
      <div class="meta-item"><span>Detection branch</span><code>${branch}</code></div>
      <div class="meta-item"><span>Baseline branch</span><code>${contrast}</code></div>
      <div class="meta-item"><span>Submitter</span><strong>${submitter}</strong></div>
      <div class="meta-item"><span>Created</span>${created}</div>
      <div class="meta-item"><span>Updated</span>${updated}</div>
    </section>
    ${kpi}
    ${sections}
    <section class="panel" id="findings">
      <div class="panel-head">
        <h2>Findings<span class="count">${defects.length}</span></h2>
        <div class="toolbar">
          <label class="search">
            <span class="sr-only">Search findings</span>
            ${_icon("search")}
            <input id="finding-search" type="search" placeholder="Search class, method, or summary" autocomplete="off">
          </label>
          <div class="chip-list" role="group" aria-label="Filter by type">
            <button type="button" class="chip is-on" data-filter="all">All ${defects.length}</button>
            <button type="button" class="chip" data-filter="bug">Suspected defect ${counts.bug}</button>
            <button type="button" class="chip" data-filter="opt">Improvement ${counts.opt}</button>
            <button type="button" class="chip" data-filter="confirm">Please confirm ${counts.confirm}</button>
          </div>
        </div>
      </div>
      <div id="finding-list">${findings}</div>
      <p class="empty hidden" id="finding-empty">No matching findings.</p>
    </section>
  </main>
  <script>${_REPORT_JS}</script>
</body>
</html>
`;
}

export function _status_label(status: any): string {
  const mapping: Record<string, string> = {
    completed: "Completed",
    in_progress: "In progress",
    failed: "Failed",
    aborted: "Aborted",
  };
  return mapping[String(status || "")] ?? String(status || "Unknown");
}

export function _short_time(value: any): string {
  const text = String(value || "").trim();
  if (text.includes("T")) {
    return text.replace("T", " ").split("+")[0].slice(0, 19);
  }
  return text || "—";
}

export function _short_git(git: string): string {
  if (git.includes("/") && git.length > 56) {
    return "…/" + git.split("/").pop();
  }
  return git;
}

export function _count_defects(
  defects: Record<string, any>[],
  confirm_hints: Set<string> | null = null,
): Record<string, number> {
  const bug = defects.filter((item) => item.bugStatus === 3 || item.bugStatus === 6).length;
  const opt = defects.filter((item) => item.bugStatus === 5 || item.bugStatus === 7).length;
  const confirm = defects.filter((item) => _finding_needs_confirm(item, confirm_hints)).length;
  return { bug, opt, confirm, total: defects.length };
}

export function _needs_confirm(text: string): boolean {
  return text.includes("needs confirmation") || text.includes("[Needs confirmation]") || text.includes("[Confidence:MED]") || text.includes("[Confidence:LOW]");
}

export function _confirm_hints(sections: Array<[string, string]>): Set<string> {
  const hints = new Set<string>();
  for (const [heading, body] of sections) {
    const title = _section_title(heading);
    if (title === "Risks") {
      for (const item of _parse_risk_items(body)) {
        if (item.confirm) hints.add(item.where || "");
      }
    }
    if (title === "Pending confirmation") {
      for (const item of _parse_confirm_items(body)) {
        hints.add(item.title || "");
      }
    }
  }
  return new Set([...hints].filter((hint) => hint));
}

export function _finding_needs_confirm(item: Record<string, any>, confirm_hints: Set<string> | null = null): boolean {
  const content = String(item.content || "");
  if (_needs_confirm(content)) return true;
  const location = _finding_location(item);
  const method = String(item.methodName || "");
  for (const hint of confirm_hints || []) {
    if (location && hint.includes(location)) return true;
    if (method && hint.includes(method)) return true;
  }
  return false;
}

export function _parse_summary_sections(summary: string): Array<[string, string]> {
  if (!summary.trim()) return [];
  const parts = summary.split(_HEADING);
  const blocks: Array<[string, string]> = [];
  let index = 1;
  while (index < parts.length) {
    const heading = parts[index].trim();
    const body = index + 1 < parts.length ? parts[index + 1].trim() : "";
    blocks.push([heading, body]);
    index += 2;
  }
  if (blocks.length) return blocks;
  return [["Detection summary", summary.trim()]];
}

export function _section_title(heading: string): string {
  const match = heading.match(/\[([^\]]+)\]/);
  return match ? match[1] : heading;
}

export function _section_meta(heading: string): [string, string] {
  const title = _section_title(heading);
  return _SECTION_META[title] || ["other", "doc"];
}

export function _nav_html(sections: Array<[string, string]>, has_findings: boolean): string {
  const items: string[] = [];
  for (const [heading] of sections) {
    const [key] = _section_meta(heading);
    items.push(`<a href="#sec-${key}">${html_escape(_section_title(heading))}</a>`);
  }
  if (has_findings) {
    items.push('<a href="#findings">Findings</a>');
  }
  if (!items.length) return "";
  return `<nav class="toc" aria-label="Report outline">${items.join("")}</nav>`;
}

export function _kpi_html(counts: Record<string, number>, sections: Array<[string, string]>): string {
  let risk_n = 0;
  let confirm_n = 0;
  for (const [heading, body] of sections) {
    const title = _section_title(heading);
    if (title === "Risks") risk_n = _parse_risk_items(body).length;
    if (title === "Pending confirmation") confirm_n = _parse_confirm_items(body).length;
  }
  const cells: Array<[string, string, string]> = [
    ["Total findings", String(counts.total), "kpi-total"],
    ["Suspected defect", String(counts.bug), "kpi-bug"],
    ["Improvement", String(counts.opt), "kpi-opt"],
    ["Summary risks", String(risk_n || counts.total), "kpi-risk"],
    ["Pending confirmation", String(confirm_n || counts.confirm), "kpi-confirm"],
  ];
  const inner = cells.map(([label, value, cls]) =>
    `<div class="kpi ${cls}"><strong>${value}</strong><span>${html_escape(label)}</span></div>`,
  ).join("");
  return `<section class="kpi-row" aria-label="Results overview">${inner}</section>`;
}

export function _render_summary_sections(sections: Array<[string, string]>): string {
  if (!sections.length) {
    return '<section class="panel"><h2>Detection summary</h2><p class="empty">No summary yet.</p></section>';
  }
  const blocks: string[] = [];
  for (const [heading, body] of sections) {
    const [key, icon_name] = _section_meta(heading);
    const title = _section_title(heading);
    blocks.push(
      `<section class="panel" id="sec-${key}">`
      + `<h2 data-marker="${html_escape(heading)}">`
      + `<span class="sec-icon" aria-hidden="true">${_icon(icon_name)}</span>`
      + `${html_escape(title)}`
      + `<span class="sr-only">${html_escape(heading)}</span></h2>`
      + `${_render_section_body(title, body)}</section>`,
    );
  }
  return blocks.join("");
}

export function _render_section_body(title: string, body: string): string {
  const text = (body || "").trim();
  if (!text) return '<p class="empty">None</p>';
  if (title === "Risks") return _render_risks(text);
  if (title === "Pending confirmation") return _render_confirms(text);
  if (title === "Notes") return _render_notes(text);
  return `<p class="prose">${html_escape(text)}</p>`;
}

export function _parse_risk_items(body: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  let era = "This change";
  const chunks = body.split(/(▎This change|▎Pre-existing|▸\()/);
  let buf = "";
  for (const chunk of chunks) {
    if (chunk === "▎This change" || chunk === "▎Pre-existing") {
      era = chunk.includes("This change") ? "This change" : "Pre-existing";
      continue;
    }
    if (chunk === "▸(") {
      if (buf.trim()) {
        const parsed = _split_risk_item(buf, era);
        if (parsed) items.push(parsed);
      }
      buf = "";
      continue;
    }
    buf += chunk;
  }
  if (buf.trim()) {
    const parsed = _split_risk_item(buf, era);
    if (parsed) items.push(parsed);
  }
  return items;
}

export function _split_risk_item(raw: string, era: string): Record<string, string> | null {
  let text = raw.trim();
  if (!text || text.startsWith("The above")) return null;
  text = text.replace(/^\d+\)\s*/, "");
  let sev = "⚡";
  const confirm = text.includes("needs confirmation");
  for (const mark of ["❗", "⚡", "💡"]) {
    if (text.startsWith(mark)) {
      sev = mark;
      text = text.slice(mark.length).trim();
      break;
    }
  }
  text = text.replace(/^\(needs confirmation\)\s*/, "");
  const parts = text.split("｜").map((part) => _strip_chars(part, " .")).filter((part) => part);
  let where = parts.length ? parts[0] : text;
  let trigger = "";
  let impact = "";
  for (const part of parts.slice(1)) {
    if (part.startsWith("Trigger conditions")) {
      trigger = _split_once_last(_split_once_last(part, "："), ":").trim();
    } else if (part.startsWith("Impact")) {
      impact = _split_once_last(part, "：");
      impact = _split_once_last(impact, ":").trim();
    } else if (!trigger) {
      trigger = part;
    } else {
      impact = part;
    }
  }
  if (!where) return null;
  return {
    era,
    sev,
    confirm: confirm ? "1" : "",
    where,
    trigger,
    impact,
  };
}

function _split_once_last(text: string, sep: string): string {
  const idx = text.indexOf(sep);
  return idx === -1 ? text : text.slice(idx + sep.length);
}

export function _render_risks(body: string): string {
  const items = _parse_risk_items(body);
  if (!items.length) return `<p class="prose">${html_escape(body)}</p>`;
  const rows: string[] = [];
  items.forEach((item, i) => {
    const index = i + 1;
    const sev = item.sev;
    const badge = `<span class="sev sev-${_SEV_KEY[sev] || "med"}">${_SEV_LABEL[sev] || "Med"}</span>`;
    const extra = item.confirm ? ' <span class="tag-confirm">Please confirm</span>' : "";
    rows.push(
      `<tr><td>${index}</td><td>${badge}${extra}</td>`
      + `<td>${html_escape(item.era)}</td>`
      + `<td><code>${html_escape(item.where)}</code></td>`
      + `<td>${html_escape(item.trigger || "—")}</td>`
      + `<td>${html_escape(item.impact || "—")}</td></tr>`,
    );
  });
  return (
    '<div class="table-wrap"><table class="data">'
    + "<thead><tr><th>#</th><th>Severity</th><th>Introduced</th><th>Location</th><th>Trigger conditions</th><th>Impact</th></tr></thead>"
    + `<tbody>${rows.join("")}</tbody></table></div>`
  );
}

const _CONFIRM_FIELD_DEFS: Array<{ key: string; aliases: string[] }> = [
  { key: "Open question", aliases: ["Open question", "开放问题", "待确认问题", "存疑点", "存疑项"] },
  { key: "Current assumption", aliases: ["Current assumption", "当前假设"] },
  { key: "Please confirm", aliases: ["Please confirm", "Needs user confirmation", "Needs confirmation", "Need confirmation", "请确认"] },
];

function _escape_re(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _extract_confirm_fields(text: string): { prefix: string; fields: Record<string, string> } {
  const alias_to_key = new Map<string, string>();
  const aliases: string[] = [];
  for (const def of _CONFIRM_FIELD_DEFS) {
    for (const alias of def.aliases) {
      alias_to_key.set(alias, def.key);
      aliases.push(alias);
    }
  }
  aliases.sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?:^|[|｜▸\\s]+)(${aliases.map(_escape_re).join("|")})[：:]\\s*`, "g");
  const hits: Array<{ key: string; start: number; valueStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = alias_to_key.get(match[1]);
    if (!key) continue;
    hits.push({ key, start: match.index, valueStart: match.index + match[0].length });
  }
  const fields: Record<string, string> = {};
  if (!hits.length) return { prefix: text, fields };
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const value = _strip_chars(text.slice(hits[i].valueStart, end), " |｜▸\t\n");
    if (value && !fields[hits[i].key]) fields[hits[i].key] = value;
  }
  return { prefix: text.slice(0, hits[0].start), fields };
}

function _split_confirm_title(prefix: string): { title: string; question: string } {
  const cleaned = _strip_chars(prefix, " |｜▸\t\n");
  const match = cleaned.match(/^([^|｜：:]{1,40})[：:]\s*(\S[\s\S]*)$/);
  if (match) return { title: match[1].trim(), question: match[2].trim() };
  return { title: cleaned, question: "" };
}

export function _parse_confirm_items(body: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  for (const chunk of body.split(/▸\(\d+\)\s*/)) {
    let text = chunk.trim();
    if (!text || text.startsWith("The above") || text.startsWith("No open questions")) continue;
    let title = "";
    const title_m = text.match(/^\[([^\]]+)\]\s*([\s\S]*)/);
    if (title_m) {
      title = title_m[1].trim();
      text = title_m[2].trim();
    }
    const extracted = _extract_confirm_fields(text);
    const fields = extracted.fields;
    const leftover = _strip_chars(extracted.prefix, " |｜▸\t\n");
    if (!fields["Open question"] && leftover) {
      const split = _split_confirm_title(leftover);
      if (!title) title = split.title;
      fields["Open question"] = split.question || leftover;
    } else if (!title) {
      title = leftover ? _split_confirm_title(leftover).title : (fields["Open question"] || "Pending confirmation").slice(0, 80);
    }
    items.push({ title: title || "Pending confirmation", ...fields });
  }
  return items;
}

export function _render_confirms(body: string): string {
  const items = _parse_confirm_items(body);
  if (!items.length) return `<p class="prose">${html_escape(body)}</p>`;
  const cards: string[] = [];
  items.forEach((item, i) => {
    const index = i + 1;
    const rows = ["Open question", "Current assumption", "Please confirm"].map((key) =>
      `<div><dt>${html_escape(key)}</dt><dd>${html_escape(item[key] || "—")}</dd></div>`,
    ).join("");
    cards.push(
      `<article class="confirm-card"><h3>#${index} ${html_escape(item.title)}</h3>`
      + `<dl>${rows}</dl></article>`,
    );
  });
  return `<div class="confirm-list">${cards.join("")}</div>`;
}

export function _render_notes(body: string): string {
  const found: Array<[string, string]> = [];
  for (const key of _NOTE_KEYS) {
    const match = body.match(new RegExp(`►${key}[：:]\\s*([\\s\\S]+?)(?=►|$)`));
    if (match) {
      found.push([key, _strip_chars(match[1], " .")]);
    }
  }
  if (!found.length) return `<p class="prose">${html_escape(body)}</p>`;
  const items = found.map(([key, value]) =>
    `<div><h3>${html_escape(key)}</h3><p>${html_escape(value)}</p></div>`,
  ).join("");
  return `<div class="note-grid">${items}</div>`;
}

export function _findings_table_html(
  defects: Record<string, any>[],
  confirm_hints: Set<string> | null = null,
): string {
  if (!defects.length) return "";
  const rows: string[] = [];
  defects.forEach((item, i) => {
    const index = i + 1;
    const kind = _KIND_LABELS[item.bugStatus] || "Findings";
    const kind_class = _KIND_FILTER[item.bugStatus] || "other";
    const location = _finding_location(item);
    const title = _finding_title(String(item.content || ""));
    const confirm = _finding_needs_confirm(item, confirm_hints) ? "1" : "";
    const line = _finding_line_label(String(item.content || ""));
    const extra = confirm === "1" ? ' <span class="tag-confirm">Please confirm</span>' : "";
    const line_html = line ? `<span class="muted">${html_escape(line)}</span>` : "";
    rows.push(
      `<tr class="finding-row" id="finding-${index}-row" data-finding="${index}" `
      + `data-kind="${kind_class}" data-confirm="${confirm}" `
      + `data-text="${html_escape((location + " " + title).toLowerCase())}" `
      + `role="button" tabindex="0" aria-expanded="false" aria-controls="finding-${index}">`
      + `<td><a class="finding-jump" href="#finding-${index}">${index}</a></td>`
      + `<td><span class="badge kind-${kind_class}">${html_escape(kind)}</span>${extra}</td>`
      + `<td><code>${html_escape(location || "—")}</code> ${line_html}</td>`
      + `<td>${html_escape(title)}</td></tr>`
      + `<tr class="finding-detail hidden" id="finding-${index}" data-kind="${kind_class}" `
      + `data-confirm="${confirm}" data-text="${html_escape((location + " " + title).toLowerCase())}">`
      + `<td colspan="4">${_finding_detail_html(item)}</td></tr>`,
    );
  });
  return (
    '<div class="table-wrap index-table"><table class="data findings-table">'
    + "<thead><tr><th>#</th><th>Type</th><th>Location</th><th>Summary</th></tr></thead>"
    + `<tbody>${rows.join("")}</tbody></table></div>`
  );
}

export function _finding_line_label(content: string): string {
  const [, fields] = _parse_finding_fields(content);
  const line = (fields["Lines"] || "").trim();
  return line ? `Lines ${line}` : "";
}

export function _finding_location(item: Record<string, any>): string {
  const class_name = String(item.className || "").replace(/\//g, ".");
  const simple = class_name ? class_name.split(".").pop() || "" : "";
  const method = String(item.methodName || "");
  if (simple && method) return `${simple}#${method}`;
  return [simple || class_name, method].filter((part) => part).join(" / ");
}

export function _finding_title(content: string): string {
  const first = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line) || "No details";
  return first.replace(/^(Defect|Improvement)[：:]\s*/, "").slice(0, 80);
}

export function _parse_finding_fields(content: string): [string, Record<string, string>, string] {
  let code = "";
  let working = content;
  const fence = working.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (fence && fence.index !== undefined) {
    code = fence[1].trim();
    working = working.slice(0, fence.index) + working.slice(fence.index + fence[0].length);
  }
  const lines = working.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const fields: Record<string, string> = {};
  let current = "";
  let buf: string[] = [];

  function flush(): void {
    if (current) fields[current] = buf.join("\n").trim();
  }

  for (const line of lines) {
    const stripped = line.trim();
    if (!title && stripped) {
      title = stripped.replace(/^(Defect|Improvement)[：:]\s*/, "");
      continue;
    }
    const label = _FINDING_LABELS.find((name) => stripped.startsWith(name + "：") || stripped.startsWith(name + ":")) || "";
    if (label) {
      flush();
      current = label;
      buf = [_split_once_last(_split_once_last(stripped, "："), ":").trim()];
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return [title, fields, code];
}

export function _finding_detail_html(item: Record<string, any>): string {
  const content = String(item.content || "").trim() || "No details";
  const [, fields, code] = _parse_finding_fields(content);
  const tags = _render_tags(fields["Problem tags"] || "");
  const detail_rows: string[] = [];
  const order = [
    "Problem description", "Affected business", "Trigger conditions", "Reproduction path", "Call chain",
    "Expected vs actual", "Current impact", "Rationale", "Fix suggestion", "Improvement plan",
    "Impact scope", "Test case ID",
  ];
  for (const key of order) {
    const value = fields[key];
    if (value) {
      detail_rows.push(`<div><dt>${html_escape(key)}</dt><dd>${html_escape(value)}</dd></div>`);
    }
  }
  const code_html = code ? `<pre class='code'><code>${html_escape(code)}</code></pre>` : "";
  return `${tags}<dl class='finding-dl'>${detail_rows.join("")}</dl>${code_html}`;
}

export function _render_tags(raw: string): string {
  const names = [...raw.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  if (!names.length) return "";
  const chips = names.map((name) => `<span class="tag">${html_escape(name)}</span>`).join("");
  return `<div class="chip-list tags">${chips}</div>`;
}

export function _icon(name: string): string {
  const paths: Record<string, string> = {
    shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    scope: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/>',
    alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.8.3-1.2.8-1.2 1.6V14"/><path d="M12 17h.01"/>',
    pin: '<path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.8 2.8L16 9.5"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.2-3.2"/>',
    moon: '<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/>',
  };
  return (
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" `
    + `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" `
    + `stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`
  );
}

const _REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #F8FAFC;
  --card: #FFFFFF;
  --ink: #0F172A;
  --heading: #1E3A8A;
  --muted: #475569;
  --line: #DBEAFE;
  --primary: #1E40AF;
  --accent: #D97706;
  --danger: #DC2626;
  --ok: #047857;
  --chip: #E9EEF6;
  --shadow: 0 1px 2px rgb(15 23 42 / 6%);
  --topbar: 108px;
  --sans: ui-sans-serif, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0B1220;
  --card: #111827;
  --ink: #E2E8F0;
  --heading: #BFDBFE;
  --muted: #94A3B8;
  --line: #1E3A8A;
  --chip: #1E293B;
  --shadow: 0 1px 2px rgb(0 0 0 / 40%);
}
* { box-sizing: border-box; }
html { scroll-padding-top: calc(var(--topbar) + 12px); }
body {
  margin: 0;
  font-family: var(--sans);
  background: var(--bg);
  color: var(--ink);
  line-height: 1.55;
  font-size: 14px;
}
.skip-link {
  position: absolute; left: 12px; top: -40px; z-index: 20;
  background: var(--primary); color: #fff; padding: 8px 12px; border-radius: 8px;
}
.skip-link:focus { top: 12px; }
.topbar {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.topbar-inner, .toc, main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
.topbar-inner {
  display: flex; justify-content: space-between; align-items: center;
  gap: 16px; padding: 12px 0 8px;
}
.brand { display: flex; gap: 12px; align-items: center; min-width: 0; }
.brand-mark {
  display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto;
  border-radius: 10px; background: var(--primary); color: #fff;
}
.eyebrow { margin: 0; color: var(--muted); font-size: 12px; }
h1 {
  margin: 0; font-size: 20px; color: var(--heading); font-weight: 650;
  text-wrap: balance;
}
.topbar-actions { display: flex; align-items: center; gap: 8px; }
.toc {
  display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 0 0 10px;
}
.toc a {
  color: var(--muted); text-decoration: none; font-size: 13px; font-weight: 600;
}
.toc a:hover, .toc a:focus-visible { color: var(--primary); }
main { padding: 20px 0 72px; }
.meta-grid, .kpi-row, .note-grid, .confirm-list {
  display: grid; gap: 10px; margin: 0 0 16px;
}
.meta-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.kpi-row { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
.meta-item, .kpi, .panel, .confirm-card, .finding {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: var(--shadow);
}
.meta-item { padding: 10px 12px; min-width: 0; }
.meta-item span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 2px; }
.meta-item code, .finding summary code, td code {
  font-family: var(--mono); font-size: 12px; word-break: break-all;
}
.kpi { padding: 12px 14px; }
.kpi strong { display: block; font-size: 28px; line-height: 1.1; color: var(--heading); }
.kpi-bug strong { color: var(--danger); }
.kpi-opt strong { color: var(--accent); }
.kpi-confirm strong { color: var(--primary); }
.kpi span { color: var(--muted); font-size: 12px; }
.panel { padding: 16px 18px; margin: 0 0 14px; }
.panel-head {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin: 0 0 12px;
}
.panel-head h2 { margin: 0; }
.toolbar {
  margin-left: auto; display: flex; flex-direction: column; align-items: flex-end;
  gap: 8px; max-width: 100%;
}
h2 {
  display: flex; align-items: center; gap: 8px; margin: 0 0 12px;
  font-size: 16px; color: var(--heading);
}
.sec-icon { display: grid; place-items: center; color: var(--primary); }
.count {
  margin-left: 8px; background: var(--chip); color: var(--muted);
  border-radius: 999px; padding: 1px 8px; font-size: 12px;
}
.prose { margin: 0; }
.table-wrap { overflow-x: auto; }
table.data { width: 100%; border-collapse: collapse; font-size: 13px; }
table.data th, table.data td {
  text-align: left; vertical-align: top; padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}
table.data th { color: var(--muted); font-weight: 650; font-size: 12px; }
.index-table { margin: 0; }
.findings-table .finding-row { cursor: pointer; }
.findings-table .finding-row:hover, .findings-table .finding-row.is-open { background: var(--chip); }
.findings-table .finding-row.is-open td { border-bottom-color: transparent; }
.finding-jump { color: inherit; text-decoration: none; font-weight: 650; }
.finding-detail td {
  padding: 4px 10px 16px; background: color-mix(in srgb, var(--chip) 45%, var(--card));
}
.finding-detail .finding-dl, .finding-detail .tags { margin: 8px 0 0; }
.finding-detail pre.code { margin: 12px 0 0; }
.muted { color: var(--muted); font-size: 12px; }
.badge, .tag, .tag-confirm, .sev, .chip {
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 650;
  white-space: nowrap;
}
.badge { background: #DBEAFE; color: var(--primary); }
.status-completed { background: #D1FAE5; color: var(--ok); }
.status-failed, .status-aborted { background: #FEE2E2; color: var(--danger); }
.kind-bug { background: #FEE2E2; color: var(--danger); }
.kind-opt { background: #FEF3C7; color: #92400E; }
.kind-other { background: var(--chip); color: var(--muted); }
.sev-high { background: #FEE2E2; color: var(--danger); }
.sev-med { background: #FEF3C7; color: #92400E; }
.sev-low { background: #DBEAFE; color: var(--primary); }
.tag, .tag-confirm { background: var(--chip); color: var(--muted); }
.tag-confirm { background: #FEF3C7; color: #92400E; }
.chip-list { display: flex; flex-wrap: wrap; gap: 8px; }
.toolbar .chip-list { justify-content: flex-end; }
.chip {
  border: 1px solid var(--line); background: var(--card); color: var(--muted); cursor: pointer;
}
.chip.is-on { background: var(--primary); color: #fff; border-color: var(--primary); }
.search {
  display: flex; align-items: center; gap: 8px; width: min(320px, 100%);
  border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; background: var(--card);
}
.search input {
  border: 0; outline: none; width: 100%; background: transparent; color: var(--ink); font: inherit;
}
.icon-btn {
  border: 1px solid var(--line); background: var(--card); color: var(--heading);
  width: 36px; height: 36px; border-radius: 10px; cursor: pointer; display: grid; place-items: center;
}
.confirm-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.confirm-card, .note-grid > div { padding: 12px 14px; }
.confirm-card h3, .note-grid h3 { margin: 0 0 8px; font-size: 14px; color: var(--heading); }
.note-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 0; }
.note-grid > div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
.note-grid p, .confirm-card dd, .finding-dl dd { margin: 0; color: var(--ink); }
dl { margin: 0; display: grid; gap: 8px; }
dt { color: var(--muted); font-size: 12px; font-weight: 650; }
.finding { padding: 0; margin: 0 0 10px; }
.finding summary {
  list-style: none; cursor: pointer; display: flex; flex-wrap: wrap; gap: 8px 12px;
  align-items: center; padding: 12px 14px;
}
.finding summary::-webkit-details-marker { display: none; }
.finding summary strong { color: var(--heading); }
.finding details[open] summary { border-bottom: 1px solid var(--line); }
.finding-dl, .tags, .finding .code { margin: 12px 14px; }
.finding .code, pre.code {
  white-space: pre-wrap; word-break: break-word; background: #0F172A; color: #E2E8F0;
  border-radius: 8px; padding: 12px; overflow-x: auto; font-family: var(--mono); font-size: 12px;
}
.empty { color: var(--muted); }
.hidden { display: none !important; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); border: 0;
}
a, button, input, summary { outline: none; }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 35%, transparent);
}
@media (max-width: 720px) {
  h1 { font-size: 18px; }
  .kpi strong { font-size: 22px; }
  table.data th:nth-child(n+5), table.data td:nth-child(n+5) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; scroll-behavior: auto !important; }
}
@media print {
  .topbar { position: static; }
  .toolbar, .skip-link, .icon-btn { display: none !important; }
  .finding-detail, .finding-detail.hidden { display: table-row !important; }
  .finding-row, .finding-detail { break-inside: avoid; }
}
`;

const _REPORT_JS = `
(function () {
  var root = document.documentElement;
  var pref = localStorage.getItem("dd-theme");
  if (pref) root.setAttribute("data-theme", pref);
  else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
    root.setAttribute("data-theme", "dark");
  var toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("dd-theme", next);
  });
  var filter = "all";
  var search = document.getElementById("finding-search");
  var chips = document.querySelectorAll(".chip[data-filter]");
  function detailFor(row) {
    return document.getElementById("finding-" + row.getAttribute("data-finding"));
  }
  function isOpen(row) {
    return row.getAttribute("aria-expanded") === "true";
  }
  function setOpen(row, open, scroll) {
    var detail = detailFor(row);
    row.setAttribute("aria-expanded", open ? "true" : "false");
    row.classList.toggle("is-open", open);
    if (detail) {
      var visible = open && !row.classList.contains("hidden");
      detail.classList.toggle("hidden", !visible);
      if (visible && scroll) detail.scrollIntoView({ block: "nearest" });
    }
    if (open) {
      try { history.replaceState(null, "", "#finding-" + row.getAttribute("data-finding")); }
      catch (err) { location.hash = "finding-" + row.getAttribute("data-finding"); }
    }
  }
  function toggleRow(row, scroll) {
    setOpen(row, !isOpen(row), scroll);
  }
  function apply() {
    var q = (search && search.value || "").trim().toLowerCase();
    var shown = 0;
    document.querySelectorAll(".finding-row").forEach(function (row) {
      var kind = row.getAttribute("data-kind") || "";
      var confirm = row.getAttribute("data-confirm") === "1";
      var text = row.getAttribute("data-text") || row.textContent.toLowerCase();
      var ok = (filter === "all") || (filter === "confirm" ? confirm : kind === filter);
      if (q && text.indexOf(q) === -1) ok = false;
      row.classList.toggle("hidden", !ok);
      setOpen(row, isOpen(row), false);
      if (ok) shown += 1;
    });
    var empty = document.getElementById("finding-empty");
    if (empty) empty.classList.toggle("hidden", shown !== 0);
  }
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      filter = chip.getAttribute("data-filter") || "all";
      chips.forEach(function (c) { c.classList.toggle("is-on", c === chip); });
      apply();
    });
  });
  if (search) search.addEventListener("input", apply);
  document.querySelectorAll(".finding-row").forEach(function (row) {
    row.addEventListener("click", function (ev) {
      ev.preventDefault();
      toggleRow(row, true);
    });
    row.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleRow(row, true);
      }
    });
  });
  var hash = (location.hash || "").replace(/^#/, "");
  var match = hash.match(/^finding-(\\d+)$/);
  if (match) {
    var target = document.getElementById("finding-" + match[1] + "-row");
    if (target) setOpen(target, true, true);
  }
})();
`;
