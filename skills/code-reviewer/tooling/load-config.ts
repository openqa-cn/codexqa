#!/usr/bin/env node
/**
 * Resolve the vendor-neutral code-reviewer config.
 *
 * Lookup order (first file that exists wins, then merge over built-in defaults):
 *   1. CODE_REVIEWER_CONFIG
 *   2. <cwd>/code-reviewer.config.local.json
 *   3. <cwd>/code-reviewer.config.json
 *   4. <cwd>/.code-reviewer.json
 *   5. <cwd>/.code-reviewer/config.json
 *
 * Prints one JSON object to stdout. Never calls the network.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpEndpoint, HttpMethod, LoadedConfig, ReviewerConfig } from './config-types.js';

const CWD = process.cwd();

function emptyEndpoint(method: HttpMethod, timeoutMs: number): HttpEndpoint {
  return {
    enabled: false,
    method,
    url: '',
    headers: {},
    auth: { type: 'none', tokenEnv: 'CODE_REVIEWER_TOKEN', required: true },
    timeoutMs,
  };
}

const DEFAULTS: ReviewerConfig = {
  version: 1,
  git: {
    defaultBaseBranch: 'main', // preferred; playbook falls back to master if this ref is missing
    codeBrowseUrlTemplate: '',
  },
  layers: {
    ui: ['src/pages/', 'src/components/'],
    store: ['src/stores/'],
    api: ['src/api/'],
    backend: ['src/main/java/', 'src/main/kotlin/', 'src/main/resources/'],
    exclude: [
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.stories.*',
      '**/__mocks__/**',
      '**/__MACOSX/**',
      '**/.DS_Store',
      '**/._*',
    ],
  },
  conventions: {
    stateLibrary: '',
    httpWrapper: '',
    generatedGlobs: [],
    generatedMarkers: ['@generated', 'This file is auto-generated', 'Code generated'],
    backendLanguage: '',
  },
  integrations: {
    prMetadata: emptyEndpoint('GET', 8000),
    notify: emptyEndpoint('POST', 8000),
    telemetry: emptyEndpoint('POST', 5000),
    extraKnowledge: emptyEndpoint('GET', 8000),
  },
};

function deepMerge<T>(base: T, extra: unknown): T {
  if (Array.isArray(extra)) return extra.slice() as T;
  if (!extra || typeof extra !== 'object') return (extra === undefined ? base : extra) as T;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return extra as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    const current = out[key];
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = Array.isArray(value) ? value.slice() : value;
    }
  }
  return out as T;
}

function candidatePaths(): string[] {
  const fromEnv = process.env.CODE_REVIEWER_CONFIG;
  return [
    fromEnv,
    join(CWD, 'code-reviewer.config.local.json'),
    join(CWD, 'code-reviewer.config.json'),
    join(CWD, '.code-reviewer.json'),
    join(CWD, '.code-reviewer', 'config.json'),
  ].filter((path): path is string => Boolean(path));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function previewUrl(url: string): string {
  return String(url).replace(/\$\{[A-Z0-9_]+\}/g, 'env');
}

function assertHttpUrl(name: string, endpoint: HttpEndpoint | undefined): void {
  if (!endpoint?.enabled) return;
  if (!endpoint.url) {
    throw new Error(`integrations.${name} is enabled but url is empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(previewUrl(endpoint.url));
  } catch {
    throw new Error(`integrations.${name} url is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`integrations.${name} url must be http(s)`);
  }
}

function load(): LoadedConfig {
  const sources: LoadedConfig['sources'] = [];
  let merged = structuredClone(DEFAULTS);

  let projectFile: string | null = null;
  for (const path of candidatePaths()) {
    if (!existsSync(path)) continue;
    const raw = readJson(path);
    merged = deepMerge(merged, raw);
    sources.push({ path, role: 'project' });
    projectFile = path;
    break;
  }

  if (merged.version !== 1) {
    throw new Error(`unsupported config version: ${merged.version}`);
  }

  for (const name of Object.keys(merged.integrations || {})) {
    assertHttpUrl(name, merged.integrations[name]);
  }

  return {
    source: projectFile || '(built-in defaults)',
    sources,
    config: merged,
  };
}

try {
  process.stdout.write(`${JSON.stringify(load(), null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`⚠️  load-config failed: ${message}`);
  process.exit(1);
}
