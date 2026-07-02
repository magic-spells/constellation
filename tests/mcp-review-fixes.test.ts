import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let client: Client;
let head: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { data: JSON.parse(content[0].text), isError: res.isError === true };
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-fixes-'));
  const planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  await mkdir(path.join(repo, 'src', 'api'), { recursive: true });
  await writeFile(
    path.join(repo, 'src', 'api', 'tickets.ts'),
    'export function listTickets() { return []; }\n',
    'utf8',
  );
  // A text file over the 64KB per-file attach cap.
  await writeFile(
    path.join(repo, 'src', 'api', 'big.ts'),
    `// HEAD_MARKER\n${'export const filler = 1;\n'.repeat(4000)}`,
    'utf8',
  );
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  head = git('rev-parse', 'HEAD').trim();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await rm(repo, { recursive: true, force: true });
});

describe('assemble reports unknown seed handles', () => {
  it('lists the misses in not_found instead of dropping them silently', async () => {
    const res = await call('assemble', { handles: ['API-TICKETS', 'API-NOPE'] });
    expect(res.data.seeds).toEqual(['API-TICKETS']);
    expect(res.data.not_found).toEqual(['API-NOPE']);
  });
});

describe('code attach truncates over-cap files instead of skipping them', () => {
  it('attaches the head with truncated:true', async () => {
    await call('create_card', {
      handle: 'COMPONENT-BIGFILE',
      fields: { code_refs: ['src/api/big.ts'] },
      body: 'Bound to a big file.',
    });
    const res = await call('get_card', { handle: 'COMPONENT-BIGFILE', code: 'direct' });
    const file = res.data.code.files.find(
      (f: { path: string }) => f.path === 'src/api/big.ts',
    );
    expect(file.exists).toBe(true);
    expect(file.skipped).toBeUndefined();
    expect(file.truncated).toBe(true);
    expect(file.content).toContain('HEAD_MARKER');
    expect(file.content.length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('set_verified baseline hygiene', () => {
  it('normalizes a short sha to the full commit sha', async () => {
    const res = await call('set_verified', {
      handle: 'API-TICKETS',
      sha: head.slice(0, 7),
    });
    expect(res.data.verified_sha).toBe(head);
    expect(res.data.warning).toBeUndefined();
  });

  it('warns when the sha does not resolve to a commit, but still stamps it', async () => {
    const res = await call('set_verified', {
      handle: 'DB-TICKETS',
      sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    expect(res.data.warning).toContain('does not resolve');
    expect(res.data.card.frontmatter.verified_sha).toBe(
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
  });

  it('warns when a bound file has uncommitted changes the baseline misses', async () => {
    await writeFile(
      path.join(repo, 'src', 'api', 'tickets.ts'),
      'export function listTickets() { return [1]; } // dirty\n',
      'utf8',
    );
    const res = await call('set_verified', { handle: 'API-TICKETS' });
    expect(res.data.warning).toContain('uncommitted changes');
    expect(res.data.warning).toContain('src/api/tickets.ts');
  });
});

describe('status filters (backlog view)', () => {
  beforeAll(async () => {
    await call('create_cards', {
      cards: [
        { handle: 'API-BACKLOG-A', status: 'planned', body: 'a' },
        { handle: 'API-BACKLOG-B', status: 'building', body: 'b' },
        { handle: 'API-BACKLOG-C', body: 'c' }, // no status at all
        { handle: 'API-BACKLOG-D', status: 'built', body: 'd' },
      ],
    });
  });

  it('list_cards accepts a status list and the "none" sentinel', async () => {
    const backlog = await call('list_cards', {
      types: ['API'],
      status: ['planned', 'building', 'none'],
    });
    const handles = backlog.data.cards.map((c: { handle: string }) => c.handle);
    expect(handles).toContain('API-BACKLOG-A');
    expect(handles).toContain('API-BACKLOG-B');
    expect(handles).toContain('API-BACKLOG-C');
    expect(handles).not.toContain('API-BACKLOG-D');

    const unset = await call('list_cards', { types: ['API'], status: 'none' });
    const unsetHandles = unset.data.cards.map((c: { handle: string }) => c.handle);
    expect(unsetHandles).toContain('API-BACKLOG-C');
    expect(unsetHandles).not.toContain('API-BACKLOG-A');
    expect(unsetHandles).not.toContain('API-BACKLOG-D');
  });

  it('traverse status is a post-filter: a built hub does not hide planned work', async () => {
    await call('create_cards', {
      cards: [
        { handle: 'DB-TRAV-HUB', status: 'built', body: 'hub' },
        {
          handle: 'API-TRAV-A',
          status: 'planned',
          connections: ['DB-TRAV-HUB'],
          body: 'start',
        },
        {
          handle: 'DATATYPE-TRAV-C',
          status: 'planned',
          connections: ['DB-TRAV-HUB'],
          body: 'behind the hub',
        },
      ],
    });
    const res = await call('traverse', {
      start: 'API-TRAV-A',
      depth: 2,
      status: ['planned'],
    });
    const handles = res.data.cards.map((c: { handle: string }) => c.handle);
    // DATATYPE-TRAV-C is only reachable THROUGH the built hub — it must still
    // be returned, while the hub itself is filtered out of the result.
    expect(handles).toContain('DATATYPE-TRAV-C');
    expect(handles).not.toContain('DB-TRAV-HUB');
    const endpoints = res.data.connections.flatMap((c: { a: string; b: string }) => [
      c.a,
      c.b,
    ]);
    expect(endpoints).not.toContain('DB-TRAV-HUB');
  });
});
