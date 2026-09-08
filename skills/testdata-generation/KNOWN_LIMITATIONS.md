# Known limitations and failure cases

[简体中文](KNOWN_LIMITATIONS.zh-CN.md)

Every entry here is something visible in the code or observed while running the skill, not a defensive disclaimer. If you are evaluating this pack, this page is more useful than the feature list. Read [how it works](HOW_IT_WORKS.md) first for the design context.

## The default backend is a mock, so "construct succeeded" can mean very little

Out of the box, executors point at `DATA_BUILD_API_BASE`, which defaults to `http://127.0.0.1:8765` — the bundled `slots/mock_server.ts`. The mock hands back `p_1`, `o_1`, `d_1` and appends to `testdata/mock-store.json`. That is enough to exercise routing, scene ordering, and writeback, and it is *not* evidence that anything landed in a real system.

Nothing in the skill distinguishes a mock ID from a production one, so a case document written against the mock looks exactly like one written against a staging gateway. Before trusting a `case-executable.md`, confirm which base URL produced it.

## Application source is not an input

There is no clone/diff step and no `code/` directory. A repository of the system
under test will not be read to recover endpoints, table names, or IDs. If you
only have source and no case pack / OpenAPI / `planId` / `serviceId`, the skill
has nothing to construct from — that is a missing-material stop, not a cue to
invent an API from the code.

## Without an API source, the skill stops rather than improvises

Step 4 writes a construction script only from a discovered API. If the workspace has no OpenAPI directory, no `planId`, and no `serviceId`, the skill is designed to stop and ask instead of guessing endpoints. This is deliberate — an invented endpoint produces a script that fails late and looks authoritative — but it does mean the fully autonomous path is unavailable in a bare repository. Supply one of the three, or drop a slot under `slots/`.

The same applies to business identifiers throughout: core IDs the user supplied are reused verbatim and never rewritten, and missing ones are asked for. Optional fields fall back to executor defaults, which is why a construct can succeed with values you did not choose.

## Cross-domain scenes cannot bootstrap their upstream material

`ready-to-sell` in the distribution slot needs a `productId` that only the catalog domain can produce. The scene does not reach across domains on its own; without an ID in context it asks. Multi-domain flows therefore need either an existing ID or an explicit catalog run first, and a scene that is interrupted for material must be resumed rather than restarted, or the earlier steps run twice.

## Retrieval quality bounds steps 1 and 2

Skill search and the tool registry are semantic lookups over descriptions. Two known consequences:

- Keyword input must be one or two business nouns. Verb phrases like "help me construct" degrade the match badly enough that the script falls back to a full marketplace scan.
- Pinned favorites are returned unconditionally and judged for relevance by the model, not filtered by the script. A stale pin stays at the top of the candidate list until it is removed with `favorites.ts rm`.

Proven methods have a third failure mode: a recorded invocation can be semantically right but no longer executable, because the bound tool moved or a required parameter is absent from the current context. The three-part applicability check exists for that, and skipping a proven row is normal rather than an error.

## The case pipeline needs a host that honours its exit codes

`pipeline.ts` is a resumable state machine, not a single command. It exits 10 / 11 / 12 to request a specific Agent, 20 to force a blocking decision, and expects the host to merge a patch and `--resume`. A host that treats a non-zero exit as failure will abandon a run mid-way, leaving a partial `manifest.json` on disk. The lint gate loops at most three rounds before handing the decision to the user, so a persistently low-confidence case ends in a prompt rather than a clean artifact.

## Enterprise adapters are contracts, not verified integrations

Every platform concern — skill marketplace, tool registry, API catalog, experience store, auth, SQL, config, feature flags, document source, case writeback, workspace context — is an adapter with a local default. The local implementations are what the examples and verification scripts exercise. The HTTP implementations follow the contracts in [references/adapters.md](references/adapters.md), but the pack ships no credentials and cannot verify any particular vendor's gateway. Treat a new `type: http` adapter as unproven until you have run one construct end to end through it.

Feature flags default to `noop`. When they are not configured, the skill declines flag writes rather than falling back to raw HTTP.

## Demo defaults age

The bundled catalog executors carry demo defaults (`city=demo-city`, `quantity=1`, `credits=1000`, and a fulfill-on date derived from the current date). They exist so the mock flow runs with a single required field, and they are not meant to be realistic business values. Override them explicitly for anything that matters.
