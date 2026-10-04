# The viewer's locale files

Every word the Constellation viewer shows comes from these files. `en.json` is the source;
each other file is the same keys in one language. The conventions match Pyramid's
(`pyramid/web/app/locales/`), so a translator who knows one app knows the other.

| File | Language | Register and notes (suggestions to confirm) |
| --- | --- | --- |
| `en.json` | English | the source and the fallback for any missing key |
| `es.json` | Spanish | one neutral Spanish, informal **tú**, no region-only vocabulary |
| `de.json` | German | informal **du**; expect ~30% longer text |
| `fr.json` | French | **vous**, the usual register of French software |
| `it.json` | Italian | informal **tu** |
| `ja.json` | Japanese | plain polite (です/ます) for messages, nouns for labels |
| `zh-Hans.json` | Chinese (Simplified) | |
| `pt-BR.json` | Portuguese (Brazil) | **você** |
| `pt-PT.json` | Portuguese (Portugal) | European vocabulary and spelling (ecrã, ficheiro, utilizador) |
| `nl.json` | Dutch | informal **je** |
| `ko.json` | Korean | polite 해요체 for messages, nouns for labels |

Until a language is translated its file is `{}`, and the build fills every key from English
(one warning line per locale).

## Tone

Concise UI copy for developers. Use the words each language's developer tools already use:
the usual term for *Dashboard*, *Board*, *Commit*, *Branch*, *Tag* in your market (often the
English word; "Panel" vs "Dashboard" is a real choice — pick what VS Code, GitHub and JetBrains
use in your language). Prefer the shortest natural wording for buttons, pills, tabs and column
headers: they have little room.

Dates, times, numbers and lists are formatted by the browser's `Intl` for the reader's language
and region, so **never write a date, a month name, a number format or a list separator into a
translation**: they arrive already formatted in a placeholder. Relative times ("5m ago") are
formatted by `Intl` too; only "just now" (`time.justNow`) is a string.

## Format

Puzzle 0.8 reads these files. A file may nest; nesting is flattened to dotted keys, so
`{ "card": { "notes": { "title": "Notes" } } }` is the key `card.notes.title`. Values are plain
text: markup is printed literally, so never add HTML.

### Keys

- Nested by **area, then screen, then purpose**: `home.releases.empty`, `board.column.ahead`,
  `card.delete.confirm`. The areas: `common` (shared buttons and states), `types` (the 21 card
  types and the sidebar groups), `status` (the four card statuses), `nav`, `shell`, `palette`,
  `workspace`, `sync`, `appearance`, `home`, `card`, `edit`, `style`, `board`, `features`,
  `docs`, `graph`, `atlas`, `time`, `ui`.
- A key names what the text **is for**, never what it says. Never use the English text as a key.
- One English word with two meanings gets two keys.
- `common.*` holds the few words whose meaning is the same everywhere (Save, Cancel, Delete,
  Close…). Translate them once; if one reads wrong in a particular place, say so and that place
  gets its own key.
- Do not add, remove or rename keys in a translation file. A key missing from a translation
  falls back to English (the build warns); a key that is not in `en.json` is ignored.

### Placeholders

`{name}` in a value is filled in by the viewer. Keep every placeholder exactly as written (same
name, same braces, not translated) and move it wherever your grammar needs it:

```json
"lastSynced": "last synced {when}"
```

```json
"lastSynced": "zuletzt synchronisiert {when}"
```

A placeholder's value is already in the reader's language and format (a relative time, a
formatted number, a translated type name), or it is plan data that is never translated (a card
handle, a card name, a file path). `context/en.json` says what each one holds when it is not
obvious.

Never split or join sentences: every sentence is one value, with its placeholders inside it. If
a sentence reads better with a different structure in your language, change the structure —
the viewer never glues two values together.

### Plurals

A value that depends on a number is an object of CLDR plural categories, and the number is
always the placeholder `{count}`:

```json
"cardCount": {
  "one": "{count} card",
  "other": "{count} cards"
}
```

Use the categories **your** language needs (Unicode CLDR plural rules):

| Language | Categories |
| --- | --- |
| en, de, nl, it, es, pt-PT | `one`, `other` (es, it and pt-PT also have `many` for 1,000,000-style counts; `other` covers it if omitted) |
| fr, pt-BR | `one` (0 and 1), `many`, `other` |
| ja, ko, zh-Hans | `other` only |

`other` is required and is the fallback for any category you leave out. An optional `zero` is
used for exactly 0 in **every** language (even where CLDR has no zero category). If `en.json`
has a `zero`, give one too.

An object is a plural entry only when **all** of its keys are plural categories, so never create
an ordinary group whose only keys are words like `one` or `other`.

## Never translated

These are plan data or identifiers. They reach the screen as they are, usually through a
placeholder, and never appear inside a translation value:

- card names, card bodies, notes and every frontmatter key and value;
- handles (`API-TICKETS`) and the type prefixes (`API`, `DB`, `FEATURE`…);
- lint codes (`E001`, `W004`…), file paths, git shas, branch and tag names;
- the project's name and connected repo names;
- messages the Constellation server sends (an error `message`, a drift `reason`);
- keyboard shortcuts (`⌘K`, `Esc`, `↑↓`);
- product names: Constellation, GitHub, Mermaid, git, Claude, Vercel.

## Fixed product terms (glossary)

Translate each term **once**, the same way everywhere.

| Term | Meaning |
| --- | --- |
| Constellation | the product, and the name of the graph view. **Never translated.** |
| Plan | the whole set of cards in a repo's `constellation/` folder |
| Card | one markdown file in the plan: one API endpoint, one table, one decision… |
| Handle | a card's ID, like `API-TICKETS`. The word is translated; a handle never is |
| Type | a card's kind (API endpoint, Data type, Feature…) — `types.*` |
| Connection | an undirected link between two cards |
| Status | planned → building → built → verified — `status.*` |
| Feature | a FEATURE card: a unit of product work, shown on the Tasks board |
| Release | a RELEASE card: a version and the features it ships |
| Sync point | the git commit the plan was last reviewed against |
| Drift | code that changed after the cards describing it were last verified |
| Atlas | the city-map view of the plan |
| Workspace | one of several plans served at once (connected repos) |
| Frontmatter | the YAML block at the top of a card file. Developers know the English word |

## Context for short and ambiguous strings

`context/en.json` maps a key to a note for translators (where it sits, how much room it has,
what a placeholder holds). Read it before translating a key it mentions.

## For developers

- Templates: `{ t('area.key') }`, `aria-label={ t('area.key') }`,
  `{ t('area.count', { count: n }) }`.
- JavaScript (`data()`, `lib/`, toasts, canvas painters): `import { t } from '…/lib/i18n.js'` and
  translate where the text is shown, never at module top level (the table loads before the first
  render, not before your module runs). Keep keys, not strings, in module constants (`labelKey`).
- A sentence with a styled value inside it (a `<code>`, a bold name): `tParts()` in `lib/i18n.js`.
- Dates, numbers, lists, relative times: `formatDateTime`, `formatNumber`, `formatList`,
  `formatRelative` in `lib/i18n.js`, `relTime` in `lib/format.js`; in templates Puzzle's `date`,
  `datetime`, `number_with_delimiter`, `timeago`.
- Type names: `typeLabel` / `typeSingular` / `groupLabel` (`lib/types.js`); status words:
  `statusLabel` (`lib/status.js`).
- `node scripts/check-i18n.mjs` fails on hard-coded text (also run by `npm test`);
  `tests/viewer/i18n-locales.test.js` checks the keys and every locale file against `en.json`.
  Mark a genuine exception `i18n-ok: <reason>` on its line.
- Pseudo-locale, development builds only: open the viewer with `?pseudo=1` before the `#`
  (`/?pseudo=1#/`) and every string renders accented, ~35% longer and bracketed, so untranslated
  English and clipping stand out; `?pseudo=0` turns it off.
- The language picker is in the Appearance popover; the list is `LANGUAGES` in `lib/locale.js`,
  kept in step with `i18n.locales` in `viewer/puzzle.config.js`.
