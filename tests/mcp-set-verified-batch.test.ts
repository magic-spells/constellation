import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

// A re-verification sweep used to be one loadPlan + lintPlan PER card. These
// cover the batch that replaced it: one sha, one dirty check, one lint pass —
// with the single-handle response shape unchanged.

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
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-verify-batch-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  // Real files behind the golden plan's bindings: FILE-TICKETS-ROUTE (path:),
  // DATATYPE-TICKET and STYLE-COLORS (code_refs:).
  await mkdir(path.join(repo, 'src', 'api'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'types'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'styles'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'api', 'tickets.ts'), 'export const r = 1;\n');
  await writeFile(path.join(repo, 'src', 'types', 'ticket.ts'), 'export type Ticket = {};\n');
  await writeFile(path.join(repo, 'src', 'styles', 'tokens.css'), ':root { --ink: #111; }\n');
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

describe('set_verified input contract', () => {
  it('rejects passing both handle and handles', async () => {
    const res = await call('set_verified', {
      handle: 'API-TICKETS',
      handles: ['API-TICKETS'],
    });
    expect(res.error.code).toBe('INVALID_INPUT');
  });

  it('rejects passing neither', async () => {
    const res = await call('set_verified', {});
    expect(res.error.code).toBe('INVALID_INPUT');
  });

  it('still fails a single unknown handle outright', async () => {
    const res = await call('set_verified', { handle: 'API-NOPE' });
    expect(res.error.code).toBe('NOT_FOUND');
  });
});

describe('set_verified (single handle) keeps its response shape', () => {
  it('returns card / verified_sha / verified_at / issues and no batch fields', async () => {
    const res = await call('set_verified', { handle: 'API-TICKETS' });
    expect(res.verified_sha).toBe(head);
    expect(res.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.card.handle).toBe('API-TICKETS');
    expect(res.card.status).toBe('verified');
    expect(res.issues).toEqual([]);
    expect(res.verified).toBeUndefined();
    expect(res.failed).toBeUndefined();
    expect(res.cards).toBeUndefined();
  });
});

describe('set_verified (batch)', () => {
  it('verifies every card in one call, stamping the same sha and timestamp', async () => {
    const res = await call('set_verified', {
      handles: ['DB-TICKETS', 'PAGE-INBOX', 'COMPONENT-TICKET-CARD'],
    });
    expect(res.verified).toBe(3);
    expect(res.failed).toEqual([]);
    expect(res.verified_sha).toBe(head);
    expect(res.cards.map((c: { handle: string }) => c.handle).sort()).toEqual([
      'COMPONENT-TICKET-CARD',
      'DB-TICKETS',
      'PAGE-INBOX',
    ]);
    expect(res.cards.every((c: { status: string }) => c.status === 'verified')).toBe(true);

    for (const handle of ['DB-TICKETS', 'PAGE-INBOX', 'COMPONENT-TICKET-CARD']) {
      const card = await call('get_card', { handle });
      expect(card.card.frontmatter.verified_sha).toBe(head);
      expect(card.card.frontmatter.verified_at).toBe(res.verified_at);
    }
  });

  it('lowercases and dedupes handles, counting each card once', async () => {
    const res = await call('set_verified', {
      handles: ['role-support-agent', 'ROLE-SUPPORT-AGENT'],
    });
    expect(res.verified).toBe(1);
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].handle).toBe('ROLE-SUPPORT-AGENT');

    // An unknown handle dedupes on the same key: one typo repeated is one row,
    // not one row per repeat.
    const unknown = await call('set_verified', {
      handles: ['API-NOPE', 'api-nope', 'API-NOPE'],
    });
    expect(unknown.failed).toEqual([{ handle: 'API-NOPE', error: 'NOT_FOUND' }]);
    expect(unknown.verified).toBe(0);
  });

  it('reports unknown handles in failed and still verifies the rest', async () => {
    const res = await call('set_verified', {
      handles: ['API-NOPE', 'EVENT-TICKET-CREATED'],
    });
    expect(res.verified).toBe(1);
    expect(res.failed).toEqual([{ handle: 'API-NOPE', error: 'NOT_FOUND' }]);
    expect(res.cards[0].handle).toBe('EVENT-TICKET-CREATED');
  });

  it('returns an empty batch rather than an error when nothing resolves', async () => {
    const res = await call('set_verified', { handles: ['API-NOPE', 'DB-NOPE'] });
    expect(res.verified).toBe(0);
    expect(res.failed).toHaveLength(2);
    expect(res.cards).toEqual([]);
  });

  it('appends the note to every card in the batch, stamped with the sha', async () => {
    await call('set_verified', {
      handles: ['FLOW-CREATE-TICKET', 'JOB-AUTO-ASSIGN'],
      note: 'checked against the running code',
    });
    for (const handle of ['FLOW-CREATE-TICKET', 'JOB-AUTO-ASSIGN']) {
      const card = await call('get_card', { handle });
      const notes = card.card.frontmatter.notes as Array<Record<string, string>>;
      const verifiedNote = notes.find((n) => n.kind === 'verified');
      expect(verifiedNote?.text).toBe('checked against the running code');
      expect(verifiedNote?.sha).toBe(head);
    }
  });

  it('honours an explicit sha for the whole batch', async () => {
    const res = await call('set_verified', {
      handles: ['EXTERNAL-EMAIL-PROVIDER', 'DECISION-NO-HARD-DELETE'],
      sha: head.slice(0, 8),
    });
    expect(res.verified_sha).toBe(head);
    expect(res.warning).toBeUndefined();
  });

  it('warns once for an unresolvable sha instead of once per card', async () => {
    const res = await call('set_verified', {
      handles: ['DOC-TICKET-LIFECYCLE', 'TEST-CREATE-TICKET'],
      sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    expect(res.verified).toBe(2);
    expect(res.warning).toContain('does not resolve');
    expect(res.warning.match(/does not resolve/g)).toHaveLength(1);
  });

  it('attributes dirty bound files back to the card that binds them', async () => {
    await writeFile(
      path.join(repo, 'src', 'types', 'ticket.ts'),
      'export type Ticket = { id: string };\n',
    );
    const res = await call('set_verified', {
      handles: ['DATATYPE-TICKET', 'STYLE-COLORS'],
    });
    expect(res.verified).toBe(2);
    expect(res.warning).toContain('DATATYPE-TICKET: src/types/ticket.ts');
    expect(res.warning).not.toContain('STYLE-COLORS');
    expect(res.warning).not.toContain('src/styles/tokens.css');
  });

  it('leaves the plan lint-clean and returns issues only for cards it touched', async () => {
    const res = await call('set_verified', { handles: ['STATE-TICKET', 'FEATURE-AUTO-ASSIGNMENT'] });
    expect(res.issues).toEqual([]);
    const integrity = await call('check_integrity');
    expect(integrity.errors).toEqual([]);
  });

  // Directory permissions are the portable way to make one card's atomic write
  // (temp file + rename, in the card's own folder) fail. Root ignores them, and
  // Windows has no equivalent.
  const canBlockWrites =
    process.platform !== 'win32' && (process.getuid?.() ?? 1) !== 0;

  it.skipIf(!canBlockWrites)(
    'keeps writing the rest of the batch when one card fails, and says which',
    async () => {
      const locked = path.join(planRoot, 'agent');
      await chmod(locked, 0o555);
      let res: Record<string, any>;
      try {
        res = await call('set_verified', {
          // The failing card FIRST: the sweep must carry on past it.
          handles: ['AGENT-CODE-STYLE', 'DATATYPE-CREATE-TICKET-INPUT'],
        });
      } finally {
        await chmod(locked, 0o755);
      }

      expect(res.verified).toBe(1);
      expect(res.cards.map((c: { handle: string }) => c.handle)).toEqual([
        'DATATYPE-CREATE-TICKET-INPUT',
      ]);
      expect(res.failed).toHaveLength(1);
      expect(res.failed[0].handle).toBe('AGENT-CODE-STYLE');
      // Coded like every other failed row; the fs message rides behind the code
      // rather than being the whole value.
      expect(res.failed[0].error).toMatch(/^WRITE_FAILED: /);

      const written = await call('get_card', { handle: 'DATATYPE-CREATE-TICKET-INPUT' });
      expect(written.card.frontmatter.verified_sha).toBe(res.verified_sha);
      const untouched = await call('get_card', { handle: 'AGENT-CODE-STYLE' });
      expect(untouched.card.frontmatter.verified_sha).toBeUndefined();
      expect(untouched.card.status).not.toBe('verified');
    },
  );
});

// The plan folder's parent is usually the git root, which makes the code-root
// prefix '' and leaves the prefix/strip round trip in the dirty check untested.
// Here the plan sits at packages/app/constellation, so prefix is 'packages/app'.
describe('set_verified (batch) under a non-empty code-root prefix', () => {
  let monoRepo: string;
  let appRoot: string;
  let monoClient: Client;

  beforeAll(async () => {
    monoRepo = await mkdtemp(path.join(tmpdir(), 'constellation-verify-mono-'));
    appRoot = path.join(monoRepo, 'packages', 'app');
    const appPlan = path.join(appRoot, 'constellation');
    await cp(GOLDEN, appPlan, { recursive: true });
    await mkdir(path.join(appRoot, 'src', 'types'), { recursive: true });
    await mkdir(path.join(appRoot, 'src', 'styles'), { recursive: true });
    await writeFile(
      path.join(appRoot, 'src', 'types', 'ticket.ts'),
      'export type Ticket = {};\n',
    );
    await writeFile(
      path.join(appRoot, 'src', 'styles', 'tokens.css'),
      ':root { --ink: #111; }\n',
    );
    // A sibling package, so the repo really is a monorepo and not a repo with
    // one deep folder.
    await mkdir(path.join(monoRepo, 'packages', 'other'), { recursive: true });
    await writeFile(
      path.join(monoRepo, 'packages', 'other', 'other.ts'),
      'export const other = 1;\n',
    );
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'initial monorepo'],
    ]) {
      execFileSync('git', args, { cwd: monoRepo, encoding: 'utf8' });
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildServer({ planRoot: appPlan });
    await server.connect(serverTransport);
    monoClient = new Client({ name: 'test-client', version: '0.0.0' });
    await monoClient.connect(clientTransport);
  });

  afterAll(async () => {
    await monoClient?.close();
    await rm(monoRepo, { recursive: true, force: true });
  });

  it('attributes a dirty package file to its card, in code-root-relative terms', async () => {
    await writeFile(
      path.join(appRoot, 'src', 'types', 'ticket.ts'),
      'export type Ticket = { id: string };\n',
    );
    const res = await monoClient.callTool({
      name: 'set_verified',
      arguments: { handles: ['DATATYPE-TICKET', 'STYLE-COLORS'] },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);

    expect(data.verified).toBe(2);
    expect(data.warning).toContain('DATATYPE-TICKET: src/types/ticket.ts');
    // Reported through the code root, not the git root.
    expect(data.warning).not.toContain('packages/app');
    // The clean sibling binding is not swept in with it.
    expect(data.warning).not.toContain('STYLE-COLORS');
    expect(data.warning).not.toContain('src/styles/tokens.css');
  });
});
