import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPlan } from '../src/core/indexer.js';
import type { PlanIndex } from '../src/core/types.js';
import { queryNeedles, searchCards } from '../src/mcp/search.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));
// Constellation's own plan — the acceptance case is "an agent greps a source path".
const SELF = fileURLToPath(new URL('../constellation', import.meta.url));

let golden: PlanIndex;
let self: PlanIndex;

beforeAll(async () => {
  golden = await loadPlan(GOLDEN);
  self = await loadPlan(SELF);
});

const handles = (index: PlanIndex, q: string) =>
  searchCards(index, q).map((h) => h.card.handle);

describe('query tokenizing', () => {
  it('keeps a double-quoted phrase whole', () => {
    expect(queryNeedles('"no hard delete" tickets')).toEqual([
      'no hard delete',
      'tickets',
    ]);
  });

  it('strips edge punctuation and drops common words', () => {
    expect(queryNeedles('where is API-TICKETS, really?')).toEqual([
      'api-tickets',
      'really',
    ]);
  });

  it('falls back to the raw tokens when everything was a stopword', () => {
    expect(queryNeedles('the')).toEqual(['the']);
  });
});

describe('frontmatter is searchable (path / code_refs / summary)', () => {
  it('finds the card bound to a source path — the grep replacement', () => {
    expect(handles(self, 'src/core/stale.ts')).toContain('FILE-STALE');
    expect(handles(self, 'src/core/stale.ts')[0]).toBe('FILE-STALE');
  });

  it('finds a card by a code_ref it declares', () => {
    const refs = golden.cards.get('DATATYPE-TICKET')?.frontmatter.code_refs;
    const first = (refs as string[])[0].split(':')[0];
    expect(handles(golden, first)).toContain('DATATYPE-TICKET');
  });

  it('finds an API card by its route path', () => {
    expect(handles(golden, '/api/v1/tickets')).toContain('API-TICKETS');
  });

  it('matches a handle written with trailing punctuation', () => {
    expect(handles(golden, 'API-TICKETS,')).toContain('API-TICKETS');
  });
});

describe('AND semantics', () => {
  it('a natural multi-word query no longer ranks nearly every card', () => {
    const all = golden.cards.size;
    const matched = handles(golden, 'how does the auto assignment job work?');
    // Every card mentions "the"; the OR-sum used to rank almost the whole plan.
    expect(handles(golden, 'the').length).toBeGreaterThan(all / 2);
    expect(matched.length).toBeLessThan(all / 2);

    const answerable = handles(golden, 'the auto assignment job');
    expect(answerable).toContain('JOB-AUTO-ASSIGN');
    expect(answerable.length).toBeLessThan(all / 2);
  });

  it('drops a card that matches only one of two significant words', () => {
    const both = handles(golden, 'ticket zanzibaria');
    expect(both).toEqual([]);
    expect(handles(golden, 'ticket').length).toBeGreaterThan(0);
  });

  it('a quoted phrase must appear verbatim', () => {
    // The cards say "auto-assignment", so the two words as a phrase match nothing
    // even though both words are all over the plan.
    expect(handles(golden, 'auto assignment').length).toBeGreaterThan(0);
    expect(handles(golden, '"auto assignment"')).toEqual([]);
    expect(handles(golden, '"auto-assignment"').length).toBeGreaterThan(0);
  });
});
