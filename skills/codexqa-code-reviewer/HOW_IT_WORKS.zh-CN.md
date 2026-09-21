# AI Code Reviewer 工作原理

[English](HOW_IT_WORKS.md)

[`codexqa-code-reviewer`](README.zh-CN.md) 是宿主 agent 的脚手架：本地仓库（PR/diff、全仓或 adhoc 文件）进去；CodexQA 证据包与双语 `REVIEW-REPORT.html` 出来。本 skill 不内嵌模型，也不 vendoring CodexQA 源码。收集脚本只调用 `codexqa` 二进制；宿主 agent 依据包内产物评估启发式维度，再跑第 16 维 Agent LLM judgment，并用 `merge-llm-findings.py` 做确定性去重。

运行时契约见 [`SKILL.md`](SKILL.md)。

## 数据流

```text
repo + diff-base  |  全仓  |  adhoc 文件
        │
        ▼
   collect-*-evidence.sh  （+ derive-* 维度信号）
        │
        ▼
   .codexqa-review/<run-id>/   （manifest + JSON 包）
        │
        ├─ validate-evidence.sh
        ├─ 宿主 agent 读 prompts/ + 包产物（启发式维度）
        ├─ 宿主内嵌模型语义评审 + merge-llm-findings.py（去重合并）
        └─ 写出 review-conclusion.json
                │
                ▼
        render-review-html.sh → REVIEW-REPORT.html
```

1. **Preflight** — `PATH` 上有 `codexqa` 与 `jq`；PR 模式还需要 `REPO` + `--diff-base`。
2. **Collect** — index / change-groups / symbol-diff / impact / tags / sensitive / hot-but-thin / language profile，再跑本地 `derive-*` 信号文件。
3. **Validate** — 无 CodexQA 来源或无可审变更时失败；旧版包可 WARN 后仍通过。
4. **Review** — agent 遵循 `prompts/pr-diff-review.md` 或 `prompts/full-repo-review.md`；只引用产物字段。
5. **Agent LLM judgment** — 启发式草稿之后，按 `prompts/llm-judgment-pass.md` 跑宿主内嵌模型，并用 `scripts/lib/merge-llm-findings.py` 去重合并（`22-llm-judgment.json`）。
6. **Deliver** — 必需 `review-conclusion.json` + `REVIEW-REPORT.html`（双语 `*_en` 字段）。

## Bash 与模型的分工

| 层 | 负责 |
|---|---|
| Bash 收集 / 校验 / HTML 渲染 | 工具状态、包结构、维度信号派生、HTML 过滤 |
| 宿主 agent | 在 `prompts/` + `references/` 下写发现 / 维度卡 / 双语叙事 |
| 宿主 agent + `merge-llm-findings.py` | 第 16 维语义评审候选 + 相对启发式发现的确定性去重 |
| CodexQA CLI | 符号图、调用方、可达性、测试边 |

## 与其他代码类 skill 的关系

| Skill | 差异 |
|---|---|
| [`codexqa-code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-code-analyzer/README.zh-CN.md) | 符号图问答 / 影响面 — 不是完整评审报告流水线 |
| [`codexqa-defect-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-defect-analyzer/README.zh-CN.md) | SAST + Agent LLM Detection → `report_scan.*`（去重合并） |
| [`codexqa-rootcause-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/codexqa-rootcause-analyzer/README.zh-CN.md) | 在 CLI facts 之上做异常 RCA |

## 证据状态

本地 `bash scripts/validate-skill.sh` 覆盖静态树、fixture 校验/渲染冒烟与 plan-coverage 审计。本仓库 CI 不要求现场 CodexQA 建索引。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。
