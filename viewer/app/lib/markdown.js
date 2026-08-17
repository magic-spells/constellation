import { Marked } from 'marked';
import { cssColor } from './colors.js';
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
        return `<div class="mermaid-block" data-src="${encodeURIComponent(text)}"></div>`;
      }
      return `<pre class="code"><code>${escapeHtml(text)}</code></pre>`;
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
 * (MarkdownBlock renders them as usual, mermaid included); each step is
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

let mermaidCounter = 0;

/**
 * Local hex helpers for mermaid tinting. Kept separate from `colors.js` on
 * purpose: these are lenient (they accept unprefixed hex and fall back to the
 * first color rather than a grey) and the mermaid palette depends on that.
 */

/** Parse #rgb / #rrggbb into [r,g,b]; null if unparseable. */
function parseHex(hex) {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
  if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return null;
}

/** Linear blend: `t` is the fraction of `b` mixed into `a`. */
function mix(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((n, i) => Math.round(n + (pb[i] - n) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

const NODE_HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

/**
 * Tint each diagram node by its card type, using the same `--t-<TYPE>` palette as
 * the chips. Diagram node IDs are handles, so the node's text is the handle —
 * derive the type from its prefix and recolor the shape. Non-handle nodes keep
 * mermaid's default fill.
 */
function colorNodesByType(svg, panel) {
  for (const node of svg.querySelectorAll('g.node')) {
    const handle = (node.textContent ?? '').trim();
    if (!NODE_HANDLE.test(handle)) continue;
    const color = cssColor(`--t-${handle.slice(0, handle.indexOf('-'))}`);
    if (!color) continue;
    const fill = mix(panel, color, 0.35);
    for (const shape of node.querySelectorAll('rect, polygon, circle, ellipse, path')) {
      shape.style.fill = fill;
      shape.style.stroke = color;
    }
  }
}

/**
 * Load mermaid lazily as a static asset rather than a bundled import. The
 * puzzle build emits a single app.js (no dynamic-import splitting), so a
 * bundled `import('mermaid')` would inline ~3 MB of mermaid+KaTeX that most
 * page loads never use. Instead `scripts/copy-mermaid.mjs` vendors mermaid's
 * chunked ESM build into app/public/vendor/mermaid/ (copied verbatim into
 * dist/), and this imports the 28KB entry on first use; mermaid then lazily
 * fetches only the chunks for the diagram types actually rendered. The URL
 * lives in a variable so esbuild treats the import() as an opaque runtime
 * expression and leaves it to the browser.
 */
let mermaidLoader = null;
function loadMermaid() {
  if (!mermaidLoader) {
    const url = '/vendor/mermaid/mermaid.esm.min.mjs';
    mermaidLoader = import(url).then(
      (mod) => mod.default,
      (err) => {
        mermaidLoader = null;
        throw new Error(`failed to load ${url}: ${err.message}`);
      },
    );
  }
  return mermaidLoader;
}

/** Render all .mermaid-block placeholders inside a container, tinted to the active theme. */
export async function renderMermaidBlocks(container) {
  const blocks = container.querySelectorAll('.mermaid-block');
  if (blocks.length === 0) return;

  // Pieces palette tokens — NOT the old Svelte viewer's `--accent` / `--bg-panel`
  // names, which no longer exist (reading them handed mermaid empty strings and
  // it logged `Unsupported color format: ""` for every themeVariable).
  const accent = cssColor('--color-brand', '#5c7cfa');
  const panel = cssColor('--color-surface', '#101013');
  const inset = cssColor('--color-surface-sunken', '#18181c');
  const text = cssColor('--color-ink', '#f4f4f5');
  const muted = cssColor('--color-muted', '#7f7f88');
  const border = cssColor('--color-border-strong', '#3a3a42');
  const bg = parseHex(cssColor('--color-page', '#09090b'));
  const isDark = bg ? (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 < 0.5 : false;

  // chip aesthetic: a faint accent tint for the fill, accent-leaning border, theme text
  const fill = mix(panel, accent, 0.15);
  const nodeBorder = mix(panel, accent, 0.55);

  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
    themeVariables: {
      darkMode: isDark,
      background: 'transparent',
      primaryColor: fill,
      primaryBorderColor: nodeBorder,
      primaryTextColor: text,
      mainBkg: fill,
      nodeBorder,
      secondaryColor: mix(panel, accent, 0.08),
      tertiaryColor: inset,
      lineColor: muted,
      textColor: text,
      titleColor: text,
      clusterBkg: mix(panel, accent, 0.06),
      clusterBorder: border,
      edgeLabelBackground: panel,
      nodeTextColor: text,
    },
  });
  for (const el of blocks) {
    const src = decodeURIComponent(el.dataset.src ?? '');
    try {
      const { svg } = await mermaid.render(`mmd-${mermaidCounter++}`, src);
      el.innerHTML = svg;
      const svgEl = el.querySelector('svg');
      if (svgEl) colorNodesByType(svgEl, panel);
    } catch {
      el.innerHTML = `<pre class="code"><code>${escapeHtml(src)}</code></pre>`;
    }
  }
}
