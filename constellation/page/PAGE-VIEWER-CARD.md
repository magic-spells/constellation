---
name: Viewer — card
kind: route
status: verified
code_refs:
  - viewer/app/views/CardPage.pzl
connections:
  - FILE-SERVE
  - COMPONENT-EDITABLE
  - COMPONENT-STATUS-SELECT
verified_sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
verified_at: '2026-08-16T02:34:24.705Z'
notes:
  - kind: verified
    text: >-
      Corrected a stale route claim: the card said #/card/HANDLE, which has been a legacy redirect
      since routes moved to #/folder/HANDLE. Now documents the real shape plus CardPage's folder
      canonicalisation, and the redirect that keeps old links alive.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
section: viewer
order: 40
---

A single card at `#/<folder>/<HANDLE>` — the URL mirrors the file on disk, so `constellation/api/API-TICKETS.md` is `#/api/API-TICKETS`. The folder segment is decoration as far as matching goes (the handle alone identifies the card), so the view *canonicalises* a wrong one back to the card's real folder with `replace()` semantics, keeping the bad URL out of history. `#/card/<HANDLE>` still resolves as a legacy redirect, so older bookmarks and pasted links keep working.

Frontmatter fields, rendered markdown + mermaid body, connection chips in both directions (no neighborhood diagram — it duplicated the chips), and inline editing of the name, status, frontmatter fields and connections via [[COMPONENT-EDITABLE]] / [[COMPONENT-STATUS-SELECT]]. Served by [[FILE-SERVE]]; every edit affordance is gated on the plan's `editable` flag (`serve --readonly` hides them all). [[PAGE-VIEWER-BOARD]]'s preview dialog links here for the editing the dialog itself does not do.
