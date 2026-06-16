import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

let base: string;
let webPlan: string;
let serverPlan: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { data: JSON.parse(content[0].text), isError: res.isError === true };
}

const serverUserFile = () => path.join(serverPlan, 'datatype', 'DATATYPE-USER.md');
const webUserFile = () => path.join(webPlan, 'datatype', 'DATATYPE-USER.md');

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'constellation-mcp-repos-'));
  webPlan = path.join(base, 'pyramid-web', 'constellation');
  serverPlan = path.join(base, 'pyramid-server', 'constellation');
  await mkdir(path.join(webPlan, 'datatype'), { recursive: true });
  await mkdir(path.join(serverPlan, 'datatype'), { recursive: true });
  await writeFile(path.join(webPlan, 'plan.md'), '---\nname: Pyramid Web\n---\n\n# Pyramid Web\n');
  await writeFile(
    path.join(serverPlan, 'plan.md'),
    '---\nname: Pyramid Server\n---\n\n# Pyramid Server\n',
  );
  // Same handle in both repos — the collision the `repo` selector must keep distinct.
  await writeFile(webUserFile(), '---\nname: Web User\n---\n\nWEB USER SHAPE\n');
  await writeFile(serverUserFile(), '---\nname: Server User\n---\n\nSERVER USER SHAPE\n');

  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot: webPlan });
  await server.connect(st);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(ct);
});

afterAll(async () => {
  await client.close();
  await rm(base, { recursive: true, force: true });
});

describe('connected repos over MCP', () => {
  it('before linking: list is empty and a plain read is shape-identical to single-repo', async () => {
    const { data: list } = await call('list_connected_repos');
    expect(list.connected_repos).toEqual([]);

    const { data } = await call('get_card', { handle: 'DATATYPE-USER' });
    expect(data.card.body).toContain('WEB USER');
    // Backward-compat: omitting `repo` adds no new top-level keys to the response.
    expect(Object.keys(data).sort()).toEqual(['card', 'connected_cards']);
  });

  it('add_connected_repo declares a sibling on PLAN-PROJECT', async () => {
    const { data } = await call('add_connected_repo', {
      name: 'pyramid-server',
      path: '../pyramid-server',
      description: 'Back-end (Go)',
    });
    expect(data.connected_repos).toEqual([
      { name: 'pyramid-server', path: '../pyramid-server', description: 'Back-end (Go)' },
    ]);
    const { data: list } = await call('list_connected_repos');
    expect(list.connected_repos[0]).toMatchObject({ name: 'pyramid-server', reachable: true });
  });

  it('repo: selector reads the sibling plan, not the home one (collision-safe)', async () => {
    const { data } = await call('get_card', { handle: 'DATATYPE-USER', repo: 'pyramid-server' });
    expect(data.card.body).toContain('SERVER USER');
  });

  it('repo: selector writes the sibling, leaving home untouched', async () => {
    await call('update_card', {
      handle: 'DATATYPE-USER',
      repo: 'pyramid-server',
      patch: { status: 'built' },
    });
    expect(await readFile(serverUserFile(), 'utf8')).toContain('status: built');
    expect(await readFile(webUserFile(), 'utf8')).not.toContain('status:');
  });

  it('omitting repo writes the home repo', async () => {
    await call('update_card', { handle: 'DATATYPE-USER', patch: { status: 'verified' } });
    expect(await readFile(webUserFile(), 'utf8')).toContain('status: verified');
    // sibling unchanged from the previous step
    expect(await readFile(serverUserFile(), 'utf8')).toContain('status: built');
  });

  it('an unknown repo is refused, not silently retargeted', async () => {
    const { data, isError } = await call('get_card', { handle: 'DATATYPE-USER', repo: 'nope' });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('UNKNOWN_REPO');
  });

  it('a declared-but-missing path is never a lint error', async () => {
    await call('add_connected_repo', { name: 'ghost', path: '../nope' });
    const { data } = await call('check_integrity');
    expect(data.errors).toEqual([]);
    const { data: list } = await call('list_connected_repos');
    expect(list.connected_repos.find((r: { name: string }) => r.name === 'ghost')).toMatchObject({
      reachable: false,
    });
  });

  it('reciprocate writes the reverse link into the target repo', async () => {
    const { data } = await call('add_connected_repo', {
      name: 'pyramid-server',
      path: '../pyramid-server',
      description: 'Back-end (Go)',
      reciprocate: true,
    });
    expect(data.reciprocated.ok).toBe(true);
    const serverMd = await readFile(path.join(serverPlan, 'plan.md'), 'utf8');
    expect(serverMd).toContain('pyramid-web');
    expect(serverMd).toContain('../pyramid-web');
  });

  it('connected repo management tools honor the repo selector', async () => {
    await call('add_connected_repo', {
      repo: 'pyramid-server',
      name: 'analytics',
      path: '../analytics',
      description: 'Analytics pipeline',
    });

    const { data: selected } = await call('list_connected_repos', { repo: 'pyramid-server' });
    expect(
      selected.connected_repos.find((r: { name: string }) => r.name === 'analytics'),
    ).toMatchObject({ path: '../analytics', description: 'Analytics pipeline' });

    const { data: home } = await call('list_connected_repos');
    expect(home.connected_repos.some((r: { name: string }) => r.name === 'analytics')).toBe(false);

    await call('remove_connected_repo', { repo: 'pyramid-server', name: 'analytics' });
    const { data: removed } = await call('list_connected_repos', { repo: 'pyramid-server' });
    expect(removed.connected_repos.some((r: { name: string }) => r.name === 'analytics')).toBe(false);
  });

  it('remove_connected_repo drops the link', async () => {
    await call('remove_connected_repo', { name: 'ghost' });
    const { data } = await call('list_connected_repos');
    expect(data.connected_repos.some((r: { name: string }) => r.name === 'ghost')).toBe(false);
  });
});
