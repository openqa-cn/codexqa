# 测试用例生成

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

开源 Agent Skill：从本地 PRD、技术方案、接口规格和可选知识库，生成并维护结构化的**手工测试用例**。

**输入是文档，不是 git 克隆。** 生成读 `prd/`（以及可选的 `knowledge/`）。`code/` **只在更新**时用来 diff、判断哪些已有用例受影响——不从代码推断 schema，也不填测试数据。

## 它做什么

1. **生成** — 分析需求、设计覆盖、查询接口契约，写出带唯一 ID 和工程信息的 Markdown 用例。
2. **更新** — 检测 PRD / 代码 diff，定位受影响用例，增量改设计并重生成。

不需要内网 CLI、内部配置中心或用量上报。脚本是 TypeScript，需要 **Node.js 22.6+**（`node --experimental-strip-types --experimental-default-type=module`），不用装 npm 包。

数据流、门禁、`TBD` 规则见[工作原理](HOW_IT_WORKS.zh-CN.md)。未测量项与更新 diff 限制见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

测试数据是另一件事：用例带着 `{placeholder}`，由兄弟 skill `testdata-generation` 对着真实后端回填。

## 零配置（只用本地文件）

没有 `{workspace}/.ai-testcase/integrations.yaml` 时，skill 使用 `config/integrations.default.yaml`：

- 协议：`http`、`grpc`。一张缓存表、一张 MQ 表。不拆 Redis / KV，也不要求 Thrift。
- `spec_lookup` / `knowledge_search` / `env_info` 读 `prd/specs/`、`knowledge/` 和 `.project/context.json`。
- `config_lookup` / `middleware_lookup` / `experiment_lookup` 保持关闭（`call_integration.ts` 返回 `status=skipped`）。

把材料放到工作区（或让 agent 拷进去）：

```
{workspace}/
├── .project/context.json   # 可选：环境、分支、文档本地路径
├── knowledge/              # 可选：本地知识库（markdown / JSON）
├── prd/
│   ├── requirementDocs/    # PRD
│   ├── techDocs/           # 技术方案
│   └── specs/              # OpenAPI / IDL / 其它契约
├── code/                   # 被测代码（可选）
└── usecases/
```

公开 URL 可以抓下来落到 `prd/`。不用私有内网文档平台。

## 企业 HTTP 适配

要接自己的规格门户、知识检索、配置中心或环境服务：

1. 把 [`config/integrations.example.yaml`](config/integrations.example.yaml) 拷到 `{workspace}/.ai-testcase/integrations.yaml`。
2. 按 [`references/integration-api.md`](references/integration-api.md) 实现 JSON 接口。
3. token 和证书路径放环境变量（`${OAUTH_CLIENT_SECRET}`、`${MTLS_CERT_PATH}`）。不要把明文密钥或 PEM 提交进库。

Agent 必须走 `scripts/call_integration.ts`——不要手写 curl，不要绑厂商 SDK。Phase 0 会写出不含密钥的 `usecases/testdocs/integrations-resolved.json`，后续步骤只读这份解析结果。

## 产出

```
usecases/
├── cases/{module}/*.md
└── testdocs/
    ├── analysis.md
    ├── integrations-resolved.json
    ├── design.md
    ├── api-details.md
    ├── case-registry.json
    └── ...
```

## 目录

```
testcase-generation/
├── SKILL.md
├── README.md
├── README.zh-CN.md
├── HOW_IT_WORKS.md         # 数据流与约束
├── HOW_IT_WORKS.zh-CN.md
├── KNOWN_LIMITATIONS.md
├── KNOWN_LIMITATIONS.zh-CN.md
├── config/                 # 默认 / 示例 integrations YAML + schema
├── scripts/                # validate_integrations.ts, call_integration.ts (Node 22.6+)
├── references/             # HTTP 适配契约
├── generation/             # 编排 + 分阶段文件、指南、质量门
├── maintenance/            # 增量更新工作流
└── evals/                  # 代表性 prompt；尚无公开 fixture
```

## 怎么用

把 agent 指到这个 skill 目录，让它生成或更新测试用例。Agent 先读 `SKILL.md`，再读生成或更新那份文档。

```text
用 testcase-generation 根据 prd/ 下的文档生成手工用例库。
源材料没写的工程字段不要编，写成 TBD。
```

PRD 与技术方案冲突时回复 `Confirm follow PRD` 或 `Item N follow technical design`。停点与产物见[工作原理 · 交互协议](HOW_IT_WORKS.zh-CN.md#交互协议)。
