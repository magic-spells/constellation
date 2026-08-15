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
let planRoot: string;
let client: Client;
let head: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-drift-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  // A real source file the FILE-TICKETS-ROUTE card binds to (path: src/api/tickets.ts).
  await mkdir(path.join(repo, 'src', 'api'), { recursive: true });
  await writeFile(
    path.join(repo, 'src', 'api', 'tickets.ts'),
    'export function listTickets() { return []; } // MARKER_V1\n',
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

describe('set_verified against real HEAD (Phase 2)', () => {
  it('stamps the current HEAD as the verified baseline', async () => {
    const res = await call('set_verified', { handle: 'API-TICKETS' });
    expect(res.warning).toBeUndefined();
    expect(res.verified_sha).toBe(head);
    expect(res.card.frontmatter.verified_sha).toBe(head);
    expect(res.card.status).toBe('verified');
  });
});

describe('code attach direct (Phase 4)', () => {
  it('attaches the real bound file contents under the size budget', async () => {
    const res = await call('get_card', { handle: 'API-TICKETS', code: 'direct' });
    expect(res.code.repo_root).toBeTruthy();
    const file = res.code.files.find(
      (f: { path: string }) => f.path === 'src/api/tickets.ts',
    );
    expect(file.exists).toBe(true);
    expect(file.skipped).toBeUndefined();
    expect(file.content).toContain('MARKER_V1');
  });
});

describe('assemble (Phase 5)', () => {
  it('merges cards that share a bound file into one unit', async () => {
    const res = await call('assemble', {
      handles: ['API-TICKETS', 'FILE-TICKETS-ROUTE'],
    });
    expect(res.units).toHaveLength(1);
    expect(res.units[0].handles).toEqual(['API-TICKETS', 'FILE-TICKETS-ROUTE']);
    expect(res.units[0].files).toContain('src/api/tickets.ts');
  });

  it('splits cards with disjoint files into separate fan-out units', async () => {
    const res = await call('assemble', { handles: ['API-TICKETS', 'DB-TICKETS'] });
    expect(res.fanout.unit_count).toBe(2);
    // suggested order puts data (DB) before contracts/surfaces (API)
    expect(res.suggested_order.indexOf('DB-TICKETS')).toBeLessThan(
      res.suggested_order.indexOf('API-TICKETS'),
    );
  });
});

describe('stale_report + check_sync (Phases 3 & 6)', () => {
  it('flags a verified card whose bound code changed since its verified_sha', async () => {
    // Before the edit, API-TICKETS (verified at HEAD) is not stale.
    const clean = await call('stale_report');
    expect(clean.stale.map((s: { handle: string }) => s.handle)).not.toContain(
      'API-TICKETS',
    );

    // Change the bound file in the working tree.
    await writeFile(
      path.join(repo, 'src', 'api', 'tickets.ts'),
      'export function listTickets() { return [1]; } // MARKER_V2\n',
      'utf8',
    );

    const report = await call('stale_report');
    const stale = report.stale.find((s: { handle: string }) => s.handle === 'API-TICKETS');
    expect(stale).toBeDefined();
    expect(stale.changed_files).toContain('src/api/tickets.ts');
    expect(stale.baseline_source).toBe('verified_sha');
  });

  it('check_sync rolls the per-card drift into one advisory verdict', async () => {
    const res = await call('check_sync');
    expect(res.advisory).toContain('Advisory');
    expect(typeof res.state).toBe('string');
    expect(Array.isArray(res.stale_cards)).toBe(true);
    expect(res.stale_cards.map((s: { handle: string }) => s.handle)).toContain(
      'API-TICKETS',
    );
  });
});

// A card may bind a whole FOLDER (`code_refs: [tests]`) when the unit it
// describes is the folder. That has to behave like a binding, not like a
// missing file: `tests` is not a file, so an existence check written as
// `stat().isFile()` reported it missing on every run — the card read as
// permanently stale while git, which only ever names the individual files it
// changed, could never match the folder path to register real drift.
describe('a card bound to a directory', () => {
  let libSha: string;

  beforeAll(async () => {
    await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
    await writeFile(path.join(repo, 'src', 'lib', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(path.join(repo, 'src', 'lib', 'b.ts'), 'export const b = 1;\n', 'utf8');
    git('add', 'src/lib');
    git('commit', '-q', '-m', 'add src/lib');
    libSha = git('rev-parse', 'HEAD').trim();

    await call('create_card', {
      handle: 'DOC-LIB',
      name: 'The lib folder',
      status: 'built',
      fields: { code_refs: ['src/lib'] },
      body: 'Everything under `src/lib`.',
    });
    await call('set_verified', { handle: 'DOC-LIB' });
  });

  it('reports the folder as bound and present, not missing', async () => {
    const res = await call('get_card', { handle: 'DOC-LIB', code: 'paths' });
    const entry = res.code.files.find((f: { path: string }) => f.path === 'src/lib');
    expect(entry).toMatchObject({ exists: true, dir: true });
    expect(res.code.missing).not.toContain('src/lib');
  });

  it('is not stale while nothing under the folder has changed', async () => {
    const report = await call('stale_report');
    expect(report.stale.map((s: { handle: string }) => s.handle)).not.toContain('DOC-LIB');
    expect(report.no_baseline.map((s: { handle: string }) => s.handle)).not.toContain('DOC-LIB');
  });

  it('goes stale when a file inside it changes, naming the file', async () => {
    await writeFile(path.join(repo, 'src', 'lib', 'b.ts'), 'export const b = 2;\n', 'utf8');

    const report = await call('stale_report');
    const stale = report.stale.find((s: { handle: string }) => s.handle === 'DOC-LIB');
    expect(stale).toBeDefined();
    expect(stale.baseline).toBe(libSha.slice(0, 12));
    // The changed FILE is the useful signal — "src/lib changed" is not.
    expect(stale.changed_files).toEqual(['src/lib/b.ts']);
    expect(stale.missing_files).toEqual([]);
  });

  it('never attaches a whole folder in code: "direct"', async () => {
    const res = await call('get_card', { handle: 'DOC-LIB', code: 'direct' });
    const entry = res.code.files.find((f: { path: string }) => f.path === 'src/lib');
    expect(entry.skipped).toBe('directory');
    expect(entry.content).toBeUndefined();
  });
});
