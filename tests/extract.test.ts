import { describe, expect, it } from 'vitest';
import {
  extractFrontmatterRefs,
  extractMermaidRefs,
  extractWikiLinks,
} from '../src/core/extract.js';

describe('extractWikiLinks', () => {
  it('finds [[HANDLE]] links and ignores non-handles', () => {
    const body = 'See [[API-TICKETS]] and [[DB-TICKETS]], not [[some note]] or [[WIDGET-X]].';
    expect(extractWikiLinks(body)).toEqual(['API-TICKETS', 'DB-TICKETS']);
  });

  it('dedupes repeated links', () => {
    expect(extractWikiLinks('[[API-TICKETS]] then [[API-TICKETS]]')).toEqual([
      'API-TICKETS',
    ]);
  });
});

describe('extractMermaidRefs', () => {
  it('finds handle-shaped node IDs inside mermaid fences only', () => {
    const body = [
      'API-OUTSIDE-FENCE is not collected.',
      '```mermaid',
      'flowchart LR',
      '  PAGE-INBOX --> API-TICKETS',
      '  API-TICKETS --> DB-TICKETS',
      '```',
    ].join('\n');
    expect(extractMermaidRefs(body)).toEqual([
      'PAGE-INBOX',
      'API-TICKETS',
      'DB-TICKETS',
    ]);
  });

  it('ignores lowercase tokens and unknown prefixes', () => {
    const body = [
      '```mermaid',
      'stateDiagram-v2',
      '  [*] --> open',
      '  open --> closed: DOUBLE-PRECISION is not a handle prefix',
      '```',
    ].join('\n');
    expect(extractMermaidRefs(body)).toEqual([]);
  });
});

describe('extractFrontmatterRefs', () => {
  it('walks nested values and skips connections and the own handle', () => {
    const fm = {
      connections: ['DB-TICKETS'],
      emitter: 'API-TICKETS',
      methods: {
        POST: { request_schema: 'DATATYPE-CREATE-TICKET-INPUT' },
      },
      props: [{ name: 'ticket', type: 'DATATYPE-TICKET' }],
      table_name: 'tickets',
      self_ref: 'EVENT-TICKET-CREATED',
    };
    const refs = extractFrontmatterRefs(fm, 'EVENT-TICKET-CREATED');
    expect(refs).toContain('API-TICKETS');
    expect(refs).toContain('DATATYPE-CREATE-TICKET-INPUT');
    expect(refs).toContain('DATATYPE-TICKET');
    expect(refs).not.toContain('DB-TICKETS');
    expect(refs).not.toContain('EVENT-TICKET-CREATED');
    expect(refs).not.toContain('tickets');
  });
});
