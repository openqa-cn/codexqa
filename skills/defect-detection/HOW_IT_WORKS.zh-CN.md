# 缺陷检测如何工作

[English](HOW_IT_WORKS.md)

[`defect-detection`](README.zh-CN.md) 给宿主 agent 搭流程：diff / 仓库 / 上传 / 粘贴进去，P0–P3 的 `report_scan.*` 出来。两条**检测维度**跑完后，由 Python **去重合并**成一份报告：

1. **确定性维度** — SAST / lint / secrets / SCA 适配器
2. **Agent LLM 检测维度** — 调用本 skill 的宿主 agent 内嵌大模型（一轮分析 + Stage2 校验；无需 API key）

代码图上下文只来自 CodexQA CLI 二进制。运行时契约见 [`SKILL.md`](SKILL.md)。

## 数据流

```text
diff / 仓库 / 上传 / 粘贴
        │
        ▼
   ensure_tools + scope_planner
        │
        ▼
   collect（SAST / lint / secrets / SCA + CodexQA 图上下文）
        │  ← 维度：deterministic
        ▼
   agent_llm/ handoff（prompts/agent_detect.md + policies + sast.json）
        │
        ├─ Stage1 Agent LLM 检测（宿主 agent）→ stage1.json
        ├─ agent-stage2 准备 → stage2_prompt.md
        └─ Stage2 校验（宿主 agent）→ llm_final.json
                │  ← 维度：agent_llm
                ▼
        finalize / merge_report（去重 ∪ 合并）
                │
                ▼
        report_scan.json / .md / .html  （P0→P3；带 dimension 标注）
```

1. **选场景** — `repo-incremental` / `repo-full` / 上传 / 粘贴，经 `choose_scenario` / `run_scan.py choose`。
2. **确定性准备** — 工具检查、范围规划、适配器采集、CodexQA 上下文；写出 `agent_llm/` handoff。此时不要编造发现项。
3. **Agent LLM 检测** — 宿主 agent 按 `agent_detect.md` 写 Stage1，再 Stage2 校验（`references/policies/`）。
4. **Finalize** — 去重合并 deterministic ∪ agent_llm、校验、按严重级别排序，写出带 `dimension` 的 `report_scan.*`。
5. **可选裁决** — 仅当用户明确 accept/dismiss/ignore 时调用 `feedback.py`。

## Python 与模型各管什么

| 层 | 职责 |
|---|---|
| Python（`run_scan`、collect、SAST 适配器、merge、finalize） | 工具状态、范围、确定性发现、合并/去重规则、报告 schema、缓存键 |
| 宿主 agent（Agent LLM 检测 Stage1/Stage2） | 策略 prompts 下的语义 findings JSON；不做自动改码 |
| 可选 `--llm-mode api` | 同一 Stage1/Stage2 契约，走外部 OpenAI 兼容 API |

## 与其他代码类 skill 的关系

| Skill | 差异 |
|---|---|
| [`ai-code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/ai-code-reviewer/README.zh-CN.md) | CodexQA 证据包 + 启发式维度 + Agent LLM judgment（去重）→ 双语 `REVIEW-REPORT.html` — 无 `report_scan` 流水线 |
| [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.zh-CN.md) | 同一 CodexQA 图上的结构/影响面 — 不是按严重级别排序的发现报告 |
| [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.zh-CN.md) | 在 CLI 事实之上做异常根因 — 不是增量/全量代码风险扫描 |

## 证据状态

本地 `npm test` 跑 Python 流水线与策略夹具套件（Python 3.10+）。实 agent/API 扫描与可选 SAST 二进制不由本仓库 CI 强制执行。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。
