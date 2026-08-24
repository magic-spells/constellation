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
category extras: fonts take `role` ("Heading Font"), `weights` ("Black (900)"),
`src` (a woff2/ttf path relative to the code root — the folder containing the
plan's `constellation/` dir — so specimens render in the real font);
type-scale takes `line_height`, `weight`, `sample`.

**Default names.** A type scale is `heading-1`, `heading-2`, `heading-3`,
`overline-heading`, `body-lg`, `body-md` (the default), `body-sm`; utility
colours are `success`, `warning`, `danger`, `info`. Rename any of these when a
project already uses its own vocabulary; the point is that a plan with no
opinion gets one.

Two naming rules behind those defaults. Heading steps are **numbered to match
the element** — `heading-2` sets an `h2` — rather than named ("subheading"
leaves you guessing where it sits). And nothing is called `display` or
`overline`: the first invites a size above the top step, and the second collides
with Tailwind's text-decoration utility.

Split colours across two cards rather than one long ramp: `STYLE-COLORS` for the
base palette (text, background, brand) and `STYLE-UTILITY-COLORS` for the four
that carry meaning. It keeps "what you click" separate from "what something is".

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
