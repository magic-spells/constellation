---
name: Diagrams and flows
kind: reference
status: built
---

# Diagrams and flows

Three tiers, cheapest first:

1. **Derived subgraphs** — the viewer/MCP render any card's neighborhood from the real
   connection graph on demand. Never stored, never stale. The default for "what does this area
   look like."
2. **Authored Mermaid** — a DIAGRAM card whose body is a mermaid block; use handles as node IDs
   so the diagram joins the graph ([[FILE-EXTRACT]] reads them). Sequence diagrams and
   `stateDiagram-v2` work the same way in FLOW and STATE cards.
3. **Pinned layouts** — structured `nodes`/`edges`/`phases` with explicit positions in DIAGRAM
   frontmatter (`schemas/diagram.json`). Only when layout carries meaning; positions make noisy
   diffs.

**FLOW cards are linear** — steps are a numbered markdown list, nested items for error/edge
cases. Real branching belongs in a mermaid flowchart or a STATE card.
