import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildModel } from '../scripts/lib/model.mjs';
import { emptyNotes, validateNotes } from '../scripts/lib/notes.mjs';
import { renderHtml } from '../scripts/lib/render.mjs';
import { layoutGraph, sampleSegments } from '../scripts/lib/layout.mjs';
import { esc, inline, blocks, fit, safeUrl, textWidth } from '../scripts/lib/text.mjs';
import { strings } from '../scripts/lib/strings.mjs';
import { CHAIN, SKILL_DIR, fixture, makeInputs } from './helpers.mjs';

const css = readFileSync(join(SKILL_DIR, 'assets', 'wiki.css'), 'utf8');
const js = readFileSync(join(SKILL_DIR, 'assets', 'wiki.js'), 'utf8');

function render(inputs, rawNotes, extra = {}) {
  const model = buildModel(inputs);
  const { notes } = validateNotes(rawNotes ?? emptyNotes(model), model);
  return { model, html: renderHtml({ model, notes, css, js, ...extra }) };
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ');
}

function ids(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

function cards(svg) {
  return [...svg.matchAll(/<rect class="card" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((m) => m.slice(1).map(Number));
}

function assertSound(html) {
  assert.doesNotMatch(visibleText(html), /(^|\s)(undefined|NaN|null|\[object Object\])(\s|$)/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet|https?:\/\/cdn/i, 'page must be self-contained');
  const all = ids(html);
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(all.has(target), `link #${target} has no target`);
  }
  const index = JSON.parse(/<script type="application\/json" id="wiki-index">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.ok(Array.isArray(index));
  return index;
}

test('text helpers escape everything and only add known markup', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  const html = inline('see P01 and P99, **bold**, `<b>P01</b>`', (id) => id === 'P01');
  assert.match(html, /<a class="mref" href="#P01" data-mod="P01">P01<\/a>/);
  assert.match(html, /P99/);
  assert.doesNotMatch(html, /href="#P99"/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>&lt;b&gt;P01&lt;\/b&gt;<\/code>/);
  assert.equal(blocks('- a\n- b\n\npara\nline'), '<ul><li>a</li><li>b</li></ul>\n<p>para line</p>');
  assert.equal(textWidth('中文'), 2);
  assert.ok(fit('一二三四五六七八九十', 5).endsWith('…'));
  assert.ok(textWidth(fit('一二三四五六七八九十', 5)) <= 5);
  assert.equal(fit('short', 20), 'short');
  assert.equal(safeUrl('https://github.com/a/b'), 'https://github.com/a/b');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:x', 'data:text/html,x', '//evil', 'https://a b', '', null]) {
    assert.equal(safeUrl(bad), '', String(bad));
  }
});

test('real export + fixture notes: complete, linked, self-contained page', () => {
  const { model, html } = render(fixture('inputs.json'), fixture('notes.json'), {
    meta: fixture('meta.json'),
    repo: { name: 'codexqa', branch: 'main', commit: 'a76bb7f6dbc44c9c9c9f2beea72cade693bfa4f5', commitDate: '2026-09-28T18:11:08+08:00' },
  });
  const index = assertSound(html);
  assert.equal(index.filter((x) => x.k === 'm').length, 12);
  assert.ok(index.filter((x) => x.k === 's').length > 20);
  assert.ok(index.filter((x) => x.k === 'f').length > 20);
  const all = ids(html);
  for (const m of model.modules) assert.ok(all.has(m.id), `card ${m.id}`);
  for (const id of ['top', 'start', 'what', 'map', 'modules', 'standalone', 'about', 'q', 'q-results', 'nav', 'main']) {
    assert.ok(all.has(id), `#${id}`);
  }
  assert.match(html, /<html lang="zh-CN"/);
  assert.match(html, /CodexQA 技能仓库/);
  assert.match(html, /缺陷扫描与诊断/);
  assert.doesNotMatch(html, /class="banner draft"/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.doesNotMatch(html, /<h4[\s>]/, 'card labels are not headings (heading order)');
  assert.ok(html.length < 400_000, `page is ${html.length} bytes`);
});

test('draft build: banner, rule-based names, auto reading paths', () => {
  const { html } = render(fixture('inputs.json'), null, { draft: true, meta: fixture('meta.json') });
  assertSound(html);
  assert.match(html, /class="banner draft"/);
  assert.match(html, /id="start"/);
  assert.match(html, /class="guide/);
});

test('English notes switch every UI string', () => {
  const model = buildModel(makeInputs(CHAIN));
  const n = emptyNotes(model, 'en');
  const { html } = render(makeInputs(CHAIN), n, { draft: true });
  assertSound(html);
  assert.match(html, /<html lang="en"/);
  const en = strings('en');
  const zh = strings('zh');
  assert.ok(html.includes(esc(en.mapTitle)));
  assert.ok(!html.includes(zh.mapTitle));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'zh and en define the same strings');
});

test('hostile text from notes and from the export is inert', () => {
  const evil = '</script><script>alert(1)</script><img src=x onerror=alert(2)>';
  const inputs = makeInputs({
    modules: [
      { id: 'p01', title: `a · ${evil}`, size: 3, files: [`src/${evil}.ts`], sigs: [{ name: evil, kind: 'function', params: JSON.stringify([{ name: evil }]), returns: evil, called_by: 3, is_public: true }] },
      { id: 'p02', title: 'b', size: 2 },
    ],
    calls: [['p01', 'p02', 2]],
  });
  const notes = {
    title: evil,
    tagline: evil,
    overview: `${evil}\n\n- ${evil}`,
    modules: { P01: { name: evil, role: evil, detail: evil }, P02: { name: 'b', role: 'b' } },
    groups: { G1: { name: evil, summary: evil } },
    guides: [{ title: evil, steps: [{ module: 'P01', note: evil }, { module: 'P02', note: evil }] }],
  };
  const { html } = render(inputs, notes, { meta: { repo: evil }, repo: { name: evil, branch: evil, commit: `${evil}0000000`, commitUrl: `javascript:alert(3)` } });
  assertSound(html);
  assert.equal((html.match(/<script/g) || []).length, (html.match(/<\/script>/g) || []).length);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /href="javascript:/i);
  const index = JSON.parse(/id="wiki-index">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.ok(index.some((x) => x.k === 's' && x.l === evil), 'index JSON round-trips the raw text');
});

test('files link only when the path is real: resolved, or already has an extension', () => {
  const inputs = makeInputs({
    ...CHAIN,
    modules: CHAIN.modules.map((m) => (m.id === 'p03' ? { ...m, files: ['src/db.ts', 'pkg/util', 'pkg/found'] } : m)),
  });
  const repo = { fileUrl: (p) => `https://h.example/blob/main/${p}`, resolveFile: (p) => (p === 'pkg/found' ? 'pkg/found.py' : p) };
  const { html } = render(inputs, null, { draft: true, repo });
  assert.match(html, /href="https:\/\/h\.example\/blob\/main\/src\/db\.ts"/);
  assert.match(html, /href="https:\/\/h\.example\/blob\/main\/pkg\/found\.py"/);
  assert.doesNotMatch(html, /blob\/main\/pkg\/util"/);
  assert.match(html, /data-file="pkg\/util"/);
});

test('edge cases: no modules, one module, only standalone modules', () => {
  const none = render({ inputs: [{ kind: 'architecture', id: 'architecture', input: [] }] }, null, { draft: true });
  assertSound(none.html);
  const one = render(makeInputs({ modules: [{ id: 'p01', title: 'solo', size: 5 }] }), null, { draft: true });
  assertSound(one.html);
  assert.equal(one.model.groups.length, 0);
  assert.match(one.html, /id="P01"/);
  const loose = render(makeInputs({ modules: [{ id: 'p01', title: 'a', size: 5 }, { id: 'p02', title: 'b', size: 1 }] }), null, { draft: true });
  assertSound(loose.html);
  assert.equal(loose.model.standalone.length, 2);
});

test('truncated, partial and dirty exports say so up front', () => {
  const { html } = render(makeInputs({ ...CHAIN, communities: 40, selected: 4 }), null, { draft: true, repo: { dirty: true } });
  const t = strings('zh');
  assert.ok(html.includes(esc(t.truncated(4, 40))));
  assert.ok(html.includes(esc(t.dirty)));
  const partial = render(makeInputs(CHAIN), null, { draft: true, meta: { localNodes: 1000 } });
  assert.ok(partial.html.includes(esc(t.partial(4, 23))));
});

function edgesThroughCards(svg) {
  const cardsById = new Map([...svg.matchAll(/data-mod="(P\d+)"[^>]*>(?:<title>[^<]*<\/title>)?<rect class="card" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((m) => [m[1], m.slice(2).map(Number)]));
  const bad = [];
  for (const m of svg.matchAll(/<g class="edge[^"]*" data-from="(P\d+)" data-to="(P\d+)"><path class="line" d="([^"]+)"/g)) {
    const [, from, to, d] = m;
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const pts = [];
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const segs = [];
    for (let i = 0; i + 3 < pts.length; i += 3) segs.push([pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]);
    for (const [x, y] of sampleSegments(segs, 40)) {
      for (const [id, [cx, cy, w, h]] of cardsById) {
        if (id === from || id === to) continue;
        if (x > cx + 2 && x < cx + w - 2 && y > cy + 2 && y < cy + h - 2) bad.push(`${from}→${to} crosses ${id}`);
      }
    }
  }
  return [...new Set(bad)];
}

test('layout: edges go around cards, not through them', () => {
  const t = strings('zh');
  const draw = (spec) => layoutGraph(buildModel(makeInputs(spec)), { label: (id) => id, groupLabel: (g) => g.id, t }).svg;
  const mods = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, title: `m${i + 1}`, size: 10 }));
  const cases = {
    'chain with a skip': { modules: mods(3), calls: [['p01', 'p02', 9], ['p02', 'p03', 9], ['p01', 'p03', 9]] },
    'star with 6 leaves': { modules: mods(7), calls: [2, 3, 4, 5, 6, 7].map((i) => ['p01', `p0${i}`, 10 + i]) },
    '5-chain with a skip': { modules: mods(5), calls: [['p01', 'p02', 5], ['p02', 'p03', 5], ['p03', 'p04', 5], ['p04', 'p05', 5], ['p01', 'p05', 5]] },
    'same row pair over a card': { modules: mods(4), calls: [['p01', 'p02', 5], ['p01', 'p03', 5], ['p01', 'p04', 5], ['p02', 'p04', 2]] },
  };
  for (const [name, spec] of Object.entries(cases)) {
    assert.deepEqual(edgesThroughCards(draw(spec)), [], name);
  }
  assert.deepEqual(edgesThroughCards(render(fixture('inputs.json'), fixture('notes.json')).html), [], 'real export');
});

test('layout: big graphs stay finite, inside the canvas, and never overlap', () => {
  const modules = Array.from({ length: 40 }, (_, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, title: `m${i + 1}`, size: 10 + ((i * 37) % 200) }));
  const calls = [];
  for (let i = 0; i < 40; i += 1) {
    if (i % 7 !== 6) calls.push([modules[i].id, modules[(i + 1) % 40].id, 1 + ((i * 13) % 90)]);
    if (i % 3 === 0) calls.push([modules[i].id, modules[(i + 5) % 40].id, 2 + (i % 11)]);
    if (i % 4 === 0) calls.push([modules[(i + 2) % 40].id, modules[i].id, 3]);
  }
  modules.push({ id: 'p41', title: 'alone', size: 4 });
  const model = buildModel(makeInputs({ modules, calls }));
  const t = strings('zh');
  const { svg, width, height } = layoutGraph(model, { label: (id) => id, groupLabel: (g) => g.id, t });
  assert.ok(Number.isFinite(width) && Number.isFinite(height));
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
  const boxes = cards(svg);
  assert.equal(boxes.length, 41);
  for (const [x, y, w, h] of boxes) {
    assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, `card at ${x},${y} is outside ${width}x${height}`);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [ax, ay, aw, ah] = boxes[i];
      const [bx, by, bw, bh] = boxes[j];
      const apart = ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay;
      assert.ok(apart, `cards ${i} and ${j} overlap`);
    }
  }
  const minor = (svg.match(/<g class="edge[^"]*\bminor\b/g) || []).length;
  assert.ok(minor > 0, 'dense groups hide their weaker calls');
  const drawn = [...svg.matchAll(/<g class="(edge[^"]*)" data-from="(P\d+)" data-to="(P\d+)"/g)]
    .filter((m) => !/\bminor\b/.test(m[1])).map((m) => [m[2], m[3]]);
  for (const g of model.groups) {
    const seen = new Set([g.members[0]]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [a, b] of drawn) {
        if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; }
      }
    }
    assert.equal(seen.size, g.members.length, `${g.id} stays connected by drawn edges`);
  }
  const simple = layoutGraph(buildModel(makeInputs(CHAIN)), { label: (id) => id, groupLabel: (g) => g.id, t });
  assert.equal(simple.minor, 0);
  const edgeCount = (svg.match(/<g class="edge[ "]/g) || []).length;
  assert.equal(edgeCount, model.edges.length);
  assert.equal(layoutGraph(model, { label: (id) => id, groupLabel: (g) => g.id, t }).svg, svg, 'layout is deterministic');
});
