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
verified_sha: ad9102466a2b41bad67c0a46d1050e0343d0972f
verified_at: '2026-08-16T18:26:42.992Z'
notes:
  - kind: verified
    text: >-
      Suite is green at this sha: 47 files, 477 tests. The tests/viewer lane grew a board case
      asserting the card links to /board/card/HANDLE and carries its data-puzzle-morph pairing id.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
  - kind: verified
    text: >-
      Green at 479 tests. The viewer lane moved with the Tasks routes: the board case asserts
      /tasks/board/card/HANDLE, and the palette cases cover both Tasks rows plus the deliberate
      choice not to gate them on the plan having FEATURE cards.
    sha: ad9102466a2b41bad67c0a46d1050e0343d0972f
---

The vitest suite (460+ tests): core unit tests, MCP integration via an in-memory client, and git-backed drift/security tests. The golden plan `examples/constellation/` doubles as a fixture and must lint clean (0 errors). Exercises [[FILE-LINT]], [[FILE-INDEXER]], [[FILE-MCP-SERVER]].

`tests/viewer/` covers the Puzzle viewer: plain-JS lib tests plus a `.pzl` component lane — `tests/viewer/pzl-vitest-plugin.js` compiles `.pzl` imports on demand with the `pzlc` binary from a local Puzzle checkout, and goes inert (skipping those tests) when that checkout is absent.
