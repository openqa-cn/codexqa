import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ParsedException, StackFrame } from "./parse_exception.ts";
import {
  EN_HEADINGS,
  body_char_count,
  extract_sections,
  fit_chars,
  validate_report,
} from "./report.ts";
import { facts_path, task_dir, write_json } from "./store.ts";

export type BriefItem = {
  key?: string;
  weak?: boolean;
  lineDrift?: boolean;
  hint?: string;
  callPath?: string;
  source?: { text?: string; startLine?: number; endLine?: number } | null;
  node?: { kind?: string; name?: string; file?: string; startLine?: number; endLine?: number } | null;
  frame?: StackFrame;
};

export type ExtractedBranch = { cond?: string; thenCall?: string; elseCall?: string };

export type ReportFacts = {
  exceptionType: string;
  exceptionTypeFull: string;
  messageGist: string;
  throwKey: string;
  throwWeak: boolean;
  rootKey: string | null;
  entry: string;
  hops: string[];
  branch: ExtractedBranch;
  lineDrift: string[];
  weakCount: number;
  swallowKey: string | null;
  /** True only when exception text or indexed source shows contention/deadlock/race signals. */
  raceEvidence: boolean;
  confidence: "high" | "medium";
  evidenceGaps: string[];
  mustCite: { mapped: string[]; root: string[]; trigger: string[] };
};

export type DraftResult = {
  markdown: string;
  path: string;
  factsPath: string;
  facts: ReportFacts;
  validated: boolean;
  overLimit: { heading: string; chars: number; limit: number }[];
  missingHeadings: string[];
  storyGaps: string[];
  chat: { en: string; zh: string };
};

const SKIP_CALLS = new Set(["if", "for", "while", "switch", "catch", "log", "info", "error", "warn", "debug"]);

function short_key(frame: StackFrame | null | undefined): string {
  if (!frame) return "unknown";
  if (frame.key) return frame.line ? `${frame.key}:${frame.line}` : frame.key;
  const cls = frame.className?.split(".").pop() || frame.file || "unknown";
  if (frame.methodName) return `${cls}#${frame.methodName}`;
  return cls;
}

function short_type(type: string | null | undefined): string {
  return String(type || "Error").split(".").pop() || "Error";
}

const GIST_FAIL = /\b(?:read\s+timed\s+out|timed?\s*out|timeout|deadlock)\b/i;
const GIST_INVOKE = /invoke\([^)]+\)/i;

/** Truncate a message without splitting on `.` inside IPs/hosts. Do not rewrite by exception class. */
export function gist(text: string | null | undefined, n = 48): string {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "");
  t = t.replace(/\bremote\s*\(\s*\)/gi, "");
  t = t.replace(/\(\s*\)/g, "");
  t = t.replace(/\s+/g, " ").trim();
  const named = t.match(/^(?:[\w.$]+:\s*)?(.{1,200}?)(?:\.\s|$)/);
  if (named) t = named[1];
  const invoke = t.match(GIST_INVOKE)?.[0];
  const fail = t.match(GIST_FAIL)?.[0];
  if (invoke && fail) {
    const core = `${invoke} ${fail}`;
    if (body_char_count(core) <= n) return core;
  }
  let out = fit_chars(t, n);
  if (fail && !out.toLowerCase().includes(fail.toLowerCase())) {
    const room = n - body_char_count(fail) - 1;
    const prefix = room > 0 ? fit_chars(t, room) : "";
    out = [prefix, fail].filter(Boolean).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function close_pair(s: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === openCh) depth += 1;
    else if (s[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function brace_block(s: string): { body: string; rest: string } | null {
  const open = s.indexOf("{");
  if (open < 0) return null;
  const close = close_pair(s, open, "{", "}");
  if (close < 0) return null;
  return { body: s.slice(open + 1, close), rest: s.slice(close + 1) };
}

function skip_call_name(name: string): boolean {
  return SKIP_CALLS.has(name) || /^is[A-Z]/.test(name);
}

function first_method_call(block: string): string | undefined {
  for (const m of block.matchAll(/\.([A-Za-z_]\w+)\s*\(/g)) {
    if (!skip_call_name(m[1])) return m[1];
  }
  for (const m of block.matchAll(/\b([A-Za-z_]\w+)\s*\(/g)) {
    if (!skip_call_name(m[1])) return m[1];
  }
  return undefined;
}

function short_cond(cond: string): string {
  const flag = cond.match(/\b(is[A-Z]\w*)\s*\(\s*([\w.]+)/);
  if (flag) return `${flag[1]}(${flag[2].split(".").pop()})`;
  return gist(cond, 48);
}

/** Nested `if (cond) { a } else { b }`, including if-return then continue. */
export function extract_branch(sourceText: string | undefined): ExtractedBranch {
  const t = String(sourceText || "");
  const ifAt = t.search(/\bif\s*\(/);
  if (ifAt < 0) return {};
  const open = t.indexOf("(", ifAt);
  const close = close_pair(t, open, "(", ")");
  if (close < 0) return {};
  const condRaw = t.slice(open + 1, close).replace(/\s+/g, " ").trim();
  const thenBlk = brace_block(t.slice(close + 1));
  if (!thenBlk) return {};
  let elseCall: string | undefined;
  const elseRest = thenBlk.rest.replace(/^\s*else\b/, "");
  if (elseRest !== thenBlk.rest) {
    const elseBlk = brace_block(elseRest);
    elseCall = elseBlk ? first_method_call(elseBlk.body) : undefined;
  } else {
    elseCall = first_method_call(thenBlk.rest);
  }
  let thenCall = first_method_call(thenBlk.body);
  if (!thenCall && /return\b/.test(thenBlk.body)) thenCall = "return";
  return {
    cond: short_cond(condRaw),
    thenCall,
    elseCall,
  };
}

function inbound_method(brief: BriefItem[]): string {
  for (const item of [...brief].reverse()) {
    const m = String(item.callPath || "").match(/::(\w+)\(L\d+\)→/);
    if (m) return m[1];
  }
  return "";
}

function entry_label(parsed: ParsedException, brief: BriefItem[]): string {
  const apps = (parsed.appFrames || []).filter((f) => !f.library);
  const inbound = inbound_method(brief);
  if (inbound) {
    const match = [...apps].reverse().find((f) => f.methodName === inbound);
    if (match) return short_key(match);
  }
  let lastMethodIdx = -1;
  for (let i = 0; i < apps.length; i++) {
    if (apps[i].methodName) lastMethodIdx = i;
  }
  const next = lastMethodIdx >= 0 ? apps[lastMethodIdx + 1] : undefined;
  const cls = next?.className?.split(".").pop();
  if (inbound && cls && !next?.methodName) return `${cls}#${inbound}`;
  const withMethod = [...apps].reverse().find((f) => f.methodName);
  return short_key(withMethod || apps[apps.length - 1] || parsed.primaryFrame);
}

function drift_notes(brief: BriefItem[]): string[] {
  return brief
    .filter((b) => b.lineDrift)
    .map((b) => {
      const hint = String(b.hint || "");
      const m = hint.match(/stack line (\d+) is outside (\d[\d-]*)/);
      return m ? `${b.key}:${m[1]} vs ${m[2]}` : `${b.key} lineDrift`;
    })
    .slice(0, 2);
}

function hop_keys(parsed: ParsedException, brief: BriefItem[]): string[] {
  const apps = (parsed.appFrames || []).filter((f) => !f.library && f.methodName);
  const byKey = new Map(brief.map((b) => [b.key || "", b]));
  return apps
    .filter((f) => {
      const item = byKey.get(f.key || "");
      return !item?.weak;
    })
    .slice()
    .reverse()
    .map((f) => short_key(f));
}

function unique_cite(parts: (string | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const s = String(p || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

const EMPTY_RETURN =
  /return\s+(?:Collections\.empty\w*\s*\(|Optional\.empty\s*\(|List\.of\s*\(\s*\)|null\b|false\b|None\b|\[\s*\]|\{\s*\})/;

export function extract_swallow(sourceText: string | undefined): boolean {
  const t = String(sourceText || "");
  let pos = 0;
  let lastCatchRest = "";
  while (pos < t.length) {
    const rel = t.slice(pos).search(/\bcatch\s*\(/);
    if (rel < 0) break;
    const abs = pos + rel;
    const parenOpen = t.indexOf("(", abs);
    const parenClose = close_pair(t, parenOpen, "(", ")");
    if (parenClose < 0) break;
    const blk = brace_block(t.slice(parenClose + 1));
    if (!blk) break;
    if (!/\bthrow\b/.test(blk.body) && EMPTY_RETURN.test(blk.body)) return true;
    lastCatchRest = blk.rest;
    pos = t.length - blk.rest.length;
    if (pos <= abs) break;
  }
  if (!lastCatchRest) return false;
  return EMPTY_RETURN.test(lastCatchRest) && !/\bthrow\b/.test(lastCatchRest);
}

function in_repo_root(brief: BriefItem[]): BriefItem | null {
  return brief.find((b) => b.source?.text && !b.weak) || brief.find((b) => b.source?.text) || null;
}

function swallow_key(brief: BriefItem[]): string | null {
  const item = brief.find((b) => extract_swallow(b.source?.text));
  return item?.key || null;
}

/** Exception / type / message signals that justify race/contend language in Root cause. */
const RACE_EXCEPTION_RE =
  /\b(?:deadlock|lock\s*wait|race(?:d|s| condition)?|contend(?:ed|ing|s)?|ConcurrentModification|OptimisticLock|StaleObjectState|compareAndSet)\b/i;

/** Indexed source signals for lock/contention paths — not cache-miss nulls or generic concurrency types. */
const RACE_SOURCE_RE =
  /\b(?:synchronized|ReentrantLock|ReadWriteLock|StampedLock|CountDownLatch|CyclicBarrier|deadlock|race\s*condition)\b/i;

/**
 * Mechanical race evidence from the exception and brief sources only.
 * Do not treat comments, cache-miss nulls, or model prose as evidence.
 */
export function detect_race_evidence(parsed: ParsedException, brief: BriefItem[]): boolean {
  const exc = `${parsed.exceptionType || ""} ${parsed.message || ""}`;
  if (RACE_EXCEPTION_RE.test(exc)) return true;
  for (const item of brief || []) {
    if (RACE_SOURCE_RE.test(String(item.source?.text || ""))) return true;
  }
  return false;
}

export function extract_facts(parsed: ParsedException, brief: BriefItem[]): ReportFacts {
  const items = Array.isArray(brief) ? brief : [];
  const throwSite = parsed.primaryFrame;
  const root = in_repo_root(items);
  const branch = extract_branch(root?.source?.text);
  const hops = hop_keys(parsed, items);
  const lineDrift = drift_notes(items);
  const weakCount = items.filter((b) => b.weak).length;
  const throwKey = short_key(throwSite);
  const raceEvidence = detect_race_evidence(parsed, items);
  const evidenceGaps = [
    weakCount ? "external/weak frames" : "",
    lineDrift.length ? "stack vs indexed lineDrift" : "",
    !weakCount && !lineDrift.length ? "no runtime flags" : "",
  ].filter(Boolean);
  return {
    exceptionType: short_type(parsed.exceptionType),
    exceptionTypeFull: String(parsed.exceptionType || "Error"),
    messageGist: gist(parsed.message, 48),
    throwKey,
    throwWeak: !!(throwSite && items[0]?.weak),
    rootKey: root?.key || null,
    entry: entry_label(parsed, items),
    hops,
    branch,
    lineDrift,
    weakCount,
    swallowKey: swallow_key(items),
    raceEvidence,
    confidence: weakCount || lineDrift.length ? "medium" : "high",
    evidenceGaps,
    mustCite: {
      mapped: unique_cite([entry_label(parsed, items), ...hops, branch.thenCall, throwKey]),
      root: unique_cite([throwKey, root?.key || undefined, branch.elseCall]),
      trigger: unique_cite([throwKey]),
    },
  };
}

function section_body(markdown: string, heading: string): string {
  return extract_sections(markdown, EN_HEADINGS).find((s) => s.heading === heading)?.body || "";
}

function has_race(text: string): boolean {
  return /raced|contend|\brace[ds]?\b/i.test(text);
}

/** Catch-all empty/default swallow claims (not ordinary "returns null" facts). */
function has_swallow_claim(text: string): boolean {
  return (
    /\bswallows?\b/i.test(text) ||
    /\bcatch-all\b/i.test(text) ||
    /\bempty\s+catch\b/i.test(text) ||
    /Collections\.empty\w*/i.test(text) ||
    /Optional\.empty/i.test(text) ||
    /\bcatch\b[\s\S]{0,120}\breturn(?:s|ed)?\s+(?:null|\[\s*\]|\{\s*\})/i.test(text)
  );
}

/** Claims that stack vs index lineDrift is the uncertainty source. */
function has_line_drift_claim(text: string): boolean {
  return /line\s*drift|stack line \d+\s+is outside|outside\s+\d[\d-]*\b/i.test(text);
}

function has_weak_frame_claim(text: string): boolean {
  return /\bweak\s+frames?\b/i.test(text);
}

function confidence_level(summaryEn: string): "high" | "medium" | "low" | null {
  const m = summaryEn.match(/Confidence:\s*(high|medium|low)\b/i);
  if (!m) return null;
  return m[1].toLowerCase() as "high" | "medium" | "low";
}

/**
 * Mechanical 来龙去脉 checks on the English report. Does not prescribe exception-class wording.
 * Evidence-gated: only require optional narrative (race / swallow / hypothesis / weak) when facts
 * support it; reject inventing those claims without evidence.
 */
export function story_gaps(markdown: string, facts: ReportFacts): string[] {
  const gaps: string[] = [];
  const mappedEn = section_body(markdown, "## Mapped call path");
  const rootEn = section_body(markdown, "## Root cause");
  const summaryEn = section_body(markdown, "## Executive summary");
  const triggerEn = section_body(markdown, "## Trigger");
  const contributingEn = section_body(markdown, "## Contributing factors");
  const rootOrContrib = `${rootEn}\n${contributingEn}`;

  if (!mappedEn.trim()) gaps.push("mapped-empty");
  if (!rootEn.trim()) gaps.push("root-empty");
  if (!/Confidence:/i.test(summaryEn)) gaps.push("missing-confidence");

  const statedConf = confidence_level(summaryEn);
  // Do not allow Confidence: high when facts already downgraded to medium (weak frames / lineDrift).
  if (facts.confidence === "medium" && statedConf === "high") {
    gaps.push("confidence-overstated");
  }

  const thenCall = facts.branch?.thenCall;
  if (thenCall && !mappedEn.includes(thenCall)) gaps.push("mapped-missing-branch-then");
  const elseCall = facts.branch?.elseCall;
  if (elseCall && !rootEn.includes(elseCall)) gaps.push("root-missing-branch-else");
  const throwCls = facts.throwKey ? facts.throwKey.split("#")[0] : "";
  if (throwCls && !mappedEn.includes(throwCls)) gaps.push("mapped-missing-throw");
  if (throwCls && !rootEn.includes(throwCls)) gaps.push("root-missing-throw");
  if (throwCls && !triggerEn.includes(throwCls)) gaps.push("trigger-missing-throw");
  if (throwCls && !/not (?:the )?root/i.test(triggerEn)) gaps.push("trigger-missing-not-root");

  // Race: require only with evidence; invent without evidence → reject.
  if (facts.raceEvidence) {
    if (!has_race(rootEn)) gaps.push("root-missing-race");
  } else if (rootEn.trim() && has_race(rootEn)) {
    gaps.push("root-invented-race");
  }

  // Swallow: cite extracted swallowKey when present; invent swallow without evidence → reject.
  if (facts.swallowKey) {
    if (!rootOrContrib.includes(facts.swallowKey) && !has_swallow_claim(rootOrContrib)) {
      gaps.push("contributing-missing-swallow");
    }
  } else if ((rootEn.trim() || contributingEn.trim()) && has_swallow_claim(rootOrContrib)) {
    gaps.push("contributing-invented-swallow");
  }

  // Hypothesis / lineDrift: require hypothesis when drift notes exist; do not invent drift claims.
  if (facts.lineDrift?.length) {
    if (!/hypothesis/i.test(rootEn)) gaps.push("root-missing-hypothesis-on-drift");
  } else if (rootEn.trim() && has_line_drift_claim(rootEn)) {
    gaps.push("root-invented-line-drift");
  }

  // Weak frames: do not invent "weak frame" labels when facts.weakCount is 0.
  if (!(facts.weakCount > 0) && mappedEn.trim() && has_weak_frame_claim(mappedEn)) {
    gaps.push("mapped-invented-weak");
  }

  return gaps;
}

/** First-level English headings only. Section bodies are empty for the model to fill. */
export function build_skeleton_markdown(): string {
  return `${EN_HEADINGS.join("\n\n")}\n`;
}

export function persist_draft(task_id: number, parsed: ParsedException, brief: BriefItem[]): DraftResult {
  const facts = extract_facts(parsed, brief);
  const markdown = build_skeleton_markdown();
  const check = validate_report(markdown);
  const gaps = story_gaps(markdown, facts);
  const path = join(task_dir(task_id), "report.draft.md");
  const factsFile = facts_path(task_id);
  write_json(factsFile, facts);
  writeFileSync(path, markdown.trim() + "\n", "utf8");
  return {
    markdown,
    path,
    factsPath: factsFile,
    facts,
    validated: check.ok && gaps.length === 0,
    overLimit: check.overLimit,
    missingHeadings: check.missing,
    storyGaps: gaps,
    chat: { en: "", zh: "" },
  };
}

export function split_first_paragraphs(markdown: string): { en: string; zh: string } {
  const en = markdown.match(/## Executive summary\n([^\n]+)/)?.[1]?.trim() || "";
  return { en, zh: "" };
}

export function agent_protocol(
  task_id: number,
  draftPath: string,
  briefPath: string,
  factsFile: string,
): Record<string, unknown> {
  return {
    role: "CLI extracts facts and validates; the model writes the narrative.",
    next: [
      `Fill ${draftPath} section bodies from ${factsFile} (keep the eight English headings; write the call-path story; treat section 字 counts as prompt hints, not a hard reject; do not copy facts as slogans).`,
      `node scripts/diagnose.ts write-report --task-id ${task_id} --from-draft`,
    ],
    doNot: [
      "--help",
      "read analysis.json",
      "load other skills",
      "invent Class#method:1 for → Class tails",
      "invent race/contend without facts.raceEvidence=true",
      "invent swallow/catch-all without facts.swallowKey",
      "invent lineDrift or weak-frame claims without facts",
      "write Confidence: high when facts.confidence is medium",
      "count 字 with python",
      "trim the draft to a hard 字 cap",
      "open 600-line classes",
      "load references/ when brief/facts exist",
    ],
    encodeDefectsInTs:
      "If a skill step is wrong, encode the rule in scripts/*.ts + tests before continuing RCA, unless only an LLM can decide it. Do not put exception-class fix wording in draft_report.ts.",
    briefPath,
    factsPath: factsFile,
    draftPath,
  };
}
