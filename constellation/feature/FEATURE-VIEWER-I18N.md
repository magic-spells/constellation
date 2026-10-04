---
name: Viewer in eleven languages
status: built
release: RELEASE-V1-1-0
change: feature
branch: feat/viewer-i18n
pr: '#46'
code_refs:
  - viewer/app/locales/en.json
  - viewer/app/lib/i18n.js
  - viewer/app/lib/locale.js
  - viewer/puzzle.config.js
  - scripts/check-i18n.mjs
connections:
  - FEATURE-VIEWER-SHELL-1-1
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-CARD
  - PAGE-VIEWER-BOARD
  - TEST-SUITE
  - FILE-ATLAS-SCENE
  - COMPONENT-SYNC-BADGE
  - COMPONENT-STATUS-SELECT
  - COMPONENT-EDITABLE
---

Every label the viewer shows is translated, in eleven languages, on Puzzle 0.8's built-in i18n. The plan itself is never translated.

The ask, verbatim:

> move all labels into an english json file / update all labels in the app to use the translation function / make these languages: English, Spanish, German, French, Italian, Japanese, Simplified Chinese, Brazilian Portuguese, European Portuguese, Dutch and Korean.

## Scope

- **Config.** `i18n` in `viewer/puzzle.config.js`: `en es de fr it ja zh-Hans pt-BR pt-PT nl ko`, default `en`. The build emits one hashed table per locale; the browser fetches only the active one.
- **Tables.** `viewer/app/locales/<tag>.json`: 370 keys nested by area (`home.releases.empty`), `{placeholders}` inside whole sentences, counts as CLDR plural objects with `{count}` in every form. `context/en.json` has translator notes; `locales/README.md` has the conventions, glossary and tone.
- **Calls.** Templates use Puzzle's `t()`; plain JS (`data()`, `lib/`, toasts, canvas labels) uses `t` / `tParts` from `lib/i18n.js`. `tParts` keeps a sentence with a `<code>` span in it as one value. Type words come from `typeLabel` / `typeSingular` / `groupLabel`, status words from `statusLabel`. Dates, numbers and "ago" go through Intl in the active locale.
- **Picker.** A Language select in the Appearance popover, below scheme and mode, each language in its own name (`LANGUAGES` in `lib/locale.js`). A pick calls `setLocale`: no reload, `<html lang>` updated, remembered in `localStorage.__puzzleLocale`. With no saved choice the browser's languages pick (`pt` → `pt-BR`, `zh` → `zh-Hans`), else English.
- **Pseudo-locale, development builds only.** `/?pseudo=1#/` renders every string accented, ~35% longer and bracketed, so missed English and clipping stand out; `?pseudo=0` turns it off.
- **Layout for long and CJK text.** The Overview's Activity and Notes rows are subgrids (`grid-cols-activity`, `grid-cols-notes`), so their label columns size to the widest entry in the active language. The Tasks board's four columns share the width ([[PAGE-VIEWER-BOARD]]). The header title never shrinks; the sync badge truncates instead ([[COMPONENT-SYNC-BADGE]]), and the health strip wraps its chips below the verdict as a group.
- **Tests** ([[TEST-SUITE]]). `tests/viewer/i18n-locales.test.js`: every `t()` key exists, every dynamic prefix resolves, no key is unused, every plural form prints `{count}`, each locale matches `en.json`'s keys and placeholders, and the picker list matches the config. `i18n-hardcoded.test.js` runs `scripts/check-i18n.mjs`, which fails on hard-coded English; `i18n-ok: <reason>` on a line marks a genuine exception.

## Never translated

Plan data and identifiers reach the screen as they are, through a placeholder: card names, bodies and notes; frontmatter keys and values; handles and type prefixes; lint codes; paths, shas, branches and tags; project and repo names; keyboard hints; and the server's `message` / `reason` text. Only the UI's own fallbacks around server text are translated. The four status words are the one exception among frontmatter values: they go through `statusLabel`.

## Adding a key or a locale

- **A key:** add it to `en.json` under its area, named for what it is for, never for what it says. Add a note to `context/en.json` if it is short or ambiguous. Then add the same key to every other locale file: the locales test fails until all eleven have it with the same placeholders.
- **A locale:** add the tag to `i18n.locales` in `puzzle.config.js` and its own-language name to `LANGUAGES` in `lib/locale.js` (the test checks the two agree), then `locales/<tag>.json` with every key and the plural categories that language needs.

## Pyramid parity

Same tags as Pyramid. `lib/i18n.js`, `lib/locale.js`, `scripts/check-i18n.mjs` and the README structure are copied from it, along with the pseudo-locale and the language/region split (the locale picks the words, the browser's region the formats). Scheme names follow Pyramid's per-locale choices. Differences: `en.json` and `context/en.json` are the source, with no extraction/merge scaffolding; `formatNumber` uses the language tag alone, to match how Puzzle prints `{count}`; `weekStart`, `formatDateRange` and `collator` are not ported, because nothing here uses them.

## Decisions

- **The picker lives in the Appearance popover, not a Settings page.** The viewer has no Settings page, and language is a per-device display choice like scheme and mode. Its list opens upward, because the popover scrolls and would clip a downward list.
- **The pseudo-locale wraps the live service, not a generated file.** It always covers the current `en.json`, never appears in the picker, and sits behind `__PUZZLE_DEV__`, so production builds do not contain it.
