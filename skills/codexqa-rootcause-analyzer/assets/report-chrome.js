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
      if (el.tagName === 'TITLE') {
        document.title = v;
        return;
      }
      if (el.tagName === 'OPTION') {
        el.textContent = v;
        return;
      }
      if (el.children.length) return;
      el.textContent = v;
    });
    document.querySelectorAll('[data-zh-placeholder][data-en-placeholder]').forEach(el => {
      el.setAttribute('placeholder', el.getAttribute(lang === 'en' ? 'data-en-placeholder' : 'data-zh-placeholder') || '');
    });
    document.querySelectorAll('[data-zh-alt][data-en-alt]').forEach(el => {
      el.setAttribute('alt', el.getAttribute(lang === 'en' ? 'data-en-alt' : 'data-zh-alt') || '');
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
})();
