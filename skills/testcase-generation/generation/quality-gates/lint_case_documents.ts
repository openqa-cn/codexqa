/**
 * lint_case_documents.ts — case rule engine
 *
 * Single-source consumer: implements every structural check in gate-case-quality.md Step R4-3.
 * Change gate-case-quality.md first, then sync this script; do not change the script alone.
 *
 * Usage:
 *   node --experimental-strip-types lint_case_documents.ts --file <case.md path>
 *   node --experimental-strip-types lint_case_documents.ts --dir  <case directory>
 *   node --experimental-strip-types lint_case_documents.ts --file <case.md path> --fix
 *   node --experimental-strip-types lint_case_documents.ts --file <case.md path> --json
 *   node --experimental-strip-types lint_case_documents.ts --file <case.md path> --rules table
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

type Finding = {
  topic: string;
  hit: boolean;
  severity: string;
  issueDetail: string;
  fixAction: string;
  autofix: boolean;
};

type Ctx = {
  case_name: string;
  case_type: string;
  md_path: string;
  json_path: string | null;
  resolved_path: string | null;
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const STEP_HEADER_RE = /\|\s*#\s*\|\s*Step\s*\|\s*Expected\s*\|/;
const TESTDATA_HEADER_RE = /\|\s*Entity\s*\|\s*Content\s*\|\s*Construction\s*\|/;
const SUMMARY_VALID_RE = /^Step\s*\d+\s*·\s*.+\s*(request|expected)$/;
const ENG_TITLE_RE = /^#{2,4}\s*[1-5]?\.?\s*Request and Assertions\s*$/gm;
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const DETAILS_BLOCK_RE = /<details>([\s\S]*?)<\/details>/g;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/g;

const R09_DESC_MAX_LEN = 20;
const TEMPLATE_PLACEHOLDERS = new Set([
  '"{field1}"',
  '"{value1}"',
  '"{field2}"',
  '"{value2}"',
  '"{config_key}"',
  '"{config_value}"',
  '"{config_service_id}"',
  '"{methodName}"',
  '"{serviceName}"',
  '"{methodName}"',
]);

const DEFAULT_COMPONENTS = [
  { id: "database", label: "Database", fields: ["datasource", "table", "shardingRule"] },
  { id: "cache", label: "Cache", fields: ["cluster", "key", "command"] },
  { id: "mq", label: "MQ", fields: ["cluster", "topic", "producer"] },
  { id: "config", label: "Config service", fields: ["serviceId", "key", "value"] },
  { id: "experiment", label: "Experiment", fields: ["experimentKey", "groups"] },
];
const LEGACY_SECTION_TITLES = ["Cache · Redis", "Cache · KV store"];
const LEGACY_HEADER_CELLS = new Set([
  "rediscluster",
  "keyprefix",
  "keyparams",
  "kvnamespace",
  "namespace",
]);

function findResolvedPath(mdPath: string, explicit?: string | null): string | null {
  if (explicit && fs.existsSync(explicit) && fs.statSync(explicit).isFile()) return explicit;
  let dir = path.resolve(path.dirname(mdPath));
  const root = path.parse(dir).root;
  while (true) {
    const cand = path.join(dir, "usecases", "testdocs", "integrations-resolved.json");
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadComponents(resolvedPath: string | null) {
  if (resolvedPath && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    try {
      const data = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
      const comps = (data.profile || {}).components;
      if (Array.isArray(comps) && comps.length) return comps;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_COMPONENTS;
}

function parseFrontmatter(content: string): [string | null, Record<string, string>] {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return [null, {}];
  const block = match[1];
  const fields: Record<string, string> = {};
  for (const line of block.split(/\n/)) {
    const i = line.indexOf(":");
    if (i >= 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return [block, fields];
}

function makeFinding(
  topic: string,
  opts: Partial<Finding> = {},
): Finding {
  return {
    topic,
    hit: opts.hit ?? true,
    severity: opts.severity ?? "error",
    issueDetail: opts.issueDetail ?? "",
    fixAction: opts.fixAction ?? "",
    autofix: opts.autofix ?? false,
  };
}

function checkFrontmatterCaseid(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const [, fm] = parseFrontmatter(content);
  const cid = fm.caseId || "";
  if (!cid) {
    findings.push(
      makeFinding("frontmatter.caseid", {
        issueDetail: "frontmatter is missing the caseId field",
        fixAction: "Read caseId from case-registry.json and write it into frontmatter",
      }),
    );
  } else if (!UUID_RE.test(cid)) {
    findings.push(
      makeFinding("frontmatter.caseid", {
        issueDetail: `caseId is not a valid UUID: ${cid}`,
        fixAction: "Read the standard UUID from case-registry.json and replace it",
      }),
    );
  }
  return findings;
}

function checkFrontmatterCasetype(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const [, fm] = parseFrontmatter(content);
  const ct = fm.caseType || "";
  if (ct !== "UI" && ct !== "SERVER") {
    findings.push(
      makeFinding("frontmatter.casetype", {
        issueDetail: `illegal caseType: '${ct}', must be UI or SERVER`,
        fixAction: "Read caseType from case-registry.json and write it into frontmatter (keep uppercase)",
      }),
    );
  }
  return findings;
}

function checkH1Filename(content: string, ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const h1 = content.match(/^#\s+(.+)$/m);
  const fname = ctx.case_name;
  if (!h1) {
    findings.push(
      makeFinding("naming.h1_filename", {
        issueDetail: "missing H1 title",
        fixAction: "Write # {caseName} on the first line",
      }),
    );
  } else if (h1[1].trim() !== fname) {
    findings.push(
      makeFinding("naming.h1_filename", {
        issueDetail: `H1 ≠ filename: H1="${h1[1].trim()}", file="${fname}"`,
        fixAction: "Align H1 and filename with case-registry.caseName",
      }),
    );
  }
  return findings;
}

function checkStepTableHeader(content: string, _ctx: Ctx): Finding[] {
  if (!STEP_HEADER_RE.test(content)) {
    return [
      makeFinding("table.step_header", {
        issueDetail: "no valid step header `| # | Step | Expected |`",
        fixAction: "Replace the step header with the standard format",
      }),
    ];
  }
  return [];
}

function checkConstructionColumn(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\n/);
  let inTable = false;
  let colIdx = -1;
  let sepDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("|") && line.includes("Construction")) {
      const cells = line.split("|");
      for (let ci = 0; ci < cells.length; ci++) {
        if (cells[ci].includes("Construction")) colIdx = ci;
      }
      inTable = true;
      sepDone = false;
      continue;
    }
    if (inTable && !sepDone && /^\|[\s\-:|]+\|$/.test(line.trim())) {
      sepDone = true;
      continue;
    }
    if (inTable && sepDone && line.includes("|") && colIdx >= 0) {
      const cells = line.split("|");
      if (cells.length > colIdx && cells[colIdx].trim()) {
        findings.push(
          makeFinding("table.construction_empty", {
            issueDetail: `line ${i + 1} "Construction" column has content: "${cells[colIdx].trim()}"`,
            fixAction: "Clear the Construction cell on every data row",
            autofix: true,
          }),
        );
        break;
      }
    } else if (inTable && !line.includes("|")) {
      inTable = false;
    }
  }
  return findings;
}

function checkSummaryFormat(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const blocks = content.matchAll(DETAILS_BLOCK_RE);
  for (const block of blocks) {
    const inner = block[1];
    for (const s of inner.matchAll(SUMMARY_RE)) {
      const stext = s[1].trim();
      if (!SUMMARY_VALID_RE.test(stext)) {
        findings.push(
          makeFinding("summary.format", {
            issueDetail: `<summary> does not match the format: "${stext.slice(0, 80)}"`,
            fixAction: "Change to `Step N · {methodName} request` and drop parenthetical extras",
          }),
        );
        return findings;
      }
    }
  }
  return findings;
}

function checkPlaceholderCompliance(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\n/);
  let inTable = false;
  let contentIdx = -1;
  let sepDone = false;
  for (const line of lines) {
    if (line.includes("|") && line.includes("Entity") && line.includes("Content")) {
      const cells = line.split("|");
      for (let ci = 0; ci < cells.length; ci++) {
        if (cells[ci].trim() === "Content") contentIdx = ci;
      }
      inTable = true;
      sepDone = false;
      continue;
    }
    if (inTable && !sepDone && /^\|[\s\-:|]+\|$/.test(line.trim())) {
      sepDone = true;
      continue;
    }
    if (inTable && sepDone && line.includes("|") && contentIdx >= 0) {
      const cells = line.split("|");
      if (cells.length > contentIdx) {
        const val = cells[contentIdx].trim();
        if (
          !val ||
          val.includes("{") ||
          val.includes(":") ||
          val.includes("=") ||
          val.includes("`") ||
          val.length <= R09_DESC_MAX_LEN
        ) {
          continue;
        }
        findings.push(
          makeFinding("placeholder.compliance", {
            severity: "pending_review",
            issueDetail: `SUSPECT_DESC looks like a prose description instead of a placeholder: ${val.slice(0, 30)}...`,
            fixAction: "Human confirm: use a placeholder + comment, or set r09_exempt=true",
          }),
        );
      }
    } else if (inTable && (!line.includes("|") || !line.trim())) {
      inTable = false;
    }
  }
  return findings;
}

function checkEngSectionUnique(content: string, ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const titles = content.match(ENG_TITLE_RE) || [];
  if (ctx.case_type === "SERVER") {
    if (titles.length === 0) {
      findings.push(
        makeFinding("chapter.eng_unique", {
          issueDetail: "missing Request and Assertions chapter",
          fixAction: "Append a Request and Assertions chapter skeleton at the end of the file",
        }),
      );
    } else if (titles.length > 1) {
      findings.push(
        makeFinding("chapter.eng_unique", {
          issueDetail: `Request and Assertions heading appears ${titles.length} times`,
          fixAction: "Merge duplicate chapters and keep the more complete one",
        }),
      );
    }
  }
  return findings;
}

function checkChapterLevel(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const chapterKeywords = ["Prerequisites", "Steps", "Request and Assertions", "Engineering Info", "Teardown"];
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content))) {
    const level = m[1].length;
    const text = m[2].trim();
    const isChapter =
      /^[1-5]\.\s/.test(text) && chapterKeywords.some((kw) => text.includes(kw));
    if (isChapter && level !== 3) {
      findings.push(
        makeFinding("chapter.level", {
          issueDetail: `chapter heading must be ###, actual ${"#".repeat(level)}: ${text}`,
          fixAction: "Change to ###",
          autofix: true,
        }),
      );
      return findings;
    }
  }
  return findings;
}

function checkChapterNumbering(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const expected: Record<string, string> = {
    Prerequisites: "1",
    Steps: "2",
    "Request and Assertions": "3",
    "Engineering Info": "4",
    Teardown: "5",
  };
  for (const [kw, ch] of Object.entries(expected)) {
    const re = new RegExp(`^###\\s*([1-5])\\.\\s*${kw}`, "gm");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      if (m[1] !== ch) {
        findings.push(
          makeFinding("chapter.numbering", {
            issueDetail: `chapter "${kw}" is numbered "${m[1]}", expected "${ch}"`,
            fixAction: `Change to \`### ${ch}. ${kw}\` and update references`,
          }),
        );
        return findings;
      }
    }
  }
  return findings;
}

function checkProfileHeaders(content: string, ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  for (const title of LEGACY_SECTION_TITLES) {
    const re = new RegExp(`^####\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (re.test(content)) {
      findings.push(
        makeFinding("table.profile_headers", {
          issueDetail: `hard-coded split-table heading "${title}"; render a single "Cache" table from profile.components`,
          fixAction: "Change to #### Cache, header cluster / key / command (or the resolved cache.fields)",
        }),
      );
      return findings;
    }
  }
  const components = loadComponents(ctx.resolved_path);
  for (const comp of components) {
    const label = comp.label || comp.id;
    const fields = (comp.fields || []).map((f: unknown) => String(f));
    if (!label || !fields.length) continue;
    const m = content.match(
      new RegExp(`^####\\s*${String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"),
    );
    if (!m || m.index == null) continue;
    const rest = content.slice(m.index + m[0].length);
    let header: string | null = null;
    for (const line of rest.split(/\n/)) {
      if (/^#{1,6}\s+/.test(line)) break;
      if (line.trim().startsWith("|") && !/^\|[\s\-:|]+\|$/.test(line.trim())) {
        header = line;
        break;
      }
    }
    if (!header) continue;
    const cells = header
      .split("|")
      .map((c) => c.trim().replace(/^\*+|\*+$/g, ""))
      .filter((c) => c);
    const lowered = new Set(cells.map((c) => c.toLowerCase()));
    const legacy = [...lowered].filter((c) => LEGACY_HEADER_CELLS.has(c));
    if (legacy.length) {
      findings.push(
        makeFinding("table.profile_headers", {
            issueDetail: `"${label}" header has leftover columns outside the profile: ${legacy.sort().join(",")}`,
          fixAction: `Change the header to ${fields.join(" | ")}`,
        }),
      );
      return findings;
    }
    if (comp.id === "database") {
      const extra = cells.filter(
        (c) => !fields.includes(c) && !["Field", "Content", "Type", "Sharding key"].includes(c),
      );
      if (extra.length) {
        findings.push(
          makeFinding("table.profile_headers", {
            issueDetail: `"${label}" header has columns not declared in the profile: ${extra.join(",")}`,
            fixAction: `Use only ${fields.join(",")}`,
          }),
        );
        return findings;
      }
      continue;
    }
    const sameSet =
      cells.length === fields.length && cells.every((c) => fields.includes(c));
    if (cells.join("\0") !== fields.join("\0") && !sameSet) {
      findings.push(
        makeFinding("table.profile_headers", {
          issueDetail: `"${label}" header ${JSON.stringify(cells)} does not match profile fields ${JSON.stringify(fields)}`,
          fixAction: `Change the header to ${fields.join(" | ")}`,
        }),
      );
      return findings;
    }
  }
  return findings;
}

function checkTableFormatExtra(content: string, _ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  if (/^####\s*Entity/m.test(content) && !TESTDATA_HEADER_RE.test(content)) {
    findings.push(
      makeFinding("table.format_extra", {
        issueDetail: "test-data header missing or wrong: expected `| Entity | Content | Construction |`",
        fixAction: "Replace with the standard header",
      }),
    );
  }
  const apiMatch = content.match(/^####\s*Server APIs\s*\n((?:.+\n)*?)(?=^#{1,4}\s|\Z)/m);
  if (apiMatch) {
    const body = apiMatch[1].trim();
    const firstLine = body.split(/\n/).find((l) => l.trim()) || "";
    if (firstLine && !firstLine.startsWith("|")) {
      findings.push(
        makeFinding("table.format_extra", {
          issueDetail: "Server APIs subsection is not a table (first line is not `|`)",
          fixAction: "Rearrange into a markdown table by field columns",
        }),
      );
    }
  }
  return findings;
}

function checkTemplateResidue(content: string, ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  const templateKeywords = ["Fill in here", "Example:", "Template notes", "Placeholder check"];
  const lines = content.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith(">") && templateKeywords.some((kw) => s.includes(kw))) {
      findings.push(
        makeFinding("residue.template", {
          issueDetail: `line ${i + 1} leftover template note: ${s.slice(0, 60)}`,
          fixAction: "Delete the whole line",
          autofix: true,
        }),
      );
      break;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].includes("|") &&
      i + 1 < lines.length &&
      /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())
    ) {
      let dataCount = 0;
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j].trim().startsWith("|")) dataCount += 1;
        else break;
      }
      if (dataCount === 0) {
        findings.push(
          makeFinding("residue.template", {
            issueDetail: `empty table starting at line ${i + 1} (no data rows)`,
            fixAction: "Delete the entire empty table",
          }),
        );
        break;
      }
    }
  }
  const headings: { idx: number; level: number; text: string; line: string }[] = [];
  lines.forEach((line, idx) => {
    const m = line.match(/^(#{2,4})\s+(.+)$/);
    if (m) headings.push({ idx, level: m[1].length, text: m[2].trim(), line });
  });
  for (let k = 0; k < headings.length - 1; k++) {
    const cur = headings[k];
    const nxt = headings[k + 1];
    if (nxt.level > cur.level) continue;
    const between = lines.slice(cur.idx + 1, nxt.idx);
    if (!between.some((b) => b.trim())) {
      findings.push(
        makeFinding("residue.template", {
          issueDetail: `empty section at line ${cur.idx + 1}: ${cur.line}`,
          fixAction: "Delete that section heading",
        }),
      );
      break;
    }
  }
  if (ctx.case_type === "SERVER" && ctx.json_path && fs.existsSync(ctx.json_path)) {
    try {
      const jsonText = fs.readFileSync(ctx.json_path, "utf8");
      for (const ph of TEMPLATE_PLACEHOLDERS) {
        if (jsonText.includes(ph)) {
          findings.push(
            makeFinding("residue.template", {
              issueDetail: `.json leftover template sample field: ${ph}`,
              fixAction: "Delete the sample key/value pair or the whole sample object",
            }),
          );
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return findings;
}

type RuleFn = (content: string, ctx: Ctx) => Finding[];

const ALL_RULES: Record<string, RuleFn> = {
  "frontmatter.caseid": checkFrontmatterCaseid,
  "frontmatter.casetype": checkFrontmatterCasetype,
  "naming.h1_filename": checkH1Filename,
  "chapter.level": checkChapterLevel,
  "chapter.numbering": checkChapterNumbering,
  "chapter.eng_unique": checkEngSectionUnique,
  "table.step_header": checkStepTableHeader,
  "table.construction_empty": checkConstructionColumn,
  "table.format_extra": checkTableFormatExtra,
  "table.profile_headers": checkProfileHeaders,
  "summary.format": checkSummaryFormat,
  "residue.template": checkTemplateResidue,
  "placeholder.compliance": checkPlaceholderCompliance,
};

function autofixConstructionColumn(content: string): string {
  const parts = content.split(/(?<=\n)/);
  let inTable = false;
  let colIdx = -1;
  let sepDone = false;
  const newLines: string[] = [];
  for (let line of parts) {
    if (line.includes("|") && line.includes("Construction")) {
      const cells = line.split("|");
      for (let ci = 0; ci < cells.length; ci++) {
        if (cells[ci].includes("Construction")) colIdx = ci;
      }
      inTable = true;
      sepDone = false;
      newLines.push(line);
      continue;
    }
    if (inTable && !sepDone && /^\|[\s\-:|]+\|$/.test(line.trim())) {
      sepDone = true;
      newLines.push(line);
      continue;
    }
    if (inTable && sepDone && line.includes("|") && colIdx >= 0) {
      const nl = line.endsWith("\n");
      const cells = (nl ? line.slice(0, -1) : line).split("|");
      if (cells.length > colIdx && cells[colIdx].trim()) {
        cells[colIdx] = " ";
        line = cells.join("|") + (nl ? "\n" : "");
      }
    } else if (inTable && !line.includes("|")) {
      inTable = false;
    }
    newLines.push(line);
  }
  return newLines.join("");
}

function autofixChapterLevel(content: string): string {
  for (const ch of ["1", "2", "3", "4", "5"]) {
    for (const kw of ["Prerequisites", "Steps and Expected Results", "Steps", "Request and Assertions", "Engineering Info", "Teardown"]) {
      content = content.replace(
        new RegExp(`^##\\s+(${ch}\\.\\s*${kw})`, "gm"),
        "### $1",
      );
      content = content.replace(
        new RegExp(`^####\\s+(${ch}\\.\\s*${kw})`, "gm"),
        "### $1",
      );
    }
  }
  return content;
}

function autofixTemplateResidue(content: string): string {
  const templateKeywords = ["Fill in here", "Example:", "Template notes", "Placeholder check"];
  return content
    .split(/(?<=\n)/)
    .filter((line) => {
      const s = line.trim();
      return !(s.startsWith(">") && templateKeywords.some((kw) => s.includes(kw)));
    })
    .join("");
}

const AUTOFIX_HANDLERS: Record<string, (c: string) => string> = {
  "table.construction_empty": autofixConstructionColumn,
  "chapter.level": autofixChapterLevel,
  "residue.template": autofixTemplateResidue,
};

function lintFile(
  mdPath: string,
  jsonDir?: string | null,
  rules?: string[] | null,
  resolvedPath?: string | null,
): [Finding[], Ctx] {
  mdPath = path.resolve(mdPath);
  const caseName = mdPath.endsWith(".md")
    ? path.basename(mdPath).slice(0, -3)
    : path.basename(mdPath);
  const content = fs.readFileSync(mdPath, "utf8");
  const [, fm] = parseFrontmatter(content);
  const caseType = fm.caseType || "";
  if (jsonDir == null) {
    jsonDir = path.join(path.dirname(path.dirname(mdPath)), "case-json");
  }
  const jsonPath = caseType === "SERVER" ? path.join(jsonDir, `${caseName}.json`) : null;
  const ctx: Ctx = {
    case_name: caseName,
    case_type: caseType,
    md_path: mdPath,
    json_path: jsonPath,
    resolved_path: findResolvedPath(mdPath, resolvedPath),
  };

  let rulesToRun: string[];
  if (rules && rules.length) {
    rulesToRun = [];
    for (let r of rules) {
      r = r.trim();
      if (r in ALL_RULES) rulesToRun.push(r);
      else {
        rulesToRun.push(
          ...Object.keys(ALL_RULES).filter((k) => k.startsWith(`${r}.`) || k === r),
        );
      }
    }
    rulesToRun = [...new Set(rulesToRun)];
  } else {
    rulesToRun = Object.keys(ALL_RULES);
  }

  const findings: Finding[] = [];
  for (const topic of rulesToRun) {
    const fn = ALL_RULES[topic];
    if (!fn) continue;
    try {
      findings.push(...fn(content, ctx));
    } catch (e) {
      findings.push(
        makeFinding(topic, {
          issueDetail: `rule execution error: ${e}`,
          fixAction: "Check the script implementation",
        }),
      );
    }
  }
  return [findings, ctx];
}

function autofixFile(mdPath: string, findings: Finding[]): string[] {
  const autofixTopics = findings.filter((f) => f.autofix).map((f) => f.topic);
  if (!autofixTopics.length) return [];
  let content = fs.readFileSync(mdPath, "utf8");
  const fixed: string[] = [];
  for (const topic of autofixTopics) {
    const handler = AUTOFIX_HANDLERS[topic];
    if (!handler) continue;
    const next = handler(content);
    if (next !== content) {
      content = next;
      fixed.push(topic);
    }
  }
  if (fixed.length) fs.writeFileSync(mdPath, content, "utf8");
  return fixed;
}

function walkMd(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (!fs.existsSync(cur)) continue;
    for (const name of fs.readdirSync(cur)) {
      if (name === "__MACOSX" || name === ".DS_Store" || name.startsWith("._")) continue;
      const p = path.join(cur, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile() && p.endsWith(".md") && !p.includes("case-json")) out.push(p);
    }
  }
  return out;
}

function main(): number {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      file: { type: "string" },
      dir: { type: "string" },
      "json-dir": { type: "string" },
      fix: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      rules: { type: "string" },
      resolved: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`usage: lint_case_documents.ts [-h] [--file FILE] [--dir DIR] [--json-dir JSON_DIR]
                            [--fix] [--json] [--rules RULES] [--resolved RESOLVED]

Case rule engine

options:
  -h, --help            show this help message and exit
  --file FILE           path to a single case Markdown file
  --dir DIR             case directory (recursive .md scan)
  --json-dir JSON_DIR   case JSON directory (optional)
  --fix                 autofix in place for rules that support it
  --json                emit findings as JSON
  --rules RULES         comma-separated rule prefix filter
  --resolved RESOLVED   path to integrations-resolved.json`);
    return 0;
  }
  if (!values.file && !values.dir) {
    console.error("must specify --file or --dir");
    return 2;
  }
  const rules = values.rules ? values.rules.split(",").map((r) => r.trim()) : null;
  let targets: string[] = [];
  if (values.file) targets = [values.file];
  else if (values.dir) targets = walkMd(values.dir);

  const allResults: {
    file: string;
    caseName: string;
    caseType: string;
    findings: Finding[];
    fixed?: string[];
  }[] = [];
  let totalFindings = 0;
  let totalFixed = 0;
  for (const mdPath of targets) {
    const [findings, ctx] = lintFile(mdPath, values["json-dir"], rules, values.resolved);
    const result: (typeof allResults)[number] = {
      file: mdPath,
      caseName: ctx.case_name,
      caseType: ctx.case_type,
      findings,
    };
    if (values.fix && findings.length) {
      const fixedRules = autofixFile(mdPath, findings);
      result.fixed = fixedRules;
      totalFixed += fixedRules.length;
    }
    allResults.push(result);
    totalFindings += findings.length;
  }

  if (values.json) {
    console.log(JSON.stringify(allResults, null, 2));
  } else {
    const topicCounter = new Map<string, number>();
    console.log("=== Lint results ===");
    console.log(`files scanned: ${targets.length}`);
    console.log(`findings: ${totalFindings}`);
    if (values.fix) console.log(`autofixed: ${totalFixed}`);
    for (const result of allResults) {
      if (!result.findings.length) continue;
      console.log(`\n[${result.caseName}]`);
      for (const f of result.findings) {
        topicCounter.set(f.topic, (topicCounter.get(f.topic) || 0) + 1);
        const tag = f.autofix ? "[autofix]" : "";
        console.log(`  ${f.topic} ${tag} ${f.issueDetail.slice(0, 120)}`);
      }
    }
    if (topicCounter.size) {
      console.log("\nrule hit counts:");
      for (const topic of [...topicCounter.keys()].sort()) {
        console.log(`  ${topic}: ${topicCounter.get(topic)}`);
      }
    }
  }
  return totalFindings === 0 ? 0 : 1;
}

process.exit(main());
