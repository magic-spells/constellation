---
name: mcp/search.ts
status: built
path: src/mcp/search.ts
language: typescript
summary: Scored full-text search
connections:
  - FILE-MCP-SERVER
  - DOC-MCP-SERVER
---

Matching is **AND**: every significant term in the query must appear on the card, so a
natural-language question stops ranking half the plan. Common words are dropped (and the raw
tokens are kept when a query is nothing but stopwords), edge punctuation is trimmed so
`API-TICKETS,` still hits the handle, and a `"double-quoted run"` is one verbatim needle.

The searchable text is handle, name, kind/type, the binding frontmatter (`summary`, `path`,
`code_refs`) and the body plus appended notes — so `search src/core/stale.ts` finds the card
bound to that file, and recorded memory stays findable (notes are indexed as `note(kind):
text` lines). Scoring only ORDERS the cards that already matched: handle ≫ name > kind/type >
occurrences. The excerpt is the first matching line, frontmatter lines included.

