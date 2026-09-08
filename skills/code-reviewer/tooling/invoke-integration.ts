#!/usr/bin/env node
/**
 * Call one named integration from the resolved project config.
 *
 * Usage:
 *   node invoke-integration.js <prMetadata|notify|telemetry|extraKnowledge> \
 *     [--org x] [--repo x] [--branch x] [--base x] [--sha x] [--path x] [--line n] \
 *     [--body-file payload.json]
 *
 * Rules:
 *   - Only the URL declared in config is called.
 *   - Disabled / empty URL → exit 0 with skipped JSON (review must continue).
 *   - Network or HTTP errors → exit 0 with error JSON (fail open).
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthConfig, LoadedConfig } from './config-types.js';

const ALLOWED = new Set(['prMetadata', 'notify', 'telemetry', 'extraKnowledge']);
const PLACEHOLDERS = new Set(['org', 'repo', 'branch', 'path', 'line', 'baseBranch', 'sha']);

interface CliArgs {
  name: string;
  vars: Record<string, string>;
  bodyFile: string;
}

class AuthMissingError extends Error {
  readonly code = 'AUTH_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'AuthMissingError';
  }
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { name: '', vars: {}, bodyFile: '' };
  const rest = argv.slice(2);
  const first = rest[0];
  if (!first || first.startsWith('--')) {
    throw new Error('usage: invoke-integration.js <name> [--org ...] [--body-file file]');
  }
  out.name = first;
  for (let i = 1; i < rest.length; i += 1) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`bad argument near ${key}`);
    }
    i += 1;
    if (key === '--body-file') out.bodyFile = value;
    else if (key === '--base') out.vars.baseBranch = value;
    else out.vars[key.slice(2)] = value;
  }
  return out;
}

function loadResolvedConfig(): LoadedConfig {
  const loader = join(dirname(fileURLToPath(import.meta.url)), 'load-config.js');
  const result = spawnSync(process.execPath, [loader], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || 'load-config failed').trim());
  }
  return JSON.parse(result.stdout) as LoadedConfig;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return String(template)
    .replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '')
    .replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
      if (!PLACEHOLDERS.has(key)) return `{${key}}`;
      return vars[key] ?? '';
    });
}

function applyAuth(
  url: string,
  headers: Record<string, string>,
  auth: AuthConfig | undefined,
): { url: string; headers: Record<string, string> } {
  const type = auth?.type || 'none';
  if (type === 'none') return { url, headers };
  const required = auth?.required !== false;
  const missing = (label: string): { url: string; headers: Record<string, string> } => {
    if (required) throw new AuthMissingError(`auth required but ${label} is empty`);
    return { url, headers };
  };

  if (type === 'bearer') {
    const token = process.env[auth?.tokenEnv || 'CODE_REVIEWER_TOKEN'] || '';
    if (!token) return missing(auth?.tokenEnv || 'CODE_REVIEWER_TOKEN');
    headers.Authorization = `Bearer ${token}`;
    return { url, headers };
  }
  if (type === 'basic') {
    const user = process.env[auth?.usernameEnv || 'CODE_REVIEWER_USER'] || '';
    const pass = process.env[auth?.passwordEnv || 'CODE_REVIEWER_PASSWORD'] || '';
    if (!user || !pass) return missing('CODE_REVIEWER_USER / CODE_REVIEWER_PASSWORD');
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    return { url, headers };
  }
  if (type === 'header') {
    const token = process.env[auth?.tokenEnv || 'CODE_REVIEWER_TOKEN'] || '';
    const name = auth?.headerName || 'X-Api-Key';
    if (!token) return missing(auth?.tokenEnv || 'CODE_REVIEWER_TOKEN');
    headers[name] = token;
    return { url, headers };
  }
  if (type === 'query') {
    const token = process.env[auth?.tokenEnv || 'CODE_REVIEWER_TOKEN'] || '';
    const param = auth?.queryParam || 'access_token';
    if (!token) return missing(auth?.tokenEnv || 'CODE_REVIEWER_TOKEN');
    const parsed = new URL(url);
    parsed.searchParams.set(param, token);
    return { url: parsed.toString(), headers };
  }
  throw new Error(`unknown auth.type: ${type}`);
}

function abortAfter(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

function skip(reason: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason, ...extra })}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!ALLOWED.has(args.name)) {
    throw new Error(`unknown integration: ${args.name}`);
  }

  const loaded = loadResolvedConfig();
  const endpoint = loaded.config?.integrations?.[args.name];
  if (!endpoint?.enabled || !endpoint.url) {
    skip(`integrations.${args.name} is disabled or has no url`, { source: loaded.source });
    return;
  }

  let url = fillTemplate(endpoint.url, args.vars);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(endpoint.headers || {})) {
    headers[key] = fillTemplate(value, args.vars);
  }
  try {
    const authed = applyAuth(url, headers, endpoint.auth);
    url = authed.url;
  } catch (error) {
    if (error instanceof AuthMissingError) {
      skip(error.message, { source: loaded.source, name: args.name });
      return;
    }
    throw error;
  }

  const init: RequestInit = {
    method: endpoint.method || 'GET',
    headers,
    signal: abortAfter(endpoint.timeoutMs || 8000),
  };

  if (args.bodyFile) {
    if (!existsSync(args.bodyFile)) {
      skip(`body file missing: ${args.bodyFile}`);
      return;
    }
    init.body = readFileSync(args.bodyFile, 'utf-8');
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(url, init);
  const text = await response.text();
  const clipped = text.length > 8000 ? `${text.slice(0, 8000)}\n…[truncated]` : text;
  process.stdout.write(
    `${JSON.stringify({
      ok: response.ok,
      skipped: false,
      name: args.name,
      status: response.status,
      source: loaded.source,
      body: clipped,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      skipped: true,
      reason: message,
    })}\n`,
  );
});
