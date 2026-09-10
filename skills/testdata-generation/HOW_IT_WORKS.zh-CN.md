# 测试数据构造：原理与操作要点

[English](HOW_IT_WORKS.md)

[`testdata-generation`](README.zh-CN.md) 不内置模型。它是宿主 agent 上的路由 + 脚本：模型决定走哪条路、抽出你已经给的参数；真正落库的是 executor / 已发布工具 / 生成脚本去打后端。

**输入不是被测源码。** 你带上造数请求、写好的用例，和/或 API 来源（OpenAPI / `planId` / `serviceId`）。本 skill 不读 `code/` 来编造表名或 ID。详见 [README · 你要交什么](README.zh-CN.md#你要交什么)。

Agent 运行时读 [`SKILL.md`](SKILL.md)，不要读本页。命令、安装、排障在英文 [HOW_IT_WORKS.md 操作附录](HOW_IT_WORKS.md#operator-appendix)。能力边界见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。回写样例：[预览页](https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testdata-writeback.html)。

## 要解决的问题

让模型「帮我造一条目录订单」时，常见三类错误：

| 错误 | 表现 | 约束 |
|---|---|---|
| 对话里造 ID | 回复写出 `productId=p_99`，后端从未创建 | 「成功」= 后端返回的 ID；用户已给的核心 ID 不得改写 |
| 猜接口 | 没有 OpenAPI / `planId` 仍写出看起来能跑的脚本 | 缺 API 来源就停，问材料，不编 endpoint |
| 把命令写进用例 | `case-executable.md` 里出现 `node`、端口、`skillRoot` | 回写只含业务字段；调用细节留在 `manifest.json` |

模型只做路由和抽参。落库、绑定、回写由脚本完成，这样明天再跑才能得到同一份 manifest。

## 评估状态

没有公开 fixture、没有答案键、没有和 defect-detection inventory-service 7/7 对等的数字。本地验证覆盖搜索、mock executor、打包和流水线场景脚本，**不是**一次完整的宿主 agent 评测。把「能造出 demo ID」当成设计意图，不要当成生产网关已验证。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 你会看到什么

| 时机 | 展示 | 你怎么回 |
|---|---|---|
| 缺前置材料（用例包 / OpenAPI / 跨域上游 ID） | 只问缺的那一样，不问 `quantity`、`rate` 这类可默认字段 | 补上材料；流程会接着走完 |
| 唯一本地 slot 对得上 | 直接构造，并说明用了哪个 skill | 一般不用确认 |
| 多个都说得通，或要安装新 skill | 列出候选再问 | 选一个，或说都不是 |
| 构造成功 | 业务字段 + 走了哪条路 + mock 时会标明环境 | 可选：收藏该 skill、把脚本发布成工具 |
| 用例物料跑完 | `case-executable.md`（只要业务字段） | 核对 ID 来自哪套 `DATA_BUILD_API_BASE` |

默认后端是本地 mock（`http://127.0.0.1:8765`）。mock 的 `p_1` 和预发网关的 ID 长得一样，信任回写前先确认 base URL。

## 机制

### 1. 先分流，再回退

用例物料请求（准备测试数据、回写前置等）走 `pipeline.ts`，**不**走下面四段。其余请求按顺序：已收藏 / 已验证方法 → domain slot → 工具注册表 → API 目录 → 按模板写脚本。每一段命中就停。

### 2. 模型不写数据

决策树只选路。HTTP 由 executor 或 `callHttp` 发出。没有后端响应，就不许在回复里「生成」业务主键。

### 3. Slot 是可插拔的域能力

`slots/catalog`、`slots/distribution` 是示例，不是写死的公司知识。新域：OpenAPI → `slot-scaffolder` → 实现桩 → `slot.yaml` 的 `scenes`。搜索、OpenAPI 索引、用例绑定共用 `slots/` + `workspace.slot_roots`，没有第二份注册表。

### 4. 关键词必须是业务名词

`--keywords` 用请求里的 1–2 个领域名词（随包演示槽用 `catalog`）。「帮我构造」这种动词会退化成全量扫描。这些名词要写进 `slot.yaml` 的 `description`，不要用包装套话当第一句。

## 流水线（概念）

```text
自然语言 / 用例 / OpenAPI
        │
        ▼
  是否用例物料？ ──是──► pipeline.ts（parse → 构造 → 回写）
        │否
        ▼
  搜索 slot / 已验证方法 / 工具
        │都未命中
        ▼
  API 目录（planId / serviceId / 关键词）
        │仍没有
        ▼
  有 API 来源 → 写 ./testdata/<name>.ts 并本地跑
  没有 → 停，问材料
```

产物：一次性构造把 ID 打在对话里；用例物料写入 `testdata/case-materials/{case-id}/case-executable.md`。

## 延伸阅读

| 主题 | 文档 |
|---|---|
| 要交什么、安装、quick start | [README](README.zh-CN.md) |
| 已知失败与边界 | [已知边界](KNOWN_LIMITATIONS.zh-CN.md) |
| Agent 运行时契约 | [`SKILL.md`](SKILL.md) |
| 命令、上报 payload、排障 | 英文 [HOW_IT_WORKS.md 操作附录](HOW_IT_WORKS.md#operator-appendix) |
| 各 skill 要交什么 | [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.zh-CN.md) |
