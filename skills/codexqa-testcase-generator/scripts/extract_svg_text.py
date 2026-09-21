#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_svg_text.py — drawio SVG → structured text extractor

Purpose
=======
Companion script for codexqa-testcase-generator stage 0 (input processing) multimedia handling.
Local SVG / `.drawio` flowcharts are reduced to structured text of
"nodes + edges + branch conditions" so stage 0 can insert them into the cleaned
document (marked "📊 Flowchart summary"), closing the gap where image placeholders
drop flowchart business logic.
Does not access the network and does not depend on a document platform.

Design notes
============
1. Data-source priority (three-level fallback; all deterministic parsing, no LLM, no network):
   - Preferred: mxfile embedded in the SVG root `content` attribute (original drawio graph data) —
     includes full node/edge/style/geometry information and is the most structured;
     content may be URL-encoded + base64 + raw deflate (mxGraphModel) and must be decoded layer by layer;
     uncompressed plaintext mxGraphModel/mxfile XML is also supported.
   - Fallback: `<foreignObject>`/`<text>` nodes in the SVG body — extract visible text as nodes,
     without edge ownership (degraded output: text inventory only).
   - Last resort: regex-extract bare text inside tags — guarantees "something is always returned";
     exit code remains 0 (empty/decorative diagrams emit a hint line and are not failures).
2. mxfile parse products:
   - Nodes (vertex): extract mxCell@value text; classify shape from style:
     rhombus → decision node (branch condition); ellipse → start/end node;
     others (rounded=1/rect, etc.) → process step;
     shaped nodes with empty text are marked "(no text)".
   - Edges (edge): source/target vertex ids → names; mxCell@value is the edge label
     (yes/no/null and other branch conditions); edges without source/target are marked (dangling edge).
   - Output follows mxGraphModel document order (mxCell declaration order), i.e. author draw order,
     which matches on-diagram reading order.
3. Value text is uniformly HTML-unescaped and tag-stripped (value often contains <div>/<br>, etc.);
     whitespace collapses to a single space; newline \n is kept (authors use it to lay out)
     multi-line node text; it is part of the business meaning).
4. Exit codes: 0 = parse succeeded (including degraded success and empty-diagram hints);
     2 = file missing / not a valid SVG / no text at all.
5. Pure Python stdlib (re / base64 / zlib / html / xml.etree / urllib.parse).

Usage
=====
    scripts/tcg-python scripts/extract_svg_text.py <drawio.svg> [more.svg ...]          # stdout is JSON; extracted text is in msg
    scripts/tcg-python scripts/extract_svg_text.py <drawio.svg> --output <out.txt>      # write text to file; stdout is still JSON
    scripts/tcg-python scripts/extract_svg_text.py dir/ --output-dir out_dir/           # batch a directory (*.svg only)

Output format (example)
=====
    [Node1] Single bind PushOrderChannelBindingService.bind(...) (process step)
    [Node2] currentChannel? (decision)
    [Edge] Node1 → Node2 (label: yes)
"""

from py_version import require_py310

require_py310()

import argparse
import base64
import html as html_mod
import json
import os
import re
import sys
import zlib
import xml.etree.ElementTree as ET
from urllib.parse import unquote


def emit_json(payload):
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


# ---------------------------------------------------------------- helpers

def strip_tags(text):
    """Strip HTML tags, unescape entities, and collapse whitespace (keep explicit newlines)."""
    if not text:
        return ""
    # Normalize <br>/<br/> to newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
    # Treat block-level close tags as newlines (div/p/li, etc.)
    text = re.sub(r'</(div|p|li|tr|h[1-6])>', '\n', text, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    text = html_mod.unescape(text)
    # Collapse in-line whitespace; keep newlines
    lines = [re.sub(r'\s+', ' ', ln).strip() for ln in text.split('\n')]
    lines = [ln for ln in lines if ln]
    return '\n'.join(lines)


def classify_shape(style):
    """Classify shape category from the mxCell style prefix."""
    if not style:
        return "process step"
    head = style.split(';')[0].strip().lower()
    if 'rhombus' in head:
        return "decision"
    if 'ellipse' in head or head == 'ellipse':
        return "start/end"
    if 'doubleEllipse' in head or head == 'doubleellipse':
        return "start/end"
    return "process step"


# ---------------------------------------------------------------- mxfile parse (preferred path)

MXFILE_RE = re.compile(r'content="([^"]*)"', re.S)


def decode_diagram_container(xml_text):
    """Recover mxGraphModel XML from an mxfile / diagram container. Return None on failure."""
    if not xml_text:
        return None
    dm = re.search(r'<diagram[^>]*>(.*?)</diagram>', xml_text, re.S)
    if dm:
        inner = dm.group(1).strip()
        if inner.startswith('<'):
            return inner
        try:
            raw = base64.b64decode(inner)
            dec = zlib.decompress(raw, -15)
            return unquote(dec.decode('utf-8', 'replace'))
        except Exception:
            return None
    mm = re.search(r'<mxGraphModel[\s>]', xml_text)
    if mm:
        return xml_text[xml_text.find('<mxGraphModel'):]
    return None


def extract_mxgraphmodel(svg_text):
    """Recover mxGraphModel from the SVG content attribute or local .drawio XML. Return None on failure."""
    m = MXFILE_RE.search(svg_text)
    if m:
        decoded = decode_diagram_container(html_mod.unescape(m.group(1)))
        if decoded:
            return decoded
    if '<mxfile' in svg_text or '<mxGraphModel' in svg_text:
        return decode_diagram_container(svg_text)
    return None


def parse_mxgraphmodel(mx_xml):
    """Parse mxGraphModel XML → (nodes, edges). nodes: [(idx, text, shape)], edges: [(src, dst, label, dangling)]"""
    try:
        root = ET.fromstring(mx_xml)
    except ET.ParseError:
        # Truncation tolerance: keep up to the last well-formed close tag
        cut = mx_xml.rfind('>')
        if cut <= 0:
            return None
        try:
            root = ET.fromstring(mx_xml[:cut + 1])
        except ET.ParseError:
            return None
    cells = root.iter('mxCell')
    vertices = {}   # id -> (index, text, shape)
    edges = []      # (src_id, dst_id, label, has_src, has_dst)
    for c in cells:
        if c.get('vertex') == '1':
            vid = c.get('id') or ''
            val = strip_tags(c.get('value') or '')
            shape = classify_shape(c.get('style') or '')
            vertices[vid] = (len(vertices) + 1, val or '(no text)', shape)
        elif c.get('edge') == '1':
            val = strip_tags(c.get('value') or '')
            s, t = c.get('source'), c.get('target')
            edges.append((s, t, val, s is not None, t is not None))
    return vertices, edges


def render_mx(vertices, edges):
    """Render mxfile parse results as structured text."""
    lines = []
    def vname(vid):
        if vid in vertices:
            i, txt, _ = vertices[vid]
            first = txt.split('\n')[0]
            return "Node%d:%s" % (i, first)
        return None

    # Node inventory (mxCell declaration order; dict insertion order is declaration order; i is the index)
    ordered = sorted(vertices.items(), key=lambda kv: kv[1][0])
    for vid, (i, txt, shape) in ordered:
        lines.append("[Node%d] %s (%s)" % (i, txt, shape))
    # Edge inventory
    if edges:
        lines.append("")
        for (s, t, val, has_s, has_t) in edges:
            src = vname(s) if has_s else None
            dst = vname(t) if has_t else None
            if src and dst:
                seg = "[Edge] %s → %s" % (src, dst)
            elif src:
                seg = "[Edge] %s → (unspecified target)" % src
            elif dst:
                seg = "[Edge] (unspecified source) → %s" % dst
            else:
                seg = "[Edge] (dangling edge)"
            if val:
                seg += " (label: %s)" % val
            lines.append(seg)
    return "\n".join(lines)


# ---------------------------------------------------------------- SVG body parse (fallback path)

SVG_TEXT_RE = re.compile(r'<(?:foreignObject|text)\b[^>]*>(.*?)</(?:foreignObject|text)>', re.S)


def parse_svg_body(svg_text):
    """Extract visible text from SVG body <foreignObject>/<text> (degraded path; no edge ownership)."""
    chunks = []
    for m in SVG_TEXT_RE.finditer(svg_text):
        val = strip_tags(m.group(1))
        if val:
            chunks.append(val)
    return chunks


# ---------------------------------------------------------------- main flow

def convert_one(svg_path):
    """Convert one SVG / .drawio → (structured text, parse level). Level: mxfile/svg-body/none"""
    with open(svg_path, encoding='utf-8', errors='replace') as f:
        svg_text = f.read()
    lower = svg_path.lower()
    is_svg = '<svg' in svg_text
    is_drawio = (
        lower.endswith('.drawio')
        or lower.endswith('.dio')
        or '<mxfile' in svg_text
        or '<mxGraphModel' in svg_text
    )
    if not is_svg and not is_drawio:
        raise ValueError("not an SVG or drawio file")

    # Preferred path: embedded mxfile
    mx = extract_mxgraphmodel(svg_text)
    if mx:
        parsed = parse_mxgraphmodel(mx)
        if parsed:
            vertices, edges = parsed
            if vertices or edges:
                return render_mx(vertices, edges), "mxfile"

    # Fallback path: SVG body text nodes
    chunks = parse_svg_body(svg_text)
    if chunks:
        lines = []
        for i, c in enumerate(chunks, 1):
            lines.append("[Node%d] %s" % (i, c))
        lines.append("")
        lines.append("(note: this diagram has no embedded drawio data; the above is SVG text-node extraction with no edge ownership)")
        return "\n".join(lines), "svg-body"

    # Last resort: no text
    return "(no text extracted: graphic-only or empty diagram)", "none"


def main():
    ap = argparse.ArgumentParser(
        description="Local SVG / .drawio → structured text (nodes + edges + branch conditions); deterministic parse only")
    ap.add_argument('inputs', nargs='+', help="SVG file path, or a directory (batch-process *.svg)")
    ap.add_argument('--output', '-o', help="Single-file mode: write the result to this file (default stdout)")
    ap.add_argument('--output-dir', '-d', help="Directory mode: write xxx.svg.txt for each xxx.svg")
    args = ap.parse_args()

    if len(args.inputs) == 1 and os.path.isdir(args.inputs[0]):
        src_dir = args.inputs[0]
        out_dir = args.output_dir or src_dir
        os.makedirs(out_dir, exist_ok=True)
        svgs = sorted(
            fn for fn in os.listdir(src_dir)
            if fn.lower().endswith(('.svg', '.drawio', '.dio'))
        )
        if not svgs:
            emit_json({
                "ok": False,
                "error": "NO_SVG_FILES",
                "msg": "No .svg / .drawio files in directory: %s" % src_dir,
            })
            return 2
        ok = 0
        lines = []
        files = []
        for fn in svgs:
            try:
                text, level = convert_one(os.path.join(src_dir, fn))
            except (OSError, ValueError) as e:
                lines.append("[FAIL] %s: %s" % (fn, e))
                continue
            out_path = os.path.join(out_dir, fn + '.txt')
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(text + "\n")
            lines.append("[OK] %s -> %s (%s)" % (fn, out_path, level))
            files.append({"file": fn, "outputPath": out_path, "level": level})
            ok += 1
        lines.append("Done: %d/%d succeeded" % (ok, len(svgs)))
        emit_json({
            "ok": ok == len(svgs),
            "files": files,
            "msg": "\n".join(lines),
        })
        return 0 if ok == len(svgs) else 2

    # Single / multi-file mode
    results = []
    failed = False
    errors = []
    for path in args.inputs:
        if not os.path.isfile(path):
            errors.append("File not found: %s" % path)
            failed = True
            continue
        try:
            text, level = convert_one(path)
        except (OSError, ValueError) as e:
            errors.append("Parse failed %s: %s" % (path, e))
            failed = True
            continue
        header = "===== %s =====" % os.path.basename(path) if len(args.inputs) > 1 else ""
        results.append((header, text, level))

    out = "\n\n".join(("\n".join([h, t]) if h else t) for h, t, _ in results)
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(out + "\n")
    ok = not (failed or not results)
    emit_json({
        "ok": ok,
        "outputPath": args.output or "",
        "level": results[0][2] if len(results) == 1 else "",
        "errors": errors,
        "msg": out if out else "\n".join(errors) or "No content extracted",
    })
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
