import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { task_dir } from "./store.ts";

export const SECTION_CHAR_LIMIT = 100;
export const SECTION_CHAR_LIMIT_STORY = 300;

const STORY_HEADINGS = new Set([
  "## Mapped call path",
  "## Root cause",
  "## 映射调用链",
  "## 根因",
]);

export function section_limit(heading: string): number {
  return STORY_HEADINGS.has(heading) ? SECTION_CHAR_LIMIT_STORY : SECTION_CHAR_LIMIT;
}

export const EN_HEADINGS = [
  "# Exception diagnosis",
  "## Executive summary",
  "## Symptom and exception facts",
  "## Mapped call path",
  "## Root cause",
  "## Trigger",
  "## Contributing factors",
  "## Suggested fix and verification",
  "## Confidence and gaps",
];

export const ZH_HEADINGS = [
  "# 异常诊断",
  "## 摘要",
  "## 现象与异常事实",
  "## 映射调用链",
  "## 根因",
  "## 触发点",
  "## 促成因素",
  "## 修复建议与验证",
  "## 置信度与缺口",
];

export type SectionOverLimit = { heading: string; chars: number; limit: number };

export function split_bilingual(markdown: string): { en: string; zh: string } {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  const zhIdx = text.indexOf("# 异常诊断");
  const enIdx = text.indexOf("# Exception diagnosis");
  let en = "";
  let zh = "";
  if (enIdx >= 0 && zhIdx >= 0) {
    if (enIdx < zhIdx) {
      en = text.slice(enIdx, zhIdx).trim();
      zh = text.slice(zhIdx).trim();
    } else {
      zh = text.slice(zhIdx, enIdx).trim();
      en = text.slice(enIdx).trim();
    }
  } else if (enIdx >= 0) {
    en = text.slice(enIdx).trim();
  } else if (zhIdx >= 0) {
    zh = text.slice(zhIdx).trim();
  }
  return { en, zh };
}

/** 字数: non-whitespace Unicode scalars. Headings are not counted. */
export function body_char_count(body: string): number {
  return Array.from(String(body || "").replace(/\s+/g, "")).length;
}

function is_ident_char(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_#.:]/.test(ch);
}

/** Keep a prefix whose non-whitespace 字 count is ≤ limit. Do not cut mid-identifier when a prior token exists. */
export function fit_chars(text: string, limit: number): string {
  const chars = Array.from(String(text || ""));
  let count = 0;
  let out = "";
  let i = 0;
  for (; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    if (count >= limit) break;
    out += ch;
    count += 1;
  }
  out = out.replace(/\s+/g, " ").trim();
  const cutMidToken = i < chars.length && i > 0 && !/\s/.test(chars[i - 1]) && is_ident_char(chars[i - 1]) && is_ident_char(chars[i]);
  if (cutMidToken) {
    const trimmed = out.replace(/[A-Za-z0-9_#.:]+$/, "").replace(/[→,;:\-\s]+$/, "").trim();
    if (trimmed) return trimmed;
  }
  return out;
}

/** Include `keep` parts first, then optional parts while they fit the 字 cap. */
export function fit_parts(parts: { text?: string; keep?: boolean }[], limit: number): string {
  const cleaned = parts
    .map((p) => ({ text: String(p.text || "").replace(/\s+/g, " ").trim(), keep: !!p.keep }))
    .filter((p) => p.text);
  const must = cleaned.filter((p) => p.keep).map((p) => p.text);
  const optional = cleaned.filter((p) => !p.keep).map((p) => p.text);
  let out = must.join(" ");
  if (body_char_count(out) > limit) return fit_chars(out, limit);
  for (const extra of optional) {
    const next = `${out} ${extra}`.trim();
    if (body_char_count(next) <= limit) out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}

export function extract_sections(
  doc: string,
  headings: string[],
): { heading: string; body: string; chars: number; limit: number }[] {
  const text = String(doc || "").replace(/\r\n/g, "\n");
  const sectionHeads = headings.filter((h) => h.startsWith("## "));
  return sectionHeads.map((heading, i) => {
    const start = text.indexOf(heading);
    if (start < 0) return { heading, body: "", chars: 0, limit: section_limit(heading) };
    const after = start + heading.length;
    const rest = sectionHeads.slice(i + 1);
    let end = text.length;
    for (const next of rest) {
      const at = text.indexOf(next, after);
      if (at >= 0) {
        end = at;
        break;
      }
    }
    const titleAt = text.indexOf("\n# ", after);
    if (titleAt >= 0 && titleAt < end) end = titleAt;
    const body = text.slice(after, end).replace(/^\s+|\s+$/g, "");
    return { heading, body, chars: body_char_count(body), limit: section_limit(heading) };
  });
}

export function validate_report(markdown: string): {
  ok: boolean;
  missing: string[];
  overLimit: SectionOverLimit[];
} {
  const { en } = split_bilingual(markdown);
  const doc = en || String(markdown || "");
  const missing = EN_HEADINGS.filter((h) => !doc.includes(h)).map((h) => `en:${h}`);
  // Lengths in SECTION_CHAR_* are prompt hints only; do not reject over-hint bodies.
  return { ok: missing.length === 0, missing, overLimit: [] };
}

export function write_report(
  task_id: number,
  markdown: string,
): { path: string; enPath: string; zhPath: string; htmlPath: string; bytes: number } {
  const dir = task_dir(task_id);
  const combined = String(markdown || "").trim() + "\n";
  const { en } = split_bilingual(combined);
  const english = `${(en || combined).trim()}\n`;
  const path = join(dir, "report.md");
  const enPath = join(dir, "report.en.md");
  const htmlPath = join(dir, "report.html");
  writeFileSync(path, english, "utf8");
  writeFileSync(enPath, english, "utf8");
  return { path, enPath, zhPath: "", htmlPath, bytes: Buffer.byteLength(english) };
}
