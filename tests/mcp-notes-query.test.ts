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
  return { data: JSON.parse(content[0].text), isError: res.isError === true };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-notes-'));
  const planRoot = path.join(dir, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  await call('append_note', {
    handle: 'API-TICKETS',
    kind: 'gotcha',
    text: 'Rate limiting uses the zanzibar strategy, not fixed windows.',
  });
  await call('append_note', {
    handle: 'API-TICKETS',
    kind: 'decision',
    text: 'Cursor pagination chosen over offset.',
  });
  await call('append_note', {
    handle: 'DB-TICKETS',
    kind: 'gotcha',
    text: 'status column is an enum, migrations must ALTER TYPE.',
  });
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('notes are searchable (memory must be findable)', () => {
  it('search finds a card by text that exists only in an appended note', async () => {
    const res = await call('search', { q: 'zanzibar' });
    const handles = res.data.matches.map(
      (m: { card: { handle: string } }) => m.card.handle,
    );
    expect(handles).toContain('API-TICKETS');
    const hit = res.data.matches.find(
      (m: { card: { handle: string } }) => m.card.handle === 'API-TICKETS',
    );
    expect(hit.excerpt).toContain('note(gotcha)');
    expect(hit.excerpt).toContain('zanzibar');
  });
});

describe('list_notes (cross-card memory query)', () => {
  it('returns every note across the plan', async () => {
    const res = await call('list_notes');
    // 3 appended above + 1 the golden plan ships on DATATYPE-TICKET.
    expect(res.data.total).toBe(4);
    const handles = res.data.notes.map((n: { handle: string }) => n.handle);
    expect(handles).toContain('API-TICKETS');
    expect(handles).toContain('DB-TICKETS');
    expect(handles).toContain('DATATYPE-TICKET');
  });

  it('filters by kind and by handles', async () => {
    const gotchas = await call('list_notes', { kind: 'gotcha' });
    expect(gotchas.data.total).toBe(2);
    expect(
      gotchas.data.notes.every((n: { kind: string }) => n.kind === 'gotcha'),
    ).toBe(true);

    const scoped = await call('list_notes', { handles: ['db-tickets'] });
    expect(scoped.data.total).toBe(1);
    expect(scoped.data.notes[0].text).toContain('ALTER TYPE');
  });

  it('respects the limit', async () => {
    const res = await call('list_notes', { limit: 1 });
    expect(res.data.notes).toHaveLength(1);
    expect(res.data.total).toBe(4); // total reports the full count
  });
});

describe('concurrent appends both land (write lock)', () => {
  it('two parallel append_note calls yield two notes', async () => {
    await call('create_card', { handle: 'DOC-RACE', body: 'Race target.' });
    await Promise.all([
      call('append_note', { handle: 'DOC-RACE', kind: 'state', text: 'first' }),
      call('append_note', { handle: 'DOC-RACE', kind: 'state', text: 'second' }),
    ]);
    const res = await call('get_card', { handle: 'DOC-RACE' });
    const texts = (res.data.card.frontmatter.notes as Array<{ text: string }>).map(
      (n) => n.text,
    );
    expect(texts).toHaveLength(2);
    expect(texts).toContain('first');
    expect(texts).toContain('second');
  });
});
