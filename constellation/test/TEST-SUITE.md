---
name: Test suite (vitest)
kind: integration
status: built
code_refs:
  - tests
---

The vitest suite (270 tests): core unit tests, MCP integration via an in-memory client, and git-backed drift/security tests. The golden plan `examples/constellation/` doubles as a fixture and must lint clean (0 errors). Exercises [[FILE-LINT]], [[FILE-INDEXER]], [[FILE-MCP-SERVER]].

`tests/viewer/` covers the Puzzle viewer ([[DECISION-VIEWER-FRAMEWORK]]): plain-JS lib tests plus a `.pzl` component lane — `tests/viewer/pzl-vitest-plugin.js` compiles `.pzl` imports on demand with the `pzlc` binary from a local Puzzle checkout, and goes inert (skipping those tests) when that checkout is absent.
