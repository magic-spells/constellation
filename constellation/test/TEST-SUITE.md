---
name: Test suite (vitest)
kind: integration
status: built
code_refs:
  - tests
connections:
  - FILE-LINT
  - FILE-INDEXER
  - FILE-MCP-SERVER
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

The vitest suite (460+ tests): core unit tests, MCP integration via an in-memory client, and git-backed drift/security tests. The golden plan `examples/constellation/` doubles as a fixture and must lint clean (0 errors). Exercises [[FILE-LINT]], [[FILE-INDEXER]], [[FILE-MCP-SERVER]].

`tests/viewer/` covers the Puzzle viewer: plain-JS lib tests plus a `.pzl` component lane — `tests/viewer/pzl-vitest-plugin.js` compiles `.pzl` imports on demand with the `pzlc` binary from a local Puzzle checkout, and goes inert (skipping those tests) when that checkout is absent.
