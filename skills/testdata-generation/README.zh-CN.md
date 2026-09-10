# 测试数据构造

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

厂商无关的 [Agent Skill](https://agentskills.io/specification)：对着后端构造测试数据；若请求是用例物料，再把业务字段回写成可执行前置条件。

回写长什么样：

<p align="center">
  <a href="https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testdata-writeback.html"><img src="https://raw.githubusercontent.com/openqa-cn/codexqa/main/docs/assets/previews/testdata-writeback.png" alt="测试数据回填占位符样例" width="880"></a>
</p>

**不编造业务 ID。**「构造成功」指后端返回了 ID，不是对话里出现了一个号。也**不**根据 PRD 写测试用例——那是兄弟 skill [`testcase-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testcase-generation/README.zh-CN.md)。

## 你要交什么

**不是被测源码。** 本 skill 不克隆仓库，也不从 `code/` 推断表名。它用你已有的材料去打后端（或自带 mock）：

| 任务 | 带上 |
|---|---|
| 一句话造数（「建一个叫 Northwind Standard 的标准商品」） | 自然语言，加上你已有的核心 ID（`productId`、`userId` 等） |
| 用例物料 / 回写 | 至少一份**用例**（文件、粘贴、`planId` 或 URL）。有 PRD 更好；没有用例不会去造 |
| 按接口写构造脚本 | **API 来源**：OpenAPI 目录、`planId` 或 `serviceId` |
| 新业务域 slot | `domain` 名 + 非空 OpenAPI 目录 |

可选的工作区上下文（`testdata/context.json`）可提供 `planId`、业务线、`serviceId`。缺前置材料会停，不会猜接口，也不会从源码编造 ID。

## 它做什么

1. **一次性构造** — 先 domain slot，再已发布工具，再发现到的 API，最后生成脚本。
2. **用例物料** — 解析用例、构造所需数据，把业务字段写入 `case-executable.md`（不写 `node` 命令或 mock 端口）。
3. **新域** — 从 OpenAPI 脚手架一个 slot（`slot-scaffolder/`）。

公司平台走适配器。本地文件和自带 mock 不需要额外基础设施。默认 `DATA_BUILD_API_BASE` 是 8765 端口上的 mock——demo 拿到 ID **不等于** 写入了真实系统。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

```
testdata-generation/         # 安装目录（与源码目录同名）
├── SKILL.md                 # 入口
├── HOW_IT_WORKS.md          # 原理 + 操作附录（给人看；agent 不读）
├── HOW_IT_WORKS.zh-CN.md
├── KNOWN_LIMITATIONS.md
├── KNOWN_LIMITATIONS.zh-CN.md
├── INSTALL.md               # npx skills add，以及可选的 zip 解压路径
├── scripts/                 # 适配器 + 搜索 + 打包 + slot 发现
├── references/              # 工作流、planner、模板
├── assets/                  # config.example.yaml
├── slots/                   # catalog / distribution 示例
└── slot-scaffolder/         # 从 OpenAPI 生成新域 slot
```

新公司场景：把 skill 丢进 `slots/`（或不在默认目录时加一行 `workspace.slot_roots`）。搜索、OpenAPI 索引、用例流水线绑定共用这份列表。关键词搜索读 `slot.yaml` 的 `description`（没有则读 `SKILL.md`）——把 `catalog` / `distributor` 这类业务名词写进去。

## 安装

```bash
npx skills add openqa-cn/codexqa --skill testdata-generation
```

然后**新建** Agent 会话。安装器会把本目录拷进宿主的 skills 文件夹（Cursor、Claude Code、Codex、OpenClaw）。

从本地源码打 zip 再解压也可以，见 [INSTALL.md](INSTALL.md)。zip 根目录文件夹里必须有 `SKILL.md`。

## 运行要求

- Node 22+
- `npm install` 只为 typescript/@types/node；运行时只用 Node 标准库

## 快速开始

```bash
cd testdata-generation
mkdir -p testdata
cp assets/config.example.yaml testdata/config.yaml

node slots/mock_server.ts --port 8765

node scripts/search_data_build.ts \
  --keywords catalog \
  --query "create a catalog product" \
  --registry-key "catalog-product::create" \
  --json

node slots/catalog/scripts/executors/create_product.ts
```

配置查找顺序：`$DATA_BUILD_CONFIG` → `./testdata/config.yaml` → `~/.testdata/config.yaml`。

## 企业适配器

契约：[references/adapters.md](references/adapters.md)。

| 适配器 | 本地默认 | HTTP 替换 |
|---|---|---|
| `skill_marketplace` | 扫描 `slots/` + `workspace.slot_roots` | 搜索 / 安装 |
| `tool_registry` | 本地工具 JSON + 脚本 | 查询 / 执行 / 发布 |
| `api_catalog` | slot 的 `assets/openapi/`（可加额外目录） | 服务 / 操作目录 |
| `experience_store` | 本地 JSON + 文本相似度 | 拉取 / 上报 / 反馈 |
| `auth` | `DATA_BUILD_TOKEN` | OAuth2 / OIDC token URL |
| `data_store` | 可选 `DATABASE_DSN`（仅 `SELECT`） | 只读 SQL 网关 |
| `config_store` | YAML / 环境变量 | 配置服务 |
| `feature_flags` | 空操作 | 实验平台 |
| `doc_source` | 本地文件或公开 URL | 文档服务 |
| `case_writeback` | 写 `case-executable.md` | 用例平台 |
| `workspace_context` | `./testdata/context.json` | 测试计划服务 |

## Domain slots

见 [slots/SLOT_SPEC.md](slots/SLOT_SPEC.md)。放在 `slots/` 下会自动发现。在别处时：

```yaml
workspace:
  slot_roots:
    - /opt/company/data-slots
```

```bash
node slot-scaffolder/scripts/scaffold_slot.ts \
  --domain payments \
  --openapi ./my-openapi \
  --output ./slots/payments
# 实现 executor 桩、在 slot.yaml 里加 scenes，然后：
node scripts/sync_slot.ts --dir ./slots/payments
```

## 对 Agent 可以直接说

- 帮我建一个叫 Northwind Standard 的标准商品
- 这份用例帮我准备测试数据，并回写前置条件
- 用测试计划的变更接口写一个造数脚本
- 按这个 OpenAPI 目录脚手架一个发票域 slot

已有 ID 直接写在请求里。没配企业网关时，先让 Agent 走本地 mock。

## 许可证

Apache License 2.0。见 [LICENSE](LICENSE)。
