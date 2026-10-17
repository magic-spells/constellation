import { Marked } from 'marked';
import { cssVar } from './colors.js';
import { hrefForHandle } from './types.js';

const HANDLE_LINK = /^\[\[([A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*)\]\]/;

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Neutralize dangerous link/image targets. A card body in an untrusted cloned
 * repo can carry `[x](javascript:…)` / `data:` URLs that the HTML escaper never
 * sees (the scheme lives in a markdown destination, not a raw tag). Browsers
 * strip tabs/newlines before parsing the scheme, so we strip them too before
 * deciding — `java\tscript:` must not slip through. Schemeless URLs (relative,
 * `#`, `/`) are left as-is.
 */
function sanitizeUrl(href) {
  const stripped = href.replace(/[\x00-\x20\x7f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase())) return '#';
  return href;
}

const marked = new Marked({ gfm: true });

/**
 * The compiled-document context for the current parse, or null outside one.
 * `renderDocMarkdown` sets it around a SYNCHRONOUS `marked.parse`, so there is
 * never a second parse to interleave with — a per-instance renderer would mean
 * a second Marked with a second copy of every extension below.
 */
let docContext = null;

/** Where a `[[HANDLE]]` points: an anchor when the target is on the page, else its card route. */
function wikiHref(handle) {
	if (docContext?.handles.has(handle)) return `#${docContext.base}#${handle}`;
	return `#${hrefForHandle(handle)}`;
}

marked.use({
  // Sanitize link/image targets in-place; the default renderer then escapes the
  // (now-safe) href, so `[x](javascript:…)` and `data:` URLs can't reach the DOM.
  walkTokens(token) {
    if ((token.type === 'link' || token.type === 'image') && typeof token.href === 'string') {
      token.href = sanitizeUrl(token.href);
    }
  },
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenizer(src) {
        const match = HANDLE_LINK.exec(src);
        if (match) return { type: 'wikilink', raw: match[0], handle: match[1] };
        return undefined;
      },
      renderer(token) {
        // Plain hash href — the app runs the router in hash mode, so a static
        // string is all a card link needs (no router call at render time).
        return `<a class="wiki" href="${wikiHref(token.handle)}">${token.handle}</a>`;
      },
    },
  ],
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    code({ text, lang }) {
      if (lang === 'mermaid') {
        return `<div class="mermaid-block" data-src="${encodeURIComponent(text)}"></div>`; // i18n-ok: markup
      }
      return `<pre class="code"><code>${escapeHtml(text)}</code></pre>`; // i18n-ok: markup
    },
  },
});

export function renderMarkdown(md) {
  return marked.parse(md, { async: false });
}

/**
 * Render a card body as part of the compiled document at `base` (`/docs` or
 * `/docs/<section>`). The only difference from `renderMarkdown` is where
 * `[[HANDLE]]` goes: a card that is ON THIS PAGE gets an in-page anchor, and
 * everything else keeps its normal card route — a link out of the document is
 * still a link, just to somewhere else.
 */
export function renderDocMarkdown(md, handles, base = '/docs') {
  docContext = { handles: handles instanceof Set ? handles : new Set(handles), base };
  try {
    return marked.parse(md, { async: false });
  } finally {
    docContext = null;
  }
}

/**
 * FLOW cards: split the body around its first top-level ordered list so the
 * viewer can render the steps as a visual stepper. Returns null when the body
 * has no top-level ordered list. `before`/`after` are RAW markdown slices
 * (MarkdownBlock renders them as usual, diagrams included); each step is
 * pre-rendered HTML through this same pipeline (wikilinks, sanitized links),
 * with `branches` holding the step's nested bullet items — the edge-case
 * annotations ("invalid → 422") that render as dim lines inside the step box.
 */
export function extractFlowSteps(md) {
  const tokens = marked.lexer(md);
  const idx = tokens.findIndex((t) => t.type === 'list' && t.ordered);
  if (idx === -1) return null;
  const rawSlice = (slice) => slice.map((t) => t.raw).join('').trim();
  const render = (src) => marked.parse(src, { async: false });
  const steps = tokens[idx].items.map((item) => {
    const main = [];
    const branches = [];
    for (const t of item.tokens) {
      if (t.type === 'list') {
        for (const b of t.items) branches.push(render(b.tokens.map((x) => x.raw).join('')));
      } else {
        main.push(t.raw);
      }
    }
    return { html: render(main.join('')), branches };
  });
  return { before: rawSlice(tokens.slice(0, idx)), steps, after: rawSlice(tokens.slice(idx + 1)) };
}

let diagramCounter = 0;

const NODE_HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

/**
 * Tint each diagram node by its card type, using the same `--t-<TYPE>` palette as
 * the chips. Diagram node IDs are handles, and pele stamps the source ID on the
 * node as `data-id` — derive the type from its prefix and recolor the node's own
 * shapes (never a nested node's, never an icon). The colours are `color-mix()`
 * over live tokens, so a scheme or theme change restyles them without a
 * re-render. Non-handle nodes keep the `--pele-surface` fill from styles.css.
 */
function colorNodesByType(svg) {
  for (const node of svg.querySelectorAll('g.pele-node[data-id]')) {
    const handle = node.getAttribute('data-id');
    if (!NODE_HANDLE.test(handle)) continue;
    const hue = `--t-${handle.slice(0, handle.indexOf('-'))}`;
    // An unknown prefix has no hue; color-mix() over a missing var would
    // compute to black, so leave that node untinted.
    if (!cssVar(hue)) continue;
    for (const shape of node.querySelectorAll('rect, polygon, circle, ellipse, path')) {
      if (shape.closest('g.pele-node') !== node || shape.closest('.pele-icon')) continue;
      shape.style.setProperty('fill', `color-mix(in srgb, var(${hue}) 35%, var(--pele-bg))`);
      shape.style.setProperty('stroke', `var(${hue})`);
    }
  }
}

/** Where `scripts/copy-pele.mjs` puts pele's lazy entry (served from dist/ as-is). */
export const PELE_URL = '/vendor/pele/lazy.js';

const importByUrl = (url) => import(url);

/**
 * Load pele lazily as a static asset rather than a bundled import. The puzzle
 * build emits a single app.js (no dynamic-import splitting), so a bundled
 * import would ship the renderer to every reader. Instead `scripts/copy-pele.mjs`
 * vendors pele's ESM build into app/public/vendor/pele/, and this imports the
 * lazy entry on first use; pele then fetches only the chunk for each diagram
 * type actually rendered. The URL lives in a variable so esbuild treats the
 * import() as an opaque runtime expression and leaves it to the browser.
 * `importModule` is a test seam; each importer's load is cached until it fails.
 */
const peleLoaders = new Map();
export function loadPele(importModule = importByUrl) {
  let loading = peleLoaders.get(importModule);
  if (!loading) {
    loading = importModule(PELE_URL).catch((err) => {
      peleLoaders.delete(importModule);
      throw new Error(`failed to load ${PELE_URL}: ${err.message}`);
    });
    peleLoaders.set(importModule, loading);
  }
  return loading;
}

/** The diagram font: the same mono stack as `code` in the card body. */
const DIAGRAM_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'; // i18n-ok: font stack

/**
 * Render all .mermaid-block placeholders inside a container. The fence stays
 * Mermaid syntax; pele draws it. Colours come from the `--pele-*` tokens that
 * styles.css sets on `.mermaid-block`, so retheming needs no re-render.
 */
export async function renderMermaidBlocks(container, importModule) {
  const blocks = container.querySelectorAll('.mermaid-block');
  if (blocks.length === 0) return;

  // Measure every empty placeholder up front: reading layout after the first
  // svg lands would force a reflow per block.
  const widths = [...blocks].map((el) => {
    const style = getComputedStyle(el);
    const inner = el.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    return inner > 0 ? inner : undefined;
  });
  const pele = await loadPele(importModule);
  for (const [i, el] of blocks.entries()) {
    const src = decodeURIComponent(el.dataset.src ?? '');
    try {
      const { svg } = await pele.renderAsync(src, {
        maxWidth: widths[i],
        fontFamily: DIAGRAM_FONT,
        links: false,
        images: false,
        autoDirection: false,
        idPrefix: `dgm-${diagramCounter++}-`,
      });
      el.innerHTML = svg;
      const svgEl = el.querySelector('svg');
      if (svgEl) colorNodesByType(svgEl);
    } catch {
      el.innerHTML = `<pre class="code"><code>${escapeHtml(src)}</code></pre>`; // i18n-ok: markup
    }
  }
}
