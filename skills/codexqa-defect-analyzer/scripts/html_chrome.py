"""Shared CodexQA HTML report chrome (testcase-generator skin)."""
from pathlib import Path
from typing import Optional

_ASSETS = Path(__file__).resolve().parent.parent / "assets"
_DOCS_CHROME = Path(__file__).resolve().parents[3] / "docs" / "assets" / "report-chrome.css"
_DOCS_JS = Path(__file__).resolve().parents[3] / "docs" / "assets" / "report-chrome.js"


def _read(path: Path, fallback: Optional[Path] = None) -> str:
    if path.is_file():
        return path.read_text(encoding="utf-8")
    if fallback and fallback.is_file():
        return fallback.read_text(encoding="utf-8")
    raise FileNotFoundError("missing report chrome: %s" % path)


def chrome_css() -> str:
    return _read(_ASSETS / "report-chrome.css", _DOCS_CHROME)


def chrome_js() -> str:
    js_skill = _ASSETS / "report-chrome.js"
    return _read(js_skill if js_skill.is_file() else _DOCS_JS, _DOCS_JS)


def boot_script() -> str:
    return """<script>
(function(){
  try {
    var prefix = document.documentElement.getAttribute('data-store') || 'codexqa-report';
    var t = localStorage.getItem(prefix + '-theme');
    var l = localStorage.getItem(prefix + '-lang');
    if (t === 'day') t = 'light';
    if (t === 'night') t = 'dark';
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    if (l === 'en' || l === 'zh') {
      document.documentElement.setAttribute('data-lang', l);
      document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    }
  } catch (e) {}
})();
</script>"""


def prefs_html() -> str:
    return """<div class="prefs" role="toolbar" aria-label="Language and theme">
  <div class="group" role="group" aria-label="Language">
    <button type="button" data-set-lang="zh" aria-pressed="true">中文</button>
    <button type="button" data-set-lang="en" aria-pressed="false">EN</button>
  </div>
  <div class="group" role="group" aria-label="Theme">
    <button type="button" data-set-theme="light" aria-pressed="true"><span data-zh="白天" data-en="Light">白天</span></button>
    <button type="button" data-set-theme="dark" aria-pressed="false"><span data-zh="黑夜" data-en="Dark">黑夜</span></button>
  </div>
</div>"""
