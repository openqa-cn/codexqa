#!/usr/bin/env python3
"""Aggregate Web / Server / APP cases into one HTML generation report.

Reads from ``{run_dir}/testcase/cases/`` (falls back to ``initialcase/``),
writes ``{run_dir}/testdesign/testcase_generation_report.html``.

Usage:
  tcg-python generate_case_report.py --run-dir <run_dir>
  tcg-python generate_case_report.py --run-dir <run_dir> --out <path.html>
  tcg-python generate_case_report.py --self-check
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


SCRIPT_VERSION = "1.1.1"


def _bi(zh: str, en: str, tag: str = "span", **attrs: str) -> str:
    """Bilingual chrome text; JS copies data-zh / data-en into textContent."""
    extra = "".join(f' {k}="{_esc(v)}"' for k, v in attrs.items())
    return (
        f'<{tag} data-zh="{_esc(zh)}" data-en="{_esc(en)}"{extra}>'
        f"{_esc(zh)}</{tag}>"
    )


@dataclass
class StepRow:
    num: str
    step: str
    expected: str


@dataclass
class CaseRecord:
    client: str  # web | server | app
    case_id: str
    name: str
    module: str
    priority: str
    case_type: str
    preconditions: str
    steps: List[StepRow] = field(default_factory=list)
    expected_block: str = ""  # server-style single expected column
    provenance: str = ""
    scenario: str = ""
    source_path: str = ""
    generated_at: str = ""
    updated_at: str = ""
    ambiguity: str = ""
    ui_image: str = ""


# ---------------------------------------------------------------------------
# Markdown helpers
# ---------------------------------------------------------------------------

META_RE = re.compile(
    r"^>\s*(Case ID|Functional module|Case type|Generated at|Updated at|Plan scenario)\s*:\s*(.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
HEADING_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
SECTION_RE = re.compile(
    r"^##\s+(Preconditions|Operation steps and Expected results.*?|UI image|"
    r"Ambiguity clarification|Provenance)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
TABLE_ROW_RE = re.compile(r"^\|(.+)\|$")
SRV_TABLE_SPLIT = re.compile(r"(?<!\\)\|")


def _unescape_cell(text: str) -> str:
    return text.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n").strip()


def _split_md_row(line: str) -> List[str]:
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    return [c.strip() for c in SRV_TABLE_SPLIT.split(inner)]


def _is_sep_row(cells: List[str]) -> bool:
    if not cells:
        return False
    return all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) for c in cells if c)


def _extract_sections(body: str) -> Dict[str, str]:
    matches = list(SECTION_RE.finditer(body))
    sections: Dict[str, str] = {}
    for i, m in enumerate(matches):
        key = m.group(1).strip().lower()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        sections[key] = body[start:end].strip()
    return sections


def _parse_step_table(section: str) -> List[StepRow]:
    rows: List[StepRow] = []
    for line in section.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = _split_md_row(line)
        if len(cells) < 3 or _is_sep_row(cells):
            continue
        if cells[0].lower() in ("#", "step", "no", "序号"):
            continue
        if "expected" in cells[0].lower() and "step" in "".join(cells).lower():
            continue
        rows.append(StepRow(num=cells[0], step=_unescape_cell(cells[1]), expected=_unescape_cell(cells[2])))
    return rows


def _parse_index_priorities(index_path: Path) -> Dict[str, Dict[str, str]]:
    """Map case_id -> {priority, module, name, case_type, file} from index md."""
    out: Dict[str, Dict[str, str]] = {}
    if not index_path.is_file():
        return out
    text = index_path.read_text(encoding="utf-8", errors="replace")
    in_case_index = False
    header: List[str] = []
    for line in text.splitlines():
        if line.strip().startswith("## Case index") or line.strip().startswith("## Index"):
            in_case_index = True
            header = []
            continue
        if in_case_index and line.startswith("## "):
            break
        if not in_case_index or not line.strip().startswith("|"):
            continue
        cells = _split_md_row(line)
        if not cells:
            continue
        if _is_sep_row(cells):
            continue
        low = [c.lower() for c in cells]
        if "case id" in low[0] or low[0] in ("case id", "用例id", "caseid"):
            header = low
            continue
        if not header:
            # Heuristic: Case ID | Remark | Case name | Functional module | Priority | Case type | ...
            if len(cells) >= 6:
                case_id = cells[0]
                out[case_id] = {
                    "name": cells[2] if len(cells) > 2 else "",
                    "module": cells[3] if len(cells) > 3 else "",
                    "priority": cells[4] if len(cells) > 4 else "",
                    "case_type": cells[5] if len(cells) > 5 else "",
                    "file": cells[-1] if cells else "",
                }
            continue
        # Map by header names
        row = {header[i]: cells[i] if i < len(cells) else "" for i in range(len(header))}
        case_id = row.get("case id") or row.get("caseid") or cells[0]
        out[case_id] = {
            "name": row.get("case name", cells[2] if len(cells) > 2 else ""),
            "module": row.get("functional module", cells[3] if len(cells) > 3 else ""),
            "priority": row.get("priority", cells[4] if len(cells) > 4 else ""),
            "case_type": row.get("case type", cells[5] if len(cells) > 5 else ""),
            "file": row.get("file path", cells[-1] if cells else ""),
        }
    return out


def parse_standalone_case(path: Path, client: str, index_meta: Dict[str, Dict[str, str]]) -> Optional[CaseRecord]:
    text = path.read_text(encoding="utf-8", errors="replace")
    heading = HEADING_RE.search(text)
    name = heading.group(1).strip() if heading else path.stem
    meta = {m.group(1).strip().lower(): m.group(2).strip() for m in META_RE.finditer(text)}
    case_id = meta.get("case id", "")
    if not case_id:
        # filename often starts with case id
        m = re.match(r"^([0-9A-Za-z._-]+)-", path.name)
        case_id = m.group(1) if m else path.stem
    sections = _extract_sections(text)
    pre = ""
    steps: List[StepRow] = []
    for key, val in sections.items():
        if key.startswith("precondition"):
            pre = val
        elif key.startswith("operation steps"):
            steps = _parse_step_table(val)
    provenance = sections.get("provenance", "")
    ambiguity = sections.get("ambiguity clarification", "")
    ui_image = sections.get("ui image", "")

    idx = index_meta.get(case_id, {})
    priority = idx.get("priority", "") or _guess_priority(text)
    module = meta.get("functional module") or idx.get("module") or ""
    case_type = meta.get("case type") or idx.get("case_type") or ""
    if idx.get("name"):
        name = idx["name"]

    return CaseRecord(
        client=client,
        case_id=case_id,
        name=name,
        module=module,
        priority=priority or "—",
        case_type=case_type or "—",
        preconditions=pre,
        steps=steps,
        provenance=provenance,
        scenario=meta.get("plan scenario", ""),
        source_path=str(path),
        generated_at=meta.get("generated at", ""),
        updated_at=meta.get("updated at", ""),
        ambiguity=ambiguity,
        ui_image=ui_image,
    )


def _guess_priority(text: str) -> str:
    m = re.search(r"\b(P[0-3])\b", text)
    return m.group(1) if m else ""


def parse_server_table(path: Path) -> List[CaseRecord]:
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    # Find the case-details table (header contains Case ID + Preconditions)
    lines = text.splitlines()
    header_idx = -1
    headers: List[str] = []
    for i, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        cells = _split_md_row(line)
        joined = " ".join(c.lower() for c in cells)
        if "case id" in joined and "precondition" in joined:
            headers = [c.strip() for c in cells]
            header_idx = i
            break
    if header_idx < 0:
        return []

    # normalize header keys
    def key_of(h: str) -> str:
        low = h.lower().strip()
        mapping = {
            "case id": "case_id",
            "functional module": "module",
            "case name": "name",
            "preconditions": "preconditions",
            "operation steps": "steps",
            "expected results": "expected",
            "priority": "priority",
            "case type": "case_type",
            "provenance": "provenance",
        }
        return mapping.get(low, low)

    keys = [key_of(h) for h in headers]
    cases: List[CaseRecord] = []
    for line in lines[header_idx + 1 :]:
        if not line.strip().startswith("|"):
            if cases and line.strip().startswith("##"):
                break
            continue
        cells = _split_md_row(line)
        if _is_sep_row(cells):
            continue
        if len(cells) < 3:
            continue
        row = {keys[i]: _unescape_cell(cells[i]) if i < len(cells) else "" for i in range(len(keys))}
        case_id = row.get("case_id", "").strip()
        if not case_id or case_id.lower() in ("case id", "—", "-"):
            continue
        step_text = row.get("steps", "")
        # Represent server steps as a single numbered block when not a step table
        steps = [StepRow(num="1", step=step_text, expected=row.get("expected", ""))] if step_text else []
        cases.append(
            CaseRecord(
                client="server",
                case_id=case_id,
                name=row.get("name", ""),
                module=row.get("module", ""),
                priority=row.get("priority", "—") or "—",
                case_type=row.get("case_type", "—") or "—",
                preconditions=row.get("preconditions", ""),
                steps=steps,
                expected_block=row.get("expected", ""),
                provenance=row.get("provenance", ""),
                source_path=str(path),
            )
        )
    return cases


def load_cases(run_dir: Path) -> Tuple[List[CaseRecord], Dict[str, str]]:
    """Prefer cases/; fall back to initialcase/ for missing ends."""
    cases_root = run_dir / "testcase" / "cases"
    init_root = run_dir / "testcase" / "initialcase"
    meta: Dict[str, str] = {
        "cases_root": str(cases_root if cases_root.is_dir() else init_root),
        "plan": str(run_dir / "testdesign" / "test_design.md"),
    }

    def pick(*rels: str) -> Optional[Path]:
        for root in (cases_root, init_root):
            for rel in rels:
                p = root / rel
                if p.exists():
                    return p
        return None

    records: List[CaseRecord] = []

    # Web
    web_dir = pick("testcase_web")
    if web_dir and web_dir.is_dir():
        idx = _parse_index_priorities(web_dir / "testcase_web_index.md")
        tc = web_dir / "testcases"
        if tc.is_dir():
            for path in sorted(tc.glob("*.md")):
                rec = parse_standalone_case(path, "web", idx)
                if rec:
                    records.append(rec)

    # APP
    app_dir = pick("testcase_app")
    if app_dir and app_dir.is_dir():
        idx = _parse_index_priorities(app_dir / "testcase_app_index.md")
        tc = app_dir / "testcases"
        if tc.is_dir():
            for path in sorted(tc.glob("*.md")):
                rec = parse_standalone_case(path, "app", idx)
                if rec:
                    records.append(rec)

    # Server
    srv = pick("testcase_srv.md")
    if srv and srv.is_file():
        records.extend(parse_server_table(srv))

    return records, meta


# ---------------------------------------------------------------------------
# HTML render
# ---------------------------------------------------------------------------

def _esc(text: str) -> str:
    return html.escape(text or "", quote=True)


def _inline_md_to_html(escaped: str) -> str:
    """Convert common Markdown inline markers on already-escaped text.

    Handles: ``code``, **bold**, __bold__, *italic*, _italic_, [text](url).
    Does not leave raw ``**`` / backticks in the output.
    """
    if not escaped:
        return ""

    placeholders: List[str] = []

    def stash(html_frag: str) -> str:
        placeholders.append(html_frag)
        return "\x00MD%d\x00" % (len(placeholders) - 1)

    # Inline code first (so markers inside code stay literal)
    def code_repl(m: re.Match) -> str:
        return stash("<code>%s</code>" % m.group(1))

    text = re.sub(r"`([^`\n]+)`", code_repl, escaped)

    # Links [label](url) — url already escaped
    def link_repl(m: re.Match) -> str:
        return stash('<a href="%s" rel="noopener noreferrer">%s</a>' % (m.group(2), m.group(1)))

    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link_repl, text)

    # Bold: **...** or __...__
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__(.+?)__", r"<strong>\1</strong>", text)

    # Italic: *...* or _..._ (avoid matching inside words for _)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)", r"<em>\1</em>", text)

    # Stray leftover emphasis markers (unpaired) — strip so they never show as source Markdown
    text = text.replace("**", "").replace("__", "")

    for i, frag in enumerate(placeholders):
        text = text.replace("\x00MD%d\x00" % i, frag)
    return text


def _mdish_to_html(text: str) -> str:
    """Render case-field Markdown as HTML (lists, bold, code, paragraphs)."""
    if not text or text.strip() in ("—", "---", "-"):
        return "<span class='muted'>—</span>"

    # Normalize common HTML line-breaks that may still be present
    raw = text.replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    raw = raw.strip()

    escaped = _esc(raw)
    lines = escaped.split("\n")
    parts: List[str] = []
    in_ul = False
    in_ol = False

    def close_lists() -> None:
        nonlocal in_ul, in_ol
        if in_ul:
            parts.append("</ul>")
            in_ul = False
        if in_ol:
            parts.append("</ol>")
            in_ol = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            close_lists()
            continue

        ul_m = re.match(r"^[-*•]\s+(.+)$", stripped)
        ol_m = re.match(r"^(\d+)[.)、］\]]\s*(.+)$", stripped) or re.match(
            r"^(\d+)[）)]\s*(.+)$", stripped
        )

        if ul_m:
            if in_ol:
                parts.append("</ol>")
                in_ol = False
            if not in_ul:
                parts.append("<ul>")
                in_ul = True
            parts.append("<li>%s</li>" % _inline_md_to_html(ul_m.group(1)))
            continue

        if ol_m:
            if in_ul:
                parts.append("</ul>")
                in_ul = False
            if not in_ol:
                parts.append("<ol>")
                in_ol = True
            parts.append("<li>%s</li>" % _inline_md_to_html(ol_m.group(2)))
            continue

        close_lists()
        # Standalone bold heading line → slightly stronger paragraph
        inline = _inline_md_to_html(stripped)
        if re.fullmatch(r"<strong>[^<]+</strong>", inline):
            parts.append('<p class="md-heading">%s</p>' % inline)
        else:
            parts.append("<p>%s</p>" % inline)

    close_lists()
    return "\n".join(parts) if parts else "<span class='muted'>—</span>"


def _pri_class(p: str) -> str:
    p = (p or "").upper()
    if p in ("P0", "P1", "P2", "P3"):
        return p.lower()
    return "px"


def _stats(records: List[CaseRecord]) -> Dict:
    by_client = {"web": 0, "server": 0, "app": 0}
    by_pri = {"P0": 0, "P1": 0, "P2": 0, "P3": 0, "—": 0}
    modules: Dict[str, int] = {}
    for r in records:
        by_client[r.client] = by_client.get(r.client, 0) + 1
        pri = r.priority if r.priority in by_pri else "—"
        by_pri[pri] = by_pri.get(pri, 0) + 1
        modules[r.module or "未分组"] = modules.get(r.module or "未分组", 0) + 1
    return {"total": len(records), "by_client": by_client, "by_pri": by_pri, "modules": modules}


def render_html(
    records: List[CaseRecord],
    run_dir: Path,
    meta: Dict[str, str],
    project_name: str = "",
) -> str:
    stats = _stats(records)
    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    runid = ""
    cfg = run_dir / "testcase" / "testdocs" / "userConfig.json"
    if cfg.is_file():
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
            runid = str(data.get("runid") or "")
            project_name = project_name or str(data.get("projectName") or "")
        except Exception:
            pass
    if not project_name:
        project_name = run_dir.name

    plan_path = run_dir / "testdesign" / "test_design.md"
    plan_linked = plan_path.is_file()

    def case_card(r: CaseRecord, idx: int) -> str:
        steps_html = ""
        if r.steps:
            body_rows = []
            for s in r.steps:
                exp = s.expected or r.expected_block
                body_rows.append(
                    "<tr>"
                    f"<td class='num'>{_esc(s.num)}</td>"
                    f"<td>{_mdish_to_html(s.step)}</td>"
                    f"<td>{_mdish_to_html(exp)}</td>"
                    "</tr>"
                )
            steps_html = (
                "<table class='steps'><thead><tr>"
                f"<th>#</th>"
                f"<th>{_bi('操作步骤', 'Steps')}</th>"
                f"<th>{_bi('预期结果', 'Expected results')}</th>"
                "</tr></thead><tbody>"
                + "".join(body_rows)
                + "</tbody></table>"
            )
        elif r.expected_block:
            steps_html = f"<div class='block'>{_mdish_to_html(r.expected_block)}</div>"
        else:
            steps_html = f"<p class='muted'>{_bi('无步骤明细', 'No step details')}</p>"

        search_blob = " ".join(
            [
                r.case_id,
                r.name,
                r.module,
                r.priority,
                r.case_type,
                r.scenario,
                r.preconditions,
                r.provenance,
            ]
        )
        amb = ""
        if r.ambiguity.strip() and r.ambiguity.strip() not in ("—", "---"):
            amb = (
                f"<h4>{_bi('歧义说明', 'Ambiguity')}</h4>"
                f"<div class='block'>{_mdish_to_html(r.ambiguity)}</div>"
            )
        return f"""
<article class="case" data-client="{_esc(r.client)}" data-pri="{_esc(r.priority)}"
  data-module="{_esc(r.module)}" data-search="{_esc(search_blob.lower())}" id="case-{idx}">
  <header class="case-head" onclick="this.parentElement.classList.toggle('open')">
    <span class="badge client {_esc(r.client)}">{_esc(r.client.upper())}</span>
    <span class="badge pri {_pri_class(r.priority)}">{_esc(r.priority)}</span>
    <span class="badge type">{_esc(r.case_type)}</span>
    <h3>{_esc(r.name)}</h3>
    <span class="meta-id">{_esc(r.case_id)}</span>
    <span class="chev" aria-hidden="true"></span>
  </header>
  <div class="case-body">
    <dl class="kv">
      <div><dt>{_bi('功能模块', 'Module')}</dt><dd>{_esc(r.module or '—')}</dd></div>
      <div><dt>{_bi('计划场景', 'Plan scenario')}</dt><dd>{_esc(r.scenario or '—')}</dd></div>
      <div><dt>{_bi('生成时间', 'Generated at')}</dt><dd>{_esc(r.generated_at or '—')}</dd></div>
      <div><dt>{_bi('来源文件', 'Source file')}</dt><dd><code>{_esc(Path(r.source_path).name if r.source_path else '—')}</code></dd></div>
    </dl>
    <h4>{_bi('前置条件', 'Preconditions')}</h4>
    <div class="block">{_mdish_to_html(r.preconditions)}</div>
    <h4>{_bi('步骤与预期', 'Steps & expected')}</h4>
    {steps_html}
    <h4>{_bi('溯源', 'Provenance')}</h4>
    <div class="block">{_mdish_to_html(r.provenance)}</div>
    {amb}
  </div>
</article>
"""

    cards_by: Dict[str, List[str]] = {"web": [], "server": [], "app": []}
    for i, r in enumerate(records):
        cards_by.setdefault(r.client, []).append(case_card(r, i))

    def section(client: str, title_zh: str, title_en: str, desc_zh: str, desc_en: str) -> str:
        cards = cards_by.get(client) or []
        count = stats["by_client"].get(client, 0)
        empty = ""
        if not cards:
            empty = (
                "<div class='empty'>"
                + _bi(
                    f"本运行未生成{title_zh}（仅当正式方案中该端场景存在时 Stage 6 才会写出）。",
                    f"No {title_en.lower()} in this run (Stage 6 writes an end only when the formal plan has matching scenarios).",
                )
                + "</div>"
            )
        return f"""
<section class="panel" id="panel-{client}" data-panel="{client}" hidden>
  <div class="panel-head">
    <h2>{_bi(title_zh, title_en)} <span class="count">{count}</span></h2>
    <p class="desc">{_bi(desc_zh, desc_en)}</p>
  </div>
  <div class="case-list">{"".join(cards)}{empty}</div>
</section>
"""

    pri_bars = "".join(
        f"<div class='bar-row'><span>{k}</span>"
        f"<div class='bar'><i style='width:{ (v * 100 / stats['total']) if stats['total'] else 0:.1f}%'></i></div>"
        f"<b>{v}</b></div>"
        for k, v in stats["by_pri"].items()
        if k != "—" or v
    )

    client_chips = "".join(
        f"<div class='stat-chip {_esc(k)}'><span class='n'>{v}</span><span class='l'>{k.upper()}</span></div>"
        for k, v in stats["by_client"].items()
    )

    empty_all = (
        f"<div class='empty'>{_bi('尚未生成任何用例。请先完成 Stage 6 双写。', 'No cases yet. Finish Stage 6 dual-write first.')}</div>"
        if not records
        else ""
    )
    plan_note = _bi("已关联", "Linked") if plan_linked else _bi("未找到 test_design.md", "test_design.md not found")

    return f"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="light" data-lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title data-zh="测试用例生成报告 · {_esc(project_name)}" data-en="Test Case Generation Report · {_esc(project_name)}">测试用例生成报告 · {_esc(project_name)}</title>
<style>
:root, html[data-theme="light"] {{
  color-scheme: light;
  --bg:#f0f3f6; --sheet:#ffffff; --ink:#1a2332; --muted:#5a6578;
  --line:#d5dde8; --acc:#0f6b4c; --acc-soft:#e6f4ee; --acc-fg:#fff;
  --web:#0b5cab; --web-bg:#e8f1fb; --web-line:#c5d9f0;
  --server:#6b3fa0; --server-bg:#f3eafb; --server-line:#e0d0f2;
  --app:#b45309; --app-bg:#fff4e6; --app-line:#f0d7b5;
  --p0:#b42318; --p0-bg:#fde8e4;
  --p1:#c2410c; --p1-bg:#ffedd5;
  --p2:#9a6700; --p2-bg:#fef3c7;
  --p3:#475569; --p3-bg:#e2e8f0;
  --card:#f8fafc; --chip:#fff; --head:#fbfcfd; --code-bg:#eef2f6; --bar-track:#e8edf3;
  --hero-a:#d9ebe3; --hero-b:#d6e4f5;
  --toolbar-bg: color-mix(in srgb, var(--sheet) 92%, transparent);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
}}
html[data-theme="dark"] {{
  color-scheme: dark;
  --bg:#0f141b; --sheet:#1a222c; --ink:#e8edf2; --muted:#9aa7b5;
  --line:#2f3b49; --acc:#3ecf8e; --acc-soft:#163526; --acc-fg:#0b1a12;
  --web:#7eb6ff; --web-bg:#1a2a3d; --web-line:#2a4060;
  --server:#c4a1ff; --server-bg:#2a1f3d; --server-line:#3d2f5c;
  --app:#ffb074; --app-bg:#3a2718; --app-line:#5a3a22;
  --p0:#ff8a80; --p0-bg:#3a1d1c;
  --p1:#ffb074; --p1-bg:#3a2718;
  --p2:#e6c35c; --p2-bg:#3a3218;
  --p3:#cbd5e1; --p3-bg:#2a3441;
  --card:#141b24; --chip:#1f2833; --head:#162029; --code-bg:#24303b; --bar-track:#24303b;
  --hero-a:#1a2e28; --hero-b:#1a2433;
  --toolbar-bg: color-mix(in srgb, var(--sheet) 88%, transparent);
}}
* {{ box-sizing: border-box; }}
body {{ margin:0; font:14px/1.55 var(--sans); color:var(--ink); background:
  radial-gradient(1200px 500px at 10% -10%, var(--hero-a) 0%, transparent 55%),
  radial-gradient(900px 400px at 100% 0%, var(--hero-b) 0%, transparent 50%),
  var(--bg); }}
.prefs {{ position:sticky; top:0; z-index:20; display:flex; justify-content:flex-end; gap:8px;
  padding:10px 18px; background:var(--toolbar-bg); backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line); }}
.prefs .group {{ display:flex; gap:4px; align-items:center; padding:2px;
  border:1px solid var(--line); border-radius:999px; background:var(--sheet); }}
.prefs button {{ appearance:none; border:0; background:transparent; color:var(--muted);
  font:inherit; font-size:12px; font-weight:600; letter-spacing:.02em; padding:6px 12px;
  border-radius:999px; cursor:pointer; }}
.prefs button[aria-pressed="true"] {{ background:var(--acc); color:var(--acc-fg); }}
.wrap {{ max-width:1180px; margin:0 auto; padding:22px 18px 64px; }}
.hero {{ background:var(--sheet); border:1px solid var(--line); border-radius:14px;
  padding:22px 24px; margin-bottom:18px; box-shadow:0 1px 0 rgba(26,35,50,.04); }}
.kicker {{ margin:0 0 6px; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }}
h1 {{ margin:0 0 8px; font-size:24px; letter-spacing:-.02em; }}
.sub {{ color:var(--muted); margin:0 0 14px; }}
.meta-row {{ display:flex; flex-wrap:wrap; gap:10px 18px; font-size:12.5px; color:var(--muted); }}
.meta-row code {{ font-family:var(--mono); font-size:11.5px; background:var(--code-bg); padding:1px 5px; border-radius:4px; color:var(--ink); }}
.stats {{ display:grid; grid-template-columns: 1.2fr 1fr; gap:14px; margin:18px 0 0; }}
@media (max-width:800px) {{ .stats {{ grid-template-columns:1fr; }} }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }}
.card h2 {{ margin:0 0 10px; font-size:13px; color:var(--muted); font-weight:600; letter-spacing:.04em; text-transform:uppercase; }}
.chip-row {{ display:flex; gap:10px; flex-wrap:wrap; }}
.stat-chip {{ min-width:88px; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--chip); }}
.stat-chip .n {{ display:block; font-size:22px; font-weight:700; line-height:1.1; }}
.stat-chip .l {{ font-size:11px; color:var(--muted); letter-spacing:.06em; }}
.stat-chip.web {{ background:var(--web-bg); border-color:var(--web-line); }}
.stat-chip.web .n {{ color:var(--web); }}
.stat-chip.server {{ background:var(--server-bg); border-color:var(--server-line); }}
.stat-chip.server .n {{ color:var(--server); }}
.stat-chip.app {{ background:var(--app-bg); border-color:var(--app-line); }}
.stat-chip.app .n {{ color:var(--app); }}
.bar-row {{ display:grid; grid-template-columns:36px 1fr 36px; gap:8px; align-items:center; margin:6px 0; font-size:12px; }}
.bar {{ height:8px; background:var(--bar-track); border-radius:99px; overflow:hidden; }}
.bar i {{ display:block; height:100%; background:var(--acc); border-radius:99px; }}
.toolbar {{ display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:16px 0;
  background:var(--sheet); border:1px solid var(--line); border-radius:12px; padding:10px 12px; position:sticky; top:52px; z-index:5; }}
.tabs {{ display:flex; gap:6px; flex-wrap:wrap; }}
.tab {{ border:1px solid var(--line); background:var(--chip); color:var(--ink); border-radius:999px;
  padding:6px 14px; cursor:pointer; font:inherit; font-size:13px; }}
.tab[aria-selected="true"] {{ background:var(--acc); border-color:var(--acc); color:var(--acc-fg); }}
.filters {{ display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; align-items:center; }}
.filters input, .filters select {{ border:1px solid var(--line); border-radius:8px; padding:6px 10px; font:inherit; background:var(--chip); color:var(--ink); }}
.filters input {{ min-width:180px; }}
.panel {{ background:var(--sheet); border:1px solid var(--line); border-radius:14px; padding:16px 18px 8px; }}
.panel[hidden] {{ display:none !important; }}
.panel-head h2 {{ margin:0; font-size:18px; }}
.panel-head .count {{ display:inline-block; margin-left:6px; font-size:12px; background:var(--acc-soft); color:var(--acc);
  padding:2px 8px; border-radius:999px; vertical-align:middle; }}
.panel-head .desc {{ color:var(--muted); margin:6px 0 12px; font-size:13px; }}
.case {{ border:1px solid var(--line); border-radius:10px; margin-bottom:10px; overflow:hidden; background:var(--chip); }}
.case[hidden] {{ display:none !important; }}
.case-head {{ display:grid; grid-template-columns:auto auto auto 1fr auto auto; gap:8px; align-items:center;
  padding:10px 12px; cursor:pointer; background:var(--head); }}
@media (max-width:720px) {{
  .case-head {{ grid-template-columns:auto auto 1fr auto; }}
  .case-head .badge.type {{ display:none; }}
}}
.case-head h3 {{ margin:0; font-size:14px; font-weight:600; }}
.meta-id {{ font-family:var(--mono); font-size:11px; color:var(--muted); }}
.chev {{ width:8px; height:8px; border-right:2px solid var(--muted); border-bottom:2px solid var(--muted);
  transform:rotate(45deg); transition:transform .15s; margin-right:4px; }}
.case.open .chev {{ transform:rotate(225deg); }}
.case-body {{ display:none; padding:4px 14px 14px; border-top:1px solid var(--line); }}
.case.open .case-body {{ display:block; }}
.badge {{ display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.04em; padding:2px 7px; border-radius:999px; }}
.badge.client.web {{ background:var(--web-bg); color:var(--web); }}
.badge.client.server {{ background:var(--server-bg); color:var(--server); }}
.badge.client.app {{ background:var(--app-bg); color:var(--app); }}
.badge.pri.p0 {{ background:var(--p0-bg); color:var(--p0); }}
.badge.pri.p1 {{ background:var(--p1-bg); color:var(--p1); }}
.badge.pri.p2 {{ background:var(--p2-bg); color:var(--p2); }}
.badge.pri.p3 {{ background:var(--p3-bg); color:var(--p3); }}
.badge.pri.px {{ background:var(--code-bg); color:var(--muted); }}
.badge.type {{ background:var(--code-bg); color:var(--muted); font-weight:600; }}
.kv {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px 14px; margin:10px 0 12px; }}
.kv dt {{ font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }}
.kv dd {{ margin:2px 0 0; }}
.case-body h4 {{ margin:14px 0 6px; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }}
.block {{ background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }}
.block p {{ margin:0 0 6px; }}
.block p:last-child {{ margin:0; }}
.block p.md-heading {{ margin:10px 0 4px; }}
.block p.md-heading:first-child {{ margin-top:0; }}
.block ul, .block ol {{ margin:4px 0 8px; padding-left:18px; }}
.block li {{ margin:2px 0; }}
.block strong {{ font-weight:700; color:var(--ink); }}
.block code, .steps code {{ font-family:var(--mono); font-size:11.5px; background:var(--code-bg); padding:1px 5px; border-radius:4px; }}
.block a {{ color:var(--acc); }}
.steps {{ width:100%; border-collapse:collapse; font-size:13px; }}
.steps th, .steps td {{ border:1px solid var(--line); padding:8px 9px; vertical-align:top; text-align:left; }}
.steps th {{ background:var(--code-bg); font-size:12px; }}
.steps td.num {{ width:40px; font-family:var(--mono); color:var(--muted); }}
.steps p {{ margin:0 0 4px; }}
.empty {{ padding:28px; text-align:center; color:var(--muted); border:1px dashed var(--line); border-radius:10px; margin-bottom:12px; }}
.muted {{ color:var(--muted); }}
.footer {{ margin-top:18px; color:var(--muted); font-size:12px; text-align:center; }}
.total-pill {{ display:inline-block; background:var(--acc-soft); color:var(--acc); font-weight:700;
  padding:3px 10px; border-radius:999px; margin-left:6px; font-size:13px; }}
html[data-lang="en"] .unit-zh {{ display:none; }}
html[data-lang="zh"] .unit-en {{ display:none; }}
</style>
<script>
(function(){{
  try {{
    var t = localStorage.getItem('tcg-report-theme');
    var l = localStorage.getItem('tcg-report-lang');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    if (l === 'en' || l === 'zh') {{
      document.documentElement.setAttribute('data-lang', l);
      document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    }}
  }} catch (e) {{}}
}})();
</script>
</head>
<body>
<div class="prefs" role="toolbar" aria-label="Language and theme">
  <div class="group" role="group" aria-label="Language">
    <button type="button" data-set-lang="zh" aria-pressed="true">中文</button>
    <button type="button" data-set-lang="en" aria-pressed="false">EN</button>
  </div>
  <div class="group" role="group" aria-label="Theme">
    <button type="button" data-set-theme="light" aria-pressed="true">{_bi('白天', 'Light')}</button>
    <button type="button" data-set-theme="dark" aria-pressed="false">{_bi('黑夜', 'Dark')}</button>
  </div>
</div>
<div class="wrap">
  <header class="hero">
    <p class="kicker">testcase-generation · V56 · case report v{SCRIPT_VERSION}</p>
    <h1>{_bi('测试用例生成报告', 'Test Case Generation Report')}
      <span class="total-pill">{stats['total']} <span class="unit-zh">条</span><span class="unit-en"> cases</span></span>
    </h1>
    <p class="sub">{_esc(project_name)} · {_bi('聚合 Web / 服务端 / APP 三类用例集', 'Aggregates Web / Server / APP case sets')}</p>
    <div class="meta-row">
      <span>Run ID: <code>{_esc(runid or run_dir.name)}</code></span>
      <span>{_bi('运行目录', 'Run dir')}: <code>{_esc(str(run_dir))}</code></span>
      <span>{_bi('正式方案', 'Formal plan')}: {plan_note}</span>
      <span>{_bi('生成时间', 'Generated at')}: {_esc(generated)}</span>
      <span>{_bi('数据源', 'Source')}: <code>testcase/cases/</code></span>
    </div>
    <div class="stats">
      <div class="card">
        <h2>{_bi('按端分布', 'By client')}</h2>
        <div class="chip-row">{client_chips}</div>
      </div>
      <div class="card">
        <h2>{_bi('优先级分布', 'By priority')}</h2>
        {pri_bars or f"<p class='muted'>{_bi('暂无', 'None')}</p>"}
      </div>
    </div>
  </header>

  <div class="toolbar">
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="all" aria-selected="true">{_bi('全部', 'All')}</button>
      <button class="tab" role="tab" data-tab="web" aria-selected="false">Web ({stats['by_client']['web']})</button>
      <button class="tab" role="tab" data-tab="server" aria-selected="false">{_bi('服务端', 'Server')} ({stats['by_client']['server']})</button>
      <button class="tab" role="tab" data-tab="app" aria-selected="false">APP ({stats['by_client']['app']})</button>
    </div>
    <div class="filters">
      <select id="priFilter" aria-label="Priority">
        <option value="" data-zh="全部优先级" data-en="All priorities">全部优先级</option>
        <option>P0</option><option>P1</option><option>P2</option><option>P3</option>
      </select>
      <input id="q" type="search" data-zh-placeholder="搜索 ID / 名称 / 模块 / 步骤…" data-en-placeholder="Search ID / name / module / steps…" placeholder="搜索 ID / 名称 / 模块 / 步骤…" aria-label="Search"/>
      <button class="tab" type="button" id="expandAll">{_bi('展开全部', 'Expand all')}</button>
      <button class="tab" type="button" id="collapseAll">{_bi('收起全部', 'Collapse all')}</button>
    </div>
  </div>

  <section class="panel" id="panel-all" data-panel="all">
    <div class="panel-head">
      <h2>{_bi('全部用例', 'All cases')} <span class="count">{stats['total']}</span></h2>
      <p class="desc">{_bi('三端用例聚合视图；点击卡片展开步骤与预期。空端在本运行中显示为空态。', 'Aggregated three-end view; expand a card for steps and expected results. Missing ends show an empty state.')}</p>
    </div>
    <div class="case-list">
      {"".join(case_card(r, i) for i, r in enumerate(records)) or empty_all}
    </div>
  </section>

  {section("web", "Web 端用例集", "Web case set", "来源：testcase_web/testcase_web_index.md + testcases/*.md", "Source: testcase_web/testcase_web_index.md + testcases/*.md")}
  {section("server", "服务端用例集", "Server case set", "来源：testcase_srv.md（大表）", "Source: testcase_srv.md (wide table)")}
  {section("app", "APP 端用例集", "APP case set", "来源：testcase_app/testcase_app_index.md + testcases/*.md", "Source: testcase_app/testcase_app_index.md + testcases/*.md")}

  <p class="footer">{_bi('由 testcase-generation/scripts/generate_case_report.py 生成 · 仅本地 HTML，不上传用例平台', 'Generated by testcase-generation/scripts/generate_case_report.py · local HTML only, no case-platform upload')}</p>
</div>
<script>
(function(){{
  const root = document.documentElement;
  const LANG_KEY = 'tcg-report-lang';
  const THEME_KEY = 'tcg-report-theme';

  function applyI18n(lang) {{
    const attr = lang === 'en' ? 'data-en' : 'data-zh';
    document.querySelectorAll('[data-zh][data-en]').forEach(el => {{
      const v = el.getAttribute(attr);
      if (v == null) return;
      if (el.tagName === 'TITLE') {{ document.title = v; }}
      else if (el.tagName === 'OPTION') {{ el.textContent = v; }}
      else {{ el.textContent = v; }}
    }});
    document.querySelectorAll('[data-zh-placeholder][data-en-placeholder]').forEach(el => {{
      el.setAttribute('placeholder', el.getAttribute(lang === 'en' ? 'data-en-placeholder' : 'data-zh-placeholder') || '');
    }});
  }}

  function setLang(lang) {{
    root.setAttribute('data-lang', lang);
    root.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-set-lang]').forEach(b => {{
      b.setAttribute('aria-pressed', b.getAttribute('data-set-lang') === lang ? 'true' : 'false');
    }});
    applyI18n(lang);
    try {{ localStorage.setItem(LANG_KEY, lang); }} catch (e) {{}}
  }}

  function setTheme(theme) {{
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-set-theme]').forEach(b => {{
      b.setAttribute('aria-pressed', b.getAttribute('data-set-theme') === theme ? 'true' : 'false');
    }});
    try {{ localStorage.setItem(THEME_KEY, theme); }} catch (e) {{}}
  }}

  document.querySelectorAll('[data-set-lang]').forEach(b => {{
    b.addEventListener('click', () => setLang(b.getAttribute('data-set-lang')));
  }});
  document.querySelectorAll('[data-set-theme]').forEach(b => {{
    b.addEventListener('click', () => setTheme(b.getAttribute('data-set-theme')));
  }});

  let lang = root.getAttribute('data-lang') || 'zh';
  let theme = root.getAttribute('data-theme') || 'light';
  try {{
    lang = localStorage.getItem(LANG_KEY) || lang;
    theme = localStorage.getItem(THEME_KEY) || theme;
  }} catch (e) {{}}
  setLang(lang === 'en' ? 'en' : 'zh');
  setTheme(theme === 'dark' ? 'dark' : 'light');

  const tabs = document.querySelectorAll('.tab[data-tab]');
  const panels = document.querySelectorAll('[data-panel]');
  const priFilter = document.getElementById('priFilter');
  const q = document.getElementById('q');

  function showPanel(name) {{
    tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false'));
    panels.forEach(p => {{ p.hidden = p.dataset.panel !== name; }});
    applyFilters();
  }}
  tabs.forEach(t => t.addEventListener('click', () => showPanel(t.dataset.tab)));

  function applyFilters() {{
    const pri = (priFilter.value || '').toUpperCase();
    const query = (q.value || '').trim().toLowerCase();
    document.querySelectorAll('.case').forEach(card => {{
      const inPanel = !card.closest('[data-panel]')?.hidden;
      if (!inPanel) return;
      const okPri = !pri || (card.dataset.pri || '').toUpperCase() === pri;
      const okQ = !query || (card.dataset.search || '').includes(query);
      card.hidden = !(okPri && okQ);
    }});
  }}
  priFilter.addEventListener('change', applyFilters);
  q.addEventListener('input', applyFilters);
  document.getElementById('expandAll').addEventListener('click', () => {{
    document.querySelectorAll('.panel:not([hidden]) .case:not([hidden])').forEach(c => c.classList.add('open'));
  }});
  document.getElementById('collapseAll').addEventListener('click', () => {{
    document.querySelectorAll('.case').forEach(c => c.classList.remove('open'));
  }});
}})();
</script>
</body>
</html>
"""


def default_out_path(run_dir: Path) -> Path:
    return run_dir / "testdesign" / "testcase_generation_report.html"


def generate(run_dir: Path, out: Optional[Path] = None) -> Dict:
    run_dir = run_dir.resolve()
    if not run_dir.is_dir():
        return {"ok": False, "error": "RUN_DIR_MISSING", "msg": "run_dir does not exist: %s" % run_dir}
    records, meta = load_cases(run_dir)
    out_path = (out or default_out_path(run_dir)).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    html_text = render_html(records, run_dir, meta)
    out_path.write_text(html_text, encoding="utf-8")
    stats = _stats(records)
    return {
        "ok": True,
        "out": str(out_path),
        "total": stats["total"],
        "byClient": stats["by_client"],
        "byPriority": stats["by_pri"],
        "runDir": str(run_dir),
        "version": SCRIPT_VERSION,
    }


def self_check() -> int:
    """Tiny fixture check: write temp cases and ensure report contains them."""
    import tempfile
    import shutil

    tmp = Path(tempfile.mkdtemp(prefix="tcg-report-"))
    try:
        cases = tmp / "testcase" / "cases"
        web_tc = cases / "testcase_web" / "testcases"
        web_tc.mkdir(parents=True)
        (cases / "testcase_web" / "testcase_web_index.md").write_text(
            "## Case index\n\n"
            "| Case ID | Remark | Case name | Functional module | Priority | Case type | Preconditions | Generated at | Updated at | File path |\n"
            "|---|---|---|---|---|---|---|---|---|---|\n"
            "| rid-1 |  | Web case A | ModA | P0 | [New][UI] | pre | t | t | testcases/rid-1-a.md |\n",
            encoding="utf-8",
        )
        (web_tc / "rid-1-a.md").write_text(
            "# Web case A\n\n"
            "> Case ID: rid-1\n"
            "> Functional module: ModA\n"
            "> Case type: [New][UI]\n"
            "> Generated at: 2026-01-01 00:00:00\n"
            "> Updated at: 2026-01-01 00:00:00\n"
            "> Plan scenario: S-01\n\n"
            "## Preconditions\n\n"
            "**Execution-environment description**\n"
            "- environment ID: TBD\n"
            "- path: `testdesign/test_design.md`\n\n"
            "**Data-dependency description**\n"
            "1）Site build ready\n\n"
            "## Operation steps and Expected results (put steps and Expected results in one table, left-right corresponding)\n\n"
            "| # | Step | Expected results |\n|---|------|---------|\n"
            "| 1 | do **x** | see `y` |\n\n"
            "## UI image\n\n---\n\n## Ambiguity clarification\n\n—\n\n## Provenance\n\n- plan\n",
            encoding="utf-8",
        )
        (cases / "testcase_srv.md").write_text(
            "# Server cases\n\n## Case details\n\n"
            "| Case ID | Functional module | Case name | Preconditions | Operation steps | Expected results | Priority | Case type | Provenance |\n"
            "|---|---|---|---|---|---|---|---|---|\n"
            "| rid-s1 | ApiMod | [Function-Positive] srv | env | call API | code=0 | P1 | [New][Function-Positive] | spec |\n",
            encoding="utf-8",
        )
        app_tc = cases / "testcase_app" / "testcases"
        app_tc.mkdir(parents=True)
        (cases / "testcase_app" / "testcase_app_index.md").write_text(
            "## Case index\n\n"
            "| Case ID | Remark | Case name | Functional module | Priority | Case type | Preconditions | Generated at | Updated at | File path |\n"
            "|---|---|---|---|---|---|---|---|---|---|\n"
            "| rid-a1 |  | App case B | ModB | P2 | [New][Interaction] | pre | t | t | testcases/rid-a1-b.md |\n",
            encoding="utf-8",
        )
        (app_tc / "rid-a1-b.md").write_text(
            "# App case B\n\n"
            "> Case ID: rid-a1\n"
            "> Functional module: ModB\n"
            "> Case type: [New][Interaction]\n\n"
            "## Preconditions\n\napp pre\n\n"
            "## Operation steps and Expected results (x)\n\n"
            "| # | Step | Expected results |\n|---|------|---------|\n"
            "| 1 | tap | opens |\n\n"
            "## Provenance\n\n- app\n",
            encoding="utf-8",
        )
        (tmp / "testdesign").mkdir(parents=True)
        result = generate(tmp)
        if not result.get("ok"):
            print("self-check failed: generate not ok", result, file=sys.stderr)
            return 1
        text = Path(result["out"]).read_text(encoding="utf-8")
        need = [
            "Web case A",
            "App case B",
            "srv",
            "rid-1",
            "rid-s1",
            "rid-a1",
            'data-tab="web"',
            'data-theme="light"',
            'data-lang="zh"',
            'data-set-lang="en"',
            'data-set-theme="dark"',
            'data-en="Test Case Generation Report"',
            "tcg-report-lang",
            "tcg-report-theme",
            "<strong>Execution-environment description</strong>",
            "<code>testdesign/test_design.md</code>",
            "<strong>x</strong>",
            "<code>y</code>",
        ]
        missing = [n for n in need if n not in text]
        # Raw Markdown markers must not appear inside rendered block/table cells
        leak = []
        if re.search(r"<(?:p|li)[^>]*>\s*\*\*", text):
            leak.append("raw ** at start of p/li")
        if re.search(r"<(?:p|li)[^>]*>[^<]*`[a-zA-Z]", text):
            leak.append("raw backtick code in p/li")
        if missing or leak or result["total"] != 3:
            print(
                "self-check failed: missing=%s leak=%s total=%s" % (missing, leak, result["total"]),
                file=sys.stderr,
            )
            return 1
        print(json.dumps({"ok": True, "selfCheck": "passed", "total": result["total"]}, ensure_ascii=False))
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate aggregated HTML case report")
    parser.add_argument("--run-dir", help="Skill run directory")
    parser.add_argument("--out", help="Optional output HTML path")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.run_dir:
        parser.error("--run-dir is required unless --self-check")
    result = generate(Path(args.run_dir), Path(args.out) if args.out else None)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
