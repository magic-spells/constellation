import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
});
