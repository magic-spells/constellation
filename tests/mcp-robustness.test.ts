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
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-robust-'));
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

describe('bulk creation', () => {
  it('create_cards: intra-batch forward references resolve with zero errors', async () => {
    const { data } = await call('create_cards', {
      cards: [
        { handle: 'DOC-ALPHA', connections: ['DOC-BETA'], body: 'Points at beta.' },
        { handle: 'DOC-BETA', body: 'The target.' },
      ],
    });
    expect(data.created).toBe(2);
    expect(data.failed).toEqual([]);
    // DOC-ALPHA → DOC-BETA would be a transient E005 if linted per-write; the
    // single end-of-batch lint sees both, so there are no errors.
    expect(data.issues.filter((i: { severity: string }) => i.severity === 'error')).toEqual([]);
  });

  it('create_cards reports per-item failures without aborting the batch', async () => {
    const { data } = await call('create_cards', {
      cards: [
        { handle: 'widget-bad' },
        { handle: 'DOC-ALPHA' }, // already exists
        { handle: 'DOC-GAMMA', body: 'ok' },
      ],
    });
    expect(data.created).toBe(1);
    const errs = Object.fromEntries(
      data.failed.map((f: { handle: string; error: string }) => [f.handle, f.error]),
    );
    expect(errs['widget-bad']).toBe('INVALID_HANDLE');
    expect(errs['DOC-ALPHA']).toBe('CARD_EXISTS');
  });
});

describe('bulk connections', () => {
  it('add_connections adds and is idempotent', async () => {
    const first = await call('add_connections', {
      connections: [{ from: 'ROLE-SUPPORT-AGENT', to: 'EXTERNAL-EMAIL-PROVIDER' }],
    });
    expect(first.data.added).toBe(1);
    expect(first.data.failed).toEqual([]);

    const again = await call('add_connections', {
      connections: [{ from: 'EXTERNAL-EMAIL-PROVIDER', to: 'ROLE-SUPPORT-AGENT' }],
    });
    expect(again.data.added).toBe(0); // already connected (undirected)
  });

  it('add_connections reports unknown endpoints', async () => {
    const { data } = await call('add_connections', {
      connections: [{ from: 'DOC-ALPHA', to: 'DOC-NOPE' }],
    });
    expect(data.added).toBe(0);
    expect(data.failed[0].error).toContain('NOT_FOUND');
  });
});

describe('create_card validate:false', () => {
  it('writes the card and returns no issues', async () => {
    const { data } = await call('create_card', {
      handle: 'DOC-ORPHAN',
      body: 'A card with no connections.',
      validate: false,
    });
    expect(data.card.handle).toBe('DOC-ORPHAN');
    expect(data.issues).toBeUndefined();
    const fetched = await call('get_card', { handle: 'DOC-ORPHAN' });
    expect(fetched.data.card.handle).toBe('DOC-ORPHAN');
  });
});

describe('orphan detection', () => {
  it('check_integrity lists orphans and list_cards filters by connectedness', async () => {
    const integrity = await call('check_integrity');
    expect(integrity.data.orphans).toContain('DOC-ORPHAN');

    const orphans = await call('list_cards', { connected: false });
    expect(orphans.data.cards.map((c: { handle: string }) => c.handle)).toContain(
      'DOC-ORPHAN',
    );

    const connected = await call('list_cards', { connected: true });
    expect(
      connected.data.cards.map((c: { handle: string }) => c.handle),
    ).not.toContain('DOC-ORPHAN');
    expect(connected.data.cards.map((c: { handle: string }) => c.handle)).toContain(
      'API-TICKETS',
    );
  });
});
