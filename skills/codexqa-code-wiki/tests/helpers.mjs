import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = join(TEST_DIR, '..');
export const FIXTURE_DIR = join(TEST_DIR, 'fixtures', 'codexqa');

export function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

// A minimal `codexqa wiki inputs` export.
// modules: [{ id: 'p01', title, size, deps: ['p02'], sigs: [...], flows: [...] }]
// calls:   [['p01', 'p02', 40], ...]  (from, to, weight)
export function makeInputs({ modules, calls = [], communities, selected, relations = [] }) {
  const title = (id) => modules.find((m) => m.id === id).title;
  const pages = modules.map((m) => ({
    kind: 'page',
    id: m.id,
    community_id: Number(m.id.slice(1)),
    input: {
      stats: { node_count: m.size, file_count: (m.files || []).length, languages: ['TypeScript'], namespaces: m.files || [] },
      signatures: m.sigs || [],
      method_flows: m.flows || [],
      cross_community: [
        ...calls.filter(([f]) => f === m.id).map(([, to, w]) => ({ direction: 'outgoing', other: title(to), weight: w, kinds: ['calls'] })),
        ...calls.filter(([, to]) => to === m.id).map(([f, , w]) => ({ direction: 'incoming', other: title(f), weight: w, kinds: ['calls'] })),
      ],
    },
  }));
  return {
    communities: communities ?? modules.length,
    selected: selected ?? modules.length,
    inputs: [
      {
        kind: 'architecture',
        id: 'architecture',
        input: modules.map((m) => ({
          id: m.id,
          title: m.title,
          summary: '',
          node_count: m.size,
          deps: m.deps ?? [...new Set(calls.filter(([f, t]) => f === m.id || t === m.id).map(([f, t]) => (f === m.id ? t : f)))],
        })),
      },
      { kind: 'overview', id: 'overview', input: { groups: [], modules: [], relations } },
      ...pages,
    ],
  };
}

export const CHAIN = {
  modules: [
    { id: 'p01', title: 'cli · entry', size: 40, files: ['src/cli.ts'] },
    { id: 'p02', title: 'core · engine', size: 120, files: ['src/engine.ts', 'src/plan.ts'] },
    { id: 'p03', title: 'store · db', size: 60, files: ['src/db.ts'] },
    { id: 'p04', title: 'misc · scripts', size: 10, files: ['scripts/x.py'] },
  ],
  calls: [['p01', 'p02', 30], ['p02', 'p03', 50], ['p03', 'p02', 4]],
};
