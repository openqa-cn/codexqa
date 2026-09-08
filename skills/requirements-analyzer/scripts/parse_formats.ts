import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import {
  ZipReader,
  excelSharedStrings,
  excelSheetRows,
  findAll,
  firstPositional,
  isDirectRun,
  parseCsvText,
  parseXml,
  readText,
  takeFlag,
  textOf,
  wordParagraphs,
} from "./office_io.ts";

type JsonValue = unknown;
type ParseResult = Record<string, unknown>;

function parseMarkdown(filePath: string): ParseResult {
  const text = readText(filePath);
  const headings: Array<{ level: number; title: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(#{1,6})\s+(.*)$/);
    if (match) headings.push({ level: match[1].length, title: match[2].trim() });
  }
  return { format: "markdown", headings, preview: text.slice(0, 500) };
}

function parseJson(filePath: string): ParseResult {
  const data = JSON.parse(readText(filePath));
  let shape: Record<string, unknown>;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    shape = { type: "object", keys: Object.keys(data).slice(0, 50) };
  } else if (Array.isArray(data)) {
    shape = { type: "array", size: data.length };
  } else {
    shape = { type: typeof data };
  }
  return { format: "json", shape, data };
}

function parseCsvFile(filePath: string): ParseResult {
  const parsed = parseCsvText(readText(filePath));
  return {
    format: "csv",
    columns: parsed.columns,
    row_count: parsed.rows.length,
    sample_rows: parsed.rows.slice(0, 10),
  };
}

function parseDocx(filePath: string): ParseResult {
  const zip = ZipReader.fromFile(filePath);
  const paragraphs = wordParagraphs(zip.readText("word/document.xml"));
  return {
    format: "word",
    paragraph_count: paragraphs.length,
    paragraphs: paragraphs.slice(0, 100),
  };
}

function pdfUnescape(text: string): string {
  return text.replace(/\\([0-7]{1,3}|.)/g, (_, token: string) => {
    if (/^[0-7]{1,3}$/.test(token)) {
      try {
        return String.fromCharCode(parseInt(token, 8));
      } catch {
        return "";
      }
    }
    const mapping: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\",
    };
    return mapping[token] ?? token;
  });
}

function tryDecompress(raw: Buffer): Buffer[] {
  const candidates = [raw];
  try {
    candidates.push(inflateSync(raw));
  } catch {
    /* keep raw */
  }
  try {
    candidates.push(inflateRawSync(raw));
  } catch {
    /* keep raw */
  }
  return candidates;
}

function extractPdfTextBuiltin(filePath: string): { text: string; pageCount: number } {
  const data = readFileSync(filePath);
  const pageCount = [...data.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length;
  const textBlocks: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const content = data.toString("latin1");
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(content))) {
    const raw = Buffer.from(match[1], "latin1");
    for (const chunk of tryDecompress(raw)) {
      const decoded = chunk.toString("latin1");
      for (const tj of decoded.matchAll(/\(((?:\\.|[^\\()])*?)\)\s*Tj/g)) {
        textBlocks.push(pdfUnescape(tj[1]));
      }
      for (const arr of decoded.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
        const parts = [...arr[1].matchAll(/\(((?:\\.|[^\\()])*?)\)/g)].map((part) => pdfUnescape(part[1]));
        if (parts.length) textBlocks.push(parts.join(""));
      }
    }
  }
  return {
    text: textBlocks.map((item) => item.trim()).filter(Boolean).join("\n"),
    pageCount,
  };
}

export function parsePdf(filePath: string): ParseResult {
  const resolved = resolve(filePath);
  try {
    const proc = spawnSync("pdftotext", ["-q", resolved, "-"], { encoding: "utf8" });
    if (proc.status === 0) {
      const text = proc.stdout ?? "";
      const pageCount = text ? text.split("\f").length : 0;
      return {
        format: "pdf",
        engine: "pdftotext",
        page_count: pageCount,
        text_length: text.length,
        preview: text.slice(0, 2000),
      };
    }
  } catch {
    /* fallback */
  }

  const fallback = extractPdfTextBuiltin(resolved);
  if (fallback.text || fallback.pageCount > 0) {
    return {
      format: "pdf",
      engine: "builtin",
      page_count: fallback.pageCount,
      text_length: fallback.text.length,
      preview: fallback.text.slice(0, 2000),
    };
  }
  throw new Error("Unable to parse PDF text in current environment. Details: No PDF parser available");
}

function parseXlsx(filePath: string): ParseResult {
  const zip = ZipReader.fromFile(filePath);
  const shared = zip.has("xl/sharedStrings.xml")
    ? excelSharedStrings(zip.readText("xl/sharedStrings.xml"))
    : [];
  const rows = excelSheetRows(zip.readText("xl/worksheets/sheet1.xml"), shared);
  return { format: "excel", row_count: rows.length, sample_rows: rows.slice(0, 20) };
}

function walkTitles(node: JsonValue, titles: string[]): void {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const record = node as Record<string, JsonValue>;
    if (typeof record.title === "string" && record.title.trim()) titles.push(record.title.trim());
    for (const key of ["children", "topics", "rootTopic", "attached"]) {
      walkTitles(record[key], titles);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkTitles(child, titles);
  }
}

function parseXmind(filePath: string): ParseResult {
  const zip = ZipReader.fromFile(filePath);
  const names = new Set(zip.names());
  if (names.has("content.json")) {
    const titles: string[] = [];
    walkTitles(JSON.parse(zip.readText("content.json")), titles);
    return { format: "xmind", topic_count: titles.length, topics: titles.slice(0, 200) };
  }
  if (names.has("content.xml")) {
    const titles = findAll(parseXml(zip.readText("content.xml")), "title")
      .map((node) => textOf(node).trim())
      .filter(Boolean);
    return { format: "xmind", topic_count: titles.length, topics: titles.slice(0, 200) };
  }
  throw new Error("Unsupported XMind package structure");
}

function detectFormat(filePath: string, forced?: string): string {
  if (forced && forced !== "auto") return forced;
  return (
    {
      ".md": "markdown",
      ".markdown": "markdown",
      ".json": "json",
      ".csv": "csv",
      ".docx": "word",
      ".pdf": "pdf",
      ".xlsx": "excel",
      ".xmind": "xmind",
    }[extname(filePath).toLowerCase()] ?? "markdown"
  );
}

export function runParse(argvIn: string[]): string {
  const argv = [...argvIn];
  const format = takeFlag(argv, "--format") ?? "auto";
  const output = takeFlag(argv, "--output");
  const input = firstPositional(argv);
  const choices = ["auto", "word", "pdf", "excel", "xmind", "json", "csv", "markdown"];
  if (!input) throw new Error("usage: parse_formats.ts <input> [--format auto] [--output path]");
  if (!choices.includes(format)) throw new Error(`unsupported --format: ${format}`);

  const fmt = detectFormat(input, format);
  let result: ParseResult;
  if (fmt === "word") result = parseDocx(input);
  else if (fmt === "pdf") result = parsePdf(input);
  else if (fmt === "excel") result = parseXlsx(input);
  else if (fmt === "xmind") result = parseXmind(input);
  else if (fmt === "json") result = parseJson(input);
  else if (fmt === "csv") result = parseCsvFile(input);
  else result = parseMarkdown(input);

  result.source = input;
  const out = JSON.stringify(result, null, 2);
  if (output) {
    writeFileSync(resolve(output), out, "utf8");
    return resolve(output);
  }
  process.stdout.write(`${out}\n`);
  return "";
}

if (isDirectRun(import.meta.url)) {
  try {
    const printed = runParse(process.argv.slice(2));
    if (printed) console.log(printed);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
