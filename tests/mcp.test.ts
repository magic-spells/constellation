import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let dir: string;
let planRoot: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { data: JSON.parse(content[0].text), isError: res.isError === true };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-mcp-'));
  planRoot = path.join(dir, 'constellation');
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

describe('bootstrap', () => {
  it('init_plan scaffolds constellation/ + plan.md and refuses to overwrite', async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), 'constellation-init-'));
    const { data } = await call('init_plan', { path: fresh });
    expect(data.created).toBe(path.join(fresh, 'constellation'));
    const plan = await readFile(path.join(fresh, 'constellation', 'plan.md'), 'utf8');
    expect(plan).toContain('# Project Plan');
    const again = await call('init_plan', { path: fresh });
    expect(again.isError).toBe(true);
    await rm(fresh, { recursive: true, force: true });
  });
});

describe('hydrated retrieval', () => {
  it('one get_card call returns an API card plus the FULL content of every connected card', async () => {
    const { data } = await call('get_card', {
      handle: 'API-TICKETS',
      connected: 'full',
    });
    expect(data.card.handle).toBe('API-TICKETS');
    expect(data.card.frontmatter.path).toBe('/api/v1/tickets');

    const byHandle = Object.fromEntries(
      data.connected_cards.map((c: { handle: string }) => [c.handle, c]),
    );
    expect(byHandle['DATATYPE-TICKET'].body).toContain('interface Ticket');
    expect(byHandle['DB-TICKETS'].frontmatter.columns.length).toBeGreaterThan(0);
    expect(byHandle['TEST-CREATE-TICKET'].body).toContain('happy path');
    expect(byHandle['DOC-TICKET-LIFECYCLE']).toBeDefined();
  });

  it('search can hydrate matches with connected cards', async () => {
    const { data } = await call('search', {
      q: 'ticket assignment',
      connected: 'summary',
    });
    expect(data.matches.length).toBeGreaterThan(0);
    const top = data.matches[0];
    expect(top.excerpt.length).toBeGreaterThan(0);
    expect(Array.isArray(top.connected_cards)).toBe(true);
  });

  it('traverse reaches depth-2 cards with distances', async () => {
    const { data } = await call('traverse', {
      start: 'PAGE-INBOX',
      depth: 2,
      detail: 'summary',
    });
    const distances = Object.fromEntries(
      data.cards.map((c: { handle: string; distance: number }) => [
        c.handle,
        c.distance,
      ]),
    );
    expect(distances['PAGE-INBOX']).toBe(0);
    expect(distances['API-TICKETS']).toBe(1);
    expect(distances['DB-TICKETS']).toBe(2);
  });

  it('list_cards filters by type and status', async () => {
    const { data } = await call('list_cards', { types: ['JOB'], status: 'planned' });
    expect(data.cards.map((c: { handle: string }) => c.handle)).toEqual([
      'JOB-AUTO-ASSIGN',
    ]);
  });

  it('check_integrity is clean on the golden plan', async () => {
    const { data } = await call('check_integrity');
    expect(data.errors).toEqual([]);
    expect(data.warnings).toEqual([]);
  });
});

describe('writes', () => {
  it('create_card writes a valid card and reports no issues', async () => {
    const { data } = await call('create_card', {
      handle: 'API-ARCHIVE-TICKETS',
      name: 'Archive a ticket',
      status: 'planned',
      fields: {
        path: '/api/v1/tickets/:id/archive',
        methods: { POST: { response_schema: 'DATATYPE-TICKET' } },
      },
      connections: ['DB-TICKETS'],
      body: 'Archives a closed ticket.',
    });
    expect(data.file).toBe('api/API-ARCHIVE-TICKETS.md');
    expect(data.issues).toEqual([]);

    const fetched = await call('get_card', { handle: 'API-ARCHIVE-TICKETS' });
    expect(fetched.data.card.frontmatter.path).toBe('/api/v1/tickets/:id/archive');
  });

  it('create_card rejects bad handles and duplicates', async () => {
    expect((await call('create_card', { handle: 'WIDGET-X' })).isError).toBe(true);
    expect((await call('create_card', { handle: 'API-TICKETS' })).isError).toBe(true);
  });

  it('rejects reserved frontmatter keys inside fields', async () => {
    const created = await call('create_card', {
      handle: 'DOC-RESERVED-FIELDS',
      fields: { status: 'built' },
    });
    expect(created.isError).toBe(true);
    expect(created.data.error.code).toBe('INVALID_FIELDS');

    const updated = await call('update_card', {
      handle: 'DOC-TICKET-LIFECYCLE',
      patch: { fields: { connections: ['API-TICKETS'] } },
    });
    expect(updated.isError).toBe(true);
    expect(updated.data.error.code).toBe('INVALID_FIELDS');
  });

  it('update_card body-only does not reformat frontmatter', async () => {
    const file = path.join(planRoot, 'db', 'DB-TICKETS.md');
    const before = await readFile(file, 'utf8');
    const { data } = await call('update_card', {
      handle: 'DB-TICKETS',
      body: 'Rewritten body only. See [[STATE-TICKET]].',
    });
    expect(data.issues).toEqual([]);
    const after = await readFile(file, 'utf8');
    expect(after.split('---')[1]).toBe(before.split('---')[1]);
    expect(after).toContain('Rewritten body only.');
  });

  it('update_card deep-merges fields and null-deletes', async () => {
    const { data } = await call('update_card', {
      handle: 'EVENT-TICKET-CREATED',
      patch: {
        status: 'verified',
        fields: { version: 2, idempotency_key_field: null },
      },
    });
    expect(data.card.frontmatter.version).toBe(2);
    expect(data.card.frontmatter.idempotency_key_field).toBeUndefined();
    expect(data.card.frontmatter.emitter).toBe('API-TICKETS');
    expect(data.card.status).toBe('verified');
  });

  it('add_connection appends and dedupes; remove_connection reverses it', async () => {
    const added = await call('add_connection', {
      from: 'ROLE-SUPPORT-AGENT',
      to: 'EXTERNAL-EMAIL-PROVIDER',
    });
    expect(added.data.connected).toEqual(['ROLE-SUPPORT-AGENT', 'EXTERNAL-EMAIL-PROVIDER']);

    const again = await call('add_connection', {
      from: 'EXTERNAL-EMAIL-PROVIDER',
      to: 'ROLE-SUPPORT-AGENT',
    });
    expect(again.data.already_connected).toBe(true);

    const removed = await call('remove_connection', {
      a: 'ROLE-SUPPORT-AGENT',
      b: 'EXTERNAL-EMAIL-PROVIDER',
    });
    expect(removed.data.removed_from).toEqual(['ROLE-SUPPORT-AGENT']);
    expect(removed.data.still_connected).toBe(false);
  });

  it('remove_connection reports connections that persist via other sources', async () => {
    const { data } = await call('remove_connection', {
      a: 'API-TICKETS',
      b: 'DATATYPE-TICKET',
    });
    expect(data.still_connected).toBe(true);
    expect(data.remaining_sources.join(' ')).toContain('frontmatter field');
  });

  it('delete_card reports who referenced the deleted card', async () => {
    const { data } = await call('delete_card', { handle: 'TEST-CREATE-TICKET' });
    expect(data.deleted).toBe('TEST-CREATE-TICKET');
    expect(data.referenced_by).toContain('API-TICKETS');
  });
});
