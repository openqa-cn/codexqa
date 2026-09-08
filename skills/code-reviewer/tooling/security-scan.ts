#!/usr/bin/env node
/**
 * Language-partitioned security scan for review step 2.1.
 * One pass per listed file. Never scans the whole repo. Never calls the network.
 * Prints one JSON object to stdout. Exit 0 unless the process itself crashes.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BYTES = 500 * 1024;
const DEFAULT_LIST = '.cr-files.txt';

type Severity = 'critical' | 'high' | 'medium';
type Surface = 'frontend' | 'backend' | 'skip';

interface Finding {
  id: string;
  file: string;
  line: number;
  rule: string;
  severity: Severity;
}

interface ScanResult {
  files: number;
  critical: number;
  high: number;
  medium: number;
  findings: Finding[];
  skipped: Array<{ path: string; reason: string }>;
}

interface Rule {
  id: string;
  rule: string;
  severity: Severity;
  test: (line: string) => boolean;
}

const PLACEHOLDER = /^(changeme|xxx+|your-|example|placeholder|dummy|todo|replace-me)/i;
const ENV_READ = /process\.env|import\.meta\.env/;

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}

function secretAssign(line: string, pattern: RegExp): boolean {
  const match = pattern.exec(line);
  if (!match) {
    return false;
  }
  const value = match[3] ?? '';
  if (isPlaceholderValue(value)) {
    return false;
  }
  if (ENV_READ.test(line)) {
    return false;
  }
  return true;
}

const FRONTEND_RULES: Rule[] = [
  {
    id: 'S1',
    rule: 'Hardcoded API key / token',
    severity: 'critical',
    test: (line) =>
      secretAssign(
        line,
        /(api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\s*[:=]\s*(['"`])([\w\-]{20,})\2/i,
      ),
  },
  {
    id: 'S2',
    rule: 'Hardcoded password',
    severity: 'critical',
    test: (line) => secretAssign(line, /(password)\s*[:=]\s*(['"`])([^'"`]{6,})\2/i),
  },
  {
    id: 'S3',
    rule: 'Dynamic innerHTML',
    severity: 'high',
    test: (line) => /\.innerHTML\s*=\s*(?!['"`])/.test(line),
  },
  {
    id: 'S4',
    rule: 'dangerouslySetInnerHTML',
    severity: 'high',
    test: (line) => /dangerouslySetInnerHTML\s*=\s*\{\{?\s*__html:/.test(line),
  },
  {
    id: 'S5',
    rule: 'eval()',
    severity: 'critical',
    test: (line) => /\beval\s*\(/.test(line),
  },
  {
    id: 'S6',
    rule: 'new Function',
    severity: 'high',
    test: (line) => /new\s+Function\s*\(/.test(line),
  },
  {
    id: 'S7',
    rule: 'Sensitive fields in console.log',
    severity: 'medium',
    test: (line) => /console\.log\(.*?(password|token|secret|key|credential)/i.test(line),
  },
  {
    id: 'S8',
    rule: 'Long-lived token in query',
    severity: 'high',
    test: (line) => /[?&](access_)?token=/.test(line),
  },
];

const BACKEND_RULES: Rule[] = [
  {
    id: 'S9',
    rule: 'SQL concatenation / MyBatis ${}',
    severity: 'critical',
    test: (line) => /\$\{/.test(line) || /['"`]\s*(?:SELECT|UPDATE|DELETE)\b/i.test(line),
  },
  {
    id: 'S10',
    rule: 'Command execution',
    severity: 'critical',
    test: (line) => /Runtime\.getRuntime\(\)\.exec|ProcessBuilder\s*\(/.test(line),
  },
  {
    id: 'S11',
    rule: 'Unsafe deserialization',
    severity: 'critical',
    test: (line) =>
      /new\s+ObjectInputStream|enableDefaultTyping|activateDefaultTyping/.test(line),
  },
  {
    id: 'S12',
    rule: 'In-app DDL / stored procedures',
    severity: 'critical',
    test: (line) =>
      /\b(?:CREATE\s+PROCEDURE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(line),
  },
];

function classifyPath(filePath: string): Surface {
  const path = filePath.replace(/\\/g, '/');
  if (/(^|\/)(node_modules|dist|build|target|__MACOSX)(\/|$)/.test(path)) {
    return 'skip';
  }
  if (/(^|\/)\.DS_Store$|(^|\/)\._/.test(path)) {
    return 'skip';
  }
  if (/\.(test|spec)\.[^./]+$/i.test(path)) {
    return 'skip';
  }
  if (/\.stories\.[^./]+$/i.test(path)) {
    return 'skip';
  }
  if (/(^|\/)__mocks__(\/|$)/.test(path)) {
    return 'skip';
  }
  if (/\.(generated|auto)\.[^./]+$/i.test(path)) {
    return 'skip';
  }
  if (/(Test|Tests)\.java$/.test(path)) {
    return 'skip';
  }
  if (/\.(js|jsx|ts|tsx|mjs)$/i.test(path)) {
    if (/(^|\/)api\//.test(path)) {
      return 'skip';
    }
    return 'frontend';
  }
  if (/\.(java|kt|kts|xml|sql)$/i.test(path)) {
    return 'backend';
  }
  return 'skip';
}

function parseArgs(argv: string[]): { listPath: string | undefined; paths: string[] } {
  const paths: string[] = [];
  let listPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--files') {
      listPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg?.startsWith('-')) {
      continue;
    }
    if (arg) {
      paths.push(arg);
    }
  }
  return { listPath, paths };
}

function readList(listPath: string): string[] {
  if (!existsSync(listPath)) {
    return [];
  }
  return readFileSync(listPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function collectTargets(cwd: string, argv: string[]): string[] {
  const { listPath, paths } = parseArgs(argv);
  const fromList = listPath
    ? readList(resolve(cwd, listPath))
    : paths.length === 0 && existsSync(resolve(cwd, DEFAULT_LIST))
      ? readList(resolve(cwd, DEFAULT_LIST))
      : [];
  const unique = new Set<string>();
  for (const item of [...fromList, ...paths]) {
    unique.add(item);
  }
  return [...unique];
}

function scanFile(
  absPath: string,
  displayPath: string,
  surface: Surface,
  result: ScanResult,
): void {
  const stat = statSync(absPath);
  if (stat.size > MAX_BYTES) {
    result.skipped.push({
      path: displayPath,
      reason: `large file ${Math.round(stat.size / 1024)}KB`,
    });
    return;
  }

  const rules = surface === 'frontend' ? FRONTEND_RULES : BACKEND_RULES;
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
  result.files += 1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const rule of rules) {
      if (rule.test(line)) {
        result.findings.push({
          id: rule.id,
          file: displayPath,
          line: index + 1,
          rule: rule.rule,
          severity: rule.severity,
        });
      }
    }
  }
}

function emptyResult(): ScanResult {
  return {
    files: 0,
    critical: 0,
    high: 0,
    medium: 0,
    findings: [],
    skipped: [],
  };
}

function main(): void {
  const cwd = process.cwd();
  const result = emptyResult();
  const targets = collectTargets(cwd, process.argv.slice(2));

  for (const target of targets) {
    const absPath = resolve(cwd, target);
    const surface = classifyPath(target);
    if (surface === 'skip') {
      result.skipped.push({ path: target, reason: 'excluded path or extension' });
      continue;
    }
    if (!existsSync(absPath)) {
      result.skipped.push({ path: target, reason: 'missing file' });
      continue;
    }
    scanFile(absPath, target, surface, result);
  }

  for (const finding of result.findings) {
    result[finding.severity] += 1;
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
