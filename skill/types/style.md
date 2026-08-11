# STYLE cards (`STYLE-`, `style/`)

One card per design-token **group** — `STYLE-COLORS`, `STYLE-FONTS`,
`STYLE-TYPE-SCALE`, `STYLE-SPACING` — not one card per token, and not one card
for the whole system. `category` picks the viewer's rendering (swatches,
font specimens, sized samples, bars); `tokens` holds the values in display order.

Token values are authored here because the viewer needs them to render — this is
the one sanctioned copy of values that also live in CSS. Keep it honest the same
way as any card: bind the card to the real stylesheet/config via `code_refs` or a
connected FILE card, `set_verified` after checking, and let `stale_report` flag
when the CSS moves. The body carries what the values can't: usage rules,
do/don'ts, pairing guidance.

Fields: `category` — one of `font`, `color`, `type-scale`, `spacing`, `radius`,
`shadow`, `other`. `tokens` — list of `{name, value, description?}` plus
category extras: fonts take `role` ("Display Font"), `weights` ("Black (900)"),
`src` (repo-relative woff2/ttf so specimens render in the real font);
type-scale takes `line_height`, `weight`, `sample`.

Example — `constellation/style/STYLE-COLORS.md`:

```markdown
---
name: Colors
category: color
status: built
code_refs:
  - src/styles/tokens.css
tokens:
  - name: brand-blue
    value: "#1e40af"
    description: Primary brand color — CTAs only
  - name: grey-medium
    value: "#6b7280"
    description: Secondary text
  - name: danger
    value: "#dc2626"
    description: Errors and destructive actions
---

# Colors

Brand blue is reserved for primary actions; never use it for links in body
copy. Greys come from this ramp only — no ad-hoc greys.
```
