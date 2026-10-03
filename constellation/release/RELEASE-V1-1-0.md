---
name: v1.1.0 — the viewer on puzzle 0.8
status: building
version: 1.1.0
connections:
  - RELEASE-V1-0-2
---

Theme: the viewer catches up with puzzle 0.8 — a framed shell, a search that grows into the palette, a three-mode appearance picker, and a layout that works on a phone. It also switches between connected repos' plans, and working memory gains per-repo settings.

## Upgrade notes

Minor. The plan format is unchanged.

- **Security fix for the local server.** Through 1.0.x any web page open in the same browser could write cards (a cross-site form POST, or DNS rebinding). `serve` now requires a loopback `Host` on every request and a same-server `Origin` on every write ([[DECISION-SERVE-REQUEST-GUARD]]).
- **Viewing through a proxy or a forwarded port** (`puzzle dev`, `ssh -L`, VS Code) now needs `serve --dev-origin http://localhost:<port>`; without it those requests get 403.
- **`.gitignore`:** the 1.0 pair (`.constellation/*` + `!.constellation/CLAUDE.md`) becomes one `.constellation/` line, migrated in place by `working_init` or `constellation working install-hook`. `.constellation/CLAUDE.md` is no longer committed. If it is already tracked you get a warning with the `git rm --cached -r .constellation` command; nothing is untracked for you.
- **`init_plan { working: false }`** still means "skip working memory" and writes no config. To record the user's answer, pass `working_enabled` (and `new_session`) instead.
- **Workspaces:** `serve` also serves the plans of the root plan's `connected_repos`, one level deep ([[FEATURE-WORKSPACE-SWITCHER]]). The rail's project name is now the switcher, and the tab reads `<project> · <page>`.
- **Appearance choices carry over.** The old `constellation-scheme` / `constellation-theme` keys are migrated once into `constellation:appearance` and removed.
- **New medium mode** beside light and dark; System still follows the OS between those two.
- **Observatory is unchanged** — the same 30 values, still the default scheme.
- **Phones:** below `md` a menu button opens the navigation drawer, and a folder shows its list or one card, never both.
