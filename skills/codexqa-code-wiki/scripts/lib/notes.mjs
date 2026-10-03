// notes.json holds the only words a model writes. Facts (sizes, calls, symbols,
// files) come from the export; validation keeps the words tied to those facts.
import { displayId, edgeBetween, autoGuides } from './model.mjs';

const LAYERS = {
  entry: 'entry', 入口: 'entry',
  application: 'application', app: 'application', 应用: 'application',
  domain: 'domain', 领域: 'domain',
  storage: 'storage', 存储: 'storage',
};

// Checked on prose only (code spans removed): `{{ user.name }}` or `deps.py` in backticks is fine.
const PLACEHOLDER = [/待填|待补充|<填写|lorem ipsum/i, /\bTODO\b|\bTBD\b|\bFIXME\b|\{\{|\}\}/];
const JARGON = [
  [/\bdeps\b/, '`deps` → 写成「依赖」或「调用」'],
  [/cross[_-]community/i, '`cross_community` → 写成「跨模块调用」'],
  [/wiki inputs/i, '`wiki inputs` → 读者不需要知道导出命令'],
  [/node_count|called_by|call_chain|method_flows|valid_anchors/, '内部字段名 → 写成「规模」「被调用」「调用链」'],
  [/（无摘要）|\(无摘要\)/, '`（无摘要）` 是空摘要占位，不是内容'],
];

export function emptyNotes(model, lang = 'zh') {
  const modules = {};
  for (const m of model.modules) modules[m.id] = { name: '', role: '', detail: '', source: m.title };
  const groups = {};
  for (const g of model.groups) groups[g.id] = { name: '', summary: '', members: g.members.slice() };
  return {
    lang,
    title: '',
    tagline: '',
    overview: '',
    groups,
    modules,
    guides: autoGuides(model).map((g) => ({ title: '', steps: g.steps.map((s) => ({ module: s.module, note: '' })) })),
  };
}

export function normalizeNotes(raw) {
  const notes = raw && typeof raw === 'object' ? raw : {};
  const duplicates = [];
  const modules = {};
  for (const [k, v] of Object.entries(notes.modules || {})) {
    const id = displayId(k);
    if (id in modules) duplicates.push(`modules.${id}`);
    modules[id] = v || {};
  }
  const groups = {};
  for (const [k, v] of Object.entries(notes.groups || {})) {
    const id = String(k).toUpperCase();
    if (id in groups) duplicates.push(`groups.${id}`);
    groups[id] = v || {};
  }
  const guides = Array.isArray(notes.guides) ? notes.guides.map((g) => ({
    title: g?.title || '',
    steps: Array.isArray(g?.steps) ? g.steps.map((s) => (typeof s === 'string'
      ? { module: displayId(s), note: '' }
      : { module: displayId(s?.module), note: s?.note || '' })) : [],
  })) : [];
  return {
    lang: notes.lang === 'en' ? 'en' : 'zh',
    title: str(notes.title),
    tagline: str(notes.tagline),
    overview: str(notes.overview),
    groups,
    modules,
    guides,
    duplicates,
  };
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function layerOf(value) {
  if (!value) return '';
  return LAYERS[String(value).trim().toLowerCase()] || LAYERS[String(value).trim()] || null;
}

// `errors` are wrong facts and always block a build. `missing` lists fields not
// written yet: a final build needs none, a draft fills them with rule-based text.
export function validateNotes(rawNotes, model) {
  const errors = [];
  const warnings = [];
  const missing = [];
  const need = (cond, where, msg) => {
    if (!cond) missing.push({ where, msg });
  };
  if (rawNotes && (typeof rawNotes !== 'object' || Array.isArray(rawNotes))) {
    return { errors: ['notes.json must be a JSON object'], warnings, missing, notes: normalizeNotes({}) };
  }
  if (rawNotes?.lang && !['zh', 'en'].includes(rawNotes.lang)) errors.push(`lang: use "zh" or "en", not "${rawNotes.lang}"`);
  const notes = normalizeNotes(rawNotes);
  for (const d of notes.duplicates) errors.push(`${d}: written twice under different spellings; keep one`);
  const ids = model.modules.map((m) => m.id);
  const known = new Set(ids);
  const range = ids.length ? `${ids[0]}–${ids[ids.length - 1]}` : 'none';

  const checkText = (where, value, { max } = {}) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const prose = value.replace(/`[^`]*`/g, '');
    if (PLACEHOLDER.some((re) => re.test(prose))) errors.push(`${where}: still has placeholder text`);
    for (const [re, hint] of JARGON) {
      if (re.test(prose)) errors.push(`${where}: ${hint}`);
    }
    for (const ref of new Set(prose.match(/\bp\d{2,3}\b/g) || [])) {
      if (known.has(displayId(ref))) errors.push(`${where}: write module ids in capitals, ${displayId(ref)} not ${ref}`);
    }
    for (const ref of new Set(prose.match(/\bP\d{2,3}\b/g) || [])) {
      if (!known.has(ref)) warnings.push(`${where}: ${ref} is not a module in this export (${range}); it stays plain text`);
    }
    if (/<\/?[a-z][^>]*>/i.test(value)) warnings.push(`${where}: HTML is shown as plain text; use \`code\` or **bold**`);
    if (max && [...value].length > max) warnings.push(`${where}: ${[...value].length} chars; keep it under ${max}`);
  };

  need(notes.tagline, 'tagline', 'one sentence on what this repo is');
  need(notes.overview, 'overview', '2–4 short paragraphs: what it is, the main path, which group matters');
  checkText('title', notes.title, { max: 40 });
  checkText('tagline', notes.tagline, { max: 90 });
  checkText('overview', notes.overview);

  for (const [id, m] of Object.entries(notes.modules)) {
    if (!known.has(id)) {
      errors.push(`modules.${id}: no such module in this export (${range})`);
      continue;
    }
    const title = model.byId.get(id).title;
    if (typeof m.source === 'string' && m.source && m.source !== title) {
      errors.push(`modules.${id}: written for "${m.source}", but ${id} in this export is "${title}". Rewrite it for the new module, or set source to the new title if it is the same code`);
    }
    if (m.layer && !layerOf(m.layer)) errors.push(`modules.${id}.layer: use 入口 / 应用 / 领域 / 存储 (or leave it out)`);
    if (m.layer && model.byId.get(id).degree === 0) errors.push(`modules.${id}.layer: a module with no calls to or from others has no layer`);
    checkText(`modules.${id}.name`, m.name, { max: 24 });
    checkText(`modules.${id}.role`, m.role, { max: 80 });
    checkText(`modules.${id}.detail`, m.detail);
  }
  for (const id of ids) {
    const m = notes.modules[id] || {};
    need(str(m.name), `modules.${id}.name`, 'a short human name');
    need(str(m.role), `modules.${id}.role`, 'one sentence: what this module does');
  }

  const groupIds = new Set(model.groups.map((g) => g.id));
  for (const [gid, g] of Object.entries(notes.groups)) {
    const real = model.groups.find((x) => x.id === gid);
    if (!groupIds.has(gid) || !real) {
      errors.push(`groups.${gid}: no such group in this export (${model.groups.map((x) => x.id).join(', ') || 'none'})`);
      continue;
    }
    if (Array.isArray(g.members)) {
      const a = g.members.map(displayId).sort().join(',');
      const b = real.members.slice().sort().join(',');
      if (a !== b) errors.push(`groups.${gid}: written for ${a || 'nothing'} but this export groups ${b}; rerun brief and rewrite this group`);
    }
    checkText(`groups.${gid}.name`, g.name, { max: 24 });
    checkText(`groups.${gid}.summary`, g.summary, { max: 160 });
  }
  for (const g of model.groups) need(str(notes.groups[g.id]?.name), `groups.${g.id}.name`, 'a short name for this group');

  if (model.groups.length) need(notes.guides.length, 'guides', 'at least one reading path');
  notes.guides.forEach((guide, gi) => {
    const where = `guides[${gi}]`;
    need(str(guide.title), `${where}.title`, 'say who this path is for');
    checkText(`${where}.title`, guide.title, { max: 40 });
    if (guide.steps.length < 2) errors.push(`${where}: a path needs at least two modules`);
    const seen = new Set();
    guide.steps.forEach((step, si) => {
      const at = `${where}.steps[${si}]`;
      if (!known.has(step.module)) {
        errors.push(`${at}: no module ${step.module || '(empty)'} in this export (${range})`);
        return;
      }
      if (seen.has(step.module)) errors.push(`${at}: ${step.module} already appears in this path`);
      seen.add(step.module);
      need(str(step.note), `${at}.note`, 'what to read here and why the next step follows');
      checkText(`${at}.note`, step.note, { max: 120 });
      if (si > 0) {
        const prev = guide.steps[si - 1].module;
        if (known.has(prev) && !edgeBetween(model, prev, step.module)) {
          const near = model.byId.get(prev);
          const options = [...new Set([...near.calls, ...near.calledBy].map((x) => x.id))];
          errors.push(`${at}: ${prev} and ${step.module} do not call each other; next to ${prev} you can go to ${options.join(', ') || 'nothing'}`);
        }
      }
    });
  });

  return { errors, warnings, missing, notes };
}
