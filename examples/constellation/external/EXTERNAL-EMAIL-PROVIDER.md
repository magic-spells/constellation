---
name: Email provider
kind: saas-vendor
status: built
vendor: Postmark
purpose: Transactional email (ticket confirmations, assignment notices)
docs_url: https://postmarkapp.com/developer
credentials_envs:
  - POSTMARK_SERVER_TOKEN
---

All outbound email goes through Postmark. Templates live in the Postmark
dashboard; this app only sends template IDs and variables, never raw HTML.
