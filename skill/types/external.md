# EXTERNAL cards (`EXTERNAL-`, `external/`)

One card per external service. Suggested `kind`: `saas-vendor`, `cloud-infra`,
`external-microservice`, `hardware-peripheral`.

| Field | Type | Notes |
|---|---|---|
| `vendor` | string | e.g. `Stripe`, `Postmark` |
| `purpose` | string | what it's used for |
| `docs_url` | string | |
| `status_url` | string | |
| `credentials_envs` | string[] | env var **names** only — never values |

Example — `constellation/external/EXTERNAL-EMAIL-PROVIDER.md`:

```markdown
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

All outbound email goes through Postmark. This app only sends template IDs and
variables, never raw HTML.
```
