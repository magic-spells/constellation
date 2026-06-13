import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let planRoot: string;
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
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-git-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
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

describe('git tools', () => {
  it('diff_plan is empty on a clean tree (base defaults to HEAD)', async () => {
    const diff = await call('diff_plan');
    expect(diff.base_source).toBe('HEAD');
    expect(diff.changes).toEqual([]);
  });

  it('diff_plan reports modified cards with changed frontmatter keys', async () => {
    await call('update_card', {
      handle: 'DB-TICKETS',
      patch: {
        status: 'verified',
        fields: {
          columns: [{ name: 'id', sql_type: 'UUID', primary_key: true }],
        },
      },
    });
    await call('create_card', { handle: 'DOC-RUNBOOK', body: 'Ops runbook.' });

    const diff = await call('diff_plan');
    const byHandle = Object.fromEntries(
      diff.changes.map((c: { handle: string }) => [c.handle, c]),
    );
    expect(byHandle['DB-TICKETS'].change).toBe('modified');
    expect(byHandle['DB-TICKETS'].changed_keys).toContain('status');
    expect(byHandle['DB-TICKETS'].changed_keys).toContain('columns');
    expect(byHandle['DB-TICKETS'].body_changed).toBe(false);
    expect(byHandle['DOC-RUNBOOK'].change).toBe('added');
  });

  it('set_sync_point moves the default diff base', async () => {
    git('add', '-A');
    git('commit', '-q', '-m', 'plan: verify tickets table, add runbook');
    await call('set_sync_point');

    let diff = await call('diff_plan');
    expect(diff.base_source).toBe('sync-marker');
    expect(diff.changes).toEqual([]);

    await call('update_card', {
      handle: 'DOC-RUNBOOK',
      body: 'Ops runbook, expanded.',
    });
    diff = await call('diff_plan');
    expect(diff.changes.map((c: { handle: string }) => c.handle)).toEqual([
      'DOC-RUNBOOK',
    ]);
    expect(diff.changes[0].body_changed).toBe(true);
    expect(diff.changes[0].changed_keys).toEqual([]);
  });

  it('plan_log returns the commits that touched a card', async () => {
    const log = await call('plan_log', { handle: 'DB-TICKETS' });
    expect(log.commits.length).toBe(2);
    expect(log.commits[0].subject).toContain('verify tickets table');
  });

  it('diff_plan with an explicit base sees the whole history', async () => {
    const first = git('rev-list', '--max-parents=0', 'HEAD').trim();
    const diff = await call('diff_plan', { base: first });
    const handles = diff.changes.map((c: { handle: string }) => c.handle);
    expect(handles).toContain('DB-TICKETS');
    expect(handles).toContain('DOC-RUNBOOK');
    expect(diff.base_source).toBe('argument');
  });

  it('set_sync_point warns when the plan has uncommitted changes, not after a commit', async () => {
    await call('update_card', { handle: 'DOC-RUNBOOK', body: 'Uncommitted edit.' });
    const dirty = await call('set_sync_point');
    expect(dirty.warning).toBeTruthy();
    expect(dirty.warning).toContain('uncommitted');

    git('add', '-A');
    git('commit', '-q', '-m', 'commit plan before sync');
    const clean = await call('set_sync_point');
    expect(clean.warning).toBeUndefined();
  });
});
