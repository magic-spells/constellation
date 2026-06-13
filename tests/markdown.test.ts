import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../viewer/src/lib/markdown.js';

describe('viewer markdown rendering', () => {
  it('escapes raw HTML instead of injecting it', () => {
    const html = renderMarkdown('Hello <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
  });

  it('still renders wikilinks as internal card links', () => {
    const html = renderMarkdown('See [[API-TICKETS]].');
    expect(html).toContain('href="#/card/API-TICKETS"');
  });

  it('neutralizes javascript: and data: URLs in links and images', () => {
    const link = renderMarkdown('[click](javascript:alert(1))');
    expect(link).not.toMatch(/javascript:/i);
    expect(link).toContain('href="#"');

    const img = renderMarkdown('![x](data:image/svg+xml;base64,AAAA)');
    expect(img).not.toContain('data:');
  });

  it('preserves safe and relative URLs', () => {
    expect(renderMarkdown('[x](https://example.com)')).toContain(
      'href="https://example.com"',
    );
    expect(renderMarkdown('[x](#section)')).toContain('href="#section"');
  });
});
