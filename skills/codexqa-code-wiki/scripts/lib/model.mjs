// Turn one `codexqa wiki inputs` export into the facts the report shows.
// Everything here is deterministic: the same export always yields the same
// modules, edges, groups, and suggested reading paths.

const SIGNATURE_LIMIT = 8;
const FLOW_LIMIT = 2;
const FLOW_STEP_LIMIT = 6;
const GUIDE_MAX_STEPS = 4;
const GUIDE_LIMIT = 3;

export function displayId(raw) {
  const m = /^p(\d+)$/i.exec(String(raw || '').trim());
  return m ? `P${m[1].padStart(2, '0')}` : String(raw || '').trim().toUpperCase();
}

function rowsOf(inputs, kind) {
  return (inputs.inputs || []).filter((row) => row && row.kind === kind);
}

function parseParams(raw) {
  if (!raw) return [];
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.map((p) => (p && p.name) || '').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function shortTitle(title) {
  const parts = String(title || '').split(' · ').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
}

export function buildModel(inputs, opts = {}) {
  if (!inputs || !Array.isArray(inputs.inputs)) {
    throw new Error('wiki inputs JSON has no `inputs` array; pass the stdout of `codexqa wiki inputs <repo>`');
  }
  const warnings = [];
  const arch = rowsOf(inputs, 'architecture')[0];
  if (!arch || !Array.isArray(arch.input)) {
    throw new Error('wiki inputs has no architecture row; export without --kind, or with --kind architecture');
  }
  const pages = new Map();
  for (const row of rowsOf(inputs, 'page')) {
    if (row.id && row.input) pages.set(displayId(row.id), row.input);
  }
  const overview = rowsOf(inputs, 'overview')[0]?.input || null;

  const modules = arch.input.map((m) => {
    const id = displayId(m.id);
    if (!/^[A-Z0-9][A-Z0-9_.-]{0,31}$/.test(id)) throw new Error(`unexpected module id ${JSON.stringify(String(m.id)).slice(0, 40)} in the export`);
    const page = pages.get(id) || null;
    const stats = page?.stats || {};
    return {
      id,
      rawId: m.id,
      title: String(m.title || page?.tentative_title || id),
      short: shortTitle(m.title || page?.tentative_title || id),
      size: Number(m.node_count) || Number(stats.node_count) || 0,
      listedDeps: (m.deps || []).map(displayId),
      files: Array.isArray(stats.namespaces) ? stats.namespaces.slice() : [],
      fileCount: Number(stats.file_count) || (Array.isArray(stats.namespaces) ? stats.namespaces.length : 0),
      languages: Array.isArray(stats.languages) ? stats.languages.slice() : [],
      hasPage: Boolean(page),
      signatures: topSignatures(page),
      flows: topFlows(page),
      outside: [],
    };
  });
  modules.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const byId = new Map(modules.map((m) => [m.id, m]));

  const titleCount = new Map();
  for (const m of modules) titleCount.set(m.title, (titleCount.get(m.title) || 0) + 1);
  const titleToId = new Map();
  for (const m of modules) {
    if (titleCount.get(m.title) === 1) titleToId.set(m.title, m.id);
  }
  for (const [title, n] of titleCount) {
    if (n > 1) warnings.push(`${n} modules share the title "${title}"; their cross-module weights are left out`);
  }

  // Undirected pair → weights in both directions.
  const pairs = new Map();
  const pairOf = (a, b) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    if (!pairs.has(key)) pairs.set(key, { a: x, b: y, ab: 0, ba: 0, listedAB: false, listedBA: false, kinds: new Set() });
    return pairs.get(key);
  };
  const setWeight = (from, to, weight, kinds) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const p = pairOf(from, to);
    const w = Number(weight) || 0;
    if (from === p.a) p.ab = Math.max(p.ab, w);
    else p.ba = Math.max(p.ba, w);
    for (const k of kinds || []) p.kinds.add(k);
  };

  for (const m of modules) {
    for (const dep of m.listedDeps) {
      if (dep === m.id) continue;
      if (!byId.has(dep)) {
        m.outside.push(dep);
        continue;
      }
      // A listed dependency means m uses dep; keep that direction even without a count.
      const p = pairOf(m.id, dep);
      if (m.id === p.a) p.listedAB = true;
      else p.listedBA = true;
    }
  }
  for (const m of modules) {
    const page = pages.get(m.id);
    for (const cc of page?.cross_community || []) {
      const other = titleToId.get(String(cc.other || ''));
      if (!other) continue;
      if (cc.direction === 'outgoing') setWeight(m.id, other, cc.weight, cc.kinds);
      else if (cc.direction === 'incoming') setWeight(other, m.id, cc.weight, cc.kinds);
    }
  }
  for (const rel of overview?.relations || []) {
    const from = titleToId.get(String(rel.from || ''));
    const to = titleToId.get(String(rel.to || ''));
    if (!from || !to || from === to) continue;
    const p = pairs.get(from < to ? `${from}|${to}` : `${to}|${from}`);
    // Overview counts only fill a direction the page digests left empty.
    if (!p) {
      if (Number(rel.count) > 0) setWeight(from, to, rel.count, []);
      continue;
    }
    if (from === p.a && !p.ab) p.ab = Number(rel.count) || 0;
    if (from === p.b && !p.ba) p.ba = Number(rel.count) || 0;
  }

  const edges = [];
  for (const p of pairs.values()) {
    const known = p.ab > 0 || p.ba > 0;
    if (!known && !p.listedAB && !p.listedBA) continue;
    // The heavier direction reads as "who calls whom"; without counts, the listed one.
    const forward = known ? p.ab >= p.ba : p.listedAB;
    edges.push({
      from: forward ? p.a : p.b,
      to: forward ? p.b : p.a,
      weight: forward ? p.ab : p.ba,
      back: forward ? p.ba : p.ab,
      both: known ? p.ab > 0 && p.ba > 0 : p.listedAB && p.listedBA,
      known,
      kinds: [...p.kinds].sort(),
    });
  }
  edges.sort((x, y) => (y.weight + y.back) - (x.weight + x.back) || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));

  for (const m of modules) {
    m.calls = [];
    m.calledBy = [];
  }
  for (const e of edges) {
    byId.get(e.from).calls.push({ id: e.to, weight: e.weight });
    byId.get(e.to).calledBy.push({ id: e.from, weight: e.weight });
    if (e.back > 0 || (!e.known && e.both)) {
      byId.get(e.to).calls.push({ id: e.from, weight: e.back });
      byId.get(e.from).calledBy.push({ id: e.to, weight: e.back });
    }
  }
  for (const m of modules) {
    m.calls.sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id));
    m.calledBy.sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id));
    m.inWeight = m.calledBy.reduce((s, x) => s + x.weight, 0);
    m.outWeight = m.calls.reduce((s, x) => s + x.weight, 0);
    m.degree = new Set([...m.calls, ...m.calledBy].map((x) => x.id)).size;
  }

  const groups = connectedGroups(modules, edges);
  const standalone = modules.filter((m) => m.degree === 0).map((m) => m.id);
  for (const g of groups) {
    const members = g.members.map((id) => byId.get(id));
    if (members.length >= 3) {
      const hub = members.slice().sort((x, y) => y.degree - x.degree
        || (y.inWeight + y.outWeight) - (x.inWeight + x.outWeight) || y.size - x.size)[0];
      if (hub.degree >= 2) {
        g.hub = hub.id;
        hub.hub = true;
      }
    }
    for (const m of members) m.group = g.id;
    g.guide = autoGuide(g, byId, edges);
  }

  const maxSize = modules.reduce((s, m) => Math.max(s, m.size), 0);
  const totalSize = modules.reduce((s, m) => s + m.size, 0);
  return {
    modules,
    byId,
    edges,
    groups,
    standalone,
    maxSize,
    totalSize,
    communities: Number(inputs.communities) || modules.length,
    selected: Number(inputs.selected) || modules.length,
    warnings,
    limit: opts.limit ?? null,
  };
}

function topSignatures(page) {
  const list = Array.isArray(page?.signatures) ? page.signatures : [];
  // The digest has no file per symbol, so same-named definitions (one `main`
  // per script) are folded into one row that says how many there are.
  const byName = new Map();
  for (const s of list) {
    if (!s || !s.name || s.is_public === false || s.parent) continue;
    const key = `${s.kind}|${s.name}`;
    const calledBy = Number(s.called_by) || 0;
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, {
        name: String(s.name),
        kind: String(s.kind || ''),
        params: parseParams(s.params),
        returns: s.returns ? String(s.returns) : '',
        calledBy,
        defs: 1,
      });
    } else {
      prev.defs += 1;
      if (calledBy > prev.calledBy) {
        prev.calledBy = calledBy;
        prev.params = parseParams(s.params);
        prev.returns = s.returns ? String(s.returns) : '';
      }
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.calledBy - a.calledBy || a.name.localeCompare(b.name))
    .slice(0, SIGNATURE_LIMIT);
}

function topFlows(page) {
  const list = Array.isArray(page?.method_flows) ? page.method_flows : [];
  return list
    .filter((f) => f && f.method && Array.isArray(f.steps))
    .sort((a, b) => (Number(b.called_by) || 0) - (Number(a.called_by) || 0))
    .slice(0, FLOW_LIMIT)
    .map((f) => {
      const seen = new Set();
      const steps = [];
      for (const s of f.steps) {
        if (s.kind !== 'calls' || !s.target || seen.has(s.target)) continue;
        seen.add(s.target);
        steps.push(String(s.target));
        if (steps.length >= FLOW_STEP_LIMIT) break;
      }
      return { method: String(f.method), calledBy: Number(f.called_by) || 0, steps, more: countCalls(f.steps) - steps.length };
    })
    .filter((f) => f.steps.length > 0);
}

function countCalls(steps) {
  return new Set(steps.filter((s) => s.kind === 'calls' && s.target).map((s) => s.target)).size;
}

function connectedGroups(modules, edges) {
  const parent = new Map(modules.map((m) => [m.id, m.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const buckets = new Map();
  for (const m of modules) {
    const r = find(m.id);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(m);
  }
  const groups = [...buckets.values()]
    .filter((ms) => ms.length > 1)
    .map((ms) => ({
      members: ms.map((m) => m.id),
      size: ms.reduce((s, m) => s + m.size, 0),
      lead: ms.slice().sort((x, y) => y.size - x.size)[0],
    }))
    .sort((x, y) => y.size - x.size || x.members[0].localeCompare(y.members[0]));
  return groups.map((g, i) => ({
    id: `G${i + 1}`,
    members: g.members,
    size: g.size,
    autoName: g.members
      .map((id) => modules.find((m) => m.id === id))
      .sort((x, y) => y.size - x.size)
      .slice(0, 2)
      .map((m) => m.short),
    hub: null,
    guide: [],
  }));
}

function autoGuide(group, byId, edges) {
  const members = new Set(group.members);
  const out = new Map(group.members.map((id) => [id, []]));
  for (const e of edges) {
    if (!members.has(e.from)) continue;
    out.get(e.from).push({ id: e.to, weight: e.weight });
    if (e.back > 0) out.get(e.to).push({ id: e.from, weight: e.back });
  }
  for (const list of out.values()) list.sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id));
  // Start where calls leave more than they arrive: the closest thing to an entry.
  const start = group.members
    .map((id) => byId.get(id))
    .sort((x, y) => (y.outWeight - y.inWeight) - (x.outWeight - x.inWeight) || y.size - x.size || x.id.localeCompare(y.id))[0];
  const path = [start.id];
  const seen = new Set(path);
  while (path.length < GUIDE_MAX_STEPS) {
    const next = out.get(path[path.length - 1]).find((x) => !seen.has(x.id));
    if (!next) break;
    path.push(next.id);
    seen.add(next.id);
  }
  return path.length >= 2 ? path : [];
}

export function edgeBetween(model, a, b) {
  return model.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)) || null;
}

// Weight of calls going a → b (0 when the export lists the pair without a count).
export function weightFrom(model, a, b) {
  const e = edgeBetween(model, a, b);
  if (!e) return null;
  return e.from === a ? e.weight : e.back;
}

export function autoGuides(model) {
  return model.groups
    .filter((g) => g.guide.length >= 2)
    .slice(0, GUIDE_LIMIT)
    .map((g) => ({ group: g.id, steps: g.guide.map((id) => ({ module: id, note: '' })), auto: true }));
}
