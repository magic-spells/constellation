# Renderer comparison

Dev-only, outside the viewer build and npm package. No production imports change.

The viewer now renders with Pele and `mermaid` is no longer a dependency, so
install it first to run this harness: `npm install --no-save mermaid@11`.

```sh
npm run compare:renderers
node scripts/compare-renderers/collect.mjs
node scripts/compare-renderers/screenshot.mjs --out /path/to/scratchpad
```

The server binds to `127.0.0.1:4317` (`PORT` overrides it). Each row shows source,
detected types, render times, verbatim errors, and the two SVGs. The theme button
reloads the page so Mermaid picks up the new colors. `?suite=flow-state` selects
the sample app's actual flowchart and state machine for a smaller transfer probe.

The collector scans every Markdown file in `constellation/`,
`examples/constellation/`, and `skill/`, including Mermaid fences nested in the
skill's four-backtick examples, then loads every `fixtures/*.mmd`. It currently
finds **five** real fences (the inline mention in `skill/types/state.md` is not a
sixth fence) plus fifteen fixtures. Fixture IDs retain Constellation handles.
Both parsers reject raw hyphenated state IDs: `state-handles.mmd` records that
case, while `state.mmd` uses aliases with handle labels to cover composite states
and notes. `invalid.mmd` is the deliberately broken flowchart.

Mermaid 11 uses the viewer's initialization and text-based `g.node` tint pass,
copied from `viewer/app/lib/markdown.js`. Pele uses its lazy ESM API, loads only
encountered diagram modules, and maps `--pele-*` variables to Observatory's
light/dark tokens. Its tint pass targets `g.pele-node[data-id]`, applying the
same 35% type hue blend. As in the viewer, the post-pass overrides authored shape
colors on tinted nodes; stroke width/dash styling remains visible. Pele's
default responsive direction changes are enabled for this comparison.

The screenshot script starts and stops its own server on a free port, uses an
installed Playwright package or resolves one through `npx`, and requires its
Chromium browser to be installed (`npx playwright install chromium` if needed).
`--browser firefox` or `--browser webkit` selects another installed Playwright
engine. `PLAYWRIGHT_PACKAGE=playwright@<version>` pins the npx fallback when the
machine's installed browser builds belong to a particular Playwright version.
It saves full-page dark/light PNGs and `compare-report.json` in `--out` (default:
the OS temp directory's `constellation-renderer-compare/`). The report includes
both themes, raw SVG structure summaries for inspection, all resource sizes and
paths, and a fresh-context flowchart/state transfer measurement. A parse failure
is recorded in the report and does not abort screenshots; an infrastructure or
uncaught browser failure does abort the script.

Times use `performance.now()` around parsing/rendering, insertion and tinting.
Both renderers' diagram modules are preloaded outside the timer; Mermaid's
`getDiagramFromText()` also warms its parser. This is an interactive comparison,
not a statistically controlled benchmark. Byte totals sum ResourceTiming
`transferSize` for `/vendor/mermaid/` and `/vendor/pele/`; body sizes are also
recorded. The server uses no compression and `Cache-Control: no-store`, and each
capture uses a new browser context. These numbers are local transfers, not a
claim about production gzip/Brotli sizes or Pele's all-types single bundle.

Pele is called with `links: false, images: false` for this strict viewer probe.
Its default link behavior differs from Mermaid's `securityLevel: 'strict'`.
See [Pele security](https://pele.run/security) and
[mount's sanitizer hook](https://pele.run/api#mount) before considering a viewer
integration. Source and error strings are inserted with `textContent`.

The i18n guard's root is `viewer/app/`; this development page is outside it.
