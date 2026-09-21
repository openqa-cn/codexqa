#!/usr/bin/env python3
"""
Interactive / agent-facing scenario chooser for codexqa-defect-analyzer.

Scenarios:
  1) repo-incremental   — git repo MR/diff review
  2) repo-full          — whole-repo baseline
  3) upload-incremental — uploaded files as "changes" (vs empty baseline)
  4) upload-full        — uploaded tree as full baseline of a mini-repo
  5) paste              — single pasted snippet (defaults to incremental)

Usage:
  python3 scripts/choose_scenario.py                  # TTY menu
  python3 scripts/choose_scenario.py --list           # print options JSON
  python3 scripts/choose_scenario.py --scenario paste # resolve + print next cmd
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: F401 — require Python 3.10+ (re-exec if needed)

SCENARIOS = [
    {
        'id': 'repo-incremental',
        'label': '仓库增量检测（MR/PR/diff）',
        'when': '用户有 git 仓库，要审查本次改动',
        'mode': 'incremental',
        'source': 'repo',
        'cmd': 'python3 scripts/run_scan.py incremental --repo <repo> --intent "<desc>"',
    },
    {
        'id': 'repo-full',
        'label': '仓库全量检测（基线/发版前）',
        'when': '用户要对整个仓库做基线扫描',
        'mode': 'full',
        'source': 'repo',
        'cmd': 'python3 scripts/run_scan.py full --repo <repo>',
    },
    {
        'id': 'upload-incremental',
        'label': '上传文件 — 增量检测',
        'when': '用户上传了若干变更文件/补丁，当作增量缺陷检测',
        'mode': 'incremental',
        'source': 'adhoc',
        'cmd': ('python3 scripts/run_scan.py adhoc --scan-mode incremental '
                '--files <f1> <f2> --intent "<desc>"'),
    },
    {
        'id': 'upload-full',
        'label': '上传目录/多文件 — 全量检测',
        'when': '用户上传了一个小工程目录或一组完整文件，当作迷你仓库全量扫',
        'mode': 'full',
        'source': 'adhoc',
        'cmd': ('python3 scripts/run_scan.py adhoc --scan-mode full '
                '--from-dir <dir> --intent "<desc>"'),
    },
    {
        'id': 'paste',
        'label': '粘贴/录入代码片段',
        'when': '用户在对话里粘贴了一段代码，或人工录入',
        'mode': 'incremental',
        'source': 'adhoc',
        'cmd': ('python3 scripts/run_scan.py adhoc --scan-mode incremental '
                '--paste-file <path> --lang python --intent "pasted snippet"'),
    },
]


def resolve(scenario_id):
    for s in SCENARIOS:
        if s['id'] == scenario_id:
            return s
    return None


def prompt_tty():
    print('请选择缺陷检测场景：\n', file=sys.stderr)
    for i, s in enumerate(SCENARIOS, 1):
        print('  %d) %s' % (i, s['label']), file=sys.stderr)
        print('      适用: %s' % s['when'], file=sys.stderr)
    print('', file=sys.stderr)
    while True:
        try:
            raw = input('输入序号 [1-%d]（默认 1）: ' % len(SCENARIOS)).strip()
        except EOFError:
            raw = '1'
        if not raw:
            raw = '1'
        if raw.isdigit() and 1 <= int(raw) <= len(SCENARIOS):
            return SCENARIOS[int(raw) - 1]
        print('无效输入，请重试。', file=sys.stderr)


def infer_from_text(text):
    """Heuristic for agent when user message already implies a scenario."""
    t = (text or '').lower()
    if any(k in t for k in ('粘贴', 'paste', '这段代码', '如下代码', '录入')):
        return resolve('paste')
    if any(k in t for k in ('上传', 'upload', '附件', '这几个文件')):
        if any(k in t for k in ('全量', '整个', '目录', '项目')):
            return resolve('upload-full')
        return resolve('upload-incremental')
    if any(k in t for k in (
            '全量', '基线', '整仓', '完整', '全面', '整库', '全仓', '整个仓库', '整个工程',
            'baseline', 'full scan', 'full-scan', 'whole repo', 'entire repo')):
        return resolve('repo-full')
    if any(k in t for k in ('增量', 'mr', 'pr', 'diff', '这次改动', 'review')):
        return resolve('repo-incremental')
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--scenario', default=None,
                    choices=[s['id'] for s in SCENARIOS])
    ap.add_argument('--infer', default=None, help='infer scenario from user utterance')
    ap.add_argument('--ask', action='store_true', help='force TTY menu')
    args = ap.parse_args()

    if args.list:
        print(json.dumps({'scenarios': SCENARIOS}, ensure_ascii=False, indent=2))
        return

    chosen = None
    if args.scenario:
        chosen = resolve(args.scenario)
    elif args.infer:
        chosen = infer_from_text(args.infer)
        if not chosen:
            print(json.dumps({
                'need_user_choice': True,
                'message': '无法从描述推断场景，请让用户选择：',
                'scenarios': [{'id': s['id'], 'label': s['label']} for s in SCENARIOS],
            }, ensure_ascii=False, indent=2))
            sys.exit(2)
    elif args.ask or sys.stdin.isatty():
        chosen = prompt_tty()
    else:
        print(json.dumps({
            'need_user_choice': True,
            'message': '请选择检测场景（把 id 回传 --scenario）',
            'scenarios': [{'id': s['id'], 'label': s['label'], 'when': s['when']}
                          for s in SCENARIOS],
        }, ensure_ascii=False, indent=2))
        sys.exit(2)

    out = {
        'chosen': chosen['id'],
        'label': chosen['label'],
        'mode': chosen['mode'],
        'source': chosen['source'],
        'next_command_template': chosen['cmd'],
        'agent_hint': (
            '若 source=adhoc：先保存用户上传/粘贴内容到本地，再跑 run_scan.py adhoc；'
            '若 source=repo：直接对 --repo 跑 incremental/full。'
        ),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
