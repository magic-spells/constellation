---
name: Puzzle viewer rebuild
release: RELEASE-V0-5-0
status: built
connections:
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-CARD
  - PAGE-VIEWER-FEATURES
---

# Puzzle viewer rebuild

Replace the Svelte viewer with a Puzzle + puzzle-pieces + Tailwind v4 app:
same read/write API, same themes, `.pzl` single-file components, vendored
chunked mermaid build.
