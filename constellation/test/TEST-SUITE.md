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
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:53.800Z'
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
  - kind: verified
    text: >-
      Green at 485. Two new lanes: a real-binary integration test that occupies a port and reads
      serve's banner (confirmed to fail against the old refuse-and-exit code), and unit tests over
      applySkillPickerKey — the picker's terminal plumbing needs a pty, so the escape codes and
      wrap-around are covered as a pure reducer instead.
    sha: b68341fab1d50f297248b83eccc2f936ad6b9234
  - kind: verified
    text: 'Full npm test run passed at this sha: 54 files, 645 tests.'
    sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
  - kind: gotcha
    text: >-
      The pzl vitest plugin resolved a compiler path that stopped existing when the puzzle repo went
      monorepo, so 12 viewer test files failed to LOAD and the suite still reported green — 162
      tests silently not running. A `.pzl` import failure is quiet; check the file/test counts
      against the last verified note before trusting a green run.
---

The vitest suite (600+ tests): core unit tests, MCP integration via an in-memory client, and git-backed drift/security tests. The golden plan `examples/constellation/` doubles as a fixture and must lint clean (0 errors). Exercises [[FILE-LINT]], [[FILE-INDEXER]], [[FILE-MCP-SERVER]].

`tests/viewer/` covers the Puzzle viewer: plain-JS lib tests plus a `.pzl` component lane — `tests/viewer/pzl-vitest-plugin.js` runs the local Puzzle checkout's `pzlc` compiler through Go for each imported `.pzl`. The lane therefore requires both Go and that checkout (`PUZZLE_REPO` overrides its location); without the compiler the plugin is inert and `.pzl` imports fail at load time — not as red tests.
