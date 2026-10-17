// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PELE_URL,
  loadPele,
  renderMarkdown,
  renderMermaidBlocks,
} from '../../viewer/app/lib/markdown.js';

describe('viewer markdown rendering', () => {
  it('renders [[API-TICKETS]] as a hash wikilink', () => {
    expect(renderMarkdown('see [[API-TICKETS]]')).toContain('href="#/api/API-TICKETS"');
  });

  it('escapes raw HTML in markdown', () => {
    const html = renderMarkdown('Hello <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
  });

  it('blocks javascript: and data: urls', () => {
    const link = renderMarkdown('[x](javascript:alert(1))');
    expect(link).not.toMatch(/javascript:/i);
    expect(link).toContain('href="#"');

    const img = renderMarkdown('![x](data:image/svg+xml;base64,AAAA)');
    expect(img).not.toContain('data:');
  });

  it('preserves safe and relative URLs', () => {
    expect(renderMarkdown('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(renderMarkdown('[x](#section)')).toContain('href="#section"');
  });

  it('emits mermaid placeholder divs', () => {
    const html = renderMarkdown('```mermaid\ngraph LR\nA---B\n```');
    expect(html).toContain('class="mermaid-block"');
    expect(html).toContain('data-src=');
  });

  it('renders non-mermaid fenced code as escaped <pre class="code">', () => {
    const html = renderMarkdown('```js\nconst a = 1 < 2;\n```');
    expect(html).toContain('<pre class="code"><code>');
    expect(html).toContain('&lt;');
  });
});

describe('viewer type metadata', () => {
  it('maps folders back to types and types to folders', async () => {
    const { TYPE_META, GROUPS, groupLabel, typeForFolder, folderForType, isHandle } = await import(
      '../../viewer/app/lib/types.js'
    );
    expect(Object.keys(TYPE_META)).toHaveLength(21);
    expect(typeForFolder('api')).toBe('API');
    expect(typeForFolder('nope')).toBeUndefined();
    expect(folderForType('DATATYPE')).toBe('datatype');
    expect(GROUPS).toEqual(['overview', 'system', 'interface', 'code']);
    expect(GROUPS.map(groupLabel)).toEqual(['Overview', 'System', 'Interface', 'Code & tests']);
    expect(isHandle('API-TICKETS')).toBe(true);
    expect(isHandle('NOPE-THING')).toBe(false);
    expect(isHandle('lowercase-thing')).toBe(false);
  });
});

describe('viewer color helpers', () => {
  it('parses, mixes, darkens and measures luminance of hex colors', async () => {
    const { parseHex, toHex, mix, darken, luminance } = await import(
      '../../viewer/app/lib/colors.js'
    );
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#010203')).toEqual([1, 2, 3]);
    expect(parseHex('not-a-color')).toBeNull();
    expect(toHex([0, 128, 255])).toBe('#0080ff');
    expect(toHex([-10, 300, 0])).toBe('#00ff00');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', 'bogus', 0.5)).toBe('#888');
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('bogus')).toBe('#111');
    expect(luminance('#ffffff')).toBe(1);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('bogus')).toBe(0);
  });
});

describe('viewer diagram rendering', () => {
  // The real lazy entry stands in for the vendored copy the browser fetches.
  const realPele = () => import('pele/lazy');
  // A stand-in pele that returns a fixed svg, to aim the tint pass at shapes
  // the real renderer only produces for exotic diagrams.
  const fakePele = (svg) => async () => ({ renderAsync: async () => ({ svg }) });

  afterEach(() => {
    document.documentElement.style.removeProperty('--t-API');
  });

  it('loads pele from the vendored path and tints handle nodes by type', async () => {
    document.documentElement.style.setProperty('--t-API', '#e0635d');
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown('```mermaid\nflowchart LR\n  API-TICKETS --> X[Plain]\n```');
    const importModule = vi.fn(realPele);

    await renderMermaidBlocks(host, importModule);

    expect(PELE_URL).toBe('/vendor/pele/lazy.js');
    expect(importModule).toHaveBeenCalledWith('/vendor/pele/lazy.js');
    expect(host.querySelector('.mermaid-block svg.pele')).not.toBeNull();
    const api = host.querySelector('g.pele-node[data-id="API-TICKETS"] rect');
    expect(api.style.getPropertyValue('stroke')).toBe('var(--t-API)');
    expect(api.style.getPropertyValue('fill')).toContain('var(--t-API)');
    expect(host.querySelector('g.pele-node[data-id="X"] rect').style.getPropertyValue('fill')).toBe('');
  });

  it('falls back to the escaped source when the diagram does not parse', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown('```mermaid\nflowchart LR\n  A -->\n  <b>\n```');
    await renderMermaidBlocks(host, realPele);
    expect(host.querySelector('.mermaid-block pre.code')).not.toBeNull();
    expect(host.querySelector('.mermaid-block').innerHTML).toContain('&lt;b&gt;');
  });

  it('renders hostile labels as text, never markup', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown(
      '```mermaid\nflowchart LR\n  A["<script>alert(1)</script>"] --> B["<img src=x onerror=alert(1)>"]\n```',
    );
    await renderMermaidBlocks(host, realPele);
    const block = host.querySelector('.mermaid-block');
    expect(block.querySelector('svg')).not.toBeNull();
    expect(block.innerHTML).not.toMatch(/<script/i);
    expect(block.querySelector('script, img, foreignObject')).toBeNull();
    const handlers = [...block.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].map((attr) => attr.name).filter((name) => /^on/i.test(name)),
    );
    expect(handlers).toEqual([]);
    // Pele strips tags from labels; what is left is inert text.
    expect(block.textContent).toContain('alert(1)');
  });

  it('tints only a node\'s own shapes, and skips prefixes with no hue', async () => {
    document.documentElement.style.setProperty('--t-API', '#e0635d');
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown('```mermaid\ngraph LR\nA-->B\n```');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="pele-node" data-id="API-OUTER"><rect id="outer"/>
        <g class="pele-node" data-id="PLAIN"><rect id="nested"/></g>
        <g class="pele-icon"><path id="icon"/></g>
      </g>
      <g class="pele-node" data-id="ZZZ-UNKNOWN"><rect id="unknown"/></g>
    </svg>`;
    await renderMermaidBlocks(host, fakePele(svg));
    const fill = (id) => host.querySelector(`#${id}`).style.getPropertyValue('fill');
    expect(fill('outer')).toContain('var(--t-API)');
    expect(fill('nested')).toBe('');
    expect(fill('icon')).toBe('');
    expect(fill('unknown')).toBe('');
  });

  it('loadPele caches a successful load and retries after a failed one', async () => {
    const module = { renderAsync: async () => ({ svg: '<svg></svg>' }) };
    const ok = vi.fn(async () => module);
    expect(await loadPele(ok)).toBe(module);
    expect(await loadPele(ok)).toBe(module);
    expect(ok).toHaveBeenCalledTimes(1);

    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(module);
    await expect(loadPele(flaky)).rejects.toThrow('failed to load /vendor/pele/lazy.js: offline');
    expect(await loadPele(flaky)).toBe(module);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('reports the vendored path when the bundle fails to load', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown('```mermaid\ngraph LR\nA-->B\n```');
    await expect(
      renderMermaidBlocks(host, () => Promise.reject(new Error('404'))),
    ).rejects.toThrow('failed to load /vendor/pele/lazy.js: 404');
  });
});
