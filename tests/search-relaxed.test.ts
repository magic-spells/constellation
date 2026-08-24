import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPlan } from '../src/core/indexer.js';
import type { PlanIndex } from '../src/core/types.js';
import { searchCards, searchPlan } from '../src/mcp/search.js';
import { buildServer } from '../src/mcp/server.js';

// AND-only search turned an over-specified query into a dead end, so agents
// learned to under-specify. These cover the OR fallback: same terms, relaxed,
// ranked by how many of them a card actually carries.

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let golden: PlanIndex;
let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

const handles = (hits: { card: { handle: string } }[]) => hits.map((h) => h.card.handle);

beforeAll(async () => {
  golden = await loadPlan(GOLDEN);
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-search-relaxed-'));
  const planRoot = path.join(dir, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('searchPlan — AND stays AND when it matches something', () => {
  it('returns the strict hits, unrelaxed, in the same order as searchCards', () => {
    const result = searchPlan(golden, 'ticket assignment');
    expect(result.relaxed).toBe(false);
    expect(result.unmatched).toEqual([]);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(handles(result.hits)).toEqual(handles(searchCards(golden, 'ticket assignment')));
  });

  it('never relaxes a single-needle query — AND and OR are the same query', () => {
    const result = searchPlan(golden, 'zzzquux');
    expect(result.relaxed).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.unmatched).toEqual(['zzzquux']);
  });
});

describe('searchPlan — the OR fallback', () => {
  it('retries with OR and names the terms no card carries', () => {
    const result = searchPlan(golden, 'ticket zzzquux');
    expect(result.relaxed).toBe(true);
    expect(result.unmatched).toEqual(['zzzquux']);
    expect(result.hits.length).toBeGreaterThan(0);
    // The dead term contributes nothing, so the relaxed page IS the "ticket" page.
    expect(handles(result.hits)).toEqual(handles(searchCards(golden, 'ticket')));
  });

  it('ranks by how many terms a card matched, above the raw score', () => {
    const result = searchPlan(
      golden,
      'how does auto assignment handle email quotas',
    );
    expect(result.relaxed).toBe(true);
    const top = result.hits[0];
    // Somewhere below the top sits a card scoring higher on fewer terms — the
    // relaxed order is "matched more of what you asked", not "scored highest".
    const outscored = result.hits.findIndex((h) => h.score > top.score);
    expect(outscored).toBeGreaterThan(0);
  });

  it('reports a relaxed miss rather than pretending the query was AND', () => {
    const result = searchPlan(golden, 'zzzquux nothingness');
    expect(result.relaxed).toBe(true);
    expect(result.hits).toEqual([]);
    expect(result.unmatched).toEqual(['zzzquux', 'nothingness']);
  });

  it('keeps the type filter on the relaxed pass', () => {
    const result = searchPlan(golden, 'ticket zzzquux', ['DB']);
    expect(result.relaxed).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((h) => h.card.type === 'DB')).toBe(true);
  });

  it('leaves searchCards strict — the fallback is opt-in', () => {
    expect(searchCards(golden, 'ticket zzzquux')).toEqual([]);
  });
});

// "unmatched" is advice to drop a word. Scoped to the filtered candidates it
// aimed that advice at the most discriminating word in the query.
describe('searchPlan — unmatched is a claim about the plan, not the filter', () => {
  it('does not report a term the filter hid rather than the plan lacking', () => {
    // "assignment" lives on JOB-AUTO-ASSIGN and FEATURE-AUTO-ASSIGNMENT — never
    // on a DB card, which is exactly why filtering to DB relaxes the query.
    expect(handles(searchCards(golden, 'assignment'))).not.toEqual([]);
    expect(searchCards(golden, 'assignment', ['DB'])).toEqual([]);

    const result = searchPlan(golden, 'ticket assignment', ['DB']);
    expect(result.relaxed).toBe(true);
    expect(result.unmatched).toEqual([]);
    // Hit selection stays filtered — only the vocabulary is plan-wide.
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((h) => h.card.type === 'DB')).toBe(true);
  });

  it('still names a term nothing in the plan carries, filter or no filter', () => {
    const result = searchPlan(golden, 'ticket assignment zzzquux', ['DB']);
    expect(result.unmatched).toEqual(['zzzquux']);
  });
});

describe('the search tool surfaces the fallback', () => {
  it('flags a relaxed page and lists the unmatched terms', async () => {
    const res = await call('search', { q: 'ticket zzzquux' });
    expect(res.relaxed).toBe(true);
    expect(res.unmatched_terms).toEqual(['zzzquux']);
    expect(res.note).toContain('relaxed to ANY word');
    expect(res.total_hits).toBeGreaterThan(0);
    expect(res.matches.length).toBeGreaterThan(0);
  });

  it('never tells an agent to drop a word the type filter merely hid', async () => {
    const res = await call('search', { q: 'ticket assignment', types: ['DB'] });
    expect(res.relaxed).toBe(true);
    expect(res.unmatched_terms).toBeUndefined();
    expect(res.note).not.toContain('No card mentions');
    expect(res.matches.length).toBeGreaterThan(0);
  });

  it('says nothing about relaxing when the AND query matched', async () => {
    const res = await call('search', { q: 'ticket assignment' });
    expect(res.relaxed).toBeUndefined();
    expect(res.unmatched_terms).toBeUndefined();
    expect(res.note).toBeUndefined();
    expect(res.total_hits).toBeGreaterThan(0);
  });

  it('pages a relaxed result like any other', async () => {
    const first = await call('search', { q: 'ticket zzzquux', limit: 2 });
    expect(first.relaxed).toBe(true);
    expect(first.returned).toBe(2);
    expect(first.offset).toBe(0);
    expect(first.more).toBe(true);
    expect(first.next).toContain('offset: 2');
    const second = await call('search', { q: 'ticket zzzquux', limit: 2, offset: 2 });
    expect(second.relaxed).toBe(true);
    expect(second.total_hits).toBe(first.total_hits);
    expect(second.matches[0].card.handle).not.toBe(first.matches[0].card.handle);
  });

  it('explains a total miss instead of returning a bare zero', async () => {
    const res = await call('search', { q: 'zzzquux nothingness' });
    expect(res.relaxed).toBe(true);
    expect(res.matches).toEqual([]);
    expect(res.unmatched_terms).toEqual(['zzzquux', 'nothingness']);
    expect(res.note).toContain('No card matched any of');
  });
});
