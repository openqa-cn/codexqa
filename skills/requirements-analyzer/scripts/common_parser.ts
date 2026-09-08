import { extname } from "node:path";
import {
  ZipReader,
  excelSharedStrings,
  excelSheetRows,
  extractHtmlText,
  readText,
  stem,
  wordParagraphs,
} from "./office_io.ts";

export function parseWord(filePath: string): string {
  const zip = ZipReader.fromFile(filePath);
  return wordParagraphs(zip.readText("word/document.xml")).join("\n");
}

export function parseHtml(filePath: string): string {
  return extractHtmlText(readText(filePath));
}

function flattenJson(prefix: string, value: unknown, out: string[]): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenJson(prefix ? `${prefix}.${key}` : key, child, out);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => flattenJson(`${prefix}[${index}]`, child, out));
    return;
  }
  out.push(`${prefix}: ${String(value)}`);
}

export function parseJson(filePath: string): string {
  const obj = JSON.parse(readText(filePath));
  const out: string[] = [];
  flattenJson("", obj, out);
  return out.join("\n");
}

export function parseMarkdown(filePath: string): string {
  let text = readText(filePath);
  text = text.replace(/[*_`>#-]/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

export function parseExcel(filePath: string): string {
  const zip = ZipReader.fromFile(filePath);
  const shared = zip.has("xl/sharedStrings.xml")
    ? excelSharedStrings(zip.readText("xl/sharedStrings.xml"))
    : [];
  const rows = excelSheetRows(zip.readText("xl/worksheets/sheet1.xml"), shared);
  return rows
    .map((values) => values.filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");
}

export const PARSERS: Record<string, (filePath: string) => string> = {
  word: parseWord,
  html: parseHtml,
  json: parseJson,
  markdown: parseMarkdown,
  excel: parseExcel,
};

export function detectFormat(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    ".docx": "word",
    ".html": "html",
    ".htm": "html",
    ".json": "json",
    ".md": "markdown",
    ".markdown": "markdown",
    ".xlsx": "excel",
    ".xlsm": "excel",
  };
  if (!(ext in mapping)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }
  return mapping[ext];
}

export { stem };
