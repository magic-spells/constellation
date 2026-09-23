import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-working-mcp-'));
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

afterEach(async () => {
  await client.close();
  await rm(repo, { recursive: true, force: true });
});

describe('working memory over MCP', () => {
  it('lists nothing but a hint before the folder exists, and orient omits it', async () => {
    const list = await call('working_list');
    expect(list.exists).toBe(false);
    expect(list.items).toEqual([]);
    expect(list.hint).toContain('working_init');

    const orient = await call('orient');
    expect(orient.working).toBeUndefined();
  });

  it('working_init creates the folder, the ignore lines and (opt-in) the hook', async () => {
    const first = await call('working_init');
    expect(first.gitignore).toBe('added');
    expect(first.hook).toBeUndefined();
    expect(first.created.some((f: string) => f.endsWith('CLAUDE.md'))).toBe(true);

    const again = await call('working_init', { hook: true });
    expect(again.created).toEqual([]);
    expect(again.gitignore).toBe('present');
    expect(again.hook).toBe('installed');

    const settings = JSON.parse(
      await readFile(path.join(repo, '.claude', 'settings.json'), 'utf8'),
    );
    expect(settings.hooks.SessionStart[0].matcher).toBe('startup|resume|compact|clear');

    const third = await call('working_init', { hook: true });
    expect(third.hook).toBe('present');
  });

  it('sets a batch, returns the new header, and embeds the set in orient', async () => {
    await call('working_init');
    const set = await call('working_set', {
      items: [
        { type: 'G', importance: 5, text: 'Ship working memory' },
        { type: 'T', importance: 4, text: 'Stripe webhook — wt stripe, 148846a, opus a2c1 → merge' },
      ],
    });
    expect(set.ids).toEqual(['G1', 'T1']);
    expect(set.header.next).toMatchObject({ G: 2, T: 2 });
    expect(set.warnings).toEqual([]);

    const orient = await call('orient');
    expect(orient.working.items.map((i: { id: string }) => i.id)).toEqual(['G1', 'T1']);
    expect(orient.working.header.branch).toBe('main');
    // orient stays a briefing: the working set is the set, not the file.
    expect(orient.working.text).toBeUndefined();
  });

  it('updates by id, refuses a type change, and supersedes FOCUS', async () => {
    await call('working_init');
    await call('working_set', { items: [{ type: 'T', text: 'first' }] });
    const updated = await call('working_set', {
      items: [{ id: 'T1', importance: 5, text: 'first, revised' }],
    });
    expect(updated.ids).toEqual(['T1']);

    const wrong = await call('working_set', { items: [{ id: 'T1', type: 'G', text: 'nope' }] });
    expect(wrong.error.code).toBe('TYPE_IMMUTABLE');

    await call('working_set', { items: [{ type: 'F', text: 'step one' }] });
    const second = await call('working_set', { items: [{ type: 'F', text: 'step two' }] });
    expect(second.superseded).toEqual(['F1']);
    const list = await call('working_list');
    expect(list.items.filter((i: { type: string }) => i.type === 'F')).toHaveLength(1);
  });

  it('drops with a reason and the reason lands in today\'s log', async () => {
    await call('working_init');
    await call('working_set', {
      items: [
        { type: 'T', text: 'a' },
        { type: 'T', text: 'b' },
      ],
    });
    const dropped = await call('working_drop', { ids: ['T1', 'T2'], reason: 'merged' });
    expect(dropped.dropped).toEqual(['T1', 'T2']);
    expect(dropped.logged).toBe(true);

    const list = await call('working_list', { log: 'today' });
    expect(list.items).toEqual([]);
    expect(list.log).toEqual([expect.stringMatching(/drop T1, T2 — merged$/)]);

    const missing = await call('working_drop', { ids: ['T9'] });
    expect(missing.error.code).toBe('NOT_FOUND');
  });

  it('working_log appends a line a sub-agent can leave behind', async () => {
    await call('working_init');
    const logged = await call('working_log', { text: 'opus a2c1: review clean, ready to merge' });
    expect(logged.path.endsWith('.md')).toBe(true);
    const list = await call('working_list', { log: 5 });
    expect(list.log).toEqual([expect.stringContaining('review clean')]);
  });

  it('rejects a newline and warns about a long line without refusing it', async () => {
    await call('working_init');
    const bad = await call('working_set', { items: [{ type: 'T', text: 'one\ntwo' }] });
    expect(bad.error.code).toBe('BAD_TEXT');

    const long = await call('working_set', { items: [{ type: 'T', text: 'x'.repeat(200) }] });
    expect(long.warnings).toEqual(['long: T1']);
    expect((await call('working_list')).items).toHaveLength(1);
  });

  it('errors with a hint when the folder is missing', async () => {
    const result = await call('working_set', { items: [{ type: 'T', text: 'x' }] });
    expect(result.error.code).toBe('NO_WORKING_FOLDER');
    expect(result.error.message).toContain('working_init');
  });

  it('init_plan creates working memory by default and skips it on request', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'constellation-working-init-'));
    try {
      const withWorking = await call('init_plan', { path: path.join(bare, 'a'), name: 'A' });
      expect(withWorking.working.gitignore).toBe('added');
      expect(
        await readFile(path.join(bare, 'a', '.constellation', 'working.md'), 'utf8'),
      ).toMatch(/^Updated /);
      // The hook is never installed implicitly.
      await expect(
        readFile(path.join(bare, 'a', '.claude', 'settings.json'), 'utf8'),
      ).rejects.toThrow();

      const without = await call('init_plan', {
        path: path.join(bare, 'b'),
        name: 'B',
        working: false,
      });
      expect(without.working).toBeUndefined();
      await expect(
        readFile(path.join(bare, 'b', '.constellation', 'working.md'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('keeps hand-written lines in the file byte-for-byte', async () => {
    await call('working_init');
    const file = path.join(repo, '.constellation', 'working.md');
    await writeFile(
      file,
      'Updated 2026-01-01 00:00 · next G1 C1 P1 F1 T1 Q1 I1 D1\n\n## CONSTRAINT\n- C1 [5] "never tag or publish"\n\n<!-- a note somebody left -->\n## TASK\n- T1 [3] hold this\n',
      'utf8',
    );
    await call('working_set', { items: [{ type: 'T', text: 'and this' }] });
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('- C1 [5] "never tag or publish"');
    expect(raw).toContain('<!-- a note somebody left -->');
    expect(raw).toContain('- T2 [3] and this');
    expect(raw.split('\n')[0]).toMatch(/^Updated \d{4}-\d\d-\d\d \d\d:\d\d · branch `main`/);
  });

  it('repo: still selects another plan for the working tools', async () => {
    const other = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-working-other-')));
    try {
      await cp(GOLDEN, path.join(other, 'constellation'), { recursive: true });
      await call('working_init', { repo: other });
      await call('working_set', { repo: other, items: [{ type: 'T', text: 'over there' }] });
      expect(
        await readFile(path.join(other, '.constellation', 'working.md'), 'utf8'),
      ).toContain('- T1 [3] over there');
      expect((await call('working_list')).exists).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('repo: a path to a repo with no plan anchors at its git root', async () => {
    const other = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-working-bare-')));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other });
      const init = await call('working_init', { repo: other });
      expect(init.dir).toBe(path.join(other, '.constellation'));
      await call('working_set', { repo: other, items: [{ type: 'T', text: 'site work' }] });
      const list = await call('working_list', { repo: other });
      expect(list.items.map((i: { text: string }) => i.text)).toEqual(['site work']);
      // A name that is neither a connected repo nor a directory still errors.
      const unknown = await call('working_list', { repo: 'no-such-repo' });
      expect(unknown.error.code).toBe('UNKNOWN_REPO');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

/* A server with no fixed plan resolves from cwd, like `constellation mcp` does. */
describe('working memory over MCP without a plan', () => {
  const home = process.cwd();
  let dir: string;
  let bareClient: Client;

  async function bareCall(name: string, args: Record<string, unknown> = {}) {
    const res = await bareClient.callTool({ name, arguments: args });
    const content = res.content as Array<{ type: string; text: string }>;
    return JSON.parse(content[0].text);
  }

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-working-noplan-')));
    process.chdir(dir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildServer({}).connect(serverTransport);
    bareClient = new Client({ name: 'test-client', version: '0.0.0' });
    await bareClient.connect(clientTransport);
  });

  afterEach(async () => {
    process.chdir(home);
    await bareClient.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('works at the git root of a repo with no plan', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    const init = await bareCall('working_init');
    expect(init.dir).toBe(path.join(dir, '.constellation'));
    await bareCall('working_set', { items: [{ type: 'G', text: 'ship the site' }] });
    await bareCall('working_log', { text: 'started' });
    const list = await bareCall('working_list', { log: 'today' });
    expect(list.items.map((i: { text: string }) => i.text)).toEqual(['ship the site']);
    expect(list.log).toEqual([expect.stringContaining('started')]);
    // Card tools still need a plan, and their error says working memory does not.
    const orient = await bareCall('orient');
    expect(orient.error.code).toBe('NO_PLAN_FOUND');
    expect(orient.error.message).toContain('working_* tools need no plan');
  });

  it('outside git, reads are quiet and writes explain what is missing', async () => {
    const list = await bareCall('working_list');
    expect(list.exists).toBe(false);
    expect(list.error).toBeUndefined();
    const init = await bareCall('working_init');
    expect(init.error.code).toBe('NO_WORKING_ROOT');
    expect(init.error.message).toContain('git repository or a Constellation plan');
    const set = await bareCall('working_set', { items: [{ type: 'T', text: 'x' }] });
    expect(set.error.code).toBe('NO_WORKING_ROOT');
  });
});
