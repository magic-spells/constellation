---
name: Puzzle viewer rebuild
release: RELEASE-V0-5-0
status: verified
connections:
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-CARD
  - PAGE-VIEWER-FEATURES
verified_at: '2026-10-17T23:06:59.192Z'
verified_sha: 31e8c158cf8d3e65de381e6fe4c145e912a7f670
notes:
  - kind: verified
    text: >-
      Claims checked one by one at this sha: puzzle ^0.6.0 + pieces.lock present, tailwind ^4.3.1,
      50 .pzl components, zero .svelte files left, 175 vendored mermaid chunks, both theme axes live
      in schemes.css. Read/write API and themes exercised directly in the running viewer.
    sha: 1412fee1bb2d1876dcade3acefe4b2202b35aaca
  - kind: state
    text: >-
      The "vendored mermaid chunks" wording in this card is history: from 1.2.0 the diagram renderer
      is Pele, vendored the same way into `viewer/app/public/vendor/pele/` (~1 MB, replacing
      mermaid's 11 MB / 291 chunks). See [[DECISION-PELE-RENDERER]].
  - kind: verified
    text: >-
      Pele renderer swap merged into release/1.2.0 (#47, 31e8c15); checked against markdown.js,
      copy-pele.mjs, styles.css and the Opus review of that diff.
    sha: 31e8c158cf8d3e65de381e6fe4c145e912a7f670
---

# Puzzle viewer rebuild

Replace the Svelte viewer with a Puzzle + puzzle-pieces + Tailwind v4 app:
same read/write API, same themes, `.pzl` single-file components, vendored
chunked mermaid build.
