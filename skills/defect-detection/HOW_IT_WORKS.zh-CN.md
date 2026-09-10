# 缺陷检测的工作原理

[English](HOW_IT_WORKS.md)

[`defect-detection`](README.zh-CN.md) 不内置模型，也不是又包一层 Semgrep。它给宿主 agent 搭流程：按「和需求有多相关」给变更方法排优先级，让 agent 逐个对照规格审查，再用校验规则确认它真读了代码、结论对得上源码。

为什么长这样，写在下面。运行时契约看 [`SKILL.md`](SKILL.md)。HTML 报告长什么样：[样例页](https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/defect-report.html)。

## 问题：两类缺陷，规则只擅长一类

静态分析擅长「长什么样都认得」的问题：空指针、被吞掉的异常、`== None`、写死的密钥。这些从语法树就能认，不必知道程序该做什么。

能混过评审的，通常是另一类：语法没问题、写法也正常、测试是绿的，但和需求不一致。

- 需求写「满 10 件打折」，代码用了 `>`，满 10 件反而没打上。
- 退款按申请金额原路返回，没有按剩余可退余额封顶。
- 一个函数改了库存计数器，读同一份数据的缓存却从未失效。

语法规则抓不到这些。bug 在**代码和意图对不上**的地方；意图在需求、用例，或评审者脑子里，不在 AST 里。

模型能同时读需求和方法，看出对不上。但放开了的审查者有三种坏法，每一种都比没工具更糟：

- **编造**：报告一个不存在的方法，或引用从没读过的行号。
- **空话**：对两百个方法都写「已审查，没问题」——流畅、自信、没有信息；不核对就看不出是假的。
- **噪音**：凡是看着不寻常的都标出来，真问题被淹没，人就不看了。

前提就一句：**模型做语义判断，基础设施保证这个判断能被核对。** 后面那些不那么显然的设计，几乎都在防这三种。

## 这套分工有多少证据

[`inventory-service`](https://github.com/openqa-cn/codexqa/blob/main/examples/inventory-service/README.md) fixture 上跑过一次盲测：一个 JavaScript 仓库，特性分支在正常改动里藏了 7 处业务逻辑缺陷，外加 4 个「看着可疑其实正确」的诱饵函数。Agent 全程看不到答案键。

| 指标 | 结果 |
| --- | --- |
| 植入缺陷检出 | 7 / 7 |
| 诱饵函数误报 | 0 / 4 |
| 由 Semgrep 种子规则发现的 | **0 / 7** |

这 7 处都是「对照需求、按方法看」找出来的，AST 那一遍在这个样例上没有命中。不是说种子规则没用——它们本来就该用低成本抓另一类问题——只是说明：**真正难的在语义层，所以要约束的也是语义层。**

说清楚：单 agent、单模型、自己写的样例、只跑了一次。用来演示契约，不是榜单成绩。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 四个设计决策

### 1. 两个引擎，而且刻意不对等

`run-ast-scan` 用 Semgrep 跑 102 条内置种子规则，覆盖十种语言，带 CWE / OWASP / ASVS 元数据。Agent 则另外按方法逐个对照需求和用例做分析。

两遍覆盖的不是同一类缺陷。种子规则便宜、确定、可复现，管「形状可识别」的问题，所以先跑，落在 diff 之外的命中可以批量 dismiss。方法级分析贵且不确定，所以要**限量**（下一条）和**重校验**（再下一条）。

规则还支撑一个专门的反失效检查：声明 strategy 8（AST）的写回，必须报告一个非零的 `astRuleCount`，且与实际加载的规则数一致。Agent 不可能在没跑扫描的情况下声称「扫描没发现问题」。

### 2. 分层是给昂贵分析配给预算

变更方法值不值得深挖，差别很大；一视同仁的结果就是评审者被淹没。检测计划给每个条目按「与已陈述意图的关联强度」打层级：

| 层级 | 判定条件 | 对分析的额外要求 |
| --- | --- | --- |
| **T1** | 有测试用例直接引用该方法 | 最深：需要调用链证据，且至少读 2 个不同的上下文文件 |
| **T2** | 需求文档直接引用，或测试用例间接引用 | 需要调用链证据，至少 1 个上下文文件 |
| **T3** | 没有任何文档关联——默认值 | 豁免调用链和上下文深度要求 |

`T0` 是另一回事，也是常见混淆点：它是 trivial 方法分类（空方法体、getter、setter、委托）产出的标签，用来给自动 dismiss 提供理由，**不是**可写回的层级——写回只接受 T1/T2/T3。

两个后果。第一，**层级只升不降**，所以后补文档（`add-document`、`check-phase2-readiness`）会向上重新打标，任何时候补都安全。第二点更重要：**既没有需求也没有用例时，所有条目都停在 T3，深度要求就不适用了。** 你给多少意图，它就有多严格——对着一个没有任何文档的仓库跑，得到的是弱得多的一次运行，而它不会明确提醒你这一点。

另外还有一个由 diff 规模决定的 `light` / `strict` 模式（变更少于 200 行为 `light`），会放宽小改动的部分证据阈值。

### 3. 硬规则是反编造契约，不是格式规范

校验规则编号到 24——其中 20 和 23 有意留空，实际生效 23 条——由 `scripts/validate.ts` 在写回时强制执行，另有若干未编号检查。逐条读没什么用；按**各自防御的失效模式**分组才讲得通：

**「你根本没读代码。」**
规则 14 要求在接受某个类上的结论之前，必须先有该类的 `register-code-read` 记录；规则 19 要求有 `register-repo-clone` 记录；规则 24 在 `batch-update-process` 期间执行——它取出结论里的方法名，去真实源文件里 grep，编造的方法名会让整个批次失败。

**「你产出的是文字，不是分析。」**
空的 `thinking` 或 `processSteps` 直接拒绝。`thinking` 短于 30 字符且含套话（"no defect"、"lgtm"）拒绝。已执行的流程步骤必须带非占位的结论。此外还有批次级 hollow-check：在 ≥20 条的批次上寻找「模型进入自动驾驶」的统计特征——连续高度相似的 `thinking`、模板短语占比过高、不合常理的无缺陷率。一旦触发，**整批**都被拦下，一条都不提交。

**「你的结论不可操作。」**
规则 11–13 和 15–17 对缺陷描述强加结构：`Defect:` / `Improvement:` 前缀、`Lines:X-Y` 行号区间、含代码块的修复建议、影响面陈述、复现路径，以及标明问题属于 `[This change]` 还是 `[Pre-existing]` 的标签。置信度标记是必填的，低于 HIGH 的还必须带 `[Needs confirmation]`。

**「你看得不够深。」**
规则 6 和 22 要求调用链证据和上下文读取次数，按上表随层级伸缩。

说白了：一个想尽快收工的 agent，没人拦着就会写出看似合理的空话。这些规则是这份输出值得一读的原因。

### 4. 关门是一道闸，不是一个仪式

Phase 3 不只是把任务标记完成。`check-analysis-quality` 从已记录的证据重新推导上下文读取深度，不达标就阻断。`check-rank-integrity` 校验每条缺陷态流程都有对应的报告条目、反之亦然——专门抓「结论写了但报告里没露面」的情况。`reconcile-report` 比对本地结论集合与报告实际渲染的内容。`finalize-all` 把这些串起来，自动补齐缺失的 rank，校验报告内容（包括每条的最小长度），只要还有阻断项就拒绝完成任务。

## 流水线

三个阶段，各自把分片状态写到 `data/{taskId}/`：

```text
Phase 1 — 准备                            写入
  submit-git / phase1-init                  meta.json, static.json
  clone-and-diff [--with-plan]              meta.diff, services.localDir
  build-detection-plan                      plan.json（层级、模式、trivial）
  add-document / add-test-case              static.extractedRules, test_cases.json
  check-phase2-readiness                    plan.json（层级向上重打标）

Phase 2 — 检测
  run-ast-scan                              （内存结果，由 agent 写回）
  register-code-read / register-context-read    writebacks.contextReads
  update-process / batch-update-process      writebacks.processWritebacks
  finalize-rank                              writebacks.ranks

Phase 3 — 关闭
  check-analysis-quality                     （深度不足则阻断）
  finalize-all --summary                     报告 HTML、任务完成
```

状态分片有个很实际的理由：`meta.json`、`plan.json`、`writebacks.json` 分开存，是为了让一次长时间运行能中途恢复或检查，不必重放 Phase 1。

## 模型在哪一环

OpenQA 不附带模型。推理由宿主 agent 提供——Codex、Claude Code、Cursor、OpenClaw——而 `SKILL.md` 加上 `references/` 目录树提供它遵循的指令，按任务需要渐进加载。上面讲的全部内容，都是围绕**那段推理**搭的脚手架：agent 必须看什么、必须交出什么证据、做不到时会发生什么。

所以**检测质量随宿主模型而变**，上面的 7/7 是一个模型在一个 fixture 上的结果。这也正是校验层值得它那份复杂度的原因——底下的模型换掉时，它是保持不变的那部分。

## 延伸阅读

| 主题 | 文档 |
| --- | --- |
| 工具做不到什么，附具体失败场景 | [已知边界](KNOWN_LIMITATIONS.zh-CN.md) |
| 已验证的运行时、语言与证据 | [支持矩阵](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md) |
| 可运行 fixture，含盲测仓库 | [示例](https://github.com/openqa-cn/codexqa/blob/main/examples/README.zh-CN.md) |
| Agent 运行时契约 | [`SKILL.md`](SKILL.md) |
| 逐条校验规则参考 | [`validation-rules.md`](references/rules/validation-rules.md) |
