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
verified_sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
verified_at: '2026-10-05T00:02:43.606Z'
notes:
  - kind: verified
    text: >-
      Corrected a stale route claim: the card said #/card/HANDLE, which has been a legacy redirect
      since routes moved to #/folder/HANDLE. Now documents the real shape plus CardPage's folder
      canonicalisation, and the redirect that keeps old links alive.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
  - kind: verified
    text: >-
      Re-checked after viewer i18n (#46), the Observatory dark retune (bbbf885) and the header
      language globe (e2004a4); card fixes in f457fd1 and 3ad1a1e.
    sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
section: viewer
order: 40
---

A single card at `#/<folder>/<HANDLE>` — the URL mirrors the file on disk, so `constellation/api/API-TICKETS.md` is `#/api/API-TICKETS`. The folder segment is decoration as far as matching goes (the handle alone identifies the card), so the view *canonicalises* a wrong one back to the card's real folder with `replace()` semantics, keeping the bad URL out of history. `#/card/<HANDLE>` still resolves as a legacy redirect, so older bookmarks and pasted links keep working.

Frontmatter fields, rendered markdown + mermaid body, connection chips in both directions (no neighborhood diagram — it duplicated the chips), and inline editing of the name, status, frontmatter fields and connections via [[COMPONENT-EDITABLE]] / [[COMPONENT-STATUS-SELECT]]. Served by [[FILE-SERVE]]; every edit affordance is gated on the plan's `editable` flag (`serve --readonly` hides them all). [[PAGE-VIEWER-BOARD]]'s preview dialog links here for the editing the dialog itself does not do.

From `md` up the card sits beside its folder's card list in a resizable split. Below `md` there is no split: a folder route shows only the list and a card route only the card, so `TypeIntro` stops auto-opening the first card there and opens it once the window widens past `md`.
