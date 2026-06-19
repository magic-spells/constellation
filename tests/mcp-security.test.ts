import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let outside: string;
let planRoot: string;
let client: Client;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { data: JSON.parse(content[0].text), isError: res.isError === true };
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-sec-'));
  outside = await mkdtemp(path.join(tmpdir(), 'constellation-outside-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  await mkdir(path.join(repo, 'src', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'api', 'tickets.ts'), 'export const v = 1;\n', 'utf8');

  // A secret OUTSIDE the repo, and a repo-internal symlink that points at it.
  await writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET\n', 'utf8');
  await symlink(path.join(outside, 'secret.txt'), path.join(repo, 'leak.txt'));

  // FILE cards binding to the symlink and to a path that escapes via `..`.
  await writeFile(
    path.join(planRoot, 'file', 'FILE-LEAK.md'),
    '---\nname: Leak\npath: leak.txt\n---\n\nbound to a symlink that escapes the repo\n',
    'utf8',
  );
  await writeFile(
    path.join(planRoot, 'file', 'FILE-ESCAPE.md'),
    '---\nname: Escape\npath: ../escape.txt\n---\n\nbound to a path that escapes via ..\n',
    'utf8',
  );

  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await rm(repo, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('git argument injection is blocked', () => {
  it('a dash-leading base cannot make git write an arbitrary file', async () => {
    const pwned = path.join(repo, 'PWNED');
    const res = await call('diff_plan', { base: `--output=${pwned}` });
    expect(res.isError).toBe(true);
    expect(existsSync(pwned)).toBe(false);
  });

  it('assemble rejects a dash-leading base too', async () => {
    const pwned = path.join(repo, 'PWNED2');
    const res = await call('assemble', { base: `--output=${pwned}` });
    expect(res.isError).toBe(true);
    expect(existsSync(pwned)).toBe(false);
  });
});

describe('code attach path containment', () => {
  it('refuses a symlink that escapes the repo root', async () => {
    const res = await call('get_card', { handle: 'FILE-LEAK', code: 'direct' });
    const file = res.data.code.files.find((f: { path: string }) => f.path === 'leak.txt');
    expect(file).toBeDefined();
    expect(file.content).toBeUndefined();
    expect(file.skipped).toBe('symlink escapes repo root');
  });

  it('refuses a path that escapes the repo root via ..', async () => {
    const res = await call('get_card', { handle: 'FILE-ESCAPE', code: 'direct' });
    const file = res.data.code.files.find((f: { path: string }) => f.path === '../escape.txt');
    expect(file).toBeDefined();
    expect(file.content).toBeUndefined();
    expect(file.skipped).toBe('outside repo root');
  });
});

describe('stale_report no_baseline (before any marker)', () => {
  it('reports built+bound cards that have no verified_sha and no marker', async () => {
    const res = await call('stale_report');
    const noBaseline = res.data.no_baseline.map((n: { handle: string }) => n.handle);
    // API-TICKETS is status built and bound to src/api/tickets.ts, but unverified.
    expect(noBaseline).toContain('API-TICKETS');
  });
});

describe('check_sync state transitions + assemble delta mode', () => {
  it('clean tree with no marker is never-synced and assembles nothing', async () => {
    const sync = await call('check_sync');
    expect(sync.data.state).toBe('never-synced');

    const asm = await call('assemble');
    expect(asm.data.units).toEqual([]);
    expect(asm.data.note).toContain('nothing to assemble');
  });

  it('after set_sync_point on a clean tree, state is in-sync', async () => {
    await call('set_sync_point');
    const sync = await call('check_sync');
    expect(sync.data.state).toBe('in-sync');
  });

  it('a code commit after the marker makes it drifted', async () => {
    await writeFile(path.join(repo, 'src', 'api', 'tickets.ts'), 'export const v = 2;\n', 'utf8');
    git('add', '-A');
    git('commit', '-q', '-m', 'change code');
    const sync = await call('check_sync');
    expect(sync.data.state).toBe('drifted');
  });

  it('assemble delta mode seeds from the plan changes since the marker', async () => {
    await call('update_card', { handle: 'DB-TICKETS', patch: { status: 'verified' } });
    const asm = await call('assemble');
    expect(asm.data.seeds).toContain('DB-TICKETS');
  });
});
