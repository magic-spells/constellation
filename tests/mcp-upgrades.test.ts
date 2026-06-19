import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-upg-'));
  planRoot = path.join(dir, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('append_note (Phase 1)', () => {
  it('appends typed notes without touching the rest of the card, and never warns', async () => {
    const first = await call('append_note', {
      handle: 'API-TICKETS',
      kind: 'gotcha',
      text: 'POST is intentionally unauthenticated (public intake).',
    });
    expect(first.isError).toBe(false);
    expect(first.data.card.frontmatter.notes).toHaveLength(1);
    expect(first.data.card.frontmatter.notes[0]).toMatchObject({
      kind: 'gotcha',
      text: 'POST is intentionally unauthenticated (public intake).',
    });
    // The new cross-type field must not trip the unknown-field lint (W003) or schema (W002).
    expect(first.data.issues).toEqual([]);

    const second = await call('append_note', {
      handle: 'API-TICKETS',
      kind: 'decision',
      text: 'Cursor pagination chosen over offset.',
    });
    expect(second.data.card.frontmatter.notes).toHaveLength(2);
    expect(second.data.note_count).toBe(2);
    // Existing frontmatter survives the append.
    expect(second.data.card.frontmatter.path).toBe('/api/v1/tickets');
  });

  it('get_card filters notes by kind and limit', async () => {
    const byKind = await call('get_card', { handle: 'API-TICKETS', notes_kind: 'gotcha' });
    expect(byKind.data.card.frontmatter.notes).toHaveLength(1);
    expect(byKind.data.card.frontmatter.notes[0].kind).toBe('gotcha');

    const latest = await call('get_card', { handle: 'API-TICKETS', notes_limit: 1 });
    expect(latest.data.card.frontmatter.notes).toHaveLength(1);
    expect(latest.data.card.frontmatter.notes[0].kind).toBe('decision'); // newest-last
  });
});

describe('edit_section (Phase 1)', () => {
  it('replaces one section, preserving the others, and errors on a missing heading', async () => {
    await call('create_card', {
      handle: 'DOC-SECTIONS',
      body: '## Alpha\n\nalpha body\n\n## Beta\n\nbeta body',
    });

    const edited = await call('edit_section', {
      handle: 'DOC-SECTIONS',
      section: 'Alpha',
      text: 'ALPHA REPLACED',
    });
    expect(edited.isError).toBe(false);
    const body: string = edited.data.card.body;
    expect(body).toContain('ALPHA REPLACED');
    expect(body).toContain('## Beta');
    expect(body).toContain('beta body');
    expect(body).not.toContain('alpha body');

    const missing = await call('edit_section', {
      handle: 'DOC-SECTIONS',
      section: 'Gamma',
      text: 'x',
    });
    expect(missing.isError).toBe(true);
    expect(missing.data.error.code).toBe('SECTION_NOT_FOUND');
  });
});

describe('set_verified (Phase 2)', () => {
  it('stamps verified_sha + verified_at, sets status, appends a verified note', async () => {
    const res = await call('set_verified', {
      handle: 'DB-TICKETS',
      sha: 'a1b2c3d',
      note: 'Schema matches the migration.',
    });
    expect(res.isError).toBe(false);
    expect(res.data.card.frontmatter.verified_sha).toBe('a1b2c3d');
    expect(res.data.card.frontmatter.verified_at).toBeTruthy();
    expect(res.data.card.status).toBe('verified');
    const notes = res.data.card.frontmatter.notes ?? [];
    expect(notes.some((n: { kind: string }) => n.kind === 'verified')).toBe(true);
    // verified_sha/verified_at/notes are blessed cross-type fields — no lint noise.
    expect(res.data.issues).toEqual([]);
  });
});

describe('code binding (Phase 4 — paths)', () => {
  it('resolves a card bound code via its connected FILE card', async () => {
    const res = await call('get_card', { handle: 'API-TICKETS', code: 'paths' });
    const files = res.data.code.files as Array<Record<string, unknown>>;
    const ticketsRoute = files.find((f) => f.path === 'src/api/tickets.ts');
    expect(ticketsRoute).toBeDefined();
    expect(ticketsRoute!.via).toBe('file-card');
    expect(ticketsRoute!.handle).toBe('FILE-TICKETS-ROUTE');
  });

  it('code_refs are a valid cross-type field and become bound paths', async () => {
    const created = await call('create_card', {
      handle: 'COMPONENT-WIDGET',
      fields: { code_refs: ['src/ui/widget.tsx:Widget'] },
      connections: ['PAGE-INBOX'],
      body: 'A widget.',
    });
    expect(created.data.issues).toEqual([]); // code_refs not flagged W003
    const res = await call('get_card', { handle: 'COMPONENT-WIDGET', code: 'paths' });
    const files = res.data.code.files as Array<Record<string, unknown>>;
    const ref = files.find((f) => f.path === 'src/ui/widget.tsx');
    expect(ref).toBeDefined();
    expect(ref!.via).toBe('code_ref');
    expect(ref!.symbol).toBe('Widget');
  });
});

describe('edit_section is fence-aware (regression)', () => {
  it('ignores #-lines inside code fences and replaces the whole real section', async () => {
    await call('create_card', {
      handle: 'DOC-FENCE',
      body: '## Setup\n\nrun:\n\n```sh\n# install deps\nnpm install\n```\n\n## Usage\n\nuse it',
    });

    // The "# install deps" line lives inside a ```sh fence — NOT a heading.
    const fake = await call('edit_section', {
      handle: 'DOC-FENCE',
      section: 'install deps',
      text: 'CORRUPTED',
    });
    expect(fake.isError).toBe(true);
    expect(fake.data.error.code).toBe('SECTION_NOT_FOUND');

    // Replacing the real Setup section must extend past the fence to ## Usage,
    // not stop early at the fenced "# install deps" line.
    const edited = await call('edit_section', {
      handle: 'DOC-FENCE',
      section: 'Setup',
      text: 'NEW SETUP',
    });
    const body: string = edited.data.card.body;
    expect(body).toContain('## Setup');
    expect(body).toContain('NEW SETUP');
    expect(body).toContain('## Usage');
    expect(body).toContain('use it');
    expect(body).not.toContain('npm install'); // fence was part of Setup → replaced
  });

  it('refuses to guess when a heading is ambiguous', async () => {
    await call('create_card', {
      handle: 'DOC-DUPE',
      body: '## Notes\n\nfirst\n\n## Other\n\nx\n\n## Notes\n\nsecond',
    });
    const res = await call('edit_section', { handle: 'DOC-DUPE', section: 'Notes', text: 'Z' });
    expect(res.isError).toBe(true);
    expect(res.data.error.code).toBe('AMBIGUOUS_SECTION');
  });
});

describe('append_note byte-preservation (regression)', () => {
  it('adds only the notes key, leaving sibling frontmatter + body byte-for-byte', async () => {
    const raw =
      '---\nname: Bytes\nconnections: [DB-TICKETS]\nweird_quoted: "value: with colon"\n---\n\n# Body\n\nunchanged body line\n';
    await writeFile(`${planRoot}/doc/DOC-BYTES.md`, raw, 'utf8');

    await call('append_note', { handle: 'DOC-BYTES', kind: 'gotcha', text: 'a note' });

    const after = await readFile(`${planRoot}/doc/DOC-BYTES.md`, 'utf8');
    expect(after).toContain('connections: [DB-TICKETS]'); // flow style preserved
    expect(after).toContain('weird_quoted: "value: with colon"'); // quoting preserved
    expect(after).toContain('unchanged body line'); // body untouched
    expect(after).toContain('notes:'); // the one key that changed
  });
});

describe('validate still distinguishes real unknowns from blessed metadata (regression)', () => {
  it('blesses cross-type fields but still flags a genuine unknown field (W003)', async () => {
    const res = await call('create_card', {
      handle: 'API-VALCHECK',
      fields: {
        code_refs: ['src/x.ts'],
        verified_sha: 'abcdef1',
        notes: [{ kind: 'gotcha', text: 'x' }],
        junk_field: 'y',
      },
      body: 'b',
    });
    const codes = (res.data.issues as Array<{ code: string; message: string }>) ?? [];
    const w003 = codes.filter((i) => i.code === 'W003');
    expect(w003).toHaveLength(1);
    expect(w003[0].message).toContain('junk_field');
  });

  it('validates the shape of the cross-type metadata fields (W002)', async () => {
    const res = await call('create_card', {
      handle: 'API-VALBAD',
      fields: { verified_sha: 'zzz', code_refs: 'not-an-array', notes: [{ kind: 'bogus' }] },
      body: 'b',
    });
    const codes = (res.data.issues as Array<{ code: string }>) ?? [];
    expect(codes.some((i) => i.code === 'W002')).toBe(true);
  });
});
