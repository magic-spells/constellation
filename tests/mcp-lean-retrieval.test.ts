import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildServer,
  HYDRATION_PER_CARD_MAX,
  HYDRATION_TOTAL_MAX,
} from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { data: JSON.parse(content[0].text), isError: res.isError === true };
}

type View = {
  handle: string;
  body?: string;
  edge_sources?: string[];
  degraded_to_summary?: string;
  hydrated_elsewhere?: boolean;
};

const byHandle = (views: View[]) =>
  Object.fromEntries(views.map((v) => [v.handle, v])) as Record<string, View>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-lean-'));
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

describe('edge provenance', () => {
  it('get_card lists every connection, tagged with where it came from', async () => {
    const { data } = await call('get_card', { handle: 'API-TICKETS' });
    const conns = byHandle(data.connected_cards);
    // A connections: entry only.
    expect(conns['DB-TICKETS'].edge_sources).toEqual(['structured']);
    // Declared in connections: AND written as a [[link]] — one edge, both sources.
    expect(conns['FILE-TICKETS-ROUTE'].edge_sources).toEqual(['structured', 'prose']);
    // Only a mermaid node ID.
    expect(conns['DIAGRAM-SYSTEM-OVERVIEW'].edge_sources).toEqual(['prose']);
  });

  it('traverse walks structured edges by default and prose only on request', async () => {
    const structured = await call('traverse', { start: 'API-TICKETS', depth: 1 });
    const handles = structured.data.cards.map((c: View) => c.handle);
    expect(structured.data.edges).toBe('structured');
    expect(handles).toContain('DB-TICKETS');
    // The system diagram names API-TICKETS in mermaid only — a prose edge, and
    // the supernode that used to drag half the plan into a depth-2 walk.
    expect(handles).not.toContain('DIAGRAM-SYSTEM-OVERVIEW');
    expect(handles).not.toContain('DOC-TICKET-LIFECYCLE');

    const both = await call('traverse', {
      start: 'API-TICKETS',
      depth: 1,
      edges: 'both',
    });
    const bothHandles = both.data.cards.map((c: View) => c.handle);
    expect(bothHandles).toContain('DIAGRAM-SYSTEM-OVERVIEW');
    expect(bothHandles).toContain('DOC-TICKET-LIFECYCLE');
    expect(both.data.cards.length).toBeGreaterThan(structured.data.cards.length);
  });

  it('returned connections carry their sources', async () => {
    const { data } = await call('traverse', {
      start: 'API-TICKETS',
      depth: 1,
      edges: 'both',
    });
    const edge = data.connections.find(
      (c: { a: string; b: string; sources: string[] }) =>
        (c.a === 'API-TICKETS' && c.b === 'DIAGRAM-SYSTEM-OVERVIEW') ||
        (c.b === 'API-TICKETS' && c.a === 'DIAGRAM-SYSTEM-OVERVIEW'),
    );
    expect(edge.sources).toEqual(['prose']);
  });
});

describe('neighbor hydration limits', () => {
  it('never hydrates a DIAGRAM as a neighbor, but hands it over in full when asked directly', async () => {
    const neighbor = await call('get_card', {
      handle: 'API-TICKETS',
      connected: 'full',
    });
    const diagram = byHandle(neighbor.data.connected_cards)['DIAGRAM-SYSTEM-OVERVIEW'];
    expect(diagram.body).toBeUndefined();
    expect(diagram.degraded_to_summary).toBe('supernode');
    expect(neighbor.data.hydration_budget.degraded).toContain('DIAGRAM-SYSTEM-OVERVIEW');

    const direct = await call('get_card', { handle: 'DIAGRAM-SYSTEM-OVERVIEW' });
    expect(direct.data.card.body).toContain('flowchart LR');
  });

  it('never hydrates PLAN-PROJECT as a neighbor', async () => {
    const { data } = await call('traverse', {
      start: 'PAGE-INBOX',
      depth: 2,
      detail: 'full',
      edges: 'both',
    });
    const plan = byHandle(data.cards)['PLAN-PROJECT'];
    expect(plan).toBeDefined();
    expect(plan.body).toBeUndefined();
    expect(plan.degraded_to_summary).toBe('supernode');
    // Asked for by name it is never degraded.
    const direct = await call('traverse', {
      start: 'PLAN-PROJECT',
      depth: 0,
      detail: 'full',
    });
    expect(direct.data.cards[0].body.length).toBeGreaterThan(0);
  });
});

describe('hydration dedupe', () => {
  it('spells a card out once per response, then references it by handle', async () => {
    const { data } = await call('search', {
      q: 'ticket',
      connected: 'full',
      limit: 20,
    });
    const seen = new Map<string, number>();
    for (const match of data.matches) {
      for (const conn of match.connected_cards as View[]) {
        if (conn.body !== undefined) seen.set(conn.handle, (seen.get(conn.handle) ?? 0) + 1);
      }
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(data.hydration_budget.deduped.length).toBeGreaterThan(0);
    // Every repeat still identifies itself.
    const repeats = data.matches.flatMap((m: { connected_cards: View[] }) =>
      m.connected_cards.filter((c) => c.hydrated_elsewhere),
    );
    expect(repeats.length).toBeGreaterThan(0);
  });

  it('assemble hydration:"full" hydrates each seed once across every unit', async () => {
    const { data } = await call('assemble', {
      handles: ['API-TICKETS', 'DB-TICKETS'],
      hydration: 'full',
    });
    const hydrated: string[] = [];
    for (const unit of data.units) {
      for (const card of unit.cards) {
        if (card.body !== undefined) hydrated.push(card.handle);
        for (const conn of card.connected_cards as View[]) {
          if (conn.body !== undefined) hydrated.push(conn.handle);
        }
      }
    }
    expect(new Set(hydrated).size).toBe(hydrated.length);
    // The seeds themselves always win their own full content.
    expect(hydrated).toContain('API-TICKETS');
    expect(hydrated).toContain('DB-TICKETS');
  });
});

describe('hydration text budget', () => {
  it('degrades oversize and over-budget neighbors to summaries instead of truncating', async () => {
    const big = 'x '.repeat(11_000); // ~22KB per card, under the per-card cap
    await call('create_card', {
      handle: 'DOC-BUDGET-HUB',
      body: 'Hub for the budget test.',
    });
    for (let i = 0; i < 6; i++) {
      await call('create_card', {
        handle: `DOC-BUDGET-${i}`,
        connections: ['DOC-BUDGET-HUB'],
        body: `${big}\n`,
      });
    }
    await call('create_card', {
      handle: 'DOC-BUDGET-HUGE',
      connections: ['DOC-BUDGET-HUB'],
      body: 'y '.repeat(HYDRATION_PER_CARD_MAX), // well past the per-card cap
    });

    const { data } = await call('get_card', {
      handle: 'DOC-BUDGET-HUB',
      connected: 'full',
    });
    const conns = byHandle(data.connected_cards);
    expect(conns['DOC-BUDGET-HUGE'].body).toBeUndefined();
    expect(conns['DOC-BUDGET-HUGE'].degraded_to_summary).toBe('over per-card cap');

    const budget = data.hydration_budget;
    expect(budget.budget_exhausted).toBe(true);
    expect(budget.total_max_bytes).toBe(HYDRATION_TOTAL_MAX);
    expect(budget.hydrated_bytes).toBeLessThanOrEqual(HYDRATION_TOTAL_MAX);
    expect(budget.degraded).toContain('DOC-BUDGET-HUGE');
    // Whatever survived is whole — degraded cards carry no partial body.
    for (const conn of data.connected_cards as View[]) {
      if (conn.degraded_to_summary) expect(conn.body).toBeUndefined();
    }
  });
});

describe('assemble is an index by default', () => {
  it('returns units, bound paths and deduped neighbor summaries, with no bodies', async () => {
    const { data } = await call('assemble', {
      handles: ['API-TICKETS', 'DB-TICKETS'],
      depth: 1,
    });
    expect(data.hydration).toBe('index');
    expect(data.edges).toBe('structured');
    const cards = data.units.flatMap((u: { cards: View[] }) => u.cards);
    for (const card of cards) {
      expect(card.body).toBeUndefined();
      expect((card as { connected_cards?: unknown }).connected_cards).toBeUndefined();
      // Bound paths, never contents — index mode is code: "paths".
      expect(
        (card as { code: { files: Array<{ content?: string }> } }).code.files.every(
          (f) => !f.content,
        ),
      ).toBe(true);
    }
    const api = cards.find((c: View) => c.handle === 'API-TICKETS') as unknown as {
      code: { files: Array<{ path: string }> };
    };
    expect(api.code.files.map((f) => f.path)).toContain('src/api/tickets.ts');
    const neighborHandles = data.neighbors.map((n: View) => n.handle);
    expect(new Set(neighborHandles).size).toBe(neighborHandles.length);
    expect(neighborHandles).not.toContain('API-TICKETS');
    expect(data.neighbors.every((n: { name?: string; type: string }) => 'type' in n)).toBe(
      true,
    );
    expect(data.next).toContain('get_card');
  });

  it('depth widens the walk, not what gets serialized', async () => {
    const shallow = await call('assemble', { handles: ['API-TICKETS'], depth: 1 });
    const deep = await call('assemble', { handles: ['API-TICKETS'], depth: 3 });
    expect(deep.data.reached_handles.length).toBeGreaterThan(
      shallow.data.reached_handles.length,
    );
    expect(deep.data.units[0].handles).toEqual(shallow.data.units[0].handles);
    expect(deep.data.units[0].files).toEqual(shallow.data.units[0].files);
  });

  it('hydration:"full" brings the bodies back', async () => {
    const { data } = await call('assemble', {
      handles: ['API-TICKETS'],
      hydration: 'full',
    });
    expect(data.hydration).toBe('full');
    expect(data.units[0].cards[0].body).toContain('Tickets API');
    expect(data.units[0].cards[0].connected_cards.length).toBeGreaterThan(0);
  });
});
