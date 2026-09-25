# 已知边界（实测数据）

这些局限性直接决定分析结论的可信度。**在分析过程中，必须将适用的每一项视为硬性约束条件**，切勿静默忽略。

> **“实测数据”的含义：** 下文所有测试均在一套 **JavaScript 样本仓库**（Node 后端、纯前端、两个测试脚本）上执行。
> 其中的文件路径与符号名（如 `server.js`、`catalog.js`、`listBooks`、`favorited` 等）**仅作为示例说明**。
> 其目的是使缺陷具象化。请理解背后的**机制与规避方案**，而非生搬硬套名称。
> 在其他代码库或编程语言中，表现可能更轻微或更严重（Rust / Java 的跨文件调用边通常比 JS 更完整）。

**仅阅读与当前现象匹配的条目，请勿通读整篇文件：** 更换基线后变更标记未变 → 第 1 条；`to_count==0` 误报入口 → 第 2 条；`tested_count` 全为 0 → 第 3 条；`tagged` 结果为空 → 第 4 条；触碰调用深度或行数上限 → 第 5 条；`search` 遗漏调用点 → 第 6 条；图表未成功渲染 → 第 7 条；行号存在 1 行偏差 → 第 8 条；自动生成用例的副作用 → 第 9 条；命令报错或无响应 → 第 10 条。

## 1. 增量索引不会刷新 diff 标记（影响最大）

`codexqa index . --diff-base <base>` 在文件无变化时会打印 `mode: incremental (no changes)` 并直接退出。**此时它会残留上一次 diff 索引的变更标记。**

实测数据：使用 `--diff-base HEAD~1` 建索引（包含 3 个变更组 / 11 个符号），随后执行 `codexqa index . --diff-base HEAD`（增量）→ `change-groups` 依然返回此 3 个分组。只有执行 `codexqa index . --diff-base HEAD --full` 才会正确返回空。

**规避方案：** 遵循 SKILL.md 硬规则 1 与索引可信门禁（必须使用 `--full`，并与 `git diff` 进行集合对比核验）。

## 2. 动态语言跨文件调用边可能缺失 → `to_count == 0` 会将非入口误判为入口

实测数据（样本仓库）：`server.js:87` 明确调用了 `listBooks(...)`，但 `listBooks.to_count == 0`，且 `reach --direction in` 仅返回同文件的 `homeFeed`。在 `server.js:91` 对 `markFavorites` 的调用在图中同样缺失。**同文件调用边通常完整**（在 `catalog.js` 内对 `markFavorites` 的两次文件内调用均被索引）。该缺口主要集中在**跨文件**调用，因此“该文件内有边”并不意味着“跨文件边存在”。

**规避方案：** 遵循 SKILL.md 硬规则 2 与 analysis.md §3.2（强制进行文本检索交叉比对）。若图边不完整，报告中需在 `#meta-line` 标记“Degraded: graph incomplete”。

## 3. `tests` 边依赖具体语言支持；JS 实测为空

实测数据：在 JS 样本库中全部 406 个节点均为 `source=local`，`tested_count` 始终为 0，且 `reach --edge-kinds tests` 结果为空；而该样本库实际具备完整的 API 冒烟测试脚本（`scripts/smoke-test.mjs`）和 UI 端到端测试脚本（`scripts/e2e-ui.mjs`）。

**规避方案：** 当 A 层图边为空时，**必须**执行 B 层文本召回（详见 [test-recall.md](references/test-recall.md)）。切勿将“`tested_count` 全为 0”直接写成“仓库没有测试”。

额外实测：在测试文件中检索**变更符号名**同样可能全部落空（`markFavorites` / `listBooks` / `homeFeed` 均 0 命中）。召回关键词必须采用**本次 patch 引入的字段名 / API 路径 / 错误码**（检索 `favorited`、`/api/books` 可命中 4 个以上用例）。详见 [test-recall.md](references/test-recall.md) §B2。

## 4. 框架标签（Framework tags）仅覆盖部分语言

`codexqa tag . keys --json` 目前仅为 Spring / Rust 注册了标注器（`framework.http`, `framework.http.method`, `framework.http.client`, `framework.mq_consumer`）。在 JS/TS/Python 仓库中，`tagged --key framework.http` 结果为空，且 `repo_count` 为 0。

**规避方案：** 当 `tagged` 为空时，通过路由注册语法 / `main` / 事件注册的文本形态寻找入口（§3.3）。切勿将空结果当成“系统不存在入口”。

## 5. 硬性上限（Hard caps）

| 项 | 上限 | 影响及处理 |
|---|---|---|
| `reach --depth` | 10 | 超过此深度的长链路无法达到顶层：分层递进并保守推断。**切勿将“未到达顶层”写为过程备注。** 报告只需在 `#meta-line` 标明“Degraded: graph incomplete” |
| `symbol-diff --max-lines` | 500 | 补丁内容被截断；回退至 `file-source` / `file-base` |
| `repos --limit` | 200 (默认 20) | 溢出部分被静默截断；使用 `--filter` 与分页查询 |
| `change-groups` | `truncated: true` | 变更分组不完整；保守推断风险优先级与影响范围。报告只需在 `#meta-line` 标明“Degraded: graph incomplete” |

## 6. 其他注意事项

- 删除的符号可能没有补丁详情（在变更后的文件中节点已不存在）。需从 `file-base` 或 `git show <base>:<file>` 中获取。
- `path` 返回 `hops=-1` 仅代表“在指定深度内未连通”，图边缺失也会导致该结果，不可据此断言“绝对不可达”。
- **`search` 是文件块级别的检索，无法列举精确调用点与行号。** 实测：`search --query <函数名> --limit 50` 对每个文件通常只返回一条 import 块命中，**遗漏真实的调用行**。寻找调用点需使用 `edges` / `reach`（图中有边时）或 `grep`（图中无边时）。
- **`search --tests-only` 实测始终为空：** 样本库的测试文件已被索引，但在加 `--tests-only` 后无论 simple 还是 whitespace 分词器均返回 0。请自行按文件名过滤测试文件。
- 根据查询类型选择分词器：行为关键字（字段名 / 路径 / 错误码）使用默认的 **simple** 分词器。`--tokenizer whitespace` 适合完整符号名，但会遗漏长 token 内部的行为关键字（如 `.fieldName`）。切换分词器必须加 `--force` 重新建索引。
- 大型仓库初次全量索引耗时较长（`--full` 会全量重新解析）。此耗时符合预期，切勿中途强制终止导致在半成品索引上推断。

## 7. HTML 报告渲染（实测数据）

- **字体与图表均依赖网络，而网络环境可能存在白名单限制。** 实测环境：`cdn.jsdelivr.net`、`unpkg.com`、`esm.sh`、`cdnjs.cloudflare.com` 和 `registry.npmjs.org` **全部超时（HTTP 000，耗时 12–15s）**。仅 `fonts.googleapis.com` 返回 200。**切勿使用运行时 CDN 动态加载渲染 Mermaid。**
- **必须将 Mermaid 关系图渲染为内联静态 SVG**（操作指引见 [references/report.md](references/report.md) 中的“Diagrams must be static”）。内联后报告支持离线展示，且不再依赖运行时 JS。
- 检查机制：以无头模式打开报告。DOM 中应包含 `class="mermaid-svg"` 与 `<svg`，**且不包含**残留的 `class="mermaid"`。若仅看到原生的 `<pre class="mermaid">`，说明图表未成功渲染。
- 外部字体缺失仅影响外观（会自动降级使用系统无衬线字体），正文与表格排版不受影响。报告可读性不依赖 CDN。
- 不要死等无头浏览器的 `--dump-dom` 命令。某些持续连接会导致 Chrome 无法正常退出。**需在后台运行并一旦检测到目标即刻终止**（轮询 DOM 中的 `<svg` 或 `class="mermaid-svg"`；固定等待实测达 40s，而轮询通常只需 3–8s）。兜底时可使用硬超时控制（如 `perl -e 'alarm 25; exec @ARGV'`）。
- 同样的问题也会影响所有使用“模板 + CDN 加载器”的报告（包括 code-wiki 产物）。建议先探测 CDN 连通性。
- **不要将 Mermaid 源码存放在 HTML 注释中。** 流程图关系包含 `-->`。HTML 注释会在首个 `-->` 处提前闭合，导致后续代码暴露为页面正文（实测：21 个 `:::` 和 20 个 `-->` 中的第一个即提前闭合注释，导致约 1KB 源码散落到图表下方）。归档时请存放在 `<script type="text/plain" class="diagram-source">…</script>` 中，脚本标签内容不会被浏览器渲染。
- **归档后务必核对源码完整性。** 若截取逻辑同样在 `-->` 处中断，归档内容会只有前半段（实测：仅存了 18 行，全部连线丢失）。归档必须完整保留 `flowchart TD`、所有 `classDef`、两个 `subgraph` 以及最后一条连线。
- 全文检查时，可见文本中 `:::`、`flowchart`、`classDef` 和 `-->` 的数量应为 0（排除 `<svg>`、`<script>` 和注释后的可见字符）。
- 节点文案中的 `<` 与 `&` 必须转义，否则 Mermaid 解析会失败或破坏 HTML 结构。

## 8. CodexQA 内部行号从 0 计（实测数据；影响所有 `file:line`）

CodexQA 的 `start_line` / `end_line` 以及 `search` 返回的行号**从 0 开始**。而 `grep -n` 及常用代码编辑器**从 1 开始**。

实测数据（JS 样本库）：报告中所有 11 处方法定义位置**均相差 1 行**。CodexQA 报告 `xxx.js:48`；编辑器中实际在第 49 行才出现 `export function ...`。类似偏移出现在 95→96、5→6 以及 8→9。

**规避方案：** 遵循 SKILL.md 硬规则 8。交付前必须抽样验证：`sed -n "<line>p" <file>` 显示的内容必须是方法定义本身，而不是前一行或 JSDoc 注释。

- 相关陷阱：`symbol-diff` 的 hunk 头采用 git 风格（从 1 计），来源不同于节点行号，切勿用其去“校正”节点行号。

## 9. “仅新增测试”模式的两大副作用（实测数据）

硬规则要求生成的用例**仅新增文件，不修改现有测试文件或 `package.json`**。这带来两项代价。**两者均为分析阶段的备忘，切勿写入正式报告。** `#testplan-artifact` 仅需写明用例数与通过/跳过结果（表述规范见 [references/generate-cases.md](references/generate-cases.md)）：

1. **原有的弱断言用例依然保留在仓库中。** 标记为“extend”的用例没有在原处增强，它仍会正常通过。强断言只存在于新生成的文件中。在用例文件列中注明对应位置即可（格式为：`已有 <file:line> → 新增 <生成文件:line> 覆盖`）。**切勿**额外增加类似“未修改已有用例”的说明，否则会让读者误以为必须手动修改旧用例。
2. **生成的文件未挂接进仓库自带的测试脚本中。** 由于不可改写 `package.json` / `Makefile`，仓库日常的测试命令不会自动执行新文件。必须显式运行生成的文件。

此外：破坏性用例（如修改密码等）需使用临时账号，**可能会残留测试数据**（许多仓库不具备自服务清理接口）。能清理的尽量清理；无法清理的需**在对话中告知用户**（不要写进报告）。切勿隐瞒不报。

## 10. 阻断性异常与应对方案

| 现象 | 处理方案 |
|---|---|
| `command not found: codexqa` | `npm i -g @openqa-cn/codexqa`，或 `export PATH="$(npm prefix -g)/bin:$PATH"`。若确实无法安装，切换至降级模式 |
| 仓库未建索引 / `query` 提示 `repo not indexed` | 执行门禁：`codexqa index . --diff-base <base> --full`。首次运行会建立全量索引。使用 `codexqa repos --filter <substr> --limit 200` 确认，不要直接裸跑 `repos` |
| 非 git 仓库（提示 `fatal: not a git repository` 等） | 没有基线便无法衡量“变更”。切勿凭空编造基线。向用户索取基线仓库或 patch。若确实没有基线，执行静态分析并在 `#meta-line` 标明“No change baseline” |
| `change-groups` 为空，或标记与上一次运行一致 | 基线变动但未加 `--full`。重新执行 `index . --diff-base <base> --full` |
| 仓库中所有符号的 `change_status` 均为 `default` | 当前不是 diff 索引。重新加上 `--diff-base` 执行 |
| `file-base` 为空 | 不是 diff 索引，或该文件并未发生变更 |
| `tagged --key framework.http` 为空 | 该语言暂无对应标注器 → 通过路由注册文本寻找入口，如 `grep -n "router\.\(get\|post\|put\|delete\)"` |
| `symbol-diff` 报错或返回格式异常 | 回退至 `file-base` 与 `git show <base>:<file>` 获取基线内容对比 |
| 生成的用例执行挂死 / 无响应 | 优先检查被测仓库是否需要前置依赖启动（如 DB / Redis / API 服务）；端到端测试检查是否有阻塞式登录弹窗或代理设置问题 |
