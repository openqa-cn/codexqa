(function () {
  var root = document.documentElement;
  var body = document.body;
  var THEME_KEY = 'codexqa-wiki-theme';
  var narrow = window.matchMedia('(max-width: 960px)');

  function readJson(id) {
    var el = document.getElementById(id);
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }
  var ui = readJson('wiki-ui') || { searchEmpty: '', kinds: {} };

  // Theme: stored choice, else the OS preference.
  var themeBtn = document.querySelector('.theme-btn');
  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', currentTheme());
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
    });
  }

  // Drawer navigation on narrow screens.
  var menuBtn = document.querySelector('.menu-btn');
  var scrim = document.querySelector('.scrim');
  function setNav(open) {
    body.classList.toggle('nav-open', open);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (scrim) scrim.hidden = !open;
    if (open) {
      var first = document.querySelector('#nav a');
      if (first) first.focus({ preventScroll: true });
    }
  }
  if (menuBtn) menuBtn.addEventListener('click', function () { setNav(!body.classList.contains('nav-open')); });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });

  // Jump to a section, module, symbol, or file and make sure it is visible.
  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1600);
  }
  function reveal(el) {
    for (var p = el; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS') p.open = true;
    }
  }
  function go(id, opts) {
    opts = opts || {};
    var el = id && document.getElementById(id);
    if (!el) return false;
    reveal(el);
    var target = el;
    if (opts.sym || opts.file) {
      var items = el.querySelectorAll(opts.sym ? 'li[data-sym]' : 'li[data-file]');
      for (var i = 0; i < items.length; i += 1) {
        var hit = opts.sym ? items[i].getAttribute('data-sym') === opts.sym : items[i].getAttribute('data-file') === opts.file;
        if (hit) { target = items[i]; reveal(target); break; }
      }
    }
    if (opts.history !== false && location.hash !== '#' + id && history.pushState) history.pushState(null, '', '#' + id);
    var far = Math.abs(target.getBoundingClientRect().top) > window.innerHeight * 1.5;
    var still = far || matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: target === el ? 'start' : 'center', behavior: still ? 'auto' : 'smooth' });
    if (target.tagName === 'DETAILS' || target.tagName === 'LI') flash(target);
    if (narrow.matches) setNav(false);
    if (opts.focus) {
      var f = target.tagName === 'DETAILS' ? target.querySelector('summary') : target;
      if (f.tagName !== 'SUMMARY' && f.tagName !== 'A' && !f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1');
      f.focus({ preventScroll: true });
    }
    return true;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id) return;
    if (go(id, { focus: !a.closest('.graph-svg') })) e.preventDefault();
  });
  function fromLocation() { if (location.hash.length > 1) go(decodeURIComponent(location.hash.slice(1)), { history: false }); }
  window.addEventListener('popstate', fromLocation);
  window.addEventListener('hashchange', fromLocation);
  fromLocation();

  // Expand / collapse all module cards.
  document.querySelectorAll('[data-expand]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('data-expand') === '1';
      document.querySelectorAll('details.mod').forEach(function (d) { d.open = open; });
    });
  });

  // Graph: highlight a module and its direct neighbours.
  var svg = document.querySelector('.graph-svg');
  function highlight(id) {
    if (!svg) return;
    if (!id) {
      svg.classList.remove('focus');
      svg.querySelectorAll('.on').forEach(function (el) { el.classList.remove('on'); });
      return;
    }
    svg.classList.add('focus');
    var keep = {};
    keep[id] = true;
    svg.querySelectorAll('.edge').forEach(function (g) {
      var hit = g.getAttribute('data-from') === id || g.getAttribute('data-to') === id;
      g.classList.toggle('on', hit);
      if (hit) { keep[g.getAttribute('data-from')] = true; keep[g.getAttribute('data-to')] = true; }
    });
    svg.querySelectorAll('.node').forEach(function (n) { n.classList.toggle('on', !!keep[n.getAttribute('data-mod')]); });
  }
  if (svg) {
    svg.querySelectorAll('.node').forEach(function (n) {
      var id = n.getAttribute('data-mod');
      n.addEventListener('mouseenter', function () { highlight(id); });
      n.addEventListener('focus', function () { highlight(id); });
      n.addEventListener('mouseleave', function () { highlight(null); });
      n.addEventListener('blur', function () { highlight(null); });
    });
    svg.querySelectorAll('.edge').forEach(function (g) {
      g.addEventListener('mouseenter', function () {
        svg.classList.add('focus');
        g.classList.add('on');
        svg.querySelectorAll('.node').forEach(function (n) {
          var id = n.getAttribute('data-mod');
          n.classList.toggle('on', id === g.getAttribute('data-from') || id === g.getAttribute('data-to'));
        });
      });
      g.addEventListener('mouseleave', function () { highlight(null); });
    });
  }
  document.querySelectorAll('details.mod > summary').forEach(function (s) {
    var id = s.parentElement.getAttribute('data-mod');
    s.addEventListener('mouseenter', function () { highlight(id); });
    s.addEventListener('mouseleave', function () { highlight(null); });
  });

  // Current section in the sidebar: the last tracked element whose top has
  // passed under the top bar; at the very bottom, the last section.
  var links = {};
  document.querySelectorAll('.side a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  var watched = [].slice.call(document.querySelectorAll('[data-section], details.mod')).filter(function (el) { return links[el.id]; });
  var sections = [].slice.call(document.querySelectorAll('[data-section]'));
  var current = null;
  function mark() {
    var best = watched.length ? watched[0].id : null;
    var line = 96;
    for (var i = 0; i < watched.length; i += 1) {
      if (watched[i].getBoundingClientRect().top <= line) best = watched[i].id;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && sections.length) {
      best = sections[sections.length - 1].id;
    }
    if (!best || best === current) return;
    current = best;
    Object.keys(links).forEach(function (k) {
      links[k].classList.toggle('active', k === best);
      if (k === best) links[k].setAttribute('aria-current', 'location');
      else links[k].removeAttribute('aria-current');
    });
    var a = links[best];
    var side = a && a.closest('.side');
    if (side && !narrow.matches) {
      var r = a.getBoundingClientRect();
      var s = side.getBoundingClientRect();
      if (r.top < s.top + 8 || r.bottom > s.bottom - 8) side.scrollTop += r.top - s.top - s.height / 3;
    }
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; mark(); });
  }, { passive: true });
  mark();

  // Short search placeholder where the box is narrow.
  var qInput = document.getElementById('q');
  if (qInput && qInput.getAttribute('data-short')) {
    var longPh = qInput.getAttribute('placeholder');
    var small = window.matchMedia('(max-width: 640px)');
    var setPh = function () { qInput.setAttribute('placeholder', small.matches ? qInput.getAttribute('data-short') : longPh); };
    setPh();
    if (small.addEventListener) small.addEventListener('change', setPh);
  }

  // Search over modules, symbols, and files.
  var index = readJson('wiki-index') || [];
  var q = document.getElementById('q');
  var list = document.getElementById('q-results');
  var hits = [];
  var cursor = -1;
  function norm(s) { return String(s || '').toLowerCase(); }
  function score(item, terms) {
    var l = norm(item.l);
    var hay = l + ' ' + norm(item.s) + ' ' + norm(item.id);
    var total = 0;
    for (var i = 0; i < terms.length; i += 1) {
      var t = terms[i];
      if (hay.indexOf(t) < 0) return 0;
      total += l === t ? 6 : l.indexOf(t) === 0 ? 4 : l.indexOf(t) >= 0 ? 2 : 1;
    }
    return total + (item.k === 'm' ? 0.3 : item.k === 's' ? 0.2 : 0);
  }
  function render() {
    list.innerHTML = '';
    if (!hits.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = ui.searchEmpty;
      list.appendChild(li);
    }
    hits.forEach(function (h, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'q-opt-' + i;
      li.setAttribute('aria-selected', i === cursor ? 'true' : 'false');
      var k = document.createElement('span');
      k.className = 'k';
      k.textContent = (ui.kinds && ui.kinds[h.k]) || h.k;
      var l = document.createElement('span');
      l.className = 'l';
      l.textContent = h.k === 'm' ? h.id + '  ' + h.l : h.l;
      var s = document.createElement('span');
      s.className = 's';
      s.textContent = h.s;
      li.appendChild(k); li.appendChild(l); li.appendChild(s);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
      list.appendChild(li);
    });
    list.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    q.setAttribute('aria-activedescendant', cursor >= 0 ? 'q-opt-' + cursor : '');
  }
  function close() {
    list.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    q.removeAttribute('aria-activedescendant');
    cursor = -1;
  }
  function choose(i) {
    var h = hits[i];
    if (!h) return;
    close();
    go(h.id, h.k === 's' ? { sym: h.l, focus: true } : h.k === 'f' ? { file: h.l, focus: true } : { focus: true });
  }
  if (q && list) {
    q.addEventListener('input', function () {
      var terms = norm(q.value).split(/\s+/).filter(Boolean);
      if (!terms.length) { close(); return; }
      hits = index.map(function (item) { return { item: item, s: score(item, terms) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.item.l.length - b.item.l.length; })
        .slice(0, 12)
        .map(function (x) { return x.item; });
      cursor = hits.length ? 0 : -1;
      render();
    });
    q.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!hits.length) return;
        cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        render();
        var opt = document.getElementById('q-opt-' + cursor);
        if (opt) opt.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(cursor);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    q.addEventListener('blur', function () { setTimeout(close, 120); });
    q.addEventListener('focus', function () { if (q.value) q.dispatchEvent(new Event('input')); });
  }
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    if (q && !typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      if (narrow.matches) setNav(false);
      q.focus();
      q.select();
    } else if (e.key === 'Escape' && body.classList.contains('nav-open')) {
      setNav(false);
      if (menuBtn) menuBtn.focus();
    }
  });

  // Print with every card open.
  var opened = [];
  window.addEventListener('beforeprint', function () {
    opened = [];
    document.querySelectorAll('details').forEach(function (d) { if (!d.open) { opened.push(d); d.open = true; } });
  });
  window.addEventListener('afterprint', function () { opened.forEach(function (d) { d.open = false; }); opened = []; });
})();
