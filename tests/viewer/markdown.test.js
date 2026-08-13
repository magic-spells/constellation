import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../viewer/app/lib/markdown.js';

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
    const { TYPE_META, GROUPS, typeForFolder, folderForType, isHandle } = await import(
      '../../viewer/app/lib/types.js'
    );
    expect(Object.keys(TYPE_META)).toHaveLength(21);
    expect(typeForFolder('api')).toBe('API');
    expect(typeForFolder('nope')).toBeUndefined();
    expect(folderForType('DATATYPE')).toBe('datatype');
    expect(GROUPS).toEqual(['Overview', 'System', 'Interface', 'Code & tests']);
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
