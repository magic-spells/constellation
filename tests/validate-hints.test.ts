import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSchemas } from '../src/core/validate.js';
import type { Card, TypeName } from '../src/core/types.js';

const SCHEMAS = fileURLToPath(new URL('../schemas', import.meta.url));

function card(type: TypeName, frontmatter: Record<string, unknown>): Card {
  return {
    handle: `${type}-PROBE`,
    type,
    relPath: `probe/${type}-PROBE.md`,
    filePath: `/tmp/probe/${type}-PROBE.md`,
    frontmatter,
    body: '',
    refs: { connections: [], frontmatter: [], body: [], mermaid: [] },
  };
}

async function w003(
  type: TypeName,
  frontmatter: Record<string, unknown>,
  dir = SCHEMAS,
): Promise<string> {
  const schemas = await loadSchemas(dir);
  const issues = schemas.validateCard(card(type, frontmatter)).filter((i) => i.code === 'W003');
  expect(issues).toHaveLength(1);
  return issues[0].message;
}

/** The `any card: …` group as a field list — asserted on directly, so a name
 *  that merely contains a reserved key can never fail the wrong assertion. */
function crossTypeFields(message: string): string[] {
  const group = /any card: ([^)]+)\)/.exec(message);
  expect(group, `no cross-type group in: ${message}`).not.toBeNull();
  return group![1].split(', ');
}

describe('W003 names the fields the type accepts', () => {
  it('lists both sources: the type schema and card.json cross-type metadata', async () => {
    const message = await w003('API', { banana_count: 4 });
    // The offending field still leads the message.
    expect(message).toMatch(/^Unknown frontmatter field for API: banana_count/);
    // Source 1 — schemas/api.json.
    expect(message).toContain('valid API fields: methods, path, path_params');
    // Source 2 — schemas/card.json, blessed on all 21 types. The reserved four
    // are structure every card already carries, so they are not listed as fields.
    const crossType = crossTypeFields(message);
    expect(crossType).toEqual([
      'code_refs',
      'notes',
      'order',
      'section',
      'verified_at',
      'verified_sha',
    ]);
    for (const reserved of ['name', 'kind', 'status', 'connections']) {
      expect(crossType).not.toContain(reserved);
    }
  });

  it('still suggests a reserved key it no longer lists', async () => {
    const message = await w003('API', { conections: [] });
    expect(message).toContain('did you mean "connections"?');
  });

  it('lists fields sorted, so the message is stable across runs', async () => {
    const message = await w003('DB', { banana_count: 4 });
    expect(message).toContain('valid DB fields: columns, foreign_keys, indexes, table_name');
  });

  it('says so when a type has no type-specific fields', async () => {
    const message = await w003('DOC', { banana_count: 4 });
    expect(message).toContain('DOC has no type-specific fields');
    expect(message).toContain('any card: code_refs, notes');
    expect(message).not.toContain('valid DOC fields');
  });

  it('does not invent a suggestion for an unrelated field', async () => {
    const message = await w003('STYLE', { zzz_totally_unrelated: 1 });
    expect(message).not.toContain('did you mean');
  });
});

describe('W003 near-miss suggestions', () => {
  it('leads with the suggestion for a typo in a type-specific field', async () => {
    const message = await w003('FILE', { summry: 'x' });
    expect(message).toBe(
      'Unknown frontmatter field for FILE: summry — did you mean "summary"? ' +
        '(valid FILE fields: language, path, summary; ' +
        'any card: code_refs, notes, order, section, verified_at, verified_sha)',
    );
  });

  it('catches a singular/plural slip on a cross-type field', async () => {
    expect(await w003('API', { code_ref: ['src/x.ts'] })).toContain(
      'did you mean "code_refs"?',
    );
    expect(await w003('PLAN', { connection: [] })).toContain('did you mean "connections"?');
  });

  it('catches case and separator slips', async () => {
    expect(await w003('API', { pathParams: [] })).toContain('did you mean "path_params"?');
    expect(await w003('API', { Status: 'built' })).toContain('did you mean "status"?');
  });

  it('catches a transposition', async () => {
    expect(await w003('DB', { tabel_name: 'tickets' })).toContain('did you mean "table_name"?');
  });
});

describe('W003 truncates a long field list', () => {
  const temps: string[] = [];

  afterAll(async () => {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('lists the first 12 fields and counts the rest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'constellation-schemas-'));
    temps.push(dir);
    await copyFile(path.join(SCHEMAS, 'card.json'), path.join(dir, 'card.json'));
    // 20 type-specific fields, named so sort order is obvious.
    const properties = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `f${String(i).padStart(2, '0')}`,
        { type: 'string' },
      ]),
    );
    await writeFile(
      path.join(dir, 'api.json'),
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'api.json',
        type: 'object',
        properties,
      }),
      'utf8',
    );

    const message = await w003('API', { banana_count: 4 }, dir);
    expect(message).toContain(
      'valid API fields: f00, f01, f02, f03, f04, f05, f06, f07, f08, f09, f10, f11, +8 more',
    );
    expect(message).not.toContain('f12');
    // The cross-type group is still complete and still present.
    expect(message).toContain('any card: code_refs, notes');
  });
});
