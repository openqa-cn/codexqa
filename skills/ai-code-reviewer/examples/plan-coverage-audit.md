# Plan coverage audit (fine-grained)

- skill_root: `skills/ai-code-reviewer`
- audited_at: 2026-09-20T12:56:13Z
- method: atomic function points × layers (I/S/T)
- plan: AI Code Reviewer (CodexQA-backed)

| ID | Function point | Layer | Verdict | Evidence |
|---|---|---|---|---|

## A. Locked decisions

| A1 | 源码位于 skills/ai-code-reviewer/ (name=ai-code-reviewer) | I | **PASS** | path exists |
| A0 | SKILL.md name: ai-code-reviewer | I | **PASS** | frontmatter name |
| A2 | 暂不安装到 skills 库 | I | **PASS** | SKILL install note |
| A3 | 禁止合入 CodexQA zip/源码 | S | **PASS** | no vendored package/source under skill |
| A4 | 图谱底座=本机 codexqa CLI | I/S | **PASS** | SKILL+scripts invoke CLI |
| A5 | 默认 PR/diff；全仓可选 | I | **PASS** | SKILL modes table |
| A6 | 证据来自 CLI JSON；禁止臆造 | I | **PASS** | hard constraints |

## B. Industry design points

| B1 | 图谱评审非 diff-only 二次草稿 | I | **PASS** | industry-bar/SKILL |
| B2 | Public surface drift 先由图回答 | I | **PASS** | industry-bar + PR prompt callers |
| B3 | Coverage gap（tests 边） | I | **PASS** | industry-bar/dimensions |
| B4 | Trust/entry reachability | I/S | **PASS** | tags+paths collection |
| B5 | Hot-but-thin（高 fan-in + tested_count==0） | I/S | **PASS** | 08-hot-but-thin.json |
| B6 | 图不完整 → UNKNOWN/降置信；禁假绿 | I | **PASS** | confidence language present |
| B7 | 多语言靠 CodexQA 解析；不重复造解析器 | I | **PASS** | lang_stats + dimensions |
| B7b | 主开发语言判定全链路（collect→profile→validate→SKILL） | I/S | **PASS** | 09-language-profile + detector |
| B8 | 多维管线：Design fit→…→Resilience→…→Observability→Maintainability | I | **PASS** | registry + review-dimensions + prompt order |
| B8b | Design fit 派生信号（0 额外 CodexQA） | I/S | **PASS** | derive + collect + card |
| B8c | Complexity 派生信号（0 额外 CodexQA） | I/S | **PASS** | derive + collect + card |
| B9 | 不做自动 merge 门禁替身 | I | **PASS** | SKILL hard constraint 5 |

## C. Capability → CodexQA CLI mapping

| C1 | 变更定位：index --diff-base → groups/symbols/symbol-diff | S | **PASS** | collect-pr |
| C2 | 爆炸半径：edges/reach/path | S | **PASS** | impact/ + paths/ |
| C3 | 入口/执行流：tag keys + tagged + reach→from_count==0 | S | **PASS** | 07-tags + paths from entries |
| C4 | 测试缺口：tested_count + tests-reach；禁目录名推断 | I/S | **PASS** | script+SKILL+dimensions |
| C5 | 敏感路径：search / symbols --name + 调用方展开 | S | **PASS** | search+symbols --name in collect-pr |
| C6 | 全仓架构：stats/summary/imports；Wiki 需用户同意 | I/S | **PASS** | fullrepo script + wiki gate |

## D. Target architecture pipeline

| D1 | PreflightGates | I/S | **PASS** | preflight in SKILL+scripts |
| D2 | CollectEvidenceCLI → ArtifactPackFiles | I | **PASS** | workflow steps 2 |
| D3 | RiskReviewReasoning from artifacts only | I | **PASS** | prompts require pack |
| D4 | Report output template | T | **PASS** | templates/review-report.md |
| D4b | HTML 结论报告（conclusion JSON + render-review-html.sh） | I/S/T | **PASS** | REVIEW-REPORT.html pipeline |
| D4c | 本地 Eval 门禁（validate-skill.sh + evals/） | I/S/T | **PASS** | skill-up substitute + fixtures |
| D4d | manifest 命名澄清（template ≠ runtime） | I/T | **PASS** | evidence-manifest schema-only |
| D5 | 落盘目录 .codexqa-review/<run-id> 或临时目录 | S | **PASS** | OUT_DIR default logic |

## E. Required directory structure

| E1 | 文件存在: SKILL.md | T | **PASS** | present |
| E2 | 文件存在: references/industry-bar.md | T | **PASS** | present |
| E3 | 文件存在: references/codexqa-cli-contract.md | T | **PASS** | present |
| E4 | 文件存在: references/review-dimensions.md | T | **PASS** | present |
| E5 | 文件存在: references/dimension-registry.md | T | **PASS** | present |
| E6 | 文件存在: references/dimensions/design-fit.md | T | **PASS** | present |
| E7 | 文件存在: references/dimensions/complexity.md | T | **PASS** | present |
| E8 | 文件存在: references/dimensions/dependencies.md | T | **PASS** | present |
| E9 | 文件存在: references/dimensions/privacy.md | T | **PASS** | present |
| E10 | 文件存在: references/dimensions/resilience.md | T | **PASS** | present |
| E11 | 文件存在: references/dimensions/rollout.md | T | **PASS** | present |
| E12 | 文件存在: references/dimensions/observability.md | T | **PASS** | present |
| E13 | 文件存在: references/dimensions/contract.md | T | **PASS** | present |
| E14 | 文件存在: references/dimensions/maintainability.md | T | **PASS** | present |
| E15 | 文件存在: references/dimensions/performance.md | T | **PASS** | present |
| E16 | 文件存在: references/dimensions/correctness-family-checks.md | T | **PASS** | present |
| E17 | 文件存在: references/mermaid-evidence.md | T | **PASS** | present |
| E18 | 文件存在: prompts/pr-diff-review.md | T | **PASS** | present |
| E19 | 文件存在: prompts/full-repo-review.md | T | **PASS** | present |
| E20 | 文件存在: templates/evidence-manifest.json | T | **PASS** | present |
| E21 | 文件存在: templates/review-report.md | T | **PASS** | present |
| E22 | 文件存在: templates/review-conclusion.json | T | **PASS** | present |
| E23 | 文件存在: scripts/collect-pr-evidence.sh | T | **PASS** | present |
| E24 | 文件存在: scripts/collect-fullrepo-evidence.sh | T | **PASS** | present |
| E25 | 文件存在: scripts/validate-evidence.sh | T | **PASS** | present |
| E26 | 文件存在: scripts/render-review-html.sh | T | **PASS** | present |
| E27 | 文件存在: scripts/lib/derive-design-fit.sh | T | **PASS** | present |
| E28 | 文件存在: scripts/lib/derive-complexity.sh | T | **PASS** | present |
| E29 | 文件存在: scripts/lib/derive-dependencies.sh | T | **PASS** | present |
| E30 | 文件存在: scripts/lib/derive-privacy.sh | T | **PASS** | present |
| E31 | 文件存在: scripts/lib/derive-resilience.sh | T | **PASS** | present |
| E32 | 文件存在: scripts/lib/derive-rollout.sh | T | **PASS** | present |
| E33 | 文件存在: scripts/lib/derive-observability.sh | T | **PASS** | present |
| E34 | 文件存在: scripts/lib/derive-contract.sh | T | **PASS** | present |
| E35 | 文件存在: scripts/lib/derive-maintainability.sh | T | **PASS** | present |
| E36 | 文件存在: scripts/lib/derive-performance.sh | T | **PASS** | present |
| E37 | 文件存在: examples/pr-review-walkthrough.md | T | **PASS** | present |

## F. PR collect-pr-evidence.sh steps (plan §证据包约定)

| F1 | 门禁：codexqa + REPO + DIFF_BASE | S | **PASS** | required args + CodexQA preflight |
| F2 | codexqa index --diff-base | S | **PASS** | index step |
| F3 | stats → 01-stats.json | S | **PASS** | present |
| F4 | 02-summary.json ← summary | S | **PASS** | present |
| F5 | 03-change-groups.json ← change-groups | S | **PASS** | present |
| F6 | 04-changed-files.json ← files --change add,change | S | **PASS** | present |
| F7 | 05-changed-symbols.json ← symbols --change add,change --kind function,method | S | **PASS** | present |
| F8 | Top N symbol-diff → diffs/<id>.diff.json | S | **PASS** | diff naming matches plan |
| F9 | impact/<id>/{edges-in,reach-in,tests-reach} | S | **PASS** | present |
| F10 | 06-sensitive + 07-tags（keys/tagged） | S | **PASS** | present |
| F11 | manifest：run-id/repo/diff-base/commands/index_quality | S | **PASS** | fields written |
| F12 | validate：空 groups 或全 default → fail | S | **PASS** | validate-evidence gates |

## G. Full-repo mode

| G1 | 全仓不强制 diff 索引 | S | **PASS** | index without --diff-base; diff_base null |
| G2 | 侧重 summary/stats/imports/high fan-in/untested hotspots | S | **PASS** | fullrepo collect |
| G3 | 全仓不伪造 change 分析 | I | **PASS** | prompts/SKILL |

## H. SKILL.md behavior design

| H1 | description 第三人称+触发词全集 | I | **PASS** | frontmatter triggers |
| H2 | disable-model-invocation omitted (trigger discoverability) | I | **PASS** | frontmatter |
| H3 | 硬规则五条（CLI/证据/门禁/引用/多语言不确定性） | I | **PASS** | hard constraints + multi-lang |
| H4 | 图谱证据包是前置必要条件（非可选上下文） | I | **PASS** | evidence-first / prerequisite |
| H5 | 默认输出九块覆盖 | I/T | **PASS** | SKILL+template+prompt |
| H6 | 全仓：热点/分层漂移/入口集中；禁产品打分 | I | **PASS** | full-repo prompt+SKILL |
| H7 | 高优 finding 附：符号/调用方/入口 path/tested_count | I | **PASS** | Deliver section |
| H8 | SKILL.md < 500 行 | I | **PASS** | lines=265 |

## I. Acceptance criteria

| I1 | 多语言仓+diff-base→证据包→PR 报告（流程可达） | I | **PASS** | scripts+prompts+template wired; runtime depends on local codexqa |
| I2 | 全仓无 diff-base 可运行且不伪造 change | I/S | **PASS** | G1+G3 |
| I3 | 仓库技能树无 CodexQA 业务源码拷贝 | S | **PASS** | clean |
| I4 | 明确区分 tests 边 vs 测试文件存在 | I/T | **PASS** | dimensions+SKILL+report |

## Summary

| Verdict | Count |
|---|---|
| PASS | 97 |
| PARTIAL | 0 |
| FAIL | 0 |
| Total FPs | 97 |

**Overall: FULL COVERAGE**

### Layer legend
- **I**: instruction/docs the agent must follow
- **S**: shell automation producing evidence
- **T**: templates / structural artifacts
