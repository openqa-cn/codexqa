# CodexQA Jev Browser

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知限制](KNOWN_LIMITATIONS.zh-CN.md)

用 GUI 模型做浏览器自动化时，每一步都要把截图送给视觉模型找控件。识别要付视觉 token，回路要等模型看图，点选落在坐标上。

CodexQA Jev Browser 把找控件从视觉模型换成页面内编好的索引，把通过与否交给页面上看得见的证据。回放、按目标执行、用例生成和站点探索共用这一套索引。默认浏览器是 Playwright Chromium。只有在你自己提供 https 镜像和校验值时，才可以改用本机的 Cloak。本仓库没有和视觉 GUI 模型的对照基准，下面是结构上避开这些成本的做法。

## 传统自动化的痛点

| 痛点 | 这里的做法 |
| --- | --- |
| GUI 模型按截图找控件，每步都消耗视觉 token | 决策只接收页面里已经编好的索引：角色、名称、当前值和允许的操作。模型做的是选择题。截图留在报告里，用来标出点过的控件。 |
| 每步都要等视觉模型看完图，回路慢 | 观测在页面里完成。`run`、`explore` 和 `--decisions` 不调用决策模型。`generate` 写出 YAML 之后，`--verify` 用同一套索引回放。 |
| 坐标和视觉定位容易点偏，布局一变就失效 | 动作打在 `data-codexqa-jev-browser-id` 上。用例用 `role` / `name` / `nth` / `within` 对当前索引解析，iframe 里的控件走同一条定位。执行前索引必须仍在动作空间里，执行后再核对页面是否变化。 |
| 跑哪一个浏览器要由配置决定 | 默认是 Playwright Chromium。`browser.engine: auto` 只在本机已经有 Cloak 时才使用它。 |

## 亮点

- **动作空间是封闭的。** 观测给每个可见控件一个索引、角色、名称，以及它实际支持的操作。运行时只接受这个集合里的操作和索引。模型回复里像选择器、JavaScript 或 shell 的内容会在执行前被拒绝。
- **Jev 做的是结构化选择题。** 配置了 `TYPESAFE_API_KEY` 时，每一步都是一次 `/systemone` 提问：选哪个操作、选哪个已观测目标。同一次通道还判断这一步有没有在下一页上显现。没有 Jev 时，决策退到兼容 OpenAI 的 `chat/completions`。`--decisions` 两者都不调用。
- **默认用 Chromium，Cloak 需要显式配置。** `browser.engine: auto` 在 `~/.cloakbrowser` 里已经有内核时才启动 Cloak，否则留在 Playwright Chromium。`install-browser` 只从 `CLOAKBROWSER_DOWNLOAD_URL` 下载，并且 `CLOAKBROWSER_SHA256` 必须对上。没有内置镜像。`UI_PILOT_BROWSER=chromium` 强制用 Chromium。密码框的值不会发给模型。
- **生成的用例可以不再叫决策模型。** YAML、Markdown 和 API 用例用 `{role, name, nth, within}` 描述目标，再对着当前索引解析，iframe 里的控件也走同一条定位。`generate` 在每一步成功后把这份 YAML 写盘。`--verify` 再用 `run` 回放该文件。
- **结果由页面上看得见的证据决定。** 规划器把完成条件写成页面上必须出现的 `done_when`。模型返回 `DONE` 时，只有该证据可见才算通过。断言失败后 teardown 仍会执行。HTML 报告保留带标记的截图、步骤耗时、token 用量和当次录像。

## 架构

```mermaid
flowchart TD
  cli["codexqa-jev-browser"] --> session["BrowserSession"]
  session --> engine{"browser.engine"}
  engine -->|"auto 且已安装 Cloak"| cloak["Cloak：指纹、语言、GeoIP"]
  engine -->|"chromium 或没有 Cloak"| chromium["Playwright Chromium"]
  cloak --> page["页面与 iframe"]
  chromium --> page
  page --> snap["snapshot.dom.js"]
  snap --> idx["索引：role、name、value、操作、within、节点 id"]

  idx --> observeCmd["observe：打印索引表"]
  idx --> runPath["run"]
  idx --> goalPath["auto 与 generate"]
  idx --> explorePath["explore"]

  runPath --> cases["YAML、Markdown 或 API 用例"]
  cases --> sem["按 role / name / nth / within 匹配"]
  sem --> act["对 data-codexqa-jev-browser-id 执行动作"]
  cases --> side["http 准备，以及 URL、标题、文本、JSON 断言"]

  goalPath --> plan["规划器：步骤和可见的 done_when"]
  plan --> space["动作空间，去掉已填过的字段"]
  space --> pick{"决策来源"}
  pick -->|"--decisions"| script["脚本给出的操作和索引"]
  pick -->|"TYPESAFE_API_KEY"| jev["Jev /systemone 选择题"]
  pick -->|"其余情况"| oai["兼容 OpenAI 的 JSON"]
  script --> gate["只保留已提供的操作和索引"]
  jev --> gate
  oai --> gate
  gate --> act
  act --> effect["效果判断：Jev 的 pass/fail，否则本地前后对比"]
  goalPath --> done["DONE 仅在 done_when 可见时通过"]
  goalPath --> yaml["generate 每成功一步就写入语义 YAML"]
  yaml --> verify["--verify 交给 run 回放"]

  explorePath --> crawl["状态图；跳过退出、删除、支付"]
  crawl --> graph["explore-graph.json 与编译出的用例"]

  act --> report["report.html、report.json、report.md、带标记截图、录像"]
  side --> report
  done --> report
  graph --> report
```

`observe`、`run`、`explore` 和 `--decisions` 停在索引和执行器。现场的 `auto` 和 `generate --goal` 才加上规划器和决策来源。`generate` 把通过的轨迹编译回执行器可以单独回放的用例。

决策已经给出文字时，输入用那段文字。否则由一个较小的对话模型给出该字段要键入的字符，并带上 `knowledge/<app>/` 里命中的笔记。点哪一个控件仍由索引上的节点 id 决定。

## 安装

```bash
npm install
cp .env.example .env   # 现场 auto / generate --goal 才需要
```

只有在你有权使用的镜像上，才下载可选的 Cloak：

```bash
# CLOAKBROWSER_DOWNLOAD_URL=https://example.com/cloakbrowser
# CLOAKBROWSER_SHA256=<64 位十六进制>
npx codexqa-jev-browser install-browser
```

GeoIP 单独配置：`CLOAKBROWSER_GEOIP_URL` 和 `CLOAKBROWSER_GEOIP_SHA256`。没有再分发许可的数据库不要填进这两个变量。文件落在 `~/.cloakbrowser`。模型请求只走你自己设置的 `HTTPS_PROXY`。

需要 Node.js 20 或更高版本。

## 模型

CLI 自己调用 Jev 或兼容 OpenAI 的接口。宿主里的 Cursor / Codex 会话不是决策模型。

| 调用 | 时机 | 密钥 |
| --- | --- | --- |
| Jev `/systemone` | 每步的操作与目标，以及这一步是否生效 | `TYPESAFE_API_KEY`。可选：`TYPESAFE_MODEL`（`jev-latest`）、`TYPESAFE_BASE_URL` |
| Chat completions | 任务规划、确认 `DONE`，以及目标语句里没有的字段文本。未配置 Jev 时也负责整步决策 | `OPENAI_API_KEY`。可选：`OPENAI_BASE_URL`、`OPENAI_MODEL`、`TEXT_MODEL` |
| 不调用 | `observe`、`run`、`explore`、`auto --decisions`、`generate --decisions` | — |

决策来源的优先级：`--decisions` 脚本，然后是已设置 `TYPESAFE_API_KEY` 时的 Jev，最后是 chat completions。`--model` 和 `--base-url` 覆盖对话模型与网关。`codexqa-jev-browser.config.yaml` 可以用 `${OPENAI_API_KEY}` 这种占位符。CLI 先加载当前目录的 `.env`，再在需要时加载仓库根目录的 `.env`，且不覆盖 shell 里已经存在的变量。不要传 `--api-key`，也不要把原始密钥写进用例文件。

即使每一步点击由 Jev 选择，现场 `auto` / `generate --goal` 的规划器仍然需要 `OPENAI_API_KEY`。

## 命令

```bash
npx codexqa-jev-browser observe examples/app/index.html
npx codexqa-jev-browser run cases/examples/search-docs.yaml cases/examples/login.yaml
npx codexqa-jev-browser run cases/examples/search-docs.md
npx codexqa-jev-browser run --from-api https://qa.example.com/cases
npx codexqa-jev-browser auto --url examples/app/index.html --goal '搜索 Pilot 并打开文档' \
  --decisions cases/scripts/decisions-search.yaml
npx codexqa-jev-browser generate --url examples/app/index.html --goal '搜索 Pilot 并打开文档' \
  --decisions cases/scripts/decisions-search.yaml --out generated/search.yaml --md --verify
npx codexqa-jev-browser explore --url examples/app/index.html --out generated/explore
```

默认显示浏览器窗口。`browser.headless: true` 会隐藏窗口。`--headed` 强制显示。`--no-screenshots` 跳过截图。

报告写在 `reports/<run-id>/report.html`。`report.json` 是机器可读副本，`report.md` 是短摘要。用例失败时进程以非零状态退出。

## 可移植 skill

本目录就是 skill。`SKILL.md` 和 CLI 放在一起。

```bash
npx skills add openqa-cn/codexqa --skill codexqa-jev-browser
```

任何能跑 shell 的 Agent 都使用同一套 CLI。这个 skill 不调用厂商专用的浏览器工具。

步骤和动词见 [references/schema.md](references/schema.md)。示例见 [references/examples.md](references/examples.md)。

## 测试

```bash
npm test
```

测试是离线的。通过只说明引擎与夹具一致，不能说明真实站点或现场模型会成功。
