---
name: Puzzle viewer rebuild
release: RELEASE-V0-5-0
status: verified
connections:
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-CARD
  - PAGE-VIEWER-FEATURES
verified_at: '2026-08-16T03:45:14.707Z'
verified_sha: 1412fee1bb2d1876dcade3acefe4b2202b35aaca
notes:
  - kind: verified
    text: >-
      Claims checked one by one at this sha: puzzle ^0.6.0 + pieces.lock present, tailwind ^4.3.1,
      50 .pzl components, zero .svelte files left, 175 vendored mermaid chunks, both theme axes live
      in schemes.css. Read/write API and themes exercised directly in the running viewer.
    sha: 1412fee1bb2d1876dcade3acefe4b2202b35aaca
---

# Puzzle viewer rebuild

Replace the Svelte viewer with a Puzzle + puzzle-pieces + Tailwind v4 app:
same read/write API, same themes, `.pzl` single-file components, vendored
chunked mermaid build.
