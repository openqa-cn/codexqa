# 缺陷检测的工作原理

[English](HOW_IT_WORKS.md)

[`defect-detection`](README.zh-CN.md) 给宿主 agent 搭流程：diff / 仓库 / 上传 / 粘贴进去，P0–P3 的 `report_scan.*` 出来。确定性采集与适配器产出证据；宿主 agent 填写 Stage1/Stage2 判断 JSON；Python 合并并写出最终报告。代码图上下文只来自 CodexQA CLI 二进制。

运行时契约见 [`SKILL.md`](SKILL.md)。

## 数据流

```text
diff / 仓库 / 上传 / 粘贴
        │
        ▼
   ensure_tools + scope_planner
        │
        ▼
   collect（SAST / lint / secrets / SCA + CodexQA 图上下文）
        │
        ▼
   agent_llm/ handoff（prompts + policies + sast.json）
        │
        ├─ Stage1（宿主 agent）→ stage1.json
        ├─ agent-stage2 准备 → stage2_prompt.md
        └─ Stage2（宿主 agent）→ llm_final.json
                │
                ▼
        finalize / merge_report
                │
                ▼
        report_scan.json / .md / .html  （P0→P3）
```

1. **选场景** — `repo-incremental`、`repo-full`、上传或粘贴，经 `choose_scenario` / `run_scan.py choose`。
2. **确定性准备** — 工具检查、范围规划、适配器采集、CodexQA 上下文；写出 `agent_llm/` handoff。此时不要编造发现项。
3. **Stage1 / Stage2** — 宿主 agent 按注入的 prompts 与策略包写出严格 findings JSON（`references/policies/`）。
4. **Finalize** — 合并 SAST + LLM、校验、按严重级别排序，写出 `report_scan.*`。
5. **可选裁决** — 仅当用户明确接受/驳回/忽略时调用 `feedback.py`。

## Python 与模型的分工

| 层 | 负责 |
|---|---|
| Python（`run_scan`、collect、SAST 适配器、merge、finalize） | 工具状态、范围、确定性发现、合并规则、报告 schema、缓存键 |
| 宿主 agent（Stage1/Stage2） | 策略 prompts 下的语义 findings JSON；不做自动改码 |
| 可选 `--llm-mode api` | 经外部 OpenAI 兼容 API 走同一 Stage1/Stage2 契约 |

## 与其他代码类 skill 的关系

| Skill | 区别 |
|---|---|
| [`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.zh-CN.md) | CodexQA 证据包 → 双语 `REVIEW-REPORT.html` — 没有 `report_scan` 流水线 |
| [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.zh-CN.md) | 同一 CodexQA 图上的结构/影响面 — 不是严重级别发现报告 |
| [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.zh-CN.md) | 在 CLI facts 之上做异常 RCA — 不是增量/全量代码风险扫描 |

## 证据状态

本地 `npm test` 跑 Python 流水线与策略夹具套件（Python 3.10+）。实 agent/API 扫描与可选 SAST 二进制不由本仓库 CI 强制执行。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。
