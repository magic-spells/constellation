---
name: Test suite (vitest)
kind: integration
status: built
code_refs:
  - tests
---

The vitest suite (159 tests): core unit tests, MCP integration via an in-memory client, and git-backed drift/security tests. The golden plan `examples/constellation/` doubles as a fixture and must lint clean (0 errors). Exercises [[FILE-LINT]], [[FILE-INDEXER]], [[FILE-MCP-SERVER]].
