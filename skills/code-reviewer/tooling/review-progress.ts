#!/usr/bin/env node

/**
 * Code review progress tracking
 *
 * Purpose:
 *   - Persist review phases and intermediate findings to .review-progress.json
 *   - Recover progress from disk when context is truncated (large diffs / multi-phase / multi-agent)
 *   - The main agent merge step reads per-phase JSON files instead of relying on conversation memory
 *
 * Usage:
 *   node review-progress.js init [--mode <standard|grouped|two-phase|multi-agent>] [--base <branch>]
 *   node review-progress.js phase-start <phase_name>
 *   node review-progress.js phase-done  <phase_name> [--findings <file>]
 *   node review-progress.js phase-fail  <phase_name> [--reason <text>]
 *   node review-progress.js update-counts --p0 N --p1 N --p2 N
 *   node review-progress.js note <text>                   # Append a scratch note
 *   node review-progress.js stat                          # Print current progress
 *   node review-progress.js cleanup                       # Delete the progress file
 *
 * File location:
 *   .review-progress.json in the current working directory (same level as .code-review-diff.tmp)
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const PROGRESS_FILE = join(process.cwd(), '.review-progress.json');

type PhaseStatus = 'in_progress' | 'done' | 'failed';

interface PhaseRecord {
  name: string;
  status: PhaseStatus;
  started_at: string;
  finished_at: string | null;
  findings_file: string | null;
  error: string | null;
}

interface ProgressNote {
  at: string;
  text: string;
}

interface ReviewProgress {
  session_id: string;
  started_at: string;
  updated_at: string;
  branch: string;
  base: string;
  head_sha: string;
  mode: string;
  diff_stats: {
    files_changed: number;
    lines_changed: number;
    size_kb: number;
  };
  phases: PhaseRecord[];
  findings_so_far: { p0: number; p1: number; p2: number };
  notes: ProgressNote[];
  last_checkpoint: string;
}

function nowISO(): string {
  return new Date().toISOString();
}

function readProgress(): ReviewProgress {
  if (!existsSync(PROGRESS_FILE)) {
    throw new Error(`Progress file does not exist: ${PROGRESS_FILE}, run "review-progress init" first`);
  }
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8')) as ReviewProgress;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse progress file: ${message}`);
  }
}

function writeProgress(data: ReviewProgress): void {
  data.updated_at = nowISO();
  writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function safeGit(cmd: string, fallback = ''): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return fallback;
  }
}

function cmdInit(args: string[]): void {
  const mode = getFlag(args, '--mode') || 'standard';
  const base = getFlag(args, '--base') || 'master';

  const currentBranch = safeGit('git branch --show-current', '(unknown)');
  const headSha = safeGit('git rev-parse HEAD', '(unknown)');

  const diffPath = join(process.cwd(), '.code-review-diff.tmp');
  let filesChanged = 0;
  let linesChanged = 0;
  let sizeKB = 0;
  if (existsSync(diffPath)) {
    const diffContent = readFileSync(diffPath, 'utf-8');
    filesChanged = (diffContent.match(/^diff --git/gm) || []).length;
    linesChanged = diffContent.split('\n').length;
    sizeKB = +(Buffer.byteLength(diffContent, 'utf-8') / 1024).toFixed(2);
  }

  const data: ReviewProgress = {
    session_id: `cr-${Date.now()}`,
    started_at: nowISO(),
    updated_at: nowISO(),
    branch: currentBranch,
    base,
    head_sha: headSha,
    mode,
    diff_stats: {
      files_changed: filesChanged,
      lines_changed: linesChanged,
      size_kb: sizeKB,
    },
    phases: [],
    findings_so_far: { p0: 0, p1: 0, p2: 0 },
    notes: [],
    last_checkpoint: nowISO(),
  };

  writeProgress(data);

  console.log(`📝 Created review progress file: ${PROGRESS_FILE}`);
  console.log(`   session_id : ${data.session_id}`);
  console.log(`   branch     : ${currentBranch} vs ${base}`);
  console.log(`   mode       : ${mode}`);
  console.log(`   diff       : ${filesChanged} files / ${linesChanged} lines / ${sizeKB} KB`);
}

function cmdPhaseStart(args: string[]): void {
  const name = args[0];
  if (!name) throw new Error('Usage: review-progress phase-start <phase_name>');

  const data = readProgress();
  const existing = data.phases.find((phase) => phase.name === name);
  if (existing && existing.status === 'done') {
    console.log(`ℹ️  Phase "${name}" already done, skip start`);
    return;
  }

  if (existing) {
    existing.status = 'in_progress';
    existing.started_at = nowISO();
    existing.finished_at = null;
    existing.error = null;
  } else {
    data.phases.push({
      name,
      status: 'in_progress',
      started_at: nowISO(),
      finished_at: null,
      findings_file: null,
      error: null,
    });
  }

  data.last_checkpoint = nowISO();
  writeProgress(data);
  console.log(`▶️  Phase "${name}" started`);
}

function cmdPhaseDone(args: string[]): void {
  const name = args[0];
  if (!name) throw new Error('Usage: review-progress phase-done <phase_name> [--findings <file>]');
  const findingsFile = getFlag(args, '--findings') || null;

  const data = readProgress();
  let phase = data.phases.find((item) => item.name === name);
  if (!phase) {
    phase = {
      name,
      status: 'in_progress',
      started_at: nowISO(),
      finished_at: null,
      findings_file: null,
      error: null,
    };
    data.phases.push(phase);
  }

  phase.status = 'done';
  phase.finished_at = nowISO();
  if (findingsFile) phase.findings_file = findingsFile;

  data.last_checkpoint = nowISO();
  writeProgress(data);
  console.log(`✅ Phase "${name}" done${findingsFile ? ` (findings: ${findingsFile})` : ''}`);
}

function cmdPhaseFail(args: string[]): void {
  const name = args[0];
  if (!name) throw new Error('Usage: review-progress phase-fail <phase_name> [--reason <text>]');
  const reason = getFlag(args, '--reason') || 'unspecified';

  const data = readProgress();
  let phase = data.phases.find((item) => item.name === name);
  if (!phase) {
    phase = {
      name,
      status: 'in_progress',
      started_at: nowISO(),
      finished_at: null,
      findings_file: null,
      error: null,
    };
    data.phases.push(phase);
  }
  phase.status = 'failed';
  phase.finished_at = nowISO();
  phase.error = reason;

  data.last_checkpoint = nowISO();
  writeProgress(data);
  console.log(`❌ Phase "${name}" marked failed: ${reason}`);
}

function cmdUpdateCounts(args: string[]): void {
  const p0 = parseInt(getFlag(args, '--p0') ?? '', 10);
  const p1 = parseInt(getFlag(args, '--p1') ?? '', 10);
  const p2 = parseInt(getFlag(args, '--p2') ?? '', 10);

  const data = readProgress();
  if (!Number.isNaN(p0)) data.findings_so_far.p0 = p0;
  if (!Number.isNaN(p1)) data.findings_so_far.p1 = p1;
  if (!Number.isNaN(p2)) data.findings_so_far.p2 = p2;
  data.last_checkpoint = nowISO();
  writeProgress(data);
  console.log(
    `📊 Updated counts: P0=${data.findings_so_far.p0} P1=${data.findings_so_far.p1} P2=${data.findings_so_far.p2}`,
  );
}

function cmdNote(args: string[]): void {
  const text = args.join(' ').trim();
  if (!text) throw new Error('Usage: review-progress note <text>');

  const data = readProgress();
  data.notes.push({ at: nowISO(), text });
  data.last_checkpoint = nowISO();
  writeProgress(data);
  console.log(`📌 Note appended (#${data.notes.length})`);
}

function cmdStat(): void {
  if (!existsSync(PROGRESS_FILE)) {
    console.log('(No progress file; not started yet or already cleaned up)');
    return;
  }
  const data = readProgress();
  const line = '─'.repeat(60);
  console.log(line);
  console.log(`📋 Code review progress  (${data.session_id})`);
  console.log(line);
  console.log(`Branch         : ${data.branch}  →  ${data.base}`);
  console.log(`Mode           : ${data.mode}`);
  console.log(
    `Diff          : ${data.diff_stats.files_changed} files / ${data.diff_stats.lines_changed} lines / ${data.diff_stats.size_kb} KB`,
  );
  console.log(
    `Findings so far: P0=${data.findings_so_far.p0}  P1=${data.findings_so_far.p1}  P2=${data.findings_so_far.p2}`,
  );
  console.log(`Last updated   : ${data.updated_at}`);
  console.log(`Phases (${data.phases.length}):`);
  for (const phase of data.phases) {
    const icon =
      phase.status === 'done'
        ? '✅'
        : phase.status === 'in_progress'
          ? '▶️ '
          : phase.status === 'failed'
            ? '❌'
            : '⏸ ';
    const extra = phase.findings_file
      ? `  findings=${phase.findings_file}`
      : phase.error
        ? `  error=${phase.error}`
        : '';
    console.log(`  ${icon} ${phase.name.padEnd(24)} ${phase.status}${extra}`);
  }
  if (data.notes.length) {
    console.log(`Notes (${data.notes.length}):`);
    data.notes.slice(-5).forEach((note) => console.log(`  - [${note.at}] ${note.text}`));
  }
  console.log(line);
}

function cmdCleanup(): void {
  if (existsSync(PROGRESS_FILE)) {
    unlinkSync(PROGRESS_FILE);
    console.log(`🗑️  Deleted progress file: ${PROGRESS_FILE}`);
  } else {
    console.log('ℹ️  Progress file does not exist, nothing to clean up');
  }
}

function getFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function showHelp(): void {
  console.log(`
Code review progress tracking (.review-progress.json)

Usage:
  node review-progress.js init [--mode <mode>] [--base <branch>]
  node review-progress.js phase-start <phase_name>
  node review-progress.js phase-done  <phase_name> [--findings <file>]
  node review-progress.js phase-fail  <phase_name> [--reason <text>]
  node review-progress.js update-counts --p0 N --p1 N --p2 N
  node review-progress.js note <text>
  node review-progress.js stat
  node review-progress.js cleanup
`);
}

const [, , cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case 'init':
      cmdInit(rest);
      break;
    case 'phase-start':
      cmdPhaseStart(rest);
      break;
    case 'phase-done':
      cmdPhaseDone(rest);
      break;
    case 'phase-fail':
      cmdPhaseFail(rest);
      break;
    case 'update-counts':
      cmdUpdateCounts(rest);
      break;
    case 'note':
      cmdNote(rest);
      break;
    case 'stat':
      cmdStat();
      break;
    case 'cleanup':
      cmdCleanup();
      break;
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      showHelp();
      process.exit(2);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exit(1);
}
