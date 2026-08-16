import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, MCP_SERVER_VERSION } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let client: Client;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-orient-'));
  const planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  // A workspace one minor ahead of the running server — the "published server
  // against an unreleased tree" case orient is meant to catch.
  await writeFile(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'orient-fixture', version: '99.0.0' }, null, 2),
  );
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial plan');

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

describe('orient', () => {
  it('briefs the project, the histogram and the rollup in one small response', async () => {
    const data = await call('orient');
    expect(data.plan_root).toBe(path.join(repo, 'constellation'));
    expect(data.project.handle).toBe('PLAN-PROJECT');
    expect(data.project.name).toBe('Ticketing Example');
    // plan.md declares no summary: field, so the body's opening prose stands in.
    expect(data.project.summary).toContain('minimal support-ticket app');
    expect(data.project.summary.length).toBeLessThanOrEqual(301);

    expect(data.cards.total).toBe(25);
    // Only types actually in use appear.
    expect(data.cards.by_type.API).toBe(1);
    expect(data.cards.by_type.NOPE).toBeUndefined();
    expect(Object.values(data.cards.by_type).reduce((a, b) => Number(a) + Number(b), 0)).toBe(
      data.cards.total,
    );
    // The rollup always names every status, including "none".
    expect(Object.keys(data.cards.by_status).sort()).toEqual([
      'building',
      'built',
      'none',
      'planned',
      'verified',
    ]);
  });

  it('never hydrates: no card bodies anywhere in the response', async () => {
    const data = await call('orient');
    expect(JSON.stringify(data)).not.toContain('## Conventions');
    expect(data.cards.cards).toBeUndefined();
  });

  it('summarizes drift instead of dumping the stale table', async () => {
    const data = await call('orient');
    expect(typeof data.stale.count).toBe('number');
    expect(data.stale.handles.length).toBeLessThanOrEqual(5);
    // Handles only — no changed-file lists.
    expect(data.stale.handles.every((h: unknown) => typeof h === 'string')).toBe(true);
  });

  it('surfaces the newest notes across the plan, clipped', async () => {
    for (let i = 0; i < 12; i++) {
      await call('append_note', {
        handle: 'DB-TICKETS',
        kind: 'gotcha',
        text: `note ${i} ${'padding '.repeat(40)}`,
      });
    }
    const data = await call('orient');
    expect(data.recent_notes).toHaveLength(10);
    expect(data.recent_notes[0].handle).toBe('DB-TICKETS');
    expect(data.recent_notes[0].kind).toBe('gotcha');
    // Newest first within a card.
    expect(data.recent_notes[0].text).toContain('note 11');
    for (const note of data.recent_notes) {
      expect(note.text.length).toBeLessThanOrEqual(121);
    }
  });

  it('reports the running server version and warns when the workspace differs', async () => {
    const data = await call('orient');
    expect(data.versions.server).toBe(MCP_SERVER_VERSION);
    expect(data.versions.workspace).toBe('99.0.0');
    expect(data.versions.version_mismatch).toBe(true);
    expect(data.versions.warning).toContain('older');
  });

  it('lists connected repos by name and path only', async () => {
    await call('add_connected_repo', { name: 'sibling', path: '../sibling' });
    const data = await call('orient');
    expect(data.connected_repos).toEqual([{ name: 'sibling', path: '../sibling' }]);
  });
});
