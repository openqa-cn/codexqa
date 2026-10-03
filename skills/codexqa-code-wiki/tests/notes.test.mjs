import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../scripts/lib/model.mjs';
import { emptyNotes, layerOf, validateNotes } from '../scripts/lib/notes.mjs';
import { CHAIN, fixture, makeInputs } from './helpers.mjs';

const model = buildModel(makeInputs(CHAIN));

function good() {
  return {
    lang: 'zh',
    title: '示例',
    tagline: '一个三层的小服务。',
    overview: 'P01 接请求，P02 编排，P03 存数据。',
    groups: { G1: { name: '主链路', summary: '请求从 P01 进来。', members: ['P01', 'P02', 'P03'] } },
    modules: {
      P01: { name: '命令行', role: '解析参数。', layer: '入口' },
      P02: { name: '引擎', role: '编排步骤。', layer: 'application' },
      P03: { name: '存储', role: '读写数据库。' },
      P04: { name: '脚本', role: '零散脚本。' },
    },
    guides: [{ title: '改存储', steps: [{ module: 'P01', note: '先看入口。' }, { module: 'P02', note: '再看编排。' }, { module: 'P03', note: '最后存储。' }] }],
  };
}

test('complete notes pass with no errors or missing fields', () => {
  const r = validateNotes(good(), model);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
});

test('the scaffold has every field but nothing written', () => {
  const r = validateNotes(emptyNotes(model), model);
  assert.deepEqual(r.errors, []);
  const where = r.missing.map((m) => m.where);
  for (const w of ['tagline', 'overview', 'modules.P01.name', 'modules.P04.role', 'groups.G1.name', 'guides[0].title', 'guides[0].steps[0].note']) {
    assert.ok(where.includes(w), `missing should include ${w}`);
  }
  assert.deepEqual(emptyNotes(model).guides[0].steps.map((s) => s.module), ['P01', 'P02', 'P03']);
});

test('unknown modules and groups are errors that name the valid range', () => {
  const n = good();
  n.modules.P09 = { name: 'x', role: 'y' };
  n.groups.G7 = { name: 'x' };
  const r = validateNotes(n, model);
  assert.ok(r.errors.some((e) => e.includes('modules.P09') && e.includes('P01–P04')));
  assert.ok(r.errors.some((e) => e.startsWith('groups.G7')));
});

test('stale group members are caught', () => {
  const n = good();
  n.groups.G1.members = ['P01', 'P02'];
  assert.match(validateNotes(n, model).errors.join('\n'), /groups\.G1: written for P01,P02 but this export groups P01,P02,P03/);
});

test('guide steps must call each other and the error lists real neighbours', () => {
  const n = good();
  n.guides = [{ title: 't', steps: [{ module: 'P01', note: 'a' }, { module: 'P03', note: 'b' }] }];
  assert.match(validateNotes(n, model).errors.join('\n'), /P01 and P03 do not call each other; next to P01 you can go to P02/);
});

test('guide shape errors: too short, unknown, repeated', () => {
  const n = good();
  n.guides = [
    { title: 't', steps: ['P01'] },
    { title: 't', steps: ['P01', 'P77'] },
    { title: 't', steps: ['P02', 'P03', 'P02'] },
  ];
  const errors = validateNotes(n, model).errors.join('\n');
  assert.match(errors, /guides\[0\]: a path needs at least two modules/);
  assert.match(errors, /guides\[1\]\.steps\[1\]: no module P77/);
  assert.match(errors, /guides\[2\]\.steps\[2\]: P02 already appears/);
});

test('layers: aliases accepted, unknown rejected, standalone modules have none', () => {
  assert.equal(layerOf('入口'), 'entry');
  assert.equal(layerOf('App'), 'application');
  assert.equal(layerOf('nope'), null);
  const n = good();
  n.modules.P02.layer = 'middleware';
  n.modules.P04.layer = '存储';
  const errors = validateNotes(n, model).errors.join('\n');
  assert.match(errors, /modules\.P02\.layer: use/);
  assert.match(errors, /modules\.P04\.layer: a module with no calls/);
});

test('placeholders and internal field names are errors', () => {
  const n = good();
  n.tagline = '待填';
  n.overview = '见 cross_community 和 deps。';
  n.modules.P01.role = 'TODO';
  n.modules.P02.role = '被 called_by 引用';
  const errors = validateNotes(n, model).errors.join('\n');
  assert.match(errors, /tagline: still has placeholder/);
  assert.match(errors, /overview: `cross_community`/);
  assert.match(errors, /overview: `deps`/);
  assert.match(errors, /modules\.P01\.role: still has placeholder/);
  assert.match(errors, /modules\.P02\.role: 内部字段名/);
});

test('placeholder and jargon checks skip code spans and ordinary words', () => {
  const n = good();
  n.overview = 'A Todo list API. Renders `{{ user.name }}` Jinja templates; start at `deps.py` and `called_by()`.';
  n.modules.P01.role = 'Handles todo items and tbd fields.';
  const r = validateNotes(n, model);
  assert.deepEqual(r.errors, []);
});

test('notes written for another module are caught after a re-index', () => {
  const scaffold = emptyNotes(model);
  assert.equal(scaffold.modules.P02.source, 'core · engine');
  const n = good();
  n.modules.P02.source = 'core · engine';
  assert.deepEqual(validateNotes(n, model).errors, []);
  n.modules.P02.source = 'store · db';
  assert.match(validateNotes(n, model).errors.join('\n'), /modules\.P02: written for "store · db", but P02 in this export is "core · engine"/);
});

test('the same module written twice under different spellings is an error', () => {
  const n = good();
  n.modules.p1 = { name: 'x', role: 'y' };
  assert.match(validateNotes(n, model).errors.join('\n'), /modules\.P01: written twice/);
});

test('module ids: lowercase real ids are errors, p95-style words and code spans are fine', () => {
  const n = good();
  n.overview = 'p01 先跑；p95 延迟低于 10ms；`p02` 是变量名。';
  const r = validateNotes(n, model);
  assert.deepEqual(r.errors, ['overview: write module ids in capitals, P01 not p01']);
});

test('references to modules outside the export warn', () => {
  const n = good();
  n.overview = '参考 P42。';
  const r = validateNotes(n, model);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /overview: P42 is not a module in this export/);
});

test('length and HTML are warnings, not errors', () => {
  const n = good();
  n.modules.P01.name = '一'.repeat(30);
  n.modules.P02.role = '<b>粗体</b>';
  const r = validateNotes(n, model);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /modules\.P01\.name: 30 chars/);
  assert.match(r.warnings.join('\n'), /modules\.P02\.role: HTML/);
});

test('bad top-level shapes', () => {
  assert.deepEqual(validateNotes([], model).errors, ['notes.json must be a JSON object']);
  assert.match(validateNotes({ ...good(), lang: 'fr' }, model).errors.join(), /lang: use "zh" or "en"/);
  const r = validateNotes({ modules: { p1: { name: 'x', role: 'y' } }, guides: [{ title: 't', steps: ['p01', 'p02'] }] }, model);
  assert.equal(r.notes.modules.P01.name, 'x');
  assert.deepEqual(r.notes.guides[0].steps.map((s) => s.module), ['P01', 'P02']);
});

test('the shipped fixture notes pass against the real export', () => {
  const r = validateNotes(fixture('notes.json'), buildModel(fixture('inputs.json')));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.missing, []);
});
