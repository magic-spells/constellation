import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/serve/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let dir: string;
let planRoot: string;
let running: RunningServer;
let readonlyServer: RunningServer;

function api(p: string, init?: RequestInit) {
  return fetch(`http://localhost:${running.port}${p}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

async function getCard(handle: string) {
  const res = await api('/api/plan');
  const data = await res.json();
  return data.cards.find((c: { handle: string }) => c.handle === handle);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-edit-'));
  planRoot = path.join(dir, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  running = await startServer({ planRoot, port: 0 });
  readonlyServer = await startServer({ planRoot, port: 0, readonly: true });
});

afterAll(async () => {
  await running.close();
  await readonlyServer.close();
  await rm(dir, { recursive: true, force: true });
});

describe('write endpoints', () => {
  it('body-only PATCH preserves frontmatter bytes exactly', async () => {
    const file = path.join(planRoot, 'db', 'DB-TICKETS.md');
    const before = await readFile(file, 'utf8');
    const res = await api('/api/card/DB-TICKETS', {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Edited from the viewer. See [[STATE-TICKET]].' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issues).toEqual([]);
    const after = await readFile(file, 'utf8');
    expect(after.split('---')[1]).toBe(before.split('---')[1]);
    expect(after).toContain('Edited from the viewer.');
  });

  it('PATCH deep-merges fields, sets reserved keys, null deletes', async () => {
    const res = await api('/api/card/EVENT-TICKET-CREATED', {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'building',
        fields: { version: 3, ordering: null },
      }),
    });
    const { card } = await res.json();
    expect(card.status).toBe('building');
    expect(card.frontmatter.version).toBe(3);
    expect(card.frontmatter.ordering).toBeUndefined();
    expect(card.frontmatter.emitter).toBe('API-TICKETS');
  });

  it('rejects reserved frontmatter keys inside fields', async () => {
    const patched = await api('/api/card/EVENT-TICKET-CREATED', {
      method: 'PATCH',
      body: JSON.stringify({
        fields: { status: 'verified' },
      }),
    });
    expect(patched.status).toBe(400);
    expect((await patched.json()).error.code).toBe('INVALID_FIELDS');

    const created = await api('/api/cards', {
      method: 'POST',
      body: JSON.stringify({
        handle: 'DOC-BAD-FIELDS',
        fields: { connections: ['API-TICKETS'] },
      }),
    });
    expect(created.status).toBe(400);
    expect((await created.json()).error.code).toBe('INVALID_FIELDS');
  });

  it('PATCH with stale if_mtime returns 409', async () => {
    const card = await getCard('API-TICKETS');
    const res = await api('/api/card/API-TICKETS', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'clobbered', if_mtime: card.mtime - 5000 }),
    });
    expect(res.status).toBe(409);
    const fresh = await api('/api/card/API-TICKETS', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Tickets API (renamed)', if_mtime: card.mtime }),
    });
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).card.name).toBe('Tickets API (renamed)');
  });

  it('PATCH reports lint issues for the edited file', async () => {
    const res = await api('/api/card/DOC-TICKET-LIFECYCLE', {
      method: 'PATCH',
      body: JSON.stringify({ connections: ['API-DOES-NOT-EXIST'] }),
    });
    const data = await res.json();
    expect(data.issues.map((i: { code: string }) => i.code)).toContain('E005');
    // revert
    await api('/api/card/DOC-TICKET-LIFECYCLE', {
      method: 'PATCH',
      body: JSON.stringify({ connections: null }),
    });
  });

  it('POST creates a card in the right folder; DELETE removes it', async () => {
    const created = await api('/api/cards', {
      method: 'POST',
      body: JSON.stringify({
        handle: 'DOC-EDITING-GUIDE',
        name: 'Editing guide',
        body: 'Click anything to edit it.',
      }),
    });
    expect(created.status).toBe(201);
    const data = await created.json();
    expect(data.card.relPath).toBe('doc/DOC-EDITING-GUIDE.md');
    expect(data.issues).toEqual([]);

    const bad = await api('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ handle: 'widget-thing' }),
    });
    expect(bad.status).toBe(400);

    const deleted = await api('/api/card/DOC-EDITING-GUIDE', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await getCard('DOC-EDITING-GUIDE')).toBeUndefined();
  });

  it('readonly server refuses writes and reports editable: false', async () => {
    const plan = await fetch(`http://localhost:${readonlyServer.port}/api/plan`);
    expect((await plan.json()).editable).toBe(false);
    const res = await fetch(
      `http://localhost:${readonlyServer.port}/api/card/DB-TICKETS`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'nope' }),
      },
    );
    expect(res.status).toBe(405);
  });

  it('editable server reports editable: true with card mtimes', async () => {
    const res = await api('/api/plan');
    const data = await res.json();
    expect(data.editable).toBe(true);
    expect(data.cards[0].mtime).toBeGreaterThan(0);
  });
});
