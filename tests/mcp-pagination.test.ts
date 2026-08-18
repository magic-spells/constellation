import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-page-'));
  const planRoot = path.join(dir, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  for (let i = 0; i < 12; i++) {
    await call('append_note', {
      handle: 'DB-TICKETS',
      kind: 'gotcha',
      text: `paging note ${i}`,
    });
  }
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('list_cards paging', () => {
  it('reports the total, the page it returned, and how to get the rest', async () => {
    const first = await call('list_cards', { limit: 10 });
    expect(first.total).toBe(26);
    expect(first.cards).toHaveLength(10);
    expect(first.offset).toBe(0);
    expect(first.limit).toBe(10);
    expect(first.returned).toBe(10);
    expect(first.more).toBe(true);
    expect(first.next).toContain('offset: 10');

    const second = await call('list_cards', { limit: 10, offset: 10 });
    expect(second.cards).toHaveLength(10);
    // Contiguous pages over one stable order, no overlap.
    expect(second.cards[0].handle).not.toBe(first.cards[0].handle);
    const all = await call('list_cards', { limit: 500 });
    expect([...first.cards, ...second.cards].map((c) => c.handle)).toEqual(
      all.cards.slice(0, 20).map((c: { handle: string }) => c.handle),
    );
    expect(all.more).toBe(false);
    expect(all.next).toBeUndefined();
  });

  it('an offset past the end returns an empty page and still states the total', async () => {
    const data = await call('list_cards', { offset: 999 });
    expect(data.cards).toEqual([]);
    expect(data.total).toBe(26);
    expect(data.returned).toBe(0);
    expect(data.more).toBe(false);
  });

  it('filters page independently of the filter', async () => {
    const data = await call('list_cards', { types: ['API'], limit: 1 });
    expect(data.total).toBe(1);
    expect(data.more).toBe(false);
  });
});

describe('search paging', () => {
  it('pages the ranked order without reshuffling it', async () => {
    const all = await call('search', { q: 'ticket', limit: 100 });
    expect(all.total_hits).toBeGreaterThan(3);
    expect(all.more).toBe(false);

    const first = await call('search', { q: 'ticket', limit: 2 });
    expect(first.total_hits).toBe(all.total_hits);
    expect(first.matches).toHaveLength(2);
    expect(first.more).toBe(true);
    expect(first.next).toContain('offset: 2');

    const second = await call('search', { q: 'ticket', limit: 2, offset: 2 });
    expect(
      [...first.matches, ...second.matches].map(
        (m: { card: { handle: string } }) => m.card.handle,
      ),
    ).toEqual(
      all.matches
        .slice(0, 4)
        .map((m: { card: { handle: string } }) => m.card.handle),
    );
  });

  it('an offset past the last hit is empty but does not read as "no match"', async () => {
    const data = await call('search', { q: 'ticket', offset: 999 });
    expect(data.matches).toEqual([]);
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.more).toBe(false);
    expect(data.note).toBeUndefined();
  });
});

describe('list_notes paging', () => {
  it('reports the total and pages through it', async () => {
    const all = await call('list_notes', { kind: 'gotcha' });
    expect(all.total).toBeGreaterThanOrEqual(12);
    expect(all.more).toBe(false);

    const first = await call('list_notes', { kind: 'gotcha', limit: 5 });
    expect(first.notes).toHaveLength(5);
    expect(first.total).toBe(all.total);
    expect(first.more).toBe(true);
    expect(first.next).toContain('offset: 5');

    const second = await call('list_notes', { kind: 'gotcha', limit: 5, offset: 5 });
    expect(second.notes.map((n: { text: string }) => n.text)).toEqual(
      all.notes.slice(5, 10).map((n: { text: string }) => n.text),
    );

    const past = await call('list_notes', { kind: 'gotcha', offset: 500 });
    expect(past.notes).toEqual([]);
    expect(past.total).toBe(all.total);
    expect(past.more).toBe(false);
  });
});
