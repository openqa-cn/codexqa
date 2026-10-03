import { esc, inline, blocks, safeUrl } from './text.mjs';
import { layoutGraph } from './layout.mjs';
import { layerOf } from './notes.mjs';
import { autoGuides, weightFrom } from './model.mjs';
import { strings } from './strings.mjs';

const FILES_SHOWN = 6;

export function renderHtml({ model, notes, draft = false, repo = {}, meta = {}, css = '', js = '' }) {
  const lang = notes.lang === 'en' ? 'en' : 'zh';
  const t = strings(lang);
  const nm = (id) => notes.modules[id] || {};
  const label = (id) => nm(id).name || model.byId.get(id)?.title || id;
  const groupName = (g) => notes.groups[g.id]?.name || t.groupAuto(g.autoName);
  const linkable = (id) => model.byId.has(id);
  const modLink = (id) => `<a class="mref" href="#${id}" data-mod="${id}">${id}<span class="mref-name">${esc(label(id))}</span></a>`;
  const repoName = repo.name || meta.repo || 'repository';
  const title = notes.title || repoName;

  const coverage = meta.localNodes ? Math.min(100, Math.round((model.totalSize / meta.localNodes) * 100)) : null;
  const banners = [];
  if (draft) banners.push(['draft', t.draft]);
  if (model.communities > model.selected) banners.push(['info', t.truncated(model.selected, model.communities)]);
  else if (coverage !== null && coverage < 80) banners.push(['info', t.partial(model.modules.length, coverage)]);
  if (repo.dirty) banners.push(['info', t.dirty]);

  const facts = t.facts(model).map(([v, k]) => `<li><b>${esc(v)}</b><span>${esc(k)}</span></li>`);
  if (coverage !== null) {
    const [v, k] = t.coverage(coverage);
    facts.push(`<li><b>${esc(v)}</b><span>${esc(k)}</span></li>`);
  }
  const commitUrl = safeUrl(repo.commitUrl);
  const commitBit = repo.commit
    ? `${esc(t.commit)} ${commitUrl ? `<a href="${esc(commitUrl)}" target="_blank" rel="noopener"><code>${esc(repo.commit.slice(0, 7))}</code></a>` : `<code>${esc(repo.commit.slice(0, 7))}</code>`}${repo.commitDate ? ` · ${esc(repo.commitDate.slice(0, 10))}` : ''}`
    : '';
  const hero = `<header class="hero" id="top" data-section>
  <p class="eyebrow">${esc(t.eyebrow)} · <span class="mono">${esc(repoName)}${repo.branch ? `@${esc(repo.branch)}` : ''}</span></p>
  <h1>${esc(title)}</h1>
  ${notes.tagline ? `<p class="tagline">${inline(notes.tagline, linkable)}</p>` : ''}
  <ul class="facts">${facts.join('')}</ul>
  <p class="meta">${[commitBit, esc(t.noModel)].filter(Boolean).join(' · ')}</p>
  ${banners.map(([kind, text]) => `<p class="banner ${kind}" role="note">${esc(text)}</p>`).join('\n  ')}
</header>`;

  // Reading paths: written ones first; draft builds fall back to the graph's own suggestion.
  let guides = notes.guides.filter((g) => g.steps.length >= 2);
  const usingAuto = !guides.length;
  if (usingAuto) guides = autoGuides(model).map((g) => ({ title: '', steps: g.steps, auto: true }));
  const guideHtml = guides.map((g, gi) => {
    const head = g.title || t.autoGuideTitle(`${g.steps[0].module} ${label(g.steps[0].module)}`);
    const steps = g.steps.map((s, si) => {
      const next = g.steps[si + 1];
      let evidence = '';
      if (next) {
        const fwd = weightFrom(model, s.module, next.module);
        const back = weightFrom(model, next.module, s.module);
        evidence = fwd >= back
          ? t.stepCalls(s.module, next.module, fwd)
          : t.stepCalls(next.module, s.module, back);
      }
      const note = s.note || nm(s.module).role || t.fallbackRole(model.byId.get(s.module));
      return `<li class="step"><span class="step-n" aria-hidden="true">${si + 1}</span><div class="step-body">${modLink(s.module)}`
        + `${note ? `<p>${inline(note, linkable)}</p>` : ''}${evidence ? `<p class="evidence">${esc(evidence)}</p>` : ''}</div></li>`;
    }).join('');
    return `<article class="guide"><h3>${esc(head)}${g.auto ? ` <span class="pill">${esc(t.autoGuide)}</span>` : ''}</h3><ol class="steps">${steps}</ol></article>`;
  }).join('\n');
  const startSection = guides.length ? `<section id="start" data-section>
  <h2>${esc(t.startTitle)}</h2>
  <p class="lead">${esc(t.startLead)}</p>
  <div class="guides${guides.length === 1 ? ' single' : ''}">${guideHtml}</div>
</section>` : '';

  const overviewText = notes.overview || t.fallbackOverview(model);
  const whatSection = `<section id="what" data-section>
  <h2>${esc(t.whatTitle)}</h2>
  <div class="prose">${blocks(overviewText, linkable)}</div>
</section>`;

  const graph = model.modules.length ? layoutGraph(model, { label, groupLabel: groupName, t }) : null;
  const mapSection = graph ? `<section id="map" data-section>
  <h2>${esc(t.mapTitle)}</h2>
  <p class="lead">${esc(t.mapLead)}</p>
  <figure class="graph" style="--graph-w:${graph.width}px">
    <div class="graph-scroll" tabindex="0" aria-label="${esc(t.graphLabel)}">${graph.svg}</div>
    <figcaption class="legend">
      <span><i class="lg hub"></i>${esc(t.legendHub)}</span>
      <span><i class="lg bar"></i>${esc(t.legendSize)}</span>
      <span><i class="lg dashed"></i>${esc(t.legendDashed)}</span>
      ${graph.minor ? `<span>${esc(t.legendMinor(graph.minor))}</span>` : ''}
      <span class="only-narrow">${esc(t.scrollHint)}</span>
    </figcaption>
  </figure>
</section>` : `<section id="map" data-section><h2>${esc(t.mapTitle)}</h2><p class="banner info">${inline(t.empty)}</p></section>`;

  const card = (m) => {
    const n = nm(m.id);
    const role = n.role || (draft ? t.fallbackRole(m) : '');
    const layer = layerOf(n.layer);
    const tags = [
      m.hub ? `<span class="tag hub">${esc(t.hub)}</span>` : '',
      layer ? `<span class="tag">${esc(t.layer(layer))}</span>` : '',
    ].join('');
    const pct = model.maxSize ? Math.max(2, Math.round((m.size / model.maxSize) * 100)) : 0;
    const rel = (list) => (list.length
      ? `<ul class="rel">${list.map((x) => `<li>${modLink(x.id)}<span class="w">${esc(t.refs(x.weight))}</span></li>`).join('')}</ul>`
      : `<p class="muted">${esc(t.none)}</p>`);
    const sigs = m.signatures.length
      ? `<div class="wide"><p class="fh">${esc(t.api)}</p><ul class="sigs">${m.signatures.map((s) => `<li data-sym="${esc(s.name)}"><code>${esc(sigText(s))}</code><span class="kind">${esc(t.kind(s.kind))}${s.defs > 1 ? ` · ${esc(t.defs(s.defs))}` : ''}</span>${s.calledBy ? `<span class="w">${esc(t.usedBy(s.calledBy))}</span>` : ''}</li>`).join('')}</ul></div>`
      : '';
    const flows = m.flows.length
      ? `<div class="wide"><p class="fh">${esc(t.flows)}</p>${m.flows.map((f) => `<p class="flow"><code>${esc(f.method)}</code>${f.steps.map((s) => ` <span class="arrow">→</span> <code>${esc(s)}</code>`).join('')}${f.more > 0 ? ` <span class="muted">${esc(t.moreSteps(f.more))}</span>` : ''}</p>`).join('')}</div>`
      : '';
    const files = m.files.length
      ? `<div class="wide"><p class="fh">${esc(t.files)} <span class="muted">${esc(String(m.fileCount || m.files.length))}</span></p>${fileList(m.files, repo, t)}</div>`
      : '';
    return `<details class="mod" id="${m.id}" data-mod="${m.id}">
  <summary>
    <span class="mid">${m.id}</span>
    <span class="mname">${esc(label(m.id))}${tags}</span>
    <span class="msize" title="${esc(t.sizeLong(m.size))}"><span class="sbar"><i style="width:${pct}%"></i></span><span class="num">${esc(t.sizeShort(m.size))}</span></span>
    ${role ? `<span class="mrole">${inline(role, linkable)}</span>` : ''}
  </summary>
  <div class="mbody">
    ${n.name && n.name !== m.title ? `<p class="rule-title mono">${esc(m.title)}</p>` : ''}
    ${n.detail ? `<div class="prose">${blocks(n.detail, linkable)}</div>` : ''}
    <div class="facts-grid">
      ${m.degree ? `<div><p class="fh">${esc(t.calls)}</p>${rel(m.calls)}</div>
      <div><p class="fh">${esc(t.calledBy)}</p>${rel(m.calledBy)}</div>` : ''}
      ${sigs}
      ${flows}
      ${files}
    </div>
    ${m.outside.length ? `<p class="muted">${esc(t.outside(m.outside))}</p>` : ''}
  </div>
</details>`;
  };

  const groupBlocks = model.groups.map((g) => {
    const gn = notes.groups[g.id] || {};
    const members = g.members.map((id) => model.byId.get(id)).sort((a, b) => b.size - a.size);
    return `<div class="group" id="${g.id}">
  <div class="group-head"><h3>${esc(groupName(g))}</h3><span class="muted">${esc(t.groupCount(g.members.length))}</span></div>
  ${gn.summary ? `<p class="group-sum">${inline(gn.summary, linkable)}</p>` : ''}
  ${members.map(card).join('\n')}
</div>`;
  }).join('\n');
  const modulesSection = model.groups.length ? `<section id="modules" data-section>
  <div class="section-head"><h2>${esc(t.modulesTitle)}</h2><div class="tools"><button type="button" data-expand="1">${esc(t.expandAll)}</button><button type="button" data-expand="0">${esc(t.collapseAll)}</button></div></div>
  <p class="lead">${esc(t.modulesLead)}</p>
  ${groupBlocks}
</section>` : '';

  const standaloneSection = model.standalone.length ? `<section id="standalone" data-section>
  <h2>${esc(t.standaloneTitle)}</h2>
  <p class="lead">${esc(t.standaloneLead)}</p>
  ${model.standalone.map((id) => card(model.byId.get(id))).join('\n')}
</section>` : '';

  const commands = (meta.commands || []).map((c) => `<li><code>${esc(c)}</code></li>`).join('');
  const aboutSection = `<section id="about" data-section>
  <h2>${esc(t.aboutTitle)}</h2>
  <p>${esc(t.aboutFacts)}</p>
  <dl class="glossary">${t.glossary.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  ${commands ? `<h3>${esc(t.commands)}</h3><ul class="cmds">${commands}</ul>` : ''}
  <p class="muted">${esc(t.generated(meta.generatedAt || ''))}${meta.cliVersion ? ` · ${esc(meta.cliVersion)}` : ''} · codexqa-code-wiki</p>
</section>`;

  const navGroups = model.groups.map((g) => `<li><details open><summary>${esc(groupName(g))}</summary><ul>${g.members
    .map((id) => model.byId.get(id)).sort((a, b) => b.size - a.size)
    .map((m) => `<li><a href="#${m.id}" data-mod="${m.id}"><span class="nid">${m.id}</span>${esc(label(m.id))}</a></li>`).join('')}</ul></details></li>`).join('');
  const navStandalone = model.standalone.length
    ? `<li><a href="#standalone">${esc(t.navStandalone)}</a><ul>${model.standalone.map((id) => `<li><a href="#${id}" data-mod="${id}"><span class="nid">${id}</span>${esc(label(id))}</a></li>`).join('')}</ul></li>`
    : '';
  const nav = `<nav id="nav" class="side" aria-label="${esc(t.menu)}">
  <ul class="nav-top">
    <li><a href="#top">${esc(t.navOverview)}</a></li>
    ${startSection ? `<li><a href="#start">${esc(t.navStart)}</a></li>` : ''}
    <li><a href="#what">${esc(t.navWhat)}</a></li>
    <li><a href="#map">${esc(t.navMap)}</a></li>
    ${modulesSection ? `<li class="nav-mods"><a href="#modules">${esc(t.navModules)}</a><ul>${navGroups}</ul></li>` : ''}
    ${navStandalone}
    <li><a href="#about">${esc(t.navAbout)}</a></li>
  </ul>
</nav>`;

  const index = [];
  for (const m of model.modules) {
    index.push({ k: 'm', id: m.id, l: label(m.id), s: [m.title, nm(m.id).role || ''].filter(Boolean).join(' · ') });
    for (const s of m.signatures) index.push({ k: 's', id: m.id, l: s.name, s: `${m.id} ${label(m.id)}` });
    for (const f of m.files) index.push({ k: 'f', id: m.id, l: f, s: `${m.id} ${label(m.id)}` });
  }
  const ui = { searchEmpty: t.searchEmpty, kinds: lang === 'en' ? { m: 'Module', s: 'Symbol', f: 'File' } : { m: '模块', s: '符号', f: '文件' } };

  return `<!doctype html>
<html lang="${t.htmlLang}" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="codexqa-code-wiki">
<title>${esc(title)} · ${esc(t.brand)}</title>
<script>(function(){var s=null;try{s=localStorage.getItem('codexqa-wiki-theme');}catch(e){}if(s!=='light'&&s!=='dark')s=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',s);})();</script>
<style>
${css}
</style>
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="topbar">
  <button type="button" class="icon menu-btn" aria-controls="nav" aria-expanded="false" aria-label="${esc(t.menu)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg></button>
  <a class="brand" href="#top">${esc(t.brand)}</a>
  <span class="crumb mono" title="${esc(repoName)}">${esc(repoName)}</span>
  <div class="search" role="search">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>
    <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t.search)}" data-short="${esc(t.searchShort)}" aria-label="${esc(t.search)}" aria-controls="q-results" aria-expanded="false" role="combobox" aria-autocomplete="list">
    <kbd aria-hidden="true">/</kbd>
    <ul id="q-results" role="listbox" hidden></ul>
  </div>
  <button type="button" class="icon theme-btn" aria-label="${esc(t.theme)}" title="${esc(t.theme)}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="fill"/></svg></button>
</header>
<div class="shell">
${nav}
<div class="scrim" hidden></div>
<main id="main">
${hero}
${startSection}
${whatSection}
${mapSection}
${modulesSection}
${standaloneSection}
${aboutSection}
</main>
</div>
<script type="application/json" id="wiki-index">${jsonForScript(index)}</script>
<script type="application/json" id="wiki-ui">${jsonForScript(ui)}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

function sigText(s) {
  const callable = ['function', 'method', 'constructor'].includes(s.kind);
  if (!callable) return s.name;
  const params = s.params.length > 3 ? `${s.params.slice(0, 3).join(', ')}, …` : s.params.join(', ');
  return `${s.name}(${params})${s.returns ? ` → ${s.returns.length > 28 ? `${s.returns.slice(0, 27)}…` : s.returns}` : ''}`;
}

function fileList(files, repo, t) {
  const item = (raw) => {
    const path = repo.resolveFile ? repo.resolveFile(raw) : raw;
    // The export drops some extensions (Python modules); a guessed path would 404.
    const url = repo.fileUrl && /\.[A-Za-z0-9]+$/.test(path) ? safeUrl(repo.fileUrl(path)) : '';
    return url
      ? `<li data-file="${esc(raw)}"><a class="file" href="${esc(url)}" target="_blank" rel="noopener">${esc(path)}</a></li>`
      : `<li data-file="${esc(raw)}"><span class="file">${esc(path)}</span></li>`;
  };
  const shown = files.slice(0, FILES_SHOWN).map(item).join('');
  const rest = files.slice(FILES_SHOWN);
  return `<ul class="files">${shown}</ul>${rest.length
    ? `<details class="more"><summary>${esc(t.moreFiles(rest.length))}</summary><ul class="files">${rest.map(item).join('')}</ul></details>`
    : ''}`;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
