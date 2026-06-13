import { Marked } from 'marked';

const HANDLE_LINK = /^\[\[([A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*)\]\]/;

function escapeHtml(text: string): string {
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
function sanitizeUrl(href: string): string {
  const stripped = href.replace(/[\x00-\x20\x7f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase())) return '#';
  return href;
}

const marked = new Marked({ gfm: true });

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
      start: (src: string) => src.indexOf('[['),
      tokenizer(src: string) {
        const match = HANDLE_LINK.exec(src);
        if (match) return { type: 'wikilink', raw: match[0], handle: match[1] };
        return undefined;
      },
      renderer(token) {
        const t = token as { handle: string };
        return `<a class="wiki" href="#/card/${t.handle}">${t.handle}</a>`;
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

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

let mermaidCounter = 0;

/** Parse #rgb / #rrggbb into [r,g,b]; null if unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)) as [number, number, number];
  if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return null;
}

/** Linear blend: `t` is the fraction of `b` mixed into `a`. */
function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((n, i) => Math.round(n + (pb[i] - n) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Pull a resolved CSS custom property off :root. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const NODE_HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

/**
 * Tint each diagram node by its card type, using the same `--t-<TYPE>` palette as
 * the chips. Diagram node IDs are handles, so the node's text is the handle —
 * derive the type from its prefix and recolor the shape. Non-handle nodes keep
 * mermaid's default fill.
 */
function colorNodesByType(svg: Element, panel: string): void {
  for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
    const handle = (node.textContent ?? '').trim();
    if (!NODE_HANDLE.test(handle)) continue;
    const color = cssVar(`--t-${handle.slice(0, handle.indexOf('-'))}`);
    if (!color) continue;
    const fill = mix(panel, color, 0.35);
    for (const shape of node.querySelectorAll<SVGElement>(
      'rect, polygon, circle, ellipse, path',
    )) {
      shape.style.fill = fill;
      shape.style.stroke = color;
    }
  }
}

/** Render all .mermaid-block placeholders inside a container, tinted to the active theme. */
export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('.mermaid-block');
  if (blocks.length === 0) return;

  const accent = cssVar('--accent');
  const panel = cssVar('--bg-panel');
  const inset = cssVar('--bg-inset');
  const text = cssVar('--text');
  const muted = cssVar('--text-muted');
  const border = cssVar('--border-strong');
  const bg = parseHex(cssVar('--bg'));
  const isDark = bg ? (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 < 0.5 : false;

  // chip aesthetic: a faint accent tint for the fill, accent-leaning border, theme text
  const fill = mix(panel, accent, 0.15);
  const nodeBorder = mix(panel, accent, 0.55);

  const mermaid = (await import('mermaid')).default;
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
