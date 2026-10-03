// Deterministic SVG for the module graph. Groups are laid out on their own;
// inside a group callers sit above callees, so the picture reads top-down.
import { esc, fit } from './text.mjs';

const NODE_W = 188;
const NODE_H = 56;
const H_GAP = 26;
const V_GAP = 54;
const PAD = 18;
const HEAD = 34;
const GROUP_GAP = 24;
const MAX_ROW_W = 920;
const PER_ROW = 4;
const NAME_EM = (NODE_W - 26) / 13;

// Dense groups draw only their backbone: the heaviest spanning tree plus a few
// other strong calls. The rest stay hidden until a module is hovered, and every
// call is still listed on the module cards.
function backbone(members, edges) {
  const set = new Set(members);
  const inner = edges.filter((e) => set.has(e.from) && set.has(e.to));
  if (inner.length <= members.length + 1) return inner;
  const total = (e) => (e.known ? e.weight + e.back : -1);
  const sorted = inner.slice().sort((x, y) => total(y) - total(x) || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  const parent = new Map(members.map((id) => [id, id]));
  const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
  const keep = new Set();
  for (const e of sorted) {
    const a = find(e.from);
    const b = find(e.to);
    if (a === b) continue;
    parent.set(a, b);
    keep.add(e);
  }
  const top = total(sorted[0]);
  const extra = Math.max(1, Math.floor(members.length / 2));
  let added = 0;
  for (const e of sorted) {
    if (added >= extra || total(e) < top * 0.3) break;
    if (!keep.has(e)) {
      keep.add(e);
      added += 1;
    }
  }
  return inner.filter((e) => keep.has(e));
}

function rankGroup(members, edges, byId) {
  const set = new Set(members);
  const out = new Map(members.map((id) => [id, []]));
  for (const e of edges) {
    if (set.has(e.from) && set.has(e.to)) out.get(e.from).push(e.to);
  }
  // Drop back edges (DFS from the strongest callers) so ranks are well defined.
  const order = members.slice().sort((a, b) => {
    const x = byId.get(a);
    const y = byId.get(b);
    return (y.outWeight - y.inWeight) - (x.outWeight - x.inWeight) || a.localeCompare(b);
  });
  const state = new Map();
  const dag = new Map(members.map((id) => [id, []]));
  const visit = (id) => {
    state.set(id, 1);
    for (const to of out.get(id)) {
      if (state.get(to) === 1) continue;
      dag.get(id).push(to);
      if (!state.get(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of order) if (!state.get(id)) visit(id);

  const indeg = new Map(members.map((id) => [id, 0]));
  for (const list of dag.values()) for (const to of list) indeg.set(to, indeg.get(to) + 1);
  const rank = new Map();
  const queue = order.filter((id) => indeg.get(id) === 0);
  for (const id of queue) rank.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const to of dag.get(id)) {
      rank.set(to, Math.max(rank.get(to) ?? 0, rank.get(id) + 1));
      indeg.set(to, indeg.get(to) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  for (const id of members) if (!rank.has(id)) rank.set(id, 0);
  return rank;
}

function placeGroup(members, edges, byId) {
  const rank = rankGroup(members, edges, byId);
  const rows = [];
  for (const id of members) {
    const r = rank.get(id);
    (rows[r] ||= []).push(id);
  }
  // Wide ranks wrap into extra rows so a group never gets wider than PER_ROW nodes.
  const lines = [];
  for (const row of rows.filter(Boolean)) {
    row.sort((a, b) => byId.get(b).size - byId.get(a).size || a.localeCompare(b));
    for (let i = 0; i < row.length; i += PER_ROW) lines.push(row.slice(i, i + PER_ROW));
  }
  const neighbours = (id) => edges.filter((e) => e.from === id || e.to === id).map((e) => (e.from === id ? e.to : e.from));
  const pos = new Map();
  const index = () => lines.forEach((line) => line.forEach((id, i) => pos.set(id, i - (line.length - 1) / 2)));
  index();
  for (let pass = 0; pass < 4; pass += 1) {
    const seq = pass % 2 === 0 ? lines.slice(1) : lines.slice(0, -1).reverse();
    for (const line of seq) {
      const bary = new Map(line.map((id) => {
        const ns = neighbours(id).filter((n) => pos.has(n) && !line.includes(n));
        return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(id)];
      }));
      line.sort((a, b) => bary.get(a) - bary.get(b) || a.localeCompare(b));
      index();
    }
  }
  const cols = Math.max(...lines.map((l) => l.length));
  const innerW = cols * NODE_W + (cols - 1) * H_GAP;
  const width = innerW + PAD * 2;
  const height = HEAD + lines.length * NODE_H + (lines.length - 1) * V_GAP + PAD;
  const nodes = new Map();
  lines.forEach((line, li) => {
    const lineW = line.length * NODE_W + (line.length - 1) * H_GAP;
    const x0 = PAD + (innerW - lineW) / 2;
    line.forEach((id, i) => nodes.set(id, { x: x0 + i * (NODE_W + H_GAP), y: HEAD + li * (NODE_H + V_GAP), line: li }));
  });
  return { width, height, nodes };
}

function placeGrid(members) {
  const cols = Math.min(PER_ROW, members.length);
  const linesN = Math.ceil(members.length / cols);
  const nodes = new Map();
  members.forEach((id, i) => {
    nodes.set(id, { x: PAD + (i % cols) * (NODE_W + H_GAP), y: HEAD + Math.floor(i / cols) * (NODE_H + 14), line: 0 });
  });
  return {
    width: PAD * 2 + cols * NODE_W + (cols - 1) * H_GAP,
    height: HEAD + linesN * NODE_H + (linesN - 1) * 14 + PAD,
    nodes,
  };
}

export function layoutGraph(model, { label, groupLabel, t }) {
  const major = new Set();
  const boxes = model.groups.map((g) => {
    const main = backbone(g.members, model.edges);
    for (const e of main) major.add(e);
    return { kind: 'group', group: g, members: g.members, ...placeGroup(g.members, main, model.byId) };
  });
  if (model.standalone.length) {
    boxes.push({ kind: 'standalone', members: model.standalone, ...placeGrid(model.standalone) });
  }
  // Pack boxes into rows, left to right.
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxW = 0;
  for (const box of boxes) {
    if (x > 0 && x + box.width > MAX_ROW_W) {
      x = 0;
      y += rowH + GROUP_GAP;
      rowH = 0;
    }
    box.x = x;
    box.y = y;
    x += box.width + GROUP_GAP;
    rowH = Math.max(rowH, box.height);
    maxW = Math.max(maxW, box.x + box.width);
  }
  const width = Math.max(1, Math.ceil(maxW)) + 2;
  const height = Math.max(1, Math.ceil(y + rowH)) + 2;

  const abs = new Map();
  for (const box of boxes) {
    for (const [id, p] of box.nodes) abs.set(id, { x: box.x + p.x + 1, y: box.y + p.y + 1, line: p.line, box });
  }

  const maxW8 = Math.max(1, ...model.edges.map((e) => e.weight + e.back));
  const ports = portOffsets(model.edges, abs, major);
  const minor = model.edges.filter((e) => !major.has(e)).length;
  const edgeSvg = model.edges.map((e, i) => {
    const a = abs.get(e.from);
    const b = abs.get(e.to);
    if (!a || !b) return '';
    const total = e.weight + e.back;
    const sw = e.known ? (1.1 + 3.2 * Math.log1p(total) / Math.log1p(maxW8)).toFixed(2) : '1';
    const weak = e.known && total < maxW8 * 0.03;
    const obstacles = [...abs.entries()].filter(([id, p]) => p.box === a.box && id !== e.from && id !== e.to).map(([, p]) => p);
    const { d } = edgePath(a, b, ports.get(`${i}:out`) || 0, ports.get(`${i}:in`) || 0, obstacles);
    const cls = ['edge', e.both ? 'both' : '', e.known ? '' : 'unknown', weak ? 'weak' : '', major.has(e) ? '' : 'minor'].filter(Boolean).join(' ');
    const tip = t.edgeTip(e, label);
    return `<g class="${cls}" data-from="${e.from}" data-to="${e.to}"><path class="line" d="${d}" style="stroke-width:${sw}px"/><path class="hit" d="${d}"><title>${esc(tip)}</title></path></g>`;
  }).join('');

  const boxSvg = boxes.map((box) => {
    const bx = box.x + 1;
    const by = box.y + 1;
    const title = box.kind === 'group' ? groupLabel(box.group) : t.standaloneBox;
    const titleFit = fit(title, (box.width - PAD * 2) / 12.5);
    return `<g class="box ${box.kind}"><rect x="${bx}" y="${by}" width="${box.width}" height="${box.height}" rx="12"/>`
      + `<text class="box-title" x="${bx + PAD}" y="${by + 22}">${esc(titleFit)}</text></g>`;
  }).join('');

  const nodeSvg = [...abs.entries()].map(([id, p]) => {
    const m = model.byId.get(id);
    const name = label(id);
    const bar = model.maxSize ? Math.max(3, Math.round((NODE_W - 24) * m.size / model.maxSize)) : 0;
    const cls = ['node', m.hub ? 'hub' : '', m.degree === 0 ? 'alone' : ''].filter(Boolean).join(' ');
    return `<a class="${cls}" href="#${id}" data-mod="${id}" aria-label="${esc(`${id} ${name}`)}">`
      + `<title>${esc(t.nodeTip(m, name))}</title>`
      + `<rect class="card" x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="9"/>`
      + `<text class="nid" x="${p.x + 12}" y="${p.y + 19}">${id}${m.hub ? `<tspan class="nhub" dx="6">${esc(t.hub)}</tspan>` : ''}</text>`
      + `<text class="nsize" x="${p.x + NODE_W - 12}" y="${p.y + 19}" text-anchor="end">${esc(t.sizeShort(m.size))}</text>`
      + `<text class="nname" x="${p.x + 12}" y="${p.y + 39}">${esc(fit(name, NAME_EM))}</text>`
      + `<rect class="nbar" x="${p.x + 12}" y="${p.y + NODE_H - 9}" width="${bar}" height="3" rx="1.5"/>`
      + '</a>';
  }).join('');

  const marker = (id, cls) => `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0,1.5 L9,5 L0,8.5 z" class="${cls}"/></marker>`;
  const defs = `<defs>${marker('wa', 'arrow')}${marker('wa-on', 'arrow on')}</defs>`;
  const svg = `<svg class="graph-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${esc(t.graphLabel)}" xmlns="http://www.w3.org/2000/svg">`
    + defs + boxSvg + `<g class="edges">${edgeSvg}</g><g class="nodes">${nodeSvg}</g></svg>`;
  return { svg, width, height, minor };
}

function portOffsets(edges, abs, major) {
  const ports = new Map();
  const spread = (list, key) => {
    list.sort((p, q) => p.x - q.x);
    const span = Math.min(NODE_W - 40, (list.length - 1) * 22);
    list.forEach((item, i) => ports.set(`${item.i}:${key}`, list.length > 1 ? -span / 2 + (span * i) / (list.length - 1) : 0));
  };
  const outs = new Map();
  const ins = new Map();
  edges.forEach((e, i) => {
    const a = abs.get(e.from);
    const b = abs.get(e.to);
    if (!a || !b || !major.has(e)) return;
    if (!outs.has(e.from)) outs.set(e.from, []);
    if (!ins.has(e.to)) ins.set(e.to, []);
    outs.get(e.from).push({ i, x: b.x });
    ins.get(e.to).push({ i, x: a.x });
  });
  for (const list of outs.values()) spread(list, 'out');
  for (const list of ins.values()) spread(list, 'in');
  return ports;
}

// Paths are lists of cubic segments [p0, c1, c2, p3]; a straight run uses its
// end points as controls. `obstacles` are the other cards in the same group.
function edgePath(a, b, outDx, inDx, obstacles) {
  const ax = a.x + NODE_W / 2 + outDx;
  const bx = b.x + NODE_W / 2 + inDx;
  let segs;
  if (a.y === b.y) {
    // Same row: leave and enter through the top, arching over cards in between.
    const y = a.y - 1;
    const lift = Math.min(30, 14 + Math.abs(bx - ax) / 12);
    segs = [[[ax, y], [ax, y - lift], [bx, y - lift], [bx, y]]];
  } else {
    const down = a.y < b.y;
    const sign = down ? 1 : -1;
    const y1 = down ? a.y + NODE_H : a.y;
    const y2 = down ? b.y - 2 : b.y + NODE_H + 2;
    const dy = Math.max(24, Math.abs(y2 - y1) / 2);
    segs = [[[ax, y1], [ax, y1 + sign * dy], [bx, y2 - sign * dy], [bx, y2]]];
    if (hits(segs, obstacles)) {
      const lane = freeLane(ax, bx, Math.min(y1, y2), Math.max(y1, y2), obstacles);
      if (lane !== null) {
        const yA = y1 + sign * V_GAP * 0.45;
        const yB = y2 - sign * V_GAP * 0.45;
        segs = [
          [[ax, y1], [ax, yA], [lane, yA], [lane, yA + sign * 12]],
          [[lane, yA + sign * 12], [lane, yA + sign * 12], [lane, yB - sign * 12], [lane, yB - sign * 12]],
          [[lane, yB - sign * 12], [lane, yB], [bx, yB], [bx, y2]],
        ];
      }
    }
  }
  return {
    segs,
    d: segs.map((s, i) => `${i ? '' : `M${f1(s[0][0])},${f1(s[0][1])} `}C${f1(s[1][0])},${f1(s[1][1])} ${f1(s[2][0])},${f1(s[2][1])} ${f1(s[3][0])},${f1(s[3][1])}`).join(' '),
  };
}

function f1(n) {
  return n.toFixed(1);
}

export function sampleSegments(segs, steps = 24) {
  const pts = [];
  for (const [p0, c1, c2, p3] of segs) {
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      pts.push([0, 1].map((k) => w[0] * p0[k] + w[1] * c1[k] + w[2] * c2[k] + w[3] * p3[k]));
    }
  }
  return pts;
}

function hits(segs, obstacles) {
  return sampleSegments(segs).some(([x, y]) => obstacles.some((o) => x > o.x + 2 && x < o.x + NODE_W - 2 && y > o.y + 2 && y < o.y + NODE_H - 2));
}

// A vertical x between the cards of every row the edge has to cross, as close
// to the straight line as possible.
function freeLane(ax, bx, top, bottom, obstacles) {
  const rows = obstacles.filter((o) => o.y + NODE_H > top && o.y < bottom);
  if (!rows.length) return null;
  const blocked = (x) => rows.some((o) => x > o.x - 6 && x < o.x + NODE_W + 6);
  const candidates = [];
  for (const o of rows) candidates.push(o.x - H_GAP / 2, o.x + NODE_W + H_GAP / 2);
  const free = candidates.filter((x) => !blocked(x));
  if (!free.length) return null;
  const mid = (ax + bx) / 2;
  return free.sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y)[0];
}
