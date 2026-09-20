# testcase-generation 工作原理

[English](HOW_IT_WORKS.md)

[`testcase-generation`](README.zh-CN.md) 把本地需求变成正式测试方案和/或 Markdown 用例。宿主 agent 按分阶段 references 执行；Python 脚本负责关门与关阶段。不连接用例平台或文档平台。

运行时契约见 [`SKILL.md`](SKILL.md)。说法与产物位置见 [`user-guide.md`](user-guide.md)。

## 数据流

```text
本地文件 / 粘贴 / HTTPS 文档 URL（+ 可选知识目录或 Git URL）
        │
        ▼
   入口路由（Plan | Exec | 提测前改用例 | Incremental）
        │
        ├─ Plan 0→5  →  testdocs 报告 + testdesign/test_design.md
        │                （check_run_gate stage5 + close_stage）
        ├─ Exec 6    →  testcase/initialcase/ 与 cases/ 双写
        │                （allow-exec → check_run_gate stage6 + close_stage）
        └─ Incremental → .case-enhance/ 过程区 + 更新后的 cases/
                          （可选把 PR/git 拉到 .pr-cache/）
```

1. **路由** — 只看用户原话（`references/entry-routing.md`）。不清楚就先问；不要臆造「只要用例」。
2. **工作区** — `close_stage.py --init`，再从 `run-status.json` 的 `currentStage` 续跑。
3. **Plan** — 阶段 0–4-1 产出报告；阶段 5 仅在 gate `stage5` 的 stdout `ok: true` 后写 `test_design.md`。
4. **Exec** — 仅在后续用户确认并 `--allow-exec` 之后双写用例；再过 gate `stage6`。
5. **Incremental** — 在既有基线上的并列作用域；用户给出 PR/git URL 时可拉代码。

## 脚本与模型各自负责什么

| 层 | 负责 |
|---|---|
| `close_stage.py` / `check_run_gate.py` / ingest 与 incremental 脚本 | 运行状态、阶段门禁、文档摄入、PR 拉取、冻结辅助 |
| 宿主 agent | 路由、分析正文、方案章节、`references/` 下的用例正文 |
| 内置模板（`case-tpl-*.md`、方案模板） | 三端用例形态与方案 Minimum persist 标题 |

## 与其它 skill 的关系

| Skill | 区别 |
|---|---|
| [`requirements-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/requirements-analyzer/README.zh-CN.md) | 需求质量 / 缺口登记 — 不写用例库 |
| [`testdata-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testdata-generation/README.zh-CN.md) | 真实后端 ID 与前置回写 — 不写方案/用例 |
| [`defect-detection`](https://github.com/openqa-cn/codexqa/blob/main/skills/defect-detection/README.zh-CN.md) / [`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.zh-CN.md) | 代码风险扫描或图证据评审 — 不是测试设计 |

## 证据状态

`scripts/tcg-python scripts/close_stage.py --self-check` 与 `check_run_gate.py --self-check` 覆盖离线门禁夹具。完整 Plan→Exec 没有公开宿主 agent 成绩。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。
