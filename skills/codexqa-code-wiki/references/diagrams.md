# Diagrams in the report

Read this file before drawing. Nodes, edges, and groups must come from this `wiki inputs` run. **Do not invent** modules or calls that were not returned.
Place each diagram in a `.diagram` slot of the HTML report ([report.md](report.md)). Chat-only Mermaid is not the deliverable.

An Archify / grouped-swimlane architecture canvas is **not** the deliverable.

## Diagram quality bar (redraw if any item is missing)

1. The first line must copy the `%%{init:...}%%` below verbatim (CodexQA paper look: light ground, ink text, green accent).
2. The end must copy the three `classDef` lines verbatim, then write `class`.
3. Architecture / risk diagrams need at least one core module `class ... risk` (high `node_count`, high `called_by`, or a hub in `deps`).
4. Isolated modules (empty `deps`) stay outside functional layers — put them in a peripheral cluster or omit them from the layer diagram and say so.
5. Architecture `subgraph` titles may only be **Entry / Application / Domain / Storage**. Put real community aliases (`P01` + rule title) inside those layers.
6. 8–15 real nodes. If there are more, keep the top N by `node_count` / dep weight and write `truncated`.
7. Label edges with the wiki kind (`deps` / `calls` / `imports` / `references`) and every edge must match this `input`.
8. Do not put a caption under the diagram. Do not drop an empty picture.

Do not use: `theme:neutral` / Material green-orange-red, plain white or cold-gray ground, navy ground, a custom palette, package names as layers, or “there are nodes” without `classDef`.

Copy this as the first line of every diagram:

```text
%%{init: {'theme':'base','themeVariables':{'background':'#f0f3f6','primaryColor':'#ffffff','primaryTextColor':'#1a2332','primaryBorderColor':'#d5dde8','lineColor':'#5a6578','secondaryColor':'#e6f4ee','tertiaryColor':'#f0f3f6','clusterBkg':'#f8fafc','clusterBorder':'#d5dde8','fontFamily':'Segoe UI,PingFang SC,sans-serif'}}}%%
```

## Which diagram for which scenario

| Scenario | Draw | Mermaid type |
|---|---|---|
| Map the repository | Community map: pages + `deps` | `flowchart LR` |
| Map the repository (layered) | Entry / Application / Domain / Storage | `flowchart TB` + `subgraph` |
| Explain one module | In-module `call_chain` / visualization `flow` | `flowchart TB` |
| Explain one module (neighbors) | This page + `cross_community` / `dependencies` | `flowchart LR` |
| Reading guide | Ordered path along real deps | `flowchart LR` |

Semantic color is only these three overlays (paper + testcase-generator accent colors, light fill / dark text):

| class | When | Color |
|---|---|---|
| `add` | New community vs a previous wiki run (rare; skip if unknown) | olive `#E4EDD8` / `#788C5D` |
| `change` | Hub page (many `deps` or high `node_count`) | amber `#ffedd5` / `#c2410c` |
| `risk` | Core / high fan-in / sensitive name in signatures | rose `#fde8e4` / `#b42318` |

Every other node uses the default sheet fill `#ffffff`. Do not add Material green / bright orange / pure red. Copy this at the end of every diagram:

```text
classDef add fill:#e6f4ee,stroke:#0f6b4c,color:#1a2332
classDef change fill:#ffedd5,stroke:#c2410c,color:#1a2332
classDef risk fill:#fde8e4,stroke:#b42318,color:#1a2332
```

## Templates (replace nodes/edges with real `wiki inputs`; do not change init or classDef)

**Layered module map** (`architecture` `input`):

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#f0f3f6','primaryColor':'#ffffff','primaryTextColor':'#1a2332','primaryBorderColor':'#d5dde8','lineColor':'#5a6578','secondaryColor':'#e6f4ee','tertiaryColor':'#f0f3f6','clusterBkg':'#f8fafc','clusterBorder':'#d5dde8','fontFamily':'Segoe UI,PingFang SC,sans-serif'}}}%%
flowchart TB
  subgraph entry["Entry"]
    P01["P01 http-route"]
  end
  subgraph app["Application"]
    P02["P02 checkout"]
  end
  subgraph domain["Domain"]
    P03["P03 pricing"]
  end
  subgraph store["Storage"]
    P04["P04 repo-db"]
  end
  P01 -->|deps| P02
  P02 -->|deps| P03
  P03 -->|deps| P04
classDef add fill:#e6f4ee,stroke:#0f6b4c,color:#1a2332
classDef change fill:#ffedd5,stroke:#c2410c,color:#1a2332
classDef risk fill:#fde8e4,stroke:#b42318,color:#1a2332
  class P03 risk
```

**Reading guide** (consecutive steps must exist in `deps`):

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#f0f3f6','primaryColor':'#ffffff','primaryTextColor':'#1a2332','primaryBorderColor':'#d5dde8','lineColor':'#5a6578','secondaryColor':'#e6f4ee','tertiaryColor':'#f0f3f6','clusterBkg':'#f8fafc','clusterBorder':'#d5dde8','fontFamily':'Segoe UI,PingFang SC,sans-serif'}}}%%
flowchart LR
  G1["P01 http-route"]
  G2["P02 checkout"]
  G3["P03 pricing"]
  G1 -->|deps| G2
  G2 -->|deps| G3
classDef add fill:#e6f4ee,stroke:#0f6b4c,color:#1a2332
classDef change fill:#ffedd5,stroke:#c2410c,color:#1a2332
classDef risk fill:#fde8e4,stroke:#b42318,color:#1a2332
  class G3 risk
```

**In-module flow** (`page` `call_chain` or visualization `flow`):

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#f0f3f6','primaryColor':'#ffffff','primaryTextColor':'#1a2332','primaryBorderColor':'#d5dde8','lineColor':'#5a6578','secondaryColor':'#e6f4ee','tertiaryColor':'#f0f3f6','clusterBkg':'#f8fafc','clusterBorder':'#d5dde8','fontFamily':'Segoe UI,PingFang SC,sans-serif'}}}%%
flowchart TB
  Entry["handleCheckout"]
  Price["applyDiscount"]
  Store["saveOrder"]
  Entry -->|calls| Price
  Price -->|calls| Store
classDef add fill:#e6f4ee,stroke:#0f6b4c,color:#1a2332
classDef change fill:#ffedd5,stroke:#c2410c,color:#1a2332
classDef risk fill:#fde8e4,stroke:#b42318,color:#1a2332
  class Price risk
```

Do not put a caption under the diagram. Do not drop an empty picture.
