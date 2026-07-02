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
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-rename-'));
  planRoot = path.join(dir, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  // A small neighborhood that references API-OLDNAME every way a card can:
  // connections list, [[body link]], prose mention, mermaid node, frontmatter value.
  await call('create_cards', {
    cards: [
      { handle: 'API-OLDNAME', name: 'Old endpoint', body: 'The endpoint.' },
      {
        handle: 'PAGE-RENAME-CALLER',
        connections: ['API-OLDNAME'],
        body: 'Calls [[API-OLDNAME]] and mentions API-OLDNAME in prose. API-OLDNAMES is a different handle and must survive.',
      },
      {
        handle: 'FLOW-RENAME-PATH',
        body: 'The path.\n\n```mermaid\ngraph TD\n  API-OLDNAME --> DB-TICKETS\n```\n',
      },
      {
        handle: 'DATATYPE-RENAME-REF',
        fields: { response_of: 'API-OLDNAME' },
        body: 'Shape.',
      },
    ],
  });
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('rename_card', () => {
  it('renames the file and rewrites every kind of reference, whole-token only', async () => {
    const res = await call('rename_card', { from: 'API-OLDNAME', to: 'API-NEWNAME' });
    expect(res.isError).toBe(false);
    expect(res.data.renamed).toEqual({ from: 'API-OLDNAME', to: 'API-NEWNAME' });
    expect(res.data.file).toBe(path.join('api', 'API-NEWNAME.md'));
    expect(res.data.references_updated).toEqual([
      'DATATYPE-RENAME-REF',
      'FLOW-RENAME-PATH',
      'PAGE-RENAME-CALLER',
    ]);

    // Old handle is gone; new one resolves.
    const old = await call('get_card', { handle: 'API-OLDNAME' });
    expect(old.isError).toBe(true);
    const renamed = await call('get_card', { handle: 'API-NEWNAME' });
    expect(renamed.isError).toBe(false);

    // Connections list + body link + prose rewritten; the near-miss handle survived.
    const caller = await call('get_card', { handle: 'PAGE-RENAME-CALLER' });
    expect(caller.data.card.frontmatter.connections).toContain('API-NEWNAME');
    expect(caller.data.card.body).toContain('[[API-NEWNAME]]');
    expect(caller.data.card.body).toContain('API-OLDNAMES is a different handle');
    expect(caller.data.card.body).not.toMatch(/API-OLDNAME(?!S)/);

    // Mermaid node and frontmatter value rewritten.
    const flow = await call('get_card', { handle: 'FLOW-RENAME-PATH' });
    expect(flow.data.card.body).toContain('API-NEWNAME --> DB-TICKETS');
    const datatype = await call('get_card', { handle: 'DATATYPE-RENAME-REF' });
    expect(datatype.data.card.frontmatter.response_of).toBe('API-NEWNAME');

    // No structural errors were introduced — every rewritten ref resolves.
    const integrity = await call('check_integrity');
    const messages = (integrity.data.errors as Array<{ message: string }>).map(
      (e) => e.message,
    );
    expect(messages.filter((m) => m.includes('API-OLDNAME'))).toEqual([]);
  });

  it('refuses a collision, an invalid handle, and PLAN-PROJECT', async () => {
    const collision = await call('rename_card', {
      from: 'PAGE-RENAME-CALLER',
      to: 'API-NEWNAME',
    });
    expect(collision.isError).toBe(true);
    expect(collision.data.error.code).toBe('CARD_EXISTS');

    const invalid = await call('rename_card', {
      from: 'API-NEWNAME',
      to: 'BOGUS-THING',
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.data.error.code).toBe('INVALID_HANDLE');

    const root = await call('rename_card', { from: 'PLAN-PROJECT', to: 'PLAN-OTHER' });
    expect(root.isError).toBe(true);
    expect(root.data.error.code).toBe('INVALID_HANDLE');
  });

  it('a cross-type rename moves the file to the new type folder', async () => {
    const res = await call('rename_card', { from: 'API-NEWNAME', to: 'JOB-NEWNAME' });
    expect(res.isError).toBe(false);
    expect(res.data.file).toBe(path.join('job', 'JOB-NEWNAME.md'));
    expect(res.data.card.type).toBe('JOB');

    const raw = await readFile(path.join(planRoot, 'job', 'JOB-NEWNAME.md'), 'utf8');
    expect(raw).toContain('Old endpoint'); // original bytes moved, not re-serialized

    const caller = await call('get_card', { handle: 'PAGE-RENAME-CALLER' });
    expect(caller.data.card.frontmatter.connections).toContain('JOB-NEWNAME');
  });
});
