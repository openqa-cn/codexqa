import { esc, inline, blocks, safeUrl } from './text.mjs';
import { layoutGraph } from './layout.mjs';
import { layerOf } from './notes.mjs';
import { autoGuides, weightFrom } from './model.mjs';
import { strings } from './strings.mjs';

const FILES_SHOWN = 6;

export function renderHtml({ model, notes, draft = false, repo = {}, meta = {}, css = '', js = '' }) {
  const lang = notes.lang === 'en' ? 'en' : 'zh';
  const zh = strings('zh');
  const en = strings('en');
  const t = lang === 'en' ? en : zh;
  const pair = (zhText, enText) => (zhText === enText
    ? esc(zhText)
    : `<span class="lang-zh">${esc(zhText)}</span><span class="lang-en">${esc(enText)}</span>`);
  const pairHtml = (zhHtml, enHtml) => (zhHtml === enHtml
    ? zhHtml
    : `<span class="lang-zh">${zhHtml}</span><span class="lang-en">${enHtml}</span>`);
  const attrPair = (name, zhText, enText) => {
    const shown = lang === 'en' ? enText : zhText;
    if (zhText === enText) return `${name}="${esc(shown)}"`;
    const extra = name === 'aria-label' ? ['data-zh-aria', 'data-en-aria'] : ['data-zh-title', 'data-en-title'];
    return `${name}="${esc(shown)}" ${extra[0]}="${esc(zhText)}" ${extra[1]}="${esc(enText)}"`;
  };
  const nm = (id) => notes.modules[id] || {};
  const label = (id) => nm(id).name || model.byId.get(id)?.title || id;
  const writtenGroup = (g) => notes.groups[g.id]?.name || '';
  const groupLabel = (g) => writtenGroup(g) || t.groupAuto(g.autoName);
  const groupLabelZh = (g) => writtenGroup(g) || zh.groupAuto(g.autoName);
  const groupLabelEn = (g) => writtenGroup(g) || en.groupAuto(g.autoName);
  const groupNameHtml = (g) => (writtenGroup(g) ? esc(writtenGroup(g)) : pair(zh.groupAuto(g.autoName), en.groupAuto(g.autoName)));
  const linkable = (id) => model.byId.has(id);
  const modLink = (id) => `<a class="mref" href="#${id}" data-mod="${id}">${id}<span class="mref-name">${esc(label(id))}</span></a>`;
  const repoName = repo.name || meta.repo || 'repository';
  const title = notes.title || repoName;

  const coverage = meta.localNodes ? Math.min(100, Math.round((model.totalSize / meta.localNodes) * 100)) : null;
  const banners = [];
  if (draft) banners.push(['draft', pair(zh.draft, en.draft)]);
  if (model.communities > model.selected) banners.push(['info', pair(zh.truncated(model.selected, model.communities), en.truncated(model.selected, model.communities))]);
  else if (coverage !== null && coverage < 80) banners.push(['info', pair(zh.partial(model.modules.length, coverage), en.partial(model.modules.length, coverage))]);
  if (repo.dirty) banners.push(['info', pair(zh.dirty, en.dirty)]);

  const factsZh = zh.facts(model);
  const factsEn = en.facts(model);
  const facts = factsZh.map(([v, k], i) => `<li><b>${pair(v, factsEn[i][0])}</b><span>${pair(k, factsEn[i][1])}</span></li>`);
  if (coverage !== null) {
    const [vz, kz] = zh.coverage(coverage);
    const [ve, ke] = en.coverage(coverage);
    facts.push(`<li><b>${pair(vz, ve)}</b><span>${pair(kz, ke)}</span></li>`);
  }
  const commitUrl = safeUrl(repo.commitUrl);
  const commitLink = repo.commit
    ? (commitUrl
      ? `<a href="${esc(commitUrl)}" target="_blank" rel="noopener"><code>${esc(repo.commit.slice(0, 7))}</code></a>`
      : `<code>${esc(repo.commit.slice(0, 7))}</code>`)
    : '';
  const commitBit = repo.commit
    ? `${pair(zh.commit, en.commit)} ${commitLink}${repo.commitDate ? ` · ${esc(repo.commitDate.slice(0, 10))}` : ''}`
    : '';
  const hero = `<header class="hero" id="top" data-section>
  <p class="eyebrow">${pair(zh.eyebrow, en.eyebrow)} · <span class="mono">${esc(repoName)}${repo.branch ? `@${esc(repo.branch)}` : ''}</span></p>
  <h1>${esc(title)}</h1>
  ${notes.tagline ? `<p class="tagline">${inline(notes.tagline, linkable)}</p>` : ''}
  <ul class="facts">${facts.join('')}</ul>
  <p class="meta">${[commitBit, pair(zh.noModel, en.noModel)].filter(Boolean).join(' · ')}</p>
  ${banners.map(([kind, text]) => `<p class="banner ${kind}" role="note">${text}</p>`).join('\n  ')}
</header>`;

  // Reading paths: written ones first; draft builds fall back to the graph's own suggestion.
  let guides = notes.guides.filter((g) => g.steps.length >= 2);
  const usingAuto = !guides.length;
  if (usingAuto) guides = autoGuides(model).map((g) => ({ title: '', steps: g.steps, auto: true }));
  const guideHtml = guides.map((g, gi) => {
    const who = `${g.steps[0].module} ${label(g.steps[0].module)}`;
    const head = g.title ? esc(g.title) : pair(zh.autoGuideTitle(who), en.autoGuideTitle(who));
    const steps = g.steps.map((s, si) => {
      const next = g.steps[si + 1];
      let evidence = '';
      if (next) {
        const fwd = weightFrom(model, s.module, next.module);
        const back = weightFrom(model, next.module, s.module);
        const [a, b, w] = fwd >= back ? [s.module, next.module, fwd] : [next.module, s.module, back];
        evidence = `<p class="evidence">${pair(zh.stepCalls(a, b, w), en.stepCalls(a, b, w))}</p>`;
      }
      const written = s.note || nm(s.module).role || '';
      const mod = model.byId.get(s.module);
      const note = written
        ? `<p>${inline(written, linkable)}</p>`
        : (zh.fallbackRole(mod) || en.fallbackRole(mod) ? `<p>${pair(zh.fallbackRole(mod), en.fallbackRole(mod))}</p>` : '');
      return `<li class="step"><span class="step-n" aria-hidden="true">${si + 1}</span><div class="step-body">${modLink(s.module)}`
        + `${note}${evidence}</div></li>`;
    }).join('');
    return `<article class="guide"><h3>${head}${g.auto ? ` <span class="pill">${pair(zh.autoGuide, en.autoGuide)}</span>` : ''}</h3><ol class="steps">${steps}</ol></article>`;
  }).join('\n');
  const startSection = guides.length ? `<section id="start" data-section>
  <h2>${pair(zh.startTitle, en.startTitle)}</h2>
  <p class="lead">${pair(zh.startLead, en.startLead)}</p>
  <div class="guides${guides.length === 1 ? ' single' : ''}">${guideHtml}</div>
</section>` : '';

  const overviewHtml = notes.overview
    ? blocks(notes.overview, linkable)
    : `<p>${pair(zh.fallbackOverview(model), en.fallbackOverview(model))}</p>`;
  const whatSection = `<section id="what" data-section>
  <h2>${pair(zh.whatTitle, en.whatTitle)}</h2>
  <div class="prose">${overviewHtml}</div>
</section>`;

  const graph = model.modules.length ? layoutGraph(model, { label, groupLabel, groupLabelZh, groupLabelEn, t, zh, en }) : null;
  const mapSection = graph ? `<section id="map" data-section>
  <h2>${pair(zh.mapTitle, en.mapTitle)}</h2>
  <p class="lead">${pair(zh.mapLead, en.mapLead)}</p>
  <figure class="graph" style="--graph-w:${graph.width}px">
    <div class="graph-scroll" tabindex="0" ${attrPair('aria-label', zh.graphLabel, en.graphLabel)}>${graph.svg}</div>
    <figcaption class="legend">
      <span><i class="lg hub"></i>${pair(zh.legendHub, en.legendHub)}</span>
      <span><i class="lg bar"></i>${pair(zh.legendSize, en.legendSize)}</span>
      <span><i class="lg dashed"></i>${pair(zh.legendDashed, en.legendDashed)}</span>
      ${graph.minor ? `<span>${pair(zh.legendMinor(graph.minor), en.legendMinor(graph.minor))}</span>` : ''}
      <span class="only-narrow">${pair(zh.scrollHint, en.scrollHint)}</span>
    </figcaption>
  </figure>
</section>` : `<section id="map" data-section><h2>${pair(zh.mapTitle, en.mapTitle)}</h2><p class="banner info">${pairHtml(inline(zh.empty, linkable), inline(en.empty, linkable))}</p></section>`;

  const card = (m) => {
    const n = nm(m.id);
    const role = n.role
      ? `<span class="mrole">${inline(n.role, linkable)}</span>`
      : (draft && (zh.fallbackRole(m) || en.fallbackRole(m)) ? `<span class="mrole">${pair(zh.fallbackRole(m), en.fallbackRole(m))}</span>` : '');
    const layer = layerOf(n.layer);
    const tags = [
      m.hub ? `<span class="tag hub">${pair(zh.hub, en.hub)}</span>` : '',
      layer ? `<span class="tag">${pair(zh.layer(layer), en.layer(layer))}</span>` : '',
    ].join('');
    const pct = model.maxSize ? Math.max(2, Math.round((m.size / model.maxSize) * 100)) : 0;
    const rel = (list) => (list.length
      ? `<ul class="rel">${list.map((x) => `<li>${modLink(x.id)}<span class="w">${pair(zh.refs(x.weight), en.refs(x.weight))}</span></li>`).join('')}</ul>`
      : `<p class="muted">${pair(zh.none, en.none)}</p>`);
    const sigs = m.signatures.length
      ? `<div class="wide"><p class="fh">${pair(zh.api, en.api)}</p><ul class="sigs">${m.signatures.map((s) => {
        const kindZh = `${zh.kind(s.kind)}${s.defs > 1 ? ` · ${zh.defs(s.defs)}` : ''}`;
        const kindEn = `${en.kind(s.kind)}${s.defs > 1 ? ` · ${en.defs(s.defs)}` : ''}`;
        return `<li data-sym="${esc(s.name)}"><code>${esc(sigText(s))}</code><span class="kind">${pair(kindZh, kindEn)}</span>${s.calledBy ? `<span class="w">${pair(zh.usedBy(s.calledBy), en.usedBy(s.calledBy))}</span>` : ''}</li>`;
      }).join('')}</ul></div>`
      : '';
    const flows = m.flows.length
      ? `<div class="wide"><p class="fh">${pair(zh.flows, en.flows)}</p>${m.flows.map((f) => `<p class="flow"><code>${esc(f.method)}</code>${f.steps.map((s) => ` <span class="arrow">→</span> <code>${esc(s)}</code>`).join('')}${f.more > 0 ? ` <span class="muted">${pair(zh.moreSteps(f.more), en.moreSteps(f.more))}</span>` : ''}</p>`).join('')}</div>`
      : '';
    const files = m.files.length
      ? `<div class="wide"><p class="fh">${pair(zh.files, en.files)} <span class="muted">${esc(String(m.fileCount || m.files.length))}</span></p>${fileList(m.files, repo, pair, zh, en)}</div>`
      : '';
    return `<details class="mod" id="${m.id}" data-mod="${m.id}">
  <summary>
    <span class="mid">${m.id}</span>
    <span class="mname">${esc(label(m.id))}${tags}</span>
    <span class="msize" ${attrPair('title', zh.sizeLong(m.size), en.sizeLong(m.size))}><span class="sbar"><i style="width:${pct}%"></i></span><span class="num">${pair(zh.sizeShort(m.size), en.sizeShort(m.size))}</span></span>
    ${role}
  <div class="mbody">
    ${n.name && n.name !== m.title ? `<p class="rule-title mono">${esc(m.title)}</p>` : ''}
    ${n.detail ? `<div class="prose">${blocks(n.detail, linkable)}</div>` : ''}
    <div class="facts-grid">
      ${m.degree ? `<div><p class="fh">${pair(zh.calls, en.calls)}</p>${rel(m.calls)}</div>
      <div><p class="fh">${pair(zh.calledBy, en.calledBy)}</p>${rel(m.calledBy)}</div>` : ''}
      ${sigs}
      ${flows}
      ${files}
    </div>
    ${m.outside.length ? `<p class="muted">${pair(zh.outside(m.outside), en.outside(m.outside))}</p>` : ''}
  </div>
</details>`;
  };

  const groupBlocks = model.groups.map((g) => {
    const gn = notes.groups[g.id] || {};
    const members = g.members.map((id) => model.byId.get(id)).sort((a, b) => b.size - a.size);
    return `<div class="group" id="${g.id}">
  <div class="group-head"><h3>${groupNameHtml(g)}</h3><span class="muted">${pair(zh.groupCount(g.members.length), en.groupCount(g.members.length))}</span></div>
  ${gn.summary ? `<p class="group-sum">${inline(gn.summary, linkable)}</p>` : ''}
  ${members.map(card).join('\n')}
</div>`;
  }).join('\n');
  const modulesSection = model.groups.length ? `<section id="modules" data-section>
  <div class="section-head"><h2>${pair(zh.modulesTitle, en.modulesTitle)}</h2><div class="tools"><button type="button" data-expand="1">${pair(zh.expandAll, en.expandAll)}</button><button type="button" data-expand="0">${pair(zh.collapseAll, en.collapseAll)}</button></div></div>
  <p class="lead">${pair(zh.modulesLead, en.modulesLead)}</p>
  ${groupBlocks}
</section>` : '';

  const standaloneSection = model.standalone.length ? `<section id="standalone" data-section>
  <h2>${pair(zh.standaloneTitle, en.standaloneTitle)}</h2>
  <p class="lead">${pair(zh.standaloneLead, en.standaloneLead)}</p>
  ${model.standalone.map((id) => card(model.byId.get(id))).join('\n')}
</section>` : '';

  const commands = (meta.commands || []).map((c) => `<li><code>${esc(c)}</code></li>`).join('');
  const aboutSection = `<section id="about" data-section>
  <h2>${pair(zh.aboutTitle, en.aboutTitle)}</h2>
  <p>${pair(zh.aboutFacts, en.aboutFacts)}</p>
  <dl class="glossary">${zh.glossary.map(([k, v], i) => `<div><dt>${pair(k, en.glossary[i][0])}</dt><dd>${pair(v, en.glossary[i][1])}</dd></div>`).join('')}</dl>
  ${commands ? `<h3>${pair(zh.commands, en.commands)}</h3><ul class="cmds">${commands}</ul>` : ''}
  <p class="muted">${pair(zh.generated(meta.generatedAt || ''), en.generated(meta.generatedAt || ''))}${meta.cliVersion ? ` · ${esc(meta.cliVersion)}` : ''} · codexqa-code-wiki</p>
</section>`;

  const navGroups = model.groups.map((g) => `<li><details open><summary>${groupNameHtml(g)}</summary><ul>${g.members
    .map((id) => model.byId.get(id)).sort((a, b) => b.size - a.size)
    .map((m) => `<li><a href="#${m.id}" data-mod="${m.id}"><span class="nid">${m.id}</span>${esc(label(m.id))}</a></li>`).join('')}</ul></details></li>`).join('');
  const navStandalone = model.standalone.length
    ? `<li><a href="#standalone">${pair(zh.navStandalone, en.navStandalone)}</a><ul>${model.standalone.map((id) => `<li><a href="#${id}" data-mod="${id}"><span class="nid">${id}</span>${esc(label(id))}</a></li>`).join('')}</ul></li>`
    : '';
  const nav = `<nav id="nav" class="side" ${attrPair('aria-label', zh.menu, en.menu)}>
  <ul class="nav-top">
    <li><a href="#top">${pair(zh.navOverview, en.navOverview)}</a></li>
    ${startSection ? `<li><a href="#start">${pair(zh.navStart, en.navStart)}</a></li>` : ''}
    <li><a href="#what">${pair(zh.navWhat, en.navWhat)}</a></li>
    <li><a href="#map">${pair(zh.navMap, en.navMap)}</a></li>
    ${modulesSection ? `<li class="nav-mods"><a href="#modules">${pair(zh.navModules, en.navModules)}</a><ul>${navGroups}</ul></li>` : ''}
    ${navStandalone}
    <li><a href="#about">${pair(zh.navAbout, en.navAbout)}</a></li>
  </ul>
</nav>`;

  const index = [];
  for (const m of model.modules) {
    index.push({ k: 'm', id: m.id, l: label(m.id), s: [m.title, nm(m.id).role || ''].filter(Boolean).join(' · ') });
    for (const s of m.signatures) index.push({ k: 's', id: m.id, l: s.name, s: `${m.id} ${label(m.id)}` });
    for (const f of m.files) index.push({ k: 'f', id: m.id, l: f, s: `${m.id} ${label(m.id)}` });
  }
  const ui = {
    searchEmpty: { zh: zh.searchEmpty, en: en.searchEmpty },
    kinds: { zh: { m: '模块', s: '符号', f: '文件' }, en: { m: 'Module', s: 'Symbol', f: 'File' } },
  };

  return `<!doctype html>
<html lang="${t.htmlLang}" data-theme="auto" data-lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="codexqa-code-wiki">
<title>${esc(title)} · ${esc(t.brand)}</title>
<script>(function(){var root=document.documentElement,theme=null,lang=null;try{theme=localStorage.getItem('codexqa-wiki-theme');lang=localStorage.getItem('codexqa-wiki-lang');}catch(e){}if(theme!=='light'&&theme!=='dark')theme=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';root.setAttribute('data-theme',theme);if(lang==='en'||lang==='zh'){root.setAttribute('data-lang',lang);root.lang=lang==='en'?'en':'zh-CN';}})();</script>
<style>
${css}
</style>
</head>
<body>
<a class="skip" href="#main">${pair(zh.skip, en.skip)}</a>
<header class="topbar">
  <button type="button" class="icon menu-btn" aria-controls="nav" aria-expanded="false" ${attrPair('aria-label', zh.menu, en.menu)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg></button>
  <a class="brand" href="#top">${esc(t.brand)}</a>
  <span class="crumb mono" title="${esc(repoName)}">${esc(repoName)}</span>
  <div class="search" role="search">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>
    <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t.search)}" data-short="${esc(t.searchShort)}" data-zh-placeholder="${esc(zh.search)}" data-en-placeholder="${esc(en.search)}" data-zh-short="${esc(zh.searchShort)}" data-en-short="${esc(en.searchShort)}" ${attrPair('aria-label', zh.search, en.search)} aria-controls="q-results" aria-expanded="false" role="combobox" aria-autocomplete="list">
    <kbd aria-hidden="true">/</kbd>
    <ul id="q-results" role="listbox" hidden></ul>
  </div>
  <div class="lang" role="group" aria-label="Language">
    <button type="button" data-set-lang="zh" aria-pressed="${lang === 'zh' ? 'true' : 'false'}">中文</button>
    <button type="button" data-set-lang="en" aria-pressed="${lang === 'en' ? 'true' : 'false'}">EN</button>
  </div>
  <button type="button" class="icon theme-btn" ${attrPair('aria-label', zh.theme, en.theme)} ${attrPair('title', zh.theme, en.theme)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="fill"/></svg></button>
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

function fileList(files, repo, pair, zh, en) {
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
    ? `<details class="more"><summary>${pair(zh.moreFiles(rest.length), en.moreFiles(rest.length))}</summary><ul class="files">${rest.map(item).join('')}</ul></details>`
    : ''}`;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
