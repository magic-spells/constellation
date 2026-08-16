---
name: Test suite (vitest)
kind: integration
status: verified
code_refs:
  - tests
connections:
  - FILE-LINT
  - FILE-INDEXER
  - FILE-MCP-SERVER
verified_sha: 623af52933900eb27ccb1d3061a33b40a4da16ee
verified_at: '2026-08-16T02:39:04.582Z'
notes:
  - kind: verified
    text: >-
      Suite is green at this sha: 47 files, 477 tests. The tests/viewer lane grew a board case
      asserting the card links to /board/card/HANDLE and carries its data-puzzle-morph pairing id.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
---

The vitest suite (460+ tests): core unit tests, MCP integration via an in-memory client, and git-backed drift/security tests. The golden plan `examples/constellation/` doubles as a fixture and must lint clean (0 errors). Exercises [[FILE-LINT]], [[FILE-INDEXER]], [[FILE-MCP-SERVER]].

`tests/viewer/` covers the Puzzle viewer: plain-JS lib tests plus a `.pzl` component lane — `tests/viewer/pzl-vitest-plugin.js` compiles `.pzl` imports on demand with the `pzlc` binary from a local Puzzle checkout, and goes inert (skipping those tests) when that checkout is absent.
