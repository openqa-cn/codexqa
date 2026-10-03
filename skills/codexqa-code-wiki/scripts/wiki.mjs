#!/usr/bin/env node
// codexqa-code-wiki: index → facts brief → notes.json → one self-contained HTML wiki.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from './lib/model.mjs';
import { emptyNotes, validateNotes } from './lib/notes.mjs';
import { renderHtml } from './lib/render.mjs';
import { fileResolver, gitInfo, isLocalPath, looksLikePath, redact, slugOf, templateLinks, webLinks } from './lib/repo.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `Usage:
  node wiki.mjs brief <repo> [--limit N] [--lang zh|en] [--skip-index] [--inputs FILE] [--dir DIR]
  node wiki.mjs build <repo> [--draft] [--out FILE] [--source-url TEMPLATE] [--dir DIR]
  node wiki.mjs check <repo> [--dir DIR]

brief  index the repo (incremental), export \`codexqa wiki inputs\`, write
       <dir>/inputs.json, meta.json, notes.json (if missing) and brief.md,
       and print the brief. Read the brief, then fill notes.json.
build  validate notes.json and write the HTML wiki. --draft builds without
       written notes (rule-based names, clearly marked as a draft).
check  validate notes.json only.

<dir> defaults to ./.codexqa-wiki/<repo-name>. Set CODEXQA_BIN to use a
codexqa binary that is not on PATH.`;

const FLAGS = {
  brief: ['limit', 'lang', 'skip-index', 'inputs', 'dir'],
  build: ['draft', 'out', 'source-url', 'dir'],
  check: ['dir'],
};
const BOOL_FLAGS = new Set(['draft', 'skip-index']);
const VALUE_FLAGS = new Set(Object.values(FLAGS).flat().filter((k) => !BOOL_FLAGS.has(k)));

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const inline = eq < 0 ? undefined : a.slice(eq + 1);
      if (BOOL_FLAGS.has(k)) {
        if (inline !== undefined) throw new UsageError(`--${k} takes no value`);
        out[k] = true;
      } else if (!VALUE_FLAGS.has(k)) {
        throw new UsageError(`unknown option --${k}`);
      } else {
        const v = inline ?? argv[i += 1];
        if (v === undefined || (inline === undefined && v.startsWith('--'))) throw new UsageError(`--${k} needs a value`);
        out[k] = v;
      }
    } else out._.push(a);
  }
  return out;
}

function codexqa(args, { json = false } = {}) {
  const bin = process.env.CODEXQA_BIN || 'codexqa';
  const win = process.platform === 'win32';
  const quoted = win ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const r = spawnSync(win && !/[\\/]/.test(bin) ? `${bin}.cmd` : bin, quoted, {
    encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], shell: win,
  });
  if ((r.error && r.error.code === 'ENOENT') || (win && r.status === 1 && /not recognized/i.test(r.stderr || ''))) {
    throw new UsageError(`\`${bin}\` not found. Install it with: npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/ (or set CODEXQA_BIN)`);
  }
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const err = new Error(redact(`codexqa ${args.join(' ')} failed (exit ${r.status}):\n${(r.stderr || r.stdout || '').trim().split('\n').slice(0, 8).join('\n')}`));
    err.stderr = r.stderr;
    throw err;
  }
  if (!json) return r.stdout;
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(redact(`codexqa ${args.join(' ')} did not print JSON`));
  }
}

function readJson(path, what) {
  if (!existsSync(path)) throw new UsageError(`${what} not found at ${path}. Run \`brief\` first.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new UsageError(`${what} at ${path} is not valid JSON: ${e.message}`);
  }
}

function shortPath(p) {
  const rel = relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
}

function sh(arg) {
  return /^[\w@%+=:,./~-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, "'\\''")}'`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function workDir(repo, opts) {
  return resolve(opts.dir || join('.codexqa-wiki', slugOf(repo)));
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

function localTime(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function brief(repo, opts) {
  const dir = workDir(repo, opts);
  mkdirSync(dir, { recursive: true });
  const local = isLocalPath(repo);
  const git = local ? gitInfo(repo) : { name: slugOf(repo) };
  const target = local ? git.path : repo;
  const shown = local ? git.path : redact(repo);
  const metaPath = join(dir, 'meta.json');
  if (existsSync(metaPath)) {
    const before = readJson(metaPath, 'meta.json');
    if (before.target && before.target !== shown) {
      throw new UsageError(`${shortPath(dir)} already holds the wiki of ${before.target}. Pass --dir to keep both.`);
    }
  }
  const commands = [];
  if (opts.limit && !(Number.isInteger(Number(opts.limit)) && Number(opts.limit) > 0)) throw new UsageError('--limit must be a positive whole number');
  const limitArgs = opts.limit ? ['--limit', String(Number(opts.limit))] : [];
  let cliVersion = '';
  let raw;
  let stats = null;

  if (opts.inputs) {
    if (opts.limit) throw new UsageError('--limit has no effect with --inputs; export with `codexqa wiki inputs <repo> --limit N` instead');
    raw = readJson(resolve(opts.inputs), 'wiki inputs file');
  } else {
    cliVersion = codexqa(['--version']).trim();
    if (!opts['skip-index']) {
      process.stderr.write(`indexing ${shown} (incremental)…\n`);
      codexqa(['index', target]);
      commands.push(`codexqa index ${sh(shown)}`);
    }
    process.stderr.write('exporting wiki inputs (no model call)…\n');
    try {
      raw = codexqa(['wiki', 'inputs', target, ...limitArgs], { json: true });
    } catch (e) {
      const hint = git.subdir
        ? `\n${target} is a subfolder of the git repo ${git.gitRoot}. codexqa indexes whole repositories; run brief on ${git.gitRoot}, or copy the folder out and \`git init\` it.`
        : /not found|先 codexqa index|resolve db/i.test(e.message) ? '\nThe repo has no index yet. Drop --skip-index, or run `codexqa index <repo>`.' : '';
      throw new Error(redact(e.message) + hint);
    }
    commands.push(`codexqa wiki inputs ${sh(shown)}${limitArgs.length ? ` ${limitArgs.join(' ')}` : ''}`);
    try {
      stats = codexqa(['stats', target, '--format', 'json'], { json: true });
    } catch {
      stats = null;
    }
  }

  for (const row of raw.inputs || []) {
    delete row.system;
    delete row.user;
  }
  const model = buildModel(raw, { limit: opts.limit ? Number(opts.limit) : null });
  writeJson(join(dir, 'inputs.json'), raw);

  const meta = {
    repo: git.name,
    target: shown,
    path: local ? git.path : null,
    gitRoot: git.gitRoot || null,
    branch: git.branch || null,
    commit: git.commit || null,
    commitDate: git.commitDate || null,
    dirty: Boolean(git.dirty),
    remote: git.remote || null,
    generatedAt: localTime(),
    cliVersion,
    source: opts.inputs ? `saved export ${basename(opts.inputs)}` : 'codexqa wiki inputs',
    limit: opts.limit ? Number(opts.limit) : null,
    localNodes: stats?.local_nodes ?? null,
    stubShare: stats?.nodes_total ? (stats.stubs?.total || 0) / stats.nodes_total : null,
    collisions: stats?.collisions?.groups ?? null,
    commands,
  };
  writeJson(metaPath, meta);

  const notesPath = join(dir, 'notes.json');
  let notesState = 'created';
  let stale = [];
  if (existsSync(notesPath)) {
    notesState = 'kept';
    const kept = readJson(notesPath, 'notes.json');
    stale = validateNotes(kept, model).errors;
    if (opts.lang && (kept.lang || 'zh') !== opts.lang) {
      stale.unshift(`--lang ${opts.lang} ignored: notes.json is "${kept.lang || 'zh'}"; change its "lang" and rewrite the text`);
    }
  } else {
    writeJson(notesPath, emptyNotes(model, opts.lang === 'en' ? 'en' : 'zh'));
  }

  const buildCmd = `node ${sh(shortPath(join(SKILL_DIR, 'scripts', 'wiki.mjs')))} build ${sh(repo === '.' ? '.' : redact(repo))}${opts.dir ? ` --dir ${sh(opts.dir)}` : ''}`;
  const text = briefText(model, meta, { notesPath, notesState, stale, buildCmd });
  writeFileSync(join(dir, 'brief.md'), text);
  process.stdout.write(text);
}

function briefText(model, meta, { notesPath, notesState, stale, buildCmd }) {
  const L = [];
  const cov = meta.localNodes ? Math.round((model.totalSize / meta.localNodes) * 100) : null;
  L.push(`# Code wiki brief: ${meta.repo}${meta.branch ? `@${meta.branch}` : ''}${meta.commit ? ` (${meta.commit.slice(0, 7)})` : ''}`);
  L.push('');
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  L.push(`${n(model.modules.length, 'module', 'modules')} · ${n(model.groups.length, 'group', 'groups')} that call each other · ${model.standalone.length} standalone`
    + (cov !== null ? ` · these modules hold ${cov}% of indexed symbols (${model.totalSize}/${meta.localNodes})` : ''));
  if (meta.stubShare !== null && meta.stubShare > 0.2) L.push(`Index quality: ${Math.round(meta.stubShare * 100)}% stub nodes; group boundaries are less certain.`);
  if (model.communities > model.selected) L.push(`Truncated: ${model.selected} of ${model.communities} communities exported.`);
  if (meta.dirty) L.push('Working tree has uncommitted changes.');
  for (const w of model.warnings) L.push(`Warning: ${w}`);
  L.push('');
  L.push(`Notes file (${notesState}): ${shortPath(notesPath)}`);
  for (const s of stale) L.push(`  needs update: ${s}`);
  L.push(`Build: ${buildCmd}`);
  L.push('');
  L.push('## Groups');
  if (!model.groups.length) L.push('(none: no module calls another)');
  for (const g of model.groups) {
    L.push(`- ${g.id}: ${g.members.join(', ')}${g.hub ? ` · hub ${g.hub}` : ''}${g.guide.length ? ` · suggested path ${g.guide.join(' → ')}` : ''}`);
  }
  if (model.standalone.length) L.push(`- standalone: ${model.standalone.join(', ')}`);
  L.push('');
  L.push('## Modules');
  for (const m of model.modules) {
    L.push('');
    L.push(`### ${m.id} ${m.title}`);
    L.push(`${m.size} symbols · ${m.fileCount} files${m.languages.length ? ` · ${m.languages.join('/')}` : ''}${m.group ? ` · ${m.group}` : ' · standalone'}${m.hub ? ' · hub' : ''}`);
    if (m.files.length) L.push(`files: ${m.files.slice(0, 6).join(', ')}${m.files.length > 6 ? ` (+${m.files.length - 6})` : ''}`);
    if (m.calls.length) L.push(`calls: ${m.calls.map((x) => `${x.id} (${x.weight || '?'})`).join(', ')}`);
    if (m.calledBy.length) L.push(`called by: ${m.calledBy.map((x) => `${x.id} (${x.weight || '?'})`).join(', ')}`);
    if (m.signatures.length) L.push(`public: ${m.signatures.map((s) => `${s.name}${s.kind ? ` [${s.kind}]` : ''}${s.calledBy ? ` ×${s.calledBy}` : ''}${s.defs > 1 ? ` (${s.defs} defs)` : ''}`).join(', ')}`);
    for (const f of m.flows) L.push(`flow: ${f.method} → ${f.steps.join(' → ')}${f.more > 0 ? ` (+${f.more})` : ''}`);
    if (m.outside.length) L.push(`also related outside this export: ${m.outside.join(', ')}`);
  }
  L.push('');
  return `${L.join('\n')}\n`;
}

function loadForBuild(repo, opts) {
  const dir = workDir(repo, opts);
  const inputs = readJson(join(dir, 'inputs.json'), 'inputs.json');
  const meta = readJson(join(dir, 'meta.json'), 'meta.json');
  if (isLocalPath(repo) && meta.path && gitInfo(repo).path !== meta.path) {
    throw new UsageError(`${shortPath(dir)} holds the wiki of ${meta.path}, not ${repo}. Pass the same --dir you gave brief.`);
  }
  const notesPath = join(dir, 'notes.json');
  const notes = existsSync(notesPath) ? readJson(notesPath, 'notes.json') : null;
  const model = buildModel(inputs, { limit: meta.limit });
  return { dir, inputs, meta, notes, model };
}

// Prints validation results; returns true when the notes are good enough to build.
function report({ errors, warnings, missing }, { draft, cmd = 'build' }) {
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  for (const e of errors) process.stderr.write(`error: ${e}\n`);
  if (missing.length) {
    const label = draft ? 'draft' : 'error';
    if (missing.length > 10) {
      process.stderr.write(`${label}: ${missing.length} fields in notes.json are not written yet (${missing.slice(0, 5).map((m) => m.where).join(', ')}, …). Read brief.md and fill them in.\n`);
    } else {
      for (const m of missing) process.stderr.write(`${label}: ${m.where}: ${m.msg}\n`);
    }
  }
  if (errors.length) process.stderr.write(`\n${errors.length} problem(s) in notes.json must be fixed.\n`);
  else if (missing.length && !draft) {
    process.stderr.write(cmd === 'build'
      ? '\nWrite the missing fields, or add --draft for a rule-based draft.\n'
      : '\nWrite the missing fields (or run `build --draft` for a rule-based draft).\n');
  }
  return errors.length === 0 && (draft || missing.length === 0);
}

function check(repo, opts) {
  const { notes, model } = loadForBuild(repo, opts);
  const result = validateNotes(notes || {}, model);
  if (!report(result, { draft: false, cmd: 'check' })) return 1;
  process.stdout.write(`notes.json OK (${result.warnings.length} warning(s))\n`);
  return 0;
}

function build(repo, opts) {
  const tpl = opts['source-url'];
  if (tpl && (!/^https?:\/\//i.test(tpl) || !tpl.includes('{path}'))) {
    throw new UsageError('--source-url must be an http(s) URL containing {path}, e.g. https://host/repo/blob/{commit}/{path}');
  }
  const { notes: rawNotes, meta, model } = loadForBuild(repo, opts);
  const draft = Boolean(opts.draft);
  const result = validateNotes(rawNotes || {}, model);
  const { missing, notes } = result;
  if (!report(result, { draft })) return 1;

  const links = templateLinks(opts['source-url']) || webLinks(meta.remote);
  const prefix = meta.path && meta.gitRoot ? relative(meta.gitRoot, meta.path).split('\\').join('/') : '';
  const ref = meta.commit || meta.branch || (links && links.needsRef === false ? '' : null);
  const repoView = {
    name: meta.repo,
    branch: meta.branch,
    commit: meta.commit,
    commitDate: meta.commitDate,
    dirty: meta.dirty,
    commitUrl: links?.commit && meta.commit ? links.commit(meta.commit) : null,
    resolveFile: meta.path ? fileResolver(meta.path) : null,
    fileUrl: links && ref !== null && ref !== undefined ? (p) => links.file(ref, prefix ? `${prefix}/${p}` : p) : null,
  };
  if (meta.path && !existsSync(meta.path)) repoView.resolveFile = null;

  const css = readFileSync(join(SKILL_DIR, 'assets', 'wiki.css'), 'utf8');
  const js = readFileSync(join(SKILL_DIR, 'assets', 'wiki.js'), 'utf8');
  const safeMeta = { ...meta, target: redact(meta.target), commands: (meta.commands || []).map(redact) };
  const html = renderHtml({ model, notes, draft: draft && missing.length > 0, repo: repoView, meta: safeMeta, css, js });
  const leaks = stripTags(html).match(/(?:^|\s)(undefined|NaN|\[object Object\])(?=\s|$)/g);
  if (leaks) process.stderr.write(`warning: page text contains ${[...new Set(leaks.map((s) => s.trim()))].join(', ')}; please report this as a renderer bug\n`);

  const out = resolve(opts.out || `codexqa-code-wiki-${slugOf(repo)}-${stamp()}.html`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  process.stdout.write(`${out}\n`);
  return 0;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<code>[\s\S]*?<\/code>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${USAGE}\n`);
    return 2;
  }
  const [cmd, repo] = opts._;
  if (opts.help || !cmd) {
    process.stdout.write(`${USAGE}\n`);
    return opts.help ? 0 : 2;
  }
  if (!['brief', 'build', 'check'].includes(cmd) || !repo) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const unknown = Object.keys(opts).filter((k) => k !== '_' && !FLAGS[cmd].includes(k));
  if (unknown.length || opts._.length > 2) {
    const what = unknown.length ? `unknown option ${unknown.map((k) => `--${k}`).join(', ')}` : `unexpected argument ${opts._.slice(2).join(' ')}`;
    process.stderr.write(`${what} for \`${cmd}\`\n\n${USAGE}\n`);
    return 2;
  }
  if (looksLikePath(repo) && !isLocalPath(repo)) {
    process.stderr.write(`no such folder: ${repo}\n`);
    return 2;
  }
  if (opts.lang && !['zh', 'en'].includes(opts.lang)) {
    process.stderr.write('--lang must be zh or en\n');
    return 2;
  }
  try {
    if (cmd === 'brief') {
      brief(repo, opts);
      return 0;
    }
    if (cmd === 'check') return check(repo, opts);
    return build(repo, opts);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
