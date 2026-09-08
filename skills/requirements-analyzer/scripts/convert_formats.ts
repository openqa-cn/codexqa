import { writeFileSync } from "node:fs";
import { extname, parse as parsePath, resolve } from "node:path";
import {
  ZipReader,
  csvEscape,
  excelSharedStrings,
  excelSheetRows,
  firstPositional,
  isDirectRun,
  parseCsvText,
  parseXml,
  findAll,
  textOf,
  pyTitle,
  readText,
  stem,
  takeFlag,
  wordParagraphs,
} from "./office_io.ts";

type JsonValue = unknown;
type ParsedDoc = Record<string, unknown>;
type ModelItem = { key: string; value: unknown };
type ModelSection = { name: string; items: ModelItem[] };
type ConvertModel = { title: string; sections: ModelSection[] };

function parseMarkdown(filePath: string): ParsedDoc {
  const text = readText(filePath);
  const headings: Array<{ level: number; title: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(#{1,6})\s+(.*)$/);
    if (match) headings.push({ level: match[1].length, title: match[2].trim() });
  }
  return { title: headings[0]?.title ?? stem(filePath), headings, text };
}

function parseJson(filePath: string): ParsedDoc {
  return { title: stem(filePath), data: JSON.parse(readText(filePath)) };
}

function parseCsvFile(filePath: string): ParsedDoc {
  const parsed = parseCsvText(readText(filePath));
  return { title: stem(filePath), columns: parsed.columns, rows: parsed.rows };
}

function parseDocx(filePath: string): ParsedDoc {
  const zip = ZipReader.fromFile(filePath);
  return { title: stem(filePath), paragraphs: wordParagraphs(zip.readText("word/document.xml")) };
}

function parseXlsx(filePath: string): ParsedDoc {
  const zip = ZipReader.fromFile(filePath);
  const shared = zip.has("xl/sharedStrings.xml")
    ? excelSharedStrings(zip.readText("xl/sharedStrings.xml"))
    : [];
  return { title: stem(filePath), rows: excelSheetRows(zip.readText("xl/worksheets/sheet1.xml"), shared) };
}

function walkTitles(node: JsonValue, topics: string[]): void {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const record = node as Record<string, JsonValue>;
    const title = record.title;
    if (typeof title === "string" && title.trim()) topics.push(title.trim());
    for (const key of ["children", "topics", "rootTopic", "attached"]) {
      walkTitles(record[key], topics);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkTitles(child, topics);
  }
}

function parseXmind(filePath: string): ParsedDoc {
  const zip = ZipReader.fromFile(filePath);
  const names = new Set(zip.names());
  let topics: string[] = [];
  if (names.has("content.json")) {
    walkTitles(JSON.parse(zip.readText("content.json")), topics);
  } else if (names.has("content.xml")) {
    topics = findAll(parseXml(zip.readText("content.xml")), "title")
      .map((node) => textOf(node).trim())
      .filter(Boolean);
  } else {
    throw new Error("Unsupported XMind package structure");
  }
  return { title: topics[0] ?? stem(filePath), topics };
}

function detectInFormat(filePath: string, forced?: string): string {
  if (forced && forced !== "auto") return forced;
  return (
    {
      ".md": "markdown",
      ".markdown": "markdown",
      ".json": "json",
      ".csv": "csv",
      ".docx": "word",
      ".xlsx": "excel",
      ".xmind": "xmind",
      ".tsv": "excel",
    }[extname(filePath).toLowerCase()] ?? "markdown"
  );
}

function normalize(parsed: ParsedDoc): ConvertModel {
  const title = String(parsed.title || "QA Output");
  const sections: ModelSection[] = [];
  if ("text" in parsed) {
    sections.push({ name: "content", items: [{ key: "text", value: parsed.text }] });
  }
  if (Array.isArray(parsed.headings)) {
    sections.push({
      name: "headings",
      items: (parsed.headings as Array<{ title?: string }>).map((heading) => ({
        key: "heading",
        value: heading.title ?? "",
      })),
    });
  }
  if ("data" in parsed) {
    const data = parsed.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      sections.push({
        name: "json_object",
        items: Object.entries(data as Record<string, unknown>)
          .slice(0, 100)
          .map(([key, value]) => ({ key, value })),
      });
    } else if (Array.isArray(data)) {
      sections.push({
        name: "json_array",
        items: data.slice(0, 200).map((value) => ({ key: "row", value })),
      });
    } else {
      sections.push({ name: "json_value", items: [{ key: "value", value: data }] });
    }
  }
  if (Array.isArray(parsed.rows)) {
    sections.push({
      name: "rows",
      items: (parsed.rows as unknown[]).slice(0, 200).map((row, index) => ({
        key: `row_${index + 1}`,
        value: row,
      })),
    });
  }
  if (Array.isArray(parsed.columns)) {
    sections.push({
      name: "columns",
      items: (parsed.columns as unknown[]).map((column) => ({ key: "column", value: column })),
    });
  }
  if (Array.isArray(parsed.paragraphs)) {
    sections.push({
      name: "paragraphs",
      items: (parsed.paragraphs as unknown[]).slice(0, 200).map((paragraph, index) => ({
        key: `p${index + 1}`,
        value: paragraph,
      })),
    });
  }
  if (Array.isArray(parsed.topics)) {
    sections.push({
      name: "topics",
      items: (parsed.topics as unknown[]).slice(0, 300).map((topic) => ({ key: "topic", value: topic })),
    });
  }
  return { title, sections };
}

function scalar(value: unknown): string {
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function writeJson(model: ConvertModel, output: string): void {
  writeFileSync(output, JSON.stringify(model, null, 2), "utf8");
}

function writeCsv(model: ConvertModel, output: string): void {
  const lines = ["section,key,value"];
  for (const section of model.sections) {
    for (const item of section.items) {
      lines.push([csvEscape(section.name), csvEscape(item.key), csvEscape(scalar(item.value))].join(","));
    }
  }
  writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
}

function writeExcelTsv(model: ConvertModel, output: string): void {
  const lines = ["Section\tKey\tValue"];
  for (const section of model.sections) {
    for (const item of section.items) {
      lines.push(`${section.name}\t${item.key}\t${scalar(item.value).replace(/\t/g, " ")}`);
    }
  }
  writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
}

function writeMarkdown(model: ConvertModel, output: string): void {
  const lines = [`# ${model.title}`, ""];
  for (const section of model.sections) {
    lines.push(`## ${section.name}`);
    for (const item of section.items) {
      lines.push(`- **${item.key}**: ${scalar(item.value)}`);
    }
    lines.push("");
  }
  writeFileSync(output, `${lines.join("\n").replace(/\s+$/, "")}\n`, "utf8");
}

function writeWordMd(model: ConvertModel, output: string): void {
  const lines = [model.title, "=".repeat(model.title.length), ""];
  let idx = 1;
  for (const section of model.sections) {
    lines.push(`${idx}. ${pyTitle(section.name)}`);
    for (const item of section.items) {
      lines.push(`- ${item.key}: ${scalar(item.value)}`);
    }
    lines.push("");
    idx += 1;
  }
  writeFileSync(output, `${lines.join("\n").replace(/\s+$/, "")}\n`, "utf8");
}

function writeXmindMd(model: ConvertModel, output: string): void {
  const lines = [`# ${model.title}`, "", `- ${model.title}`];
  for (const section of model.sections) {
    lines.push(`  - ${section.name}`);
    for (const item of section.items) {
      lines.push(`    - ${item.key}: ${scalar(item.value)}`);
    }
  }
  writeFileSync(output, `${lines.join("\n").replace(/\s+$/, "")}\n`, "utf8");
}

function defaultOutput(inputPath: string, toFmt: string): string {
  const ext: Record<string, string> = {
    json: ".json",
    csv: ".csv",
    excel: ".tsv",
    markdown: ".md",
    word: ".word.md",
    xmind: ".xmind.md",
  };
  const parsed = parsePath(inputPath);
  return `${parsed.dir}/${parsed.name}.converted${ext[toFmt]}`;
}

export function convertFile(input: string, fromFmt: string, toFmt: string, output?: string): string {
  const resolved = resolve(input);
  const inFmt = detectInFormat(resolved, fromFmt);
  let parsed: ParsedDoc;
  if (inFmt === "word") {
    parsed = parseDocx(resolved);
  } else if (inFmt === "excel") {
    if (extname(resolved).toLowerCase() === ".tsv") {
      const rows = readText(resolved)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.replace(/\n$/, "").split("\t"));
      parsed = { title: stem(resolved), rows };
    } else {
      parsed = parseXlsx(resolved);
    }
  } else if (inFmt === "xmind") {
    parsed = parseXmind(resolved);
  } else if (inFmt === "json") {
    parsed = parseJson(resolved);
  } else if (inFmt === "csv") {
    parsed = parseCsvFile(resolved);
  } else {
    parsed = parseMarkdown(resolved);
  }

  const model = normalize(parsed);
  const out = output ? resolve(output) : defaultOutput(resolved, toFmt);
  if (toFmt === "json") writeJson(model, out);
  else if (toFmt === "csv") writeCsv(model, out);
  else if (toFmt === "excel") writeExcelTsv(model, out);
  else if (toFmt === "markdown") writeMarkdown(model, out);
  else if (toFmt === "word") writeWordMd(model, out);
  else writeXmindMd(model, out);
  return out;
}

export function runConvert(argvIn: string[]): string {
  const argv = [...argvIn];
  const fromFmt = takeFlag(argv, "--from") ?? "auto";
  const toFmt = takeFlag(argv, "--to");
  const output = takeFlag(argv, "--output");
  const input = firstPositional(argv);
  const fromChoices = ["auto", "word", "excel", "xmind", "json", "csv", "markdown"];
  const toChoices = ["word", "excel", "xmind", "json", "csv", "markdown"];
  if (!input || !toFmt) {
    throw new Error("usage: convert_formats.ts <input> --to <fmt> [--from auto] [--output path]");
  }
  if (!fromChoices.includes(fromFmt) || !toChoices.includes(toFmt)) {
    throw new Error("unsupported --from/--to value");
  }
  return convertFile(input, fromFmt, toFmt, output);
}

if (isDirectRun(import.meta.url)) {
  try {
    console.log(runConvert(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
