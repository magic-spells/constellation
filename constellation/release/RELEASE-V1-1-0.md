---
name: v1.1.0 — the viewer on puzzle 0.8
status: building
version: 1.1.0
connections:
  - RELEASE-V1-0-2
---

Theme: the viewer catches up with puzzle 0.8 — a framed shell, a search that grows into the palette, a three-mode appearance picker, and a layout that works on a phone.

## Upgrade notes

Minor. No change to the CLI, the MCP tools or the plan format.

- **Appearance choices carry over.** The old `constellation-scheme` / `constellation-theme` keys are migrated once into `constellation:appearance` and removed.
- **New medium mode** beside light and dark; System still follows the OS between those two.
- **Observatory is unchanged** — the same 30 values, still the default scheme.
- **Phones:** below `md` a menu button opens the navigation drawer, and a folder shows its list or one card, never both.
