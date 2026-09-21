#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { arg, parse_args, type SubSpec } from "./cli_args.ts";
import { ensure_binary } from "./ensure_codexqa.ts";
import { parse_exception } from "./parse_exception.ts";
import { analyze_frames, analysis_brief, ensure_index } from "./query_graph.ts";
import { persist_draft, agent_protocol, story_gaps, split_first_paragraphs } from "./draft_report.ts";
import { validate_report, write_report } from "./report.ts";
import { materialize_for_codexqa, origin_from_inputs } from "./materialize_repo.ts";
import { resolve_repo } from "./resolve_repo.ts";
import { elapsed_ms, push_timing, set_wall_ms } from "./timing.ts";
import {
  analysis_path,
  brief_path,
  facts_path,
  read_json,
  read_meta,
  require_task_id,
  task_dir,
  write_json,
  write_meta,
  next_task_id,
} from "./store.ts";

const DESCRIPTION = "Root Cause Diagnosis — exception RCA on top of CodexQA CLI analysis";

const SUBS: SubSpec[] = [
  {
    name: "submit",
    help: "Create a task from exception evidence and a git/local repo",
    args: [
      arg("--exception", { help: "Exception text" }),
      arg("--exception-file", { help: "Path to exception text file" }),
      arg("--git", { help: "Git URL or existing local path" }),
      arg("--branch", { help: "Git branch" }),
      arg("--dir", { help: "Local / already-open workspace directory" }),
      arg("--file", { help: "Uploaded business source file (non-git OK)" }),
      arg("--with-index", { help: "Run ensure-codexqa after submit", storeTrue: true }),
      arg("--with-analyze", { help: "Index and analyze frames in this process", storeTrue: true }),
    ],
  },
  {
    name: "ensure-codexqa",
    help: "Install CodexQA CLI if needed and index the repo",
    args: [
      arg("--task-id", { required: true, type: "int", help: "Task id" }),
      arg("--force-install", { storeTrue: true, help: "Reinstall @openqa-cn/codexqa" }),
      arg("--force-reindex", { storeTrue: true, help: "Force CodexQA --full reindex" }),
      arg("--local-dir", { help: "Override repo directory" }),
      arg("--with-analyze", { storeTrue: true, help: "Run analyze-frames after index" }),
    ],
  },
  {
    name: "parse-exception",
    help: "Parse stored exception evidence into frames",
    args: [
      arg("--task-id", { required: true, type: "int" }),
      arg("--force", { storeTrue: true, help: "Re-parse even if parsed.json exists" }),
    ],
  },
  {
    name: "analyze-frames",
    help: "Query CodexQA for each app frame and persist analysis.json",
    args: [arg("--task-id", { required: true, type: "int" })],
  },
  {
    name: "status",
    help: "Show task meta and CodexQA ready flag",
    args: [arg("--task-id", { required: true, type: "int" })],
  },
  {
    name: "run",
    help: "submit + index + analyze in one process",
    args: [
      arg("--exception", { help: "Exception text" }),
      arg("--exception-file", { help: "Path to exception text file" }),
      arg("--git", { help: "Git URL or existing local path" }),
      arg("--branch", { help: "Git branch" }),
      arg("--dir", { help: "Local / already-open workspace directory" }),
      arg("--file", { help: "Uploaded business source file (non-git OK)" }),
    ],
  },
  {
    name: "draft-report",
    help: "Extract facts.json + heading skeleton; Agent fills narrative; CLI validates",
    args: [arg("--task-id", { required: true, type: "int" })],
  },
  {
    name: "write-report",
    help: "Persist the English Markdown report",
    args: [
      arg("--task-id", { required: true, type: "int" }),
      arg("--markdown", { help: "Report Markdown text" }),
      arg("--report-file", { help: "Path to report Markdown file" }),
      arg("--from-draft", { storeTrue: true, help: "Use data/<id>/report.draft.md" }),
    ],
  },
];

function compact_codexqa_result(result: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!result) return null;
  const analyzed = result.analyzed;
  return {
    ready: !!result.ready,
    analysisPath: result.analysisPath || null,
    error: result.analysis?.error || result.error || null,
    install: result.install || null,
    methodCount: analyzed ? Object.keys(analyzed.methods || {}).length : undefined,
    queryStats: analyzed?.queryStats || null,
  };
}

function cli_ok(payload: Record<string, any>, message?: string): void {
  console.log(JSON.stringify({ ok: true, ...payload, message: message || "ok" }, null, 2));
}

function cli_fail(error: string, extra: Record<string, any> = {}, code = 1): never {
  console.log(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(code);
}

function read_exception_text(flags: Record<string, any>): string {
  if (flags.exception_file) {
    if (!existsSync(flags.exception_file)) {
      throw new Error(`--exception-file not found: ${flags.exception_file}`);
    }
    return readFileSync(flags.exception_file, "utf8");
  }
  if (flags.exception != null && String(flags.exception).trim()) {
    return String(flags.exception);
  }
  throw new Error("provide --exception or --exception-file");
}

function load_parsed(task_id: number) {
  const path = join(task_dir(task_id), "parsed.json");
  const parsed = read_json(path, null);
  if (!parsed) throw new Error("parsed.json missing; run parse-exception");
  return parsed;
}

function cmd_submit(flags: Record<string, any>): Promise<void> | void {
  const started = Date.now();
  const text = read_exception_text(flags);
  const task_id = next_task_id();
  const dir = task_dir(task_id);
  const exceptionPath = join(dir, "exception.txt");
  writeFileSync(exceptionPath, text, "utf8");

  const parseStarted = Date.now();
  const parsed = parse_exception(text);
  write_json(join(dir, "parsed.json"), parsed);
  const parseMs = elapsed_ms(parseStarted);

  const cloneDir = join(dir, "repo");
  let originDir: string | null = null;
  let uploadedFile: string | null = null;
  let repo: Record<string, any>;
  const cloneStarted = Date.now();

  if (flags.git && !looks_like_existing_path(flags.git) && !flags.file && !flags.dir) {
    repo = resolve_repo({
      git: flags.git,
      branch: flags.branch,
      dir: null,
      cloneDir,
    });
    originDir = repo.localDir;
  } else {
    const origin = origin_from_inputs({
      file: flags.file,
      dir: flags.dir || (looks_like_existing_path(flags.git) ? flags.git : null),
    });
    originDir = origin.originDir;
    uploadedFile = origin.uploadedFile;
    const mat = materialize_for_codexqa({
      dest: cloneDir,
      originDir: origin.originDir,
      uploadedFile: origin.uploadedFile,
      frames: parsed.appFrames || parsed.frames,
    });
    repo = {
      localDir: mat.localDir,
      cloned: false,
      gitUrl: flags.git || null,
      branch: flags.branch || (mat.materialized ? "main" : null),
      source: mat.source,
      materialized: mat.materialized,
      copiedFiles: mat.copiedFiles,
      originDir: mat.originDir,
    };
  }
  const cloneMs = elapsed_ms(cloneStarted);

  const meta: Record<string, any> = {
    taskId: task_id,
    createdAt: new Date().toISOString(),
    gitUrl: repo.gitUrl || null,
    branch: repo.branch || null,
    localDir: repo.localDir,
    originDir,
    uploadedFile,
    cloned: !!repo.cloned,
    materialized: !!repo.materialized,
    copiedFiles: repo.copiedFiles || [],
    source: repo.source,
    exceptionPath,
    parsedPath: join(dir, "parsed.json"),
    reportPath: null,
    reportEnPath: null,
    reportZhPath: null,
    timings: { steps: [] },
    codexqa: {
      attempted: false,
      ready: false,
      analysisPath: analysis_path(task_id),
      error: null,
    },
  };
  push_timing(meta, "parse_exception", parseMs, { frameCount: parsed.frames.length });
  push_timing(meta, "clone_or_materialize", cloneMs, { source: repo.source, cloned: !!repo.cloned });
  write_meta(task_id, meta);

  const finish = (indexed: any, analyzed: any) => {
    const extras = analyzed ? finalize_from_analysis(task_id, parsed, analyzed) : {};
    const latest = read_meta(task_id);
    set_wall_ms(latest, started);
    write_meta(task_id, latest);
    cli_ok(
      {
        taskId: task_id,
        localDir: repo.localDir,
        originDir,
        uploadedFile,
        source: repo.source,
        cloned: !!repo.cloned,
        materialized: !!repo.materialized,
        copiedFiles: repo.copiedFiles || [],
        parsed: {
          exceptionType: parsed.exceptionType,
          exceptionMessage: parsed.message,
          frameCount: parsed.frames.length,
          appFrameCount: parsed.appFrames.length,
          primaryFrame: parsed.primaryFrame,
        },
        codexqa: latest.codexqa,
        nextCli: extras.factsPath
          ? { cmd: "write-report", args: ["--task-id", String(task_id), "--from-draft"] }
          : latest.codexqa.ready
            ? analyzed
              ? { cmd: "draft-report", args: ["--task-id", String(task_id)] }
              : { cmd: "analyze-frames", args: ["--task-id", String(task_id)] }
            : { cmd: "ensure-codexqa", args: ["--task-id", String(task_id)] },
        indexed: compact_codexqa_result(indexed),
        analyzed: analyzed
          ? {
              analysisPath: analysis_path(task_id),
              briefPath: brief_path(task_id),
              methodCount: Object.keys(analyzed.methods || {}).length,
              queryStats: analyzed.queryStats || null,
              brief: analyzed.brief || analysis_brief(analyzed),
            }
          : null,
        timings: latest.timings,
        ...extras,
      },
      extras.factsPath
        ? "facts extracted; fill report.draft.md then write-report --from-draft"
        : "task submitted",
    );
  };

  if (flags.with_index || flags.with_analyze) {
    return cmd_ensure_codexqa_inner(task_id, {
      force_install: false,
      local_dir: repo.localDir,
      with_analyze: !!flags.with_analyze,
    }).then((indexed) => {
      finish(indexed, flags.with_analyze ? indexed.analyzed : null);
    });
  }
  finish(null, null);
}

function finalize_from_analysis(task_id: number, parsed: any, analyzed: any): Record<string, any> {
  const brief = analyzed.brief || analysis_brief(analyzed);
  const meta = read_meta(task_id);
  const draftStarted = Date.now();
  const draft = persist_draft(task_id, parsed, brief);
  push_timing(meta, "draft_report", elapsed_ms(draftStarted), {
    validated: draft.validated,
    storyGaps: draft.storyGaps || [],
  });
  meta.draftPath = draft.path;
  meta.factsPath = draft.factsPath;
  meta.draftValidated = draft.validated;
  write_meta(task_id, meta);
  return {
    draftPath: draft.path,
    factsPath: draft.factsPath,
    facts: draft.facts,
    draftValidated: draft.validated,
    overLimit: draft.overLimit,
    missingHeadings: draft.missingHeadings,
    storyGaps: draft.storyGaps,
    reportPath: meta.reportPath || null,
    reportEnPath: meta.reportEnPath || null,
    reportZhPath: meta.reportZhPath || null,
    chat: draft.chat,
    howToUse: "Fill report.draft.md from facts.json, then write-report --from-draft. Section 字 counts are prompt hints, not a hard reject.",
    agentProtocol: agent_protocol(task_id, draft.path, brief_path(task_id), draft.factsPath),
  };
}

function looks_like_existing_path(value: string): boolean {
  return !!(value && existsSync(String(value)) && !String(value).startsWith("git@") && !String(value).includes("://"));
}

async function cmd_ensure_codexqa_inner(task_id: number, flags: Record<string, any>): Promise<Record<string, any>> {
  const meta = read_meta(task_id);
  let localDir = flags.local_dir || meta.localDir;
  if (!localDir || !existsSync(localDir)) {
    throw new Error(`localDir missing: ${localDir}`);
  }

  const installStarted = Date.now();
  const installed = ensure_binary(!!flags.force_install);
  push_timing(meta, "codexqa_binary", elapsed_ms(installStarted), { ready: installed.ready });
  meta.codexqa = meta.codexqa || {};
  meta.codexqa.attempted = true;
  meta.codexqa.install = installed.install;
  meta.codexqa.binary = installed.binary;

  if (!installed.ready) {
    meta.codexqa.ready = false;
    meta.codexqa.error = installed.error || "codexqa CLI not ready";
    write_meta(task_id, meta);
    return { ready: false, install: installed, analysis: null };
  }

  const indexStarted = Date.now();
  let analysis = ensure_index(task_id, localDir, { full: !!flags.force_reindex });
  const errText = String(analysis.error || "");
  if (!analysis.ready && /not a git repository/i.test(errText) && meta.originDir) {
    const parsed = load_parsed(task_id);
    const mat = materialize_for_codexqa({
      dest: join(task_dir(task_id), "repo"),
      originDir: meta.originDir,
      uploadedFile: meta.uploadedFile,
      frames: parsed.appFrames || parsed.frames,
    });
    meta.localDir = mat.localDir;
    meta.materialized = mat.materialized;
    meta.copiedFiles = mat.copiedFiles;
    meta.source = mat.source;
    localDir = mat.localDir;
    analysis = ensure_index(task_id, localDir, { full: !!flags.force_reindex });
    meta.codexqa.rematerialized = true;
  }
  push_timing(meta, "codexqa_index", elapsed_ms(indexStarted), {
    ready: !!analysis.ready,
    full: !!flags.force_reindex,
  });

  meta.codexqa.ready = !!analysis.ready;
  meta.codexqa.error = analysis.error || null;
  meta.codexqa.analysisPath = analysis_path(task_id);
  write_meta(task_id, meta);

  let analyzed = null;
  if (flags.with_analyze && analysis.ready) {
    analyzed = await cmd_analyze_frames_inner(task_id);
  }

  return {
    ready: !!analysis.ready,
    install: installed,
    analysisPath: meta.codexqa.analysisPath,
    analysis,
    analyzed,
  };
}

async function cmd_ensure_codexqa(flags: Record<string, any>): Promise<void> {
  const started = Date.now();
  const task_id = require_task_id(flags);
  const result = await cmd_ensure_codexqa_inner(task_id, flags);
  const meta = read_meta(task_id);
  set_wall_ms(meta, started);
  write_meta(task_id, meta);
  const compact = compact_codexqa_result(result);
  if (!result.ready) {
    cli_ok(
      {
        taskId: task_id,
        ...compact,
        nextCli: { cmd: "ensure-codexqa", args: ["--task-id", String(task_id), "--force-install"] },
        degrade: "grep",
        timings: meta.timings,
      },
      "CodexQA not ready; Agent may retry --force-install once, then degrade to grep",
    );
    return;
  }
  const extras = result.analyzed ? finalize_from_analysis(task_id, load_parsed(task_id), result.analyzed) : {};
  cli_ok(
    {
      taskId: task_id,
      ...compact,
      nextCli: result.analyzed
        ? { cmd: "write-report", args: ["--task-id", String(task_id), "--from-draft"] }
        : { cmd: "analyze-frames", args: ["--task-id", String(task_id)] },
      timings: read_meta(task_id).timings,
      ...extras,
    },
    result.analyzed
      ? "facts extracted; fill report.draft.md then write-report --from-draft"
      : "CodexQA indexed",
  );
}

function cmd_parse_exception(flags: Record<string, any>): void {
  const task_id = require_task_id(flags);
  const started = Date.now();
  const meta = read_meta(task_id);
  const parsedPath = join(task_dir(task_id), "parsed.json");
  if (existsSync(parsedPath) && !flags.force) {
    const parsed = load_parsed(task_id);
    push_timing(meta, "parse_exception", elapsed_ms(started), { skipped: true });
    write_meta(task_id, meta);
    cli_ok(
      {
        taskId: task_id,
        parsedPath,
        skipped: true,
        exceptionType: parsed.exceptionType,
        exceptionMessage: parsed.message,
        frameCount: parsed.frames.length,
        appFrameCount: parsed.appFrames.length,
        primaryFrame: parsed.primaryFrame,
        timings: meta.timings,
      },
      "exception already parsed",
    );
    return;
  }
  const text = readFileSync(meta.exceptionPath, "utf8");
  const parsed = parse_exception(text);
  write_json(parsedPath, parsed);
  meta.parsedPath = parsedPath;
  push_timing(meta, "parse_exception", elapsed_ms(started));
  write_meta(task_id, meta);
  cli_ok(
    {
      taskId: task_id,
      parsedPath,
      exceptionType: parsed.exceptionType,
      exceptionMessage: parsed.message,
      causes: parsed.causes,
      frameCount: parsed.frames.length,
      appFrameCount: parsed.appFrames.length,
      primaryFrame: parsed.primaryFrame,
      language: parsed.language,
      timings: meta.timings,
    },
    "exception parsed",
  );
}

async function cmd_analyze_frames_inner(task_id: number): Promise<Record<string, any>> {
  const meta = read_meta(task_id);
  const parsed = load_parsed(task_id);
  const ready = !!meta.codexqa?.ready;
  const started = Date.now();
  const analysis = await analyze_frames(task_id, meta.localDir, parsed, ready);
  push_timing(meta, "analyze_frames", elapsed_ms(started), analysis.queryStats || {});
  write_meta(task_id, meta);
  return analysis;
}

async function cmd_analyze_frames(flags: Record<string, any>): Promise<void> {
  const started = Date.now();
  const task_id = require_task_id(flags);
  const parsed = load_parsed(task_id);
  const meta = read_meta(task_id);
  const ready = !!meta.codexqa?.ready;
  const analysis = await cmd_analyze_frames_inner(task_id);
  const latest = read_meta(task_id);
  set_wall_ms(latest, started);
  write_meta(task_id, latest);
  const extras = finalize_from_analysis(task_id, parsed, analysis);
  cli_ok(
    {
      taskId: task_id,
      analysisPath: analysis_path(task_id),
      briefPath: brief_path(task_id),
      ready,
      methodCount: Object.keys(analysis.methods || {}).length,
      appFrameCount: parsed.appFrames.length,
      queryStats: analysis.queryStats || null,
      brief: analysis.brief || analysis_brief(analysis),
      nextCli: { cmd: "write-report", args: ["--task-id", String(task_id), "--from-draft"] },
      timings: read_meta(task_id).timings,
      ...extras,
    },
    "facts extracted; fill report.draft.md then write-report --from-draft",
  );
}

function cmd_status(flags: Record<string, any>): void {
  const task_id = require_task_id(flags);
  const meta = read_meta(task_id);
  const analysis = read_json(analysis_path(task_id), null);
  const parsed = read_json(join(task_dir(task_id), "parsed.json"), null);
  cli_ok({
    taskId: task_id,
    meta,
    parsed: parsed
      ? {
          exceptionType: parsed.exceptionType,
          appFrameCount: parsed.appFrames?.length || 0,
          primaryFrame: parsed.primaryFrame,
        }
      : null,
    analysisReady: !!analysis?.ready,
    analysisPath: analysis ? analysis_path(task_id) : null,
    reportPath: meta.reportPath,
    reportEnPath: meta.reportEnPath,
    reportZhPath: meta.reportZhPath,
    timings: meta.timings,
  });
}

function cmd_draft_report(flags: Record<string, any>): void {
  const task_id = require_task_id(flags);
  const parsed = load_parsed(task_id);
  const analysis = read_json(analysis_path(task_id), {}) || {};
  const brief = analysis.brief || read_json(brief_path(task_id), []) || [];
  const extras = finalize_from_analysis(task_id, parsed, { brief });
  cli_ok(
    {
      taskId: task_id,
      ...extras,
      nextCli: { cmd: "write-report", args: ["--task-id", String(task_id), "--from-draft"] },
      timings: read_meta(task_id).timings,
    },
    "facts extracted; fill report.draft.md then write-report --from-draft",
  );
}

function cmd_write_report(flags: Record<string, any>): void {
  const task_id = require_task_id(flags);
  const meta = read_meta(task_id);
  let markdown = flags.markdown;
  if (flags.from_draft) {
    const draftPath = join(task_dir(task_id), "report.draft.md");
    if (!existsSync(draftPath)) throw new Error(`report.draft.md missing; run draft-report --task-id ${task_id}`);
    markdown = readFileSync(draftPath, "utf8");
  } else if (flags.report_file) {
    if (!existsSync(flags.report_file)) throw new Error(`--report-file not found: ${flags.report_file}`);
    markdown = readFileSync(flags.report_file, "utf8");
  }
  if (!markdown || !String(markdown).trim()) {
    throw new Error("provide --markdown, --report-file, or --from-draft");
  }
  const check = validate_report(String(markdown));
  if (!check.ok) {
    cli_fail("report rejected", {
      taskId: task_id,
      missingHeadings: check.missing,
      overLimit: check.overLimit,
    });
  }
  const facts = read_json(facts_path(task_id), null);
  const storyGaps = facts ? story_gaps(String(markdown), facts) : [];
  if (storyGaps.length) {
    cli_fail("report rejected", {
      taskId: task_id,
      missingHeadings: check.missing,
      overLimit: check.overLimit,
      storyGaps,
    });
  }
  const saved = write_report(task_id, String(markdown));
  meta.reportPath = saved.path;
  meta.reportEnPath = saved.enPath;
  meta.reportZhPath = saved.zhPath || null;
  meta.reportValidated = check.ok;
  meta.reportMissingHeadings = check.missing;
  meta.reportOverLimit = check.overLimit;
  meta.storyGaps = storyGaps;
  write_meta(task_id, meta);
  const chat = split_first_paragraphs(String(markdown));
  cli_ok(
    {
      taskId: task_id,
      reportPath: saved.path,
      reportEnPath: saved.enPath,
      reportZhPath: saved.zhPath || null,
      bytes: saved.bytes,
      validated: check.ok,
      missingHeadings: check.missing,
      overLimit: check.overLimit,
      storyGaps,
      chat,
    },
    "report written",
  );
}

const COMMANDS: Record<string, (flags: Record<string, any>) => void | Promise<void>> = {
  submit: cmd_submit,
  run: cmd_run,
  "ensure-codexqa": cmd_ensure_codexqa,
  "parse-exception": cmd_parse_exception,
  "analyze-frames": cmd_analyze_frames,
  status: cmd_status,
  "draft-report": cmd_draft_report,
  "write-report": cmd_write_report,
};

function cmd_run(flags: Record<string, any>): Promise<void> | void {
  return cmd_submit({ ...flags, with_index: true, with_analyze: true });
}

async function main(): Promise<void> {
  try {
    const { command, flags } = parse_args(process.argv.slice(2), DESCRIPTION, SUBS);
    await COMMANDS[command](flags);
  } catch (err: any) {
    cli_fail(String(err?.message || err));
  }
}

void main();
