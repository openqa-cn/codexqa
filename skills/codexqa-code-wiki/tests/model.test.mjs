import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, displayId, edgeBetween, weightFrom, autoGuides } from '../scripts/lib/model.mjs';
import { CHAIN, fixture, makeInputs } from './helpers.mjs';

test('displayId normalises community ids', () => {
  assert.equal(displayId('p1'), 'P01');
  assert.equal(displayId('p07'), 'P07');
  assert.equal(displayId('P12'), 'P12');
  assert.equal(displayId(' p100 '), 'P100');
  assert.equal(displayId(null), '');
});

test('rejects input without an inputs array or architecture row', () => {
  assert.throws(() => buildModel({}), /no `inputs` array/);
  assert.throws(() => buildModel({ inputs: [] }), /no architecture row/);
});

test('chain: weighted edges, dominant direction, groups, hub and guide', () => {
  const m = buildModel(makeInputs(CHAIN));
  assert.deepEqual(m.modules.map((x) => x.id), ['P01', 'P02', 'P03', 'P04']);
  assert.equal(m.edges.length, 2);
  const core = edgeBetween(m, 'P03', 'P02');
  assert.equal(core.from, 'P02');
  assert.equal(core.to, 'P03');
  assert.equal(core.weight, 50);
  assert.equal(core.back, 4);
  assert.equal(core.both, true);
  assert.equal(weightFrom(m, 'P03', 'P02'), 4);
  assert.equal(weightFrom(m, 'P01', 'P04'), null);

  assert.equal(m.groups.length, 1);
  assert.deepEqual(m.groups[0].members.slice().sort(), ['P01', 'P02', 'P03']);
  assert.equal(m.groups[0].hub, 'P02');
  assert.equal(m.byId.get('P02').hub, true);
  assert.deepEqual(m.standalone, ['P04']);
  assert.equal(m.byId.get('P04').group, undefined);

  // Starts where calls leave more than they arrive and follows the heaviest call.
  assert.deepEqual(m.groups[0].guide, ['P01', 'P02', 'P03']);
  assert.deepEqual(autoGuides(m)[0].steps.map((s) => s.module), ['P01', 'P02', 'P03']);
  assert.equal(m.totalSize, 230);
  assert.equal(m.maxSize, 120);
});

test('star group: the centre is the hub even when a leaf is heavier', () => {
  const m = buildModel(makeInputs({
    modules: [
      { id: 'p01', title: 'a', size: 10 },
      { id: 'p02', title: 'b', size: 900 },
      { id: 'p03', title: 'c', size: 10 },
      { id: 'p04', title: 'd', size: 10 },
    ],
    calls: [['p01', 'p02', 500], ['p01', 'p03', 5], ['p01', 'p04', 5]],
  }));
  assert.equal(m.groups[0].hub, 'P01');
});

test('two-module groups have no hub', () => {
  const m = buildModel(makeInputs({
    modules: [{ id: 'p01', title: 'a', size: 1 }, { id: 'p02', title: 'b', size: 2 }],
    calls: [['p01', 'p02', 3]],
  }));
  assert.equal(m.groups[0].hub, null);
});

test('listed deps without counts become unknown edges; outside deps are kept apart', () => {
  const m = buildModel(makeInputs({
    modules: [
      { id: 'p01', title: 'a', size: 1, deps: ['p02', 'p09'] },
      { id: 'p02', title: 'b', size: 1, deps: [] },
    ],
  }));
  assert.equal(m.edges.length, 1);
  assert.equal(m.edges[0].known, false);
  assert.deepEqual(m.byId.get('P01').outside, ['P09']);
  // P01 lists P02, so P01 uses P02; nothing says P02 uses P01.
  assert.deepEqual([m.edges[0].from, m.edges[0].to, m.edges[0].both], ['P01', 'P02', false]);
  assert.deepEqual(m.byId.get('P01').calls.map((x) => x.id), ['P02']);
  assert.deepEqual(m.byId.get('P02').calls.map((x) => x.id), []);
  assert.deepEqual(m.byId.get('P02').calledBy.map((x) => x.id), ['P01']);

  const back = buildModel(makeInputs({
    modules: [{ id: 'p01', title: 'a', size: 1, deps: [] }, { id: 'p02', title: 'b', size: 1, deps: ['p01'] }],
  }));
  assert.deepEqual([back.edges[0].from, back.edges[0].to], ['P02', 'P01'], 'direction follows the lister, not id order');
  const mutual = buildModel(makeInputs({
    modules: [{ id: 'p01', title: 'a', size: 1, deps: ['p02'] }, { id: 'p02', title: 'b', size: 1, deps: ['p01'] }],
  }));
  assert.equal(mutual.edges[0].both, true);
});

test('module ids that could break the page are rejected', () => {
  const inputs = makeInputs({ modules: [{ id: 'p01', title: 'a', size: 1 }] });
  inputs.inputs[0].input[0].id = '"><svg onload=x>';
  assert.throws(() => buildModel(inputs), /unexpected module id/);
});

test('overview relations only fill directions the page digests left empty', () => {
  const m = buildModel(makeInputs({
    modules: [{ id: 'p01', title: 'a', size: 1 }, { id: 'p02', title: 'b', size: 1 }],
    calls: [['p01', 'p02', 10]],
    relations: [{ from: 'a', to: 'b', count: 999 }, { from: 'b', to: 'a', count: 2 }],
  }));
  assert.equal(weightFrom(m, 'P01', 'P02'), 10);
  assert.equal(weightFrom(m, 'P02', 'P01'), 2);
});

test('duplicate titles warn instead of mis-assigning weights', () => {
  const m = buildModel(makeInputs({
    modules: [{ id: 'p01', title: 'same', size: 1 }, { id: 'p02', title: 'same', size: 1 }, { id: 'p03', title: 'c', size: 1 }],
    calls: [['p03', 'p01', 5]],
  }));
  assert.match(m.warnings.join('\n'), /share the title "same"/);
  // P01's own page names its caller by a unique title, so that weight is safe;
  // P03's page names "same", which could be either module, so it is dropped.
  assert.equal(weightFrom(m, 'P03', 'P01'), 5);
  assert.equal(edgeBetween(m, 'P03', 'P02'), null);
});

test('signatures: public top-level only, same names folded, sorted by use', () => {
  const sig = (name, called_by, extra = {}) => ({ name, kind: 'function', params: '[{"name":"a"}]', returns: 'void', called_by, is_public: true, ...extra });
  const m = buildModel(makeInputs({
    modules: [{
      id: 'p01',
      title: 'a',
      size: 1,
      sigs: [sig('main', 1), sig('main', 9), sig('run', 5), sig('hidden', 99, { is_public: false }), sig('method', 50, { parent: 'C' }), sig('bad', 2, { params: '{not json' })],
      flows: [{ method: 'run', called_by: 3, steps: [{ kind: 'calls', target: 'x' }, { kind: 'calls', target: 'x' }, { kind: 'reads', target: 'y' }, { kind: 'calls', target: 'z' }] }],
    }],
  }));
  const sigs = m.byId.get('P01').signatures;
  assert.deepEqual(sigs.map((s) => s.name), ['main', 'run', 'bad']);
  assert.equal(sigs[0].defs, 2);
  assert.equal(sigs[0].calledBy, 9);
  assert.deepEqual(sigs[2].params, []);
  assert.deepEqual(m.byId.get('P01').flows, [{ method: 'run', calledBy: 3, steps: ['x', 'z'], more: 0 }]);
});

test('truncated exports keep the community counts', () => {
  const m = buildModel(makeInputs({ ...CHAIN, communities: 30, selected: 4 }), { limit: 4 });
  assert.equal(m.communities, 30);
  assert.equal(m.selected, 4);
  assert.equal(m.limit, 4);
});

test('real export: deterministic model for the codexqa repo', () => {
  const inputs = fixture('inputs.json');
  const a = buildModel(inputs);
  const b = buildModel(JSON.parse(JSON.stringify(inputs)));
  assert.equal(a.modules.length, 12);
  assert.deepEqual(a.groups.map((g) => g.members.slice().sort()), [['P02', 'P05', 'P11', 'P12'], ['P04', 'P06', 'P07'], ['P03', 'P10'], ['P08', 'P09']]);
  assert.deepEqual(a.groups.map((g) => g.hub), ['P02', 'P04', null, null]);
  assert.deepEqual(a.standalone, ['P01']);
  assert.deepEqual(a.edges, b.edges);
  assert.deepEqual(a.groups, b.groups);
  for (const e of a.edges) {
    assert.ok(e.weight >= e.back, `${e.from}→${e.to} should point the heavier way`);
  }
});
