# Experience store integration

Used by `pipeline.ts` / `select_tool.ts` / `cache_tool_binding.ts`. Local `tool-binding-cache.json` is L1 (requirement-scoped). The experience store is L0 (workspace or remote).

```
L1 local cache (tool-binding-cache.json)
    ^ backfill                 ^ report
L0 experience_store (local JSON or HTTP)
    fetch / report / feedback
```

## fetch

Warm the cache from `pipeline.ts` / `select_tool.ts` on lookup miss.

```bash
node scripts/cache_tool_binding.ts experience-fetch \
  --cache <CACHE_PATH> \
  --queries '[{"key":"catalog-product::create","type":"entity","query_text":"create catalog product"}]' \
  [--domain <domain>] [--top-k 3]
```

Proven hits are written back to L1. Keep `experience_id` for later feedback. Unreachable store must not block the main flow.

## report

After L1 promote:

```bash
node scripts/cache_tool_binding.ts experience-report \
  --cache <CACHE_PATH> \
  --type entity \
  --key "KEY" \
  --contributor "<contributor>"
```

## feedback

```bash
node scripts/cache_tool_binding.ts experience-feedback \
  --experience-id "UUID" \
  --outcome success \
  --contributor "<contributor>"
```

Do not store tokens or personal identifiers in proven examples.
