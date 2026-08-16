---
name: serve/server.ts
status: built
path: src/serve/server.ts
language: typescript
summary: Local HTTP server for the viewer
connections:
  - FILE-WRITER
  - FILE-SYNC
  - PAGE-VIEWER-HOME
---

Serves `viewer/dist`, a read API, and a PATCH/POST/DELETE write API (with `if_mtime` stale-write guard), watching files for live reload. Shares the byte-preserving writer with the MCP path. `DELETE /api/card/PLAN-PROJECT` is refused (400 `INVALID_HANDLE`) — same guard as MCP `delete_card`.

`GET /api/plan` carries `repo_url` alongside the cards: the repo's `origin` as a browsable https URL ([[FILE-GIT]]'s `repoRemoteUrl`), which the viewer's topbar renders as a GitHub link. Resolved **once, lazily** and memoised for the server's lifetime rather than per request — a remote cannot change under a running server, and shelling out to git on every plan load would tax the hot read path. Null (no remote, no repo, non-http) simply renders no link.

`POST /api/sync-point` stamps the sync marker at HEAD — the same write as the MCP `set_sync_point`, so [[PAGE-VIEWER-HOME]]'s health strip can baseline every claim card without dropping to the tools. It returns the recomputed status ([[FILE-SYNC]]) so the client renders the new verdict from one round trip; 409 `NO_GIT` outside a repo, 405 under `--readonly` like every other write. An optional `format_review: true` in the body closes out the one-time format-upgrade review in the same call — the same field `set_sync_point` stamps, so the viewer can silence the prompt without dropping to the tools. The body is optional; an empty POST behaves as before.
