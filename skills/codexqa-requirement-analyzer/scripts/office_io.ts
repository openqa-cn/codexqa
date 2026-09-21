import { inflateRawSync, inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, extname, resolve } from "node:path";

export function isDirectRun(metaUrl: string): boolean {
  const self = fileURLToPath(metaUrl);
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return self === invoked;
}

export function stem(filePath: string): string {
  return basename(filePath, extname(filePath));
}

export function readText(filePath: string): string {
  return readFileSync(filePath).toString("utf8");
}

export function takeFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`missing value for ${name}`);
  }
  argv.splice(i, 2);
  return value;
}

export function hasFlag(argv: string[], name: string): boolean {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

export function firstPositional(argv: string[]): string | undefined {
  return argv.find((item) => !item.startsWith("-"));
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function localName(qname: string): string {
  const i = qname.indexOf(":");
  return (i >= 0 ? qname.slice(i + 1) : qname).trim();
}

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
};

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[localName(match[1])] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, text: "", children: [] };
  const stack: XmlNode[] = [root];
  const token =
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/\s*([^>\s]+)\s*>|<([^\s/>]+)([^>]*?)\/>|<([^\s/>]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    const current = stack[stack.length - 1];
    if (match[1] !== undefined) {
      current.text += match[1];
      continue;
    }
    if (match[2] !== undefined) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (match[3] !== undefined) {
      current.children.push({
        name: localName(match[3]),
        attrs: parseAttrs(match[4] ?? ""),
        text: "",
        children: [],
      });
      continue;
    }
    if (match[5] !== undefined) {
      const rawAttrs = match[6] ?? "";
      const node: XmlNode = {
        name: localName(match[5]),
        attrs: parseAttrs(rawAttrs),
        text: "",
        children: [],
      };
      current.children.push(node);
      if (!rawAttrs.trimEnd().endsWith("/")) stack.push(node);
      continue;
    }
    if (match[7] !== undefined) {
      current.text += decodeEntities(match[7]);
    }
  }
  return root;
}

export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (item: XmlNode) => {
    if (item.name === name) out.push(item);
    for (const child of item.children) walk(child);
  };
  walk(node);
  return out;
}

export function textOf(node: XmlNode): string {
  return `${node.text}${node.children.map(textOf).join("")}`;
}

export function extractHtmlText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  return cleaned
    .replace(/<[^>]+>/g, "\n")
    .split(/\n/)
    .map((part) => decodeEntities(part).trim())
    .filter(Boolean)
    .join("\n");
}

export class ZipReader {
  private entries = new Map<string, { method: number; compressed: Buffer }>();

  constructor(private readonly buf: Buffer) {
    this.index();
  }

  static fromFile(filePath: string): ZipReader {
    return new ZipReader(readFileSync(filePath));
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Missing zip entry: ${name}`);
    if (entry.method === 0) return entry.compressed;
    if (entry.method === 8) {
      try {
        return inflateRawSync(entry.compressed);
      } catch {
        return inflateSync(entry.compressed);
      }
    }
    throw new Error(`Unsupported zip method ${entry.method} for ${name}`);
  }

  readText(name: string): string {
    return this.read(name).toString("utf8");
  }

  private index(): void {
    const eocd = this.findEocd();
    if (eocd < 0) {
      this.indexLocalHeaders();
      return;
    }
    const cdOffset = this.buf.readUInt32LE(eocd + 16);
    const cdSize = this.buf.readUInt32LE(eocd + 12);
    let pos = cdOffset;
    const end = cdOffset + cdSize;
    while (pos + 46 <= end && this.buf.readUInt32LE(pos) === 0x02014b50) {
      const method = this.buf.readUInt16LE(pos + 10);
      const compSize = this.buf.readUInt32LE(pos + 20);
      const nameLen = this.buf.readUInt16LE(pos + 28);
      const extraLen = this.buf.readUInt16LE(pos + 30);
      const commentLen = this.buf.readUInt16LE(pos + 32);
      const localOff = this.buf.readUInt32LE(pos + 42);
      const name = this.buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
      const locNameLen = this.buf.readUInt16LE(localOff + 26);
      const locExtraLen = this.buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + locNameLen + locExtraLen;
      this.entries.set(name, {
        method,
        compressed: this.buf.subarray(dataStart, dataStart + compSize),
      });
      pos += 46 + nameLen + extraLen + commentLen;
    }
  }

  private findEocd(): number {
    const min = Math.max(0, this.buf.length - 22 - 0xffff);
    for (let i = this.buf.length - 22; i >= min; i--) {
      if (this.buf.readUInt32LE(i) === 0x06054b50) return i;
    }
    return -1;
  }

  private indexLocalHeaders(): void {
    let pos = 0;
    while (pos + 30 <= this.buf.length && this.buf.readUInt32LE(pos) === 0x04034b50) {
      const method = this.buf.readUInt16LE(pos + 8);
      const compSize = this.buf.readUInt32LE(pos + 18);
      const nameLen = this.buf.readUInt16LE(pos + 26);
      const extraLen = this.buf.readUInt16LE(pos + 28);
      const name = this.buf.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
      const dataStart = pos + 30 + nameLen + extraLen;
      this.entries.set(name, {
        method,
        compressed: this.buf.subarray(dataStart, dataStart + compSize),
      });
      pos = dataStart + compSize;
    }
  }
}

export function wordParagraphs(xml: string): string[] {
  const root = parseXml(xml);
  const lines: string[] = [];
  for (const paragraph of findAll(root, "p")) {
    const line = findAll(paragraph, "t")
      .map((node) => textOf(node))
      .join("")
      .trim();
    if (line) lines.push(line);
  }
  return lines;
}

export function excelSharedStrings(xml: string): string[] {
  const root = parseXml(xml);
  return findAll(root, "si").map((si) => findAll(si, "t").map((node) => textOf(node)).join(""));
}

export function excelSheetRows(xml: string, shared: string[]): string[][] {
  const root = parseXml(xml);
  const rows: string[][] = [];
  for (const row of findAll(root, "row")) {
    const vals: string[] = [];
    for (const cell of row.children.filter((child) => child.name === "c")) {
      const valueNode = cell.children.find((child) => child.name === "v");
      if (!valueNode || !textOf(valueNode)) {
        vals.push("");
        continue;
      }
      const raw = textOf(valueNode);
      if (cell.attrs.t === "s") {
        const idx = Number(raw);
        vals.push(idx >= 0 && idx < shared.length ? shared[idx] : "");
      } else {
        vals.push(raw);
      }
    }
    rows.push(vals);
  }
  return rows;
}

export function parseCsvText(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const records = parseCsvRecords(text);
  const columns = records[0] ?? [];
  const rows = records.slice(1).map((record) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = record[i] ?? "";
    }
    return row;
  });
  return { columns, rows };
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      if (row.some((item) => item.length > 0)) records.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((item) => item.length > 0)) records.push(row);
  }
  return records;
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function pyTitle(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}
