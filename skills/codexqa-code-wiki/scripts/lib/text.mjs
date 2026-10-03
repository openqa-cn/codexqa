export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Links leave the page only for http(s); anything else renders as plain text.
export function safeUrl(value) {
  const s = String(value ?? '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

// Notes support `code`, **bold**, and Pxx references that become module links.
export function inline(text, linkable = () => false) {
  const parts = String(text ?? '').split(/(`[^`]+`)/g);
  return parts.map((part) => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    let html = esc(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\bP(\d{2,3})\b/g, (m) => (linkable(m) ? `<a class="mref" href="#${m}" data-mod="${m}">${m}</a>` : m));
    return html;
  }).join('');
}

export function blocks(text, linkable) {
  const paras = String(text ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => {
    const lines = p.split('\n').map((l) => l.trim());
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''), linkable)}</li>`).join('')}</ul>`;
    }
    return `<p>${inline(lines.join(' '), linkable)}</p>`;
  }).join('\n');
}

// Approximate rendered width in em: CJK and full-width glyphs are 1em, Latin ~0.56em.
export function textWidth(text) {
  let w = 0;
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0);
    if (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x20000)) w += 1;
    else if (/[A-Z@#%&mwMW]/.test(ch)) w += 0.68;
    else if (/[il.,:;'|!]/.test(ch)) w += 0.3;
    else w += 0.56;
  }
  return w;
}

export function fit(text, maxEm) {
  const s = String(text ?? '');
  if (textWidth(s) <= maxEm) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch) > maxEm - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

export function fmtNumber(n, lang) {
  return Number(n || 0).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN');
}
