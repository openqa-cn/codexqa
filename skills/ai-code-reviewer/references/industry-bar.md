# Industry quality bar (graph-backed review)

Compressed bar for this skill. A review that skips these fails the bar even if prose looks polished.

## What top systems do

1. **Graph-first, not diff-only** — Cross-file contract breaks are invisible in patch-only review. Require blast radius from the symbol graph.
2. **Relational facts before opinions** — Answer graph questions first, then reason about logic/security on the patch.
3. **Auditable evidence** — Findings cite symbol ids, paths, edges. Incomplete graph → `UNKNOWN` / lower confidence; never fake green.
4. **Multi-language via one index** — Parser/index layer (CodexQA) owns languages; this skill consumes `summary.lang_stats` and graph JSON.
5. **Multi-dimension pipeline** — Design fit → Complexity → Dependencies → Correctness → Resilience → security/sensitive → Privacy → API/contract → Change/rollout → regression/test gaps → observability → maintainability → **performance** ([dimension-registry.md](dimension-registry.md)).
6. **Human merge gate** — Skill advises; humans decide.
7. **Blast-radius risk tier (pre-pipeline)** — Assign T0–T3 from paths + tags + sensitive + rollout surfaces **before** deep review; auth/pay/migration/IaC force T0 and full evidence floor ([dimensions/risk-tier.md](dimensions/risk-tier.md), `20-risk-tier.json`). Model: [ShipWithAI Part 2](https://shipwithai.io/blog/reviewing-ai-generated-pull-requests-2026--part2--senior-dev--en/) (blast ≠ size; path triage; highest-wins) + [Part 3](https://shipwithai.io/blog/reviewing-ai-generated-pull-requests-2026--part3--senior-dev--en/) (encode tiers in automation, not LLM self-label). Converges with GitHub path Rulesets / CODEOWNERS for critical paths — not “exists ⇒ best,” but finite read-budget + under-escalation failure mode.
8. **Performance pathology signatures** — Hot path / N+1 / unbounded allocation via local heuristics (`21-performance-signals.json`); fix-on-sight known pathologies ([n1detect](https://github.com/renaldid/n1detect), [Roslyn CI0011](https://blog.rogatnev.net/posts/en/2026/08/N-Plus-One-Problem.html), [QueryPerf](https://github.com/NetizenLabs/queryperf), [sota-performance](https://github.com/martinholovsky/sota-skills/blob/main/skills/sota-performance/SKILL.md)) — not profiler theater or maintainability TODO smells.

## Five graph questions (must attempt in PR mode)

| Question | Pass criteria | CodexQA evidence |
|---|---|---|
| Public surface drift | External callers of changed symbols listed; unchecked callers flagged | `edges --direction in`, `reach --direction in` |
| Coverage gap | Changed production symbols with no `tests` edges listed | `tested_count`, `reach --edge-kinds tests` |
| Trust / entry reachability | Paths from HTTP/RPC/MQ/task entries to changed symbols when tags exist | `07-tags.json`, `impact/*/paths/`, `reach` to `from_count==0` |
| Sensitive path hit | Auth/token/pay/secret hits on changed or high fan-in symbols escalated | `06-sensitive-hits.json`, then callers |
| Hot-but-thin | Changed symbols with `tested_count==0` escalated when entry-reachable or evidenced by edges-in; under high stubs do not treat `from_count` as real fan-in size | `08-hot-but-thin.json` + `impact/*/edges-in.json` |

## Disqualifiers (rewrite)

- Product-style scoring / marketing fluff with no graph cites
- Impact claims from README or intuition only
- “Covered by tests” based only on test directory names
- Mermaid inventing modules/edges not in the pack
- Completing PR review without `--diff-base` evidence (all `default`)

## Alignment checklist (pre-delivery)

- [ ] Evidence pack validated
- [ ] Risk tier locked from `20-risk-tier.json` (T0–T3) before dimension depth; auth/pay/migration/IaC → T0 evidence floor ([dimensions/risk-tier.md](dimensions/risk-tier.md))
- [ ] Design fit evaluated in four subsections into conclusion (Belong / Layer / Over-engineering / Timing); report/HTML shows only concern/unknown subsections via `10-design-fit-signals.json` / [dimensions/design-fit.md](dimensions/design-fit.md)
- [ ] Complexity evaluated into conclusion (ok/none allowed); report/HTML only if concern via `11-complexity-signals.json` / [dimensions/complexity.md](dimensions/complexity.md)
- [ ] Dependencies / supply chain evaluated (ok/none allowed); report/HTML only if concern via `12-dependency-signals.json` / [dimensions/dependencies.md](dimensions/dependencies.md)
- [ ] Resilience / error handling evaluated (ok/none allowed); report/HTML only if concern via `14-resilience-signals.json` / [dimensions/resilience.md](dimensions/resilience.md)
- [ ] Privacy / compliance evaluated (ok/none allowed); report/HTML only if concern via `13-privacy-signals.json` / [dimensions/privacy.md](dimensions/privacy.md)
- [ ] Change / rollout evaluated (ok/none allowed); report/HTML only if concern via `15-rollout-signals.json` / [dimensions/rollout.md](dimensions/rollout.md)
- [ ] Observability covered (or explicit None) via `16-observability-signals.json` / [dimensions/observability.md](dimensions/observability.md)
- [ ] Contract / XSS sinks covered (or explicit None) via `17-contract-signals.json` / [dimensions/contract.md](dimensions/contract.md)
- [ ] Maintainability covered (or explicit None) via `18-maintainability-signals.json` / [dimensions/maintainability.md](dimensions/maintainability.md)
- [ ] Performance covered (or explicit None) via `21-performance-signals.json` / [dimensions/performance.md](dimensions/performance.md) — N+1 / hot-path / unbounded alloc
- [ ] Hot-but-thin `equals` / `hashCode` / `compare*` bodies read from diffs ([dimensions/correctness-family-checks.md](dimensions/correctness-family-checks.md))
- [ ] Top change groups reviewed via `symbol-diff` artifacts
- [ ] Callers / entries listed for high-risk changes
- [ ] Test gaps use `tests` edges, not path heuristics alone
- [ ] Sensitive hits investigated or marked absent
- [ ] Confidence reduced if stats show many stubs/collisions
- [ ] At least one evidence Mermaid with real nodes/edges from pack
- [ ] P0/P1/P2 with fix guidance; residual risks explicit
