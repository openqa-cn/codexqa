# 根因诊断的工作原理

[English](HOW_IT_WORKS.md)

[`root-cause-diagnosis`](README.zh-CN.md) 给宿主 agent 搭流程：异常证据和业务代码库进去，英文根因报告出来。本 skill 不内置模型，也不内嵌 CodexQA 源码。结构化事实来自 CodexQA CLI；模型在固定标题下写叙事；TypeScript 在草稿变成 `report.md` 之前做门禁。

运行时契约见 [`SKILL.md`](SKILL.md)。

## 数据流

```text
异常证据 + git / dir / file
        │
        ▼
   diagnose.ts run
        │
        ├─ 解析异常 → parsed.json
        ├─ 在 data/<taskId>/ 下落地 / 解析仓库
        ├─ CodexQA CLI：index / query（只用二进制）
        └─ 帧分析 → brief.json + facts.json
                │
                ▼
        report.draft.md  （标题 + facts；TS 不写 RCA 正文）
                │
                ▼
        模型填草稿  （只写叙事，引用 facts）
                │
                ▼
        write-report --from-draft  （标题 + storyGaps 门禁）
                │
                ▼
        report.md / report.en.md  （英文）
```

1. **异常输入** — 堆栈、日志、调用链 dump 或调试文本，外加 `--git`/`--branch`、`--dir`、`--file`，或已打开的工作区。
2. **`run`** — 一次进程：提交任务、确保 CodexQA 索引、分析帧。写出 `brief.json`、`facts.json` 和仅含标题的 `report.draft.md`。**不**撰写 `report.md`。
3. **模型填写** — 在八个必需的 `##` 标题下写叙事，只引用已有 facts。不要把 `facts.json` 当报告粘贴。
4. **`write-report`** — 拒绝缺标题和机械 `storyGaps`（Confidence 行、分支/抛出/竞态标记等）。不以章节字数拒绝。
5. **对话输出** — `chat.en` 给一段英文摘要，并附上报告路径。

## TypeScript 与模型的分工

| 层 | 负责 |
|---|---|
| TypeScript（`draft-report`、解析、ensure-codexqa、analyze） | 抽出的 facts、brief、一级标题、机械缺口检测 |
| 模型 | 在这些标题下，对本业务域写因果叙事 |
| TypeScript（`write-report`） | 接受报告前的标题与 story-gap 门禁 |

不要把「某异常类该怎么修」写进 TypeScript 草稿助手。机械缺陷留在脚本和测试里；因果句是否*成立*留给模型。

## 与 `code-analyzer` 的关系

`code-analyzer` 用同一套 CodexQA 图回答结构和影响（改了什么、谁调用、测试缺口）。本 skill 在 CLI 分析**之上**做**异常根因**：触发点 / 根因 / 贡献因素、映射调用路径，以及带门禁的英文报告。只与 `codexqa` 二进制对话；不复制引擎或 skill 源码。

## 证据状态

本地 CLI 测试覆盖解析、落地、草稿和冒烟路径。没有公开的宿主 agent 成绩，也没有和 defect-detection inventory-service 对等的答案键 fixture。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。
