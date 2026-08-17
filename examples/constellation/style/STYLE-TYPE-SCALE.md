---
name: Type scale
category: type-scale
status: built
connections:
  - PAGE-INBOX
  - STYLE-FONTS
tokens:
  - name: heading-1
    value: "2.5rem"
    weight: "700"
    line_height: "1.1"
    description: Page title — h1, once per page
  - name: heading-2
    value: "1.75rem"
    weight: "700"
    line_height: "1.2"
    description: Section heading — h2
  - name: heading-3
    value: "1.25rem"
    weight: "700"
    line_height: "1.3"
    description: Sub-section heading — h3
  - name: overline-heading
    value: "0.75rem"
    weight: "600"
    line_height: "1.4"
    sample: "SECTION LABEL"
    description: Small label above a heading — uppercase, letterspaced
  - name: body-lg
    value: "1.125rem"
    description: Lead paragraphs
  - name: body-md
    value: "1rem"
    description: Default body
  - name: body-sm
    value: "0.875rem"
    description: Meta text, timestamps
---

# Type scale

Seven steps only. If a design needs an in-between size, it's wrong.

Heading steps are numbered to match the element they set — `heading-2` is what
an `h2` gets — so nobody has to remember whether "subheading" was bigger or
smaller than "title". Nothing is named `display`: naming the top step that
invites an eighth size above it.

`overline-heading` is the one step that is uppercase and letterspaced. It is not
called `overline` because Tailwind already ships that as a text-decoration
utility, and a token colliding with a framework class is a bug waiting to
happen.
