import { writeFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PARSERS, detectFormat } from "./common_parser.ts";
import { isDirectRun, readText, takeFlag } from "./office_io.ts";

const SMELL_LEXICON: Record<string, string[]> = {
  vague: [
    "适当",
    "合理",
    "尽快",
    "及时",
    "相关",
    "若干",
    "良好",
    "优化",
    "可能",
    "appropriate",
    "reasonable",
    "soon",
    "promptly",
    "relevant",
    "several",
    "optimize",
    "maybe",
  ],
  optional: ["可以", "尽量", "建议", "宜", "may", "optionally", "try to"],
  subjective: [
    "友好",
    "易用",
    "美观",
    "体验好",
    "流畅",
    "较好",
    "user-friendly",
    "easy",
    "intuitive",
    "nice",
    "smooth",
    "better",
  ],
  loophole: [
    "必要时",
    "视情况",
    "原则上",
    "如需要",
    "as needed",
    "as appropriate",
    "if necessary",
    "in principle",
  ],
  unbounded: ["所有", "任何", "永远", "从不", "全部", "all", "always", "never", "every"],
  compound: ["并且同时", "以及还要", "and also", "as well as"],
  tbd: ["待定", "待确认", "后续确认", "tbd", "tbc", "to be decided"],
};

const KPI_KEYWORDS: Record<string, string[]> = {
  north_star: ["北极星", "核心指标", "成功指标", "kpi", "north-star", "north star"],
  numeric_target: ["%", "百分之", "提升", "下降", "threshold", "target", "slo"],
  data_source: ["埋点", "数仓", "统计", "数据来源", "event", "warehouse", "telemetry"],
  time_window: ["上线后", "30 天", "30天", "一周", "基线", "window", "baseline"],
  negative_metric: ["不损害", "护栏", "负向", "回退", "guardrail", "regression"],
};

const DEPENDENCY_KEYWORDS: Record<string, string[]> = {
  upstream: ["上游", "依赖", "对接", "第三方", "upstream", "depends on", "third-party"],
  downstream: ["下游", "影响面", "downstream", "blast radius"],
  data_tracking: ["埋点", "数仓", "tracking", "analytics"],
  sequence: ["先后", "先上", "后再", "顺序", "sequence", "before", "after launch"],
  owner_ready: ["负责人", "owner", "就绪", "ready date", "eta"],
};

const NFR_GRID_KEYWORDS: Record<string, string[]> = {
  functional_suitability: ["功能", "验收", "正确", "完整", "acceptance", "correctness"],
  reliability: ["可靠", "容灾", "恢复", "重试", "可用性", "reliability", "retry", "failover", "availability"],
  performance_efficiency: ["性能", "并发", "吞吐", "响应时间", "qps", "latency", "throughput", "sla"],
  usability: ["易用", "可用性体验", "无障碍", "usability", "accessible", "ux"],
  security: ["安全", "权限", "认证", "授权", "审计", "加密", "security", "auth", "audit"],
  compatibility: ["兼容", "浏览器", "对接", "版本", "compatibility", "browser"],
  maintainability: ["可维护", "日志", "配置", "可观测", "maintainability", "logging", "observability"],
  portability: ["移植", "多端", "环境", "portability", "platform"],
};

function extractRequirementPoints(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const patterns = [
    /(必须|需要|应当|should|must|required)/i,
    /(支持|实现|校验|验证|限制|规则|流程|状态|接口|性能|安全)/,
  ];
  const points: string[] = [];
  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) points.push(line);
  }
  return points.slice(0, 40);
}

function extractHits(
  text: string,
  lexicon: Record<string, string[]>,
  limit: number,
): Record<string, string[]> {
  const hits: Record<string, string[]> = {};
  for (const key of Object.keys(lexicon)) hits[key] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const [category, signals] of Object.entries(lexicon)) {
      if (signals.some((signal) => lower.includes(signal.toLowerCase()))) {
        if (!hits[category].includes(line) && hits[category].length < limit) {
          hits[category].push(line);
        }
      }
    }
  }
  return hits;
}

function buildPrepass(promptText: string, sourceText: string, sourcePath: string, fmt: string): string {
  const requirementPoints = extractRequirementPoints(sourceText);
  const smells = extractHits(sourceText, SMELL_LEXICON, 8);
  const nfrHits = extractHits(sourceText, NFR_GRID_KEYWORDS, 6);
  const kpiHits = extractHits(sourceText, KPI_KEYWORDS, 4);
  const depHits = extractHits(sourceText, DEPENDENCY_KEYWORDS, 4);

  let summary = sourceText.slice(0, 600).replace(/\n/g, " ").trim();
  if (summary.length > 300) summary = `${summary.slice(0, 297)}...`;

  const lines = [
    "# Requirements Analyzer Pre-pass",
    "",
    "> Rule-based extract only. Feed these hits into the skill-prompt scans.",
    "> This is **not** the final 7-section register. Do not treat keyword hits as specified-measurable.",
    "",
    "## Context",
    `- Source file: \`${sourcePath}\``,
    `- Detected format: \`${fmt}\``,
    "",
    "## Requirement Summary",
    `- ${summary || "No summary extracted."}`,
    "",
    "## Functional Requirement Points",
  ];
  if (requirementPoints.length) {
    lines.push(...requirementPoints.map((point) => `- ${point}`));
  } else {
    lines.push("- No explicit functional point extracted.");
  }
  lines.push("", "## Smell Hits by Category");
  let anySmell = false;
  for (const [category, items] of Object.entries(smells)) {
    if (!items.length) continue;
    anySmell = true;
    lines.push(`- \`${category}\`:`);
    lines.push(...items.map((item) => `  - ${item}`));
  }
  if (!anySmell) {
    lines.push("- No categorized smell signals detected by rule-based checks.");
  }
  lines.push("", "## NFR Keyword Hits (ISO 25010)");
  lines.push(
    "- Keyword presence only. The LLM must still mark specified-measurable / specified-vague / missing / not-applicable.",
  );
  for (const [characteristic, items] of Object.entries(nfrHits)) {
    if (items.length) {
      lines.push(`- \`${characteristic}\`:`);
      lines.push(...items.map((item) => `  - ${item}`));
    } else {
      lines.push(`- \`${characteristic}\`: no keyword hit`);
    }
  }
  lines.push("", "## Success-Metric Keyword Hits");
  lines.push("- Keyword presence only. The LLM must still fill the success-metrics grid; do not treat a hit as a quantified KPI.");
  for (const [cell, items] of Object.entries(kpiHits)) {
    if (items.length) {
      lines.push(`- \`${cell}\`:`);
      lines.push(...items.map((item) => `  - ${item}`));
    } else {
      lines.push(`- \`${cell}\`: no keyword hit`);
    }
  }
  lines.push("", "## Dependency Keyword Hits");
  lines.push("- Keyword presence only. The LLM must still fill the dependency grid; a hit is not an owner+ready date.");
  for (const [cell, items] of Object.entries(depHits)) {
    if (items.length) {
      lines.push(`- \`${cell}\`:`);
      lines.push(...items.map((item) => `  - ${item}`));
    } else {
      lines.push(`- \`${cell}\`: no keyword hit`);
    }
  }
  lines.push("", "## Suggested Intake Classes");
  lines.push("- Scope / Behavior / Constraint / Plan / Risk — classify before the register.");
  lines.push("", "## Prompt Used", "```text", promptText.trim(), "```", "");
  return lines.join("\n");
}

export function runAnalysis(argvIn: string[]): string {
  const argv = [...argvIn];
  const input = takeFlag(argv, "--input");
  const format = takeFlag(argv, "--format") ?? "auto";
  const output = takeFlag(argv, "--output");
  const prompt =
    takeFlag(argv, "--prompt") ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "requirements-analyzer.md");
  if (!input) {
    throw new Error("usage: run_analysis.ts --input <file> [--format auto] [--output path] [--prompt path]");
  }
  const allowed = ["auto", "word", "html", "json", "markdown", "excel"];
  if (!allowed.includes(format)) {
    throw new Error(`unsupported --format: ${format}`);
  }
  const fmt = format === "auto" ? detectFormat(input) : format;
  const parserFn = PARSERS[fmt];
  if (!parserFn) throw new Error(`no parser for format: ${fmt}`);
  const parsedText = parserFn(resolve(input));
  const promptText = readText(resolve(prompt));
  const analysis = buildPrepass(promptText, parsedText, input, fmt);
  const parsed = parsePath(resolve(input));
  const out = output ? resolve(output) : join(parsed.dir, `${parsed.name}.analysis.md`);
  writeFileSync(out, analysis, "utf8");
  return out;
}

if (isDirectRun(import.meta.url)) {
  try {
    console.log(runAnalysis(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
