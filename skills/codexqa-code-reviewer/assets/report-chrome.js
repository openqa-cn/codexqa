(function(){
  const root = document.documentElement;
  const prefix = root.getAttribute('data-store') || 'codexqa-report';
  const LANG_KEY = prefix + '-lang';
  const THEME_KEY = prefix + '-theme';

  function applyI18n(lang) {
    const attr = lang === 'en' ? 'data-en' : 'data-zh';
    document.querySelectorAll('[data-zh][data-en]').forEach(el => {
      const v = el.getAttribute(attr);
      if (v == null) return;
      if (el.tagName === 'TITLE') document.title = v;
      else if (el.tagName === 'OPTION') el.textContent = v;
      else el.textContent = v;
    });
    document.querySelectorAll('[data-zh-placeholder][data-en-placeholder]').forEach(el => {
      el.setAttribute('placeholder', el.getAttribute(lang === 'en' ? 'data-en-placeholder' : 'data-zh-placeholder') || '');
    });
  }

  function setLang(lang) {
    root.setAttribute('data-lang', lang);
    root.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-set-lang]').forEach(b => {
      b.setAttribute('aria-pressed', b.getAttribute('data-set-lang') === lang ? 'true' : 'false');
    });
    applyI18n(lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  }

  function normalizeTheme(t) {
    if (t === 'day' || t === 'light') return 'light';
    if (t === 'night' || t === 'dark') return 'dark';
    return 'light';
  }

  function setTheme(theme) {
    theme = normalizeTheme(theme);
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-set-theme]').forEach(b => {
      b.setAttribute('aria-pressed', b.getAttribute('data-set-theme') === theme ? 'true' : 'false');
    });
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  document.querySelectorAll('[data-set-lang]').forEach(b => {
    b.addEventListener('click', () => setLang(b.getAttribute('data-set-lang')));
  });
  document.querySelectorAll('[data-set-theme]').forEach(b => {
    b.addEventListener('click', () => setTheme(b.getAttribute('data-set-theme')));
  });

  let lang = root.getAttribute('data-lang') || 'zh';
  let theme = root.getAttribute('data-theme') || 'light';
  try {
    lang = localStorage.getItem(LANG_KEY) || lang;
    theme = localStorage.getItem(THEME_KEY) || theme;
  } catch (e) {}
  setLang(lang === 'en' ? 'en' : 'zh');
  setTheme(normalizeTheme(theme));

  function setCaseOpen(card, open) {
    if (!card) return;
    card.classList.toggle('open', open);
    const head = card.querySelector('.case-head');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  document.querySelectorAll('.case-head').forEach(head => {
    const card = head.closest('.case');
    if (head.tagName !== 'BUTTON') {
      if (!head.hasAttribute('role')) head.setAttribute('role', 'button');
      if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '0');
    }
    if (!head.hasAttribute('aria-expanded')) {
      head.setAttribute('aria-expanded', card && card.classList.contains('open') ? 'true' : 'false');
    }
    head.addEventListener('click', () => {
      if (!card || card.classList.contains('empty') || card.classList.contains('is-empty')) return;
      setCaseOpen(card, !card.classList.contains('open'));
    });
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        head.click();
      }
    });
  });

  const expandAll = document.getElementById('expandAll');
  const collapseAll = document.getElementById('collapseAll');
  function toggleableCases(expand) {
    const scoped = document.querySelectorAll(
      '.panel:not([hidden]) .case:not([hidden]), [data-sev-panel]:not([hidden]) .case:not([hidden])'
    );
    const cards = scoped.length ? scoped : document.querySelectorAll('.case:not([hidden])');
    cards.forEach(c => {
      if (c.classList.contains('empty') || c.classList.contains('is-empty')) return;
      setCaseOpen(c, expand);
    });
  }
  if (expandAll) expandAll.addEventListener('click', () => toggleableCases(true));
  if (collapseAll) collapseAll.addEventListener('click', () => toggleableCases(false));

  const sevTabs = document.querySelectorAll('.tab[data-sev]');
  const sevPanels = document.querySelectorAll('[data-sev-panel]');
  function showSev(name) {
    if (!sevTabs.length) return;
    sevTabs.forEach(t => t.setAttribute('aria-selected', t.getAttribute('data-sev') === name ? 'true' : 'false'));
    sevPanels.forEach(p => {
      p.hidden = name !== 'all' && p.getAttribute('data-sev-panel') !== name;
    });
    const matched = name === 'all' || Array.prototype.some.call(
      sevPanels, p => p.getAttribute('data-sev-panel') === name);
    const emptyEl = document.getElementById('sev-empty');
    if (emptyEl) emptyEl.hidden = matched;
  }
  sevTabs.forEach(t => t.addEventListener('click', () => showSev(t.getAttribute('data-sev'))));

  function openHash() {
    if (!location.hash) return;
    let el;
    try { el = document.querySelector(location.hash); } catch (e) { return; }
    if (!el) return;
    const panel = el.closest('[data-sev-panel]') || (el.hasAttribute('data-sev-panel') ? el : null);
    if (panel && panel.getAttribute('data-sev-panel')) showSev('all');
    const card = el.classList && el.classList.contains('case') ? el : el.closest('.case');
    if (card) setCaseOpen(card, true);
  }
  openHash();
  window.addEventListener('hashchange', openHash);
})();
