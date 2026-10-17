---
name: The local server checks Host and Origin, not a token
status: built
connections:
  - FILE-SERVE
  - FILE-CLI
  - FILE-WRITER
  - FEATURE-WORKSPACE-SWITCHER
notes:
  - kind: state
    text: >-
      #45 bounds `code_root` for every reader, not just connected plans: `resolveCodeRoot` falls
      back to the default root when `code_root` realpaths outside the plan's repo, so style assets,
      code attach, stale_report, assemble and sync can't be steered out of the repo by a cloned
      plan.md (FILE-REPOS).
---

# The local server checks Host and Origin, not a token

## Context

`serve` listens on loopback, but any page open in the same browser can reach it: a cross-site `text/plain` POST needs no preflight, and a DNS-rebound hostname makes the server look same-origin. Through 1.0.x that let any website write cards. Serving connected repos' plans ([[FEATURE-WORKSPACE-SWITCHER]]) widened the blast radius, so 1.1.0 closes it.

## Decision

- **Every request** must carry a `Host` naming this loopback server on its bound port (`localhost`, `127.0.0.1`, `[::1]`). A rebound name never does. Refusals are 403 `FORBIDDEN`.
- **Every write** (POST/PUT/PATCH/DELETE) must also carry a same-server `Origin`. Browsers send it on every non-GET request and a cross-site page cannot forge it.
- **`--dev-origin http://localhost:<port>` is the one exception**: it admits that port's Host and Origin, loopback http only. It exists for the `puzzle dev` proxy and forwarded ports (`ssh -L`, VS Code), which pass the browser's Host and Origin through unchanged. `serve:examples` passes it for `dev:viewer`, which pins port 3000 with `--strict-port`.
- **Containment on realpaths**, not lexical paths: style assets are checked against the root's realpath, a new card cannot be written through a symlinked type folder ([[FILE-WRITER]]), and `.sync.json` is written temp + rename so a symlink is replaced, never written through.

## Alternatives

- **A per-launch token** in the URL or a cookie: rejected. Every bookmark, deep link and `start_viewer` URL would need it, and the browser-sent headers already identify the caller.
- **Origin check alone:** rejected. It leaves reads open to DNS rebinding.
- **Trusting any loopback Host:** rejected. A proxy on another local port would get write access without anyone choosing it. `--dev-origin` names that port on purpose.

## Consequences

- Viewing through a proxy or a forwarded port without `--dev-origin` fails with 403. The fix is in `serve --help` and the README.
- Non-browser clients (curl, scripts) must send a matching `Host`, and an `Origin` for writes.
