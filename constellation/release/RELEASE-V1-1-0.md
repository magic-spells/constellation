---
name: v1.1.0 — the viewer on puzzle 0.8
status: building
version: 1.1.0
connections:
  - RELEASE-V1-0-2
---

Theme: the viewer catches up with puzzle 0.8 — a framed shell, a search that grows into the palette, a three-mode appearance picker, a layout that works on a phone, and every label in eleven languages ([[FEATURE-VIEWER-I18N]]). It also switches between connected repos' plans, and working memory gains per-repo settings.

## Upgrade notes

Minor. The plan format is unchanged.

- **Security fixes.** Through 1.0.x any web page open in the same browser could write cards (a cross-site form POST, or DNS rebinding); `serve` now requires a loopback `Host` on every request and a same-server `Origin` on every write ([[DECISION-SERVE-REQUEST-GUARD]], #43). A cloned repo could also steer reads and writes outside itself through `code_root` or committed symlinks; `code_root` is now bounded to the repo and working memory never follows a link (#45, [[FEATURE-WORKING-MEMORY-SETTINGS]]).
- **Viewing through a proxy or a forwarded port** (`puzzle dev`, `ssh -L`, VS Code) now needs `serve --dev-origin http://localhost:<port>`; without it those requests get 403.
- **An out-of-repo `code_root` is ignored.** If PLAN-PROJECT's `code_root` realpaths outside the plan's git repo, the default root (the folder holding `constellation/`) is used instead, and working memory refuses with `UNSAFE_PATH`.
- **Symlinks refuse working-memory setup.** A symlinked `.gitignore`, `.constellation/` or `.claude/` (or `.claude/settings.json`) now fails with `UNSAFE_PATH` instead of being followed. A symlinked `.constellation/config.json` is ignored with a warning and defaults apply.
- **A repo that commits its `.constellation/` working files gets `UNTRUSTED_WORKING`**: the folder is not read, cleared or written until the files are untracked (`git rm --cached -r .constellation`). A tracked `CLAUDE.md` alone (the 1.0 layout) still works, with a warning.
- **`.gitignore`:** the 1.0 pair (`.constellation/*` + `!.constellation/CLAUDE.md`) becomes one `.constellation/` line, migrated in place by `working_init` or `constellation working install-hook`. `.constellation/CLAUDE.md` is no longer committed. If it is already tracked you get a warning with the `git rm --cached -r .constellation` command; nothing is untracked for you.
- **`init_plan { working: false }`** still means "skip working memory" and writes no config. To record the user's answer, pass `working_enabled` (and `new_session`) instead.
- **Workspaces:** `serve` also serves the plans of the root plan's `connected_repos`, one level deep ([[FEATURE-WORKSPACE-SWITCHER]]). The rail's project name is now the switcher, and the tab reads `<project> · <page>`.
- **Languages:** the viewer speaks English, Spanish, German, French, Italian, Japanese, Simplified Chinese, Brazilian and European Portuguese, Dutch and Korean. On the first visit it picks from the browser's languages (else English); a choice from the globe button in the header switches at once and is remembered. Plan content — names, bodies, handles, frontmatter — is never translated.
- **Appearance choices carry over.** The old `constellation-scheme` / `constellation-theme` keys are migrated once into `constellation:appearance` and removed.
- **New medium mode** beside light and dark; System still follows the OS between those two.
- **Observatory dark is retuned** to the pieces depth order: the frame and page are now the darkest layer (`#03040a`, was `#07080f`), with the card-list pane, work panel, cards and raised surfaces each a step lighter ([[STYLE-COLORS]]). Light and medium look the same; Observatory is still the default scheme.
- **Phones:** below `md` a menu button opens the navigation drawer, and a folder shows its list or one card, never both.
