import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeCard, deepMerge, updateCardFile } from '../src/core/writer.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-writer-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('deepMerge', () => {
  it('merges objects, replaces arrays, deletes on null, preserves key order', () => {
    const target = { name: 'A', methods: { GET: { x: 1 }, POST: { y: 2 } }, tags: ['a'] };
    const merged = deepMerge(target, {
      methods: { GET: { x: 9 } },
      tags: ['b', 'c'],
      name: null,
      extra: true,
    });
    expect(merged).toEqual({
      methods: { GET: { x: 9 }, POST: { y: 2 } },
      tags: ['b', 'c'],
      extra: true,
    });
    expect(Object.keys(merged)).toEqual(['methods', 'tags', 'extra']);
  });
});

describe('updateCardFile formatting preservation', () => {
  const original = `---
name: Test card
columns:
  - { name: id, sql_type: UUID, primary_key: true }
connections:
  - DB-TICKETS
---

Original body.
`;

  it('body-only updates leave frontmatter bytes untouched (flow style survives)', async () => {
    const file = path.join(dir, 'DB-SAMPLE.md');
    await writeFile(file, original);
    await updateCardFile(file, { body: 'New body.' });
    const after = await readFile(file, 'utf8');
    expect(after).toContain('- { name: id, sql_type: UUID, primary_key: true }');
    expect(after).toContain('New body.');
    expect(after).not.toContain('Original body.');
  });

  it('frontmatter updates preserve key order and keep the body', async () => {
    const file = path.join(dir, 'DB-SAMPLE2.md');
    await writeFile(file, original);
    await updateCardFile(file, {
      frontmatter: {
        name: 'Test card',
        columns: [{ name: 'id', sql_type: 'UUID', primary_key: true }],
        connections: ['DB-TICKETS'],
        status: 'built',
      },
    });
    const after = await readFile(file, 'utf8');
    const keys = [...after.matchAll(/^(\w[\w_]*):/gm)].map((m) => m[1]);
    expect(keys).toEqual(['name', 'columns', 'connections', 'status']);
    expect(after).toContain('Original body.');
  });

  it('frontmatter-only updates preserve body tail bytes', async () => {
    const file = path.join(dir, 'DOC-TAIL.md');
    await writeFile(
      file,
      `---
name: Tail test
---

Line with spaces   

`,
    );
    await updateCardFile(file, {
      frontmatter: {
        name: 'Tail test',
        status: 'built',
      },
    });
    const after = await readFile(file, 'utf8');
    expect(after.endsWith('Line with spaces   \n\n')).toBe(true);
  });

  it('composeCard omits the frontmatter block when empty', () => {
    expect(composeCard({}, 'Just a body.')).toBe('Just a body.\n');
  });

  it('re-serializes ONLY the changed top-level keys (flow style survives)', async () => {
    const file = path.join(dir, 'PAGE-SAMPLE.md');
    await writeFile(
      file,
      `---
name: Inbox
status: building
path_params:
  - { name: ticket_id, type: string, required: false }
query_params:
  - { name: status, type: string }
---

Body.
`,
    );
    await updateCardFile(file, {
      frontmatter: {
        name: 'Inbox',
        status: 'built',
        path_params: [{ name: 'ticket_id', type: 'string', required: false }],
        query_params: [{ name: 'status', type: 'string' }],
      },
    });
    const after = await readFile(file, 'utf8');
    expect(after).toContain('status: built');
    expect(after).toContain('- { name: ticket_id, type: string, required: false }');
    expect(after).toContain('- { name: status, type: string }');
  });
});
