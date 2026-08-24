---
name: mcp/search.ts
status: verified
path: src/mcp/search.ts
language: typescript
summary: Scored full-text search
connections:
  - FILE-MCP-SERVER
  - DOC-MCP-SERVER
verified_sha: 2757d7de40f8f234c01bd7369c6fbfa85f23bcbb
verified_at: '2026-08-24T20:08:33.147Z'
notes:
  - kind: gotcha
    text: >-
      `unmatched_terms` must be computed BEFORE the type filter prunes candidates. Computed after, a
      filtered search reports a term as absent from the plan when it is merely absent from the
      filtered types — which coaches an agent to drop its most discriminating word. Caught in
      review, not by a failing test.
---

Matching is **AND first**: every significant term must appear on the card, so a
natural-language question stops ranking half the plan. When no card carries every term the
same needles retry as **OR** — ranked by how many each card matched, returned with
`relaxed: true` and the needles no card in the plan carries. An over-specified query lands
on the neighborhood instead of a bare zero — the dead end that taught agents to
under-specify.
`searchPlan` is that fallback path; `searchCards` stays strict, unchanged for its existing
callers. Common words are dropped (and the raw tokens are kept when a query is nothing but
stopwords), edge punctuation is trimmed so `API-TICKETS,` still hits the handle, and a
`"double-quoted run"` is one verbatim needle.

The searchable text is handle, name, kind/type, the binding frontmatter (`summary`, `path`,
`code_refs`) and the body plus appended notes — so `search src/core/stale.ts` finds the card
bound to that file, and recorded memory stays findable (notes are indexed as `note(kind):
text` lines). Scoring only ORDERS the cards that already matched: handle ≫ name > kind/type >
occurrences. The excerpt is the first matching line, frontmatter lines included.
