---
name: serve/server.ts
status: verified
path: src/serve/server.ts
language: typescript
summary: Local HTTP server for the viewer
connections:
  - FILE-WRITER
  - FILE-SYNC
  - PAGE-VIEWER-HOME
verified_at: '2026-08-18T17:56:53.033Z'
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
notes:
  - kind: verified
    text: >-
      Re-read against server.ts: the only delta since the last baseline is repo_url on GET
      /api/plan, resolved once and memoised for the server's lifetime. Now documented, including the
      null case rendering no link.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
  - kind: verified
    text: >-
      server.ts itself is unchanged — the port walk is CLI policy ([[FILE-CLI]]), which is why
      startServer still takes one port and rejects on EADDRINUSE. Nothing this card claims moved.
    sha: b68341fab1d50f297248b83eccc2f936ad6b9234
  - kind: verified
    text: >-
      Verified the current HTTP surface, including compiled docs, atlas metrics/config, STYLE
      assets, readonly write guards, and the five-second metrics cache with plan-watch invalidation.
    sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
---

Serves `viewer/dist`, a read API, and a PATCH/POST/DELETE write API (with `if_mtime` stale-write guard), watching files for live reload. Shares the byte-preserving writer with the MCP path. `DELETE /api/card/PLAN-PROJECT` is refused (400 `INVALID_HANDLE`) — same guard as MCP `delete_card`.

Specialized reads stay thin over the core modules: `GET /api/docs` compiles the ordered document and prepares body headings; `GET /api/atlas-metrics` returns [[FILE-CODE]]'s bound-code sizes; `GET /api/atlas-config` returns authored atlas placement; and `GET /api/style-asset` serves contained font files for STYLE specimens. Atlas metrics are cached for five seconds and invalidated immediately by the plan watcher, because code edits sit outside that watch root.

`PUT /api/atlas-config` validates and writes the authored config through `src/core/atlas-config.ts`; it is covered by the same `--readonly` guard as card and sync writes. Derived atlas geometry is never persisted.

`GET /api/plan` carries `repo_url` alongside the cards: the repo's `origin` as a browsable https URL ([[FILE-GIT]]'s `repoRemoteUrl`), which the viewer's topbar renders as a GitHub link. Resolved **once, lazily** and memoised for the server's lifetime rather than per request — a remote cannot change under a running server, and shelling out to git on every plan load would tax the hot read path. Null (no remote, no repo, non-http) simply renders no link.

`POST /api/sync-point` stamps the sync marker at HEAD — the same write as the MCP `set_sync_point`, so [[PAGE-VIEWER-HOME]]'s health strip can baseline every claim card without dropping to the tools. It returns the recomputed status ([[FILE-SYNC]]) so the client renders the new verdict from one round trip; 409 `NO_GIT` outside a repo, 405 under `--readonly` like every other write. An optional `format_review: true` in the body closes out the one-time format-upgrade review in the same call — the same field `set_sync_point` stamps, so the viewer can silence the prompt without dropping to the tools. The body is optional; an empty POST behaves as before.
